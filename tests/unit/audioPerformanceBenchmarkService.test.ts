import { describe, expect, it, vi } from 'vitest';
import { audioEngine, EngineDiagnostics, SchedulerTelemetrySnapshot } from '../../services/audioEngine';
import {
    assessAudioPerformanceBenchmarkCase,
    buildAudioPerformanceBenchmarkCases,
    createAudioPerformanceBenchmarkHistoryEntry,
    DEFAULT_AUDIO_PERFORMANCE_GATE_THRESHOLDS,
    evaluateAudioPerformanceGate,
    runAudioPerformanceBenchmark
} from '../../services/audioPerformanceBenchmarkService';

const createDiagnostics = (overrides: Partial<EngineDiagnostics> = {}): EngineDiagnostics => ({
    sampleRate: 48000,
    latency: 0.01,
    state: 'running',
    requestedSampleRate: 48000,
    activeSampleRate: 48000,
    sampleRateMismatch: false,
    sampleRateMismatchMessage: null,
    highLoadDetected: false,
    profileSuggestion: null,
    configuredBufferSize: 256,
    effectiveBufferSize: 256,
    bufferStrategy: 'fixed',
    lookaheadMs: 25,
    scheduleAheadTimeMs: 100,
    ...overrides
});

const createSchedulerTelemetry = (overrides: Partial<SchedulerTelemetrySnapshot> = {}): SchedulerTelemetrySnapshot => ({
    mode: 'worklet-clock',
    tickCount: 42,
    skippedTicks: 0,
    avgLoopMs: 3.1,
    p95LoopMs: 7.5,
    p99LoopMs: 11.2,
    avgTickIntervalMs: 25.3,
    p95TickIntervalMs: 33.4,
    p99TickIntervalMs: 39.7,
    avgTickDriftMs: 3.4,
    p95TickDriftMs: 10.2,
    p99TickDriftMs: 18.4,
    maxTickDriftMs: 23.1,
    overrunCount: 1,
    lastTickAtMs: 123456,
    windowSamples: 120,
    ...overrides
});

describe('audioPerformanceBenchmarkService', () => {
    it('builds paired interval/worklet benchmark cases', () => {
        const cases = buildAudioPerformanceBenchmarkCases();

        expect(cases.length).toBeGreaterThanOrEqual(6);
        expect(cases.some((caseConfig) => caseConfig.schedulerMode === 'interval')).toBe(true);
        expect(cases.some((caseConfig) => caseConfig.schedulerMode === 'worklet-clock')).toBe(true);
    });

    it('classifies healthy benchmark as pass', () => {
        const assessment = assessAudioPerformanceBenchmarkCase(
            {
                id: 'worklet-medium',
                label: 'Worklet Medium',
                schedulerMode: 'worklet-clock',
                audioTrackCount: 48,
                groupTrackCount: 4,
                returnTrackCount: 2,
                clipsPerTrack: 2,
                durationMs: 1200,
                bpm: 124,
                bars: 16
            },
            {
                diagnostics: createDiagnostics(),
                runtime: {
                    contextState: 'running',
                    hasMasterGraph: true,
                    activeSourceCount: 12,
                    trackNodeCount: 54,
                    masterVolumeDb: -2,
                    cueTrackId: null,
                    cueMode: null
                },
                scheduler: createSchedulerTelemetry(),
                eventLoop: {
                    samples: 30,
                    avgLagMs: 2.8,
                    p95LagMs: 12,
                    p99LagMs: 18,
                    maxLagMs: 23
                },
                graphUpdate: {
                    updatedAt: Date.now(),
                    trackCount: 54,
                    removedTrackCount: 0,
                    createdTrackCount: 0,
                    mixParamWrites: 12,
                    sendLevelWrites: 18,
                    sendNodeCreates: 0,
                    sendNodeRemovals: 0,
                    routingReconnects: 0,
                    inputConnectOps: 0,
                    inputDisconnectOps: 0,
                    deviceChainRebuilds: 0
                }
            }
        );

        expect(assessment.status).toBe('pass');
        expect(assessment.issues).toHaveLength(0);
    });

    it('classifies extreme jitter as fail', () => {
        const assessment = assessAudioPerformanceBenchmarkCase(
            {
                id: 'interval-extreme',
                label: 'Interval Extreme',
                schedulerMode: 'interval',
                audioTrackCount: 160,
                groupTrackCount: 12,
                returnTrackCount: 4,
                clipsPerTrack: 3,
                durationMs: 1200,
                bpm: 128,
                bars: 24
            },
            {
                diagnostics: createDiagnostics({ state: 'running' }),
                runtime: {
                    contextState: 'running',
                    hasMasterGraph: true,
                    activeSourceCount: 120,
                    trackNodeCount: 176,
                    masterVolumeDb: -2,
                    cueTrackId: null,
                    cueMode: null
                },
                scheduler: createSchedulerTelemetry({
                    tickCount: 14,
                    p99TickDriftMs: 220,
                    p95TickDriftMs: 140
                }),
                eventLoop: {
                    samples: 28,
                    avgLagMs: 42,
                    p95LagMs: 120,
                    p99LagMs: 190,
                    maxLagMs: 240
                },
                graphUpdate: {
                    updatedAt: Date.now(),
                    trackCount: 176,
                    removedTrackCount: 0,
                    createdTrackCount: 0,
                    mixParamWrites: 800,
                    sendLevelWrites: 650,
                    sendNodeCreates: 0,
                    sendNodeRemovals: 0,
                    routingReconnects: 0,
                    inputConnectOps: 0,
                    inputDisconnectOps: 0,
                    deviceChainRebuilds: 0
                }
            }
        );

        expect(assessment.status).toBe('fail');
        expect(assessment.criticalIssues.length).toBeGreaterThan(0);
    });

    it('fails performance gate when worklet metrics exceed budget', () => {
        const gate = evaluateAudioPerformanceGate({
            startedAt: 1,
            finishedAt: 2,
            elapsedMs: 1,
            totalCases: 2,
            passedCases: 1,
            warnedCases: 0,
            failedCases: 1,
            aborted: false,
            restoreFailed: false,
            restoreError: null,
            comparisons: [
                {
                    scenarioKey: 'stress',
                    intervalCaseId: 'interval-stress',
                    workletCaseId: 'worklet-stress',
                    intervalStatus: 'pass',
                    workletStatus: 'fail',
                    intervalP95DriftMs: 18,
                    workletP95DriftMs: 64,
                    intervalP99DriftMs: 42,
                    workletP99DriftMs: 180,
                    intervalP95LagMs: 16,
                    workletP95LagMs: 58,
                    intervalP99LoopMs: 12,
                    workletP99LoopMs: 41,
                    driftP95ImprovementMs: -46,
                    driftP99ImprovementMs: -138,
                    lagP95ImprovementMs: -42,
                    loopP99ImprovementMs: -29,
                    winner: 'interval'
                }
            ],
            results: [
                {
                    caseConfig: {
                        id: 'worklet-stress',
                        label: 'Worklet Stress',
                        schedulerMode: 'worklet-clock',
                        audioTrackCount: 40,
                        groupTrackCount: 4,
                        returnTrackCount: 2,
                        clipsPerTrack: 2,
                        durationMs: 1000,
                        bpm: 124,
                        bars: 16
                    },
                    status: 'fail',
                    metrics: {
                        diagnostics: createDiagnostics({ state: 'running' }),
                        runtime: {
                            contextState: 'running',
                            hasMasterGraph: true,
                            activeSourceCount: 20,
                            trackNodeCount: 48,
                            masterVolumeDb: -2,
                            cueTrackId: null,
                            cueMode: null
                        },
                        scheduler: createSchedulerTelemetry({
                            mode: 'worklet-clock',
                            p95TickDriftMs: 64,
                            p99TickDriftMs: 180,
                            p99LoopMs: 41,
                            overrunCount: 20,
                            tickCount: 50
                        }),
                        eventLoop: {
                            samples: 20,
                            avgLagMs: 14,
                            p95LagMs: 58,
                            p99LagMs: 78,
                            maxLagMs: 96
                        },
                        graphUpdate: {
                            updatedAt: Date.now(),
                            trackCount: 48,
                            removedTrackCount: 0,
                            createdTrackCount: 0,
                            mixParamWrites: 0,
                            sendLevelWrites: 0,
                            sendNodeCreates: 0,
                            sendNodeRemovals: 0,
                            routingReconnects: 0,
                            inputConnectOps: 0,
                            inputDisconnectOps: 0,
                            deviceChainRebuilds: 0
                        }
                    },
                    issues: [],
                    criticalIssues: [],
                    warnings: [],
                    elapsedMs: 200
                }
            ]
        });

        expect(gate.status).toBe('fail');
        expect(gate.failures.length).toBeGreaterThan(0);
    });

    it('runs benchmark flow and restores engine settings + scheduler mode', async () => {
        const initialSettings = {
            sampleRate: 48000,
            bufferSize: 'auto',
            latencyHint: 'interactive'
        } as const;

        const restartSpy = vi.spyOn(audioEngine, 'restartEngine').mockResolvedValue();
        const schedulerModeSpy = vi.spyOn(audioEngine, 'setSchedulerMode').mockImplementation(() => { });
        vi.spyOn(audioEngine, 'getSchedulerMode').mockReturnValue('interval');
        vi.spyOn(audioEngine, 'getSettings').mockReturnValue({ ...initialSettings });
        vi.spyOn(audioEngine, 'createSineBuffer').mockReturnValue({
            duration: 4,
            length: 192000,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(192000)
        } as unknown as AudioBuffer);
        vi.spyOn(audioEngine, 'updateTracks').mockImplementation(() => { });
        vi.spyOn(audioEngine, 'play').mockImplementation(() => { });
        vi.spyOn(audioEngine, 'stop').mockImplementation(() => { });
        vi.spyOn(audioEngine, 'getDiagnostics').mockReturnValue(createDiagnostics());
        vi.spyOn(audioEngine, 'getRuntimeDiagnostics').mockReturnValue({
            contextState: 'running',
            hasMasterGraph: true,
            activeSourceCount: 8,
            trackNodeCount: 28,
            masterVolumeDb: -2,
            cueTrackId: null,
            cueMode: null
        });
        vi.spyOn(audioEngine, 'getSchedulerTelemetry').mockReturnValue(createSchedulerTelemetry());
        vi.spyOn(audioEngine, 'getLastGraphUpdateStats').mockReturnValue({
            updatedAt: Date.now(),
            trackCount: 28,
            removedTrackCount: 0,
            createdTrackCount: 28,
            mixParamWrites: 12,
            sendLevelWrites: 16,
            sendNodeCreates: 10,
            sendNodeRemovals: 0,
            routingReconnects: 2,
            inputConnectOps: 0,
            inputDisconnectOps: 0,
            deviceChainRebuilds: 0
        });

        const report = await runAudioPerformanceBenchmark({
            cases: [
                {
                    id: 'interval-quick',
                    label: 'Quick A',
                    schedulerMode: 'interval',
                    audioTrackCount: 8,
                    groupTrackCount: 2,
                    returnTrackCount: 1,
                    clipsPerTrack: 1,
                    durationMs: 120,
                    bpm: 124,
                    bars: 8
                },
                {
                    id: 'worklet-quick',
                    label: 'Quick B',
                    schedulerMode: 'worklet-clock',
                    audioTrackCount: 8,
                    groupTrackCount: 2,
                    returnTrackCount: 1,
                    clipsPerTrack: 1,
                    durationMs: 120,
                    bpm: 124,
                    bars: 8
                }
            ]
        });

        expect(report.totalCases).toBe(2);
        expect(report.results).toHaveLength(2);
        expect(report.comparisons).toHaveLength(1);
        expect(report.comparisons[0].scenarioKey).toBe('quick');

        const gate = evaluateAudioPerformanceGate(report, {
            ...DEFAULT_AUDIO_PERFORMANCE_GATE_THRESHOLDS,
            minWorkletWinRate: 0
        });
        expect(gate.status).toBe('pass');
        expect(gate.failures).toHaveLength(0);

        const historyEntry = createAudioPerformanceBenchmarkHistoryEntry(report, gate);
        expect(historyEntry.gateStatus).toBe('pass');
        expect(historyEntry.totalCases).toBe(2);
        expect(historyEntry.workletWinRate).toBeGreaterThanOrEqual(0);

        expect(report.restoreFailed).toBe(false);
        expect(restartSpy).toHaveBeenCalledTimes(3);
        expect(schedulerModeSpy).toHaveBeenCalledWith('interval');
    });
});
