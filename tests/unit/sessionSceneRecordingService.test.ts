import { describe, expect, it } from 'vitest';
import {
    appendSceneRecordingEvent,
    buildSceneReplayPlan,
    createSceneRecordingEvent,
    deserializeSceneRecordingEvents,
    serializeSceneRecordingEvents,
    summarizeSceneRecordingEvents
} from '../../services/sessionSceneRecordingService';

describe('sessionSceneRecordingService', () => {
    it('creates and appends scene recording events with clipping limit', () => {
        const first = createSceneRecordingEvent(0, 10, 1, [{ trackId: 't1', clipId: 'c1' }]);
        const second = createSceneRecordingEvent(1, 12, 1, [{ trackId: 't2', clipId: 'c2' }]);

        const listA = appendSceneRecordingEvent([], first, 2);
        const listB = appendSceneRecordingEvent(listA, second, 2);

        expect(listB).toHaveLength(2);
        expect(listB[0].sceneIndex).toBe(0);
        expect(listB[1].sceneIndex).toBe(1);

        const third = createSceneRecordingEvent(2, 14, 1, [{ trackId: 't3', clipId: 'c3' }]);
        const listC = appendSceneRecordingEvent(listB, third, 2);
        expect(listC).toHaveLength(2);
        expect(listC[0].sceneIndex).toBe(1);
        expect(listC[1].sceneIndex).toBe(2);
    });

    it('builds replay plan preserving relative launch offsets', () => {
        const events = [
            createSceneRecordingEvent(0, 20, 1, [{ trackId: 't1', clipId: 'c1' }]),
            createSceneRecordingEvent(2, 24, 1, [{ trackId: 't2', clipId: 'c2' }]),
            createSceneRecordingEvent(3, 27, 1, [{ trackId: 't3', clipId: 'c3' }])
        ];

        const replay = buildSceneReplayPlan(events, 100);
        expect(replay).toHaveLength(3);
        expect(replay[0].replayLaunchAtSec).toBeCloseTo(100, 6);
        expect(replay[1].replayLaunchAtSec).toBeCloseTo(104, 6);
        expect(replay[2].replayLaunchAtSec).toBeCloseTo(107, 6);
    });

    it('deduplicates accidental repeated launch events in same quantized instant', () => {
        const first = createSceneRecordingEvent(4, 64, 1, [
            { trackId: 't1', clipId: 'c1' },
            { trackId: 't2', clipId: 'c2' }
        ]);
        const repeated = {
            ...createSceneRecordingEvent(4, 64.03, 1, [
                { trackId: 't2', clipId: 'c2' },
                { trackId: 't1', clipId: 'c1' }
            ]),
            launchAtSec: 64.03
        };

        const withFirst = appendSceneRecordingEvent([], first, 16);
        const withRepeated = appendSceneRecordingEvent(withFirst, repeated, 16);
        expect(withRepeated).toHaveLength(1);
    });

    it('summarizes scene recording coverage and duration', () => {
        const events = [
            createSceneRecordingEvent(1, 10, 1, [{ trackId: 't1', clipId: 'c1' }]),
            createSceneRecordingEvent(3, 14, 1, [{ trackId: 't1', clipId: 'c2' }, { trackId: 't2', clipId: 'c3' }]),
            createSceneRecordingEvent(1, 17, 1, [{ trackId: 't2', clipId: 'c4' }])
        ];

        const summary = summarizeSceneRecordingEvents(events);
        expect(summary.eventCount).toBe(3);
        expect(summary.uniqueSceneCount).toBe(2);
        expect(summary.uniqueTrackCount).toBe(2);
        expect(summary.uniqueClipCount).toBe(4);
        expect(summary.durationSec).toBeCloseTo(7, 6);
    });

    it('serializes and deserializes recording events with stable ordering', () => {
        const events = [
            createSceneRecordingEvent(2, 12, 1, [{ trackId: 't2', clipId: 'c2' }]),
            createSceneRecordingEvent(1, 10, 1, [{ trackId: 't1', clipId: 'c1' }])
        ];

        const payload = serializeSceneRecordingEvents(events);
        const restored = deserializeSceneRecordingEvents(payload);

        expect(payload.version).toBe(1);
        expect(restored).toHaveLength(2);
        expect(restored[0].sceneIndex).toBe(1);
        expect(restored[1].sceneIndex).toBe(2);
    });
});
