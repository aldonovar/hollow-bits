import { beforeEach, describe, expect, it } from 'vitest';
import { loadStudioSettings, saveStudioSettings } from '../../services/studioSettingsService';

describe('studioSettingsService', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('persists benchmark history records', () => {
        saveStudioSettings({
            pluginFolders: [],
            libraryFolders: [],
            pluginIndex: [],
            libraryIndex: [],
            benchmarkHistory: [
                {
                    id: 'bench-1',
                    createdAt: 200,
                    elapsedMs: 1200,
                    totalCases: 6,
                    passedCases: 4,
                    warnedCases: 2,
                    failedCases: 0,
                    gateStatus: 'warn',
                    workletWinRate: 0.66,
                    maxWorkletP95TickDriftMs: 24,
                    maxWorkletP99TickDriftMs: 50,
                    maxWorkletP95LagMs: 12,
                    maxWorkletP99LoopMs: 17
                }
            ],
            defaultListenMode: 'manual',
            updatedAt: 1
        });

        const loaded = loadStudioSettings();
        expect(loaded.benchmarkHistory).toHaveLength(1);
        expect(loaded.benchmarkHistory[0].id).toBe('bench-1');
        expect(loaded.benchmarkHistory[0].gateStatus).toBe('warn');
    });

    it('sanitizes malformed benchmark history payloads', () => {
        window.localStorage.setItem('ethereal.studio-settings.v1', JSON.stringify({
            benchmarkHistory: [
                { id: 'valid', createdAt: 100, gateStatus: 'fail', workletWinRate: 0.1 },
                { gateStatus: 'warn' },
                null,
                { id: 'later', createdAt: 500, gateStatus: 'pass', workletWinRate: 0.9 }
            ]
        }));

        const loaded = loadStudioSettings();
        expect(loaded.benchmarkHistory.map((entry) => entry.id)).toEqual(['later', 'valid']);
        expect(loaded.benchmarkHistory[0].gateStatus).toBe('pass');
        expect(loaded.benchmarkHistory[1].gateStatus).toBe('fail');
    });
});
