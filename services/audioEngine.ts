// path: src/services/audioEngine.ts
import { AudioSettings, Clip, Device, Track, TrackType } from '../types';
import {
    denormalizeTrackParam,
    getLaneByParam,
    sampleAutomationLaneAtBar
} from './automationService';

interface ActiveSource {
    source?: AudioBufferSourceNode;
    granularNode?: AudioWorkletNode;
    gain: GainNode;
    startTime: number;
    offset: number;
    originalBpm: number;
    clipTransposeSemitones: number;
    clipPlaybackRate: number;
}

interface RecordingSession {
    mediaRecorder: MediaRecorder;
    recordedChunks: Blob[];
    stream: MediaStream;
}

interface MonitoringSession {
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    inputGain: GainNode;
    monitorGate: GainNode;
    reverbSend: GainNode;
    reverbConvolver: ConvolverNode;
    echoDelay: DelayNode;
    echoFeedback: GainNode;
    echoWet: GainNode;
}

interface TrackMeterState {
    rmsDb: number;
    peakDb: number;
}

interface DeviceRuntime {
    input: AudioNode;
    output: AudioNode;
    paramSetters: Map<string, (value: number, immediate?: boolean) => void>;
    cleanup?: () => void;
}

interface TrackNodeGraph {
    input: GainNode;
    preSendTap: GainNode;
    gain: GainNode;
    panner: StereoPannerNode;
    reverb: ConvolverNode;
    reverbGain: GainNode;
    sendGains: Map<string, GainNode>;
    sendModes: Map<string, 'pre' | 'post'>;
    outputTargetGroupId: string | null;
    deviceRuntimes: Map<string, DeviceRuntime>;
}

interface MixEvaluationContext {
    tracksById: Map<string, Track>;
    effectiveSoloMap: Map<string, boolean>;
    anySolo: boolean;
}

type AudioContextWithSink = AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
    sinkId?: string;
};

class AudioEngine {
    ctx: AudioContext | null = null;
    masterGain: GainNode | null = null;
    masterOutput: GainNode | null = null;
    masterAnalyser: AnalyserNode | null = null;
    masterAnalyserBuffer: Float32Array | null = null;
    cueGain: GainNode | null = null;
    cueSourceNode: AudioNode | null = null;
    cueTrackId: string | null = null;
    cueMode: 'pfl' | 'afl' | null = null;
    limiter: DynamicsCompressorNode | GainNode | null = null;
    analysers: Map<string, AnalyserNode> = new Map();
    analyserBuffers: Map<string, Float32Array> = new Map();
    trackMeterState: Map<string, TrackMeterState> = new Map();
    trackClipHoldState: Set<string> = new Set();
    masterMeterState: TrackMeterState = { rmsDb: -72, peakDb: -72 };
    masterClipHold: boolean = false;
    trackNodes: Map<string, TrackNodeGraph> = new Map();
    trackDeviceSignatures: Map<string, string> = new Map();
    defaultReverbImpulse: AudioBuffer | null = null;
    masterVolumeDb: number = -2;
    cueDimFactor: number = 0.2;

    // Playback State
    activeSources: Map<string, ActiveSource> = new Map();
    exhaustedClipWindows: Map<string, number> = new Map();

    // Input State
    inputNodes: Map<string, MediaStreamAudioSourceNode> = new Map();
    inputStream: MediaStream | null = null;

    nextNoteTime: number = 0;
    isPlaying: boolean = false;
    currentBpm: number = 120;
    masterTransposeSemitones: number = 0;
    schedulerTimer: number | null = null;
    lookahead: number = 25.0; // ms
    scheduleAheadTime: number = 0.1; // seconds
    schedulerIntervalMs: number = 25;
    effectiveBufferSize: number = 256;
    effectiveLatencyHint: AudioContextLatencyCategory | number = 'interactive';
    bufferStrategy: 'audio-context-latency-hint' | 'scheduler-window' | 'hybrid' = 'scheduler-window';
    granularGrainSize: number = 0.05;
    granularOverlap: number = 2;
    virtualStartTime: number = 0; // The AudioContext time when playback started
    offsetTime: number = 0; // The project time offset (for seek/resume)

    // Loop State
    isLooping: boolean = false;
    loopStart: number = 0;
    loopEnd: number = 0;

    // Recording
    recordingSessions: Map<string, RecordingSession> = new Map();
    monitoringSessions: Map<string, MonitoringSession> = new Map();

    // Settings
    settings: AudioSettings = {
        sampleRate: 48000,
        bufferSize: 256, // Latency hint
        latencyHint: 'interactive'
    };
    private outputFallbackApplied: boolean = false;
    private currentTracksSnapshot: Track[] = [];
    private forceSystemOutput: boolean = true;
    private _isRestarting: boolean = false;

    constructor() {
        // Singleton pattern usually managed by instance export
    }

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private finiteOr(value: number, fallback: number): number {
        return Number.isFinite(value) ? value : fallback;
    }

    private resolveRequestedBufferSize(): number {
        const requested = this.settings.bufferSize;
        if (requested === 'auto') {
            if (this.settings.latencyHint === 'playback') return 1024;
            if (this.settings.latencyHint === 'balanced') return 512;
            return 256;
        }

        return this.clamp(this.finiteOr(requested, 256), 128, 2048);
    }

    private resolveLatencyHintForContext(): AudioContextLatencyCategory | number {
        const requested = this.settings.bufferSize;
        if (requested === 'auto') {
            return this.settings.latencyHint as AudioContextLatencyCategory;
        }

        const sampleRate = this.ctx?.sampleRate || this.settings.sampleRate || 48000;
        return this.clamp(requested / sampleRate, 0.003, 0.2);
    }

    private applyRuntimeBufferStrategy() {
        const sampleRate = this.ctx?.sampleRate || this.settings.sampleRate || 48000;
        const effectiveBuffer = this.resolveRequestedBufferSize();
        const frameDurationSec = effectiveBuffer / sampleRate;

        this.effectiveBufferSize = Math.round(effectiveBuffer);
        this.lookahead = this.clamp(frameDurationSec * 1000 * 1.5, 8, 120);
        this.scheduleAheadTime = this.clamp(frameDurationSec * 3, 0.04, 0.35);
        this.schedulerIntervalMs = Math.round(this.clamp(this.lookahead, 8, 120));
        this.granularGrainSize = this.clamp(frameDurationSec * 4, 0.02, 0.14);
        this.granularOverlap = Math.round(this.clamp(this.effectiveBufferSize <= 256 ? 4 : this.effectiveBufferSize <= 1024 ? 3 : 2, 2, 6));

        const userLatencyHint = this.settings.latencyHint;
        const usingContextLatencyHint = userLatencyHint === 'interactive' || userLatencyHint === 'balanced' || userLatencyHint === 'playback';
        this.bufferStrategy = usingContextLatencyHint ? 'hybrid' : 'scheduler-window';

        this.effectiveLatencyHint = this.resolveLatencyHintForContext();

        if (this.schedulerTimer && this.isPlaying) {
            window.clearInterval(this.schedulerTimer);
            this.schedulerTimer = window.setInterval(() => this.schedulerLoop(), this.schedulerIntervalMs);
        }
    }

    private sanitizeDevices(devices: Device[] | undefined): Device[] {
        if (!Array.isArray(devices)) return [];

        return devices
            .filter((device): device is Device => Boolean(device && typeof device.id === 'string' && Array.isArray(device.params)))
            .map((device) => ({
                ...device,
                params: device.params
                    .filter((param) => param && typeof param.name === 'string')
                    .map((param) => ({
                        ...param,
                        value: this.finiteOr(param.value, this.finiteOr(param.min, 0)),
                        min: this.finiteOr(param.min, 0),
                        max: this.finiteOr(param.max, 1)
                    }))
            }));
    }

    private sanitizeClip(clip: Clip): Clip {
        const safeStart = Math.max(1, this.finiteOr(clip.start, 1));
        const safeLength = Math.max(1 / 64, this.finiteOr(clip.length, 1));
        const safeOffset = Math.max(0, this.finiteOr(clip.offset, 0));
        const safeFadeIn = Math.max(0, this.finiteOr(clip.fadeIn, 0));
        const safeFadeOut = Math.max(0, this.finiteOr(clip.fadeOut, 0));
        const safeGain = this.clamp(this.finiteOr(clip.gain, 1), 0, 2);
        const safePlaybackRate = this.clamp(this.finiteOr(clip.playbackRate, 1), 0.25, 4);
        const safeOriginalBpm = Math.max(1, this.finiteOr(clip.originalBpm ?? 120, 120));
        const safeTranspose = this.clamp(Math.round(this.finiteOr(clip.transpose ?? 0, 0)), -24, 24);

        return {
            ...clip,
            start: safeStart,
            length: safeLength,
            offset: safeOffset,
            fadeIn: safeFadeIn,
            fadeOut: safeFadeOut,
            gain: safeGain,
            playbackRate: safePlaybackRate,
            originalBpm: safeOriginalBpm,
            transpose: safeTranspose,
            notes: Array.isArray(clip.notes) ? clip.notes : []
        };
    }

    private sanitizeTrack(track: Track): Track {
        const safeType = Object.values(TrackType).includes(track.type) ? track.type : TrackType.AUDIO;
        const safeMonitor = track.monitor === 'in' || track.monitor === 'off' ? track.monitor : 'auto';
        const safeMicSettings: NonNullable<Track['micSettings']> = {
            profile: track.micSettings?.profile === 'podcast' || track.micSettings?.profile === 'raw'
                ? track.micSettings.profile
                : 'studio-voice',
            inputGain: this.clamp(this.finiteOr(track.micSettings?.inputGain ?? 1, 1), 0, 2),
            monitoringEnabled: Boolean(track.micSettings?.monitoringEnabled),
            monitoringReverb: Boolean(track.micSettings?.monitoringReverb),
            monitoringEcho: Boolean(track.micSettings?.monitoringEcho)
        };

        const safeClips = Array.isArray(track.clips)
            ? track.clips
                .filter((clip): clip is Clip => Boolean(clip && typeof clip.id === 'string'))
                .map((clip) => this.sanitizeClip(clip))
            : [];

        const safeClipById = new Map(safeClips.map((clip) => [clip.id, clip]));

        const safeSessionClips = Array.isArray(track.sessionClips)
            ? track.sessionClips.map((slot, index) => {
                const slotClipId = slot?.clip?.id;
                return {
                    id: slot?.id || `slot-${track.id}-${index}`,
                    clip: slotClipId ? safeClipById.get(slotClipId) || null : null,
                    isPlaying: Boolean(slot?.isPlaying),
                    isQueued: Boolean(slot?.isQueued)
                };
            })
            : [];

        return {
            ...track,
            type: safeType,
            volume: this.clamp(this.finiteOr(track.volume, 0), -60, 6),
            pan: this.clamp(this.finiteOr(track.pan, 0), -50, 50),
            reverb: this.clamp(this.finiteOr(track.reverb, 0), 0, 100),
            transpose: this.clamp(Math.round(this.finiteOr(track.transpose, 0)), -24, 24),
            monitor: safeMonitor,
            isMuted: Boolean(track.isMuted),
            isSoloed: Boolean(track.isSoloed),
            isArmed: Boolean(track.isArmed),
            soloSafe: Boolean(track.soloSafe),
            clips: safeClips,
            sessionClips: safeSessionClips,
            devices: this.sanitizeDevices(track.devices),
            sends: track.sends && typeof track.sends === 'object' ? track.sends : {},
            sendModes: track.sendModes && typeof track.sendModes === 'object' ? track.sendModes : {},
            micSettings: safeMicSettings
        };
    }

    private normalizePan(pan: number): number {
        if (pan >= -1 && pan <= 1) return pan;
        return this.clamp(pan / 50, -1, 1);
    }

    private normalizeReverbSend(reverb: number): number {
        if (!isFinite(reverb)) return 0;
        const normalized = reverb > 1 ? reverb / 100 : reverb;
        return this.clamp(normalized, 0, 1);
    }

    private dbToLinear(db: number): number {
        // Clamp to prevent exponential explosion
        if (db < -100) return 0;
        if (db > 24) db = 24;
        return Math.pow(10, db / 20);
    }

    private normalizeSendGain(send: number | undefined, forceDbMode: boolean = false): number {
        if (!Number.isFinite(send)) return 0;

        const value = Number(send);
        if (!forceDbMode && value >= 0 && value <= 1) {
            return value;
        }

        return this.dbToLinear(this.clamp(value, -72, 12));
    }


    private getClipPlaybackProfile(track: Track, clip: Clip): {
        clipOriginalBpm: number;
        clipTransposeSemitones: number;
        totalSemitones: number;
        clipPlaybackRate: number;
        transposeMult: number;
        granularRate: number;
        nativeRate: number;
    } {
        const clipOriginalBpm = Math.max(1, this.finiteOr(clip.originalBpm ?? 120, 120));
        const clipTransposeSemitones = this.finiteOr(track.transpose, 0) + this.finiteOr(clip.transpose ?? 0, 0);
        const totalSemitones = this.masterTransposeSemitones + clipTransposeSemitones;
        const clipPlaybackRate = this.clamp(this.finiteOr(clip.playbackRate, 1), 0.25, 4);
        const transposeMult = Math.pow(2, totalSemitones / 12);
        const bpmRatio = this.currentBpm / clipOriginalBpm;
        const granularRate = bpmRatio * clipPlaybackRate;

        return {
            clipOriginalBpm,
            clipTransposeSemitones,
            totalSemitones,
            clipPlaybackRate,
            transposeMult,
            granularRate,
            nativeRate: granularRate * transposeMult
        };
    }

    private buildMixEvaluationContext(tracks: Track[]): MixEvaluationContext {
        const tracksById = new Map(tracks.map((track) => [track.id, track]));
        const effectiveSoloMap = new Map<string, boolean>();

        tracks.forEach((track) => {
            const vcaTrack = track.vcaGroupId ? tracksById.get(track.vcaGroupId) : undefined;
            effectiveSoloMap.set(track.id, Boolean(track.isSoloed || vcaTrack?.isSoloed));
        });

        const anySolo = tracks.some((track) => effectiveSoloMap.get(track.id));

        return {
            tracksById,
            effectiveSoloMap,
            anySolo
        };
    }

    private evaluateTrackGainState(track: Track, context: MixEvaluationContext): {
        shouldApplyVca: boolean;
        vcaTrack?: Track;
        isVcaMuted: boolean;
        blockedBySolo: boolean;
    } {
        const vcaTrack = track.vcaGroupId ? context.tracksById.get(track.vcaGroupId) : undefined;
        const shouldApplyVca = Boolean(vcaTrack && vcaTrack.id !== track.id && vcaTrack.id !== track.groupId);
        const isVcaMuted = shouldApplyVca ? Boolean(vcaTrack?.isMuted) : false;
        const isEffectivelySoloed = Boolean(context.effectiveSoloMap.get(track.id));
        const blockedBySolo = context.anySolo && !isEffectivelySoloed && !track.soloSafe;

        return {
            shouldApplyVca,
            vcaTrack,
            isVcaMuted,
            blockedBySolo
        };
    }

    private collectAutomationBarTimes(...tracks: (Track | undefined)[]): number[] {
        const times = new Set<number>([1]);

        tracks.forEach((track) => {
            if (!track?.automationLanes) return;
            track.automationLanes.forEach((lane) => {
                lane.points.forEach((point) => {
                    if (Number.isFinite(point.time) && point.time >= 1) {
                        times.add(point.time);
                    }
                });
            });
        });

        return Array.from(times).sort((a, b) => a - b);
    }

    private getClipGain(clip: Clip): number {
        const gain = clip.gain ?? 1;
        return this.clamp(gain, 0, 2);
    }

    private applyClipEnvelope(gainNode: GainNode, clip: Clip, playAt: number, duration: number, bpm: number) {
        const targetGain = this.getClipGain(clip);
        const fadeInSeconds = Math.max(0, clip.fadeIn || 0) * (60 / bpm) * 4;
        const fadeOutSeconds = Math.max(0, clip.fadeOut || 0) * (60 / bpm) * 4;

        const safeFadeIn = Math.min(fadeInSeconds, duration);
        const safeFadeOut = Math.min(fadeOutSeconds, Math.max(0, duration - safeFadeIn));
        const fadeOutStart = playAt + Math.max(0, duration - safeFadeOut);

        gainNode.gain.cancelScheduledValues(playAt);
        gainNode.gain.setValueAtTime(safeFadeIn > 0 ? 0 : targetGain, playAt);

        if (safeFadeIn > 0) {
            gainNode.gain.linearRampToValueAtTime(targetGain, playAt + safeFadeIn);
        }

        if (safeFadeOut > 0) {
            gainNode.gain.setValueAtTime(targetGain, fadeOutStart);
            gainNode.gain.linearRampToValueAtTime(0, playAt + duration);
        }
    }

    private normalizeParamName(name: string): string {
        return name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
    }

    private createDeviceSignature(devices: Device[]): string {
        return devices
            .map((device) => {
                const paramKeys = device.params.map((param) => this.normalizeParamName(param.name)).join(',');
                return `${device.id}:${device.type}:${paramKeys}`;
            })
            .join('|');
    }

    private createAudioParamSetter(
        param: AudioParam,
        transform: (value: number) => number = (value) => value
    ): (value: number, immediate?: boolean) => void {
        return (value, immediate = false) => {
            const target = transform(value);
            const now = this.ctx?.currentTime ?? 0;
            if (immediate) {
                param.setValueAtTime(target, now);
                return;
            }
            param.setTargetAtTime(target, now, 0.03);
        };
    }

    private getDefaultReverbImpulse(context: BaseAudioContext): AudioBuffer {
        if (this.defaultReverbImpulse && this.defaultReverbImpulse.sampleRate === context.sampleRate) {
            return this.defaultReverbImpulse;
        }

        const length = Math.floor(context.sampleRate * 1.8);
        const impulse = context.createBuffer(2, length, context.sampleRate);

        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const data = impulse.getChannelData(channel);
            for (let i = 0; i < length; i++) {
                const decay = Math.pow(1 - (i / length), 2.6);
                data[i] = ((Math.random() * 2) - 1) * decay;
            }
        }

        this.defaultReverbImpulse = impulse;
        return impulse;
    }

    private createPassThroughRuntime(): DeviceRuntime {
        const pass = this.ctx!.createGain();
        pass.gain.value = 1;
        return {
            input: pass,
            output: pass,
            paramSetters: new Map()
        };
    }

    private createEqRuntime(): DeviceRuntime {
        const low = this.ctx!.createBiquadFilter();
        const mid = this.ctx!.createBiquadFilter();
        const high = this.ctx!.createBiquadFilter();

        low.type = 'lowshelf';
        low.frequency.value = 180;

        mid.type = 'peaking';
        mid.frequency.value = 1000;
        mid.Q.value = 1.1;

        high.type = 'highshelf';
        high.frequency.value = 5000;

        low.connect(mid);
        mid.connect(high);

        const paramSetters = new Map<string, (value: number, immediate?: boolean) => void>();
        const lowSetter = this.createAudioParamSetter(low.gain, (value) => this.clamp(value, -24, 24));
        const midSetter = this.createAudioParamSetter(mid.gain, (value) => this.clamp(value, -24, 24));
        const highSetter = this.createAudioParamSetter(high.gain, (value) => this.clamp(value, -24, 24));
        const midFreqSetter = this.createAudioParamSetter(mid.frequency, (value) => this.clamp(value, 120, 8000));

        paramSetters.set('ganancia baja', lowSetter);
        paramSetters.set('low gain', lowSetter);
        paramSetters.set('ganancia media', midSetter);
        paramSetters.set('mid gain', midSetter);
        paramSetters.set('ganancia alta', highSetter);
        paramSetters.set('high gain', highSetter);
        paramSetters.set('frec media', midFreqSetter);
        paramSetters.set('mid freq', midFreqSetter);
        paramSetters.set('frecuencia media', midFreqSetter);

        return {
            input: low,
            output: high,
            paramSetters
        };
    }

    private createDelayRuntime(): DeviceRuntime {
        const input = this.ctx!.createGain();
        const output = this.ctx!.createGain();
        const dry = this.ctx!.createGain();
        const wet = this.ctx!.createGain();
        const delay = this.ctx!.createDelay(2.5);
        const feedback = this.ctx!.createGain();

        input.connect(dry);
        dry.connect(output);

        input.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(wet);
        wet.connect(output);

        const timeSetter = this.createAudioParamSetter(delay.delayTime, (value) => this.clamp(value, 0.01, 2));
        const feedbackSetter = this.createAudioParamSetter(feedback.gain, (value) => this.clamp(value, 0, 0.96));
        const mixSetter = (value: number, immediate = false) => {
            const normalized = this.clamp(value > 1 ? value / 100 : value, 0, 1);
            const now = this.ctx?.currentTime ?? 0;
            if (immediate) {
                wet.gain.setValueAtTime(normalized, now);
                dry.gain.setValueAtTime(1 - normalized, now);
                return;
            }
            wet.gain.setTargetAtTime(normalized, now, 0.03);
            dry.gain.setTargetAtTime(1 - normalized, now, 0.03);
        };

        const paramSetters = new Map<string, (value: number, immediate?: boolean) => void>();
        paramSetters.set('time', timeSetter);
        paramSetters.set('delay time', timeSetter);
        paramSetters.set('feedback', feedbackSetter);
        paramSetters.set('mix', mixSetter);
        paramSetters.set('seco/humedo', mixSetter);
        paramSetters.set('dry/wet', mixSetter);

        return {
            input,
            output,
            paramSetters,
            cleanup: () => {
                try { feedback.disconnect(); } catch {
                    // already disconnected
                }
            }
        };
    }

    private createReverbRuntime(): DeviceRuntime {
        const input = this.ctx!.createGain();
        const output = this.ctx!.createGain();
        const dry = this.ctx!.createGain();
        const wet = this.ctx!.createGain();
        const convolver = this.ctx!.createConvolver();

        convolver.buffer = this.getDefaultReverbImpulse(this.ctx!);

        input.connect(dry);
        dry.connect(output);

        input.connect(convolver);
        convolver.connect(wet);
        wet.connect(output);

        const mixSetter = (value: number, immediate = false) => {
            const normalized = this.clamp(value > 1 ? value / 100 : value, 0, 1);
            const now = this.ctx?.currentTime ?? 0;
            if (immediate) {
                wet.gain.setValueAtTime(normalized, now);
                dry.gain.setValueAtTime(1 - normalized, now);
                return;
            }
            wet.gain.setTargetAtTime(normalized, now, 0.03);
            dry.gain.setTargetAtTime(1 - normalized, now, 0.03);
        };

        const paramSetters = new Map<string, (value: number, immediate?: boolean) => void>();
        paramSetters.set('mix', mixSetter);
        paramSetters.set('seco/humedo', mixSetter);
        paramSetters.set('dry/wet', mixSetter);
        paramSetters.set('wet', mixSetter);

        return {
            input,
            output,
            paramSetters,
            cleanup: () => {
                try { convolver.disconnect(); } catch {
                    // already disconnected
                }
            }
        };
    }

    private createDeviceRuntime(device: Device): DeviceRuntime {
        const normalizedType = device.type.toLowerCase();
        const normalizedName = this.normalizeParamName(device.name);

        let runtime: DeviceRuntime;

        if (device.type === 'eq') {
            runtime = this.createEqRuntime();
        } else if (normalizedName.includes('delay')) {
            runtime = this.createDelayRuntime();
        } else if (normalizedName.includes('reverb')) {
            runtime = this.createReverbRuntime();
        } else if (normalizedType === 'effect') {
            runtime = this.createPassThroughRuntime();
            const gainSetter = this.createAudioParamSetter((runtime.output as GainNode).gain, (value) => {
                const normalized = value > 1 ? value / 100 : value;
                return this.clamp(normalized, 0, 2);
            });
            runtime.paramSetters.set('mix', gainSetter);
            runtime.paramSetters.set('gain', gainSetter);
            runtime.paramSetters.set('amount', gainSetter);
        } else {
            runtime = this.createPassThroughRuntime();
        }

        device.params.forEach((param) => {
            const key = this.normalizeParamName(param.name);
            const setter = runtime.paramSetters.get(key);
            if (setter) {
                setter(param.value, true);
            }
        });

        return runtime;
    }

    private rebuildTrackEffects(trackId: string, devices: Device[]) {
        const trackGraph = this.trackNodes.get(trackId);
        if (!trackGraph) return;

        try {
            trackGraph.input.disconnect();
        } catch {
            // no previous connections to clear
        }

        trackGraph.deviceRuntimes.forEach((runtime) => {
            try { runtime.input.disconnect(); } catch {
                // already disconnected
            }
            if (runtime.output !== runtime.input) {
                try { runtime.output.disconnect(); } catch {
                    // already disconnected
                }
            }
            runtime.cleanup?.();
        });
        trackGraph.deviceRuntimes.clear();

        let chainHead: AudioNode = trackGraph.input;
        const effectDevices = devices.filter((device) => device.type !== 'instrument');

        effectDevices.forEach((device) => {
            const runtime = this.createDeviceRuntime(device);
            chainHead.connect(runtime.input);
            chainHead = runtime.output;
            trackGraph.deviceRuntimes.set(device.id, runtime);
        });

        chainHead.connect(trackGraph.preSendTap);
    }

    getSettings(): AudioSettings {
        return { ...this.settings };
    }

    setAudioConfiguration(newSettings: AudioSettings) {
        const prevOutputDeviceId = this.settings.outputDeviceId;
        const prevSampleRate = this.ctx?.sampleRate ?? this.settings.sampleRate;
        const prevBufferSize = this.settings.bufferSize;
        this.settings = { ...this.settings, ...newSettings };

        const sampleRateChanged = Boolean(this.ctx && newSettings.sampleRate && newSettings.sampleRate !== prevSampleRate);
        const bufferSizeChanged = typeof newSettings.bufferSize !== 'undefined' && newSettings.bufferSize !== prevBufferSize;

        // Sample rate and numeric latency targets are creation-time settings for AudioContext.
        if (this.ctx && (sampleRateChanged || bufferSizeChanged)) {
            if (this._isRestarting) {
                console.log(`[AudioEngine.setAudioConfiguration] Engine already restarting — skipping duplicate restart.`);
                return;
            }
            const restartReasons: string[] = [];
            if (sampleRateChanged) restartReasons.push(`sampleRate ${prevSampleRate}Hz → ${this.settings.sampleRate}Hz`);
            if (bufferSizeChanged) restartReasons.push(`bufferSize ${String(prevBufferSize)} → ${String(this.settings.bufferSize)}`);
            console.log(`[AudioEngine.setAudioConfiguration] ${restartReasons.join(', ')} — restarting engine.`);
            void this.restartEngine(this.settings);
            return; // restartEngine handles everything including output device
        }

        if (bufferSizeChanged || typeof newSettings.latencyHint === 'string') {
            this.applyRuntimeBufferStrategy();
        }

        if (prevOutputDeviceId !== this.settings.outputDeviceId) {
            void this.applyOutputDevicePreference();
        }
    }

    private async applyOutputDevicePreference() {
        if (!this.ctx) return;

        const sinkCapableContext = this.ctx as AudioContextWithSink;
        if (typeof sinkCapableContext.setSinkId !== 'function') {
            return;
        }

        const requestedOutput = (this.settings.outputDeviceId || '').trim();
        const sinkId = this.forceSystemOutput ? '' : (requestedOutput || '');

        try {
            await sinkCapableContext.setSinkId(sinkId);
            this.outputFallbackApplied = false;

            if (this.forceSystemOutput && requestedOutput) {
                this.settings = { ...this.settings, outputDeviceId: undefined };
                console.warn('Output device custom desactivado temporalmente para priorizar salida de sistema.');
            }
        } catch (error) {
            console.warn(`No se pudo aplicar output device '${requestedOutput || 'default'}'.`, error);

            if (!requestedOutput) {
                return;
            }

            if (this.outputFallbackApplied) {
                return;
            }

            this.outputFallbackApplied = true;

            try {
                await sinkCapableContext.setSinkId('');
                this.settings = { ...this.settings, outputDeviceId: undefined };
                console.warn('Se aplico fallback al output de sistema por seguridad.');
            } catch (fallbackError) {
                console.error('Fallback a output default tambien fallo.', fallbackError);
            }
        }
    }

    private getMasterGainTargetLinear(): number {
        const safeMasterDb = this.finiteOr(this.masterVolumeDb, 0);
        const base = this.dbToLinear(safeMasterDb);
        const safeBase = Number.isFinite(base) ? base : 1;
        if (this.cueTrackId && this.cueMode) {
            return safeBase * this.cueDimFactor;
        }
        return safeBase;
    }

    private syncCueRouting() {
        if (!this.ctx || !this.masterGain || !this.cueGain) return;

        const now = this.ctx.currentTime;

        if (this.cueSourceNode) {
            try {
                this.cueSourceNode.disconnect(this.cueGain);
            } catch {
                // already disconnected
            }
            this.cueSourceNode = null;
        }

        if (!this.cueTrackId || !this.cueMode) {
            this.cueGain.gain.setTargetAtTime(0, now, 0.01);
            this.masterGain.gain.setTargetAtTime(this.getMasterGainTargetLinear(), now, 0.02);
            return;
        }

        const trackNodes = this.trackNodes.get(this.cueTrackId);
        if (!trackNodes) {
            this.cueTrackId = null;
            this.cueMode = null;
            this.cueGain.gain.setTargetAtTime(0, now, 0.01);
            this.masterGain.gain.setTargetAtTime(this.getMasterGainTargetLinear(), now, 0.02);
            return;
        }

        const sourceNode = this.cueMode === 'pfl' ? trackNodes.preSendTap : trackNodes.panner;
        sourceNode.connect(this.cueGain);
        this.cueSourceNode = sourceNode;

        this.cueGain.gain.setTargetAtTime(1, now, 0.01);
        this.masterGain.gain.setTargetAtTime(this.getMasterGainTargetLinear(), now, 0.02);
    }

    setCueMonitor(trackId: string | null, mode: 'pfl' | 'afl' | null) {
        if (!trackId || !mode) {
            this.cueTrackId = null;
            this.cueMode = null;
            this.syncCueRouting();
            return;
        }

        this.cueTrackId = trackId;
        this.cueMode = mode;
        this.syncCueRouting();
    }

    getCueMonitor(): { trackId: string | null; mode: 'pfl' | 'afl' | null } {
        return {
            trackId: this.cueTrackId,
            mode: this.cueMode
        };
    }

    clearCueMonitor() {
        this.setCueMonitor(null, null);
    }

    setMasterVolumeDb(volumeDb: number) {
        const safeVolumeDb = this.finiteOr(volumeDb, 0);
        this.masterVolumeDb = this.clamp(safeVolumeDb, -60, 6);
        if (!this.masterGain || !this.ctx) return;

        this.masterGain.gain.setTargetAtTime(this.getMasterGainTargetLinear(), this.ctx.currentTime, 0.02);
    }

    getMasterVolumeDb(): number {
        return this.masterVolumeDb;
    }

    async restartEngine(newSettings?: AudioSettings): Promise<void> {
        if (this._isRestarting) {
            console.warn('[AudioEngine.restartEngine] Already restarting — skipping concurrent call.');
            return;
        }
        this._isRestarting = true;

        try {
            if (newSettings) {
                this.settings = { ...this.settings, ...newSettings };
            }

            this.stop(true);

            if (this.schedulerTimer) {
                window.clearInterval(this.schedulerTimer);
                this.schedulerTimer = null;
            }

            this.stopPlayback();

            this.recordingSessions.forEach((session) => {
                if (session.mediaRecorder.state !== 'inactive') {
                    try { session.mediaRecorder.stop(); } catch {
                        // already stopping/stopped
                    }
                }
                session.stream.getTracks().forEach((track) => track.stop());
            });
            this.recordingSessions.clear();

            this.monitoringSessions.forEach((_session, trackId) => {
                this.stopMonitoring(trackId);
            });

            this.trackNodes.forEach((nodes) => {
                nodes.deviceRuntimes.forEach((runtime) => {
                    runtime.cleanup?.();
                });
                nodes.sendGains.forEach((sendGain) => {
                    try { sendGain.disconnect(); } catch {
                        // already disconnected
                    }
                });
                try { nodes.reverb.disconnect(); } catch { }
                try { nodes.reverbGain.disconnect(); } catch { }
                try { nodes.panner.disconnect(); } catch { }
                try { nodes.gain.disconnect(); } catch { }
                try { nodes.preSendTap.disconnect(); } catch { }
                try { nodes.input.disconnect(); } catch { }
            });

            if (this.cueSourceNode && this.cueGain) {
                try {
                    this.cueSourceNode.disconnect(this.cueGain);
                } catch {
                    // already disconnected
                }
            }
            this.cueSourceNode = null;
            this.cueTrackId = null;
            this.cueMode = null;

            this.trackNodes.clear();
            this.trackDeviceSignatures.clear();
            this.analysers.clear();
            this.analyserBuffers.clear();
            this.trackMeterState.clear();
            this.trackClipHoldState.clear();
            this.masterMeterState = { rmsDb: -72, peakDb: -72 };
            this.masterClipHold = false;
            this.masterGain = null;
            this.masterOutput = null;
            this.masterAnalyser = null;
            this.masterAnalyserBuffer = null;
            this.cueGain = null;
            this.limiter = null;
            this.defaultReverbImpulse = null;

            if (this.ctx) {
                try {
                    await this.ctx.close();
                } catch {
                    // context might already be closing/closed
                }
            }

            this.ctx = null;
            console.log(`[AudioEngine.restartEngine] Context closed + nulled. Calling init() with sampleRate: ${this.settings.sampleRate}Hz`);
            await this.init(this.settings);

            if (this.currentTracksSnapshot.length > 0) {
                this.updateTracks(this.currentTracksSnapshot);
            }
        } finally {
            this._isRestarting = false;
        }
    }

    async requestMicAccess(deviceId?: string): Promise<boolean> {
        if (this.inputStream) {
            this.disableMicAccess();
        }

        try {
            this.inputStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false
                }
            });
            return true;
        } catch (e) {
            console.error("Failed to get mic access", e);
            return false;
        }
    }

    disableMicAccess() {
        if (this.inputStream) {
            this.inputStream.getTracks().forEach(t => t.stop());
            this.inputStream = null;
        }
        // Disconnect all input nodes
        this.inputNodes.forEach(node => {
            try { node.disconnect(); } catch { }
        });
        this.inputNodes.clear();
    }

    async getAvailableDevices(): Promise<{ inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[] }> {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return { inputs: [], outputs: [] };
        }

        try {
            // Request permission first to get labels
            // await navigator.mediaDevices.getUserMedia({ audio: true }); 
            // ^ Skipping auto-permission request to avoid popup spam on boot, 
            // will only get labels if permission already granted.

            const devices = await navigator.mediaDevices.enumerateDevices();
            return {
                inputs: devices.filter(d => d.kind === 'audioinput'),
                outputs: devices.filter(d => d.kind === 'audiooutput')
            };
        } catch (e) {
            console.error("Device enumeration failed", e);
            return { inputs: [], outputs: [] };
        }
    }

    async init(settings?: AudioSettings) {
        if (settings) this.settings = { ...this.settings, ...settings };
        this.applyRuntimeBufferStrategy();

        // 0. Initialize Context if missing
        if (!this.ctx) {
            const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            this.ctx = new AudioContextClass({
                latencyHint: this.effectiveLatencyHint,
                sampleRate: this.settings.sampleRate
            });
            console.log(`[AudioEngine.init] Created AudioContext — requested: ${this.settings.sampleRate}Hz, actual: ${this.ctx.sampleRate}Hz, state: ${this.ctx.state}`);
            if (this.ctx.sampleRate !== this.settings.sampleRate) {
                console.warn(`[AudioEngine.init] ⚠ Browser did NOT honor requested sample rate. Requested ${this.settings.sampleRate}Hz, got ${this.ctx.sampleRate}Hz.`);
            }
            this.applyRuntimeBufferStrategy();
        } else {
            console.log(`[AudioEngine.init] Context already exists — sampleRate: ${this.ctx.sampleRate}Hz, state: ${this.ctx.state}`);
            this.applyRuntimeBufferStrategy();
        }

        await this.applyOutputDevicePreference();

        // 1. Initialize Master Graph if missing
        if (!this.masterGain) {
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.getMasterGainTargetLinear();
            this.masterOutput = this.masterGain;

            this.masterAnalyser = this.ctx.createAnalyser();
            this.masterAnalyser.fftSize = 2048;
            this.masterAnalyser.smoothingTimeConstant = 0.8;

            this.cueGain = this.ctx.createGain();
            this.cueGain.gain.value = 0;

            // 2. Initialize Safety Limiter
            // At very high sample rates (≥176.4kHz), DynamicsCompressorNode can
            // produce silence in some browser implementations. Use a simple
            // passthrough GainNode as a fallback to guarantee audio output.
            const sampleRate = this.ctx.sampleRate;
            if (sampleRate >= 176400) {
                console.warn(`[AudioEngine] High sample rate (${sampleRate}Hz) detected — bypassing DynamicsCompressorNode limiter to prevent silence.`);
                this.limiter = this.ctx.createGain();
                (this.limiter as GainNode).gain.value = 1.0;
            } else {
                const compressor = this.ctx.createDynamicsCompressor();
                compressor.threshold.value = -1.0;
                compressor.knee.value = 12;
                compressor.ratio.value = 20;
                compressor.attack.value = 0.002;
                compressor.release.value = 0.25;
                this.limiter = compressor;
            }

            // Reliable output path:
            // Master -> Limiter -> Destination
            // Cue    -> Destination (bypass limiter)

            // Connect Master to Analyser for viz
            this.masterGain.connect(this.masterAnalyser);
            // Connect Master to Limiter
            this.masterGain.connect(this.limiter);
            // Connect Limiter to Destination
            this.limiter.connect(this.ctx.destination);

            // Connect Cue directly to destination
            this.cueGain.connect(this.ctx.destination);
            // Also visualize cue
            this.cueGain.connect(this.masterAnalyser);

            // 2. Load Worklets
            try {
                await this.ctx.audioWorklet.addModule('./worklets/granular-processor.js');
                console.log("Granular Processor Loaded");
            } catch (e) {
                console.error("Failed to load Granular Processor", e);
            }

            // Resume if suspended (user gesture requirement)
            if (this.ctx.state !== 'running') {
                const unlock = () => {
                    void this.ctx?.resume();
                    window.removeEventListener('click', unlock);
                    window.removeEventListener('keydown', unlock);
                };
                window.addEventListener('click', unlock);
                window.addEventListener('keydown', unlock);
            }
        }
    }

    // --- TRACK MANAGEMENT ---

    private applyMicMonitoringProfile(track: Track, session: MonitoringSession) {
        const profile = track.micSettings?.profile || 'studio-voice';
        const now = this.ctx!.currentTime;

        const profileInputGain = profile === 'podcast' ? 1.1 : profile === 'raw' ? 1 : 1.25;
        const profileReverb = profile === 'raw' ? 0.08 : profile === 'podcast' ? 0.14 : 0.2;
        const profileEchoWet = profile === 'raw' ? 0.05 : profile === 'podcast' ? 0.12 : 0.09;
        const profileEchoFeedback = profile === 'raw' ? 0.14 : profile === 'podcast' ? 0.2 : 0.16;

        const userInputGain = this.clamp(this.finiteOr(track.micSettings?.inputGain ?? 1, 1), 0, 2);
        const monitoringEnabled = Boolean(track.micSettings?.monitoringEnabled) && track.monitor !== 'off';
        const monitorReverbOn = Boolean(track.micSettings?.monitoringReverb);
        const monitorEchoOn = Boolean(track.micSettings?.monitoringEcho);

        session.inputGain.gain.setTargetAtTime(profileInputGain * userInputGain, now, 0.015);
        session.monitorGate.gain.setTargetAtTime(monitoringEnabled ? 1 : 0, now, 0.01);
        session.reverbSend.gain.setTargetAtTime(monitoringEnabled && monitorReverbOn ? profileReverb : 0, now, 0.02);
        session.echoWet.gain.setTargetAtTime(monitoringEnabled && monitorEchoOn ? profileEchoWet : 0, now, 0.02);
        session.echoFeedback.gain.setTargetAtTime(monitoringEnabled && monitorEchoOn ? profileEchoFeedback : 0, now, 0.03);
    }

    private async startMonitoring(track: Track) {
        if (!this.ctx || !this.masterGain) return;
        if (this.monitoringSessions.has(track.id)) {
            const session = this.monitoringSessions.get(track.id);
            if (session) this.applyMicMonitoringProfile(track, session);
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: track.inputDeviceId ? { exact: track.inputDeviceId } : undefined,
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false
                }
            });

            const source = this.ctx.createMediaStreamSource(stream);
            const inputGain = this.ctx.createGain();
            const monitorGate = this.ctx.createGain();
            const reverbSend = this.ctx.createGain();
            const reverbConvolver = this.ctx.createConvolver();
            reverbConvolver.buffer = this.getDefaultReverbImpulse(this.ctx);
            const echoDelay = this.ctx.createDelay(2.5);
            echoDelay.delayTime.value = 0.22;
            const echoFeedback = this.ctx.createGain();
            const echoWet = this.ctx.createGain();

            source.connect(inputGain);
            inputGain.connect(monitorGate);
            monitorGate.connect(this.masterGain);

            monitorGate.connect(reverbSend);
            reverbSend.connect(reverbConvolver);
            reverbConvolver.connect(this.masterGain);

            monitorGate.connect(echoDelay);
            echoDelay.connect(echoFeedback);
            echoFeedback.connect(echoDelay);
            echoDelay.connect(echoWet);
            echoWet.connect(this.masterGain);

            const session: MonitoringSession = {
                stream,
                source,
                inputGain,
                monitorGate,
                reverbSend,
                reverbConvolver,
                echoDelay,
                echoFeedback,
                echoWet
            };

            this.monitoringSessions.set(track.id, session);
            this.applyMicMonitoringProfile(track, session);
        } catch (error) {
            console.error('Mic monitoring failed', error);
        }
    }

    private stopMonitoring(trackId: string) {
        const session = this.monitoringSessions.get(trackId);
        if (!session) return;

        if (!this.recordingSessions.has(trackId)) {
            session.stream.getTracks().forEach((streamTrack) => streamTrack.stop());
        }

        const nodes: AudioNode[] = [
            session.source,
            session.inputGain,
            session.monitorGate,
            session.reverbSend,
            session.reverbConvolver,
            session.echoDelay,
            session.echoFeedback,
            session.echoWet
        ];

        nodes.forEach((node) => {
            try { node.disconnect(); } catch {
                // already disconnected
            }
        });

        this.monitoringSessions.delete(trackId);
    }

    private syncMonitoringSessions(tracks: Track[]) {
        const eligibleTrackIds = new Set(
            tracks
                .filter((track) => track.type === TrackType.AUDIO && Boolean(track.micSettings?.monitoringEnabled) && track.monitor !== 'off')
                .map((track) => track.id)
        );

        this.monitoringSessions.forEach((_session, trackId) => {
            if (!eligibleTrackIds.has(trackId)) {
                this.stopMonitoring(trackId);
            }
        });

        tracks.forEach((track) => {
            if (!eligibleTrackIds.has(track.id)) return;
            if (this.monitoringSessions.has(track.id)) {
                const existing = this.monitoringSessions.get(track.id);
                if (existing) this.applyMicMonitoringProfile(track, existing);
                return;
            }
            void this.startMonitoring(track);
        });
    }

    updateTracks(tracks: Track[]) {
        if (!this.ctx || !this.masterGain) return;

        const safeTracks = tracks.map((track) => this.sanitizeTrack(track));
        this.currentTracksSnapshot = safeTracks;

        const now = this.ctx.currentTime;
        const activeTrackIds = new Set(safeTracks.map((track) => track.id));
        const mixContext = this.buildMixEvaluationContext(safeTracks);
        const returnTrackIds = safeTracks
            .filter((track) => track.type === TrackType.RETURN)
            .map((track) => track.id);
        const returnTrackIdSet = new Set(returnTrackIds);
        const groupTrackIds = safeTracks
            .filter((track) => track.type === TrackType.GROUP)
            .map((track) => track.id);
        const groupTrackIdSet = new Set(groupTrackIds);

        this.trackNodes.forEach((nodes, trackId) => {
            if (activeTrackIds.has(trackId)) return;

            this.trackNodes.forEach((candidateNodes) => {
                if (candidateNodes.outputTargetGroupId !== trackId) return;

                try {
                    candidateNodes.panner.disconnect(nodes.input);
                } catch {
                    // already disconnected
                }
                candidateNodes.panner.connect(this.masterGain!);
                candidateNodes.outputTargetGroupId = null;
            });

            const analyser = this.analysers.get(trackId);
            try {
                analyser?.disconnect();
                nodes.reverb.disconnect();
                nodes.reverbGain.disconnect();
                nodes.panner.disconnect();
                nodes.gain.disconnect();
                nodes.preSendTap.disconnect();
                nodes.input.disconnect();
            } catch {
                // no-op cleanup guard
            }

            nodes.sendGains.forEach((sendGain) => {
                try { sendGain.disconnect(); } catch {
                    // already disconnected
                }
            });
            nodes.sendModes.clear();

            nodes.deviceRuntimes.forEach((runtime) => {
                runtime.cleanup?.();
            });

            this.trackNodes.delete(trackId);
            this.trackDeviceSignatures.delete(trackId);
            this.analysers.delete(trackId);
            this.analyserBuffers.delete(trackId);
            this.trackMeterState.delete(trackId);
            this.trackClipHoldState.delete(trackId);
        });

        if (this.cueTrackId && !activeTrackIds.has(this.cueTrackId)) {
            this.cueTrackId = null;
            this.cueMode = null;
        }

        // Diff-like approach: create nodes for new tracks, update existing
        safeTracks.forEach((track) => {
            let nodes = this.trackNodes.get(track.id);

            if (!nodes) {
                const input = this.ctx!.createGain();
                input.gain.value = 1;
                const preSendTap = this.ctx!.createGain();
                preSendTap.gain.value = 1;

                // Create Chain: Source -> FX Chain -> Gain (Vol) -> Panner -> Master
                const gain = this.ctx!.createGain();
                const panner = this.ctx!.createStereoPanner();

                // Reverb Send (Parallel Chain)
                // Post-fader: Gain -> ReverbGain -> ReverbConvolver -> Master
                const reverbGain = this.ctx!.createGain();
                const reverb = this.ctx!.createConvolver();
                reverb.buffer = this.getDefaultReverbImpulse(this.ctx!);

                // Wiring
                input.connect(preSendTap);
                preSendTap.connect(gain);
                gain.connect(panner);
                panner.connect(this.masterGain!);

                gain.connect(reverbGain);
                reverbGain.connect(reverb);
                reverb.connect(this.masterGain!);

                // Analyser tap (Post-Fader)
                const analyser = this.ctx!.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.18;
                panner.connect(analyser);
                this.analysers.set(track.id, analyser);

                nodes = {
                    input,
                    preSendTap,
                    gain,
                    panner,
                    reverb,
                    reverbGain,
                    sendGains: new Map(),
                    sendModes: new Map(),
                    outputTargetGroupId: null,
                    deviceRuntimes: new Map()
                };
                this.trackNodes.set(track.id, nodes);
            }

            if (!nodes) return;

            // Determine Effective Volume
            // If track is Muted -> 0
            // If any track is Soloed AND this track is NOT Soloed -> 0
            // Else -> Volume
            const gainState = this.evaluateTrackGainState(track, mixContext);
            const trackVolumeDb = this.finiteOr(track.volume, 0);
            const vcaVolumeDb = gainState.shouldApplyVca ? this.finiteOr(gainState.vcaTrack!.volume, 0) : 0;
            const vcaGainLinear = gainState.shouldApplyVca ? this.dbToLinear(vcaVolumeDb) : 1;

            let targetGain = this.dbToLinear(trackVolumeDb) * vcaGainLinear;
            if (track.isMuted || gainState.isVcaMuted || gainState.blockedBySolo) {
                targetGain = 0;
            }

            const safeTargetGain = Number.isFinite(targetGain) ? targetGain : 0;
            const safePan = this.finiteOr(track.pan, 0);
            const safeReverb = this.finiteOr(track.reverb || 0, 0);

            nodes.gain.gain.setTargetAtTime(safeTargetGain, now, 0.02);
            nodes.panner.pan.setTargetAtTime(this.normalizePan(safePan), now, 0.02);

            // Reverb Parameter (Input 0-1 or dB)
            // Assuming track.reverb is a 0-1 send level.
            nodes.reverbGain.gain.setTargetAtTime(this.normalizeReverbSend(safeReverb), now, 0.02);

            const nextSignature = this.createDeviceSignature(track.devices);
            if (this.trackDeviceSignatures.get(track.id) !== nextSignature) {
                this.rebuildTrackEffects(track.id, track.devices);
                this.trackDeviceSignatures.set(track.id, nextSignature);
            }

            // Input Routing (Microphone)
            if (this.inputStream && (track.monitor === 'in' || (track.monitor === 'auto' && track.isArmed))) {
                let inputNode = this.inputNodes.get(track.id);
                if (!inputNode) {
                    inputNode = this.ctx!.createMediaStreamSource(this.inputStream);
                    this.inputNodes.set(track.id, inputNode);
                }

                // Ensure fresh connection
                try { inputNode.disconnect(); } catch { }
                inputNode.connect(nodes.input);
            } else {
                const inputNode = this.inputNodes.get(track.id);
                if (inputNode) {
                    try { inputNode.disconnect(); } catch { }
                }
            }
        });

        safeTracks.forEach((track) => {
            const sourceNodes = this.trackNodes.get(track.id);
            if (!sourceNodes) return;

            sourceNodes.sendGains.forEach((sendGain, targetTrackId) => {
                if (track.type === TrackType.RETURN || !returnTrackIdSet.has(targetTrackId)) {
                    try { sourceNodes.preSendTap.disconnect(sendGain); } catch {
                        // already disconnected
                    }
                    try { sourceNodes.panner.disconnect(sendGain); } catch {
                        // already disconnected
                    }
                    try { sendGain.disconnect(); } catch {
                        // already disconnected
                    }
                    sourceNodes.sendGains.delete(targetTrackId);
                    sourceNodes.sendModes.delete(targetTrackId);
                }
            });

            if (track.type === TrackType.RETURN) {
                return;
            }

            const hasLegacyDbSends = Object.values(track.sends || {}).some((value) => {
                return Number.isFinite(value) && (Number(value) < 0 || Number(value) > 1);
            });

            returnTrackIds.forEach((returnTrackId) => {
                const returnNodes = this.trackNodes.get(returnTrackId);
                if (!returnNodes) return;

                let sendGain = sourceNodes.sendGains.get(returnTrackId);
                if (!sendGain) {
                    sendGain = this.ctx!.createGain();
                    sendGain.gain.value = 0;
                    sendGain.connect(returnNodes.input);
                    sourceNodes.sendGains.set(returnTrackId, sendGain);
                }

                const sendMode: 'pre' | 'post' = track.sendModes?.[returnTrackId] === 'pre' ? 'pre' : 'post';
                if (sourceNodes.sendModes.get(returnTrackId) !== sendMode) {
                    try { sourceNodes.preSendTap.disconnect(sendGain); } catch {
                        // already disconnected
                    }
                    try { sourceNodes.panner.disconnect(sendGain); } catch {
                        // already disconnected
                    }

                    if (sendMode === 'pre') {
                        sourceNodes.preSendTap.connect(sendGain);
                    } else {
                        sourceNodes.panner.connect(sendGain);
                    }

                    sourceNodes.sendModes.set(returnTrackId, sendMode);
                }

                const sendLevel = this.normalizeSendGain(track.sends?.[returnTrackId], hasLegacyDbSends);
                sendGain.gain.setTargetAtTime(sendLevel, now, 0.025);
            });
        });

        safeTracks.forEach((track) => {
            const nodes = this.trackNodes.get(track.id);
            if (!nodes) return;

            const desiredGroupId =
                track.type !== TrackType.RETURN
                    && track.type !== TrackType.GROUP
                    && track.groupId
                    && groupTrackIdSet.has(track.groupId)
                    && track.groupId !== track.id
                    ? track.groupId
                    : null;

            // Disconnect from EVERYTHING to prevent summing
            try { nodes.panner.disconnect(); } catch { }

            // Reconnect Analyser (Post-Panner Tap)
            const analyser = this.analysers.get(track.id);
            if (analyser) {
                nodes.panner.connect(analyser);
            }

            if (desiredGroupId) {
                const groupNodes = this.trackNodes.get(desiredGroupId);
                if (groupNodes) {
                    nodes.panner.connect(groupNodes.input);
                    nodes.outputTargetGroupId = desiredGroupId;
                } else {
                    nodes.panner.connect(this.masterGain!);
                    nodes.outputTargetGroupId = null;
                }
            } else {
                nodes.panner.connect(this.masterGain!);
                nodes.outputTargetGroupId = null;
            }
        });

        this.syncCueRouting();
        this.syncMonitoringSessions(safeTracks);
    }

    // --- TRANSPORT CONTROLS ---



    setLoop(enabled: boolean, start: number, end: number) {
        this.isLooping = enabled;
        this.loopStart = start;
        this.loopEnd = end;
    }

    // --- FX CHAIN MANAGEMENT ---
    reorderEffects(trackId: string, devices: Device[]) {
        if (!this.ctx) return;
        const safeDevices = this.sanitizeDevices(devices);
        this.rebuildTrackEffects(trackId, safeDevices);
        this.trackDeviceSignatures.set(trackId, this.createDeviceSignature(safeDevices));
    }

    updateTrackEffects(trackId: string, devices: Device[]) {
        if (!this.ctx) return;
        const safeDevices = this.sanitizeDevices(devices);
        this.rebuildTrackEffects(trackId, safeDevices);
        this.trackDeviceSignatures.set(trackId, this.createDeviceSignature(safeDevices));
    }

    setDeviceParam(trackId: string, deviceId: string, paramName: string, value: number) {
        const graph = this.trackNodes.get(trackId);
        const runtime = graph?.deviceRuntimes.get(deviceId);
        if (!runtime) return;

        const setter = runtime.paramSetters.get(this.normalizeParamName(paramName));
        if (setter) {
            setter(value, false);
        }
    }

    getTrackMeter(trackId: string): { rmsDb: number; peakDb: number } {
        const analyser = this.analysers.get(trackId);
        if (!analyser) {
            return { rmsDb: -72, peakDb: -72 };
        }

        let data = this.analyserBuffers.get(trackId);
        if (!data || data.length !== analyser.fftSize) {
            data = new Float32Array(analyser.fftSize);
            this.analyserBuffers.set(trackId, data);
        }

        // Cast to any to avoid ArrayBufferLike mismatch in strict TS
        analyser.getFloatTimeDomainData(data as any);

        let sumSquares = 0;
        let peak = 0;

        for (let i = 0; i < data.length; i++) {
            const sample = data[i];
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sumSquares += sample * sample;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, data.length));
        const instantRmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
        const instantPeakDb = 20 * Math.log10(Math.max(peak, 1e-8));
        if (instantPeakDb >= -0.1) {
            this.trackClipHoldState.add(trackId);
        }

        const previous = this.trackMeterState.get(trackId) || { rmsDb: -72, peakDb: -72 };

        const rmsAttack = 0.52;
        const rmsRelease = 0.16;
        const rmsBlend = instantRmsDb > previous.rmsDb ? rmsAttack : rmsRelease;
        const nextRmsDb = previous.rmsDb + ((instantRmsDb - previous.rmsDb) * rmsBlend);

        const peakAttack = 0.9;
        const peakReleaseDbPerFrame = 0.65;
        const nextPeakDb = instantPeakDb > previous.peakDb
            ? previous.peakDb + ((instantPeakDb - previous.peakDb) * peakAttack)
            : Math.max(instantPeakDb, previous.peakDb - peakReleaseDbPerFrame);

        const boundedRms = Math.max(-72, Math.min(6, nextRmsDb));
        const boundedPeak = Math.max(-72, Math.min(6, nextPeakDb));

        this.trackMeterState.set(trackId, {
            rmsDb: boundedRms,
            peakDb: boundedPeak
        });

        return {
            rmsDb: boundedRms,
            peakDb: boundedPeak
        };
    }

    getTrackLevel(trackId: string): number {
        return this.getTrackMeter(trackId).rmsDb;
    }

    getTrackClipHold(trackId: string): boolean {
        return this.trackClipHoldState.has(trackId);
    }

    resetTrackMeter(trackId: string) {
        this.trackMeterState.set(trackId, { rmsDb: -72, peakDb: -72 });
        this.trackClipHoldState.delete(trackId);
    }

    resetAllTrackMeters() {
        this.trackMeterState.clear();
        this.trackClipHoldState.clear();
    }

    getMasterMeter(): { rmsDb: number; peakDb: number } {
        if (!this.masterAnalyser) {
            return { rmsDb: -72, peakDb: -72 };
        }

        if (!this.masterAnalyserBuffer || this.masterAnalyserBuffer.length !== this.masterAnalyser.fftSize) {
            this.masterAnalyserBuffer = new Float32Array(this.masterAnalyser.fftSize);
        }

        // Cast to any to avoid ArrayBufferLike mismatch in strict TS
        this.masterAnalyser.getFloatTimeDomainData(this.masterAnalyserBuffer as any);

        let sumSquares = 0;
        let peak = 0;

        for (let i = 0; i < this.masterAnalyserBuffer.length; i++) {
            const sample = this.masterAnalyserBuffer[i];
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sumSquares += sample * sample;
        }

        const rms = Math.sqrt(sumSquares / Math.max(1, this.masterAnalyserBuffer.length));
        const instantRmsDb = 20 * Math.log10(Math.max(rms, 1e-8));
        const instantPeakDb = 20 * Math.log10(Math.max(peak, 1e-8));
        if (instantPeakDb >= -0.1) {
            this.masterClipHold = true;
        }

        const previous = this.masterMeterState;
        const rmsAttack = 0.55;
        const rmsRelease = 0.14;
        const rmsBlend = instantRmsDb > previous.rmsDb ? rmsAttack : rmsRelease;
        const nextRmsDb = previous.rmsDb + ((instantRmsDb - previous.rmsDb) * rmsBlend);

        const peakAttack = 0.92;
        const peakReleaseDbPerFrame = 0.72;
        const nextPeakDb = instantPeakDb > previous.peakDb
            ? previous.peakDb + ((instantPeakDb - previous.peakDb) * peakAttack)
            : Math.max(instantPeakDb, previous.peakDb - peakReleaseDbPerFrame);

        this.masterMeterState = {
            rmsDb: Math.max(-72, Math.min(6, nextRmsDb)),
            peakDb: Math.max(-72, Math.min(6, nextPeakDb))
        };

        return this.masterMeterState;
    }

    getMasterClipHold(): boolean {
        return this.masterClipHold;
    }

    resetMasterMeter() {
        this.masterMeterState = { rmsDb: -72, peakDb: -72 };
        this.masterClipHold = false;
    }

    resetAllMeters() {
        this.resetAllTrackMeters();
        this.resetMasterMeter();
    }

    getFrequencyData(): Uint8Array {
        if (!this.masterAnalyser) return new Uint8Array(0);
        const data = new Uint8Array(this.masterAnalyser.frequencyBinCount);
        this.masterAnalyser.getByteFrequencyData(data);
        return data;
    }

    getDiagnostics() {
        return {
            sampleRate: this.ctx?.sampleRate || 0,
            latency: this.ctx?.baseLatency || 0,
            state: this.ctx?.state || 'closed',
            configuredBufferSize: this.settings.bufferSize,
            effectiveBufferSize: this.effectiveBufferSize,
            lookaheadMs: this.lookahead,
            scheduleAheadTime: this.scheduleAheadTime,
            schedulerIntervalMs: this.schedulerIntervalMs,
            bufferStrategy: this.bufferStrategy,
            latencyHintApplied: this.effectiveLatencyHint
        };
    }

    getRuntimeDiagnostics() {
        return {
            contextState: this.ctx?.state || 'closed',
            hasMasterGraph: Boolean(this.masterGain && this.masterOutput),
            activeSourceCount: this.activeSources.size,
            trackNodeCount: this.trackNodes.size,
            masterVolumeDb: this.masterVolumeDb,
            cueTrackId: this.cueTrackId,
            cueMode: this.cueMode
        };
    }

    async recoverPlaybackGraph(tracks: Track[]) {
        if (!this.ctx || !this.masterGain || !this.masterOutput || !this.masterAnalyser || !this.limiter || !this.cueGain) {
            await this.init(this.settings);
            this.updateTracks(tracks);
            return;
        }

        try {
            this.masterOutput.disconnect(this.ctx.destination);
        } catch {
            // already disconnected
        }

        try {
            this.masterOutput.disconnect(this.masterAnalyser);
        } catch {
            // already disconnected
        }

        try {
            this.masterOutput.disconnect(this.limiter);
        } catch {
            // already disconnected
        }

        try {
            this.limiter.disconnect(this.ctx.destination);
        } catch {
            // already disconnected
        }

        try {
            this.cueGain.disconnect(this.ctx.destination);
        } catch {
            // already disconnected
        }

        try {
            this.cueGain.disconnect(this.masterAnalyser);
        } catch {
            // already disconnected
        }

        // Restore canonical safe graph:
        // Master -> Limiter -> Destination
        // Master -> Analyser
        // Cue -> Destination + Analyser
        this.masterOutput.connect(this.masterAnalyser);
        this.masterOutput.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);
        this.cueGain.connect(this.ctx.destination);
        this.cueGain.connect(this.masterAnalyser);

        this.updateTracks(tracks);
        this.syncCueRouting();
    }

    getWaveformEnvelopeData(buffer: AudioBuffer, steps: number): { min: Float32Array; max: Float32Array } {
        const left = buffer.getChannelData(0);
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
        if (steps <= 0 || left.length === 0) {
            return {
                min: new Float32Array(0),
                max: new Float32Array(0)
            };
        }

        const safeSteps = Math.max(1, Math.min(steps, left.length));
        const stepSize = Math.max(1, Math.floor(left.length / safeSteps));
        const minValues = new Float32Array(safeSteps);
        const maxValues = new Float32Array(safeSteps);

        for (let i = 0; i < safeSteps; i++) {
            const start = i * stepSize;
            const end = Math.min(left.length, start + stepSize);
            let localMin = 1;
            let localMax = -1;

            for (let j = start; j < end; j++) {
                const mixed = (left[j] + right[j]) * 0.5;
                if (mixed < localMin) localMin = mixed;
                if (mixed > localMax) localMax = mixed;
            }

            minValues[i] = localMin === 1 ? 0 : localMin;
            maxValues[i] = localMax === -1 ? 0 : localMax;
        }

        return {
            min: minValues,
            max: maxValues
        };
    }

    getWaveformData(buffer: AudioBuffer, steps: number): Float32Array {
        const envelope = this.getWaveformEnvelopeData(buffer, steps);
        const amplitude = new Float32Array(envelope.max.length);

        for (let i = 0; i < amplitude.length; i++) {
            amplitude[i] = Math.max(Math.abs(envelope.min[i]), Math.abs(envelope.max[i]));
        }

        return amplitude;
    }

    getIsPlaying(): boolean {
        return this.isPlaying;
    }

    getSessionLaunchTime(quantizeBars: number = 1): number {
        const ctx = this.getContext();

        if (!this.isPlaying) {
            return ctx.currentTime;
        }

        const bars = this.clamp(quantizeBars, 0.25, 16);
        const quantum = (60 / this.currentBpm) * 4 * bars;
        const projectTime = this.getCurrentTime();
        const remainder = projectTime % quantum;

        const delta = remainder < 0.01 || quantum - remainder < 0.01
            ? 0
            : quantum - remainder;

        return ctx.currentTime + delta;
    }

    // --- PLAYBACK ENGINE ---

    // --- TIME HANDLING & INTERFACE ---


    getCurrentTime(): number {
        if (!this.ctx) return 0;
        if (!this.isPlaying) return this.offsetTime;
        return this.ctx.currentTime - this.virtualStartTime;
    }

    getContext(): AudioContext {
        if (!this.ctx) {
            // Auto-initialize if not yet created (for file decoding before user interaction)
            const AudioContextClass = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
            this.applyRuntimeBufferStrategy();
            this.ctx = new AudioContextClass({
                latencyHint: this.effectiveLatencyHint,
                sampleRate: this.settings.sampleRate
            });
            this.applyRuntimeBufferStrategy();
        }
        return this.ctx;
    }

    async ensurePlaybackReady(): Promise<boolean> {
        const tryResume = async (context: AudioContext, label: string): Promise<boolean> => {
            if (context.state === 'running') return true;
            try {
                await context.resume();
                return true;
            } catch (error) {
                console.warn(`No se pudo reanudar AudioContext (${label}).`, error);
                return false;
            }
        };

        const ctx = this.getContext();
        void tryResume(ctx, 'pre-init');

        try {
            await this.init(this.settings);
        } catch (error) {
            console.warn('No se pudo inicializar AudioContext al preparar reproduccion.', error);
            return false;
        }

        if (!this.ctx) return false;

        const resumed = await tryResume(this.ctx, 'post-init');
        const graphReady = Boolean(this.masterGain && this.masterOutput);
        if (resumed && graphReady) {
            return true;
        }

        try {
            await this.restartEngine(this.settings);
        } catch (error) {
            console.warn('No se pudo reiniciar motor de audio para recuperar reproduccion.', error);
            return false;
        }

        if (!this.ctx) return false;

        const resumedAfterRestart = await tryResume(this.ctx, 'post-restart');
        return resumedAfterRestart && Boolean(this.masterGain && this.masterOutput);
    }

    play(tracks: Track[], bpm: number, _pitch: number, offsetTime: number) {
        if (!this.ctx || !this.masterGain) {
            void this.init(this.settings)
                .then(() => {
                    this.play(tracks, bpm, _pitch, offsetTime);
                })
                .catch((error) => {
                    console.warn('No se pudo inicializar AudioContext al reproducir.', error);
                });
            return;
        }
        if (this.ctx.state !== 'running') {
            void this.ctx.resume()
                .then(() => {
                    this.play(tracks, bpm, _pitch, offsetTime);
                })
                .catch((error) => {
                    console.warn('No se pudo reanudar AudioContext al reproducir.', error);
                });
            return;
        }

        this.updateTracks(tracks);

        this.isPlaying = true;
        this.currentBpm = bpm;
        this.offsetTime = offsetTime;

        // Calculate the "Zero Point" of the timeline relative to Now
        // ProjectTime = Now - VirtualStart
        // VirtualStart = Now - ProjectTime
        this.virtualStartTime = this.ctx.currentTime - offsetTime;

        // Start Scheduler
        if (this.schedulerTimer) window.clearInterval(this.schedulerTimer);
        this.schedulerTimer = window.setInterval(() => this.schedulerLoop(), this.schedulerIntervalMs);
    }

    pause() {
        const pauseTime = this.getCurrentTime();
        this.isPlaying = false;
        this.offsetTime = pauseTime; // Store where we stopped
        this.virtualStartTime = (this.ctx?.currentTime || 0) - pauseTime;
        this.stopPlayback(); // Kill sound
        if (this.schedulerTimer) {
            window.clearInterval(this.schedulerTimer);
            this.schedulerTimer = null;
        }
        // Do not suspend context, just stop scheduling
    }

    stop(reset: boolean) {
        const stopTime = this.getCurrentTime();
        this.isPlaying = false;
        this.stopPlayback();
        if (this.schedulerTimer) {
            window.clearInterval(this.schedulerTimer);
            this.schedulerTimer = null;
        }

        if (reset) {
            this.offsetTime = 0;
            this.virtualStartTime = 0;
        } else {
            this.offsetTime = stopTime;
            this.virtualStartTime = (this.ctx?.currentTime || 0) - stopTime;
        }
    }

    seek(time: number, tracks: Track[], bpm: number) {
        const wasPlaying = this.isPlaying;
        this.stopPlayback(); // Stop current sounds

        this.offsetTime = time;
        this.virtualStartTime = (this.ctx?.currentTime || 0) - time;

        if (wasPlaying) {
            // Restart immediately at new time
            this.play(tracks, bpm, 1, time);
        }
    }

    setBpm(bpm: number) {
        this.currentBpm = bpm;
        this.updateActiveSourcesParams();
    }

    setMasterPitch(semitones: number) {
        this.masterTransposeSemitones = this.clamp(Math.round(semitones), -12, 12);
        this.updateActiveSourcesParams();
    }

    updateActiveSourcesParams() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        this.activeSources.forEach((active) => {
            const baseBpm = active.originalBpm > 0 ? active.originalBpm : 120;
            const bpmRatio = this.currentBpm / baseBpm;
            const totalSemitones = this.masterTransposeSemitones + active.clipTransposeSemitones;
            const pitchMult = Math.pow(2, totalSemitones / 12);

            if (active.granularNode) {
                // WARPED: Independent time-stretch + pitch
                active.granularNode.parameters.get('playbackRate')?.setTargetAtTime(bpmRatio, now, 0.05);
                active.granularNode.parameters.get('pitch')?.setTargetAtTime(pitchMult, now, 0.05);
            } else if (active.source) {
                // NATIVE: Independent of BPM — only pitch transpose + user playbackRate
                const userRate = active.clipPlaybackRate ?? 1;
                const finalRate = userRate * pitchMult;
                if (isFinite(finalRate)) {
                    active.source.playbackRate.setTargetAtTime(finalRate, now, 0.05);
                }
            }
        });
    }

    // --- SCHEDULER ---

    private schedulerLoop(tracks?: Track[]) {
        if (!this.ctx) return;

        const tracksToSchedule = (tracks && tracks.length > 0 ? tracks : this.currentTracksSnapshot)
            .map((track) => this.sanitizeTrack(track));
        if (tracksToSchedule.length === 0) return;

        const scheduleWindow = this.scheduleAheadTime;
        const now = this.ctx.currentTime;
        const projectTime = now - this.virtualStartTime;
        const lookAheadTime = projectTime + scheduleWindow;

        tracksToSchedule.forEach((track) => {
            if (track.isMuted) return;

            track.clips.forEach((rawClip) => {
                const clip = this.sanitizeClip(rawClip);
                const secondsPerBar = (60 / this.currentBpm) * 4;
                const clipStartSec = (clip.start - 1) * secondsPerBar;
                const clipDurationSec = clip.length * secondsPerBar;
                const clipEndSec = clipStartSec + clipDurationSec;

                if (clipEndSec > projectTime && clipStartSec < lookAheadTime) {
                    const clipNodeId = `${track.id}-${clip.id}`;

                    const exhaustedUntil = this.exhaustedClipWindows.get(clipNodeId);
                    if (typeof exhaustedUntil === 'number') {
                        if (projectTime < exhaustedUntil - 0.0001) {
                            return;
                        }
                        this.exhaustedClipWindows.delete(clipNodeId);
                    }

                    if (this.activeSources.has(clipNodeId)) return;

                    let startOffset = 0;
                    let playAt = 0;
                    let durationToPlay = clipDurationSec;

                    if (clipStartSec < projectTime) {
                        startOffset = projectTime - clipStartSec;
                        playAt = now;
                        durationToPlay = clipDurationSec - startOffset;
                    } else {
                        playAt = now + (clipStartSec - projectTime);
                        startOffset = 0;
                    }

                    const clipInternalOffsetSec = (clip.offset || 0) * secondsPerBar;
                    let finalBufferOffset = startOffset + clipInternalOffsetSec;

                    if (clip.buffer) {
                        const playbackProfile = this.getClipPlaybackProfile(track, clip);
                        const effectiveRate = clip.isWarped ? playbackProfile.granularRate : playbackProfile.nativeRate;
                        const safeRate = Math.max(0.0001, Math.abs(this.finiteOr(effectiveRate, 1)));
                        const timelineOffsetSeconds = startOffset + clipInternalOffsetSec;
                        finalBufferOffset = timelineOffsetSeconds * safeRate;
                        const remainingBuffer = clip.buffer.duration - finalBufferOffset;

                        if (!Number.isFinite(remainingBuffer) || remainingBuffer <= 0.0001) {
                            this.exhaustedClipWindows.set(clipNodeId, clipEndSec);
                            return;
                        }

                        const maxPlayableTimelineDuration = remainingBuffer / safeRate;
                        if (!Number.isFinite(maxPlayableTimelineDuration) || maxPlayableTimelineDuration <= 0.0001) {
                            this.exhaustedClipWindows.set(clipNodeId, clipEndSec);
                            return;
                        }

                        if (maxPlayableTimelineDuration < durationToPlay - 0.0001) {
                            durationToPlay = maxPlayableTimelineDuration;
                            this.exhaustedClipWindows.set(clipNodeId, clipEndSec);
                        }
                    }

                    if (clip.buffer) {
                        const remainingBuffer = clip.buffer.duration - finalBufferOffset;
                        if (!Number.isFinite(remainingBuffer) || remainingBuffer <= 0.0001) {
                            this.exhaustedClipWindows.set(clipNodeId, clipEndSec);
                            return;
                        }

                        if (remainingBuffer < durationToPlay - 0.0001) {
                            durationToPlay = remainingBuffer;
                            this.exhaustedClipWindows.set(clipNodeId, clipEndSec);
                        }
                    }

                    this.scheduleAudioClip(clip, track, playAt, finalBufferOffset, durationToPlay, clipNodeId);
                }
            });
        });
    }

    scheduleAudioClip(clip: Clip, track: Track, playAt: number, bufferOffset: number, duration: number, nodeId: string) {
        if (!this.ctx || !clip.buffer) return;
        if (!isFinite(duration) || duration <= 0) return;
        const clipBuffer = clip.buffer;

        const trackNodes = this.trackNodes.get(track.id);
        const playbackTarget: AudioNode | null = trackNodes?.input || this.masterOutput || this.masterGain || this.ctx.destination;
        if (!playbackTarget) return;

        const clipGain = this.ctx.createGain();
        const safeClip = this.sanitizeClip(clip);
        const playbackProfile = this.getClipPlaybackProfile(track, safeClip);
        const bufferDuration = clipBuffer.duration;
        const safeOffset = this.clamp(this.finiteOr(bufferOffset, 0), 0, Math.max(0, bufferDuration - 0.001));
        const remainingBufferDuration = Math.max(0, bufferDuration - safeOffset);
        const shouldUseGranular = Boolean(safeClip.isWarped);
        const effectiveRate = shouldUseGranular ? playbackProfile.granularRate : playbackProfile.nativeRate;
        const safeRate = Math.max(0.0001, Math.abs(this.finiteOr(effectiveRate, 1)));
        const maxPlayableTimelineDuration = remainingBufferDuration / safeRate;
        const safeDuration = Math.min(this.finiteOr(duration, 0), maxPlayableTimelineDuration);
        if (safeDuration <= 0.0001) return;

        this.applyClipEnvelope(clipGain, safeClip, playAt, safeDuration, this.currentBpm);
        const clipOriginalBpm = playbackProfile.clipOriginalBpm;
        const clipTransposeSemitones = playbackProfile.clipTransposeSemitones;

        const scheduleNativePath = () => {
            try {
                const source = this.ctx!.createBufferSource();
                source.buffer = clipBuffer;
                source.connect(clipGain);
                clipGain.connect(playbackTarget);

                const nativeRate = playbackProfile.nativeRate;
                source.playbackRate.value = nativeRate;

                const bufferDurationToConsume = Math.max(0.0001, safeDuration * Math.max(0.0001, Math.abs(nativeRate)));
                source.start(playAt, safeOffset, bufferDurationToConsume);

                this.activeSources.set(nodeId, {
                    source,
                    gain: clipGain,
                    startTime: playAt,
                    offset: safeOffset,
                    originalBpm: clipOriginalBpm,
                    clipTransposeSemitones,
                    clipPlaybackRate: playbackProfile.clipPlaybackRate
                });

                source.onended = () => {
                    clipGain.disconnect();
                    this.activeSources.delete(nodeId);
                };
            } catch (error) {
                console.error('Native play failed', error);
            }
        };

        if (shouldUseGranular) {
            // Granular Path
            try {
                const node = new AudioWorkletNode(this.ctx, 'granular-processor');
                const ch0 = clipBuffer.getChannelData(0);
                const ch1 = clipBuffer.numberOfChannels > 1 ? clipBuffer.getChannelData(1) : ch0;
                node.port.postMessage({ type: 'loadBuffer', buffer: [ch0, ch1] });

                node.connect(clipGain);
                clipGain.connect(playbackTarget);

                // Initial Params
                const p = node.parameters;
                p.get('startOffset')?.setValueAtTime(safeOffset, playAt);
                p.get('isPlaying')?.setValueAtTime(1, playAt);
                p.get('isPlaying')?.setValueAtTime(0, playAt + safeDuration);

                p.get('playbackRate')?.setValueAtTime(playbackProfile.granularRate, playAt);
                p.get('pitch')?.setValueAtTime(playbackProfile.transposeMult, playAt);
                p.get('grainSize')?.setValueAtTime(this.granularGrainSize, playAt);
                p.get('overlap')?.setValueAtTime(this.granularOverlap, playAt);

                this.activeSources.set(nodeId, {
                    granularNode: node,
                    gain: clipGain,
                    startTime: playAt,
                    offset: safeOffset,
                    originalBpm: clipOriginalBpm,
                    clipTransposeSemitones,
                    clipPlaybackRate: playbackProfile.clipPlaybackRate
                });

                node.onprocessorerror = (e) => console.error(e);

                setTimeout(() => {
                    node.disconnect();
                    clipGain.disconnect();
                    this.activeSources.delete(nodeId);
                }, (safeDuration * 1000) + 200);

            } catch (error) {
                console.error('Granular play failed, falling back to native path', error);
                scheduleNativePath();
            }

        } else {
            scheduleNativePath();
        }
    }

    startPlayback() {
        // Alias
    }

    stopPlayback() {
        this.activeSources.forEach(({ source, granularNode, gain }) => {
            if (source) {
                try { source.stop(); } catch (e) { }
                source.disconnect();
            }
            if (granularNode) {
                granularNode.parameters.get('isPlaying')?.setValueAtTime(0, this.ctx!.currentTime);
                setTimeout(() => granularNode.disconnect(), 100);
            }
            try { gain.disconnect(); } catch {
                // already disconnected
            }
        });
        this.activeSources.clear();
        this.exhaustedClipWindows.clear();
    }

    // --- UTILS ---
    async decodeAudioData(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
        if (!this.ctx) await this.init();
        return this.ctx!.decodeAudioData(arrayBuffer);
    }

    async startRecording(trackId: string, deviceId?: string) {
        if (!this.ctx) return;
        if (this.recordingSessions.has(trackId)) return;

        try {
            const existingMonitoring = this.monitoringSessions.get(trackId);
            const stream = existingMonitoring?.stream || await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    echoCancellation: false,
                    autoGainControl: false,
                    noiseSuppression: false
                }
            });

            const mediaRecorder = new MediaRecorder(stream);
            const recordedChunks: Blob[] = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.start();
            this.recordingSessions.set(trackId, {
                mediaRecorder,
                recordedChunks,
                stream
            });
        } catch (e) {
            console.error("Mic access failed", e);
        }
    }

    async stopRecording(trackId: string): Promise<{ blob: Blob, buffer: AudioBuffer } | null> {
        const session = this.recordingSessions.get(trackId);
        if (!session) return null;

        return new Promise((resolve) => {
            const cleanup = () => {
                if (!this.monitoringSessions.has(trackId)) {
                    session.stream.getTracks().forEach((track) => track.stop());
                }
                this.recordingSessions.delete(trackId);
            };

            const finalize = async () => {
                try {
                    const blob = new Blob(session.recordedChunks, { type: 'audio/webm' });
                    const arrayBuffer = await blob.arrayBuffer();
                    const buffer = await this.decodeAudioData(arrayBuffer);
                    resolve({ blob, buffer });
                } catch (error) {
                    console.error('Failed to finalize recording', error);
                    resolve(null);
                } finally {
                    cleanup();
                }
            };

            if (session.mediaRecorder.state === 'inactive') {
                void finalize();
                return;
            }

            session.mediaRecorder.onstop = () => {
                void finalize();
            };

            try {
                session.mediaRecorder.stop();
            } catch (error) {
                console.error('Failed to stop recording session', error);
                cleanup();
                resolve(null);
            }
        });
    }

    getActiveRecordingTrackIds(): string[] {
        return Array.from(this.recordingSessions.keys());
    }

    // --- GENERATORS & PREVIEW ---
    createNoiseBuffer(seconds: number = 4): AudioBuffer {
        const ctx = this.getContext();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2) - 1;
        }
        return buffer;
    }

    createSineBuffer(freq: number = 440, seconds: number = 4): AudioBuffer {
        const ctx = this.getContext();
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = Math.sin(2 * Math.PI * freq * (i / ctx.sampleRate));
        }
        return buffer;
    }

    previewBuffer(buffer: AudioBuffer) {
        if (!buffer) return;

        void this.init(this.settings)
            .then(() => {
                if (!this.ctx) return;

                const ctx = this.ctx;
                if (ctx.state !== 'running') {
                    void ctx.resume().catch((error) => {
                        console.warn('No se pudo reanudar contexto para preview.', error);
                    });
                }

                const source = ctx.createBufferSource();
                const previewGain = ctx.createGain();
                previewGain.gain.value = 1;

                source.buffer = buffer;
                source.connect(previewGain);

                const targetNode: AudioNode = this.masterOutput || this.masterGain || ctx.destination;
                previewGain.connect(targetNode);

                source.start();

                source.onended = () => {
                    try { source.disconnect(); } catch {
                        // already disconnected
                    }
                    try { previewGain.disconnect(); } catch {
                        // already disconnected
                    }
                };
            })
            .catch((error) => {
                console.warn('Preview buffer fallo al inicializar motor.', error);
            });
    }

    // --- SESSION VIEW ---
    launchClip(track: Track, clip: Clip, launchTime?: number) {
        if (!clip.buffer) return;

        const ctx = this.getContext();
        const clipGain = ctx.createGain();
        clipGain.gain.value = this.getClipGain(clip);
        const sessionKey = `session_${track.id}_${clip.id}`;
        const startAt = Math.max(ctx.currentTime, launchTime ?? ctx.currentTime);

        this.stopTrackClips(track.id, startAt); // Exclusive playback per track

        const clipOriginalBpm = clip.originalBpm || 120;
        const clipTransposeSemitones = (track.transpose || 0) + (clip.transpose || 0);
        const totalSemitones = this.masterTransposeSemitones + clipTransposeSemitones;
        const shouldUseGranular = Boolean(clip.isWarped);
        const playbackTarget: AudioNode = this.trackNodes.get(track.id)?.input || this.masterOutput || this.masterGain || ctx.destination;

        // Route session playback through the same track chain used by arrange clips.
        clipGain.connect(playbackTarget);

        if (shouldUseGranular) {
            try {
                const node = new AudioWorkletNode(ctx, 'granular-processor');
                const ch0 = clip.buffer.getChannelData(0);
                const ch1 = clip.buffer.numberOfChannels > 1 ? clip.buffer.getChannelData(1) : ch0;
                node.port.postMessage({ type: 'loadBuffer', buffer: [ch0, ch1] });

                node.connect(clipGain);

                const p = node.parameters;
                p.get('startOffset')?.setValueAtTime(0, startAt);
                p.get('isPlaying')?.setValueAtTime(1, startAt);
                p.get('playbackRate')?.setValueAtTime(this.currentBpm / clipOriginalBpm, startAt);
                p.get('pitch')?.setValueAtTime(Math.pow(2, totalSemitones / 12), startAt);

                this.activeSources.set(sessionKey, {
                    granularNode: node,
                    gain: clipGain,
                    startTime: startAt,
                    offset: 0,
                    originalBpm: clipOriginalBpm,
                    clipTransposeSemitones,
                    clipPlaybackRate: 1
                });
            } catch (error) {
                console.error('Session granular playback failed', error);
                try { clipGain.disconnect(); } catch {
                    // already disconnected
                }
            }
            return;
        }

        const source = ctx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(clipGain);
        source.loop = true;
        // Non-warped: play at native speed, only apply transpose
        source.playbackRate.value = Math.pow(2, totalSemitones / 12);
        source.start(startAt);

        this.activeSources.set(sessionKey, {
            source,
            gain: clipGain,
            startTime: startAt,
            offset: 0,
            originalBpm: clipOriginalBpm,
            clipTransposeSemitones,
            clipPlaybackRate: 1
        });

        source.onended = () => {
            clipGain.disconnect();
            this.activeSources.delete(sessionKey);
        };
    }

    stopTrackClips(trackId: string, stopAt?: number) {
        const prefix = `session_${trackId}`;
        const now = this.ctx?.currentTime || 0;
        const shouldScheduleStop = typeof stopAt === 'number' && stopAt > now + 0.001;
        const scheduleDelayMs = shouldScheduleStop
            ? Math.max(30, (stopAt! - now) * 1000 + 40)
            : 0;

        this.activeSources.forEach((value, key) => {
            if (key.startsWith(prefix)) {
                try {
                    if (value.source) {
                        if (shouldScheduleStop) {
                            value.source.stop(stopAt!);
                        } else {
                            value.source.stop();
                        }
                    }
                } catch {
                    // already stopped
                }

                if (value.source) {
                    if (shouldScheduleStop) {
                        setTimeout(() => {
                            try { value.source?.disconnect(); } catch {
                                // already disconnected
                            }
                        }, scheduleDelayMs);
                    } else {
                        try { value.source.disconnect(); } catch {
                            // already disconnected
                        }
                    }
                }

                if (value.granularNode) {
                    value.granularNode.parameters.get('isPlaying')?.setValueAtTime(0, shouldScheduleStop ? stopAt! : now);
                    setTimeout(() => {
                        try { value.granularNode?.disconnect(); } catch {
                            // already disconnected
                        }
                    }, shouldScheduleStop ? scheduleDelayMs : 50);
                }

                if (shouldScheduleStop) {
                    setTimeout(() => {
                        try { value.gain.disconnect(); } catch {
                            // already disconnected
                        }
                    }, scheduleDelayMs);
                } else {
                    try { value.gain.disconnect(); } catch {
                        // already disconnected
                    }
                }

                if (shouldScheduleStop) {
                    setTimeout(() => {
                        this.activeSources.delete(key);
                    }, scheduleDelayMs);
                } else {
                    this.activeSources.delete(key);
                }
            }
        });
    }
    async renderProject(tracks: Track[], options: { bars: number, bpm: number, sampleRate: number, sourceId: string }): Promise<AudioBuffer> {
        const lengthInSeconds = (options.bars * 4 * 60) / options.bpm;
        const offlineCtx = new OfflineAudioContext(2, options.sampleRate * lengthInSeconds, options.sampleRate);
        const secondsPerBar = (60 / options.bpm) * 4;
        const maxAutomationBar = options.bars + 1;

        const needsGranular = tracks.some(track =>
            track.clips.some(clip => {
                if (!clip.buffer) return false;
                return Boolean(clip.isWarped);
            })
        );

        let granularReady = false;
        if (needsGranular) {
            try {
                await offlineCtx.audioWorklet.addModule('./worklets/granular-processor.js');
                granularReady = true;
            } catch (error) {
                console.error('Offline granular worklet load failed, falling back to native render', error);
            }
        }

        const masterGain = offlineCtx.createGain();
        masterGain.gain.value = this.dbToLinear(this.masterVolumeDb);
        masterGain.connect(offlineCtx.destination);

        interface OfflineTrackNodes {
            input: GainNode;
            preSendTap: GainNode;
            gain: GainNode;
            panner: StereoPannerNode;
            reverbGain: GainNode;
            reverb: ConvolverNode;
            sendGains: Map<string, GainNode>;
            outputTargetGroupId: string | null;
        }

        const trackNodes = new Map<string, OfflineTrackNodes>();
        const mixContext = this.buildMixEvaluationContext(tracks);
        const returnTrackIds = tracks
            .filter((track) => track.type === TrackType.RETURN)
            .map((track) => track.id);
        const groupTrackIds = tracks
            .filter((track) => track.type === TrackType.GROUP)
            .map((track) => track.id);
        const groupTrackIdSet = new Set(groupTrackIds);

        tracks.forEach((track) => {
            const input = offlineCtx.createGain();
            input.gain.value = 1;

            const preSendTap = offlineCtx.createGain();
            preSendTap.gain.value = 1;

            const gain = offlineCtx.createGain();
            const panner = offlineCtx.createStereoPanner();
            const reverbGain = offlineCtx.createGain();
            const reverb = offlineCtx.createConvolver();
            reverb.buffer = this.getDefaultReverbImpulse(offlineCtx);

            input.connect(preSendTap);
            preSendTap.connect(gain);
            gain.connect(panner);
            panner.connect(masterGain);

            gain.connect(reverbGain);
            reverbGain.connect(reverb);
            reverb.connect(masterGain);

            trackNodes.set(track.id, {
                input,
                preSendTap,
                gain,
                panner,
                reverbGain,
                reverb,
                sendGains: new Map(),
                outputTargetGroupId: null
            });
        });

        tracks.forEach((track) => {
            const nodes = trackNodes.get(track.id);
            if (!nodes) return;

            const desiredGroupId =
                track.type !== TrackType.RETURN
                    && track.type !== TrackType.GROUP
                    && track.groupId
                    && groupTrackIdSet.has(track.groupId)
                    && track.groupId !== track.id
                    ? track.groupId
                    : null;

            if (!desiredGroupId) return;

            const groupNodes = trackNodes.get(desiredGroupId);
            if (!groupNodes) return;

            try {
                nodes.panner.disconnect(masterGain);
            } catch {
                // already disconnected
            }
            nodes.panner.connect(groupNodes.input);
            nodes.outputTargetGroupId = desiredGroupId;
        });

        tracks.forEach((track) => {
            if (track.type === TrackType.RETURN) return;

            const sourceNodes = trackNodes.get(track.id);
            if (!sourceNodes) return;

            const hasLegacyDbSends = Object.values(track.sends || {}).some((value) => {
                return Number.isFinite(value) && (Number(value) < 0 || Number(value) > 1);
            });

            returnTrackIds.forEach((returnTrackId) => {
                const returnNodes = trackNodes.get(returnTrackId);
                if (!returnNodes) return;

                const sendGain = offlineCtx.createGain();
                sendGain.gain.value = this.normalizeSendGain(track.sends?.[returnTrackId], hasLegacyDbSends);
                sendGain.connect(returnNodes.input);

                const sendMode: 'pre' | 'post' = track.sendModes?.[returnTrackId] === 'pre' ? 'pre' : 'post';
                if (sendMode === 'pre') {
                    sourceNodes.preSendTap.connect(sendGain);
                } else {
                    sourceNodes.panner.connect(sendGain);
                }

                sourceNodes.sendGains.set(returnTrackId, sendGain);
            });
        });

        const getParamAtBar = (track: Track, param: 'volume' | 'pan' | 'reverb', barTime: number): number => {
            const lane = getLaneByParam(track, param);
            const sampled = sampleAutomationLaneAtBar(lane, barTime);
            if (sampled === null) {
                if (param === 'volume') return track.volume;
                if (param === 'pan') return track.pan;
                return track.reverb;
            }

            return denormalizeTrackParam(track, param, sampled);
        };

        tracks.forEach((track) => {
            const nodes = trackNodes.get(track.id);
            if (!nodes) return;

            const gainState = this.evaluateTrackGainState(track, mixContext);

            const gainTimes = this.collectAutomationBarTimes(track, gainState.shouldApplyVca ? gainState.vcaTrack : undefined)
                .filter((time) => time <= maxAutomationBar);

            nodes.gain.gain.cancelScheduledValues(0);
            gainTimes.forEach((barTime, index) => {
                const atTime = Math.max(0, (barTime - 1) * secondsPerBar);
                const trackVolumeDb = getParamAtBar(track, 'volume', barTime);
                const vcaVolumeDb = gainState.shouldApplyVca && gainState.vcaTrack
                    ? getParamAtBar(gainState.vcaTrack, 'volume', barTime)
                    : 0;

                let targetGain = this.dbToLinear(trackVolumeDb) * (gainState.shouldApplyVca ? this.dbToLinear(vcaVolumeDb) : 1);
                if (track.isMuted || gainState.isVcaMuted || gainState.blockedBySolo) {
                    targetGain = 0;
                }

                if (index === 0) {
                    nodes.gain.gain.setValueAtTime(targetGain, atTime);
                } else {
                    nodes.gain.gain.linearRampToValueAtTime(targetGain, atTime);
                }
            });

            const panTimes = this.collectAutomationBarTimes(track).filter((time) => time <= maxAutomationBar);
            nodes.panner.pan.cancelScheduledValues(0);
            panTimes.forEach((barTime, index) => {
                const atTime = Math.max(0, (barTime - 1) * secondsPerBar);
                const panValue = this.normalizePan(getParamAtBar(track, 'pan', barTime));
                if (index === 0) {
                    nodes.panner.pan.setValueAtTime(panValue, atTime);
                } else {
                    nodes.panner.pan.linearRampToValueAtTime(panValue, atTime);
                }
            });

            const reverbTimes = this.collectAutomationBarTimes(track).filter((time) => time <= maxAutomationBar);
            nodes.reverbGain.gain.cancelScheduledValues(0);
            reverbTimes.forEach((barTime, index) => {
                const atTime = Math.max(0, (barTime - 1) * secondsPerBar);
                const reverbValue = this.normalizeReverbSend(getParamAtBar(track, 'reverb', barTime));
                if (index === 0) {
                    nodes.reverbGain.gain.setValueAtTime(reverbValue, atTime);
                } else {
                    nodes.reverbGain.gain.linearRampToValueAtTime(reverbValue, atTime);
                }
            });
        });

        tracks.forEach(track => {
            const nodes = trackNodes.get(track.id);
            if (!nodes) return;

            track.clips.forEach(clip => {
                if (!clip.buffer) return;

                const startRes = (clip.start - 1) * (60 / options.bpm) * 4;
                const durRes = clip.length * (60 / options.bpm) * 4;
                const clipOriginalBpm = clip.originalBpm || 120;
                const clipTransposeSemitones = (track.transpose || 0) + (clip.transpose || 0);
                const totalSemitones = this.masterTransposeSemitones + clipTransposeSemitones;
                const shouldUseGranular = granularReady && Boolean(clip.isWarped);
                const clipOffsetSeconds = clip.offset ? clip.offset * (60 / options.bpm) * 4 : 0;

                const clipGain = offlineCtx.createGain();
                this.applyClipEnvelope(clipGain, clip, startRes, durRes, options.bpm);
                clipGain.connect(nodes.input);

                if (shouldUseGranular) {
                    const node = new AudioWorkletNode(offlineCtx, 'granular-processor');
                    const ch0 = clip.buffer.getChannelData(0);
                    const ch1 = clip.buffer.numberOfChannels > 1 ? clip.buffer.getChannelData(1) : ch0;
                    node.port.postMessage({ type: 'loadBuffer', buffer: [ch0, ch1] });
                    node.connect(clipGain);

                    const p = node.parameters;
                    p.get('startOffset')?.setValueAtTime(clipOffsetSeconds, startRes);
                    p.get('isPlaying')?.setValueAtTime(1, startRes);
                    p.get('isPlaying')?.setValueAtTime(0, startRes + durRes);

                    const bpmRatio = options.bpm / clipOriginalBpm;
                    p.get('playbackRate')?.setValueAtTime(bpmRatio, startRes);
                    p.get('pitch')?.setValueAtTime(Math.pow(2, totalSemitones / 12), startRes);
                    return;
                }

                const source = offlineCtx.createBufferSource();
                source.buffer = clip.buffer;

                // Non-warped: play at native speed, only apply transpose
                const transposeMult = Math.pow(2, totalSemitones / 12);
                source.playbackRate.value = transposeMult;

                source.connect(clipGain);
                source.start(startRes, clipOffsetSeconds, durRes);
            });
        });

        return await offlineCtx.startRendering();
    }

    async encodeAudio(buffer: AudioBuffer, options: { format: string, bitDepth: number, float: boolean, normalize: boolean, dither: string }): Promise<Blob> {
        const numChannels = buffer.numberOfChannels;
        const length = buffer.length;
        const sampleRate = buffer.sampleRate;
        const bitDepth = options.bitDepth === 24 ? 24 : options.bitDepth === 32 ? 32 : 16;
        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = length * blockAlign;
        const headerSize = 44;
        const totalSize = headerSize + dataSize;
        const useFloat = bitDepth === 32 && options.float;
        const audioFormat = useFloat ? 3 : 1; // 3 = IEEE float, 1 = PCM

        const channels: Float32Array[] = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(new Float32Array(buffer.getChannelData(i)));
        }

        if (options.normalize) {
            let peak = 0;
            for (let ch = 0; ch < numChannels; ch++) {
                const data = channels[ch];
                for (let i = 0; i < length; i++) {
                    const value = Math.abs(data[i]);
                    if (value > peak) peak = value;
                }
            }

            if (peak > 0) {
                const gain = 0.99 / peak;
                for (let ch = 0; ch < numChannels; ch++) {
                    const data = channels[ch];
                    for (let i = 0; i < length; i++) {
                        data[i] *= gain;
                    }
                }
            }
        }

        const arrayBuffer = new ArrayBuffer(totalSize);
        const view = new DataView(arrayBuffer);

        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, audioFormat, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        const ditherEnabled = bitDepth < 32 && options.dither !== 'none';
        const lsb = bitDepth === 24 ? 1 / 0x7FFFFF : 1 / 0x7FFF;
        const shapingState = new Float32Array(numChannels);

        let offset = 44;
        for (let i = 0; i < length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                let sample = Math.max(-1, Math.min(1, channels[ch][i]));

                if (ditherEnabled) {
                    const tpdfNoise = (Math.random() + Math.random() - 1) * lsb;
                    if (options.dither === 'pow-r3') {
                        const shapedNoise = tpdfNoise - (0.82 * shapingState[ch]);
                        shapingState[ch] = shapedNoise;
                        sample += shapedNoise;
                    } else {
                        sample += tpdfNoise;
                    }

                    sample = Math.max(-1, Math.min(1, sample));
                }

                if (bitDepth === 16) {
                    const int16 = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                    view.setInt16(offset, int16, true);
                    offset += 2;
                } else if (bitDepth === 24) {
                    const int24 = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7FFFFF);
                    view.setUint8(offset, int24 & 0xFF);
                    view.setUint8(offset + 1, (int24 >> 8) & 0xFF);
                    view.setUint8(offset + 2, (int24 >> 16) & 0xFF);
                    offset += 3;
                } else {
                    view.setFloat32(offset, sample, true);
                    offset += 4;
                }
            }
        }

        return new Blob([arrayBuffer], { type: 'audio/wav' });
    }

    async playTestTone() {
        if (!this.ctx) await this.init();
        await this.ctx?.resume();
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.frequency.value = 440;
        gain.gain.value = 0.5;
        osc.connect(gain);
        gain.connect(this.ctx!.destination);
        osc.start();
        osc.stop(this.ctx!.currentTime + 2);
        console.log("Test Tone Playing...");
    }

    private writeString(view: DataView, offset: number, string: string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }
}

export const audioEngine = new AudioEngine();
