import { describe, expect, it } from 'vitest';
import {
    assessSessionOverload,
    buildSessionLaunchReport,
    summarizeSessionLaunchTelemetry
} from '../../services/sessionPerformanceService';
import {
    appendSceneRecordingEvent,
    buildSceneRecordingIndex,
    buildSceneReplayPlan,
    createSceneRecordingEvent,
    summarizeSceneReplayPlan
} from '../../services/sessionSceneRecordingService';

describe('block6 Session flagship regression', () => {
    it('keeps 48x8 sessions in guarded stage-safe mode before reaching critical', () => {
        const decision = assessSessionOverload({
            engineStats: {
                highLoadDetected: false,
                schedulerCpuLoadP95Percent: 73,
                schedulerOverrunRatio: 0.09
            },
            sessionTrackCount: 48,
            sceneCount: 8,
            recentDropoutDelta: 0,
            recentUnderrunDelta: 0
        });

        expect(decision.mode).toBe('guarded');
        expect(decision.virtualizeTracks).toBe(true);
        expect(decision.maxVisibleTrackColumns).toBe(20);
        expect(decision.showOverloadBanner).toBe(true);
    });

    it('builds deterministic replay summaries from recorded scene launches', () => {
        const first = createSceneRecordingEvent(0, 10, 1, [{ trackId: 't1', clipId: 'c1' }]);
        const second = createSceneRecordingEvent(4, 14, 1, [
            { trackId: 't1', clipId: 'c2' },
            { trackId: 't2', clipId: 'c3' }
        ]);

        const events = appendSceneRecordingEvent([first], second, 64);
        const replayPlan = buildSceneReplayPlan(events, 100);
        const replaySummary = summarizeSceneReplayPlan(replayPlan);
        const index = buildSceneRecordingIndex(events);

        expect(index.perSceneEventCount[0]).toBe(1);
        expect(index.perSceneEventCount[4]).toBe(1);
        expect(replaySummary.eventCount).toBe(2);
        expect(replaySummary.uniqueSceneCount).toBe(2);
        expect(replaySummary.uniqueTrackCount).toBe(2);
        expect(replaySummary.durationSec).toBeCloseTo(4, 6);
        expect(replayPlan[1].replayLaunchAtSec).toBeCloseTo(104, 6);
    });

    it('keeps launch telemetry reports live-capture ready for Session gating', () => {
        const samples = [
            {
                trackId: 't1',
                clipId: 'c1',
                sceneIndex: 0,
                requestedLaunchTimeSec: 10,
                effectiveLaunchTimeSec: 10.0008,
                launchErrorMs: 0.8,
                quantized: true,
                wasLate: false,
                capturedAtMs: 1
            },
            {
                trackId: 't2',
                clipId: 'c2',
                sceneIndex: 4,
                requestedLaunchTimeSec: 12,
                effectiveLaunchTimeSec: 12.0012,
                launchErrorMs: 1.2,
                quantized: true,
                wasLate: false,
                capturedAtMs: 2
            }
        ];

        const summary = summarizeSessionLaunchTelemetry(samples, 2);
        const report = buildSessionLaunchReport(samples, {
            name: 'session-launch-live-capture',
            tracks: 48,
            scenes: 8,
            quantizeBars: 1,
            source: 'live-capture'
        }, 2);

        expect(summary.gatePass).toBe(true);
        expect(report.summary.p95LaunchErrorMs).toBeLessThanOrEqual(2);
        expect(report.scenario.tracks).toBe(48);
        expect(report.scenario.scenes).toBe(8);
    });
});
