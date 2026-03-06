import { describe, expect, it } from 'vitest';
import {
    resolveCrossfadeCommitBars,
    resolveCrossfadePreviewBars
} from '../../services/timelineCrossfadeService';

describe('timelineCrossfadeService', () => {
    it('clamps preview crossfade drag to overlap range', () => {
        expect(resolveCrossfadePreviewBars(2, 0.5, 0.75)).toBeCloseTo(1.25, 6);
        expect(resolveCrossfadePreviewBars(2, 0.5, -2)).toBe(0);
        expect(resolveCrossfadePreviewBars(2, 0.5, 5)).toBe(2);
    });

    it('resolves commit bars from current fades with safe defaults', () => {
        expect(resolveCrossfadeCommitBars(1.5, 0, 0)).toBeCloseTo(1.5, 6);
        expect(resolveCrossfadeCommitBars(1.5, 0.75, 0.5)).toBeCloseTo(0.75, 6);
        expect(resolveCrossfadeCommitBars(1.5, 4, 0.5)).toBeCloseTo(1.5, 6);
    });
});
