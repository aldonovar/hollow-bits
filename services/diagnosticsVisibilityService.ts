import type { DiagnosticsVisibilityMode } from '../types';

const DIAGNOSTICS_VISIBILITY_STORAGE_KEY = 'hollowbits.diagnostics-visibility.v1';

export const sanitizeDiagnosticsVisibilityMode = (
    candidate: unknown
): DiagnosticsVisibilityMode => {
    return candidate === 'debug' ? 'debug' : 'hidden';
};

export const loadDiagnosticsVisibilityMode = (
    storage: Pick<Storage, 'getItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null
): DiagnosticsVisibilityMode => {
    if (!storage) return 'hidden';

    try {
        return sanitizeDiagnosticsVisibilityMode(storage.getItem(DIAGNOSTICS_VISIBILITY_STORAGE_KEY));
    } catch {
        return 'hidden';
    }
};

export const saveDiagnosticsVisibilityMode = (
    mode: DiagnosticsVisibilityMode,
    storage: Pick<Storage, 'setItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null
): void => {
    if (!storage) return;

    try {
        storage.setItem(DIAGNOSTICS_VISIBILITY_STORAGE_KEY, sanitizeDiagnosticsVisibilityMode(mode));
    } catch {
        // Non-blocking persistence path.
    }
};

export const toggleDiagnosticsVisibilityMode = (
    currentMode: DiagnosticsVisibilityMode
): DiagnosticsVisibilityMode => {
    return currentMode === 'debug' ? 'hidden' : 'debug';
};

