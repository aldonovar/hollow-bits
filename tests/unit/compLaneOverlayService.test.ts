import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import { buildCompLaneOverlayModel } from '../../services/compLaneOverlayService';
import { COMP_CLIP_ID_PREFIX } from '../../services/takeCompingService';
import { Clip, TrackType } from '../../types';

const makeAudioClip = (id: string, start: number, length: number): Clip => ({
    id,
    name: id,
    color: '#7c3aed',
    notes: [],
    start,
    length,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1
});

describe('compLaneOverlayService.buildCompLaneOverlayModel', () => {
    it('builds visible comp overlays with lane metadata and take aliases', () => {
        const track = createTrack({
            id: 'track-overlay',
            name: 'Overlay',
            type: TrackType.AUDIO,
            clips: [
                makeAudioClip('clip-source-1', 1, 2),
                makeAudioClip('clip-source-2', 3, 2),
                makeAudioClip(`${COMP_CLIP_ID_PREFIX}seg-1`, 8, 2),
                makeAudioClip(`${COMP_CLIP_ID_PREFIX}seg-2`, 10, 2)
            ],
            recordingTakes: [
                {
                    id: 'take-1',
                    clipId: 'clip-source-1',
                    trackId: 'track-overlay',
                    laneId: 'lane-rec',
                    startBar: 1,
                    lengthBars: 2,
                    offsetBars: 0,
                    createdAt: 1,
                    label: 'Lead A'
                },
                {
                    id: 'take-2',
                    clipId: 'clip-source-2',
                    trackId: 'track-overlay',
                    laneId: 'lane-rec',
                    startBar: 3,
                    lengthBars: 2,
                    offsetBars: 0,
                    createdAt: 2
                }
            ],
            takeLanes: [
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-overlay',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-1',
                            takeId: 'take-1',
                            sourceStartBar: 1,
                            sourceEndBar: 3,
                            targetStartBar: 8
                        },
                        {
                            id: 'seg-2',
                            takeId: 'take-2',
                            sourceStartBar: 3,
                            sourceEndBar: 5,
                            targetStartBar: 10
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const model = buildCompLaneOverlayModel({
            track,
            zoom: 10,
            viewportLeftPx: 0,
            viewportWidthPx: 500
        });

        expect(model.laneId).toBe('lane-comp');
        expect(model.isActiveLane).toBe(true);
        expect(model.visibleSegments).toHaveLength(2);
        expect(model.visibleSegments[0].takeAlias).toBe('Lead A');
        expect(model.visibleSegments[1].takeAlias).toBe('2');
    });

    it('creates comp boundary handles with fade bars clamped to max segment span', () => {
        const track = createTrack({
            id: 'track-boundary',
            name: 'Boundary',
            type: TrackType.AUDIO,
            clips: [
                makeAudioClip('clip-source-1', 1, 2),
                makeAudioClip('clip-source-2', 3, 1),
                makeAudioClip(`${COMP_CLIP_ID_PREFIX}seg-1`, 8, 2),
                makeAudioClip(`${COMP_CLIP_ID_PREFIX}seg-2`, 10, 1)
            ],
            recordingTakes: [
                {
                    id: 'take-1',
                    clipId: 'clip-source-1',
                    trackId: 'track-boundary',
                    laneId: 'lane-rec',
                    startBar: 1,
                    lengthBars: 2,
                    offsetBars: 0,
                    createdAt: 1
                },
                {
                    id: 'take-2',
                    clipId: 'clip-source-2',
                    trackId: 'track-boundary',
                    laneId: 'lane-rec',
                    startBar: 3,
                    lengthBars: 1,
                    offsetBars: 0,
                    createdAt: 2
                }
            ],
            takeLanes: [
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-boundary',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-1',
                            takeId: 'take-1',
                            sourceStartBar: 1,
                            sourceEndBar: 3,
                            targetStartBar: 8,
                            fadeOutBars: 2
                        },
                        {
                            id: 'seg-2',
                            takeId: 'take-2',
                            sourceStartBar: 3,
                            sourceEndBar: 4,
                            targetStartBar: 10,
                            fadeInBars: 0.25
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const model = buildCompLaneOverlayModel({
            track,
            zoom: 20,
            viewportLeftPx: 0,
            viewportWidthPx: 1200
        });

        expect(model.boundaryHandles).toHaveLength(1);
        expect(model.boundaryHandles[0].maxFadeBars).toBeCloseTo(1, 6);
        expect(model.boundaryHandles[0].currentFadeBars).toBeCloseTo(1, 6);
        expect(model.boundaryHandles[0].leftClipId).toBe(`${COMP_CLIP_ID_PREFIX}seg-1`);
        expect(model.boundaryHandles[0].rightClipId).toBe(`${COMP_CLIP_ID_PREFIX}seg-2`);
    });

    it('skips boundary handles when comp-derived clips are missing', () => {
        const track = createTrack({
            id: 'track-missing-derived',
            name: 'Missing Derived',
            type: TrackType.AUDIO,
            clips: [
                makeAudioClip('clip-source-1', 1, 2),
                makeAudioClip('clip-source-2', 3, 2),
                makeAudioClip(`${COMP_CLIP_ID_PREFIX}seg-1`, 8, 2)
            ],
            recordingTakes: [
                {
                    id: 'take-1',
                    clipId: 'clip-source-1',
                    trackId: 'track-missing-derived',
                    laneId: 'lane-rec',
                    startBar: 1,
                    lengthBars: 2,
                    offsetBars: 0,
                    createdAt: 1
                },
                {
                    id: 'take-2',
                    clipId: 'clip-source-2',
                    trackId: 'track-missing-derived',
                    laneId: 'lane-rec',
                    startBar: 3,
                    lengthBars: 2,
                    offsetBars: 0,
                    createdAt: 2
                }
            ],
            takeLanes: [
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-missing-derived',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-1',
                            takeId: 'take-1',
                            sourceStartBar: 1,
                            sourceEndBar: 3,
                            targetStartBar: 8
                        },
                        {
                            id: 'seg-2',
                            takeId: 'take-2',
                            sourceStartBar: 3,
                            sourceEndBar: 5,
                            targetStartBar: 10
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp'
        });

        const model = buildCompLaneOverlayModel({
            track,
            zoom: 20,
            viewportLeftPx: 0,
            viewportWidthPx: 1200
        });

        expect(model.visibleSegments).toHaveLength(2);
        expect(model.boundaryHandles).toHaveLength(0);
    });
});

