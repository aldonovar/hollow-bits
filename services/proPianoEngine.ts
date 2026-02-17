import { audioEngine } from './audioEngine';

interface EnsureEngineOptions {
    context: AudioContext;
    destination: AudioNode;
}

interface ScheduleNoteOptions {
    note: number;
    velocity: number;
    confidence: number;
    when: number;
    duration: number;
}

type VelocityLayer = 'PP' | 'Mp' | 'Mf' | 'FF';

interface LayerData {
    buffers: Map<number, AudioBuffer>;
    sortedNotes: number[];
}

interface VoiceNodeBundle {
    source: AudioBufferSourceNode;
    gain: GainNode;
    tone: BiquadFilterNode;
}

interface ActiveStack {
    id: number;
    note: number;
    voices: VoiceNodeBundle[];
    releaseTimer: ReturnType<typeof setTimeout> | null;
    pedalLatched: boolean;
    released: boolean;
    endedVoices: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const LAYERS: VelocityLayer[] = ['PP', 'Mp', 'Mf', 'FF'];
const MIDI_MIN = 21;
const MIDI_MAX = 108;

const assetUrl = (relativePath: string): string => {
    const base = import.meta.env.BASE_URL || '/';
    const normalizedBase = base.endsWith('/') ? base : `${base}/`;
    return `${normalizedBase}${relativePath.replace(/^\/+/, '')}`;
};

const SAMPLE_ROOT = assetUrl('instruments/piano-ultra/splendid-grand-piano');

const midiToNoteName = (midi: number): string => {
    const note = NOTE_NAMES[midi % 12];
    const octave = Math.floor(midi / 12) - 1;
    return `${note}${octave}`;
};

class ProPianoEngine {
    private context: AudioContext | null = null;
    private destination: AudioNode | null = null;
    private inputGain: GainNode | null = null;
    private bodyEq: BiquadFilterNode | null = null;
    private topEq: BiquadFilterNode | null = null;
    private limiter: DynamicsCompressorNode | null = null;
    private loadPromise: Promise<void> | null = null;
    private samplesLoaded = false;
    private sustainPedalDown = false;
    private nextStackId = 1;

    private readonly layers: Record<VelocityLayer, LayerData> = {
        PP: { buffers: new Map(), sortedNotes: [] },
        Mp: { buffers: new Map(), sortedNotes: [] },
        Mf: { buffers: new Map(), sortedNotes: [] },
        FF: { buffers: new Map(), sortedNotes: [] }
    };

    private readonly activeStacks = new Map<number, ActiveStack>();

    private clamp(value: number, min: number, max: number): number {
        return Math.min(max, Math.max(min, value));
    }

    private fallbackTime(when?: number): number {
        if (typeof when === 'number' && Number.isFinite(when)) {
            return when;
        }
        if (this.context) {
            return this.context.currentTime;
        }
        return audioEngine.getContext().currentTime;
    }

    private clearStackTimer(stack: ActiveStack): void {
        if (stack.releaseTimer) {
            globalThis.clearTimeout(stack.releaseTimer);
            stack.releaseTimer = null;
        }
    }

    private cleanupStack(stackId: number): void {
        const stack = this.activeStacks.get(stackId);
        if (!stack) return;

        this.clearStackTimer(stack);
        for (const voice of stack.voices) {
            try {
                voice.source.disconnect();
            } catch {
                // ignore disconnection races
            }
            try {
                voice.tone.disconnect();
            } catch {
                // ignore disconnection races
            }
            try {
                voice.gain.disconnect();
            } catch {
                // ignore disconnection races
            }
        }

        this.activeStacks.delete(stackId);
    }

    private teardownGraph(): void {
        this.allNotesOff(this.fallbackTime());

        for (const stack of this.activeStacks.values()) {
            this.clearStackTimer(stack);
        }
        this.activeStacks.clear();

        try {
            this.inputGain?.disconnect();
        } catch {
            // ignore graph teardown races
        }
        try {
            this.bodyEq?.disconnect();
        } catch {
            // ignore graph teardown races
        }
        try {
            this.topEq?.disconnect();
        } catch {
            // ignore graph teardown races
        }
        try {
            this.limiter?.disconnect();
        } catch {
            // ignore graph teardown races
        }

        this.inputGain = null;
        this.bodyEq = null;
        this.topEq = null;
        this.limiter = null;
        this.destination = null;
    }

    private setConcertParams(time: number): void {
        this.inputGain?.gain.setTargetAtTime(0.88, time, 0.08);
        this.bodyEq?.gain.setTargetAtTime(1.15, time, 0.08);
        this.topEq?.gain.setTargetAtTime(-1.4, time, 0.08);

        if (this.limiter) {
            this.limiter.threshold.setValueAtTime(-14, time);
            this.limiter.knee.setValueAtTime(7, time);
            this.limiter.ratio.setValueAtTime(1.28, time);
            this.limiter.attack.setValueAtTime(0.012, time);
            this.limiter.release.setValueAtTime(0.16, time);
        }
    }

    private chooseLayerBlend(velocityNorm: number): Array<{ layer: VelocityLayer; weight: number }> {
        const v = this.clamp(velocityNorm, 0, 1);

        if (v <= 0.34) {
            return [{ layer: 'PP', weight: 1 }];
        }
        if (v <= 0.52) {
            const t = (v - 0.34) / 0.18;
            return [
                { layer: 'PP', weight: 1 - t },
                { layer: 'Mp', weight: t }
            ];
        }
        if (v <= 0.72) {
            const t = (v - 0.52) / 0.2;
            return [
                { layer: 'Mp', weight: 1 - t },
                { layer: 'Mf', weight: t }
            ];
        }
        if (v <= 0.9) {
            const t = (v - 0.72) / 0.18;
            return [
                { layer: 'Mf', weight: 1 - t },
                { layer: 'FF', weight: t }
            ];
        }

        return [{ layer: 'FF', weight: 1 }];
    }

    private pickNearestMidi(sortedNotes: number[], targetNote: number): number | null {
        if (sortedNotes.length === 0) return null;

        let lo = 0;
        let hi = sortedNotes.length - 1;

        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const value = sortedNotes[mid];
            if (value < targetNote) {
                lo = mid + 1;
            } else if (value > targetNote) {
                hi = mid - 1;
            } else {
                return value;
            }
        }

        const lowCandidate = sortedNotes[Math.max(0, hi)];
        const highCandidate = sortedNotes[Math.min(sortedNotes.length - 1, lo)];
        if (Math.abs(highCandidate - targetNote) < Math.abs(lowCandidate - targetNote)) {
            return highCandidate;
        }
        return lowCandidate;
    }

    private async tryLoadSampleBuffer(context: AudioContext, layer: VelocityLayer, midi: number): Promise<AudioBuffer | null> {
        const fileName = `${layer}-${midiToNoteName(midi)}.ogg`;
        const fileUrl = `${SAMPLE_ROOT}/${encodeURIComponent(fileName)}`;

        try {
            const response = await fetch(fileUrl);
            if (!response.ok) {
                return null;
            }

            const payload = await response.arrayBuffer();
            if (payload.byteLength === 0) {
                return null;
            }

            return await context.decodeAudioData(payload.slice(0));
        } catch {
            return null;
        }
    }

    private async loadLayer(context: AudioContext, layer: VelocityLayer): Promise<void> {
        const layerData = this.layers[layer];
        if (layerData.sortedNotes.length > 0) {
            return;
        }

        const midiRange = Array.from({ length: MIDI_MAX - MIDI_MIN + 1 }, (_, index) => MIDI_MIN + index);
        const loadedEntries = await Promise.all(
            midiRange.map(async (midi) => {
                const buffer = await this.tryLoadSampleBuffer(context, layer, midi);
                if (!buffer) return null;
                return { midi, buffer };
            })
        );

        for (const entry of loadedEntries) {
            if (!entry) continue;
            layerData.buffers.set(entry.midi, entry.buffer);
        }

        layerData.sortedNotes = Array.from(layerData.buffers.keys()).sort((a, b) => a - b);
    }

    private async ensureSamplesLoaded(context: AudioContext): Promise<void> {
        if (this.samplesLoaded) {
            return;
        }

        for (const layer of LAYERS) {
            await this.loadLayer(context, layer);
        }

        const totalLoaded = LAYERS.reduce((acc, layer) => acc + this.layers[layer].sortedNotes.length, 0);
        if (totalLoaded === 0) {
            throw new Error('No se pudieron cargar los samples del Concert Grand local.');
        }

        this.samplesLoaded = true;
    }

    private releaseStack(stackId: number, when: number, immediate: boolean): void {
        const stack = this.activeStacks.get(stackId);
        if (!stack || stack.released) return;

        stack.released = true;
        stack.pedalLatched = false;
        this.clearStackTimer(stack);

        const releaseBase = immediate
            ? 0.05
            : this.clamp(0.22 + ((84 - stack.note) * 0.0032), 0.16, 0.46);

        const startAt = Math.max(when, this.context?.currentTime ?? when);

        for (const voice of stack.voices) {
            try {
                voice.gain.gain.cancelScheduledValues(startAt);
                const current = Math.max(0.0001, voice.gain.gain.value);
                voice.gain.gain.setValueAtTime(current, startAt);
                voice.gain.gain.exponentialRampToValueAtTime(0.0001, startAt + releaseBase);
                voice.source.stop(startAt + releaseBase + 0.03);
            } catch {
                // ignore release races
            }
        }
    }

    async ensureReady(options: EnsureEngineOptions): Promise<void> {
        if (
            this.inputGain
            && this.context === options.context
            && this.destination === options.destination
        ) {
            return;
        }

        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }

        this.loadPromise = (async () => {
            this.context = options.context;
            await this.ensureSamplesLoaded(options.context);

            if (
                this.inputGain
                && this.context === options.context
                && this.destination === options.destination
            ) {
                return;
            }

            this.teardownGraph();

            const inputGain = options.context.createGain();
            const bodyEq = options.context.createBiquadFilter();
            const topEq = options.context.createBiquadFilter();
            const limiter = options.context.createDynamicsCompressor();

            bodyEq.type = 'lowshelf';
            bodyEq.frequency.value = 165;
            bodyEq.gain.value = 1.15;

            topEq.type = 'highshelf';
            topEq.frequency.value = 5200;
            topEq.gain.value = -1.4;

            limiter.threshold.value = -14;
            limiter.knee.value = 7;
            limiter.ratio.value = 1.28;
            limiter.attack.value = 0.012;
            limiter.release.value = 0.16;

            inputGain.gain.value = 0.88;

            inputGain.connect(bodyEq);
            bodyEq.connect(topEq);
            topEq.connect(limiter);
            limiter.connect(options.destination);

            this.inputGain = inputGain;
            this.bodyEq = bodyEq;
            this.topEq = topEq;
            this.limiter = limiter;
            this.destination = options.destination;

            this.setConcertParams(options.context.currentTime);
        })();

        try {
            await this.loadPromise;
        } finally {
            this.loadPromise = null;
        }
    }

    setConcertGrandNatural(when?: number): void {
        if (!this.context) return;
        this.setConcertParams(this.fallbackTime(when));
    }

    scheduleNote(options: ScheduleNoteOptions): void {
        if (!this.context || !this.inputGain) return;

        const note = this.clamp(Math.round(options.note), MIDI_MIN, MIDI_MAX);
        const velocityNorm = this.clamp(options.velocity, 0.01, 1);
        const confidenceNorm = this.clamp(options.confidence, 0.01, 1);
        const when = Math.max(this.context.currentTime, options.when);
        const layerBlend = this.chooseLayerBlend(velocityNorm);

        const stackId = this.nextStackId++;
        const stack: ActiveStack = {
            id: stackId,
            note,
            voices: [],
            releaseTimer: null,
            pedalLatched: false,
            released: false,
            endedVoices: 0
        };

        for (const blend of layerBlend) {
            const layerData = this.layers[blend.layer];
            const sourceMidi = this.pickNearestMidi(layerData.sortedNotes, note);
            if (sourceMidi === null) continue;

            const sourceBuffer = layerData.buffers.get(sourceMidi);
            if (!sourceBuffer) continue;

            const source = this.context.createBufferSource();
            const tone = this.context.createBiquadFilter();
            const gain = this.context.createGain();

            source.buffer = sourceBuffer;
            source.playbackRate.setValueAtTime(Math.pow(2, (note - sourceMidi) / 12), when);

            tone.type = 'lowpass';
            tone.frequency.setValueAtTime(
                this.clamp(2500 + (velocityNorm * 5600) + (confidenceNorm * 1800), 1800, 12000),
                when
            );
            tone.Q.setValueAtTime(0.5, when);

            const layerLevel = this.clamp(
                Math.pow(velocityNorm, 1.35)
                * (0.84 + (confidenceNorm * 0.24))
                * blend.weight,
                0.005,
                1.15
            );
            const attack = 0.0025 + ((1 - velocityNorm) * 0.0032);

            gain.gain.setValueAtTime(0.0001, when);
            gain.gain.linearRampToValueAtTime(layerLevel, when + attack);

            source.connect(tone);
            tone.connect(gain);
            gain.connect(this.inputGain);

            source.onended = () => {
                const activeStack = this.activeStacks.get(stackId);
                if (!activeStack) return;

                activeStack.endedVoices += 1;
                if (activeStack.endedVoices >= activeStack.voices.length) {
                    this.cleanupStack(stackId);
                }
            };

            stack.voices.push({ source, gain, tone });
        }

        if (stack.voices.length === 0) {
            return;
        }

        this.activeStacks.set(stackId, stack);

        for (const voice of stack.voices) {
            voice.source.start(when);
        }

        const sustainTail = this.clamp(0.28 + (velocityNorm * 0.58) + (confidenceNorm * 0.22), 0.24, 1.2);
        const gateSeconds = this.clamp(options.duration + sustainTail, 0.12, 14);
        const releaseAt = when + gateSeconds;

        stack.releaseTimer = globalThis.setTimeout(() => {
            if (this.sustainPedalDown) {
                stack.pedalLatched = true;
                return;
            }
            this.releaseStack(stackId, this.fallbackTime(), false);
        }, Math.max(0, (releaseAt - this.context.currentTime) * 1000));
    }

    setSustain(down: boolean, when?: number): void {
        this.sustainPedalDown = !!down;
        if (this.sustainPedalDown) {
            return;
        }

        const releaseAt = this.fallbackTime(when);
        for (const [stackId, stack] of this.activeStacks.entries()) {
            if (!stack.pedalLatched || stack.released) continue;
            this.releaseStack(stackId, releaseAt, false);
        }
    }

    allNotesOff(when?: number): void {
        this.sustainPedalDown = false;
        const releaseAt = this.fallbackTime(when);
        for (const stackId of this.activeStacks.keys()) {
            this.releaseStack(stackId, releaseAt, true);
        }
    }

    dispose(): void {
        this.allNotesOff(this.fallbackTime());
        this.teardownGraph();
        this.context = null;
    }
}

export const proPianoEngine = new ProPianoEngine();
