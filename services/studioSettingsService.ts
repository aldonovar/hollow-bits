import { ScannedFileEntry } from '../types';

const STORAGE_KEY = 'hollowbits.studio-settings.v1';
const LEGACY_STORAGE_KEYS = ['ethereal.studio-settings.v1'];
const MAX_PERSISTED_ENTRIES = 600;
const MAX_BENCHMARK_HISTORY = 30;

export type DefaultListenMode = 'manual' | 'armed' | 'always';
const DEFAULT_LISTEN_MODE: DefaultListenMode = 'manual';

export interface StudioSettingsData {
    pluginFolders: string[];
    libraryFolders: string[];
    pluginIndex: ScannedFileEntry[];
    libraryIndex: ScannedFileEntry[];
    benchmarkHistory: AudioPerformanceBenchmarkHistoryRecord[];
    defaultListenMode: DefaultListenMode;
    updatedAt: number;
}

export interface AudioPerformanceBenchmarkHistoryRecord {
    id: string;
    createdAt: number;
    elapsedMs: number;
    totalCases: number;
    passedCases: number;
    warnedCases: number;
    failedCases: number;
    gateStatus: 'pass' | 'warn' | 'fail';
    workletWinRate: number;
    maxWorkletP95TickDriftMs: number;
    maxWorkletP99TickDriftMs: number;
    maxWorkletP95LagMs: number;
    maxWorkletP99LoopMs: number;
}

const createDefaultStudioSettings = (): StudioSettingsData => ({
    pluginFolders: [],
    libraryFolders: [],
    pluginIndex: [],
    libraryIndex: [],
    benchmarkHistory: [],
    defaultListenMode: DEFAULT_LISTEN_MODE,
    updatedAt: 0
});

const resolveStorage = (): Storage | null => {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const readStudioSettingsPayload = (storage: Storage): string | null => {
    const currentRaw = storage.getItem(STORAGE_KEY);
    if (currentRaw) {
        LEGACY_STORAGE_KEYS.forEach((legacyKey) => storage.removeItem(legacyKey));
        return currentRaw;
    }

    for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacyRaw = storage.getItem(legacyKey);
        if (!legacyRaw) continue;

        storage.setItem(STORAGE_KEY, legacyRaw);
        storage.removeItem(legacyKey);
        return legacyRaw;
    }

    return null;
};

const sanitizeEntries = (entries: unknown): ScannedFileEntry[] => {
    if (!Array.isArray(entries)) return [];

    return entries
        .filter((entry): entry is { name: string; path: string; size?: number } => {
            return Boolean(entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string' && typeof (entry as { path?: unknown }).path === 'string');
        })
        .slice(0, MAX_PERSISTED_ENTRIES)
        .map((entry) => ({
            name: entry.name,
            path: entry.path,
            size: Number.isFinite(entry.size) ? Number(entry.size) : 0
        }));
};

const sanitizePaths = (paths: unknown): string[] => {
    if (!Array.isArray(paths)) return [];

    return Array.from(new Set(paths
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)));
};

const sanitizeDefaultListenMode = (mode: unknown): DefaultListenMode => {
    return mode === 'armed' || mode === 'always' ? mode : DEFAULT_LISTEN_MODE;
};

const sanitizeBenchmarkHistory = (history: unknown): AudioPerformanceBenchmarkHistoryRecord[] => {
    if (!Array.isArray(history)) return [];

    return history
        .filter((entry): entry is Partial<AudioPerformanceBenchmarkHistoryRecord> => {
            return Boolean(entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string');
        })
        .slice(0, MAX_BENCHMARK_HISTORY)
        .map((entry, index) => {
            const gateStatus: AudioPerformanceBenchmarkHistoryRecord['gateStatus'] =
                entry.gateStatus === 'fail' || entry.gateStatus === 'warn'
                    ? entry.gateStatus
                    : 'pass';

            return {
                id: entry.id || `benchmark-${index}`,
                createdAt: Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : 0,
                elapsedMs: Number.isFinite(entry.elapsedMs) ? Number(entry.elapsedMs) : 0,
                totalCases: Number.isFinite(entry.totalCases) ? Number(entry.totalCases) : 0,
                passedCases: Number.isFinite(entry.passedCases) ? Number(entry.passedCases) : 0,
                warnedCases: Number.isFinite(entry.warnedCases) ? Number(entry.warnedCases) : 0,
                failedCases: Number.isFinite(entry.failedCases) ? Number(entry.failedCases) : 0,
                gateStatus,
                workletWinRate: Number.isFinite(entry.workletWinRate) ? Number(entry.workletWinRate) : 0,
                maxWorkletP95TickDriftMs: Number.isFinite(entry.maxWorkletP95TickDriftMs) ? Number(entry.maxWorkletP95TickDriftMs) : 0,
                maxWorkletP99TickDriftMs: Number.isFinite(entry.maxWorkletP99TickDriftMs) ? Number(entry.maxWorkletP99TickDriftMs) : 0,
                maxWorkletP95LagMs: Number.isFinite(entry.maxWorkletP95LagMs) ? Number(entry.maxWorkletP95LagMs) : 0,
                maxWorkletP99LoopMs: Number.isFinite(entry.maxWorkletP99LoopMs) ? Number(entry.maxWorkletP99LoopMs) : 0
            };
        })
        .sort((a, b) => b.createdAt - a.createdAt);
};

export const loadStudioSettings = (): StudioSettingsData => {
    const storage = resolveStorage();
    if (!storage) return createDefaultStudioSettings();

    try {
        const raw = readStudioSettingsPayload(storage);
        if (!raw) {
            return createDefaultStudioSettings();
        }

        const parsed = JSON.parse(raw) as Partial<StudioSettingsData>;
        return {
            pluginFolders: sanitizePaths(parsed.pluginFolders),
            libraryFolders: sanitizePaths(parsed.libraryFolders),
            pluginIndex: sanitizeEntries(parsed.pluginIndex),
            libraryIndex: sanitizeEntries(parsed.libraryIndex),
            benchmarkHistory: sanitizeBenchmarkHistory(parsed.benchmarkHistory),
            defaultListenMode: sanitizeDefaultListenMode(parsed.defaultListenMode),
            updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : 0
        };
    } catch (error) {
        console.warn('No se pudo cargar la configuracion de estudio.', error);
        return createDefaultStudioSettings();
    }
};

export const saveStudioSettings = (settings: StudioSettingsData): void => {
    const storage = resolveStorage();
    if (!storage) return;

    try {
        const sanitized: StudioSettingsData = {
            pluginFolders: sanitizePaths(settings.pluginFolders),
            libraryFolders: sanitizePaths(settings.libraryFolders),
            pluginIndex: sanitizeEntries(settings.pluginIndex),
            libraryIndex: sanitizeEntries(settings.libraryIndex),
            benchmarkHistory: sanitizeBenchmarkHistory(settings.benchmarkHistory),
            defaultListenMode: sanitizeDefaultListenMode(settings.defaultListenMode),
            updatedAt: Number.isFinite(settings.updatedAt) ? settings.updatedAt : Date.now()
        };

        storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
        LEGACY_STORAGE_KEYS.forEach((legacyKey) => storage.removeItem(legacyKey));
    } catch (error) {
        console.warn('No se pudo guardar la configuracion de estudio.', error);
    }
};
