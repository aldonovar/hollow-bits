import { describe, expect, it } from 'vitest';
import {
    assessSessionOverload,
    buildSessionTrackWindow,
    computeLaunchTimingErrorMs,
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
