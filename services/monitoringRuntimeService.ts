import type { LiveCaptureRunConfig, MonitoringRouteSnapshot } from '../types';

export interface MonitoringRuntimeRouteDetail extends MonitoringRouteSnapshot {
    pendingFinalize: boolean;
    effectiveMonitorLatencyMs: number;
}

export interface MonitoringRuntimeReport {
    generatedAt: number;
    scenario: {
        name: 'monitoring-runtime';
        tracks: number;
        scenes: number;
        source: 'live-capture';
    };
    summary: {
        pass: boolean;
        activeRouteCount: number;
        enabledRouteCount: number;
        stereoActiveCount: number;
        sharedInputStreamCount: number;
        pendingFinalizeCount: number;
        explicitInputModeCount: number;
        monitorLatencyP95Ms: number;
        maxLatencyCompensationMs: number;
        maxEffectiveMonitorLatencyMs: number;
    };
    routes: MonitoringRuntimeRouteDetail[];
}

interface BuildMonitoringRuntimeReportArgs {
    config: LiveCaptureRunConfig;
    monitorLatencyP95Ms: number;
    routeSnapshots: MonitoringRouteSnapshot[];
    pendingFinalizeTrackIds?: Iterable<string>;
}

const safeNumber = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

export const buildMonitoringRuntimeReport = ({
    config,
    monitorLatencyP95Ms,
    routeSnapshots,
    pendingFinalizeTrackIds = []
}: BuildMonitoringRuntimeReportArgs): MonitoringRuntimeReport => {
    const pendingFinalizeSet = new Set(Array.from(pendingFinalizeTrackIds));
    const baseLatencyMs = Math.max(0, Number(safeNumber(monitorLatencyP95Ms, 0).toFixed(3)));
    const routes: MonitoringRuntimeRouteDetail[] = (Array.isArray(routeSnapshots) ? routeSnapshots : []).map((route) => {
        const compensationMs = Math.max(0, Number(safeNumber(route.latencyCompensationMs, 0).toFixed(3)));
        return {
            ...route,
            latencyCompensationMs: compensationMs,
            pendingFinalize: pendingFinalizeSet.has(route.trackId),
            effectiveMonitorLatencyMs: Number((baseLatencyMs + compensationMs).toFixed(3))
        };
    });

    const activeRouteCount = routes.filter((route) => route.active).length;
    const enabledRouteCount = routes.filter((route) => route.monitoringEnabled).length;
    const stereoActiveCount = routes.filter((route) => route.active && route.mode === 'stereo').length;
    const sharedInputStreamCount = routes.filter((route) => route.sharedInputStream).length;
    const pendingFinalizeCount = routes.filter((route) => route.pendingFinalize).length;
    const explicitInputModeCount = routes.filter((route) => route.mode !== 'mono').length;
    const maxLatencyCompensationMs = routes.reduce((max, route) => Math.max(max, route.latencyCompensationMs), 0);
    const maxEffectiveMonitorLatencyMs = routes.reduce((max, route) => Math.max(max, route.effectiveMonitorLatencyMs), baseLatencyMs);
    const pass = baseLatencyMs <= 12;

    return {
        generatedAt: Date.now(),
        scenario: {
            name: 'monitoring-runtime',
            tracks: config.tracks,
            scenes: config.scenes,
            source: 'live-capture'
        },
        summary: {
            pass,
            activeRouteCount,
            enabledRouteCount,
            stereoActiveCount,
            sharedInputStreamCount,
            pendingFinalizeCount,
            explicitInputModeCount,
            monitorLatencyP95Ms: baseLatencyMs,
            maxLatencyCompensationMs: Number(maxLatencyCompensationMs.toFixed(3)),
            maxEffectiveMonitorLatencyMs: Number(maxEffectiveMonitorLatencyMs.toFixed(3))
        },
        routes
    };
};
