import { LoopMode, TransportState } from '../types';

const MIN_BPM = 20;
const MAX_BPM = 999;

export interface TransportPosition {
    currentBar: number;
    currentBeat: number;
    currentSixteenth: number;
}

export type LoopEndAction = {
    action: 'restart' | 'stop';
    nextLoopMode?: LoopMode;
    nextOnceRemaining: number;
};

const normalizeBpm = (bpm: number): number => {
    if (!Number.isFinite(bpm)) return 120;
    return Math.max(MIN_BPM, Math.min(MAX_BPM, bpm));
};

export const getSecondsPerBar = (bpm: number): number => {
    return (60 / normalizeBpm(bpm)) * 4;
};

export const barToSeconds = (barTime: number, bpm: number): number => {
    const safeBarTime = Math.max(1, Number.isFinite(barTime) ? barTime : 1);
    return Math.max(0, (safeBarTime - 1) * getSecondsPerBar(bpm));
};

export const positionToBarTime = (position: Pick<TransportState, 'currentBar' | 'currentBeat' | 'currentSixteenth'>): number => {
    const bar = Math.max(1, Math.floor(position.currentBar || 1));
    const beat = Math.max(1, Math.min(4, Math.floor(position.currentBeat || 1)));
    const sixteenth = Math.max(1, Math.min(4, Math.floor(position.currentSixteenth || 1)));

    return bar + ((beat - 1) / 4) + ((sixteenth - 1) / 16);
};

export const barTimeToPosition = (barTime: number): TransportPosition => {
    const safeBar = Math.max(1, Number.isFinite(barTime) ? barTime : 1);
    const totalSixteenths = Math.floor(((safeBar - 1) * 16) + 1e-6);

    const currentBar = Math.floor(totalSixteenths / 16) + 1;
    const sixteenthsInBar = totalSixteenths % 16;
    const currentBeat = Math.floor(sixteenthsInBar / 4) + 1;
    const currentSixteenth = (sixteenthsInBar % 4) + 1;

    return {
        currentBar,
        currentBeat,
        currentSixteenth
    };
};

export const getLoopEndAction = (loopMode: LoopMode, onceRemaining: number): LoopEndAction => {
    const safeOnceRemaining = Math.max(0, Math.floor(onceRemaining));

    if (loopMode === 'infinite') {
        return {
            action: 'restart',
            nextOnceRemaining: safeOnceRemaining
        };
    }

    if (loopMode === 'once') {
        if (safeOnceRemaining <= 0) {
            return {
                action: 'stop',
                nextOnceRemaining: 0,
                nextLoopMode: 'off'
            };
        }

        const nextRemaining = safeOnceRemaining - 1;
        return {
            action: 'restart',
            nextOnceRemaining: nextRemaining,
            ...(nextRemaining <= 0 ? { nextLoopMode: 'off' as LoopMode } : {})
        };
    }

    return {
        action: 'stop',
        nextOnceRemaining: 0
    };
};

export const shouldRestartAtSongBoundary = (
    currentSeconds: number,
    endSeconds: number,
    epsilonSeconds: number = 0.02
): boolean => {
    if (!Number.isFinite(currentSeconds) || !Number.isFinite(endSeconds)) return false;
    if (endSeconds <= 0) return false;
    return currentSeconds >= Math.max(0, endSeconds - Math.max(0.001, epsilonSeconds));
};
