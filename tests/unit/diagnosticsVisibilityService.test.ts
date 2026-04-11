import { describe, expect, it, vi } from 'vitest';

import {
    loadDiagnosticsVisibilityMode,
    sanitizeDiagnosticsVisibilityMode,
    saveDiagnosticsVisibilityMode,
    toggleDiagnosticsVisibilityMode
} from '../../services/diagnosticsVisibilityService';

describe('diagnosticsVisibilityService', () => {
    it('sanitizes unknown values to hidden', () => {
        expect(sanitizeDiagnosticsVisibilityMode('debug')).toBe('debug');
        expect(sanitizeDiagnosticsVisibilityMode('hidden')).toBe('hidden');
        expect(sanitizeDiagnosticsVisibilityMode('invalid')).toBe('hidden');
        expect(sanitizeDiagnosticsVisibilityMode(null)).toBe('hidden');
    });

    it('loads hidden by default when storage is unavailable or empty', () => {
        expect(loadDiagnosticsVisibilityMode(null)).toBe('hidden');
        expect(loadDiagnosticsVisibilityMode({
            getItem: vi.fn(() => null)
        })).toBe('hidden');
    });

    it('persists sanitized values and toggles predictably', () => {
        const setItem = vi.fn();

        saveDiagnosticsVisibilityMode('debug', { setItem });
        expect(setItem).toHaveBeenCalledWith('hollowbits.diagnostics-visibility.v1', 'debug');

        expect(toggleDiagnosticsVisibilityMode('hidden')).toBe('debug');
        expect(toggleDiagnosticsVisibilityMode('debug')).toBe('hidden');
    });
});

