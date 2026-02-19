import { describe, expect, it } from 'vitest';
import {
    barTimeToPosition,
    barToSeconds,
    getLoopEndAction,
    getSecondsPerBar,
    positionToBarTime,
    shouldRestartAtSongBoundary
} from '../../services/transportStateService';

describe('transportStateService', () => {
    it('calculates seconds per bar with BPM clamping', () => {
        expect(getSecondsPerBar(120)).toBeCloseTo(2, 6);
        expect(getSecondsPerBar(0)).toBeCloseTo(12, 6);
        expect(getSecondsPerBar(5000)).toBeCloseTo((60 / 999) * 4, 6);
    });

    it('converts bars to seconds with safe boundaries', () => {
        expect(barToSeconds(1, 120)).toBe(0);
        expect(barToSeconds(3, 120)).toBeCloseTo(4, 6);
        expect(barToSeconds(-10, 120)).toBe(0);
    });

    it('converts between position and bar time deterministically', () => {
        const barTime = positionToBarTime({
            currentBar: 5,
            currentBeat: 2,
            currentSixteenth: 3
        });

        expect(barTime).toBeCloseTo(5.375, 6);
        expect(barTimeToPosition(barTime)).toEqual({
            currentBar: 5,
            currentBeat: 2,
            currentSixteenth: 3
        });
    });

    it('resolves loop transitions for off, once and infinite', () => {
        expect(getLoopEndAction('off', 5)).toEqual({
            action: 'stop',
            nextOnceRemaining: 0
        });

        expect(getLoopEndAction('infinite', 5)).toEqual({
            action: 'restart',
            nextOnceRemaining: 5
        });

        expect(getLoopEndAction('once', 1)).toEqual({
            action: 'restart',
            nextOnceRemaining: 0,
            nextLoopMode: 'off'
        });

        expect(getLoopEndAction('once', 0)).toEqual({
            action: 'stop',
            nextOnceRemaining: 0,
            nextLoopMode: 'off'
        });
    });

    it('detects song boundary restart window robustly', () => {
        expect(shouldRestartAtSongBoundary(9.99, 10, 0.02)).toBe(true);
        expect(shouldRestartAtSongBoundary(9.9, 10, 0.02)).toBe(false);
        expect(shouldRestartAtSongBoundary(Number.NaN, 10, 0.02)).toBe(false);
        expect(shouldRestartAtSongBoundary(10, 0, 0.02)).toBe(false);
    });
});
