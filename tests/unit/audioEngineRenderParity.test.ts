import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '../../services/audioEngine';
import { Clip, Track, TrackType } from '../../types';

type StartCall = {
    when: number;
    offset: number;
    duration: number | null;
    playbackRate: number;
};

const nativeStartCalls: StartCall[] = [];
const createdWorkletNodes: FakeAudioWorkletNode[] = [];

const createAudioBufferMock = (value = 0.2, sampleRate = 48000, seconds = 1): AudioBuffer => {
    const length = Math.max(1, Math.floor(sampleRate * seconds));
    const left = new Float32Array(length).fill(value);
    const right = new Float32Array(length).fill(-value * 0.8);

    return {
        numberOfChannels: 2,
        length,
        duration: length / sampleRate,
        sampleRate,
        getChannelData: (channel: number) => (channel === 0 ? left : right)
    } as unknown as AudioBuffer;
};

const createClip = (buffer: AudioBuffer, overrides: Partial<Clip> = {}): Clip => ({
    id: 'clip-1',
    name: 'Clip 1',
    color: '#fff',
    notes: [],
    start: 1,
    length: 2,
    offset: 0.5,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1.5,
    originalBpm: 100,
    transpose: 1,
    isWarped: false,
    buffer,
    ...overrides
});

const createTrack = (clip: Clip): Track => ({
    id: 'track-1',
    name: 'Track 1',
    type: TrackType.AUDIO,
    color: '#fff',
    volume: 0,
    pan: 0,
    reverb: 0,
    transpose: 2,
    monitor: 'off',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips: [clip],
    sessionClips: [],
    devices: [],
    sends: {},
    sendModes: {}
});

class FakeAudioParam {
    value: number;
    readonly setCalls: Array<{ value: number; time: number }> = [];

    constructor(initial = 0) {
        this.value = initial;
    }

    setValueAtTime(value: number, time: number): void {
        this.value = value;
        this.setCalls.push({ value, time });
    }

    linearRampToValueAtTime(value: number, time: number): void {
        this.value = value;
        this.setCalls.push({ value, time });
    }

    cancelScheduledValues(): void {
        // no-op for tests
    }

    setTargetAtTime(value: number): void {
        this.value = value;
    }
}

class FakeAudioNode {
    connect(): void {
        // no-op for tests
    }

    disconnect(): void {
        // no-op for tests
    }
}

class FakeGainNode extends FakeAudioNode {
    gain = new FakeAudioParam(1);
}

class FakeStereoPannerNode extends FakeAudioNode {
    pan = new FakeAudioParam(0);
}

class FakeConvolverNode extends FakeAudioNode {
    buffer: AudioBuffer | null = null;
}

class FakeBufferSourceNode extends FakeAudioNode {
    buffer: AudioBuffer | null = null;
    playbackRate = { value: 1 };

    start(when = 0, offset = 0, duration?: number): void {
        nativeStartCalls.push({
            when,
            offset,
            duration: typeof duration === 'number' ? duration : null,
            playbackRate: this.playbackRate.value
        });
    }
}

class FakeAudioWorkletNode extends FakeAudioNode {
    readonly parameters = new Map<string, FakeAudioParam>([
        ['startOffset', new FakeAudioParam(0)],
        ['isPlaying', new FakeAudioParam(0)],
        ['playbackRate', new FakeAudioParam(1)],
        ['pitch', new FakeAudioParam(1)],
        ['grainSize', new FakeAudioParam(0.08)],
        ['overlap', new FakeAudioParam(3)]
    ]);

    readonly port = {
        postMessage: () => {
            // no-op for tests
        }
    };

    constructor(_ctx: unknown, _name: string) {
        super();
        createdWorkletNodes.push(this);
    }
}

class FakeOfflineAudioContext {
    readonly destination = new FakeAudioNode();
    readonly audioWorklet = {
        addModule: async () => {
            // no-op for tests
        }
    };

    constructor(
        public readonly numberOfChannels: number,
        public readonly length: number,
        public readonly sampleRate: number
    ) { }

    createGain(): GainNode {
        return new FakeGainNode() as unknown as GainNode;
    }

    createStereoPanner(): StereoPannerNode {
        return new FakeStereoPannerNode() as unknown as StereoPannerNode;
    }

    createConvolver(): ConvolverNode {
        return new FakeConvolverNode() as unknown as ConvolverNode;
    }

    createBufferSource(): AudioBufferSourceNode {
        return new FakeBufferSourceNode() as unknown as AudioBufferSourceNode;
    }

    createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
        const perChannel = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
        return {
            numberOfChannels,
            length,
            sampleRate,
            duration: length / sampleRate,
            getChannelData: (channel: number) => perChannel[channel] || perChannel[0]
        } as unknown as AudioBuffer;
    }

    async startRendering(): Promise<AudioBuffer> {
        return createAudioBufferMock(0.1, this.sampleRate, 1);
    }
}

const originalOfflineAudioContext = (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext;
const originalAudioWorkletNode = (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode;

describe('audioEngine render parity', () => {
    beforeEach(() => {
        nativeStartCalls.length = 0;
        createdWorkletNodes.length = 0;

        (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = FakeOfflineAudioContext;
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = FakeAudioWorkletNode;

        vi.spyOn(audioEngine as unknown as { getDefaultReverbImpulse: (ctx: BaseAudioContext) => AudioBuffer }, 'getDefaultReverbImpulse')
            .mockReturnValue(createAudioBufferMock(0.0));

        (audioEngine as unknown as { masterTransposeSemitones: number }).masterTransposeSemitones = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
        (globalThis as { OfflineAudioContext?: unknown }).OfflineAudioContext = originalOfflineAudioContext;
        (globalThis as { AudioWorkletNode?: unknown }).AudioWorkletNode = originalAudioWorkletNode;
    });

    it('matches realtime native-rate math for offline non-warped rendering', async () => {
        const buffer = createAudioBufferMock(0.3, 48000, 20);
        const clip = createClip(buffer, { isWarped: false });
        const track = createTrack(clip);

        await audioEngine.renderProject([track], {
            bars: 2,
            bpm: 120,
            sampleRate: 48000,
            sourceId: 'parity-native'
        });

        expect(nativeStartCalls).toHaveLength(1);
        expect(createdWorkletNodes).toHaveLength(0);

        const call = nativeStartCalls[0];
        const transposeMult = Math.pow(2, (track.transpose + (clip.transpose || 0)) / 12);
        const granularRate = (120 / (clip.originalBpm || 120)) * clip.playbackRate;
        const nativeRate = granularRate * transposeMult;
        const timelineOffsetSec = clip.offset * (60 / 120) * 4;

        expect(call.when).toBeCloseTo(0, 6);
        expect(call.playbackRate).toBeCloseTo(nativeRate, 6);
        expect(call.offset).toBeCloseTo(timelineOffsetSec * nativeRate, 5);
        expect(call.duration).toBeCloseTo((clip.length * (60 / 120) * 4) * nativeRate, 5);
    });

    it('applies warped offline params using granular-rate and transpose pitch split', async () => {
        const buffer = createAudioBufferMock(0.25, 48000, 20);
        const clip = createClip(buffer, { isWarped: true });
        const track = createTrack(clip);

        await audioEngine.renderProject([track], {
            bars: 2,
            bpm: 120,
            sampleRate: 48000,
            sourceId: 'parity-warped'
        });

        expect(nativeStartCalls).toHaveLength(0);
        expect(createdWorkletNodes).toHaveLength(1);

        const node = createdWorkletNodes[0];
        const startOffsetCalls = node.parameters.get('startOffset')?.setCalls || [];
        const playbackRateCalls = node.parameters.get('playbackRate')?.setCalls || [];
        const pitchCalls = node.parameters.get('pitch')?.setCalls || [];
        const isPlayingCalls = node.parameters.get('isPlaying')?.setCalls || [];

        const transposeMult = Math.pow(2, (track.transpose + (clip.transpose || 0)) / 12);
        const granularRate = (120 / (clip.originalBpm || 120)) * clip.playbackRate;
        const timelineOffsetSec = clip.offset * (60 / 120) * 4;
        const timelineDurationSec = clip.length * (60 / 120) * 4;

        expect(startOffsetCalls[0]?.value).toBeCloseTo(timelineOffsetSec * granularRate, 6);
        expect(playbackRateCalls[0]?.value).toBeCloseTo(granularRate, 6);
        expect(pitchCalls[0]?.value).toBeCloseTo(transposeMult, 6);
        expect(isPlayingCalls[0]?.value).toBe(1);
        expect(isPlayingCalls[1]?.value).toBe(0);
        expect(isPlayingCalls[1]?.time).toBeCloseTo(timelineDurationSec, 6);
    });
});
