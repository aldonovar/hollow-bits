import { describe, expect, it } from 'vitest';

import { buildMonitoringRuntimeReport } from '../../services/monitoringRuntimeService';

describe('monitoringRuntimeService', () => {
  it('builds an operational monitoring report with effective latency details', () => {
    const report = buildMonitoringRuntimeReport({
      config: {
        tracks: 48,
        scenes: 8,
        quantizeBars: 1,
        durationMinutes: 90,
        recordingCycles: 1000,
        timeoutMs: 1000,
        seed: 4242,
      },
      monitorLatencyP95Ms: 8.25,
      routeSnapshots: [
        {
          trackId: 't-1',
          trackName: 'Lead',
          active: true,
          mode: 'stereo',
          latencyCompensationMs: 3,
          monitoringEnabled: true,
          sharedInputStream: true,
        },
        {
          trackId: 't-2',
          trackName: 'Back',
          active: false,
          mode: 'left',
          latencyCompensationMs: 6.5,
          monitoringEnabled: true,
          sharedInputStream: false,
        },
      ],
      pendingFinalizeTrackIds: ['t-2'],
    });

    expect(report.summary.pass).toBe(true);
    expect(report.summary.activeRouteCount).toBe(1);
    expect(report.summary.enabledRouteCount).toBe(2);
    expect(report.summary.sharedInputStreamCount).toBe(1);
    expect(report.summary.pendingFinalizeCount).toBe(1);
    expect(report.summary.monitorLatencyP95Ms).toBe(8.25);
    expect(report.summary.maxLatencyCompensationMs).toBe(6.5);
    expect(report.summary.maxEffectiveMonitorLatencyMs).toBe(14.75);
    expect(report.routes[1].pendingFinalize).toBe(true);
    expect(report.routes[1].effectiveMonitorLatencyMs).toBe(14.75);
  });

  it('fails the report summary when base monitoring latency exceeds the contract', () => {
    const report = buildMonitoringRuntimeReport({
      config: {
        tracks: 48,
        scenes: 8,
        quantizeBars: 1,
        durationMinutes: 90,
        recordingCycles: 1000,
        timeoutMs: 1000,
        seed: 4242,
      },
      monitorLatencyP95Ms: 14.2,
      routeSnapshots: [],
    });

    expect(report.summary.pass).toBe(false);
    expect(report.summary.monitorLatencyP95Ms).toBe(14.2);
    expect(report.summary.maxEffectiveMonitorLatencyMs).toBe(14.2);
  });
});
