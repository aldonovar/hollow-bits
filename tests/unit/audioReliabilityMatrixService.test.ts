import { describe, expect, it, vi } from 'vitest';
import { audioEngine, EngineDiagnostics } from '../../services/audioEngine';
import {
    assessAudioReliabilityCase,
    AudioReliabilityRuntimeSnapshot,
    buildAudioReliabilityMatrixCases,
    runAudioReliabilityMatrix
} from '../../services/audioReliabilityMatrixService';

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
    lookaheadMs: 20,
    scheduleAheadTimeMs: 80,
    ...overrides
});

const createRuntime = (overrides: Partial<AudioReliabilityRuntimeSnapshot> = {}): AudioReliabilityRuntimeSnapshot => ({
    contextState: 'running',
    hasMasterGraph: true,
    activeSourceCount: 0,
    trackNodeCount: 1,
    masterVolumeDb: -2,
    cueTrackId: null,
    cueMode: null,
    ...overrides
});

describe('audioReliabilityMatrixService', () => {
    it('builds full SR x buffer matrix including auto latency variants', () => {
        const cases = buildAudioReliabilityMatrixCases();
        expect(cases).toHaveLength(40);

        const autoCase = cases.find((caseConfig) => caseConfig.id === 'sr-48000_buf-auto_lh-balanced');
        expect(autoCase).toBeDefined();

        const fixedCase = cases.find((caseConfig) => caseConfig.id === 'sr-96000_buf-1024_lh-interactive');
        expect(fixedCase).toBeDefined();
    });

    it('classifies healthy case as pass', () => {
        const assessment = assessAudioReliabilityCase(
            createDiagnostics(),
            createRuntime(),
            {
                durationSeconds: 2,
                expectedDurationSeconds: 2,
                durationDeltaMs: 4,
                peakLinear: 0.42,
                peakDb: -7.53,
                rmsLinear: 0.19,
                rmsDb: -14.42,
                isSilent: false
            },
            {
                id: 'sr-48000_buf-256_lh-interactive',
                sampleRate: 48000,
                bufferSize: 256,
                latencyHint: 'interactive'
            }
        );

        expect(assessment.status).toBe('pass');
        expect(assessment.issues).toHaveLength(0);
    });

    it('classifies sample-rate mismatch as warning when audio still valid', () => {
        const assessment = assessAudioReliabilityCase(
            createDiagnostics({
                sampleRateMismatch: true,
                sampleRateMismatchMessage: 'solicitado 96000, activo 48000'
            }),
            createRuntime(),
            {
                durationSeconds: 2,
                expectedDurationSeconds: 2,
                durationDeltaMs: 3,
                peakLinear: 0.5,
                peakDb: -6.02,
                rmsLinear: 0.21,
                rmsDb: -13.55,
                isSilent: false
            },
            {
                id: 'sr-96000_buf-512_lh-interactive',
                sampleRate: 96000,
                bufferSize: 512,
                latencyHint: 'interactive'
            }
        );

        expect(assessment.status).toBe('warn');
        expect(assessment.warnings.some((warning) => warning.includes('solicitado'))).toBe(true);
    });

    it('classifies silent or non-running context as fail', () => {
        const assessment = assessAudioReliabilityCase(
            createDiagnostics({ state: 'suspended' }),
            createRuntime({ contextState: 'closed', hasMasterGraph: false }),
            {
                durationSeconds: 2,
                expectedDurationSeconds: 2,
                durationDeltaMs: 2,
                peakLinear: 0,
                peakDb: -160,
                rmsLinear: 0,
                rmsDb: -160,
                isSilent: true
            },
            {
                id: 'sr-192000_buf-2048_lh-interactive',
                sampleRate: 192000,
                bufferSize: 2048,
                latencyHint: 'interactive'
            }
        );

        expect(assessment.status).toBe('fail');
        expect(assessment.criticalIssues.length).toBeGreaterThan(0);
    });

    it('runs matrix flow and restores initial engine settings', async () => {
        const initialSettings = {
            sampleRate: 48000,
            bufferSize: 'auto',
            latencyHint: 'interactive'
        } as const;

        const restartSpy = vi.spyOn(audioEngine, 'restartEngine').mockResolvedValue();
        vi.spyOn(audioEngine, 'getSettings').mockReturnValue({ ...initialSettings });
        vi.spyOn(audioEngine, 'createSineBuffer').mockReturnValue({
            length: 96000,
            sampleRate: 48000,
            numberOfChannels: 1,
            getChannelData: () => new Float32Array(96000).fill(0.5)
        } as unknown as AudioBuffer);
        vi.spyOn(audioEngine, 'renderProject').mockResolvedValue({
            length: 96000,
            sampleRate: 48000,
            numberOfChannels: 2,
            getChannelData: () => new Float32Array(96000).fill(0.25)
        } as unknown as AudioBuffer);
        vi.spyOn(audioEngine, 'getDiagnostics').mockReturnValue(createDiagnostics());
        vi.spyOn(audioEngine, 'getRuntimeDiagnostics').mockReturnValue({
            contextState: 'running',
            hasMasterGraph: true,
            activeSourceCount: 0,
            activePlaybackSessionId: 0,
            transportCommandEpoch: 0,
            offsetTimeSec: 0,
            trackNodeCount: 1,
            masterVolumeDb: -2,
            cueTrackId: null,
            cueMode: null
        });

        const report = await runAudioReliabilityMatrix({
            cases: [
                {
                    id: 'case-a',
                    sampleRate: 48000,
                    bufferSize: 256,
                    latencyHint: 'interactive'
                },
                {
                    id: 'case-b',
                    sampleRate: 96000,
                    bufferSize: 'auto',
                    latencyHint: 'balanced'
                }
            ]
        });

        expect(report.totalCases).toBe(2);
        expect(report.results).toHaveLength(2);
        expect(report.failedCases).toBe(0);
        expect(report.restoreFailed).toBe(false);
        expect(restartSpy).toHaveBeenCalledTimes(3);
        expect(restartSpy.mock.calls[2][0]).toEqual(initialSettings);
    });
});
