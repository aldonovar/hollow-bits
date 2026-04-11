import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioEngine } from '../../services/audioEngine';

type EngineTransportTestShape = {
    ctx: AudioContext | null;
    isPlaying: boolean;
    activePlaybackSessionId: number;
    offsetTime: number;
    virtualStartTime: number;
    currentBpm: number;
    schedulerMode: 'interval' | 'worklet-clock';
    schedulerWorkletAvailable: boolean;
    schedulerClockNode: AudioWorkletNode | null;
    masterGain: GainNode | null;
    startSchedulerDriver: () => void;
    stopSchedulerDriver: () => void;
    resetSchedulerQueueState: () => void;
    updateTracks: (tracks: unknown[]) => void;
};

const engine = audioEngine as unknown as EngineTransportTestShape;

const buildContext = (currentTime: number, state: AudioContextState = 'running'): AudioContext => {
    return {
        currentTime,
        state
    } as AudioContext;
};

describe('audioEngine transport authority snapshot', () => {
    beforeEach(() => {
        engine.ctx = buildContext(12, 'running');
        engine.isPlaying = false;
        engine.activePlaybackSessionId = 0;
        engine.offsetTime = 0;
        engine.virtualStartTime = 0;
        engine.currentBpm = 120;
        engine.schedulerMode = 'interval';
        engine.schedulerWorkletAvailable = false;
        engine.schedulerClockNode = null;
        engine.masterGain = {} as GainNode;
        vi.restoreAllMocks();
    });

    it('reports paused transport position from stored offset time', () => {
        engine.offsetTime = 4;

        const snapshot = audioEngine.getTransportAuthoritySnapshot();

        expect(snapshot.isPlaying).toBe(false);
        expect(snapshot.currentTimeSec).toBe(4);
        expect(snapshot.currentBarTime).toBe(3);
        expect(snapshot.currentBar).toBe(3);
        expect(snapshot.currentBeat).toBe(1);
        expect(snapshot.currentSixteenth).toBe(1);
        expect(snapshot.schedulerMode).toBe('interval');
        expect(snapshot.contextState).toBe('running');
    });

    it('reports live transport position from engine clock while playing', () => {
        engine.isPlaying = true;
        engine.virtualStartTime = 11;
        engine.ctx = buildContext(17, 'running');

        const snapshot = audioEngine.getTransportAuthoritySnapshot();

        expect(snapshot.isPlaying).toBe(true);
        expect(snapshot.currentTimeSec).toBe(6);
        expect(snapshot.currentBarTime).toBe(4);
        expect(snapshot.currentBar).toBe(4);
        expect(snapshot.currentBeat).toBe(1);
        expect(snapshot.currentSixteenth).toBe(1);
    });

    it('falls back to interval scheduler when worklet clock is unavailable', () => {
        engine.schedulerMode = 'worklet-clock';
        engine.schedulerWorkletAvailable = false;
        engine.offsetTime = 1;

        const snapshot = audioEngine.getTransportAuthoritySnapshot();

        expect(snapshot.schedulerMode).toBe('interval');
        expect(snapshot.currentBarTime).toBe(1.5);
        expect(snapshot.currentBar).toBe(1);
        expect(snapshot.currentBeat).toBe(3);
        expect(snapshot.currentSixteenth).toBe(1);
    });

    it('invalidates async play resume when pause arrives before context resume resolves', async () => {
        let resumeResolver: (() => void) | null = null;
        engine.ctx = {
            currentTime: 6,
            state: 'suspended',
            resume: vi.fn(() => new Promise<void>((resolve) => {
                resumeResolver = resolve;
            }))
        } as unknown as AudioContext;

        const startSchedulerSpy = vi.spyOn(engine as unknown as { startSchedulerDriver: () => void }, 'startSchedulerDriver').mockImplementation(() => undefined);
        vi.spyOn(audioEngine, 'stopPlayback').mockImplementation(() => undefined);
        vi.spyOn(engine as unknown as { stopSchedulerDriver: () => void }, 'stopSchedulerDriver').mockImplementation(() => undefined);
        vi.spyOn(engine as unknown as { resetSchedulerQueueState: () => void }, 'resetSchedulerQueueState').mockImplementation(() => undefined);
        vi.spyOn(engine as unknown as { updateTracks: (tracks: unknown[]) => void }, 'updateTracks').mockImplementation(() => undefined);

        audioEngine.play([], 120, 1, 2);
        audioEngine.pause();

        expect(engine.isPlaying).toBe(false);
        expect(resumeResolver).not.toBeNull();

        const resolver = resumeResolver as (() => void) | null;
        if (resolver) {
            resolver();
        }
        await Promise.resolve();
        await Promise.resolve();

        expect(startSchedulerSpy).not.toHaveBeenCalled();
        expect(engine.isPlaying).toBe(false);
    });

    it('ignores pause when transport is already inactive', () => {
        engine.isPlaying = false;
        engine.activePlaybackSessionId = 0;
        engine.offsetTime = 3.5;

        const stopPlaybackSpy = vi.spyOn(audioEngine, 'stopPlayback').mockImplementation(() => undefined);
        const stopSchedulerSpy = vi.spyOn(engine as unknown as { stopSchedulerDriver: () => void }, 'stopSchedulerDriver').mockImplementation(() => undefined);
        const resetQueueSpy = vi.spyOn(engine as unknown as { resetSchedulerQueueState: () => void }, 'resetSchedulerQueueState').mockImplementation(() => undefined);

        audioEngine.pause();

        expect(engine.offsetTime).toBe(3.5);
        expect(stopPlaybackSpy).not.toHaveBeenCalled();
        expect(stopSchedulerSpy).not.toHaveBeenCalled();
        expect(resetQueueSpy).not.toHaveBeenCalled();
    });

    it('ignores duplicate play when a playback session is already active', () => {
        engine.isPlaying = true;
        engine.activePlaybackSessionId = 42;
        engine.offsetTime = 2;

        const startSchedulerSpy = vi.spyOn(engine as unknown as { startSchedulerDriver: () => void }, 'startSchedulerDriver').mockImplementation(() => undefined);
        const updateTracksSpy = vi.spyOn(engine as unknown as { updateTracks: (tracks: unknown[]) => void }, 'updateTracks').mockImplementation(() => undefined);

        audioEngine.play([], 120, 1, 2);

        expect(startSchedulerSpy).not.toHaveBeenCalled();
        expect(updateTracksSpy).not.toHaveBeenCalled();
        expect(engine.activePlaybackSessionId).toBe(42);
    });

    it('stop(reset=true) clears the active playback session and rewinds offset', () => {
        engine.isPlaying = true;
        engine.activePlaybackSessionId = 17;
        engine.offsetTime = 5.5;
        engine.virtualStartTime = 3;

        const stopPlaybackSpy = vi.spyOn(audioEngine, 'stopPlayback').mockImplementation(() => undefined);
        const stopSchedulerSpy = vi.spyOn(engine as unknown as { stopSchedulerDriver: () => void }, 'stopSchedulerDriver').mockImplementation(() => undefined);
        const resetQueueSpy = vi.spyOn(engine as unknown as { resetSchedulerQueueState: () => void }, 'resetSchedulerQueueState').mockImplementation(() => undefined);

        audioEngine.stop(true);

        expect(stopPlaybackSpy).toHaveBeenCalledTimes(1);
        expect(stopSchedulerSpy).toHaveBeenCalledTimes(1);
        expect(resetQueueSpy).toHaveBeenCalledTimes(1);
        expect(engine.isPlaying).toBe(false);
        expect(engine.activePlaybackSessionId).toBe(0);
        expect(engine.offsetTime).toBe(0);
        expect(engine.virtualStartTime).toBe(0);
    });

    it('seek while playing invalidates the previous session and restarts cleanly from the new offset', () => {
        engine.isPlaying = true;
        engine.activePlaybackSessionId = 9;
        engine.offsetTime = 1.25;
        engine.virtualStartTime = 4.75;
        engine.ctx = buildContext(10, 'running');

        const playSpy = vi.spyOn(audioEngine, 'play').mockImplementation(() => undefined);
        const stopPlaybackSpy = vi.spyOn(audioEngine, 'stopPlayback').mockImplementation(() => undefined);
        const stopSchedulerSpy = vi.spyOn(engine as unknown as { stopSchedulerDriver: () => void }, 'stopSchedulerDriver').mockImplementation(() => undefined);
        const resetQueueSpy = vi.spyOn(engine as unknown as { resetSchedulerQueueState: () => void }, 'resetSchedulerQueueState').mockImplementation(() => undefined);

        audioEngine.seek(6, [] as never[], 124);

        expect(stopPlaybackSpy).toHaveBeenCalledTimes(1);
        expect(stopSchedulerSpy).toHaveBeenCalledTimes(1);
        expect(resetQueueSpy).toHaveBeenCalledTimes(1);
        expect(engine.activePlaybackSessionId).toBe(0);
        expect(engine.offsetTime).toBe(6);
        expect(engine.virtualStartTime).toBe(4);
        expect(playSpy).toHaveBeenCalledTimes(1);
        expect(playSpy).toHaveBeenCalledWith([] as never[], 124, 1, 6);
    });
});
