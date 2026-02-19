import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackHeaderMeterStore } from '../../services/trackHeaderMeterStore';

describe('trackHeaderMeterStore', () => {
    beforeEach(() => {
        trackHeaderMeterStore.prune(new Set());
    });

    it('notifies only when values change meaningfully', () => {
        const listener = vi.fn();
        const unsubscribe = trackHeaderMeterStore.subscribe('track-a', listener);

        trackHeaderMeterStore.publishBatch({
            'track-a': { rmsDb: -18, peakDb: -8, clipped: false }
        });

        trackHeaderMeterStore.publishBatch({
            'track-a': { rmsDb: -17.94, peakDb: -8.05, clipped: false }
        });

        trackHeaderMeterStore.publishBatch({
            'track-a': { rmsDb: -16.6, peakDb: -7.9, clipped: false }
        });

        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
    });

    it('resets a track to defaults after prune', () => {
        trackHeaderMeterStore.publishBatch({
            'track-z': { rmsDb: -10, peakDb: -3, clipped: true }
        });

        expect(trackHeaderMeterStore.getSnapshot('track-z').clipped).toBe(true);

        trackHeaderMeterStore.prune(new Set());

        const snapshot = trackHeaderMeterStore.getSnapshot('track-z');
        expect(snapshot.rmsDb).toBe(-72);
        expect(snapshot.peakDb).toBe(-72);
        expect(snapshot.clipped).toBe(false);
    });
});
