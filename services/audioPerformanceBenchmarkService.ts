import {
    AudioSettings,
    Block1RouteEvaluation,
    Clip,
    EngineBackendRoute,
    Track,
    TrackType
} from '../types';
import {
    engineAdapter,
    EngineDiagnostics,
    EngineRouteImplementationStatus,
    EngineSchedulerMode,
    GraphUpdateStats,
    SchedulerTelemetrySnapshot
} from './engineAdapter';
import { createTrack } from './projectCoreService';

export type AudioPerformanceBenchmarkStatus = 'pass' | 'warn' | 'fail';

export interface AudioPerformanceBenchmarkCaseConfig {
    id: string;
    label: string;
    route?: EngineBackendRoute;
    schedulerMode: EngineSchedulerMode;
    audioTrackCount: number;
    groupTrackCount: number;
    returnTrackCount: number;
    clipsPerTrack: number;
    durationMs: number;
    bpm: number;
    bars: number;
    sampleRate?: AudioSettings['sampleRate'];
    bufferSize?: AudioSettings['bufferSize'];
    latencyHint?: AudioSettings['latencyHint'];
}

export interface AudioPerformanceEventLoopMetrics {
    samples: number;
    avgLagMs: number;
    p95LagMs: number;
    p99LagMs: number;
    maxLagMs: number;
}

export interface AudioPerformanceRuntimeSnapshot {
    contextState: AudioContextState | 'closed';
    hasMasterGraph: boolean;
    activeSourceCount: number;
    trackNodeCount: number;
    masterVolumeDb: number;
    cueTrackId: string | null;
    cueMode: 'pfl' | 'afl' | null;
}

export interface AudioPerformanceBenchmarkCaseMetrics {
    diagnostics: EngineDiagnostics;
    runtime: AudioPerformanceRuntimeSnapshot;
    scheduler: SchedulerTelemetrySnapshot;
    eventLoop: AudioPerformanceEventLoopMetrics;
    graphUpdate: GraphUpdateStats;
}

export interface AudioPerformanceBenchmarkAssessment {
    status: AudioPerformanceBenchmarkStatus;
    criticalIssues: string[];
    warnings: string[];
    issues: string[];
}

export interface AudioPerformanceBenchmarkCaseResult {
    caseConfig: AudioPerformanceBenchmarkCaseConfig;
    route?: EngineBackendRoute;
    routeImplementationStatus?: EngineRouteImplementationStatus;
    status: AudioPerformanceBenchmarkStatus;
    metrics: AudioPerformanceBenchmarkCaseMetrics;
    issues: string[];
    criticalIssues: string[];
    warnings: string[];
    elapsedMs: number;
}

export interface AudioPerformanceBenchmarkProgress {
    totalCases: number;
    completedCases: number;
    runningCaseId: string | null;
    runningCaseLabel: string | null;
    lastResult: AudioPerformanceBenchmarkCaseResult | null;
}

export interface AudioPerformanceBenchmarkReport {
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
    comparisons: AudioPerformanceBenchmarkABComparison[];
    routeEvaluations?: Block1RouteEvaluation[];
    recommendedRoute?: EngineBackendRoute;
    results: AudioPerformanceBenchmarkCaseResult[];
}

export interface AudioPerformanceBenchmarkABComparison {
    scenarioKey: string;
    intervalCaseId: string;
    workletCaseId: string;
    intervalStatus: AudioPerformanceBenchmarkStatus;
    workletStatus: AudioPerformanceBenchmarkStatus;
    intervalP95DriftMs: number;
    workletP95DriftMs: number;
    intervalP99DriftMs: number;
    workletP99DriftMs: number;
    intervalP95LagMs: number;
    workletP95LagMs: number;
    intervalP99LoopMs: number;
    workletP99LoopMs: number;
    driftP95ImprovementMs: number;
    driftP99ImprovementMs: number;
    lagP95ImprovementMs: number;
    loopP99ImprovementMs: number;
    winner: 'interval' | 'worklet-clock' | 'tie';
}

export interface AudioPerformanceBenchmarkRunOptions {
    cases?: AudioPerformanceBenchmarkCaseConfig[];
    signal?: AbortSignal;
    onProgress?: (progress: AudioPerformanceBenchmarkProgress) => void;
}

export interface AudioPerformanceGateThresholds {
    maxFailedCases: number;
    maxWarnedCases: number;
    maxWorkletP95TickDriftMs: number;
    maxWorkletP99TickDriftMs: number;
    maxWorkletP95LagMs: number;
    maxWorkletP99LoopMs: number;
    maxWorkletOverrunRatio: number;
    minWorkletWinRate: number;
}

export interface AudioPerformanceGateSummary {
    totalCases: number;
    workletCaseCount: number;
    failedCases: number;
    warnedCases: number;
    maxWorkletP95TickDriftMs: number;
    maxWorkletP99TickDriftMs: number;
    maxWorkletP95LagMs: number;
    maxWorkletP99LoopMs: number;
    maxWorkletOverrunRatio: number;
    workletWinRate: number;
}

export interface AudioPerformanceGateResult {
    status: AudioPerformanceBenchmarkStatus;
    thresholds: AudioPerformanceGateThresholds;
    summary: AudioPerformanceGateSummary;
    failures: string[];
    warnings: string[];
    issues: string[];
}

export interface AudioPerformanceBenchmarkHistoryEntry {
    id: string;
    createdAt: number;
    elapsedMs: number;
    totalCases: number;
    passedCases: number;
    warnedCases: number;
    failedCases: number;
    gateStatus: AudioPerformanceBenchmarkStatus;
    workletWinRate: number;
    maxWorkletP95TickDriftMs: number;
    maxWorkletP99TickDriftMs: number;
    maxWorkletP95LagMs: number;
    maxWorkletP99LoopMs: number;
    recommendedRoute: EngineBackendRoute;
    recommendedRouteImplementationStatus: EngineRouteImplementationStatus;
}

export const DEFAULT_AUDIO_PERFORMANCE_GATE_THRESHOLDS: AudioPerformanceGateThresholds = {
    maxFailedCases: 0,
    maxWarnedCases: 2,
    maxWorkletP95TickDriftMs: 36,
    maxWorkletP99TickDriftMs: 95,
    maxWorkletP95LagMs: 32,
    maxWorkletP99LoopMs: 34,
    maxWorkletOverrunRatio: 0.2,
    minWorkletWinRate: 0.6
};

const BENCHMARK_ROUTES: EngineBackendRoute[] = ['webaudio', 'worker-dsp', 'native-sidecar'];
const BENCHMARK_SCHEDULER_MODES: EngineSchedulerMode[] = ['interval', 'worklet-clock'];

const BASE_SCENARIOS: Array<{
    key: string;
    audioTrackCount: number;
    groupTrackCount: number;
    returnTrackCount: number;
    clipsPerTrack: number;
    durationMs: number;
    bpm: number;
    bars: number;
}> = [
    {
        key: 'medium',
        audioTrackCount: 48,
        groupTrackCount: 4,
        returnTrackCount: 2,
        clipsPerTrack: 2,
        durationMs: 3400,
        bpm: 124,
        bars: 24
    },
    {
        key: 'high',
        audioTrackCount: 96,
        groupTrackCount: 8,
        returnTrackCount: 4,
        clipsPerTrack: 2,
        durationMs: 4200,
        bpm: 126,
        bars: 24
    },
    {
        key: 'extreme',
        audioTrackCount: 160,
        groupTrackCount: 12,
        returnTrackCount: 4,
        clipsPerTrack: 3,
        durationMs: 5200,
        bpm: 128,
        bars: 32
    }
];

const getRouteLabel = (route: EngineBackendRoute): string => {
    if (route === 'worker-dsp') return 'Worker DSP';
    if (route === 'native-sidecar') return 'Native Sidecar';
    return 'WebAudio';
};

const getSchedulerLabel = (mode: EngineSchedulerMode): string => {
    return mode === 'interval' ? 'Interval' : 'Worklet';
};

const DEFAULT_CASES: AudioPerformanceBenchmarkCaseConfig[] = BENCHMARK_ROUTES.flatMap((route) => {
    return BASE_SCENARIOS.flatMap((scenario) => {
        return BENCHMARK_SCHEDULER_MODES.map((schedulerMode) => ({
            id: `${route}-${schedulerMode}-${scenario.key}`,
            label: `${getRouteLabel(route)} · ${getSchedulerLabel(schedulerMode)} · ${scenario.key.toUpperCase()}`,
            route,
            schedulerMode,
            audioTrackCount: scenario.audioTrackCount,
            groupTrackCount: scenario.groupTrackCount,
            returnTrackCount: scenario.returnTrackCount,
            clipsPerTrack: scenario.clipsPerTrack,
            durationMs: scenario.durationMs,
            bpm: scenario.bpm,
            bars: scenario.bars
        }));
    });
});

const createAbortError = (): Error => {
    const error = new Error('Audio performance benchmark aborted');
    error.name = 'AbortError';
    return error;
};

const throwIfAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) {
        throw createAbortError();
    }
};

const wait = (ms: number): Promise<void> => {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
};

const averageOf = (values: number[]): number => {
    if (values.length === 0) return 0;
    const total = values.reduce((acc, value) => acc + value, 0);
    return total / values.length;
};

const percentileOf = (values: number[], percentile: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const clamped = Math.min(1, Math.max(0, percentile));
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * clamped)));
    return sorted[index];
};

const collectRuntimeSnapshot = (): AudioPerformanceRuntimeSnapshot => {
    const runtime = engineAdapter.getRuntimeDiagnostics();
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

const monitorEventLoopLag = async (durationMs: number, signal?: AbortSignal): Promise<AudioPerformanceEventLoopMetrics> => {
    const sampleIntervalMs = 40;
    let expectedAt = performance.now() + sampleIntervalMs;
    const lagSamples: number[] = [];

    const intervalId = window.setInterval(() => {
        const now = performance.now();
        lagSamples.push(Math.max(0, now - expectedAt));
        expectedAt += sampleIntervalMs;
    }, sampleIntervalMs);

    try {
        const start = performance.now();
        while ((performance.now() - start) < durationMs) {
            throwIfAborted(signal);
            await wait(30);
        }
    } finally {
        window.clearInterval(intervalId);
    }

    return {
        samples: lagSamples.length,
        avgLagMs: averageOf(lagSamples),
        p95LagMs: percentileOf(lagSamples, 0.95),
        p99LagMs: percentileOf(lagSamples, 0.99),
        maxLagMs: lagSamples.length > 0 ? Math.max(...lagSamples) : 0
    };
};

const buildBenchmarkTracks = (caseConfig: AudioPerformanceBenchmarkCaseConfig): Track[] => {
    const toneSeconds = Math.max(4, (caseConfig.bars * 4 * 60) / caseConfig.bpm + 2);
    const baseBuffer = engineAdapter.createSineBuffer(220, toneSeconds);

    const returnTracks: Track[] = Array.from({ length: caseConfig.returnTrackCount }, (_value, index) => {
        return createTrack({
            id: `bench-return-${caseConfig.id}-${index + 1}`,
            name: `Benchmark Return ${index + 1}`,
            type: TrackType.RETURN,
            clips: [],
            sessionClips: [],
            devices: [],
            monitor: 'off',
            volume: -8,
            reverb: 0,
            pan: 0
        });
    });

    const groupTracks: Track[] = Array.from({ length: caseConfig.groupTrackCount }, (_value, index) => {
        return createTrack({
            id: `bench-group-${caseConfig.id}-${index + 1}`,
            name: `Benchmark Group ${index + 1}`,
            type: TrackType.GROUP,
            clips: [],
            sessionClips: [],
            devices: [],
            monitor: 'off',
            volume: -3,
            reverb: 0,
            pan: 0
        });
    });

    const groupIds = groupTracks.map((track) => track.id);
    const returnIds = returnTracks.map((track) => track.id);

    const audioTracks: Track[] = Array.from({ length: caseConfig.audioTrackCount }, (_value, trackIndex) => {
        const clips: Clip[] = Array.from({ length: caseConfig.clipsPerTrack }, (_clipValue, clipIndex) => {
            const clipSpacing = Math.max(2, Math.floor(caseConfig.bars / Math.max(1, caseConfig.clipsPerTrack)));
            const start = 1 + (clipIndex * clipSpacing);
            const maxLength = Math.max(1, caseConfig.bars - (start - 1));
            const length = Math.min(clipSpacing + 1, maxLength);

            return {
                id: `bench-clip-${caseConfig.id}-${trackIndex}-${clipIndex}`,
                name: `Bench Clip ${clipIndex + 1}`,
                color: '#2BD9FF',
                notes: [],
                start,
                length,
                offset: 0,
                fadeIn: 0,
                fadeOut: 0,
                gain: 1,
                playbackRate: 1 + ((trackIndex % 6) * 0.03),
                originalBpm: caseConfig.bpm,
                isWarped: (trackIndex + clipIndex) % 11 === 0,
                transpose: ((trackIndex + clipIndex) % 5) - 2,
                buffer: baseBuffer
            };
        });

        const sends: Record<string, number> = {};
        const sendModes: Record<string, 'pre' | 'post'> = {};

        if (returnIds.length > 0) {
            const primarySend = returnIds[trackIndex % returnIds.length];
            sends[primarySend] = Math.min(0.85, 0.18 + ((trackIndex % 7) * 0.08));
            sendModes[primarySend] = trackIndex % 4 === 0 ? 'pre' : 'post';

            if (returnIds.length > 1 && trackIndex % 3 === 0) {
                const secondarySend = returnIds[(trackIndex + 1) % returnIds.length];
                sends[secondarySend] = Math.min(0.75, 0.12 + ((trackIndex % 5) * 0.07));
                sendModes[secondarySend] = 'post';
            }
        }

        return createTrack({
            id: `bench-audio-${caseConfig.id}-${trackIndex + 1}`,
            name: `Benchmark Audio ${trackIndex + 1}`,
            type: TrackType.AUDIO,
            clips,
            sessionClips: [],
            devices: [],
            monitor: 'off',
            volume: -6 + ((trackIndex % 6) * 0.4),
            reverb: trackIndex % 5 === 0 ? 22 : 8,
            pan: ((trackIndex % 11) - 5) * 4,
            groupId: groupIds.length > 0 ? groupIds[trackIndex % groupIds.length] : undefined,
            sends,
            sendModes
        });
    });

    return [...returnTracks, ...groupTracks, ...audioTracks];
};

export const buildAudioPerformanceBenchmarkCases = (): AudioPerformanceBenchmarkCaseConfig[] => {
    return DEFAULT_CASES.map((caseConfig) => ({ ...caseConfig }));
};

const resolveCaseRoute = (caseConfig: AudioPerformanceBenchmarkCaseConfig): EngineBackendRoute => {
    return caseConfig.route || 'webaudio';
};

const deriveScenarioKey = (caseConfig: AudioPerformanceBenchmarkCaseConfig): string => {
    const route = resolveCaseRoute(caseConfig);
    const intervalPrefix = `${route}-interval-`;
    const workletPrefix = `${route}-worklet-clock-`;
    const withRoutePrefix = (value: string): string => route === 'webaudio' ? value : `${route}:${value}`;

    if (caseConfig.id.startsWith(intervalPrefix)) {
        return withRoutePrefix(caseConfig.id.replace(intervalPrefix, ''));
    }

    if (caseConfig.id.startsWith(workletPrefix)) {
        return withRoutePrefix(caseConfig.id.replace(workletPrefix, ''));
    }

    if (caseConfig.id.startsWith('interval-')) {
        return withRoutePrefix(caseConfig.id.replace('interval-', ''));
    }

    if (caseConfig.id.startsWith('worklet-')) {
        return withRoutePrefix(caseConfig.id.replace('worklet-', ''));
    }

    return withRoutePrefix(caseConfig.id);
};

const getStatusWeight = (status: AudioPerformanceBenchmarkStatus): number => {
    if (status === 'fail') return 2;
    if (status === 'warn') return 1;
    return 0;
};

const buildABComparisons = (
    results: AudioPerformanceBenchmarkCaseResult[]
): AudioPerformanceBenchmarkABComparison[] => {
    const scenarios = new Map<string, {
        interval?: AudioPerformanceBenchmarkCaseResult;
        worklet?: AudioPerformanceBenchmarkCaseResult;
    }>();

    results.forEach((result) => {
        const scenarioKey = deriveScenarioKey(result.caseConfig);
        const current = scenarios.get(scenarioKey) || {};

        if (result.caseConfig.schedulerMode === 'interval') {
            current.interval = result;
        } else if (result.caseConfig.schedulerMode === 'worklet-clock') {
            current.worklet = result;
        }

        scenarios.set(scenarioKey, current);
    });

    const comparisons: AudioPerformanceBenchmarkABComparison[] = [];

    scenarios.forEach((entry, scenarioKey) => {
        if (!entry.interval || !entry.worklet) return;

        const interval = entry.interval;
        const worklet = entry.worklet;

        const driftP95ImprovementMs = interval.metrics.scheduler.p95TickDriftMs - worklet.metrics.scheduler.p95TickDriftMs;
        const driftP99ImprovementMs = interval.metrics.scheduler.p99TickDriftMs - worklet.metrics.scheduler.p99TickDriftMs;
        const lagP95ImprovementMs = interval.metrics.eventLoop.p95LagMs - worklet.metrics.eventLoop.p95LagMs;
        const loopP99ImprovementMs = interval.metrics.scheduler.p99LoopMs - worklet.metrics.scheduler.p99LoopMs;

        const intervalScore =
            interval.metrics.scheduler.p95TickDriftMs
            + interval.metrics.scheduler.p99TickDriftMs
            + interval.metrics.eventLoop.p95LagMs
            + interval.metrics.scheduler.p99LoopMs
            + (getStatusWeight(interval.status) * 250);

        const workletScore =
            worklet.metrics.scheduler.p95TickDriftMs
            + worklet.metrics.scheduler.p99TickDriftMs
            + worklet.metrics.eventLoop.p95LagMs
            + worklet.metrics.scheduler.p99LoopMs
            + (getStatusWeight(worklet.status) * 250);

        let winner: 'interval' | 'worklet-clock' | 'tie' = 'tie';
        const delta = intervalScore - workletScore;
        if (Math.abs(delta) > 1) {
            winner = delta < 0 ? 'interval' : 'worklet-clock';
        }

        comparisons.push({
            scenarioKey,
            intervalCaseId: interval.caseConfig.id,
            workletCaseId: worklet.caseConfig.id,
            intervalStatus: interval.status,
            workletStatus: worklet.status,
            intervalP95DriftMs: interval.metrics.scheduler.p95TickDriftMs,
            workletP95DriftMs: worklet.metrics.scheduler.p95TickDriftMs,
            intervalP99DriftMs: interval.metrics.scheduler.p99TickDriftMs,
            workletP99DriftMs: worklet.metrics.scheduler.p99TickDriftMs,
            intervalP95LagMs: interval.metrics.eventLoop.p95LagMs,
            workletP95LagMs: worklet.metrics.eventLoop.p95LagMs,
            intervalP99LoopMs: interval.metrics.scheduler.p99LoopMs,
            workletP99LoopMs: worklet.metrics.scheduler.p99LoopMs,
            driftP95ImprovementMs,
            driftP99ImprovementMs,
            lagP95ImprovementMs,
            loopP99ImprovementMs,
            winner
        });
    });

    return comparisons.sort((a, b) => a.scenarioKey.localeCompare(b.scenarioKey));
};

const computeRouteSnapshot = (results: AudioPerformanceBenchmarkCaseResult[]): {
    cpuAudioP95: number;
    dropouts: number;
    driftP99: number;
    monitorLatencyP95Ms: number;
} => {
    if (results.length === 0) {
        return {
            cpuAudioP95: 0,
            dropouts: 0,
            driftP99: 0,
            monitorLatencyP95Ms: 0
        };
    }

    const cpuAudioP95 = results.reduce((max, result) => {
        return Math.max(max, result.metrics.scheduler.p95CpuLoadPercent || 0);
    }, 0);

    const dropouts = results.reduce((max, result) => {
        const dropoutCount = result.metrics.scheduler.dropoutCount
            ?? result.metrics.diagnostics.schedulerDropoutCount
            ?? 0;
        return Math.max(max, dropoutCount);
    }, 0);

    const driftP99 = results.reduce((max, result) => {
        return Math.max(max, result.metrics.scheduler.p99TickDriftMs);
    }, 0);

    const monitorLatencyP95Ms = results.reduce((max, result) => {
        return Math.max(max, (result.metrics.diagnostics.latency || 0) * 1000);
    }, 0);

    return {
        cpuAudioP95,
        dropouts,
        driftP99,
        monitorLatencyP95Ms
    };
};

const buildRouteEvaluations = (results: AudioPerformanceBenchmarkCaseResult[]): Block1RouteEvaluation[] => {
    const perRoute = new Map<EngineBackendRoute, AudioPerformanceBenchmarkCaseResult[]>();

    results.forEach((result) => {
        const route = result.route || resolveCaseRoute(result.caseConfig);
        const current = perRoute.get(route) || [];
        current.push(result);
        perRoute.set(route, current);
    });

    const baselineSnapshot = computeRouteSnapshot(perRoute.get('webaudio') || []);
    const baselineCpu = Math.max(0.0001, baselineSnapshot.cpuAudioP95);
    const baselineDropouts = Math.max(1, baselineSnapshot.dropouts);

    const evaluations: Block1RouteEvaluation[] = BENCHMARK_ROUTES.map((route) => {
        const routeResults = perRoute.get(route) || [];
        const routeSnapshot = computeRouteSnapshot(routeResults);
        const implementationStatus = engineAdapter.getBackendImplementationStatus(route);

        const cpuAudioP95ImprovementRatio = baselineSnapshot.cpuAudioP95 > 0
            ? Math.max(-1, (baselineSnapshot.cpuAudioP95 - routeSnapshot.cpuAudioP95) / baselineCpu)
            : 0;

        const dropoutReductionRatio = baselineSnapshot.dropouts > 0
            ? Math.max(-1, (baselineSnapshot.dropouts - routeSnapshot.dropouts) / baselineDropouts)
            : 0;

        const notes: string[] = [];
        if (implementationStatus === 'simulated') {
            notes.push('Ruta simulada sobre backend webaudio para comparacion tecnica.');
        }

        if (routeResults.length === 0) {
            notes.push('Sin resultados de benchmark para esta ruta.');
        }

        const passesGate =
            cpuAudioP95ImprovementRatio >= 0.25
            && dropoutReductionRatio >= 0.6
            && routeSnapshot.driftP99 <= 5
            && routeSnapshot.monitorLatencyP95Ms <= 12;

        if (!passesGate && notes.length === 0) {
            notes.push('No supera gate de Bloque 1 con los umbrales actuales.');
        }

        return {
            route,
            implementationStatus,
            cpuAudioP95Ms: routeSnapshot.cpuAudioP95,
            cpuAudioP95ImprovementRatio,
            dropouts: routeSnapshot.dropouts,
            dropoutReductionRatio,
            driftP99Ms: routeSnapshot.driftP99,
            monitorLatencyP95Ms: routeSnapshot.monitorLatencyP95Ms,
            passesGate,
            notes
        };
    });

    return evaluations;
};

const chooseRecommendedRoute = (evaluations: Block1RouteEvaluation[]): EngineBackendRoute => {
    const passingNative = evaluations
        .filter((entry) => entry.passesGate && entry.implementationStatus === 'native')
        .sort((a, b) => b.cpuAudioP95ImprovementRatio - a.cpuAudioP95ImprovementRatio);

    if (passingNative.length > 0) {
        return passingNative[0].route;
    }

    const passingAny = evaluations
        .filter((entry) => entry.passesGate)
        .sort((a, b) => b.cpuAudioP95ImprovementRatio - a.cpuAudioP95ImprovementRatio);

    if (passingAny.length > 0) {
        return passingAny[0].route;
    }

    return 'webaudio';
};

const summarizePerformanceReport = (report: AudioPerformanceBenchmarkReport): AudioPerformanceGateSummary => {
    const workletResults = report.results.filter((result) => result.caseConfig.schedulerMode === 'worklet-clock');
    const workletCaseCount = workletResults.length;

    const maxWorkletP95TickDriftMs = workletResults.reduce((max, result) => {
        return Math.max(max, result.metrics.scheduler.p95TickDriftMs);
    }, 0);

    const maxWorkletP99TickDriftMs = workletResults.reduce((max, result) => {
        return Math.max(max, result.metrics.scheduler.p99TickDriftMs);
    }, 0);

    const maxWorkletP95LagMs = workletResults.reduce((max, result) => {
        return Math.max(max, result.metrics.eventLoop.p95LagMs);
    }, 0);

    const maxWorkletP99LoopMs = workletResults.reduce((max, result) => {
        return Math.max(max, result.metrics.scheduler.p99LoopMs);
    }, 0);

    const maxWorkletOverrunRatio = workletResults.reduce((max, result) => {
        const ratio = result.metrics.scheduler.tickCount > 0
            ? result.metrics.scheduler.overrunCount / result.metrics.scheduler.tickCount
            : 0;
        return Math.max(max, ratio);
    }, 0);

    const completedComparisons = report.comparisons.filter((comparison) => {
        return comparison.winner === 'interval' || comparison.winner === 'worklet-clock';
    });

    const workletWins = completedComparisons.filter((comparison) => comparison.winner === 'worklet-clock').length;
    const workletWinRate = completedComparisons.length > 0
        ? workletWins / completedComparisons.length
        : 0;

    return {
        totalCases: report.totalCases,
        workletCaseCount,
        failedCases: report.failedCases,
        warnedCases: report.warnedCases,
        maxWorkletP95TickDriftMs,
        maxWorkletP99TickDriftMs,
        maxWorkletP95LagMs,
        maxWorkletP99LoopMs,
        maxWorkletOverrunRatio,
        workletWinRate
    };
};

export const evaluateAudioPerformanceGate = (
    report: AudioPerformanceBenchmarkReport,
    thresholds: AudioPerformanceGateThresholds = DEFAULT_AUDIO_PERFORMANCE_GATE_THRESHOLDS
): AudioPerformanceGateResult => {
    const summary = summarizePerformanceReport(report);
    const failures: string[] = [];
    const warnings: string[] = [];

    if (summary.totalCases <= 0 || summary.workletCaseCount <= 0) {
        failures.push('Benchmark invalido: no contiene escenarios suficientes para validar performance.');
    }

    if (summary.failedCases > thresholds.maxFailedCases) {
        failures.push(`Casos FAIL excedidos (${summary.failedCases}/${thresholds.maxFailedCases}).`);
    }

    if (summary.warnedCases > thresholds.maxWarnedCases) {
        warnings.push(`Casos WARN por encima del objetivo (${summary.warnedCases}/${thresholds.maxWarnedCases}).`);
    }

    if (summary.maxWorkletP95TickDriftMs > thresholds.maxWorkletP95TickDriftMs) {
        failures.push(`Worklet drift p95 fuera de presupuesto (${summary.maxWorkletP95TickDriftMs.toFixed(1)}ms > ${thresholds.maxWorkletP95TickDriftMs.toFixed(1)}ms).`);
    }

    if (summary.maxWorkletP99TickDriftMs > thresholds.maxWorkletP99TickDriftMs) {
        failures.push(`Worklet drift p99 fuera de presupuesto (${summary.maxWorkletP99TickDriftMs.toFixed(1)}ms > ${thresholds.maxWorkletP99TickDriftMs.toFixed(1)}ms).`);
    }

    if (summary.maxWorkletP95LagMs > thresholds.maxWorkletP95LagMs) {
        warnings.push(`Worklet lag p95 elevado (${summary.maxWorkletP95LagMs.toFixed(1)}ms > ${thresholds.maxWorkletP95LagMs.toFixed(1)}ms).`);
    }

    if (summary.maxWorkletP99LoopMs > thresholds.maxWorkletP99LoopMs) {
        warnings.push(`Worklet loop p99 elevado (${summary.maxWorkletP99LoopMs.toFixed(1)}ms > ${thresholds.maxWorkletP99LoopMs.toFixed(1)}ms).`);
    }

    if (summary.maxWorkletOverrunRatio > thresholds.maxWorkletOverrunRatio) {
        warnings.push(`Worklet overrun ratio elevado (${(summary.maxWorkletOverrunRatio * 100).toFixed(1)}% > ${(thresholds.maxWorkletOverrunRatio * 100).toFixed(1)}%).`);
    }

    if (report.comparisons.length === 0) {
        warnings.push('Benchmark sin pares A/B completos; no se pudo estimar win-rate de worklet.');
    } else if (summary.workletWinRate < thresholds.minWorkletWinRate) {
        failures.push(`Worklet win-rate insuficiente (${(summary.workletWinRate * 100).toFixed(1)}% < ${(thresholds.minWorkletWinRate * 100).toFixed(1)}%).`);
    }

    const status: AudioPerformanceBenchmarkStatus = failures.length > 0
        ? 'fail'
        : warnings.length > 0
            ? 'warn'
            : 'pass';

    return {
        status,
        thresholds,
        summary,
        failures,
        warnings,
        issues: [...failures, ...warnings]
    };
};

export const createAudioPerformanceBenchmarkHistoryEntry = (
    report: AudioPerformanceBenchmarkReport,
    gateResult?: AudioPerformanceGateResult
): AudioPerformanceBenchmarkHistoryEntry => {
    const gate = gateResult || evaluateAudioPerformanceGate(report);

    return {
        id: `bench-${report.finishedAt}-${Math.round(report.elapsedMs)}`,
        createdAt: report.finishedAt,
        elapsedMs: report.elapsedMs,
        totalCases: report.totalCases,
        passedCases: report.passedCases,
        warnedCases: report.warnedCases,
        failedCases: report.failedCases,
        gateStatus: gate.status,
        workletWinRate: gate.summary.workletWinRate,
        maxWorkletP95TickDriftMs: gate.summary.maxWorkletP95TickDriftMs,
        maxWorkletP99TickDriftMs: gate.summary.maxWorkletP99TickDriftMs,
        maxWorkletP95LagMs: gate.summary.maxWorkletP95LagMs,
        maxWorkletP99LoopMs: gate.summary.maxWorkletP99LoopMs,
        recommendedRoute: report.recommendedRoute || 'webaudio',
        recommendedRouteImplementationStatus: engineAdapter.getBackendImplementationStatus(report.recommendedRoute || 'webaudio')
    };
};

export const assessAudioPerformanceBenchmarkCase = (
    caseConfig: AudioPerformanceBenchmarkCaseConfig,
    metrics: AudioPerformanceBenchmarkCaseMetrics
): AudioPerformanceBenchmarkAssessment => {
    const criticalIssues: string[] = [];
    const warnings: string[] = [];

    if (metrics.diagnostics.state !== 'running') {
        criticalIssues.push(`AudioContext no esta en running (estado: ${metrics.diagnostics.state}).`);
    }

    if (metrics.runtime.contextState !== 'running' || !metrics.runtime.hasMasterGraph) {
        criticalIssues.push('Runtime detecta contexto no operativo o master graph incompleto.');
    }

    if (metrics.scheduler.tickCount < 12) {
        criticalIssues.push(`Scheduler ticks insuficientes (${metrics.scheduler.tickCount}).`);
    }

    if (metrics.scheduler.p99TickDriftMs > 160 || metrics.eventLoop.maxLagMs > 180) {
        criticalIssues.push(`Jitter extremo detectado (drift p99=${metrics.scheduler.p99TickDriftMs.toFixed(1)}ms, event-loop max=${metrics.eventLoop.maxLagMs.toFixed(1)}ms).`);
    }

    if (metrics.scheduler.p95TickDriftMs > 48) {
        warnings.push(`Drift p95 alto (${metrics.scheduler.p95TickDriftMs.toFixed(1)}ms).`);
    }

    if (metrics.scheduler.p99LoopMs > 36) {
        warnings.push(`Loop scheduler p99 alto (${metrics.scheduler.p99LoopMs.toFixed(1)}ms).`);
    }

    const overrunRatio = metrics.scheduler.tickCount > 0
        ? metrics.scheduler.overrunCount / metrics.scheduler.tickCount
        : 0;
    if (overrunRatio > 0.2) {
        warnings.push(`Overrun ratio elevado (${(overrunRatio * 100).toFixed(1)}%).`);
    }

    if (metrics.eventLoop.p95LagMs > 32) {
        warnings.push(`Lag de event loop p95 elevado (${metrics.eventLoop.p95LagMs.toFixed(1)}ms).`);
    }

    if (metrics.graphUpdate.trackCount < caseConfig.audioTrackCount) {
        warnings.push('Graph update reporta menos pistas de las esperadas en el escenario.');
    }

    const status: AudioPerformanceBenchmarkStatus = criticalIssues.length > 0
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

export const runAudioPerformanceBenchmark = async (
    options: AudioPerformanceBenchmarkRunOptions = {}
): Promise<AudioPerformanceBenchmarkReport> => {
    const cases = options.cases && options.cases.length > 0
        ? options.cases
        : buildAudioPerformanceBenchmarkCases();

    const startedAt = Date.now();
    const initialSettings = engineAdapter.getSettings();
    const initialSchedulerMode = engineAdapter.getSchedulerMode();
    const initialRoute = engineAdapter.getBackendRoute();
    const results: AudioPerformanceBenchmarkCaseResult[] = [];
    let aborted = false;
    let restoreFailed = false;
    let restoreError: string | null = null;

    const progress = (
        runningCaseId: string | null,
        runningCaseLabel: string | null,
        lastResult: AudioPerformanceBenchmarkCaseResult | null
    ) => {
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
            progress(caseConfig.id, caseConfig.label, null);

            try {
                throwIfAborted(options.signal);
                const caseStartedAt = Date.now();

                const nextSettings: AudioSettings = {
                    ...initialSettings,
                    sampleRate: caseConfig.sampleRate ?? initialSettings.sampleRate,
                    bufferSize: caseConfig.bufferSize ?? initialSettings.bufferSize,
                    latencyHint: caseConfig.latencyHint ?? initialSettings.latencyHint
                };
                const route = resolveCaseRoute(caseConfig);
                const routeImplementationStatus = engineAdapter.getBackendImplementationStatus(route);

                engineAdapter.setBackendRoute(route);
                await engineAdapter.restartEngine(nextSettings);
                engineAdapter.setSchedulerMode(caseConfig.schedulerMode);
                await wait(140);
                throwIfAborted(options.signal);

                const benchmarkTracks = buildBenchmarkTracks(caseConfig);
                engineAdapter.updateTracks(benchmarkTracks);
                engineAdapter.play(benchmarkTracks, caseConfig.bpm, 0, 0);

                const eventLoop = await monitorEventLoopLag(caseConfig.durationMs, options.signal);

                const metrics: AudioPerformanceBenchmarkCaseMetrics = {
                    diagnostics: engineAdapter.getDiagnostics(),
                    runtime: collectRuntimeSnapshot(),
                    scheduler: engineAdapter.getSchedulerTelemetry(),
                    eventLoop,
                    graphUpdate: engineAdapter.getLastGraphUpdateStats()
                };

                engineAdapter.stop(false);
                engineAdapter.updateTracks([]);

                const assessment = assessAudioPerformanceBenchmarkCase(caseConfig, metrics);
                const warnings = [...assessment.warnings];
                if (routeImplementationStatus === 'simulated') {
                    warnings.push('Ruta simulada: resultado util para comparacion tecnica, no para decision final de migracion.');
                }
                const result: AudioPerformanceBenchmarkCaseResult = {
                    caseConfig,
                    route,
                    routeImplementationStatus,
                    status: assessment.status,
                    metrics,
                    issues: assessment.issues,
                    criticalIssues: assessment.criticalIssues,
                    warnings,
                    elapsedMs: Date.now() - caseStartedAt
                };

                results.push(result);
                progress(null, null, result);
            } catch (error) {
                engineAdapter.stop(false);

                if (error instanceof Error && error.name === 'AbortError') {
                    aborted = true;
                    break;
                }

                const diagnostics = engineAdapter.getDiagnostics();
                const runtime = collectRuntimeSnapshot();
                const scheduler = engineAdapter.getSchedulerTelemetry();
                const graphUpdate = engineAdapter.getLastGraphUpdateStats();
                const failMessage = error instanceof Error
                    ? error.message
                    : 'Fallo desconocido en benchmark de performance.';
                const route = resolveCaseRoute(caseConfig);
                const routeImplementationStatus = engineAdapter.getBackendImplementationStatus(route);

                const result: AudioPerformanceBenchmarkCaseResult = {
                    caseConfig,
                    route,
                    routeImplementationStatus,
                    status: 'fail',
                    metrics: {
                        diagnostics,
                        runtime,
                        scheduler,
                        graphUpdate,
                        eventLoop: {
                            samples: 0,
                            avgLagMs: 0,
                            p95LagMs: 0,
                            p99LagMs: 0,
                            maxLagMs: 0
                        }
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
            engineAdapter.stop(true);
            engineAdapter.setBackendRoute(initialRoute);
            engineAdapter.setSchedulerMode(initialSchedulerMode);
            await engineAdapter.restartEngine(initialSettings);
        } catch (error) {
            restoreFailed = true;
            restoreError = error instanceof Error
                ? error.message
                : 'No se pudo restaurar la configuracion original del motor tras benchmark.';
        }
    }

    const finishedAt = Date.now();
    const passedCases = results.filter((result) => result.status === 'pass').length;
    const warnedCases = results.filter((result) => result.status === 'warn').length;
    const failedCases = results.filter((result) => result.status === 'fail').length;
    const comparisons = buildABComparisons(results);
    const routeEvaluations = buildRouteEvaluations(results);
    const recommendedRoute = chooseRecommendedRoute(routeEvaluations);

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
        comparisons,
        routeEvaluations,
        recommendedRoute,
        results
    };
};


