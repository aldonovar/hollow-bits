import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import {
    applyCompClipEdits,
    COMP_CLIP_ID_PREFIX,
    promoteTakeToComp,
    rebuildCompDerivedClips,
    resolvePunchRecordingPlan,
    splitTakeForClip,
    syncTakeMetadataForClip,
    updateTrackPunchRange
} from '../../services/takeCompingService';
import { Clip, TrackType } from '../../types';

const makeIdFactory = () => {
    let count = 0;
    return (prefix: string) => `${prefix}-${++count}`;
};

const makeAudioClip = (id: string, start: number, length: number): Clip => ({
    id,
    name: id,
    color: '#FF0000',
    notes: [],
    start,
    length,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1,
    originalBpm: 120
});

describe('takeCompingService.resolvePunchRecordingPlan', () => {
    it('builds a merged plan from enabled armed audio tracks', () => {
        const trackA = createTrack({
            id: 'a',
            name: 'A',
            type: TrackType.AUDIO,
            isArmed: true,
            punchRange: {
                enabled: true,
                inBar: 9,
                outBar: 13,
                preRollBars: 2,
                countInBars: 1
            }
        });

        const trackB = createTrack({
            id: 'b',
            name: 'B',
            type: TrackType.AUDIO,
            isArmed: true,
            punchRange: {
                enabled: true,
                inBar: 8,
                outBar: 16,
                preRollBars: 3,
                countInBars: 2
            }
        });

        const plan = resolvePunchRecordingPlan([trackA, trackB]);

        expect(plan).not.toBeNull();
        expect(plan?.punchInBar).toBe(8);
        expect(plan?.punchOutBar).toBe(16);
        expect(plan?.preRollBars).toBe(3);
        expect(plan?.countInBars).toBe(2);
        expect(plan?.startPlaybackBar).toBe(3);
        expect(plan?.sourceTrimOffsetBars).toBe(5);
    });
});

describe('takeCompingService.syncTakeMetadataForClip', () => {
    it('keeps take metadata aligned with clip edits and clamps comp segments', () => {
        const clip = makeAudioClip('clip-1', 4, 4);
        const track = createTrack({
            id: 'track-sync',
            name: 'SYNC',
            type: TrackType.AUDIO,
            clips: [clip],
            recordingTakes: [
                {
                    id: 'take-1',
                    clipId: 'clip-1',
                    trackId: 'track-sync',
                    laneId: 'lane-rec',
                    startBar: 4,
                    lengthBars: 4,
                    offsetBars: 0,
                    createdAt: 1
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-sync',
                    takeIds: ['take-1']
                },
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-sync',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-1',
                            takeId: 'take-1',
                            sourceStartBar: 4,
                            sourceEndBar: 8,
                            targetStartBar: 10
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const editedTrack = {
            ...track,
            clips: [{ ...clip, start: 5, length: 2, offset: 0.5 }]
        };

        const synced = syncTakeMetadataForClip(editedTrack, 'clip-1');

        expect(synced.recordingTakes?.[0].startBar).toBe(5);
        expect(synced.recordingTakes?.[0].lengthBars).toBe(2);
        expect(synced.recordingTakes?.[0].offsetBars).toBe(0.5);

        const compLane = synced.takeLanes?.find((lane) => lane.id === 'lane-comp');
        expect(compLane?.compSegments).toHaveLength(1);
        expect(compLane?.compSegments?.[0].sourceStartBar).toBe(5);
        expect(compLane?.compSegments?.[0].sourceEndBar).toBe(7);
    });
});

describe('takeCompingService.splitTakeForClip', () => {
    it('splits take metadata and comp segments when a take clip is split', () => {
        const sourceClip = makeAudioClip('clip-source', 4, 4);
        const track = createTrack({
            id: 'track-split',
            name: 'SPLIT',
            type: TrackType.AUDIO,
            clips: [sourceClip],
            recordingTakes: [
                {
                    id: 'take-source',
                    clipId: 'clip-source',
                    trackId: 'track-split',
                    laneId: 'lane-rec',
                    startBar: 4,
                    lengthBars: 4,
                    offsetBars: 0,
                    createdAt: 1
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-split',
                    takeIds: ['take-source']
                },
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-split',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-source',
                            takeId: 'take-source',
                            sourceStartBar: 4,
                            sourceEndBar: 8,
                            targetStartBar: 12
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const leftClip = { ...sourceClip, id: 'clip-left', length: 2 };
        const rightClip = { ...sourceClip, id: 'clip-right', start: 6, length: 2, offset: 2 };

        const split = splitTakeForClip(track, 'clip-source', leftClip, rightClip, makeIdFactory());

        expect(split.recordingTakes).toHaveLength(2);
        expect(split.recordingTakes?.[0].clipId).toBe('clip-left');
        expect(split.recordingTakes?.[1].clipId).toBe('clip-right');

        const recordingLane = split.takeLanes?.find((lane) => lane.id === 'lane-rec');
        expect(recordingLane?.takeIds).toHaveLength(2);

        const compLane = split.takeLanes?.find((lane) => lane.id === 'lane-comp');
        expect(compLane?.compSegments).toHaveLength(2);
    });
});

describe('takeCompingService.promoteTakeToComp', () => {
    it('creates/updates comp lane and comp-derived clips from a take', () => {
        const sourceClip = makeAudioClip('clip-promote', 2, 3);
        const baseTrack = createTrack({
            id: 'track-comp',
            name: 'COMP',
            type: TrackType.AUDIO,
            clips: [sourceClip],
            recordingTakes: [
                {
                    id: 'take-promote',
                    clipId: 'clip-promote',
                    trackId: 'track-comp',
                    laneId: 'lane-rec',
                    startBar: 2,
                    lengthBars: 3,
                    offsetBars: 0,
                    createdAt: 1
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-comp',
                    takeIds: ['take-promote']
                }
            ]
        });

        const withPunchDefaults = updateTrackPunchRange(baseTrack, { enabled: false });
        const promoted = promoteTakeToComp(withPunchDefaults, 'take-promote', {
            replaceExisting: true,
            idFactory: makeIdFactory()
        });

        expect(promoted.activeCompLaneId).toBeTruthy();
        const compLane = promoted.takeLanes?.find((lane) => lane.id === promoted.activeCompLaneId);
        expect(compLane?.isCompLane).toBe(true);
        expect(compLane?.compSegments).toHaveLength(1);
        expect(promoted.clips.some((clip) => clip.id.startsWith(COMP_CLIP_ID_PREFIX))).toBe(true);
    });
});

describe('takeCompingService.applyCompClipEdits', () => {
    it('updates comp segment timing/offset through comp-derived clip edits', () => {
        const sourceClip = makeAudioClip('clip-comp-source', 2, 4);
        const track = createTrack({
            id: 'track-comp-edit',
            name: 'COMP EDIT',
            type: TrackType.AUDIO,
            clips: [sourceClip],
            recordingTakes: [
                {
                    id: 'take-comp-source',
                    clipId: 'clip-comp-source',
                    trackId: 'track-comp-edit',
                    laneId: 'lane-rec',
                    startBar: 2,
                    lengthBars: 4,
                    offsetBars: 0,
                    createdAt: 1
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-comp-edit',
                    takeIds: ['take-comp-source']
                },
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-comp-edit',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-edit',
                            takeId: 'take-comp-source',
                            sourceStartBar: 2,
                            sourceEndBar: 6,
                            targetStartBar: 10
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const withDerivedCompClip = rebuildCompDerivedClips(track);
        const compClipId = `${COMP_CLIP_ID_PREFIX}seg-edit`;
        const edited = applyCompClipEdits(withDerivedCompClip, compClipId, {
            start: 11,
            length: 2,
            offset: 1
        });

        const compLane = edited.takeLanes?.find((lane) => lane.id === 'lane-comp');
        expect(compLane?.compSegments).toHaveLength(1);
        expect(compLane?.compSegments?.[0].sourceStartBar).toBe(3);
        expect(compLane?.compSegments?.[0].sourceEndBar).toBe(5);
        expect(compLane?.compSegments?.[0].targetStartBar).toBe(11);

        const compClip = edited.clips.find((clip) => clip.id === compClipId);
        expect(compClip).toBeTruthy();
        expect(compClip?.start).toBe(11);
        expect(compClip?.length).toBe(2);
        expect(compClip?.offset).toBe(1);
    });
});
