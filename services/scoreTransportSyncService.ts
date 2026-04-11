import { Note } from '../types';
import { TransportClockSnapshot } from './transportClockStore';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export interface ScoreTransportFrame {
    playhead16th: number;
    playheadBarTime: number;
    activeNoteIndexes: number[];
}

export const getMeasure16thsForScore = (timeSignature: [number, number]): number => {
    const numerator = Math.max(1, Math.round(timeSignature[0] || 4));
    const denominator = Math.max(1, Math.round(timeSignature[1] || 4));
    return Math.max(1, numerator * (16 / denominator));
};

export const transportClockToBarTime = (
    snapshot: Pick<TransportClockSnapshot, 'currentBar' | 'currentBeat' | 'currentSixteenth'>
): number => {
    const currentBar = Math.max(1, Math.floor(snapshot.currentBar || 1));
    const currentBeat = Math.max(1, Math.min(4, Math.floor(snapshot.currentBeat || 1)));
    const currentSixteenth = Math.max(1, Math.min(4, Math.floor(snapshot.currentSixteenth || 1)));

    return currentBar + ((currentBeat - 1) / 4) + ((currentSixteenth - 1) / 16);
};

export const barTimeToTimeline16th = (barTime: number, timeSignature: [number, number]): number => {
    const safeBarTime = Math.max(1, Number.isFinite(barTime) ? barTime : 1);
    const wholeBars = Math.floor(safeBarTime) - 1;
    const barFraction = safeBarTime - Math.floor(safeBarTime);
    const measure16ths = getMeasure16thsForScore(timeSignature);

    return Math.max(0, (wholeBars * measure16ths) + (barFraction * measure16ths));
};

export const timeline16thToBarTime = (timeline16th: number, timeSignature: [number, number]): number => {
    const measure16ths = getMeasure16thsForScore(timeSignature);
    const clamped16th = Math.max(0, timeline16th);
    const barIndex = Math.floor(clamped16th / measure16ths);
    const offsetInBar = clamped16th - (barIndex * measure16ths);

    return 1 + barIndex + (offsetInBar / measure16ths);
};

export const buildScoreTransportFrame = (
    notes: Note[],
    clockSnapshot: TransportClockSnapshot,
    timeSignature: [number, number],
    bpm = 120,
    renderNow = Date.now()
): ScoreTransportFrame => {
    const playheadBarTime = transportClockToBarTime(clockSnapshot);
    const basePlayhead16th = barTimeToTimeline16th(playheadBarTime, timeSignature);
    const msPer16th = Math.max(1, 60000 / Math.max(1, bpm) / 4);
    const elapsed16ths = clockSnapshot.isPlaying && clockSnapshot.updatedAt > 0
        ? Math.max(0, renderNow - clockSnapshot.updatedAt) / msPer16th
        : 0;
    const playhead16th = basePlayhead16th + elapsed16ths;
    const activeNoteIndexes = notes.reduce<number[]>((indexes, note, index) => {
        const noteStart = note.start;
        const noteEnd = note.start + note.duration;
        if (playhead16th >= noteStart && playhead16th <= noteEnd) {
            indexes.push(index);
        }
        return indexes;
    }, []);

    return {
        playhead16th,
        playheadBarTime,
        activeNoteIndexes
    };
};

export const clampTimelineToSong = (timeline16th: number, total16ths: number): number => {
    return clamp(timeline16th, 0, Math.max(0, total16ths));
};
