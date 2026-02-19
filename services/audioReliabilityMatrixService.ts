import { AudioSettings, Clip, Track, TrackType } from '../types';
import { audioEngine, EngineDiagnostics } from './audioEngine';
import { createTrack } from './projectCoreService';

export type AudioReliabilityCaseStatus = 'pass' | 'warn' | 'fail';

export interface AudioReliabilityMatrixCaseConfig {
    id: string;
    sampleRate: AudioSettings['sampleRate'];
    bufferSize: AudioSettings['bufferSize'];
    latencyHint: AudioSettings['latencyHint'];
}

export interface AudioReliabilityRenderMetrics {
    durationSeconds: number;
    expectedDurationSeconds: number;
    durationDeltaMs: number;
    peakLinear: number;
    peakDb: number;
    rmsLinear: number;
    rmsDb: number;
    isSilent: boolean;
}

export interface AudioReliabilityRuntimeSnapshot {
    contextState: AudioContextState | 'closed';
    hasMasterGraph: boolean;
    activeSourceCount: number;
    trackNodeCount: number;
    masterVolumeDb: number;
    cueTrackId: string | null;
    cueMode: 'pfl' | 'afl' | null;
}

export interface AudioReliabilityAssessment {
    status: AudioReliabilityCaseStatus;
    criticalIssues: string[];
    warnings: string[];
    issues: string[];
}

export interface AudioReliabilityMatrixCaseResult {
    caseConfig: AudioReliabilityMatrixCaseConfig;
    status: AudioReliabilityCaseStatus;
    diagnostics: EngineDiagnostics;
    runtime: AudioReliabilityRuntimeSnapshot;
    render: AudioReliabilityRenderMetrics;
    issues: string[];
    criticalIssues: string[];
    warnings: string[];
    elapsedMs: number;
}

export interface AudioReliabilityMatrixProgress {
    totalCases: number;
    completedCases: number;
    runningCaseId: string | null;
    runningCaseLabel: string | null;
    lastResult: AudioReliabilityMatrixCaseResult | null;
}

export interface AudioReliabilityMatrixReport {
    startedAt: number;
    finishedAt: number;
    elapsedMs: number;
    totalCases: number;
    passedCases: number;
    warnedCases: number;
    failedCases: number;
    aborted: boolean;
    restoreFailed: boolean;
    restoreError: string | null;
    results: AudioReliabilityMatrixCaseResult[];
}

export interface AudioReliabilityMatrixRunOptions {
    bars?: number;
    bpm?: number;
    cases?: AudioReliabilityMatrixCaseConfig[];
    signal?: AbortSignal;
    onProgress?: (progress: AudioReliabilityMatrixProgress) => void;
}

const SAMPLE_RATES: ReadonlyArray<AudioSettings['sampleRate']> = [44100, 48000, 88200, 96000, 192000];
const BUFFER_SIZES: ReadonlyArray<AudioSettings['bufferSize']> = ['auto', 128, 256, 512, 1024, 2048];
const AUTO_LATENCY_HINTS: ReadonlyArray<AudioSettings['latencyHint']> = ['interactive', 'balanced', 'playback'];
const DURATION_TOLERANCE_MS = 35;
const SILENCE_THRESHOLD = 0.00025;

const createAbortError = (): Error => {
    const error = new Error('Audio reliability matrix aborted');
    error.name = 'AbortError';
    return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) {
        throw createAbortError();
    }
};

const toDb = (value: number): number => {
    return 20 * Math.log10(Math.max(value, 1e-8));
};

const wait = (ms: number): Promise<void> => {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
};

const describeCase = (caseConfig: AudioReliabilityMatrixCaseConfig): string => {
    const hz = `${Math.round(caseConfig.sampleRate / 100) / 10}kHz`;
    const buffer = caseConfig.bufferSize === 'auto' ? `auto-${caseConfig.latencyHint}` : `${caseConfig.bufferSize}`;
    return `${hz} / ${buffer}`;
};

const createMatrixToneTrack = (bars: number, bpm: number): Track => {
    const expectedSeconds = (bars * 4 * 60) / bpm;
    const toneBuffer = audioEngine.createSineBuffer(440, Math.max(1, expectedSeconds + 0.35));

    const clip: Clip = {
        id: 'matrix-tone-clip',
        name: 'Matrix Tone',
        color: '#2BD9FF',
        notes: [],
        start: 1,
        length: bars,
        offset: 0,
        fadeIn: 0,
        fadeOut: 0,
        gain: 1,
        playbackRate: 1,
        originalBpm: bpm,
        isWarped: false,
        transpose: 0,
        buffer: toneBuffer
    };

    return createTrack({
        id: 'matrix-tone-track',
        name: 'Matrix Tone Track',
        type: TrackType.AUDIO,
        clips: [clip],
        sessionClips: [],
        devices: [],
        monitor: 'off',
        isArmed: false,
        isMuted: false,
        isSoloed: false,
        volume: -6,
        reverb: 0,
        pan: 0
    });
};

const collectRenderMetrics = (
    rendered: AudioBuffer,
    expectedDurationSeconds: number
): AudioReliabilityRenderMetrics => {
    const totalSamples = rendered.length * rendered.numberOfChannels;
    if (totalSamples <= 0) {
        return {
            durationSeconds: 0,
            expectedDurationSeconds,
            durationDeltaMs: expectedDurationSeconds * 1000,
            peakLinear: 0,
            peakDb: toDb(0),
            rmsLinear: 0,
            rmsDb: toDb(0),
            isSilent: true
        };
    }

    let peak = 0;
    let sumSquares = 0;

    for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
        const data = rendered.getChannelData(channel);
        for (let i = 0; i < data.length; i++) {
            const sample = data[i];
            const abs = Math.abs(sample);
            if (abs > peak) peak = abs;
            sumSquares += sample * sample;
        }
    }

    const rms = Math.sqrt(sumSquares / totalSamples);
    const durationSeconds = rendered.length / rendered.sampleRate;

    return {
        durationSeconds,
        expectedDurationSeconds,
        durationDeltaMs: Math.abs(durationSeconds - expectedDurationSeconds) * 1000,
        peakLinear: peak,
        peakDb: toDb(peak),
        rmsLinear: rms,
        rmsDb: toDb(rms),
        isSilent: peak < SILENCE_THRESHOLD
    };
};

const toRuntimeSnapshot = (): AudioReliabilityRuntimeSnapshot => {
    const runtime = audioEngine.getRuntimeDiagnostics();
    return {
        contextState: runtime.contextState,
        hasMasterGraph: runtime.hasMasterGraph,
        activeSourceCount: runtime.activeSourceCount,
        trackNodeCount: runtime.trackNodeCount,
        masterVolumeDb: runtime.masterVolumeDb,
        cueTrackId: runtime.cueTrackId,
        cueMode: runtime.cueMode
    };
};

export const buildAudioReliabilityMatrixCases = (): AudioReliabilityMatrixCaseConfig[] => {
    const cases: AudioReliabilityMatrixCaseConfig[] = [];

    SAMPLE_RATES.forEach((sampleRate) => {
        BUFFER_SIZES.forEach((bufferSize) => {
            const hints = bufferSize === 'auto' ? AUTO_LATENCY_HINTS : (['interactive'] as const);

            hints.forEach((latencyHint) => {
                cases.push({
                    id: `sr-${sampleRate}_buf-${String(bufferSize)}_lh-${latencyHint}`,
                    sampleRate,
                    bufferSize,
                    latencyHint
                });
            });
        });
    });

    return cases;
};

export const assessAudioReliabilityCase = (
    diagnostics: EngineDiagnostics,
    runtime: AudioReliabilityRuntimeSnapshot,
    render: AudioReliabilityRenderMetrics,
    caseConfig: AudioReliabilityMatrixCaseConfig
): AudioReliabilityAssessment => {
    const criticalIssues: string[] = [];
    const warnings: string[] = [];

    if (diagnostics.state !== 'running') {
        criticalIssues.push(`AudioContext no esta en running (estado: ${diagnostics.state}).`);
    }

    if (runtime.contextState !== 'running') {
        criticalIssues.push(`Runtime context no esta en running (estado: ${runtime.contextState}).`);
    }

    if (!runtime.hasMasterGraph) {
        criticalIssues.push('El master graph no esta inicializado.');
    }

    if (!Number.isFinite(diagnostics.activeSampleRate) || (diagnostics.activeSampleRate || 0) <= 0) {
        criticalIssues.push('La frecuencia activa reportada por el motor es invalida.');
    }

    if (render.isSilent) {
        criticalIssues.push(`El render de prueba quedo en silencio (peak=${render.peakDb.toFixed(2)} dBFS).`);
    }

    if (render.durationDeltaMs > DURATION_TOLERANCE_MS) {
        warnings.push(`Deriva de duracion ${render.durationDeltaMs.toFixed(2)}ms (esperado ${render.expectedDurationSeconds.toFixed(4)}s, real ${render.durationSeconds.toFixed(4)}s).`);
    }

    if (diagnostics.sampleRateMismatch) {
        warnings.push(diagnostics.sampleRateMismatchMessage || `Sample rate solicitado ${caseConfig.sampleRate}Hz, activo ${diagnostics.activeSampleRate}Hz.`);
    }

    if ((diagnostics.effectiveBufferSize || 0) <= 0) {
        warnings.push('El motor reporto effectiveBufferSize invalido.');
    }

    if (diagnostics.profileSuggestion) {
        warnings.push(diagnostics.profileSuggestion.reason);
    }

    const status: AudioReliabilityCaseStatus = criticalIssues.length > 0
        ? 'fail'
        : warnings.length > 0
            ? 'warn'
            : 'pass';

    return {
        status,
        criticalIssues,
        warnings,
        issues: [...criticalIssues, ...warnings]
    };
};

export const runAudioReliabilityMatrix = async (
    options: AudioReliabilityMatrixRunOptions = {}
): Promise<AudioReliabilityMatrixReport> => {
    const bars = Math.max(1, Math.round(options.bars || 1));
    const bpm = Math.max(20, Math.min(999, Number.isFinite(options.bpm || 0) ? Number(options.bpm) : 120));
    const cases = options.cases && options.cases.length > 0
        ? options.cases
        : buildAudioReliabilityMatrixCases();

    const startedAt = Date.now();
    const initialSettings = audioEngine.getSettings();
    const results: AudioReliabilityMatrixCaseResult[] = [];
    let aborted = false;
    let restoreFailed = false;
    let restoreError: string | null = null;

    const progress = (runningCaseId: string | null, runningCaseLabel: string | null, lastResult: AudioReliabilityMatrixCaseResult | null) => {
        options.onProgress?.({
            totalCases: cases.length,
            completedCases: results.length,
            runningCaseId,
            runningCaseLabel,
            lastResult
        });
    };

    progress(null, null, null);

    try {
        for (let index = 0; index < cases.length; index++) {
            const caseConfig = cases[index];
            progress(caseConfig.id, describeCase(caseConfig), null);

            try {
                throwIfAborted(options.signal);
                const caseStartedAt = Date.now();

                const nextSettings: AudioSettings = {
                    ...initialSettings,
                    sampleRate: caseConfig.sampleRate,
                    bufferSize: caseConfig.bufferSize,
                    latencyHint: caseConfig.latencyHint
                };

                await audioEngine.restartEngine(nextSettings);
                await wait(120);
                throwIfAborted(options.signal);

                const expectedDurationSeconds = (bars * 4 * 60) / bpm;
                const toneTrack = createMatrixToneTrack(bars, bpm);
                const renderedBuffer = await audioEngine.renderProject([toneTrack], {
                    bars,
                    bpm,
                    sampleRate: caseConfig.sampleRate,
                    sourceId: `matrix-${caseConfig.id}`
                });

                const diagnostics = audioEngine.getDiagnostics();
                const runtime = toRuntimeSnapshot();
                const render = collectRenderMetrics(renderedBuffer, expectedDurationSeconds);
                const assessment = assessAudioReliabilityCase(diagnostics, runtime, render, caseConfig);

                const result: AudioReliabilityMatrixCaseResult = {
                    caseConfig,
                    status: assessment.status,
                    diagnostics,
                    runtime,
                    render,
                    issues: assessment.issues,
                    criticalIssues: assessment.criticalIssues,
                    warnings: assessment.warnings,
                    elapsedMs: Date.now() - caseStartedAt
                };

                results.push(result);
                progress(null, null, result);
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    aborted = true;
                    break;
                }

                const diagnostics = audioEngine.getDiagnostics();
                const runtime = toRuntimeSnapshot();
                const failMessage = error instanceof Error ? error.message : 'Fallo desconocido en matriz de confiabilidad.';
                const result: AudioReliabilityMatrixCaseResult = {
                    caseConfig,
                    status: 'fail',
                    diagnostics,
                    runtime,
                    render: {
                        durationSeconds: 0,
                        expectedDurationSeconds: (bars * 4 * 60) / bpm,
                        durationDeltaMs: 0,
                        peakLinear: 0,
                        peakDb: toDb(0),
                        rmsLinear: 0,
                        rmsDb: toDb(0),
                        isSilent: true
                    },
                    issues: [failMessage],
                    criticalIssues: [failMessage],
                    warnings: [],
                    elapsedMs: 0
                };

                results.push(result);
                progress(null, null, result);
            }
        }
    } finally {
        try {
            await audioEngine.restartEngine(initialSettings);
        } catch (error) {
            restoreFailed = true;
            restoreError = error instanceof Error
                ? error.message
                : 'No se pudo restaurar la configuracion original del motor.';
        }
    }

    const finishedAt = Date.now();
    const passedCases = results.filter((result) => result.status === 'pass').length;
    const warnedCases = results.filter((result) => result.status === 'warn').length;
    const failedCases = results.filter((result) => result.status === 'fail').length;

    return {
        startedAt,
        finishedAt,
        elapsedMs: finishedAt - startedAt,
        totalCases: cases.length,
        passedCases,
        warnedCases,
        failedCases,
        aborted,
        restoreFailed,
        restoreError,
        results
    };
};
