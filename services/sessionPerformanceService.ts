import type { EngineDiagnostics } from './engineAdapter';
import type { SessionHealthSnapshot, StudioPerformanceProfile } from '../types';

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

export type GlobalAudioPriorityMode = 'normal' | 'guarded' | 'critical';

export interface GlobalAudioPriorityInput {
    engineStats: Pick<
        EngineDiagnostics,
        'highLoadDetected'
        | 'schedulerCpuLoadP95Percent'
        | 'schedulerOverrunRatio'
        | 'schedulerDropoutCount'
        | 'schedulerUnderrunCount'
    > | null | undefined;
    sessionTrackCount: number;
    sceneCount: number;
    uiFpsP95?: number;
    uiFrameDropRatio?: number;
    recentDropoutDelta?: number;
    recentUnderrunDelta?: number;
}

export interface GlobalAudioPriorityDecision {
    mode: GlobalAudioPriorityMode;
    uiUpdateDebounceMs: number;
    reduceAnimations: boolean;
    disableHeavyVisuals: boolean;
    simplifyMeters: boolean;
    showBanner: boolean;
    reasons: string[];
}

export type AudioPriorityReasonCode =
    | 'idle-no-realtime'
    | 'audio-dropouts-spike'
    | 'audio-underruns-spike'
    | 'audio-cpu-high'
    | 'audio-cpu-critical'
    | 'launch-jitter-high'
    | 'launch-jitter-critical'
    | 'ui-fps-low'
    | 'ui-frame-drop'
    | 'transport-drift-high'
    | 'transport-drift-critical'
    | 'monitor-latency-high'
    | 'hysteresis-hold'
    | 'cooldown-hold'
    | 'steady';

export interface ReducedSessionHealth extends GlobalAudioPriorityDecision {
    snapshot: SessionHealthSnapshot;
    reasonCode: AudioPriorityReasonCode;
}

export interface AudioPriorityTransition {
    sequence: number;
    atMs: number;
    fromMode: GlobalAudioPriorityMode;
    toMode: GlobalAudioPriorityMode;
    reasonCode: AudioPriorityReasonCode;
    reasons: string[];
    snapshot: SessionHealthSnapshot;
}

export interface AudioPriorityControllerDecision extends GlobalAudioPriorityDecision {
    snapshot: SessionHealthSnapshot;
    reasonCode: AudioPriorityReasonCode;
    transition: AudioPriorityTransition | null;
    transitionCount: number;
}

export interface AudioPriorityControllerConfig {
    profile?: StudioPerformanceProfile;
    escalationStreak?: number;
    criticalEscalationStreak?: number;
    deescalationStreak?: number;
    idleDeescalationStreak?: number;
    deescalationCooldownMs?: number;
    maxTransitionsPer20sIdle?: number;
}

export interface AudioPriorityController {
    evaluate: (snapshot: SessionHealthSnapshot, nowMs?: number) => AudioPriorityControllerDecision;
    getMode: () => GlobalAudioPriorityMode;
    getTransitions: () => AudioPriorityTransition[];
    reset: (mode?: GlobalAudioPriorityMode) => void;
}

export interface AudioPriorityStabilityReport {
    windowSec: number;
    maxTransitionsAllowed: number;
    transitionCount: number;
    maxTransitionsInWindow: number;
    passes: boolean;
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

export interface SessionLaunchTelemetrySample {
    trackId: string;
    clipId: string;
    sceneIndex?: number | null;
    requestedLaunchTimeSec: number;
    effectiveLaunchTimeSec: number;
    launchErrorMs: number;
    quantized: boolean;
    wasLate: boolean;
    capturedAtMs: number;
}

export interface SessionLaunchTelemetrySummary {
    sampleCount: number;
    lateSampleCount: number;
    avgLaunchErrorMs: number;
    p95LaunchErrorMs: number;
    p99LaunchErrorMs: number;
    maxLaunchErrorMs: number;
    gateTargetMs: number;
    gatePass: boolean;
}

export interface SessionLaunchReportScenario {
    name: string;
    tracks: number;
    scenes: number;
    quantizeBars: number;
    source: 'live-capture' | 'simulated';
}

export interface SessionLaunchReport {
    generatedAt: number;
    scenario: SessionLaunchReportScenario;
    summary: SessionLaunchTelemetrySummary;
    samples: SessionLaunchTelemetrySample[];
}

const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

const safeNumber = (value: number | undefined | null, fallback = 0): number => {
    return Number.isFinite(value) ? Number(value) : fallback;
};

const MODE_LEVEL: Record<GlobalAudioPriorityMode, number> = {
    normal: 0,
    guarded: 1,
    critical: 2
};

const clampInt = (value: number, fallback: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return fallback;
    return clamp(Math.floor(value), min, max);
};

const sanitizeSnapshot = (snapshot: SessionHealthSnapshot): SessionHealthSnapshot => {
    const profile: StudioPerformanceProfile = snapshot.profile === 'stage-safe' ? 'stage-safe' : 'studio';
    return {
        capturedAt: Math.max(0, safeNumber(snapshot.capturedAt, Date.now())),
        profile,
        hasRealtimeAudio: Boolean(snapshot.hasRealtimeAudio),
        cpuAudioP95Percent: Math.max(0, safeNumber(snapshot.cpuAudioP95Percent, 0)),
        dropoutsDelta: Math.max(0, Math.floor(safeNumber(snapshot.dropoutsDelta, 0))),
        underrunsDelta: Math.max(0, Math.floor(safeNumber(snapshot.underrunsDelta, 0))),
        launchErrorP95Ms: Math.max(0, safeNumber(snapshot.launchErrorP95Ms, 0)),
        uiFpsP95: Math.max(0, safeNumber(snapshot.uiFpsP95, 0)),
        uiFrameDropRatio: Math.max(0, safeNumber(snapshot.uiFrameDropRatio, 0)),
        transportDriftP99Ms: Math.max(0, safeNumber(snapshot.transportDriftP99Ms, 0)),
        monitorLatencyP95Ms: Math.max(0, safeNumber(snapshot.monitorLatencyP95Ms, 0))
    };
};

const buildPriorityDecision = (
    mode: GlobalAudioPriorityMode,
    reasons: string[],
    snapshot: SessionHealthSnapshot,
    reasonCode: AudioPriorityReasonCode
): ReducedSessionHealth => {
    if (mode === 'critical') {
        return {
            mode,
            uiUpdateDebounceMs: 72,
            reduceAnimations: true,
            disableHeavyVisuals: true,
            simplifyMeters: true,
            showBanner: snapshot.hasRealtimeAudio,
            reasons,
            snapshot,
            reasonCode
        };
    }

    if (mode === 'guarded') {
        return {
            mode,
            uiUpdateDebounceMs: 36,
            reduceAnimations: true,
            disableHeavyVisuals: false,
            simplifyMeters: true,
            showBanner: false,
            reasons,
            snapshot,
            reasonCode
        };
    }

    return {
        mode: 'normal',
        uiUpdateDebounceMs: 12,
        reduceAnimations: false,
        disableHeavyVisuals: false,
        simplifyMeters: false,
        showBanner: false,
        reasons,
        snapshot,
        reasonCode
    };
};

export const reduceSessionHealth = (inputSnapshot: SessionHealthSnapshot): ReducedSessionHealth => {
    const snapshot = sanitizeSnapshot(inputSnapshot);

    if (!snapshot.hasRealtimeAudio) {
        return buildPriorityDecision('normal', ['idle-no-realtime'], snapshot, 'idle-no-realtime');
    }

    const cpuGuardedThreshold = snapshot.profile === 'stage-safe' ? 68 : 72;
    const cpuCriticalThreshold = snapshot.profile === 'stage-safe' ? 82 : 88;

    const reasons: string[] = [];

    const hasDropoutsSpike = snapshot.dropoutsDelta >= 2;
    const hasUnderrunsSpike = snapshot.underrunsDelta >= 2;
    const hasCpuCritical = snapshot.cpuAudioP95Percent >= cpuCriticalThreshold;
    const hasLaunchCritical = snapshot.launchErrorP95Ms > 4;
    const hasDriftCritical = snapshot.transportDriftP99Ms > 10;

    if (snapshot.dropoutsDelta > 0) reasons.push(`dropouts-delta-${snapshot.dropoutsDelta}`);
    if (snapshot.underrunsDelta > 0) reasons.push(`underruns-delta-${snapshot.underrunsDelta}`);
    if (snapshot.cpuAudioP95Percent >= cpuGuardedThreshold) reasons.push(`cpu-audio-p95-${snapshot.cpuAudioP95Percent.toFixed(1)}`);
    if (snapshot.launchErrorP95Ms > 2) reasons.push(`launch-p95-${snapshot.launchErrorP95Ms.toFixed(2)}ms`);
    if (snapshot.transportDriftP99Ms > 5) reasons.push(`transport-drift-p99-${snapshot.transportDriftP99Ms.toFixed(2)}ms`);
    if (snapshot.monitorLatencyP95Ms > 12) reasons.push(`monitor-latency-p95-${snapshot.monitorLatencyP95Ms.toFixed(2)}ms`);
    if (snapshot.uiFpsP95 > 0 && snapshot.uiFpsP95 < 44) reasons.push(`ui-fps-p95-${snapshot.uiFpsP95.toFixed(1)}`);
    if (snapshot.uiFrameDropRatio >= 0.08) reasons.push(`ui-frame-drop-${(snapshot.uiFrameDropRatio * 100).toFixed(1)}pct`);

    if (hasDropoutsSpike) {
        return buildPriorityDecision('critical', reasons, snapshot, 'audio-dropouts-spike');
    }
    if (hasUnderrunsSpike) {
        return buildPriorityDecision('critical', reasons, snapshot, 'audio-underruns-spike');
    }
    if (hasCpuCritical) {
        return buildPriorityDecision('critical', reasons, snapshot, 'audio-cpu-critical');
    }
    if (hasLaunchCritical) {
        return buildPriorityDecision('critical', reasons, snapshot, 'launch-jitter-critical');
    }
    if (hasDriftCritical) {
        return buildPriorityDecision('critical', reasons, snapshot, 'transport-drift-critical');
    }

    const hasAudioGuarded =
        snapshot.dropoutsDelta > 0
        || snapshot.underrunsDelta > 0
        || snapshot.cpuAudioP95Percent >= cpuGuardedThreshold
        || snapshot.launchErrorP95Ms > 2
        || snapshot.transportDriftP99Ms > 5
        || snapshot.monitorLatencyP95Ms > 12;

    const hasUiGuarded =
        (snapshot.uiFpsP95 > 0 && snapshot.uiFpsP95 < 44)
        || snapshot.uiFrameDropRatio >= 0.08;

    if (hasAudioGuarded || hasUiGuarded) {
        let reasonCode: AudioPriorityReasonCode = 'audio-cpu-high';

        if (snapshot.dropoutsDelta > 0) {
            reasonCode = 'audio-dropouts-spike';
        } else if (snapshot.underrunsDelta > 0) {
            reasonCode = 'audio-underruns-spike';
        } else if (snapshot.launchErrorP95Ms > 2) {
            reasonCode = 'launch-jitter-high';
        } else if (snapshot.transportDriftP99Ms > 5) {
            reasonCode = 'transport-drift-high';
        } else if (snapshot.monitorLatencyP95Ms > 12) {
            reasonCode = 'monitor-latency-high';
        } else if (snapshot.uiFrameDropRatio >= 0.08) {
            reasonCode = 'ui-frame-drop';
        } else if (snapshot.uiFpsP95 > 0 && snapshot.uiFpsP95 < 44) {
            reasonCode = 'ui-fps-low';
        }

        return buildPriorityDecision('guarded', reasons, snapshot, reasonCode);
    }

    return buildPriorityDecision('normal', ['steady'], snapshot, 'steady');
};

export const createAudioPriorityController = (
    config: AudioPriorityControllerConfig = {}
): AudioPriorityController => {
    const profile: StudioPerformanceProfile = config.profile === 'stage-safe' ? 'stage-safe' : 'studio';
    const escalationStreak = clampInt(config.escalationStreak ?? 2, 2, 1, 8);
    const criticalEscalationStreak = clampInt(config.criticalEscalationStreak ?? 1, 1, 1, 8);
    const deescalationStreak = clampInt(config.deescalationStreak ?? 4, 4, 1, 16);
    const idleDeescalationStreak = clampInt(config.idleDeescalationStreak ?? 2, 2, 1, 16);
    const deescalationCooldownMs = Math.max(0, safeNumber(config.deescalationCooldownMs, 10000));
    const maxTransitionsPer20sIdle = clampInt(config.maxTransitionsPer20sIdle ?? 1, 1, 1, 20);

    let mode: GlobalAudioPriorityMode = 'normal';
    let candidateMode: GlobalAudioPriorityMode = 'normal';
    let candidateStreak = 0;
    let lastEscalationAtMs = 0;
    let transitionSeq = 0;
    const transitions: AudioPriorityTransition[] = [];

    const evaluate = (inputSnapshot: SessionHealthSnapshot, nowMs = Date.now()): AudioPriorityControllerDecision => {
        const snapshot = sanitizeSnapshot({
            ...inputSnapshot,
            profile: inputSnapshot.profile || profile,
            capturedAt: inputSnapshot.capturedAt || nowMs
        });
        const reduced = reduceSessionHealth(snapshot);
        const targetMode = reduced.mode;

        if (targetMode === mode) {
            candidateMode = mode;
            candidateStreak = 0;
            return {
                ...reduced,
                transition: null,
                transitionCount: transitions.length
            };
        }

        if (candidateMode !== targetMode) {
            candidateMode = targetMode;
            candidateStreak = 1;
        } else {
            candidateStreak += 1;
        }

        const escalating = MODE_LEVEL[targetMode] > MODE_LEVEL[mode];
        const requiredStreak = escalating
            ? (targetMode === 'critical' ? criticalEscalationStreak : escalationStreak)
            : (snapshot.hasRealtimeAudio ? deescalationStreak : idleDeescalationStreak);

        if (candidateStreak < requiredStreak) {
            return {
                ...buildPriorityDecision(mode, [`hysteresis-hold-${candidateStreak}/${requiredStreak}`], snapshot, 'hysteresis-hold'),
                transition: null,
                transitionCount: transitions.length
            };
        }

        if (!escalating) {
            const elapsedSinceEscalation = nowMs - lastEscalationAtMs;
            if (snapshot.hasRealtimeAudio && elapsedSinceEscalation < deescalationCooldownMs) {
                return {
                    ...buildPriorityDecision(mode, [`cooldown-hold-${elapsedSinceEscalation}ms`], snapshot, 'cooldown-hold'),
                    transition: null,
                    transitionCount: transitions.length
                };
            }

            if (!snapshot.hasRealtimeAudio) {
                const windowStartMs = nowMs - 20000;
                const transitionsInWindow = transitions.filter((transition) => (
                    transition.atMs >= windowStartMs
                    && !transition.snapshot.hasRealtimeAudio
                )).length;
                if (transitionsInWindow >= maxTransitionsPer20sIdle) {
                    return {
                        ...buildPriorityDecision(mode, ['idle-window-transition-throttle'], snapshot, 'hysteresis-hold'),
                        transition: null,
                        transitionCount: transitions.length
                    };
                }
            }
        }

        const previousMode = mode;
        mode = targetMode;
        candidateMode = targetMode;
        candidateStreak = 0;

        if (escalating) {
            lastEscalationAtMs = nowMs;
        }

        transitionSeq += 1;
        const transition: AudioPriorityTransition = {
            sequence: transitionSeq,
            atMs: nowMs,
            fromMode: previousMode,
            toMode: mode,
            reasonCode: reduced.reasonCode,
            reasons: [...reduced.reasons],
            snapshot: { ...snapshot }
        };

        transitions.push(transition);
        if (transitions.length > 256) {
            transitions.splice(0, transitions.length - 256);
        }

        return {
            ...reduced,
            mode,
            transition,
            transitionCount: transitions.length
        };
    };

    return {
        evaluate,
        getMode: () => mode,
        getTransitions: () => transitions.map((transition) => ({ ...transition, snapshot: { ...transition.snapshot }, reasons: [...transition.reasons] })),
        reset(nextMode = 'normal') {
            mode = nextMode;
            candidateMode = nextMode;
            candidateStreak = 0;
            lastEscalationAtMs = 0;
            transitionSeq = 0;
            transitions.splice(0, transitions.length);
        }
    };
};

export const buildAudioPriorityStabilityReport = (
    transitions: AudioPriorityTransition[],
    windowSec = 20,
    maxTransitionsAllowed = 1
): AudioPriorityStabilityReport => {
    const safeWindowSec = Math.max(1, Math.floor(safeNumber(windowSec, 20)));
    const safeMaxTransitionsAllowed = Math.max(1, Math.floor(safeNumber(maxTransitionsAllowed, 1)));

    if (transitions.length === 0) {
        return {
            windowSec: safeWindowSec,
            maxTransitionsAllowed: safeMaxTransitionsAllowed,
            transitionCount: 0,
            maxTransitionsInWindow: 0,
            passes: true
        };
    }

    const sorted = [...transitions].sort((left, right) => left.atMs - right.atMs);
    const windowMs = safeWindowSec * 1000;
    let maxTransitionsInWindow = 0;
    let start = 0;

    for (let end = 0; end < sorted.length; end += 1) {
        const endTime = sorted[end].atMs;
        while (start <= end && (endTime - sorted[start].atMs) > windowMs) {
            start += 1;
        }

        const count = (end - start) + 1;
        if (count > maxTransitionsInWindow) {
            maxTransitionsInWindow = count;
        }
    }

    return {
        windowSec: safeWindowSec,
        maxTransitionsAllowed: safeMaxTransitionsAllowed,
        transitionCount: sorted.length,
        maxTransitionsInWindow,
        passes: maxTransitionsInWindow <= safeMaxTransitionsAllowed
    };
};

const percentile = (values: number[], ratio: number): number => {
    if (values.length === 0) return 0;
    const clampedRatio = clamp(ratio, 0, 1);
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * clampedRatio)));
    return sorted[index];
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

export const assessGlobalAudioPriority = (input: GlobalAudioPriorityInput): GlobalAudioPriorityDecision => {
    const reduced = reduceSessionHealth({
        capturedAt: Date.now(),
        profile: 'studio',
        hasRealtimeAudio: true,
        cpuAudioP95Percent: safeNumber(input.engineStats?.schedulerCpuLoadP95Percent, 0),
        dropoutsDelta: Math.max(0, safeNumber(input.recentDropoutDelta, 0)),
        underrunsDelta: Math.max(0, safeNumber(input.recentUnderrunDelta, 0)),
        launchErrorP95Ms: 0,
        uiFpsP95: Math.max(0, safeNumber(input.uiFpsP95, 0)),
        uiFrameDropRatio: Math.max(0, safeNumber(input.uiFrameDropRatio, 0)),
        transportDriftP99Ms: 0,
        monitorLatencyP95Ms: 0
    });

    return {
        mode: reduced.mode,
        uiUpdateDebounceMs: reduced.uiUpdateDebounceMs,
        reduceAnimations: reduced.reduceAnimations,
        disableHeavyVisuals: reduced.disableHeavyVisuals,
        simplifyMeters: reduced.simplifyMeters,
        showBanner: reduced.showBanner,
        reasons: [...reduced.reasons]
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

export const summarizeSessionLaunchTelemetry = (
    samples: SessionLaunchTelemetrySample[],
    gateTargetMs = 2
): SessionLaunchTelemetrySummary => {
    if (samples.length === 0) {
        return {
            sampleCount: 0,
            lateSampleCount: 0,
            avgLaunchErrorMs: 0,
            p95LaunchErrorMs: 0,
            p99LaunchErrorMs: 0,
            maxLaunchErrorMs: 0,
            gateTargetMs: Math.max(0, safeNumber(gateTargetMs, 2)),
            gatePass: true
        };
    }

    const errors = samples.map((sample) => Math.max(0, safeNumber(sample.launchErrorMs, 0)));
    const errorTotal = errors.reduce((acc, value) => acc + value, 0);
    const maxLaunchErrorMs = errors.reduce((max, value) => Math.max(max, value), 0);
    const p95LaunchErrorMs = percentile(errors, 0.95);
    const p99LaunchErrorMs = percentile(errors, 0.99);
    const lateSampleCount = samples.filter((sample) => sample.wasLate).length;
    const gateLimit = Math.max(0, safeNumber(gateTargetMs, 2));

    return {
        sampleCount: samples.length,
        lateSampleCount,
        avgLaunchErrorMs: errorTotal / samples.length,
        p95LaunchErrorMs,
        p99LaunchErrorMs,
        maxLaunchErrorMs,
        gateTargetMs: gateLimit,
        gatePass: p95LaunchErrorMs <= gateLimit
    };
};

export const buildSessionLaunchReport = (
    samples: SessionLaunchTelemetrySample[],
    scenario: SessionLaunchReportScenario,
    gateTargetMs = 2
): SessionLaunchReport => {
    const normalizedScenario: SessionLaunchReportScenario = {
        name: scenario.name || 'session-launch-report',
        tracks: Math.max(1, Math.floor(safeNumber(scenario.tracks, 1))),
        scenes: Math.max(1, Math.floor(safeNumber(scenario.scenes, 1))),
        quantizeBars: Math.max(0.25, safeNumber(scenario.quantizeBars, 1)),
        source: scenario.source === 'simulated' ? 'simulated' : 'live-capture'
    };

    return {
        generatedAt: Date.now(),
        scenario: normalizedScenario,
        summary: summarizeSessionLaunchTelemetry(samples, gateTargetMs),
        samples: samples.map((sample) => ({ ...sample }))
    };
};
