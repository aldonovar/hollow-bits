import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '../../services/audioEngine';

type EngineRecordingLifecycleShape = typeof audioEngine & {
    pendingRecordingFinalizations: Map<string, {
        blob: Blob;
        buffer: AudioBuffer;
        startedAtContextTime: number;
        stoppedAtContextTime: number;
        estimatedLatencyMs: number;
    }>;
    monitoringSessions: Map<string, unknown>;
    stopRecording: (trackId: string) => Promise<unknown>;
};

const engine = audioEngine as EngineRecordingLifecycleShape;

describe('audioEngine recording lifecycle', () => {
    beforeEach(() => {
        engine.pendingRecordingFinalizations = new Map();
        engine.monitoringSessions = new Map();
        vi.restoreAllMocks();
    });

    it('returns and clears pending finalized recordings', async () => {
        const result = {
            blob: new Blob(['abc'], { type: 'audio/webm' }),
            buffer: { duration: 1 } as AudioBuffer,
            startedAtContextTime: 10,
            stoppedAtContextTime: 12,
            estimatedLatencyMs: 4
        };

        engine.pendingRecordingFinalizations.set('track-1', result);

        const finalized = await audioEngine.finalizeRecording('track-1');

        expect(finalized).toEqual(result);
        expect(engine.pendingRecordingFinalizations.has('track-1')).toBe(false);
    });

    it('falls back to stopRecording when no pending finalize exists', async () => {
        const stopSpy = vi.spyOn(audioEngine, 'stopRecording').mockResolvedValue({
            blob: new Blob(['xyz'], { type: 'audio/webm' }),
            buffer: { duration: 2 } as AudioBuffer,
            startedAtContextTime: 3,
            stoppedAtContextTime: 5,
            estimatedLatencyMs: 6
        });

        const finalized = await audioEngine.finalizeRecording('track-2');

        expect(stopSpy).toHaveBeenCalledWith('track-2');
        expect(finalized?.estimatedLatencyMs).toBe(6);
    });

    it('stops monitoring routes immediately via public monitor stop', () => {
        engine.monitoringSessions.set('track-3', {
            stream: {
                getTracks: () => []
            },
            source: { disconnect: () => undefined },
            inputSplitter: { disconnect: () => undefined },
            leftToLeft: { disconnect: () => undefined },
            leftToRight: { disconnect: () => undefined },
            rightToLeft: { disconnect: () => undefined },
            rightToRight: { disconnect: () => undefined },
            stereoMerge: { disconnect: () => undefined },
            monitorDelay: { disconnect: () => undefined },
            inputGain: { disconnect: () => undefined },
            monitorGate: { disconnect: () => undefined },
            reverbSend: { disconnect: () => undefined },
            reverbConvolver: { disconnect: () => undefined },
            echoDelay: { disconnect: () => undefined },
            echoFeedback: { disconnect: () => undefined },
            echoWet: { disconnect: () => undefined }
        });

        audioEngine.stopTrackMonitoring('track-3');

        expect(engine.monitoringSessions.has('track-3')).toBe(false);
    });
});
