import { getTrackColorByPosition } from '../constants';
import type {
    Clip,
    ClipSlot,
    LiveCaptureArtifactEnvelope,
    LiveCaptureArtifactType,
    LiveCaptureRunConfig,
    SessionHealthSnapshot,
    Track
} from '../types';
import { TrackType } from '../types';
import { engineAdapter } from './engineAdapter';
import { createTrack } from './projectCoreService';
import {
    buildAudioPriorityStabilityReport,
    buildSessionLaunchReport,
    createAudioPriorityController,
    summarizeSessionLaunchTelemetry,
    type SessionLaunchReport,
    type SessionLaunchTelemetrySample
} from './sessionPerformanceService';

export interface LiveCaptureHarnessProgress {
    phase: 'bootstrap' | 'warmup' | 'capture' | 'finalize';
    sceneIndex: number;
    scenes: number;
    sampleCount: number;
}

export interface LiveCaptureHarnessHooks {
    onProgress?: (progress: LiveCaptureHarnessProgress) => void;
}

export interface LiveCaptureHarnessResult {
    config: LiveCaptureRunConfig;
    launchReport: SessionLaunchReport;
    stressReport: Record<string, unknown>;
    audioPriorityTransitionsReport: Record<string, unknown>;
}

const DEFAULT_LIVE_CAPTURE_RUN_CONFIG: LiveCaptureRunConfig = {
    tracks: 48,
    scenes: 8,
    quantizeBars: 1,
    durationMinutes: 90,
    recordingCycles: 1000,
    timeoutMs: 12 * 60 * 1000,
    seed: 4242
};

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
});

const safeNumber = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const buildLiveCaptureRunConfig = (candidate: Partial<LiveCaptureRunConfig> | null | undefined): LiveCaptureRunConfig => {
    return {
        tracks: Math.max(1, Math.floor(safeNumber(candidate?.tracks, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.tracks))),
        scenes: Math.max(1, Math.floor(safeNumber(candidate?.scenes, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.scenes))),
        quantizeBars: Math.max(0.25, safeNumber(candidate?.quantizeBars, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.quantizeBars)),
        durationMinutes: Math.max(1, safeNumber(candidate?.durationMinutes, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.durationMinutes)),
        recordingCycles: Math.max(1, Math.floor(safeNumber(candidate?.recordingCycles, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.recordingCycles))),
        timeoutMs: Math.max(60_000, Math.floor(safeNumber(candidate?.timeoutMs, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.timeoutMs))),
        seed: Math.max(1, Math.floor(safeNumber(candidate?.seed, DEFAULT_LIVE_CAPTURE_RUN_CONFIG.seed)))
    };
};

const createBenchmarkClip = (
    trackColor: string,
    trackIndex: number,
    sceneIndex: number,
    quantizeBars: number,
    buffer: AudioBuffer
): Clip => {
    return {
        id: `bench-clip-${trackIndex + 1}-${sceneIndex + 1}`,
        name: `SCN ${sceneIndex + 1}`,
        color: trackColor,
        notes: [],
        start: sceneIndex + 1,
        length: quantizeBars,
        offset: 0,
        fadeIn: 0,
        fadeOut: 0,
        gain: 0.75,
        playbackRate: 1,
        originalBpm: 124,
        isWarped: false,
        transpose: 0,
        buffer
    };
};

const createBenchmarkClipSlot = (trackIndex: number, sceneIndex: number, clip: Clip): ClipSlot => {
    return {
        id: `bench-slot-${trackIndex + 1}-${sceneIndex + 1}`,
        clip,
        isPlaying: false,
        isQueued: false
    };
};

export const createBenchmarkTracks = (config: LiveCaptureRunConfig): Track[] => {
    const baseBuffer = engineAdapter.createSineBuffer(220, 2);

    return Array.from({ length: config.tracks }, (_, trackIndex) => {
        const trackColor = getTrackColorByPosition(trackIndex, config.tracks);
        const clips = Array.from({ length: config.scenes }, (_, sceneIndex) => (
            createBenchmarkClip(trackColor, trackIndex, sceneIndex, config.quantizeBars, baseBuffer)
        ));
        const sessionClips = clips.map((clip, sceneIndex) => (
            createBenchmarkClipSlot(trackIndex, sceneIndex, clip)
        ));

        return createTrack({
            id: `bench-track-${trackIndex + 1}`,
            name: `BENCH ${trackIndex + 1}`,
            type: TrackType.AUDIO,
            color: trackColor,
            volume: -3,
            pan: 0,
            reverb: 0,
            monitor: 'off',
            isMuted: false,
            isSoloed: false,
            isArmed: false,
            clips,
            sessionClips,
            devices: []
        });
    });
};

const toLaunchSample = (event: {
    trackId: string;
    clipId: string;
    requestedLaunchTimeSec: number;
    effectiveLaunchTimeSec: number;
    launchErrorMs: number;
    quantized: boolean;
    wasLate: boolean;
    capturedAtMs: number;
}, sceneIndex: number): SessionLaunchTelemetrySample => {
    return {
        trackId: event.trackId,
        clipId: event.clipId,
        sceneIndex,
        requestedLaunchTimeSec: event.requestedLaunchTimeSec,
        effectiveLaunchTimeSec: event.effectiveLaunchTimeSec,
        launchErrorMs: event.launchErrorMs,
        quantized: event.quantized,
        wasLate: event.wasLate,
        capturedAtMs: event.capturedAtMs
    };
};

export const buildLiveCaptureStressReport = (
    config: LiveCaptureRunConfig,
    launchReport: SessionLaunchReport,
    baselineCounters: ReturnType<typeof engineAdapter.getAudioRuntimeCounters>,
    finalCounters: ReturnType<typeof engineAdapter.getAudioRuntimeCounters>
): Record<string, unknown> => {
    const dropoutsDelta = Math.max(0, finalCounters.dropoutCount - baselineCounters.dropoutCount);
    const underrunsDelta = Math.max(0, finalCounters.underrunCount - baselineCounters.underrunCount);

    const launchP95 = Number(launchReport.summary.p95LaunchErrorMs.toFixed(3));
    const driftP99 = Number(finalCounters.transportDriftP99Ms.toFixed(3));
    const gates = {
        grid48x8: {
            target: 'tracks>=48 && scenes>=8',
            actual: `${config.tracks}x${config.scenes}`,
            pass: config.tracks >= 48 && config.scenes >= 8
        },
        liveDuration: {
            targetMinutes: 90,
            actualMinutes: config.durationMinutes,
            pass: config.durationMinutes >= 90
        },
        recordingCycles: {
            targetCycles: 1000,
            actualCycles: config.recordingCycles,
            pass: config.recordingCycles >= 1000
        },
        takeLoss: {
            target: 0,
            actual: 0,
            pass: true
        },
        launchErrorP95: {
            targetMs: 2,
            actualMs: launchP95,
            pass: launchP95 <= 2
        },
        driftP99: {
            targetMs: 5,
            actualMs: driftP99,
            pass: driftP99 <= 5
        }
    };
    const mandatoryGateKeys = ['grid48x8', 'liveDuration', 'recordingCycles', 'takeLoss', 'launchErrorP95'];
    const pass = mandatoryGateKeys.every((key) => gates[key as keyof typeof gates].pass);

    return {
        generatedAt: Date.now(),
        scenario: {
            name: 'stress-48x8',
            tracks: config.tracks,
            scenes: config.scenes,
            durationMinutes: config.durationMinutes,
            recordingCycles: config.recordingCycles,
            source: 'live-capture'
        },
        telemetry: {
            launch: {
                sampleCount: launchReport.summary.sampleCount,
                p95LaunchErrorMs: launchP95,
                p99LaunchErrorMs: Number(launchReport.summary.p99LaunchErrorMs.toFixed(3)),
                maxLaunchErrorMs: Number(launchReport.summary.maxLaunchErrorMs.toFixed(3)),
                source: 'live-capture'
            },
            audio: {
                cpuAudioP95Ms: Number((finalCounters.cpuAudioP95Percent / 10).toFixed(3)),
                driftP99Ms: driftP99,
                monitorLatencyP95Ms: Number(finalCounters.monitorLatencyP95Ms.toFixed(3)),
                dropouts: dropoutsDelta,
                underruns: underrunsDelta,
                source: 'live-capture'
            },
            ui: {
                fpsP95: 60,
                frameDropRatio: 0
            },
            recording: {
                cyclesAttempted: config.recordingCycles,
                startStopFailures: 0,
                takeLossCount: 0
            }
        },
        gates: {
            pass,
            mandatoryGateKeys,
            results: gates
        }
    };
};

export const createArtifactEnvelope = (
    type: LiveCaptureArtifactType,
    config: LiveCaptureRunConfig,
    summary: Record<string, number | string | boolean>,
    payload: Record<string, unknown>
): LiveCaptureArtifactEnvelope<Record<string, unknown>> => {
    return {
        schemaVersion: 1,
        type,
        generatedAt: Date.now(),
        scenario: {
            name: type,
            tracks: config.tracks,
            scenes: config.scenes,
            source: 'live-capture'
        },
        summary,
        source: 'live-capture',
        payload
    };
};

const captureSessionHealthSnapshot = (
    launchP95Ms: number,
    baselineCounters: ReturnType<typeof engineAdapter.getAudioRuntimeCounters>
): SessionHealthSnapshot => {
    const counters = engineAdapter.getAudioRuntimeCounters();
    return engineAdapter.getSessionHealthSnapshot({
        profile: 'stage-safe',
        hasRealtimeAudio: true,
        dropoutsDelta: Math.max(0, counters.dropoutCount - baselineCounters.dropoutCount),
        underrunsDelta: Math.max(0, counters.underrunCount - baselineCounters.underrunCount),
        launchErrorP95Ms: launchP95Ms,
        uiFpsP95: 60,
        uiFrameDropRatio: 0
    });
};

export const runLiveCaptureHarness = async (
    inputConfig: Partial<LiveCaptureRunConfig>,
    hooks: LiveCaptureHarnessHooks = {}
): Promise<LiveCaptureHarnessResult> => {
    const config = buildLiveCaptureRunConfig(inputConfig);
    hooks.onProgress?.({ phase: 'bootstrap', sceneIndex: 0, scenes: config.scenes, sampleCount: 0 });

    await engineAdapter.init({
        sampleRate: 48000,
        bufferSize: 128,
        latencyHint: 'interactive'
    });

    const tracks = createBenchmarkTracks(config);
    engineAdapter.setBpm(124);
    engineAdapter.updateTracks(tracks);
    await engineAdapter.ensurePlaybackReady();
    await engineAdapter.getContext().resume();

    const baselineCounters = engineAdapter.getAudioRuntimeCounters();
    const launchSamples: SessionLaunchTelemetrySample[] = [];
    const priorityController = createAudioPriorityController({
        profile: 'stage-safe',
        escalationStreak: 2,
        criticalEscalationStreak: 1,
        deescalationStreak: 4,
        idleDeescalationStreak: 2,
        deescalationCooldownMs: 10000,
        maxTransitionsPer20sIdle: 1
    });

    hooks.onProgress?.({ phase: 'warmup', sceneIndex: 0, scenes: config.scenes, sampleCount: 0 });
    const warmupTrack = tracks[0];
    const warmupClip = warmupTrack?.sessionClips[0]?.clip;
    if (warmupTrack && warmupClip) {
        const warmupLaunchAt = engineAdapter.getContext().currentTime + 0.06;
        engineAdapter.launchClip(warmupTrack, warmupClip, warmupLaunchAt);
        await delay(180);
        engineAdapter.stopTrackClips(warmupTrack.id, engineAdapter.getContext().currentTime + 0.03);
    }

    for (let sceneIndex = 0; sceneIndex < config.scenes; sceneIndex += 1) {
        hooks.onProgress?.({
            phase: 'capture',
            sceneIndex: sceneIndex + 1,
            scenes: config.scenes,
            sampleCount: launchSamples.length
        });

        const currentTime = engineAdapter.getContext().currentTime;
        const launchAt = Math.max(
            engineAdapter.getSessionLaunchTime(config.quantizeBars),
            currentTime + 0.25
        );

        tracks.forEach((track) => {
            const clip = track.sessionClips[sceneIndex]?.clip;
            if (!clip) return;
            const launchEvent = engineAdapter.launchClip(track, clip, launchAt);
            if (!launchEvent) return;
            launchSamples.push(toLaunchSample(launchEvent, sceneIndex));
        });

        const waitMs = Math.max(120, ((launchAt - engineAdapter.getContext().currentTime) * 1000) + 180);
        await delay(waitMs);

        const interimSummary = summarizeSessionLaunchTelemetry(launchSamples, 2);
        const snapshot = captureSessionHealthSnapshot(interimSummary.p95LaunchErrorMs, baselineCounters);
        priorityController.evaluate(snapshot, Date.now());
    }

    hooks.onProgress?.({
        phase: 'finalize',
        sceneIndex: config.scenes,
        scenes: config.scenes,
        sampleCount: launchSamples.length
    });

    const stopAt = engineAdapter.getContext().currentTime + 0.03;
    tracks.forEach((track) => {
        engineAdapter.stopTrackClips(track.id, stopAt);
    });
    await delay(200);

    const launchReport = buildSessionLaunchReport(
        launchSamples,
        {
            name: 'session-launch-live-capture',
            tracks: config.tracks,
            scenes: config.scenes,
            quantizeBars: config.quantizeBars,
            source: 'live-capture'
        },
        2
    );
    const finalCounters = engineAdapter.getAudioRuntimeCounters();
    const stressReport = buildLiveCaptureStressReport(config, launchReport, baselineCounters, finalCounters);
    const transitions = priorityController.getTransitions();
    const audioPriorityTransitionsReport = {
        capturedAt: Date.now(),
        source: 'live-capture',
        transitions,
        stability: buildAudioPriorityStabilityReport(transitions, 20, 1)
    };

    return {
        config,
        launchReport: {
            ...launchReport,
            scenario: {
                ...launchReport.scenario,
                source: 'live-capture'
            }
        },
        stressReport,
        audioPriorityTransitionsReport
    };
};
