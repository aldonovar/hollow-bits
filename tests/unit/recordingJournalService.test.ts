import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    appendRecordingJournalPhase,
    createRecordingJournalEntry,
    getRecordingJournalAttentionEntries,
    loadRecordingJournalEntries,
    loadRecordingJournalRecoveryAcknowledgedAt,
    markRecordingJournalCommitted,
    markRecordingJournalFailed,
    recoverRecordingJournalEntries,
    saveRecordingJournalEntries,
    saveRecordingJournalRecoveryAcknowledgedAt,
    summarizeRecordingJournalAttentionEntries,
    summarizeRecordingJournalEntries
} from '../../services/recordingJournalService';

describe('recordingJournalService', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('creates, updates and summarizes journal entries across the recording lifecycle', () => {
        const entry = createRecordingJournalEntry({
            id: 'journal-1',
            trackId: 'track-1',
            trackName: 'Lead Vocal',
            monitorMode: 'mono',
            createdAt: 1000,
            barTime: 5,
            contextTimeSec: 8
        });

        let entries = [entry];
        entries = appendRecordingJournalPhase(entries, 'journal-1', 'start-requested', { at: 1010 });
        entries = appendRecordingJournalPhase(entries, 'journal-1', 'started', { at: 1020, contextTimeSec: 8.1 });
        entries = appendRecordingJournalPhase(entries, 'journal-1', 'stop-requested', { at: 2000 });
        entries = appendRecordingJournalPhase(entries, 'journal-1', 'stopped', { at: 2050, contextTimeSec: 15.5 });
        entries = appendRecordingJournalPhase(entries, 'journal-1', 'finalized', { at: 2100 });
        entries = markRecordingJournalCommitted(entries, {
            journalId: 'journal-1',
            trackId: 'track-1',
            clipId: 'clip-1',
            takeId: 'take-1',
            sourceId: 'source-1',
            committedAt: 2200,
            latencyCompensationBars: 0.125,
            monitorMode: 'mono'
        });

        const summary = summarizeRecordingJournalEntries(entries);

        expect(entries[0].status).toBe('committed');
        expect(entries[0].clipId).toBe('clip-1');
        expect(entries[0].takeId).toBe('take-1');
        expect(entries[0].phases.map((phase) => phase.phase)).toEqual([
            'armed',
            'start-requested',
            'started',
            'stop-requested',
            'stopped',
            'finalized',
            'committed'
        ]);
        expect(summary.activeCount).toBe(0);
        expect(summary.committedCount).toBe(1);
        expect(summary.failedCount).toBe(0);
    });

    it('recovers unresolved entries after an unclean exit', () => {
        const entry = createRecordingJournalEntry({
            id: 'journal-2',
            trackId: 'track-2',
            trackName: 'Back Vox',
            monitorMode: 'stereo',
            createdAt: 4000
        });

        const recovered = recoverRecordingJournalEntries([entry], 'unclean-exit', 5000);

        expect(recovered[0].status).toBe('recovered');
        expect(recovered[0].failureReason).toBe('unclean-exit');
        expect(recovered[0].phases.at(-1)?.phase).toBe('recovered');
    });

    it('persists sanitized journal entries in localStorage', () => {
        const entry = createRecordingJournalEntry({
            id: 'journal-3',
            trackId: 'track-3',
            trackName: 'Guitar',
            monitorMode: 'left',
            createdAt: 7000
        });

        const failed = markRecordingJournalFailed([entry], 'journal-3', 'device-lost', { at: 7100 });
        saveRecordingJournalEntries(failed);

        localStorage.setItem('hollowbits.recording-journal.v1', JSON.stringify([
            ...failed,
            { bad: true }
        ]));

        const loaded = loadRecordingJournalEntries();

        expect(loaded).toHaveLength(1);
        expect(loaded[0].status).toBe('failed');
        expect(loaded[0].monitorMode).toBe('left');
        expect(loaded[0].phases.at(-1)?.phase).toBe('failed');
    });

    it('filters and summarizes attention entries after the acknowledged timestamp', () => {
        const base = createRecordingJournalEntry({
            id: 'journal-4',
            trackId: 'track-4',
            trackName: 'Keys',
            monitorMode: 'mono',
            createdAt: 8000
        });
        const recovered = recoverRecordingJournalEntries([base], 'unclean-exit', 9000)[0];
        const failed = markRecordingJournalFailed([createRecordingJournalEntry({
            id: 'journal-5',
            trackId: 'track-5',
            trackName: 'Bass',
            monitorMode: 'right',
            createdAt: 10000
        })], 'journal-5', 'device-lost', { at: 11000 })[0];

        const entries = [recovered, failed];
        const attention = getRecordingJournalAttentionEntries(entries, 9500);
        const summary = summarizeRecordingJournalAttentionEntries(entries, 9500);

        expect(attention).toHaveLength(1);
        expect(attention[0].id).toBe('journal-5');
        expect(summary.totalCount).toBe(1);
        expect(summary.failedCount).toBe(1);
        expect(summary.recoveredCount).toBe(0);
        expect(summary.latestUpdatedAt).toBe(11000);
    });

    it('persists recovery acknowledgement timestamp', () => {
        saveRecordingJournalRecoveryAcknowledgedAt(12345);
        expect(loadRecordingJournalRecoveryAcknowledgedAt()).toBe(12345);
    });
});
