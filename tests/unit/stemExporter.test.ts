import { describe, expect, it, vi } from 'vitest';
import { stemExporter } from '../../services/stemExporter';
import { audioEngine } from '../../services/audioEngine';
import { Clip, Track, TrackType } from '../../types';

const createAudioBufferMock = (value = 0.2, sampleRate = 48000, seconds = 1): AudioBuffer => {
    const length = Math.max(1, Math.floor(sampleRate * seconds));
    const left = new Float32Array(length).fill(value);
    const right = new Float32Array(length).fill(-value);

    return {
        numberOfChannels: 2,
        length,
        duration: length / sampleRate,
        sampleRate,
        getChannelData: (channel: number) => (channel === 0 ? left : right)
    } as unknown as AudioBuffer;
};

const createClip = (id: string, buffer: AudioBuffer): Clip => ({
    id,
    name: id,
    color: '#ffffff',
    notes: [],
    start: 1,
    length: 1,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1,
    buffer
});

const createTrack = (id: string, type: TrackType, clips: Clip[] = [], overrides: Partial<Track> = {}): Track => ({
    id,
    name: id,
    type,
    color: '#ffffff',
    volume: 0,
    pan: 0,
    reverb: 0,
    transpose: 0,
    monitor: 'off',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips,
    sessionClips: [],
    devices: [],
    sends: {},
    sendModes: {},
    ...overrides
});

describe('stemExporter', () => {
    it('uses isolated render tracks and restores master volume with includeEffects', async () => {
        const clipA = createClip('clip-a', createAudioBufferMock(0.3));
        const clipB = createClip('clip-b', createAudioBufferMock(0.25));

        const trackA = createTrack('track-a', TrackType.AUDIO, [clipA], {
            sends: { 'return-1': 0.6 },
            sendModes: { 'return-1': 'post' }
        });

        const trackB = createTrack('track-b', TrackType.AUDIO, [clipB], {
            sends: { 'return-1': 0.8 },
            sendModes: { 'return-1': 'pre' }
        });

        const returnTrack = createTrack('return-1', TrackType.RETURN, []);

        const renderSpy = vi.spyOn(audioEngine, 'renderProject').mockResolvedValue(createAudioBufferMock(0.1));
        vi.spyOn(audioEngine, 'getMasterVolumeDb').mockReturnValue(-6);
        const setMasterSpy = vi.spyOn(audioEngine, 'setMasterVolumeDb').mockImplementation(() => { });

        const result = await stemExporter.exportStems(
            [trackA, trackB, returnTrack],
            120,
            1,
            {
                includeEffects: true,
                format: 'wav',
                sampleRate: 48000,
                bitDepth: 24,
                normalizeLevel: 0
            }
        );

        expect(result.success).toBe(true);
        expect(renderSpy).toHaveBeenCalledTimes(2);

        const firstRenderTracks = renderSpy.mock.calls[0][0];
        const firstA = firstRenderTracks.find((track) => track.id === 'track-a');
        const firstB = firstRenderTracks.find((track) => track.id === 'track-b');
        expect(firstA?.isMuted).toBe(false);
        expect(firstB?.isMuted).toBe(true);
        expect(firstB?.sends).toEqual({});

        const secondRenderTracks = renderSpy.mock.calls[1][0];
        const secondA = secondRenderTracks.find((track) => track.id === 'track-a');
        const secondB = secondRenderTracks.find((track) => track.id === 'track-b');
        expect(secondA?.isMuted).toBe(true);
        expect(secondA?.sends).toEqual({});
        expect(secondB?.isMuted).toBe(false);

        expect(setMasterSpy).toHaveBeenCalledWith(0);
        expect(setMasterSpy).toHaveBeenLastCalledWith(-6);
    });
});
