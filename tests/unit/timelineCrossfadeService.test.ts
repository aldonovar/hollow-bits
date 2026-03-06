import { describe, expect, it } from 'vitest';
import {
    resolveCompBoundaryFadeCommitBars,
    resolveCompBoundaryFadePreviewBars,
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

    it('clamps comp boundary preview fades to 0..max range', () => {
        expect(resolveCompBoundaryFadePreviewBars(1, 0.25, 0.5)).toBeCloseTo(0.75, 6);
        expect(resolveCompBoundaryFadePreviewBars(1, 0.25, -2)).toBe(0);
        expect(resolveCompBoundaryFadePreviewBars(1, 0.25, 3)).toBe(1);
    });

    it('resolves comp boundary commit using strongest side and clamps to max', () => {
        expect(resolveCompBoundaryFadeCommitBars(1, 0.6, 0.3)).toBeCloseTo(0.6, 6);
        expect(resolveCompBoundaryFadeCommitBars(1, 2, 0.3)).toBe(1);
        expect(resolveCompBoundaryFadeCommitBars(1, 0, 0)).toBe(0);
    });
});
