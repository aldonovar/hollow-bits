import { RecordingTake, Track } from '../types';

const MIN_GAIN = 0;
const MAX_GAIN = 2;

const clampGain = (value: number): number => {
    if (!Number.isFinite(value)) return 1;
    return Math.max(MIN_GAIN, Math.min(MAX_GAIN, value));
};

const getTakeBaseGain = (take: RecordingTake, clipGain: number | undefined): number => {
    const takeGain = take.gain;
    if (typeof takeGain === 'number' && Number.isFinite(takeGain)) {
        return clampGain(takeGain);
    }
    return clampGain(typeof clipGain === 'number' ? clipGain : 1);
};

export const setTrackActiveTake = (track: Track, takeId: string): Track => {
    if (!(track.recordingTakes || []).some((take) => take.id === takeId)) {
        return track;
    }

    if (track.activeTakeId === takeId) {
        return track;
    }

    return {
        ...track,
        activeTakeId: takeId
    };
};

export const setTrackActiveCompLane = (track: Track, laneId: string): Track => {
    if (!(track.takeLanes || []).some((lane) => lane.id === laneId && lane.isCompLane)) {
        return track;
    }

    if (track.activeCompLaneId === laneId) {
        return track;
    }

    return {
        ...track,
        activeCompLaneId: laneId
    };
};

export const toggleTrackTakeMute = (track: Track, takeId: string): Track => {
    const takes = track.recordingTakes || [];
    const takeIndex = takes.findIndex((take) => take.id === takeId);
    if (takeIndex < 0) {
        return track;
    }

    const targetTake = takes[takeIndex];
    const targetClip = track.clips.find((clip) => clip.id === targetTake.clipId);
    const baseGain = getTakeBaseGain(targetTake, targetClip?.gain);
    const nextMuted = !Boolean(targetTake.muted);

    const nextTakes = [...takes];
    nextTakes[takeIndex] = {
        ...targetTake,
        gain: baseGain,
        muted: nextMuted
    };

    const nextClips = track.clips.map((clip) => {
        if (clip.id !== targetTake.clipId) return clip;
        return {
            ...clip,
            gain: nextMuted ? 0 : baseGain
        };
    });

    const nextSoloTakeId = nextMuted && track.soloTakeId === takeId ? undefined : track.soloTakeId;

    return {
        ...track,
        clips: nextClips,
        recordingTakes: nextTakes,
        soloTakeId: nextSoloTakeId,
        activeTakeId: track.activeTakeId || takeId
    };
};

export const toggleTrackTakeSolo = (track: Track, takeId: string): Track => {
    const takes = track.recordingTakes || [];
    if (!takes.some((take) => take.id === takeId)) {
        return track;
    }

    const nextSoloTakeId = track.soloTakeId === takeId ? undefined : takeId;
    const takesByClipId = new Map(takes.map((take) => [take.clipId, take]));

    const nextClips = track.clips.map((clip) => {
        const relatedTake = takesByClipId.get(clip.id);
        if (!relatedTake) return clip;

        const baseGain = getTakeBaseGain(relatedTake, clip.gain);
        const nextGain = nextSoloTakeId
            ? (relatedTake.id === nextSoloTakeId && !relatedTake.muted ? baseGain : 0)
            : (relatedTake.muted ? 0 : baseGain);

        if (Math.abs((clip.gain || 0) - nextGain) <= 1e-6) {
            return clip;
        }

        return {
            ...clip,
            gain: nextGain
        };
    });

    return {
        ...track,
        clips: nextClips,
        soloTakeId: nextSoloTakeId,
        activeTakeId: takeId
    };
};
