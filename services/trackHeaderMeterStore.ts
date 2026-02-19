export interface TrackHeaderMeterSnapshot {
    rmsDb: number;
    peakDb: number;
    clipped: boolean;
}

type MeterListener = () => void;

const DEFAULT_TRACK_HEADER_METER: TrackHeaderMeterSnapshot = {
    rmsDb: -72,
    peakDb: -72,
    clipped: false
};

const hasMeterChanged = (
    prev: TrackHeaderMeterSnapshot | undefined,
    next: TrackHeaderMeterSnapshot
): boolean => {
    if (!prev) return true;
    return (
        prev.clipped !== next.clipped ||
        Math.abs(prev.rmsDb - next.rmsDb) > 0.12 ||
        Math.abs(prev.peakDb - next.peakDb) > 0.12
    );
};

class TrackHeaderMeterStore {
    private meters = new Map<string, TrackHeaderMeterSnapshot>();
    private listeners = new Map<string, Set<MeterListener>>();

    getSnapshot(trackId: string): TrackHeaderMeterSnapshot {
        return this.meters.get(trackId) || DEFAULT_TRACK_HEADER_METER;
    }

    subscribe(trackId: string, listener: MeterListener): () => void {
        const listeners = this.listeners.get(trackId) || new Set<MeterListener>();
        listeners.add(listener);
        this.listeners.set(trackId, listeners);

        return () => {
            const scopedListeners = this.listeners.get(trackId);
            if (!scopedListeners) return;
            scopedListeners.delete(listener);
            if (scopedListeners.size === 0) {
                this.listeners.delete(trackId);
            }
        };
    }

    publishBatch(batch: Record<string, TrackHeaderMeterSnapshot>) {
        const changedTrackIds: string[] = [];

        Object.entries(batch).forEach(([trackId, snapshot]) => {
            const prev = this.meters.get(trackId);
            if (!hasMeterChanged(prev, snapshot)) {
                return;
            }

            this.meters.set(trackId, snapshot);
            changedTrackIds.push(trackId);
        });

        if (changedTrackIds.length === 0) return;

        changedTrackIds.forEach((trackId) => {
            const listeners = this.listeners.get(trackId);
            if (!listeners) return;
            listeners.forEach((listener) => listener());
        });
    }

    prune(validTrackIds: Set<string>) {
        const removedTrackIds: string[] = [];

        this.meters.forEach((_value, trackId) => {
            if (validTrackIds.has(trackId)) return;
            this.meters.delete(trackId);
            removedTrackIds.push(trackId);
        });

        if (removedTrackIds.length === 0) return;

        removedTrackIds.forEach((trackId) => {
            const listeners = this.listeners.get(trackId);
            if (!listeners) return;
            listeners.forEach((listener) => listener());
        });
    }
}

export const trackHeaderMeterStore = new TrackHeaderMeterStore();
