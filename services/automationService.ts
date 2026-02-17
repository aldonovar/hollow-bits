import { AutomationLane, AutomationParam, Track } from '../types';

export const AUTOMATION_TARGETS: AutomationParam[] = ['volume', 'pan', 'reverb'];

export const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));

export const normalizeReverbValue = (reverb: number): number => {
    if (!Number.isFinite(reverb)) return 0;
    const normalized = reverb > 1 ? reverb / 100 : reverb;
    return clampUnit(normalized);
};

export const normalizeTrackParam = (track: Track, param: AutomationParam): number => {
    if (param === 'volume') {
        return clampUnit((track.volume + 60) / 66);
    }
    if (param === 'pan') {
        return clampUnit((track.pan + 50) / 100);
    }
    if (param === 'reverb') {
        return normalizeReverbValue(track.reverb);
    }
    return 0;
};

export const denormalizeTrackParam = (track: Track, param: AutomationParam, normalized: number): number => {
    const safe = clampUnit(normalized);
    if (param === 'volume') {
        return (safe * 66) - 60;
    }
    if (param === 'pan') {
        return (safe * 100) - 50;
    }
    if (param === 'reverb') {
        return track.reverb > 1 ? safe * 100 : safe;
    }
    return normalized;
};

export const getTrackParamValue = (track: Track, param: AutomationParam): number => {
    if (param === 'volume') return track.volume;
    if (param === 'pan') return track.pan;
    if (param === 'reverb') return track.reverb;
    return 0;
};

export const getLaneByParam = (track: Track, param: AutomationParam): AutomationLane | undefined => {
    return track.automationLanes?.find((lane) => lane.param === param);
};

export const sampleAutomationLaneAtBar = (lane: AutomationLane | undefined, barTime: number): number | null => {
    if (!lane || lane.points.length === 0) return null;

    const points = [...lane.points].sort((a, b) => a.time - b.time);
    if (barTime <= points[0].time) return clampUnit(points[0].value);
    if (barTime >= points[points.length - 1].time) return clampUnit(points[points.length - 1].value);

    for (let i = 0; i < points.length - 1; i++) {
        const start = points[i];
        const end = points[i + 1];
        if (barTime < start.time || barTime > end.time) continue;

        if (start.curveType === 'hold') {
            return clampUnit(start.value);
        }

        const span = Math.max(1e-6, end.time - start.time);
        const t = clampUnit((barTime - start.time) / span);
        return clampUnit(start.value + ((end.value - start.value) * t));
    }

    return clampUnit(points[points.length - 1].value);
};

export const writeAutomationPoint = (track: Track, param: AutomationParam, barTime: number, normalizedValue: number): Track => {
    const lane = getLaneByParam(track, param);
    const laneId = lane?.id ?? `${track.id}-auto-${param}`;
    const existingPoints = lane?.points ? [...lane.points] : [];

    const lastPoint = existingPoints[existingPoints.length - 1];
    if (lastPoint && Math.abs(lastPoint.time - barTime) <= 0.03) {
        if (Math.abs(lastPoint.value - normalizedValue) <= 0.002) {
            return track;
        }
        existingPoints[existingPoints.length - 1] = {
            ...lastPoint,
            time: barTime,
            value: normalizedValue
        };
    } else {
        const isSmallMove = lastPoint
            && Math.abs(lastPoint.value - normalizedValue) <= 0.002
            && Math.abs(lastPoint.time - barTime) < 0.2;

        if (isSmallMove) {
            return track;
        }

        existingPoints.push({
            id: `ap-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            time: barTime,
            value: normalizedValue,
            curveType: 'linear'
        });
    }

    const clampedPoints = existingPoints
        .sort((a, b) => a.time - b.time)
        .slice(-3000);

    const nextLane: AutomationLane = lane
        ? {
            ...lane,
            points: clampedPoints,
            minValue: 0,
            maxValue: 1
        }
        : {
            id: laneId,
            param,
            paramName: param === 'volume' ? 'Volume' : param === 'pan' ? 'Pan' : 'Reverb',
            color: param === 'volume' ? '#45d3f3' : param === 'pan' ? '#3bf9f6' : '#a855f7',
            isExpanded: false,
            points: clampedPoints,
            minValue: 0,
            maxValue: 1
        };

    const lanes = track.automationLanes ? [...track.automationLanes] : [];
    const laneIndex = lanes.findIndex((item) => item.id === laneId || item.param === param);
    if (laneIndex >= 0) {
        lanes[laneIndex] = nextLane;
    } else {
        lanes.push(nextLane);
    }

    return {
        ...track,
        automationLanes: lanes
    };
};
