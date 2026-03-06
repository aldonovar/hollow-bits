export interface TransportClockSnapshot {
    currentBar: number;
    currentBeat: number;
    currentSixteenth: number;
    isPlaying: boolean;
    updatedAt: number;
}

const DEFAULT_CLOCK_SNAPSHOT: TransportClockSnapshot = {
    currentBar: 1,
    currentBeat: 1,
    currentSixteenth: 1,
    isPlaying: false,
    updatedAt: 0
};

let snapshot: TransportClockSnapshot = {
    ...DEFAULT_CLOCK_SNAPSHOT
};

const listeners = new Set<() => void>();

const sanitizePositiveInt = (value: number, fallback: number): number => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.floor(value));
};

const sanitizePlaying = (value: boolean | undefined, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    return fallback;
};

const hasClockChanged = (next: TransportClockSnapshot): boolean => {
    return (
        snapshot.currentBar !== next.currentBar
        || snapshot.currentBeat !== next.currentBeat
        || snapshot.currentSixteenth !== next.currentSixteenth
        || snapshot.isPlaying !== next.isPlaying
    );
};

export const subscribeTransportClock = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

export const getTransportClockSnapshot = (): TransportClockSnapshot => snapshot;

export const setTransportClockSnapshot = (
    next: Partial<TransportClockSnapshot> | TransportClockSnapshot
): TransportClockSnapshot => {
    const normalized: TransportClockSnapshot = {
        currentBar: sanitizePositiveInt(next.currentBar ?? snapshot.currentBar, snapshot.currentBar),
        currentBeat: sanitizePositiveInt(next.currentBeat ?? snapshot.currentBeat, snapshot.currentBeat),
        currentSixteenth: sanitizePositiveInt(next.currentSixteenth ?? snapshot.currentSixteenth, snapshot.currentSixteenth),
        isPlaying: sanitizePlaying(next.isPlaying, snapshot.isPlaying),
        updatedAt: Number.isFinite(next.updatedAt) ? Number(next.updatedAt) : Date.now()
    };

    if (!hasClockChanged(normalized)) {
        return snapshot;
    }

    snapshot = normalized;
    listeners.forEach((listener) => listener());
    return snapshot;
};

export const resetTransportClockSnapshot = (): TransportClockSnapshot => {
    return setTransportClockSnapshot({
        ...DEFAULT_CLOCK_SNAPSHOT,
        updatedAt: Date.now()
    });
};
