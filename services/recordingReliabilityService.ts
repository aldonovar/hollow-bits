import type { LiveCaptureRunConfig, RecordingJournalEntry, Track } from '../types';
import { TrackType } from '../types';
import { getTrackColorByPosition } from '../constants';
import { createTrack } from './projectCoreService';
import { buildRecordingTakeCommit, commitRecordingTakeBatch } from './recordingTakeService';
import {
    appendRecordingJournalPhase,
    createRecordingJournalEntry,
    markRecordingJournalCommitted,
    summarizeRecordingJournalEntries
} from './recordingJournalService';

export interface RecordingReliabilityReport {
    generatedAt: number;
    scenario: {
        name: 'recording-reliability';
        tracks: number;
        cycles: number;
        source: 'runtime-synthetic';
    };
    summary: {
        attemptedCycles: number;
        committedCycles: number;
        failedCycles: number;
        takeLossCount: number;
        p95CommitMs: number;
        journalMismatchCount: number;
        gatePass: boolean;
    };
    gates: {
        pass: boolean;
        results: {
            cycles: { target: number; actual: number; pass: boolean };
            committedCycles: { target: number; actual: number; pass: boolean };
            takeLoss: { target: number; actual: number; pass: boolean };
            failedCycles: { target: number; actual: number; pass: boolean };
            journalConsistency: { target: number; actual: number; pass: boolean };
        };
    };
}

const buildSyntheticBuffer = (durationSec: number = 1.25): AudioBuffer => {
    const sampleRate = 48000;
    const length = Math.max(1, Math.floor(durationSec * sampleRate));
    const channelData = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
        channelData[index] = Math.sin((index / sampleRate) * Math.PI * 220) * 0.25;
    }

    return {
        duration: durationSec,
        sampleRate,
        length,
        numberOfChannels: 1,
        getChannelData: () => channelData,
        copyFromChannel: (destination: Float32Array, channelNumber: number, bufferOffset: number = 0) => {
            if (channelNumber !== 0) return;
            destination.set(channelData.subarray(bufferOffset, bufferOffset + destination.length));
        },
        copyToChannel: (source: Float32Array, channelNumber: number, bufferOffset: number = 0) => {
            if (channelNumber !== 0) return;
            channelData.set(source.subarray(0, Math.max(0, channelData.length - bufferOffset)), bufferOffset);
        }
    } as unknown as AudioBuffer;
};

const percentile = (values: number[], ratio: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] || 0;
};

const createSyntheticTracks = (count: number): Track[] => {
    return Array.from({ length: count }, (_, index) => createTrack({
        id: `rec-track-${index + 1}`,
        name: `REC TRACK ${index + 1}`,
        type: TrackType.AUDIO,
        color: getTrackColorByPosition(index, count),
        isArmed: true,
        monitor: 'auto',
        micSettings: {
            profile: 'studio-voice',
            inputGain: 1,
            monitoringEnabled: true,
            monitoringReverb: false,
            monitoringEcho: false,
            monitorInputMode: index % 2 === 0 ? 'mono' : 'stereo',
            monitorLatencyCompensationMs: Number(((index % 4) * 0.5).toFixed(2))
        }
    }));
};

export const buildRecordingReliabilityReport = (
    inputConfig: Partial<LiveCaptureRunConfig> | Pick<LiveCaptureRunConfig, 'recordingCycles' | 'tracks'>
): RecordingReliabilityReport => {
    const cycles = Math.max(1, Math.floor(Number(inputConfig.recordingCycles) || 1000));
    const trackCount = Math.max(1, Math.min(8, Math.floor(Number(inputConfig.tracks) || 4)));
    const bpm = 124;
    const baseBuffer = buildSyntheticBuffer();
    let tracks = createSyntheticTracks(trackCount);
    let journalEntries: RecordingJournalEntry[] = [];
    const commitDurationsMs: number[] = [];
    let committedCycles = 0;
    let failedCycles = 0;

    for (let cycle = 0; cycle < cycles; cycle += 1) {
        const trackIndex = cycle % trackCount;
        const track = tracks[trackIndex];
        if (!track) {
            failedCycles += 1;
            continue;
        }

        const trackStartBar = 1 + (cycle * 0.25);
        const createdAt = 1_000_000 + cycle;
        const journalId = `rec-journal-${cycle + 1}`;
        const entry = createRecordingJournalEntry({
            id: journalId,
            trackId: track.id,
            trackName: track.name,
            inputDeviceId: track.inputDeviceId,
            monitorMode: track.micSettings?.monitorInputMode || 'mono',
            createdAt,
            barTime: trackStartBar,
            contextTimeSec: Number(((cycle % 16) * 0.5).toFixed(3))
        });
        journalEntries = [...journalEntries, entry];
        journalEntries = appendRecordingJournalPhase(journalEntries, journalId, 'start-requested', { at: createdAt + 1, barTime: trackStartBar });
        journalEntries = appendRecordingJournalPhase(journalEntries, journalId, 'started', { at: createdAt + 2, barTime: trackStartBar });
        journalEntries = appendRecordingJournalPhase(journalEntries, journalId, 'stop-requested', { at: createdAt + 3, barTime: trackStartBar + 0.5 });
        journalEntries = appendRecordingJournalPhase(journalEntries, journalId, 'stopped', { at: createdAt + 4, barTime: trackStartBar + 0.75 });
        journalEntries = appendRecordingJournalPhase(journalEntries, journalId, 'finalized', { at: createdAt + 5, barTime: trackStartBar + 0.75 });

        const cycleStart = performance.now();
        try {
            let idSeed = 0;
            const commit = buildRecordingTakeCommit({
                track,
                sourceId: `source-${cycle + 1}`,
                buffer: baseBuffer,
                bpm,
                recordingStartBar: trackStartBar,
                latencyCompensationBars: (track.micSettings?.monitorLatencyCompensationMs || 0) / 1000,
                sourceTrimOffsetBars: 0,
                recordedAt: createdAt + 10,
                idFactory: (prefix: string) => `${prefix}-${cycle + 1}-${++idSeed}`
            });

            tracks = commitRecordingTakeBatch(tracks, [commit]);
            committedCycles += 1;
            journalEntries = markRecordingJournalCommitted(journalEntries, {
                journalId,
                trackId: track.id,
                clipId: commit.clip.id,
                takeId: commit.take.id,
                sourceId: `source-${cycle + 1}`,
                committedAt: createdAt + 20,
                latencyCompensationBars: (track.micSettings?.monitorLatencyCompensationMs || 0) / 1000,
                monitorMode: track.micSettings?.monitorInputMode || 'mono'
            });
        } catch {
            failedCycles += 1;
        } finally {
            commitDurationsMs.push(performance.now() - cycleStart);
        }
    }

    const actualTakeCount = tracks.reduce((sum, track) => sum + (track.recordingTakes?.length || 0), 0);
    const takeLossCount = Math.max(0, committedCycles - actualTakeCount);
    const journalSummary = summarizeRecordingJournalEntries(journalEntries);
    const journalMismatchCount = Math.max(
        0,
        journalSummary.activeCount + journalSummary.failedCount + journalSummary.recoveredCount
    );
    const p95CommitMs = Number(percentile(commitDurationsMs, 0.95).toFixed(3));

    const gates = {
        cycles: {
            target: cycles,
            actual: cycles,
            pass: cycles >= 1000
        },
        committedCycles: {
            target: cycles,
            actual: committedCycles,
            pass: committedCycles === cycles
        },
        takeLoss: {
            target: 0,
            actual: takeLossCount,
            pass: takeLossCount === 0
        },
        failedCycles: {
            target: 0,
            actual: failedCycles,
            pass: failedCycles === 0
        },
        journalConsistency: {
            target: 0,
            actual: journalMismatchCount,
            pass: journalMismatchCount === 0
        }
    };

    const gatePass = Object.values(gates).every((gate) => gate.pass);

    return {
        generatedAt: Date.now(),
        scenario: {
            name: 'recording-reliability',
            tracks: trackCount,
            cycles,
            source: 'runtime-synthetic'
        },
        summary: {
            attemptedCycles: cycles,
            committedCycles,
            failedCycles,
            takeLossCount,
            p95CommitMs,
            journalMismatchCount,
            gatePass
        },
        gates: {
            pass: gatePass,
            results: gates
        }
    };
};
