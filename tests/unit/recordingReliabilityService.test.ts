import { describe, expect, it } from 'vitest';
import { buildRecordingReliabilityReport } from '../../services/recordingReliabilityService';

describe('recordingReliabilityService', () => {
    it('builds a passing 1000-cycle reliability report without take loss', () => {
        const report = buildRecordingReliabilityReport({
            recordingCycles: 1000,
            tracks: 4
        });

        expect(report.scenario.cycles).toBe(1000);
        expect(report.summary.committedCycles).toBe(1000);
        expect(report.summary.failedCycles).toBe(0);
        expect(report.summary.takeLossCount).toBe(0);
        expect(report.summary.journalMismatchCount).toBe(0);
        expect(report.gates.pass).toBe(true);
    });

    it('caps track count and keeps report deterministic for small runs', () => {
        const report = buildRecordingReliabilityReport({
            recordingCycles: 12,
            tracks: 99
        });

        expect(report.scenario.tracks).toBe(8);
        expect(report.summary.attemptedCycles).toBe(12);
        expect(report.summary.committedCycles).toBe(12);
        expect(report.gates.results.committedCycles.pass).toBe(true);
    });
});
