import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getTransportClockSnapshot,
    resetTransportClockSnapshot,
    setTransportClockSnapshot,
    subscribeTransportClock
} from '../../services/transportClockStore';

describe('transportClockStore', () => {
    beforeEach(() => {
        resetTransportClockSnapshot();
    });

    it('publishes updates when cursor position changes', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeTransportClock(listener);

        setTransportClockSnapshot({
            currentBar: 3,
            currentBeat: 2,
            currentSixteenth: 1,
            isPlaying: true
        });

        const snapshot = getTransportClockSnapshot();
        expect(snapshot.currentBar).toBe(3);
        expect(snapshot.currentBeat).toBe(2);
        expect(snapshot.isPlaying).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);

        unsubscribe();
    });

    it('does not notify listeners if incoming state is identical', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeTransportClock(listener);

        setTransportClockSnapshot({
            currentBar: 1,
            currentBeat: 1,
            currentSixteenth: 1,
            isPlaying: false
        });

        expect(listener).toHaveBeenCalledTimes(0);
        unsubscribe();
    });
});
