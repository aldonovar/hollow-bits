import {
    MonitoringRouteMode,
    RecordingCommitResult,
    RecordingJournalEntry,
    RecordingJournalEvent,
    RecordingJournalPhase
} from '../types';

const RECORDING_JOURNAL_STORAGE_KEY = 'hollowbits.recording-journal.v1';
const RECORDING_JOURNAL_RECOVERY_ACK_KEY = 'hollowbits.recording-journal-recovery-ack.v1';
const DEFAULT_MAX_RECORDING_JOURNAL_ENTRIES = 96;

interface CreateRecordingJournalEntryInput {
    id: string;
    trackId: string;
    trackName: string;
    inputDeviceId?: string;
    monitorMode: MonitoringRouteMode;
    createdAt?: number;
    barTime?: number;
    contextTimeSec?: number;
}

interface RecordingJournalPhaseOptions {
    at?: number;
    barTime?: number;
    contextTimeSec?: number;
    message?: string;
    details?: Record<string, string | number | boolean | null>;
}

export interface RecordingJournalSummary {
    totalCount: number;
    activeCount: number;
    committedCount: number;
    failedCount: number;
    recoveredCount: number;
    lastUpdatedAt: number | null;
}

export interface RecordingJournalAttentionSummary {
    totalCount: number;
    failedCount: number;
    recoveredCount: number;
    latestUpdatedAt: number | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
};

const sanitizePhase = (value: unknown): RecordingJournalPhase | null => {
    switch (value) {
        case 'armed':
        case 'start-requested':
        case 'started':
        case 'stop-requested':
        case 'stopped':
        case 'finalized':
        case 'committed':
        case 'failed':
        case 'recovered':
            return value;
        default:
            return null;
    }
};

const sanitizeMode = (value: unknown): MonitoringRouteMode => {
    return value === 'stereo' || value === 'left' || value === 'right' ? value : 'mono';
};

const sanitizeDetails = (value: unknown): Record<string, string | number | boolean | null> | undefined => {
    if (!isPlainObject(value)) return undefined;

    const nextEntries = Object.entries(value)
        .filter(([, detailValue]) => (
            typeof detailValue === 'string'
            || typeof detailValue === 'number'
            || typeof detailValue === 'boolean'
            || detailValue === null
        ));

    if (nextEntries.length === 0) {
        return undefined;
    }

    return nextEntries.reduce<Record<string, string | number | boolean | null>>((accumulator, [key, detailValue]) => {
        accumulator[key] = detailValue as string | number | boolean | null;
        return accumulator;
    }, {});
};

const sanitizeEvent = (value: unknown): RecordingJournalEvent | null => {
    if (!isPlainObject(value)) return null;

    const phase = sanitizePhase(value.phase);
    if (!phase || !Number.isFinite(value.at)) {
        return null;
    }

    return {
        phase,
        at: Number(value.at),
        ...(Number.isFinite(value.barTime) ? { barTime: Number(value.barTime) } : {}),
        ...(Number.isFinite(value.contextTimeSec) ? { contextTimeSec: Number(value.contextTimeSec) } : {}),
        ...(typeof value.message === 'string' && value.message.length > 0 ? { message: value.message } : {}),
        ...(sanitizeDetails(value.details) ? { details: sanitizeDetails(value.details) } : {})
    };
};

const sanitizeEntry = (value: unknown): RecordingJournalEntry | null => {
    if (!isPlainObject(value)) return null;
    if (
        typeof value.id !== 'string'
        || typeof value.trackId !== 'string'
        || typeof value.trackName !== 'string'
        || !Number.isFinite(value.createdAt)
        || !Number.isFinite(value.updatedAt)
        || !Array.isArray(value.phases)
    ) {
        return null;
    }

    const phases = value.phases
        .map(sanitizeEvent)
        .filter((event): event is RecordingJournalEvent => event !== null);

    if (phases.length === 0) {
        return null;
    }

    const status = value.status === 'committed'
        || value.status === 'failed'
        || value.status === 'recovered'
        ? value.status
        : 'active';

    return {
        id: value.id,
        trackId: value.trackId,
        trackName: value.trackName,
        createdAt: Number(value.createdAt),
        updatedAt: Number(value.updatedAt),
        inputDeviceId: typeof value.inputDeviceId === 'string' ? value.inputDeviceId : undefined,
        monitorMode: sanitizeMode(value.monitorMode),
        status,
        clipId: typeof value.clipId === 'string' ? value.clipId : undefined,
        takeId: typeof value.takeId === 'string' ? value.takeId : undefined,
        sourceId: typeof value.sourceId === 'string' ? value.sourceId : undefined,
        failureReason: typeof value.failureReason === 'string' ? value.failureReason : undefined,
        phases
    };
};

const pushPhase = (
    entry: RecordingJournalEntry,
    phase: RecordingJournalPhase,
    options?: RecordingJournalPhaseOptions
): RecordingJournalEntry => {
    const at = Number.isFinite(options?.at) ? Number(options?.at) : Date.now();

    return {
        ...entry,
        updatedAt: at,
        phases: [
            ...entry.phases,
            {
                phase,
                at,
                ...(Number.isFinite(options?.barTime) ? { barTime: Number(options?.barTime) } : {}),
                ...(Number.isFinite(options?.contextTimeSec) ? { contextTimeSec: Number(options?.contextTimeSec) } : {}),
                ...(typeof options?.message === 'string' && options.message.length > 0 ? { message: options.message } : {}),
                ...(options?.details ? { details: options.details } : {})
            }
        ]
    };
};

export const createRecordingJournalEntry = (
    input: CreateRecordingJournalEntryInput
): RecordingJournalEntry => {
    const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now();
    return {
        id: input.id,
        trackId: input.trackId,
        trackName: input.trackName,
        createdAt,
        updatedAt: createdAt,
        inputDeviceId: input.inputDeviceId,
        monitorMode: input.monitorMode,
        status: 'active',
        phases: [{
            phase: 'armed',
            at: createdAt,
            ...(Number.isFinite(input.barTime) ? { barTime: Number(input.barTime) } : {}),
            ...(Number.isFinite(input.contextTimeSec) ? { contextTimeSec: Number(input.contextTimeSec) } : {})
        }]
    };
};

export const appendRecordingJournalPhase = (
    entries: RecordingJournalEntry[],
    journalId: string,
    phase: RecordingJournalPhase,
    options?: RecordingJournalPhaseOptions
): RecordingJournalEntry[] => {
    return entries.map((entry) => {
        if (entry.id !== journalId) return entry;
        return pushPhase(entry, phase, options);
    });
};

export const markRecordingJournalFailed = (
    entries: RecordingJournalEntry[],
    journalId: string,
    message: string,
    options?: Omit<RecordingJournalPhaseOptions, 'message'>
): RecordingJournalEntry[] => {
    return entries.map((entry) => {
        if (entry.id !== journalId) return entry;
        const nextEntry = pushPhase(entry, 'failed', {
            ...options,
            message
        });
        return {
            ...nextEntry,
            status: 'failed',
            failureReason: message
        };
    });
};

export const markRecordingJournalCommitted = (
    entries: RecordingJournalEntry[],
    result: RecordingCommitResult
): RecordingJournalEntry[] => {
    return entries.map((entry) => {
        if (entry.id !== result.journalId) return entry;
        const nextEntry = pushPhase(entry, 'committed', {
            at: result.committedAt,
            details: {
                clipId: result.clipId,
                takeId: result.takeId,
                sourceId: result.sourceId,
                latencyCompensationBars: Number(result.latencyCompensationBars.toFixed(6)),
                monitorMode: result.monitorMode
            }
        });
        return {
            ...nextEntry,
            status: 'committed',
            clipId: result.clipId,
            takeId: result.takeId,
            sourceId: result.sourceId,
            failureReason: undefined
        };
    });
};

export const recoverRecordingJournalEntries = (
    entries: RecordingJournalEntry[],
    message: string = 'Recording session interrupted before commit.',
    recoveredAt: number = Date.now()
): RecordingJournalEntry[] => {
    return entries.map((entry) => {
        if (entry.status !== 'active') return entry;
        const nextEntry = pushPhase(entry, 'recovered', {
            at: recoveredAt,
            message
        });
        return {
            ...nextEntry,
            status: 'recovered',
            failureReason: message
        };
    });
};

export const pruneRecordingJournalEntries = (
    entries: RecordingJournalEntry[],
    maxEntries: number = DEFAULT_MAX_RECORDING_JOURNAL_ENTRIES
): RecordingJournalEntry[] => {
    return [...entries]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.max(1, maxEntries));
};

export const summarizeRecordingJournalEntries = (
    entries: RecordingJournalEntry[]
): RecordingJournalSummary => {
    const summary: RecordingJournalSummary = {
        totalCount: entries.length,
        activeCount: 0,
        committedCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        lastUpdatedAt: null
    };

    entries.forEach((entry) => {
        if (summary.lastUpdatedAt === null || entry.updatedAt > summary.lastUpdatedAt) {
            summary.lastUpdatedAt = entry.updatedAt;
        }

        if (entry.status === 'active') summary.activeCount += 1;
        else if (entry.status === 'committed') summary.committedCount += 1;
        else if (entry.status === 'failed') summary.failedCount += 1;
        else if (entry.status === 'recovered') summary.recoveredCount += 1;
    });

    return summary;
};

export const getRecordingJournalAttentionEntries = (
    entries: RecordingJournalEntry[],
    acknowledgedAt: number = 0
): RecordingJournalEntry[] => {
    const safeAcknowledgedAt = Number.isFinite(acknowledgedAt) ? Number(acknowledgedAt) : 0;

    return [...entries]
        .filter((entry) => (
            (entry.status === 'failed' || entry.status === 'recovered')
            && entry.updatedAt > safeAcknowledgedAt
        ))
        .sort((left, right) => right.updatedAt - left.updatedAt);
};

export const summarizeRecordingJournalAttentionEntries = (
    entries: RecordingJournalEntry[],
    acknowledgedAt: number = 0
): RecordingJournalAttentionSummary => {
    const attentionEntries = getRecordingJournalAttentionEntries(entries, acknowledgedAt);

    return attentionEntries.reduce<RecordingJournalAttentionSummary>((summary, entry) => {
        summary.totalCount += 1;
        if (entry.status === 'failed') summary.failedCount += 1;
        if (entry.status === 'recovered') summary.recoveredCount += 1;
        if (summary.latestUpdatedAt === null || entry.updatedAt > summary.latestUpdatedAt) {
            summary.latestUpdatedAt = entry.updatedAt;
        }
        return summary;
    }, {
        totalCount: 0,
        failedCount: 0,
        recoveredCount: 0,
        latestUpdatedAt: null
    });
};

export const loadRecordingJournalEntries = (): RecordingJournalEntry[] => {
    try {
        const raw = localStorage.getItem(RECORDING_JOURNAL_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];

        return pruneRecordingJournalEntries(
            parsed
                .map(sanitizeEntry)
                .filter((entry): entry is RecordingJournalEntry => entry !== null)
        );
    } catch (error) {
        console.warn('No se pudo cargar recording journal.', error);
        return [];
    }
};

export const saveRecordingJournalEntries = (entries: RecordingJournalEntry[]): void => {
    try {
        localStorage.setItem(
            RECORDING_JOURNAL_STORAGE_KEY,
            JSON.stringify(pruneRecordingJournalEntries(entries))
        );
    } catch (error) {
        console.warn('No se pudo guardar recording journal.', error);
    }
};

export const loadRecordingJournalRecoveryAcknowledgedAt = (): number => {
    try {
        const raw = localStorage.getItem(RECORDING_JOURNAL_RECOVERY_ACK_KEY);
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    } catch (error) {
        console.warn('No se pudo cargar recording recovery ack.', error);
        return 0;
    }
};

export const saveRecordingJournalRecoveryAcknowledgedAt = (acknowledgedAt: number): void => {
    try {
        const safeAcknowledgedAt = Number.isFinite(acknowledgedAt) ? Math.max(0, Number(acknowledgedAt)) : 0;
        localStorage.setItem(RECORDING_JOURNAL_RECOVERY_ACK_KEY, String(safeAcknowledgedAt));
    } catch (error) {
        console.warn('No se pudo guardar recording recovery ack.', error);
    }
};
