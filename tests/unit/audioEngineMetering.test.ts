import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '../../services/audioEngine';

type EngineTestShape = typeof audioEngine & {
    isPlaying: boolean;
    analysers: Map<string, AnalyserNode>;
    analyserBuffers: Map<string, Float32Array>;
    trackMeterState: Map<string, { rmsDb: number; peakDb: number }>;
    trackMeterComputedAtMs: Map<string, number>;
    trackClipHoldState: Set<string>;
    masterAnalyser: AnalyserNode | null;
    masterAnalyserBuffer: Float32Array | null;
    masterMeterState: { rmsDb: number; peakDb: number };
    masterMeterComputedAtMs: number;
    masterClipHold: boolean;
};

const engine = audioEngine as EngineTestShape;

const buildAnalyser = (fftSize: number, samples: number[], onRead?: () => void): AnalyserNode => {
    return {
        fftSize,
        getFloatTimeDomainData: (target: Float32Array) => {
            onRead?.();
            for (let i = 0; i < target.length; i++) {
                target[i] = samples[i % samples.length] || 0;
            }
        }
    } as unknown as AnalyserNode;
};

const resetMeterState = () => {
    engine.isPlaying = true;
    engine.analysers = new Map();
    engine.analyserBuffers = new Map();
    engine.trackMeterState = new Map();
    engine.trackMeterComputedAtMs = new Map();
    engine.trackClipHoldState = new Set();
    (engine as any).waveformEnvelopeCache = new WeakMap();
    engine.masterAnalyser = null;
    engine.masterAnalyserBuffer = null;
    engine.masterMeterState = { rmsDb: -72, peakDb: -72 };
    engine.masterMeterComputedAtMs = 0;
    engine.masterClipHold = false;
    (engine as any).clearSchedulerQueue();
    (engine as any).schedulerQueueCandidateSamples = [];
    (engine as any).schedulerQueueRebuildCount = 0;
    (engine as any).currentBpm = 120;
};

const buildQueueTrack = (id: string, clips: Array<{
    clipId: string;
    start: number;
    length: number;
    offset?: number;
}>, isMuted: boolean = false) => {
    const buffer = {
        duration: 30
    } as AudioBuffer;

    return {
        id,
        name: id,
        type: 'audio',
        isMuted,
        clips: clips.map((clip) => ({
            id: clip.clipId,
            name: clip.clipId,
            color: '#fff',
            notes: [],
            start: clip.start,
            length: clip.length,
            offset: clip.offset || 0,
            fadeIn: 0,
            fadeOut: 0,
            gain: 1,
            playbackRate: 1,
            originalBpm: 120,
            transpose: 0,
            isWarped: false,
            buffer
        }))
    };
};

const buildAudioBuffer = (
    samples: number[],
    options?: { channels?: 1 | 2; sampleRate?: number; onRead?: () => void }
): AudioBuffer => {
    const channels = options?.channels ?? 1;
    const sampleRate = options?.sampleRate ?? 48000;
    const left = Float32Array.from(samples);
    const right = channels > 1
        ? Float32Array.from(samples.map((sample, index) => (index % 2 === 0 ? sample : -sample * 0.8)))
        : left;

    return {
        numberOfChannels: channels,
        length: left.length,
        sampleRate,
        getChannelData: (channel: number) => {
            options?.onRead?.();
            if (channel === 1 && channels > 1) {
                return right;
            }
            return left;
        }
    } as unknown as AudioBuffer;
};

describe('audioEngine metering cache', () => {
    beforeEach(() => {
        resetMeterState();
    });

    it('reuses cached track meter values inside the cache window', () => {
        let reads = 0;
        const analyser = buildAnalyser(8, [0.45, -0.2, 0.1], () => {
            reads += 1;
        });

        engine.analysers.set('track-1', analyser);

        const nowSpy = vi.spyOn(performance, 'now');
        nowSpy
            .mockReturnValueOnce(1000)
            .mockReturnValueOnce(1010)
            .mockReturnValueOnce(1045);

        const first = audioEngine.getTrackMeter('track-1');
        const second = audioEngine.getTrackMeter('track-1');
        const third = audioEngine.getTrackMeter('track-1');

        expect(reads).toBe(2);
        expect(second).toEqual(first);
        expect(third.rmsDb).toBeGreaterThan(-72);
    });

    it('builds a deduplicated batch snapshot for mixer polling', () => {
        let trackAReads = 0;
        let trackBReads = 0;
        let masterReads = 0;

        engine.analysers.set('track-a', buildAnalyser(8, [0.3, -0.1], () => {
            trackAReads += 1;
        }));
        engine.analysers.set('track-b', buildAnalyser(8, [0.2, -0.15], () => {
            trackBReads += 1;
        }));
        engine.masterAnalyser = buildAnalyser(8, [0.4, -0.2], () => {
            masterReads += 1;
        });

        vi.spyOn(performance, 'now').mockReturnValue(2000);

        const snapshot = audioEngine.getMeterSnapshot(['track-a', 'track-a', 'track-b']);

        expect(Object.keys(snapshot.tracks).sort()).toEqual(['track-a', 'track-b']);
        expect(snapshot.master.peakDb).toBeGreaterThan(-72);
        expect(trackAReads).toBe(1);
        expect(trackBReads).toBe(1);
        expect(masterReads).toBe(1);
    });

    it('reuses waveform envelope cache for same buffer and step count', () => {
        let channelReads = 0;

        const buffer = buildAudioBuffer(
            [0.8, -0.4, 0.25, -0.2, 0.5, -0.45, 0.3, -0.1],
            { channels: 2, onRead: () => { channelReads += 1; } }
        );

        const first = audioEngine.getWaveformEnvelopeData(buffer, 4);
        const second = audioEngine.getWaveformEnvelopeData(buffer, 4);

        expect(first.min).toBe(second.min);
        expect(first.max).toBe(second.max);
        expect(channelReads).toBe(2);
    });

    it('sweeps queue candidates across timeline windows', () => {
        const track = buildQueueTrack('track-q', [
            { clipId: 'clip-a', start: 1, length: 4 },
            { clipId: 'clip-b', start: 6, length: 2 }
        ]);

        (engine as any).rebuildSchedulerQueue([track]);

        const firstWindow = (engine as any).collectSchedulerCandidates(7.5, 8.2) as Array<{ id: string }>;
        const secondWindow = (engine as any).collectSchedulerCandidates(9.9, 10.2) as Array<{ id: string }>;

        expect(firstWindow.map((entry) => entry.id)).toContain('track-q-clip-a');
        expect(firstWindow.map((entry) => entry.id)).not.toContain('track-q-clip-b');
        expect(secondWindow.map((entry) => entry.id)).toContain('track-q-clip-b');
        expect(secondWindow.map((entry) => entry.id)).not.toContain('track-q-clip-a');
    });

    it('skips queue rebuild when clip arrays are unchanged', () => {
        const clipArray = buildQueueTrack('track-r', [{ clipId: 'clip-a', start: 1, length: 2 }]).clips;

        const initialRawTracks = [{
            id: 'track-r',
            isMuted: false,
            clips: clipArray
        }];
        const initialSafeTracks = [buildQueueTrack('track-r', [{ clipId: 'clip-a', start: 1, length: 2 }])];

        (engine as any).refreshSchedulerQueue(initialRawTracks, initialSafeTracks);
        const firstRebuildCount = (engine as any).schedulerQueueRebuildCount;

        const volumeOnlyRawTracks = [{
            id: 'track-r',
            isMuted: false,
            volume: -3,
            clips: clipArray
        }];

        (engine as any).refreshSchedulerQueue(volumeOnlyRawTracks, initialSafeTracks);
        const secondRebuildCount = (engine as any).schedulerQueueRebuildCount;

        const nextClipArray = [...clipArray];
        const changedStructureRawTracks = [{
            id: 'track-r',
            isMuted: false,
            clips: nextClipArray
        }];
        const changedStructureSafeTracks = [buildQueueTrack('track-r', [{ clipId: 'clip-a', start: 1, length: 2 }])];

        (engine as any).refreshSchedulerQueue(changedStructureRawTracks, changedStructureSafeTracks);
        const thirdRebuildCount = (engine as any).schedulerQueueRebuildCount;

        expect(firstRebuildCount).toBe(1);
        expect(secondRebuildCount).toBe(1);
        expect(thirdRebuildCount).toBe(2);
    });
});
