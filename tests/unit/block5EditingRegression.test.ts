import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import { repairProjectData } from '../../services/projectIntegrityService';
import {
    applyTrackClipEdits,
    COMP_CLIP_ID_PREFIX,
    promoteTakeToComp,
    rebuildCompDerivedClips,
    resolvePunchRecordingPlan,
    shouldFinalizePunchRecording,
    splitTakeForClip
} from '../../services/takeCompingService';
import { Clip, ProjectData, TrackType, TransportState } from '../../types';

const makeAudioClip = (id: string, start: number, length: number): Clip => ({
    id,
    name: id,
    color: '#ff4db8',
    notes: [],
    start,
    length,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1,
    originalBpm: 124
});

const transportFixture: TransportState = {
    isPlaying: false,
    isRecording: false,
    loopMode: 'off',
    bpm: 124,
    timeSignature: [4, 4],
    currentBar: 1,
    currentBeat: 1,
    currentSixteenth: 1,
    masterTranspose: 0,
    gridSize: 0.25,
    snapToGrid: true,
    scaleRoot: 0,
    scaleType: 'minor'
};

const makeIdFactory = () => {
    let count = 0;
    return (prefix: string) => `${prefix}-${++count}`;
};

describe('block5EditingRegression.punch-auto-stop-mixed-ranges', () => {
    it('uses the combined punch window and finalizes only at the latest out-bar', () => {
        const trackA = createTrack({
            id: 'vox-a',
            name: 'VOX A',
            type: TrackType.AUDIO,
            isArmed: true,
            punchRange: { enabled: true, inBar: 9, outBar: 13, preRollBars: 2, countInBars: 1 }
        });
        const trackB = createTrack({
            id: 'vox-b',
            name: 'VOX B',
            type: TrackType.AUDIO,
            isArmed: true,
            punchRange: { enabled: true, inBar: 7, outBar: 15, preRollBars: 1, countInBars: 0 }
        });

        const plan = resolvePunchRecordingPlan([trackA, trackB]);
        expect(plan?.startPlaybackBar).toBe(4);
        expect(plan?.sourceTrimOffsetBars).toBe(3);

        const decisionBefore = shouldFinalizePunchRecording(14.95, ['vox-a', 'vox-b'], new Map([
            ['vox-a', { punchOutBar: 13 }],
            ['vox-b', { punchOutBar: 15 }]
        ]));
        const decisionAt = shouldFinalizePunchRecording(15, ['vox-a', 'vox-b'], new Map([
            ['vox-a', { punchOutBar: 13 }],
            ['vox-b', { punchOutBar: 15 }]
        ]));

        expect(decisionBefore.shouldFinalize).toBe(false);
        expect(decisionAt.shouldFinalize).toBe(true);
        expect(decisionAt.targetPunchOutBar).toBe(15);
    });
});

describe('block5EditingRegression.comping-edit-regression-matrix', () => {
    it('keeps comp metadata coherent after promote, split and clip edits', () => {
        const sourceClip = makeAudioClip('clip-matrix', 2, 4);
        const track = createTrack({
            id: 'track-matrix',
            name: 'MATRIX',
            type: TrackType.AUDIO,
            clips: [sourceClip],
            recordingTakes: [
                {
                    id: 'take-matrix',
                    clipId: 'clip-matrix',
                    trackId: 'track-matrix',
                    laneId: 'lane-rec',
                    startBar: 2,
                    lengthBars: 4,
                    offsetBars: 0,
                    createdAt: 1,
                    label: 'Take 1'
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-matrix',
                    takeIds: ['take-matrix']
                }
            ]
        });

        const promoted = promoteTakeToComp(track, 'take-matrix', {
            replaceExisting: true,
            idFactory: makeIdFactory()
        });
        const leftClip = { ...sourceClip, id: 'clip-matrix-left', length: 2 };
        const rightClip = { ...sourceClip, id: 'clip-matrix-right', start: 4, length: 2, offset: 2 };
        const splitTrack = splitTakeForClip(
            { ...promoted, clips: [leftClip, rightClip, ...promoted.clips.filter((clip) => clip.id.startsWith(COMP_CLIP_ID_PREFIX))] },
            'clip-matrix',
            leftClip,
            rightClip,
            makeIdFactory()
        );
        const rebuilt = rebuildCompDerivedClips(splitTrack);
        const compClip = rebuilt.clips.find((clip) => clip.id.startsWith(COMP_CLIP_ID_PREFIX));
        expect(compClip).toBeTruthy();

        const edited = applyTrackClipEdits(rebuilt, compClip!.id, {
            start: 9,
            length: 1.5,
            offset: 1.5,
            fadeIn: 0.25,
            fadeOut: 0.25
        });
        const compLane = edited.takeLanes?.find((lane) => lane.isCompLane);
        expect(compLane?.compSegments?.length).toBeGreaterThan(0);
        expect(edited.clips.some((clip) => clip.id === compClip!.id && clip.start === 9)).toBe(true);
        expect(new Set((edited.recordingTakes || []).map((take) => take.id)).size).toBe((edited.recordingTakes || []).length);
    });
});

describe('block5EditingRegression.roundtrip-save-open-recover-comped-project', () => {
    it('keeps comp lane and takes usable after a save/open style roundtrip repair', () => {
        const clip = makeAudioClip('clip-roundtrip', 1, 4);
        const compedTrack = rebuildCompDerivedClips(createTrack({
            id: 'track-roundtrip',
            name: 'ROUNDTRIP',
            type: TrackType.AUDIO,
            clips: [clip],
            recordingTakes: [
                {
                    id: 'take-roundtrip',
                    clipId: 'clip-roundtrip',
                    trackId: 'track-roundtrip',
                    laneId: 'lane-rec',
                    startBar: 1,
                    lengthBars: 4,
                    offsetBars: 0,
                    createdAt: 1
                }
            ],
            takeLanes: [
                {
                    id: 'lane-rec',
                    name: 'Take Lane 1',
                    trackId: 'track-roundtrip',
                    takeIds: ['take-roundtrip']
                },
                {
                    id: 'lane-comp',
                    name: 'Comp Lane',
                    trackId: 'track-roundtrip',
                    isCompLane: true,
                    takeIds: [],
                    compSegments: [
                        {
                            id: 'seg-roundtrip',
                            takeId: 'take-roundtrip',
                            sourceStartBar: 1,
                            sourceEndBar: 5,
                            targetStartBar: 8
                        }
                    ]
                }
            ],
            activeCompLaneId: 'lane-comp',
            punchRange: {
                enabled: true,
                inBar: 8,
                outBar: 12,
                preRollBars: 1,
                countInBars: 1
            }
        }));

        const project: ProjectData = {
            version: '3.0-reference',
            name: 'Block 5 Roundtrip',
            tracks: [compedTrack],
            transport: transportFixture,
            audioSettings: {
                sampleRate: 48000,
                bufferSize: 'auto',
                latencyHint: 'interactive'
            },
            createdAt: 10,
            lastModified: 20
        };

        const reopened = JSON.parse(JSON.stringify(project));
        const repaired = repairProjectData(reopened, { source: 'block5-roundtrip' }).project;
        const repairedTrack = repaired.tracks[0];

        expect(repairedTrack.recordingTakes?.map((take) => take.id)).toEqual(['take-roundtrip']);
        expect(repairedTrack.takeLanes?.some((lane) => lane.isCompLane)).toBe(true);
        expect(repairedTrack.takeLanes?.find((lane) => lane.isCompLane)?.compSegments?.[0].id).toBe('seg-roundtrip');
        expect(repairedTrack.clips.some((candidate) => candidate.id === 'comp-seg-seg-roundtrip')).toBe(true);
        expect(repairedTrack.punchRange?.enabled).toBe(true);
    });
});
