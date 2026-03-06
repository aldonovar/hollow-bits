import { describe, expect, it } from 'vitest';
import { createTrack } from '../../services/projectCoreService';
import {
    buildRecordingTakeCommit,
    commitRecordingTakeBatch
} from '../../services/recordingTakeService';
import { TrackType } from '../../types';

const createDeterministicIdFactory = () => {
    let counter = 0;
    return (prefix: string) => `${prefix}-${++counter}`;
};

const makeMockBuffer = (duration: number): AudioBuffer => {
    return { duration } as AudioBuffer;
};

describe('recordingTakeService.buildRecordingTakeCommit', () => {
    it('creates a new take lane and applies start compensation with offset clamp', () => {
        const track = createTrack({
            id: 'track-rec-1',
            name: 'VOX',
            type: TrackType.AUDIO,
            color: '#FF0000'
        });

        const commit = buildRecordingTakeCommit({
            track,
            sourceId: 'hash-001',
            buffer: makeMockBuffer(4),
            bpm: 120,
            recordingStartBar: 1.2,
            latencyCompensationBars: 0.5,
            idFactory: createDeterministicIdFactory(),
            recordedAt: 1700000000000
        });

        expect(commit.trackId).toBe(track.id);
        expect(commit.laneId).toBe('lane-rec-1');
        expect(commit.laneName).toBe('Take Lane 1');
        expect(commit.clip.start).toBe(1);
        expect(commit.clip.offset).toBeCloseTo(0.3, 6);
        expect(commit.clip.length).toBeCloseTo(2, 6);
        expect(commit.take.startBar).toBe(1);
        expect(commit.take.offsetBars).toBeCloseTo(0.3, 6);
    });

    it('reuses existing recording lane and keeps take numbering', () => {
        const track = createTrack({
            id: 'track-rec-2',
            name: 'GTR',
            type: TrackType.AUDIO,
            takeLanes: [
                {
                    id: 'lane-existing',
                    name: 'Take Lane A',
                    trackId: 'track-rec-2',
                    takeIds: ['take-1']
                }
            ],
            recordingTakes: [
                {
                    id: 'take-1',
                    clipId: 'clip-1',
                    trackId: 'track-rec-2',
                    laneId: 'lane-existing',
                    startBar: 1,
                    lengthBars: 1,
                    offsetBars: 0,
                    createdAt: 1
                },
                {
                    id: 'take-2',
                    clipId: 'clip-2',
                    trackId: 'track-rec-2',
                    laneId: 'lane-existing',
                    startBar: 2,
                    lengthBars: 1,
                    offsetBars: 0,
                    createdAt: 2
                }
            ]
        });

        const commit = buildRecordingTakeCommit({
            track,
            sourceId: 'hash-002',
            buffer: makeMockBuffer(2),
            bpm: 100,
            recordingStartBar: 5,
            idFactory: createDeterministicIdFactory()
        });

        expect(commit.laneId).toBe('lane-existing');
        expect(commit.laneName).toBe('Take Lane A');
        expect(commit.take.label).toBe('Take 3');
    });

    it('applies source trim offset for punch/count-in capture windows', () => {
        const track = createTrack({
            id: 'track-rec-trim',
            name: 'Vox Trim',
            type: TrackType.AUDIO
        });

        const commit = buildRecordingTakeCommit({
            track,
            sourceId: 'hash-trim',
            buffer: makeMockBuffer(8),
            bpm: 120,
            recordingStartBar: 3,
            sourceTrimOffsetBars: 1.5,
            idFactory: createDeterministicIdFactory()
        });

        expect(commit.clip.offset).toBeCloseTo(1.5, 6);
        expect(commit.take.offsetBars).toBeCloseTo(1.5, 6);
        expect(commit.clip.length).toBeCloseTo(2.5, 6);
        expect(commit.take.lengthBars).toBeCloseTo(2.5, 6);
    });
});

describe('recordingTakeService.commitRecordingTakeBatch', () => {
    it('commits clips and takes atomically per track without touching unrelated tracks', () => {
        const sourceTrack = createTrack({
            id: 'track-rec-3',
            name: 'BASS',
            type: TrackType.AUDIO
        });
        const untouchedTrack = createTrack({
            id: 'track-rec-4',
            name: 'PAD',
            type: TrackType.AUDIO
        });

        const idFactory = createDeterministicIdFactory();
        const firstCommit = buildRecordingTakeCommit({
            track: sourceTrack,
            sourceId: 'hash-a',
            buffer: makeMockBuffer(1),
            bpm: 120,
            recordingStartBar: 3,
            idFactory
        });
        const secondCommit = buildRecordingTakeCommit({
            track: sourceTrack,
            sourceId: 'hash-b',
            buffer: makeMockBuffer(1),
            bpm: 120,
            recordingStartBar: 4,
            idFactory
        });
        const normalizedSecondCommit = {
            ...secondCommit,
            laneId: firstCommit.laneId,
            laneName: firstCommit.laneName,
            take: {
                ...secondCommit.take,
                laneId: firstCommit.laneId
            }
        };

        const result = commitRecordingTakeBatch([sourceTrack, untouchedTrack], [firstCommit, normalizedSecondCommit]);

        expect(result).toHaveLength(2);
        expect(result[1]).toBe(untouchedTrack);
        expect(result[0].clips).toHaveLength(2);
        expect(result[0].recordingTakes).toHaveLength(2);
        expect(result[0].takeLanes).toHaveLength(1);
        expect(result[0].takeLanes?.[0].takeIds).toEqual([firstCommit.take.id, normalizedSecondCommit.take.id]);
    });

    it('handles 1000 sequential recording finalization cycles without dropping takes', () => {
        const idFactory = createDeterministicIdFactory();
        let tracks = [
            createTrack({
                id: 'track-rec-stress',
                name: 'STRESS',
                type: TrackType.AUDIO
            })
        ];

        for (let cycle = 0; cycle < 1000; cycle += 1) {
            const sourceTrack = tracks[0];
            const commit = buildRecordingTakeCommit({
                track: sourceTrack,
                sourceId: `hash-${cycle}`,
                buffer: makeMockBuffer(0.5),
                bpm: 120,
                recordingStartBar: 1 + (cycle * 0.25),
                idFactory
            });

            tracks = commitRecordingTakeBatch(tracks, [commit]);
        }

        const finalTrack = tracks[0];
        const takeIds = finalTrack.recordingTakes?.map((take) => take.id) || [];

        expect(finalTrack.clips).toHaveLength(1000);
        expect(finalTrack.recordingTakes).toHaveLength(1000);
        expect(new Set(takeIds).size).toBe(1000);
        expect(finalTrack.takeLanes).toHaveLength(1);
        expect(finalTrack.takeLanes?.[0].takeIds).toHaveLength(1000);
    });
});
