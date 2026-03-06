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

export interface SceneRecordingPersistedPayload {
    version: 1;
    capturedAt: number;
    events: SceneRecordingEvent[];
}

export interface SceneRecordingSummary {
    eventCount: number;
    uniqueSceneCount: number;
    uniqueTrackCount: number;
    uniqueClipCount: number;
    startLaunchAtSec: number;
    endLaunchAtSec: number;
    durationSec: number;
}

const safeNumber = (value: number | undefined | null, fallback = 0): number => {
    return Number.isFinite(value) ? Number(value) : fallback;
};

const buildRuntimeId = (prefix: string): string => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const sanitizeSceneEntries = (candidate: unknown): SceneTrackClipRef[] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            const value = entry as Partial<SceneTrackClipRef>;
            if (typeof value.trackId !== 'string' || typeof value.clipId !== 'string') {
                return null;
            }

            return {
                trackId: value.trackId,
                clipId: value.clipId
            };
        })
        .filter((entry): entry is SceneTrackClipRef => Boolean(entry));
};

export const deserializeSceneRecordingEvents = (payload: unknown): SceneRecordingEvent[] => {
    const rawEvents = (
        payload
        && typeof payload === 'object'
        && Array.isArray((payload as SceneRecordingPersistedPayload).events)
    )
        ? (payload as SceneRecordingPersistedPayload).events
        : Array.isArray(payload)
            ? payload as SceneRecordingEvent[]
            : [];

    return rawEvents
        .map((event) => {
            if (!event || typeof event !== 'object') return null;
            const value = event as Partial<SceneRecordingEvent>;
            const entries = sanitizeSceneEntries(value.entries);
            if (entries.length === 0) return null;

            const recordedAtMs = Math.max(0, safeNumber(value.recordedAtMs, Date.now()));
            return {
                id: typeof value.id === 'string' && value.id.length > 0
                    ? value.id
                    : buildRuntimeId('scene-rec'),
                sceneIndex: Math.max(0, Math.floor(safeNumber(value.sceneIndex, 0))),
                launchAtSec: Math.max(0, safeNumber(value.launchAtSec, 0)),
                quantizeBars: Math.max(0, safeNumber(value.quantizeBars, 1)),
                recordedAtMs,
                entries
            };
        })
        .filter((event): event is SceneRecordingEvent => Boolean(event))
        .sort((left, right) => {
            if (left.launchAtSec !== right.launchAtSec) {
                return left.launchAtSec - right.launchAtSec;
            }
            return left.recordedAtMs - right.recordedAtMs;
        })
        .slice(-1024);
};

export const serializeSceneRecordingEvents = (
    events: SceneRecordingEvent[]
): SceneRecordingPersistedPayload => {
    const normalizedEvents = deserializeSceneRecordingEvents({ events });
    return {
        version: 1,
        capturedAt: Date.now(),
        events: normalizedEvents
    };
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
    const dedupeWindowSec = 0.05;
    const limit = Math.max(1, Math.floor(maxEvents));
    const currentLast = current[current.length - 1];
    if (currentLast) {
        const sameScene = currentLast.sceneIndex === nextEvent.sceneIndex;
        const launchDeltaSec = Math.abs(currentLast.launchAtSec - nextEvent.launchAtSec);

        const currentSignature = currentLast.entries
            .map((entry) => `${entry.trackId}::${entry.clipId}`)
            .sort()
            .join('|');
        const nextSignature = nextEvent.entries
            .map((entry) => `${entry.trackId}::${entry.clipId}`)
            .sort()
            .join('|');

        const sameEntries = currentSignature === nextSignature;
        if (sameScene && sameEntries && launchDeltaSec <= dedupeWindowSec) {
            return current;
        }
    }

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

export const summarizeSceneRecordingEvents = (
    events: SceneRecordingEvent[]
): SceneRecordingSummary => {
    if (events.length === 0) {
        return {
            eventCount: 0,
            uniqueSceneCount: 0,
            uniqueTrackCount: 0,
            uniqueClipCount: 0,
            startLaunchAtSec: 0,
            endLaunchAtSec: 0,
            durationSec: 0
        };
    }

    const sorted = [...events].sort((left, right) => left.launchAtSec - right.launchAtSec);
    const startLaunchAtSec = Math.max(0, safeNumber(sorted[0].launchAtSec, 0));
    const endLaunchAtSec = Math.max(startLaunchAtSec, safeNumber(sorted[sorted.length - 1].launchAtSec, startLaunchAtSec));
    const uniqueScenes = new Set<number>();
    const uniqueTracks = new Set<string>();
    const uniqueClips = new Set<string>();

    sorted.forEach((event) => {
        uniqueScenes.add(event.sceneIndex);
        event.entries.forEach((entry) => {
            uniqueTracks.add(entry.trackId);
            uniqueClips.add(entry.clipId);
        });
    });

    return {
        eventCount: sorted.length,
        uniqueSceneCount: uniqueScenes.size,
        uniqueTrackCount: uniqueTracks.size,
        uniqueClipCount: uniqueClips.size,
        startLaunchAtSec,
        endLaunchAtSec,
        durationSec: Math.max(0, endLaunchAtSec - startLaunchAtSec)
    };
};
