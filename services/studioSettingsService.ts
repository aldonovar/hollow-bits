import { ScannedFileEntry } from '../types';

const STORAGE_KEY = 'ethereal.studio-settings.v1';
const MAX_PERSISTED_ENTRIES = 600;

export interface StudioSettingsData {
    pluginFolders: string[];
    libraryFolders: string[];
    pluginIndex: ScannedFileEntry[];
    libraryIndex: ScannedFileEntry[];
    updatedAt: number;
}

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

export const loadStudioSettings = (): StudioSettingsData => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {
                pluginFolders: [],
                libraryFolders: [],
                pluginIndex: [],
                libraryIndex: [],
                updatedAt: 0
            };
        }

        const parsed = JSON.parse(raw) as Partial<StudioSettingsData>;
        return {
            pluginFolders: sanitizePaths(parsed.pluginFolders),
            libraryFolders: sanitizePaths(parsed.libraryFolders),
            pluginIndex: sanitizeEntries(parsed.pluginIndex),
            libraryIndex: sanitizeEntries(parsed.libraryIndex),
            updatedAt: Number.isFinite(parsed.updatedAt) ? Number(parsed.updatedAt) : 0
        };
    } catch (error) {
        console.warn('No se pudo cargar la configuracion de estudio.', error);
        return {
            pluginFolders: [],
            libraryFolders: [],
            pluginIndex: [],
            libraryIndex: [],
            updatedAt: 0
        };
    }
};

export const saveStudioSettings = (settings: StudioSettingsData): void => {
    try {
        const sanitized: StudioSettingsData = {
            pluginFolders: sanitizePaths(settings.pluginFolders),
            libraryFolders: sanitizePaths(settings.libraryFolders),
            pluginIndex: sanitizeEntries(settings.pluginIndex),
            libraryIndex: sanitizeEntries(settings.libraryIndex),
            updatedAt: Number.isFinite(settings.updatedAt) ? settings.updatedAt : Date.now()
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    } catch (error) {
        console.warn('No se pudo guardar la configuracion de estudio.', error);
    }
};
