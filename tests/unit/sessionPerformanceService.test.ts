import { describe, expect, it } from 'vitest';
import {
    assessGlobalAudioPriority,
    assessSessionOverload,
    buildAudioPriorityStabilityReport,
    buildSessionLaunchReport,
    buildSessionTrackWindow,
    computeLaunchTimingErrorMs,
    createAudioPriorityController,
    reduceSessionHealth,
    summarizeSessionLaunchTelemetry
} from '../../services/sessionPerformanceService';

describe('sessionPerformanceService.buildSessionTrackWindow', () => {
    it('returns bounded visible indices and spacers for large track sets', () => {
        const windowModel = buildSessionTrackWindow({
            totalTracks: 48,
            trackColumnWidthPx: 144,
            trackGapPx: 8,
            viewportLeftPx: 1520,
            viewportWidthPx: 1100,
            overscanTracks: 2
        });

        expect(windowModel.startIndex).toBeGreaterThanOrEqual(0);
        expect(windowModel.endIndex).toBeLessThan(48);
        expect(windowModel.endIndex).toBeGreaterThanOrEqual(windowModel.startIndex);
        expect(windowModel.totalWidthPx).toBe((48 * 144) + (47 * 8));
        expect(windowModel.leftSpacerPx + windowModel.rightSpacerPx).toBeLessThan(windowModel.totalWidthPx);
    });

    it('handles empty tracks and invalid viewport safely', () => {
        const windowModel = buildSessionTrackWindow({
            totalTracks: 0,
            trackColumnWidthPx: 0,
            trackGapPx: 0,
            viewportLeftPx: -100,
            viewportWidthPx: 0,
            overscanTracks: -3
        });

        expect(windowModel.totalWidthPx).toBe(0);
        expect(windowModel.endIndex).toBe(-1);
    });
});

describe('sessionPerformanceService.assessSessionOverload', () => {
    it('stays normal on healthy diagnostics', () => {
        const decision = assessSessionOverload({
            engineStats: {
                highLoadDetected: false,
                schedulerCpuLoadP95Percent: 44,
                schedulerOverrunRatio: 0.04
            },
            sessionTrackCount: 24,
            sceneCount: 8,
            recentDropoutDelta: 0,
            recentUnderrunDelta: 0
        });

        expect(decision.mode).toBe('normal');
        expect(decision.animationLevel).toBe('full');
        expect(decision.showOverloadBanner).toBe(false);
    });

    it('enters guarded mode when session grid is heavy or engine load rises', () => {
        const decision = assessSessionOverload({
            engineStats: {
                highLoadDetected: false,
                schedulerCpuLoadP95Percent: 73,
                schedulerOverrunRatio: 0.09
            },
            sessionTrackCount: 48,
            sceneCount: 8,
            recentDropoutDelta: 0,
            recentUnderrunDelta: 1
        });

        expect(decision.mode).toBe('guarded');
        expect(decision.virtualizeTracks).toBe(true);
        expect(decision.showOverloadBanner).toBe(true);
        expect(decision.reasons.length).toBeGreaterThan(0);
    });

    it('enters critical mode with high cpu/overrun and dropouts', () => {
        const decision = assessSessionOverload({
            engineStats: {
                highLoadDetected: true,
                schedulerCpuLoadP95Percent: 89,
                schedulerOverrunRatio: 0.34
            },
            sessionTrackCount: 48,
            sceneCount: 8,
            recentDropoutDelta: 2,
            recentUnderrunDelta: 3
        });

        expect(decision.mode).toBe('critical');
        expect(decision.animationLevel).toBe('minimal');
        expect(decision.uiUpdateDebounceMs).toBeGreaterThanOrEqual(60);
    });
});

describe('sessionPerformanceService.assessGlobalAudioPriority', () => {
    it('returns guarded when ui fps degrades even without audio failures', () => {
        const decision = assessGlobalAudioPriority({
            engineStats: {
                highLoadDetected: false,
                schedulerCpuLoadP95Percent: 48,
                schedulerOverrunRatio: 0.06,
                schedulerDropoutCount: 0,
                schedulerUnderrunCount: 0
            },
            sessionTrackCount: 32,
            sceneCount: 8,
            uiFpsP95: 41,
            uiFrameDropRatio: 0.04
        });

        expect(decision.mode).toBe('guarded');
        expect(decision.reduceAnimations).toBe(true);
        expect(decision.showBanner).toBe(false);
    });

    it('returns critical when ui and scheduler are both overloaded', () => {
        const decision = assessGlobalAudioPriority({
            engineStats: {
                highLoadDetected: true,
                schedulerCpuLoadP95Percent: 91,
                schedulerOverrunRatio: 0.37,
                schedulerDropoutCount: 2,
                schedulerUnderrunCount: 3
            },
            sessionTrackCount: 48,
            sceneCount: 8,
            uiFpsP95: 28,
            uiFrameDropRatio: 0.2,
            recentDropoutDelta: 2,
            recentUnderrunDelta: 2
        });

        expect(decision.mode).toBe('critical');
        expect(decision.disableHeavyVisuals).toBe(true);
        expect(decision.uiUpdateDebounceMs).toBeGreaterThanOrEqual(72);
        expect(decision.showBanner).toBe(true);
    });
});

describe('sessionPerformanceService.reduceSessionHealth', () => {
    it('keeps normal mode when there is no realtime audio activity', () => {
        const decision = reduceSessionHealth({
            capturedAt: Date.now(),
            profile: 'stage-safe',
            hasRealtimeAudio: false,
            cpuAudioP95Percent: 95,
            dropoutsDelta: 4,
            underrunsDelta: 4,
            launchErrorP95Ms: 7,
            uiFpsP95: 14,
            uiFrameDropRatio: 0.35,
            transportDriftP99Ms: 24,
            monitorLatencyP95Ms: 30
        });

        expect(decision.mode).toBe('normal');
        expect(decision.reasonCode).toBe('idle-no-realtime');
    });

    it('escalates to critical when audio counters spike in realtime', () => {
        const decision = reduceSessionHealth({
            capturedAt: Date.now(),
            profile: 'stage-safe',
            hasRealtimeAudio: true,
            cpuAudioP95Percent: 84,
            dropoutsDelta: 2,
            underrunsDelta: 1,
            launchErrorP95Ms: 1.2,
            uiFpsP95: 52,
            uiFrameDropRatio: 0.03,
            transportDriftP99Ms: 3,
            monitorLatencyP95Ms: 8
        });

        expect(decision.mode).toBe('critical');
        expect(decision.reasonCode).toBe('audio-dropouts-spike');
        expect(decision.showBanner).toBe(true);
    });
});

describe('sessionPerformanceService.createAudioPriorityController', () => {
    it('applies hysteresis and cooldown before deescalating', () => {
        const controller = createAudioPriorityController({
            escalationStreak: 2,
            criticalEscalationStreak: 1,
            deescalationStreak: 2,
            idleDeescalationStreak: 1,
            deescalationCooldownMs: 5000
        });

        const t0 = 1_000;
        const critical = {
            capturedAt: t0,
            profile: 'stage-safe' as const,
            hasRealtimeAudio: true,
            cpuAudioP95Percent: 90,
            dropoutsDelta: 2,
            underrunsDelta: 0,
            launchErrorP95Ms: 1,
            uiFpsP95: 48,
            uiFrameDropRatio: 0.04,
            transportDriftP99Ms: 3,
            monitorLatencyP95Ms: 8
        };
        const healthyRealtime = {
            ...critical,
            dropoutsDelta: 0,
            cpuAudioP95Percent: 42,
            capturedAt: t0 + 1_000
        };
        const healthyIdle = {
            ...healthyRealtime,
            hasRealtimeAudio: false,
            capturedAt: t0 + 7_000
        };

        const d1 = controller.evaluate(critical, t0);
        expect(d1.mode).toBe('critical');
        expect(d1.transition).not.toBeNull();

        const d2 = controller.evaluate(healthyRealtime, t0 + 1_000);
        expect(d2.mode).toBe('critical');
        expect(d2.reasonCode).toBe('hysteresis-hold');

        const d3 = controller.evaluate(healthyRealtime, t0 + 2_000);
        expect(d3.mode).toBe('critical');
        expect(d3.reasonCode).toBe('cooldown-hold');

        const d4 = controller.evaluate(healthyIdle, t0 + 7_000);
        expect(d4.mode).toBe('normal');
        expect(d4.transition).not.toBeNull();
    });
});

describe('sessionPerformanceService.buildAudioPriorityStabilityReport', () => {
    it('flags transition flapping above configured threshold', () => {
        const report = buildAudioPriorityStabilityReport([
            {
                sequence: 1,
                atMs: 0,
                fromMode: 'normal',
                toMode: 'guarded',
                reasonCode: 'audio-cpu-high',
                reasons: ['cpu-audio-p95-80.0'],
                snapshot: {
                    capturedAt: 0,
                    profile: 'studio',
                    hasRealtimeAudio: true,
                    cpuAudioP95Percent: 80,
                    dropoutsDelta: 0,
                    underrunsDelta: 0,
                    launchErrorP95Ms: 0,
                    uiFpsP95: 45,
                    uiFrameDropRatio: 0.05,
                    transportDriftP99Ms: 0,
                    monitorLatencyP95Ms: 8
                }
            },
            {
                sequence: 2,
                atMs: 4_000,
                fromMode: 'guarded',
                toMode: 'normal',
                reasonCode: 'steady',
                reasons: ['steady'],
                snapshot: {
                    capturedAt: 4_000,
                    profile: 'studio',
                    hasRealtimeAudio: false,
                    cpuAudioP95Percent: 22,
                    dropoutsDelta: 0,
                    underrunsDelta: 0,
                    launchErrorP95Ms: 0,
                    uiFpsP95: 60,
                    uiFrameDropRatio: 0.01,
                    transportDriftP99Ms: 0,
                    monitorLatencyP95Ms: 8
                }
            }
        ], 20, 1);

        expect(report.maxTransitionsInWindow).toBe(2);
        expect(report.passes).toBe(false);
    });
});

describe('sessionPerformanceService.computeLaunchTimingErrorMs', () => {
    it('computes absolute launch error in milliseconds', () => {
        expect(computeLaunchTimingErrorMs(10, 10.001)).toBeCloseTo(1, 6);
        expect(computeLaunchTimingErrorMs(10.2, 10.198)).toBeCloseTo(2, 6);
    });
});

describe('sessionPerformanceService.summarizeSessionLaunchTelemetry', () => {
    it('passes launch gate when p95 stays under 2ms', () => {
        const summary = summarizeSessionLaunchTelemetry([
            {
                trackId: 't1',
                clipId: 'c1',
                requestedLaunchTimeSec: 10,
                effectiveLaunchTimeSec: 10.0004,
                launchErrorMs: 0.4,
                quantized: true,
                wasLate: false,
                capturedAtMs: 1
            },
            {
                trackId: 't1',
                clipId: 'c2',
                requestedLaunchTimeSec: 12,
                effectiveLaunchTimeSec: 12.0012,
                launchErrorMs: 1.2,
                quantized: true,
                wasLate: true,
                capturedAtMs: 2
            }
        ], 2);

        expect(summary.sampleCount).toBe(2);
        expect(summary.gatePass).toBe(true);
        expect(summary.p95LaunchErrorMs).toBeLessThanOrEqual(2);
    });

    it('fails launch gate when p95 exceeds target', () => {
        const summary = summarizeSessionLaunchTelemetry([
            {
                trackId: 't1',
                clipId: 'c1',
                requestedLaunchTimeSec: 8,
                effectiveLaunchTimeSec: 8.0008,
                launchErrorMs: 0.8,
                quantized: true,
                wasLate: false,
                capturedAtMs: 1
            },
            {
                trackId: 't2',
                clipId: 'c2',
                requestedLaunchTimeSec: 8,
                effectiveLaunchTimeSec: 8.0042,
                launchErrorMs: 4.2,
                quantized: true,
                wasLate: true,
                capturedAtMs: 2
            }
        ], 2);

        expect(summary.gatePass).toBe(false);
        expect(summary.p95LaunchErrorMs).toBeGreaterThan(2);
    });
});

describe('sessionPerformanceService.buildSessionLaunchReport', () => {
    it('builds a normalized report with scenario metadata and summary', () => {
        const report = buildSessionLaunchReport(
            [
                {
                    trackId: 't1',
                    clipId: 'c1',
                    sceneIndex: 0,
                    requestedLaunchTimeSec: 10,
                    effectiveLaunchTimeSec: 10.001,
                    launchErrorMs: 1,
                    quantized: true,
                    wasLate: true,
                    capturedAtMs: 1
                }
            ],
            {
                name: 'session-launch-live-capture',
                tracks: 48,
                scenes: 8,
                quantizeBars: 1,
                source: 'live-capture'
            },
            2
        );

        expect(report.scenario.tracks).toBe(48);
        expect(report.scenario.scenes).toBe(8);
        expect(report.summary.sampleCount).toBe(1);
        expect(report.summary.gatePass).toBe(true);
    });
});
