import { describe, expect, it } from 'vitest';
import { runBlock3CompingRegressionMatrix } from '../../services/block3CompingReliabilityService';

describe('block3CompingReliabilityService', () => {
    it('runs block 3 regression matrix and passes with reduced cycles', () => {
        const report = runBlock3CompingRegressionMatrix({
            recordingCycles: 220,
            compEditCycles: 120,
            simulatedLiveMinutes: 30
        });

        expect(report.totalCases).toBe(4);
        expect(report.failedCases, JSON.stringify(report.results, null, 2)).toBe(0);
        expect(report.passedCases).toBe(4);
        expect(report.results.every((result) => result.status === 'pass')).toBe(true);
    });

    it('covers required stress and regression case ids', () => {
        const report = runBlock3CompingRegressionMatrix({
            recordingCycles: 64,
            compEditCycles: 32,
            simulatedLiveMinutes: 12
        });
        const caseIds = new Set(report.results.map((result) => result.id));

        expect(caseIds.has('recording-finalize-1000-cycles')).toBe(true);
        expect(caseIds.has('punch-auto-stop-mixed-ranges')).toBe(true);
        expect(caseIds.has('comping-edit-regression-matrix')).toBe(true);
        expect(caseIds.has('live-edit-90min-model')).toBe(true);
    });
});
