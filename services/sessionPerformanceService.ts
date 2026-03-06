import type { EngineDiagnostics } from './engineAdapter';

export type SessionOverloadMode = 'normal' | 'guarded' | 'critical';
export type SessionAnimationLevel = 'full' | 'reduced' | 'minimal';

export interface SessionOverloadInput {
    engineStats: Pick<
        EngineDiagnostics,
        'highLoadDetected'
        | 'schedulerCpuLoadP95Percent'
        | 'schedulerOverrunRatio'
    > | null | undefined;
    sessionTrackCount: number;
    sceneCount: number;
    recentDropoutDelta?: number;
    recentUnderrunDelta?: number;
}

export interface SessionOverloadDecision {
    mode: SessionOverloadMode;
    animationLevel: SessionAnimationLevel;
    uiUpdateDebounceMs: number;
    virtualizeTracks: boolean;
    maxVisibleTrackColumns: number | null;
    showOverloadBanner: boolean;
    reasons: string[];
}

export interface SessionTrackWindowInput {
    totalTracks: number;
    trackColumnWidthPx: number;
    trackGapPx: number;
    viewportLeftPx: number;
    viewportWidthPx: number;
    overscanTracks?: number;
}

export interface SessionTrackWindow {
    startIndex: number;
    endIndex: number;
    leftSpacerPx: number;
    rightSpacerPx: number;
    totalWidthPx: number;
}

const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

const safeNumber = (value: number | undefined | null, fallback = 0): number => {
    return Number.isFinite(value) ? Number(value) : fallback;
};

const computeTrackAreaWidth = (trackCount: number, trackColumnWidthPx: number, trackGapPx: number): number => {
    if (trackCount <= 0) return 0;
    return (trackCount * trackColumnWidthPx) + ((trackCount - 1) * trackGapPx);
};

export const buildSessionTrackWindow = (input: SessionTrackWindowInput): SessionTrackWindow => {
    const totalTracks = Math.max(0, Math.floor(input.totalTracks));
    const trackColumnWidthPx = Math.max(1, Math.floor(input.trackColumnWidthPx));
    const trackGapPx = Math.max(0, Math.floor(input.trackGapPx));
    const viewportLeftPx = Math.max(0, safeNumber(input.viewportLeftPx));
    const viewportWidthPx = Math.max(1, safeNumber(input.viewportWidthPx, 1));
    const overscanTracks = clamp(Math.floor(input.overscanTracks || 0), 0, 32);

    const totalWidthPx = computeTrackAreaWidth(totalTracks, trackColumnWidthPx, trackGapPx);
    if (totalTracks === 0) {
        return {
            startIndex: 0,
            endIndex: -1,
            leftSpacerPx: 0,
            rightSpacerPx: 0,
            totalWidthPx: 0
        };
    }

    const trackStridePx = trackColumnWidthPx + trackGapPx;
    const viewportRightPx = viewportLeftPx + viewportWidthPx;

    const rawStart = Math.floor(viewportLeftPx / trackStridePx) - overscanTracks;
    const rawEnd = Math.ceil(viewportRightPx / trackStridePx) + overscanTracks - 1;

    const startIndex = clamp(rawStart, 0, totalTracks - 1);
    const endIndex = clamp(Math.max(startIndex, rawEnd), startIndex, totalTracks - 1);

    const leftSpacerPx = startIndex * trackStridePx;
    const visibleCount = (endIndex - startIndex) + 1;
    const visibleWidthPx = (visibleCount * trackColumnWidthPx) + (Math.max(0, visibleCount - 1) * trackGapPx);
    const rightSpacerPx = Math.max(0, totalWidthPx - leftSpacerPx - visibleWidthPx);

    return {
        startIndex,
        endIndex,
        leftSpacerPx,
        rightSpacerPx,
        totalWidthPx
    };
};

export const assessSessionOverload = (input: SessionOverloadInput): SessionOverloadDecision => {
    const reasons: string[] = [];
    const sessionTrackCount = Math.max(0, Math.floor(input.sessionTrackCount));
    const sceneCount = Math.max(1, Math.floor(input.sceneCount));
    const slotCount = sessionTrackCount * sceneCount;

    const cpuP95 = safeNumber(input.engineStats?.schedulerCpuLoadP95Percent, 0);
    const overrunRatio = safeNumber(input.engineStats?.schedulerOverrunRatio, 0);
    const highLoadDetected = Boolean(input.engineStats?.highLoadDetected);
    const recentDropoutDelta = Math.max(0, safeNumber(input.recentDropoutDelta, 0));
    const recentUnderrunDelta = Math.max(0, safeNumber(input.recentUnderrunDelta, 0));

    let mode: SessionOverloadMode = 'normal';

    if (slotCount >= 384) {
        reasons.push('session-grid-48x8-or-higher');
    }
    if (highLoadDetected) {
        reasons.push('engine-high-load');
    }
    if (cpuP95 >= 72) {
        reasons.push(`cpu-p95-${cpuP95.toFixed(1)}`);
    }
    if (overrunRatio >= 0.18) {
        reasons.push(`overrun-ratio-${(overrunRatio * 100).toFixed(1)}pct`);
    }
    if (recentDropoutDelta > 0) {
        reasons.push(`dropout-delta-${recentDropoutDelta}`);
    }
    if (recentUnderrunDelta > 0) {
        reasons.push(`underrun-delta-${recentUnderrunDelta}`);
    }

    const guarded =
        slotCount >= 384
        || highLoadDetected
        || cpuP95 >= 72
        || overrunRatio >= 0.18
        || recentDropoutDelta > 0
        || recentUnderrunDelta > 0;

    const critical =
        cpuP95 >= 86
        || overrunRatio >= 0.32
        || recentDropoutDelta >= 2
        || (slotCount >= 384 && cpuP95 >= 80)
        || (slotCount >= 384 && overrunRatio >= 0.25);

    if (critical) {
        mode = 'critical';
    } else if (guarded) {
        mode = 'guarded';
    }

    if (mode === 'critical') {
        return {
            mode,
            animationLevel: 'minimal',
            uiUpdateDebounceMs: 72,
            virtualizeTracks: true,
            maxVisibleTrackColumns: 14,
            showOverloadBanner: true,
            reasons
        };
    }

    if (mode === 'guarded') {
        return {
            mode,
            animationLevel: 'reduced',
            uiUpdateDebounceMs: 36,
            virtualizeTracks: true,
            maxVisibleTrackColumns: 20,
            showOverloadBanner: true,
            reasons
        };
    }

    return {
        mode: 'normal',
        animationLevel: 'full',
        uiUpdateDebounceMs: 12,
        virtualizeTracks: slotCount >= 256,
        maxVisibleTrackColumns: null,
        showOverloadBanner: false,
        reasons
    };
};

export const computeLaunchTimingErrorMs = (
    requestedLaunchTimeSec: number,
    actualLaunchTimeSec: number
): number => {
    const requested = safeNumber(requestedLaunchTimeSec, 0);
    const actual = safeNumber(actualLaunchTimeSec, requested);
    return Math.abs(actual - requested) * 1000;
};

