import { ProjectData } from '../types';

const AUTOSAVE_STORAGE_KEY = 'hollowbits.project-autosave.v1';
const ACTIVE_SESSION_KEY = 'hollowbits.session-active.v1';
const LEGACY_AUTOSAVE_STORAGE_KEY = 'ethereal.project-autosave.v1';
const LEGACY_ACTIVE_SESSION_KEY = 'ethereal.session-active.v1';
const DEFAULT_MAX_AUTOSAVES = 12;

const readAutosavePayload = (): string | null => {
    const current = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
    if (current) {
        localStorage.removeItem(LEGACY_AUTOSAVE_STORAGE_KEY);
        return current;
    }

    const legacy = localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY);
    if (!legacy) return null;

    localStorage.setItem(AUTOSAVE_STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_AUTOSAVE_STORAGE_KEY);
    return legacy;
};

export interface ProjectAutosaveSnapshot {
    id: string;
    timestamp: number;
    reason: string;
    commandCount: number;
    projectName: string;
    project: ProjectData;
}

export interface RecoverySessionInfo {
    sessionId: string;
    hadUncleanExit: boolean;
}

const isValidProjectData = (value: unknown): value is ProjectData => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<ProjectData>;
    return Boolean(
        typeof candidate.version === 'string'
        && typeof candidate.name === 'string'
        && Array.isArray(candidate.tracks)
        && candidate.transport
    );
};

const sanitizeSnapshot = (value: unknown): ProjectAutosaveSnapshot | null => {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<ProjectAutosaveSnapshot>;
    if (
        typeof candidate.id !== 'string'
        || !Number.isFinite(candidate.timestamp)
        || typeof candidate.reason !== 'string'
        || !Number.isFinite(candidate.commandCount)
        || typeof candidate.projectName !== 'string'
        || !isValidProjectData(candidate.project)
    ) {
        return null;
    }

    return {
        id: candidate.id,
        timestamp: Number(candidate.timestamp),
        reason: candidate.reason,
        commandCount: Number(candidate.commandCount),
        projectName: candidate.projectName,
        project: candidate.project
    };
};

export const loadAutosaveSnapshots = (): ProjectAutosaveSnapshot[] => {
    try {
        const raw = readAutosavePayload();
        if (!raw) return [];

        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed)) return [];

        return parsed
            .map(sanitizeSnapshot)
            .filter((snapshot): snapshot is ProjectAutosaveSnapshot => snapshot !== null)
            .sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
        console.warn('No se pudo cargar autosave snapshots.', error);
        return [];
    }
};

export const saveAutosaveSnapshot = (
    snapshot: ProjectAutosaveSnapshot,
    maxSnapshots: number = DEFAULT_MAX_AUTOSAVES
): void => {
    try {
        const sanitized = sanitizeSnapshot(snapshot);
        if (!sanitized) return;

        const existing = loadAutosaveSnapshots().filter((item) => item.id !== sanitized.id);
        const next = [sanitized, ...existing]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, Math.max(1, maxSnapshots));

        localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(next));
        localStorage.removeItem(LEGACY_AUTOSAVE_STORAGE_KEY);
    } catch (error) {
        console.warn('No se pudo guardar autosave snapshot.', error);
    }
};

export const getLatestAutosaveSnapshot = (): ProjectAutosaveSnapshot | null => {
    const snapshots = loadAutosaveSnapshots();
    return snapshots[0] || null;
};

export const clearAutosaveSnapshot = (snapshotId: string): void => {
    if (!snapshotId) return;

    try {
        const next = loadAutosaveSnapshots().filter((snapshot) => snapshot.id !== snapshotId);
        localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(next));
        localStorage.removeItem(LEGACY_AUTOSAVE_STORAGE_KEY);
    } catch (error) {
        console.warn('No se pudo limpiar autosave snapshot.', error);
    }
};

export const startRecoverySession = (): RecoverySessionInfo => {
    const nextSessionId = `session-${Date.now().toString(36)}-${Math.floor(Math.random() * 10000).toString(36)}`;

    try {
        const previousSession = localStorage.getItem(ACTIVE_SESSION_KEY) || localStorage.getItem(LEGACY_ACTIVE_SESSION_KEY);
        localStorage.setItem(ACTIVE_SESSION_KEY, nextSessionId);
        localStorage.removeItem(LEGACY_ACTIVE_SESSION_KEY);

        return {
            sessionId: nextSessionId,
            hadUncleanExit: Boolean(previousSession)
        };
    } catch (error) {
        console.warn('No se pudo iniciar session marker de recovery.', error);
        return {
            sessionId: nextSessionId,
            hadUncleanExit: false
        };
    }
};

export const stopRecoverySession = (): void => {
    try {
        localStorage.removeItem(ACTIVE_SESSION_KEY);
        localStorage.removeItem(LEGACY_ACTIVE_SESSION_KEY);
    } catch (error) {
        console.warn('No se pudo limpiar session marker de recovery.', error);
    }
};
