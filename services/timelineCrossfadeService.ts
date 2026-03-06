const MIN_CROSSFADE_BARS = 1 / 1024;

export const resolveCrossfadePreviewBars = (
    overlapLengthBars: number,
    initialFadeBars: number,
    deltaBars: number
): number => {
    const safeOverlap = Math.max(MIN_CROSSFADE_BARS, Number.isFinite(overlapLengthBars) ? overlapLengthBars : MIN_CROSSFADE_BARS);
    const safeInitial = Number.isFinite(initialFadeBars) ? initialFadeBars : 0;
    const safeDelta = Number.isFinite(deltaBars) ? deltaBars : 0;
    const requested = safeInitial + safeDelta;

    return Math.max(0, Math.min(safeOverlap, requested));
};

export const resolveCrossfadeCommitBars = (
    overlapLengthBars: number,
    currentLeftFadeOutBars: number,
    currentRightFadeInBars: number
): number => {
    const safeOverlap = Math.max(MIN_CROSSFADE_BARS, Number.isFinite(overlapLengthBars) ? overlapLengthBars : MIN_CROSSFADE_BARS);
    const baseFade = Math.max(
        Number.isFinite(currentLeftFadeOutBars) ? currentLeftFadeOutBars : 0,
        Number.isFinite(currentRightFadeInBars) ? currentRightFadeInBars : 0
    );
    const normalized = baseFade > MIN_CROSSFADE_BARS ? baseFade : safeOverlap;
    return Math.max(MIN_CROSSFADE_BARS, Math.min(safeOverlap, normalized));
};

export const resolveCompBoundaryFadePreviewBars = (
    maxFadeBars: number,
    initialFadeBars: number,
    deltaBars: number
): number => {
    const safeMax = Math.max(MIN_CROSSFADE_BARS, Number.isFinite(maxFadeBars) ? maxFadeBars : MIN_CROSSFADE_BARS);
    const safeInitial = Number.isFinite(initialFadeBars) ? initialFadeBars : 0;
    const safeDelta = Number.isFinite(deltaBars) ? deltaBars : 0;
    const requested = safeInitial + safeDelta;

    return Math.max(0, Math.min(safeMax, requested));
};

export const resolveCompBoundaryFadeCommitBars = (
    maxFadeBars: number,
    currentLeftFadeOutBars: number,
    currentRightFadeInBars: number
): number => {
    const safeMax = Math.max(MIN_CROSSFADE_BARS, Number.isFinite(maxFadeBars) ? maxFadeBars : MIN_CROSSFADE_BARS);
    const baseFade = Math.max(
        Number.isFinite(currentLeftFadeOutBars) ? currentLeftFadeOutBars : 0,
        Number.isFinite(currentRightFadeInBars) ? currentRightFadeInBars : 0
    );

    return Math.max(0, Math.min(safeMax, baseFade));
};
