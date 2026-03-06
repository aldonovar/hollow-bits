export interface SceneTrackClipRef {
    trackId: string;
    clipId: string;
}

export interface SceneRecordingEvent {
    id: string;
    sceneIndex: number;
    launchAtSec: number;
    quantizeBars: number;
    recordedAtMs: number;
    entries: SceneTrackClipRef[];
}

export interface SceneReplayEvent {
    id: string;
    sceneIndex: number;
    replayLaunchAtSec: number;
    sourceLaunchAtSec: number;
    entries: SceneTrackClipRef[];
}

const safeNumber = (value: number | undefined | null, fallback = 0): number => {
    return Number.isFinite(value) ? Number(value) : fallback;
};

const buildRuntimeId = (prefix: string): string => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

export const createSceneRecordingEvent = (
    sceneIndex: number,
    launchAtSec: number,
    quantizeBars: number,
    entries: SceneTrackClipRef[]
): SceneRecordingEvent => {
    return {
        id: buildRuntimeId('scene-rec'),
        sceneIndex: Math.max(0, Math.floor(sceneIndex)),
        launchAtSec: Math.max(0, safeNumber(launchAtSec, 0)),
        quantizeBars: Math.max(0, safeNumber(quantizeBars, 1)),
        recordedAtMs: Date.now(),
        entries: entries.map((entry) => ({ ...entry }))
    };
};

export const appendSceneRecordingEvent = (
    current: SceneRecordingEvent[],
    nextEvent: SceneRecordingEvent,
    maxEvents = 512
): SceneRecordingEvent[] => {
    const limit = Math.max(1, Math.floor(maxEvents));
    const merged = [...current, nextEvent];
    if (merged.length <= limit) {
        return merged;
    }
    return merged.slice(merged.length - limit);
};

export const buildSceneReplayPlan = (
    events: SceneRecordingEvent[],
    replayStartLaunchAtSec: number
): SceneReplayEvent[] => {
    if (events.length === 0) return [];

    const sorted = [...events].sort((left, right) => left.launchAtSec - right.launchAtSec);
    const sourceStartLaunchAtSec = Math.max(0, safeNumber(sorted[0].launchAtSec, 0));
    const replayStart = Math.max(0, safeNumber(replayStartLaunchAtSec, 0));

    return sorted.map((event) => {
        const offsetSec = Math.max(0, safeNumber(event.launchAtSec, sourceStartLaunchAtSec) - sourceStartLaunchAtSec);
        return {
            id: event.id,
            sceneIndex: event.sceneIndex,
            sourceLaunchAtSec: event.launchAtSec,
            replayLaunchAtSec: replayStart + offsetSec,
            entries: event.entries.map((entry) => ({ ...entry }))
        };
    });
};

