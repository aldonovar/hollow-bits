import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import {
    setTrackActiveCompLane,
    setTrackActiveTake,
    toggleTrackTakeMute,
    toggleTrackTakeSolo
} from '../../services/takeLaneControlService';
import { Clip, TrackType } from '../../types';

const makeAudioClip = (id: string, gain = 1): Clip => ({
    id,
    name: id,
    color: '#FF0000',
    notes: [],
    start: 1,
    length: 2,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain,
    playbackRate: 1,
    originalBpm: 120
});

const makeTrack = () => createTrack({
    id: 'track-take-control',
    name: 'TAKE CTRL',
    type: TrackType.AUDIO,
    clips: [makeAudioClip('clip-a', 0.8), makeAudioClip('clip-b', 0.7)],
    recordingTakes: [
        {
            id: 'take-a',
            clipId: 'clip-a',
            trackId: 'track-take-control',
            laneId: 'lane-1',
            startBar: 1,
            lengthBars: 2,
            offsetBars: 0,
            createdAt: 1
        },
        {
            id: 'take-b',
            clipId: 'clip-b',
            trackId: 'track-take-control',
            laneId: 'lane-1',
            startBar: 3,
            lengthBars: 2,
            offsetBars: 0,
            createdAt: 2
        }
    ],
    takeLanes: [
        {
            id: 'lane-1',
            name: 'Take Lane 1',
            trackId: 'track-take-control',
            takeIds: ['take-a', 'take-b']
        },
        {
            id: 'lane-comp-1',
            name: 'Comp Lane',
            trackId: 'track-take-control',
            isCompLane: true,
            takeIds: [],
            compSegments: []
        }
    ]
});

describe('takeLaneControlService', () => {
    it('sets active take only when take exists', () => {
        const track = makeTrack();
        const updated = setTrackActiveTake(track, 'take-b');
        const untouched = setTrackActiveTake(track, 'missing');

        expect(updated.activeTakeId).toBe('take-b');
        expect(untouched).toBe(track);
    });

    it('toggles take mute and mirrors clip gain', () => {
        const track = makeTrack();

        const muted = toggleTrackTakeMute(track, 'take-a');
        expect(muted.recordingTakes?.find((take) => take.id === 'take-a')?.muted).toBe(true);
        expect(muted.clips.find((clip) => clip.id === 'clip-a')?.gain).toBe(0);

        const unmuted = toggleTrackTakeMute(muted, 'take-a');
        expect(unmuted.recordingTakes?.find((take) => take.id === 'take-a')?.muted).toBe(false);
        expect(unmuted.clips.find((clip) => clip.id === 'clip-a')?.gain).toBeCloseTo(0.8, 6);
    });

    it('applies and clears take solo while preserving muted takes', () => {
        const track = makeTrack();
        const withMutedB = toggleTrackTakeMute(track, 'take-b');
        const soloA = toggleTrackTakeSolo(withMutedB, 'take-a');

        expect(soloA.soloTakeId).toBe('take-a');
        expect(soloA.clips.find((clip) => clip.id === 'clip-a')?.gain).toBeGreaterThan(0);
        expect(soloA.clips.find((clip) => clip.id === 'clip-b')?.gain).toBe(0);

        const clearSolo = toggleTrackTakeSolo(soloA, 'take-a');
        expect(clearSolo.soloTakeId).toBeUndefined();
        expect(clearSolo.clips.find((clip) => clip.id === 'clip-a')?.gain).toBeCloseTo(0.8, 6);
        expect(clearSolo.clips.find((clip) => clip.id === 'clip-b')?.gain).toBe(0);
    });

    it('switches active comp lane only to valid comp lanes', () => {
        const track = makeTrack();
        const updated = setTrackActiveCompLane(track, 'lane-comp-1');
        const untouched = setTrackActiveCompLane(track, 'lane-1');

        expect(updated.activeCompLaneId).toBe('lane-comp-1');
        expect(untouched).toBe(track);
    });
});
