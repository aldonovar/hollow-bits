import { describe, expect, it } from 'vitest';
import { ProjectData, TransportState } from '../../types';
import {
    clearAutosaveSnapshot,
    getLatestAutosaveSnapshot,
    loadAutosaveSnapshots,
    ProjectAutosaveSnapshot,
    saveAutosaveSnapshot,
    startRecoverySession,
    stopRecoverySession
} from '../../services/projectRecoveryService';

const AUTOSAVE_STORAGE_KEY = 'hollowbits.project-autosave.v1';
const ACTIVE_SESSION_KEY = 'hollowbits.session-active.v1';
const LEGACY_AUTOSAVE_STORAGE_KEY = 'ethereal.project-autosave.v1';

const transportFixture: TransportState = {
    isPlaying: false,
    isRecording: false,
    loopMode: 'off',
    bpm: 120,
    timeSignature: [4, 4],
    currentBar: 1,
    currentBeat: 1,
    currentSixteenth: 1,
    masterTranspose: 0,
    gridSize: 0.25,
    snapToGrid: true,
    scaleRoot: 0,
    scaleType: 'minor'
};

const createProject = (name: string): ProjectData => ({
    version: '1.0.0',
    name,
    tracks: [],
    transport: transportFixture,
    audioSettings: {
        sampleRate: 48000,
        bufferSize: 'auto',
        latencyHint: 'interactive'
    },
    createdAt: 1,
    lastModified: 1
});

const createSnapshot = (id: string, timestamp: number): ProjectAutosaveSnapshot => ({
    id,
    timestamp,
    reason: 'unit-test',
    commandCount: timestamp,
    projectName: `Project-${id}`,
    project: createProject(`Project-${id}`)
});

describe('projectRecoveryService', () => {
    it('stores snapshots sorted by recency and respects maxSnapshots', () => {
        saveAutosaveSnapshot(createSnapshot('s1', 1000), 2);
        saveAutosaveSnapshot(createSnapshot('s2', 2000), 2);
        saveAutosaveSnapshot(createSnapshot('s3', 3000), 2);

        const snapshots = loadAutosaveSnapshots();
        expect(snapshots).toHaveLength(2);
        expect(snapshots.map((snapshot) => snapshot.id)).toEqual(['s3', 's2']);
    });

    it('ignores malformed snapshot payloads from storage', () => {
        localStorage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify([
            { id: 'bad-payload' },
            null,
            42
        ]));

        expect(loadAutosaveSnapshots()).toEqual([]);
    });

    it('returns latest snapshot and clears by id', () => {
        saveAutosaveSnapshot(createSnapshot('old', 1000), 5);
        saveAutosaveSnapshot(createSnapshot('latest', 9000), 5);

        expect(getLatestAutosaveSnapshot()?.id).toBe('latest');

        clearAutosaveSnapshot('latest');
        const remaining = loadAutosaveSnapshots();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('old');
    });

    it('migrates legacy autosave storage key into hollowbits namespace', () => {
        localStorage.setItem(LEGACY_AUTOSAVE_STORAGE_KEY, JSON.stringify([
            createSnapshot('legacy', 7000)
        ]));

        const migrated = loadAutosaveSnapshots();
        expect(migrated).toHaveLength(1);
        expect(migrated[0].id).toBe('legacy');
        expect(localStorage.getItem(AUTOSAVE_STORAGE_KEY)).not.toBeNull();
        expect(localStorage.getItem(LEGACY_AUTOSAVE_STORAGE_KEY)).toBeNull();
    });

    it('tracks unclean exit markers for recovery sessions', () => {
        const firstSession = startRecoverySession();
        expect(firstSession.hadUncleanExit).toBe(false);

        const secondSession = startRecoverySession();
        expect(secondSession.hadUncleanExit).toBe(true);
        expect(localStorage.getItem(ACTIVE_SESSION_KEY)).toBe(secondSession.sessionId);

        stopRecoverySession();
        expect(localStorage.getItem(ACTIVE_SESSION_KEY)).toBeNull();
    });
});
