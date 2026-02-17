const STORAGE_KEY = 'ethereal.collab.host-session.v1';
const MAX_ACTIVITY_ENTRIES = 80;
const MAX_COMMAND_ENTRIES = 240;

export interface CollabActivityRecord {
    id: string;
    timestamp: number;
    message: string;
}

export interface CollabCommandRecord {
    id: string;
    timestamp: number;
    commandIndex: number;
    reason: string;
}

export interface CollabSessionSnapshot {
    sessionId: string | null;
    userName: string;
    commandCount: number;
    activity: CollabActivityRecord[];
    commandJournal: CollabCommandRecord[];
    updatedAt: number;
}

const sanitizeActivity = (items: unknown): CollabActivityRecord[] => {
    if (!Array.isArray(items)) return [];

    return items
        .filter((item): item is CollabActivityRecord => {
            return Boolean(
                item
                && typeof item === 'object'
                && typeof (item as { id?: unknown }).id === 'string'
                && typeof (item as { message?: unknown }).message === 'string'
                && Number.isFinite((item as { timestamp?: unknown }).timestamp)
            );
        })
        .slice(0, MAX_ACTIVITY_ENTRIES)
        .map((item) => ({
            id: item.id,
            message: item.message,
            timestamp: Number(item.timestamp)
        }));
};

const sanitizeCommandJournal = (items: unknown): CollabCommandRecord[] => {
    if (!Array.isArray(items)) return [];

    return items
        .filter((item): item is CollabCommandRecord => {
            return Boolean(
                item
                && typeof item === 'object'
                && typeof (item as { id?: unknown }).id === 'string'
                && typeof (item as { reason?: unknown }).reason === 'string'
                && Number.isFinite((item as { timestamp?: unknown }).timestamp)
                && Number.isFinite((item as { commandIndex?: unknown }).commandIndex)
            );
        })
        .slice(0, MAX_COMMAND_ENTRIES)
        .map((item) => ({
            id: item.id,
            reason: item.reason,
            timestamp: Number(item.timestamp),
            commandIndex: Number(item.commandIndex)
        }));
};

export const loadCollabSessionSnapshot = (): CollabSessionSnapshot => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {
                sessionId: null,
                userName: 'Producer',
                commandCount: 0,
                activity: [],
                commandJournal: [],
                updatedAt: 0
            };
        }

        const parsed = JSON.parse(raw) as Partial<CollabSessionSnapshot>;

        return {
            sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0 ? parsed.sessionId : null,
            userName: typeof parsed.userName === 'string' && parsed.userName.trim().length > 0 ? parsed.userName : 'Producer',
            commandCount: Number.isFinite(parsed.commandCount) ? Number(parsed.commandCount) : 0,
            activity: sanitizeActivity(parsed.activity),
            commandJournal: sanitizeCommandJournal(parsed.commandJournal),
            updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : 0
        };
    } catch (error) {
        console.warn('No se pudo cargar la sesion de colaboracion.', error);
        return {
            sessionId: null,
            userName: 'Producer',
            commandCount: 0,
            activity: [],
            commandJournal: [],
            updatedAt: 0
        };
    }
};

export const saveCollabSessionSnapshot = (snapshot: CollabSessionSnapshot): void => {
    try {
        const sanitized: CollabSessionSnapshot = {
            sessionId: typeof snapshot.sessionId === 'string' && snapshot.sessionId.length > 0 ? snapshot.sessionId : null,
            userName: snapshot.userName.trim() || 'Producer',
            commandCount: Number.isFinite(snapshot.commandCount) ? snapshot.commandCount : 0,
            activity: sanitizeActivity(snapshot.activity),
            commandJournal: sanitizeCommandJournal(snapshot.commandJournal),
            updatedAt: Number.isFinite(snapshot.updatedAt) ? snapshot.updatedAt : Date.now()
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch (error) {
        console.warn('No se pudo guardar la sesion de colaboracion.', error);
    }
};
