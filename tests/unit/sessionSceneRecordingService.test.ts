import { describe, expect, it } from 'vitest';
import {
    appendSceneRecordingEvent,
    buildSceneReplayPlan,
    createSceneRecordingEvent
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
});

