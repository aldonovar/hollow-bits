import { Clip, RecordingTake, TakeLane, Track } from '../types';
import { getSecondsPerBar } from './transportStateService';

const DEFAULT_TRACK_COLOR = '#B34BE4';
const MIN_TAKE_LENGTH_BARS = 1 / 1024;

export interface BuildRecordingTakeCommitInput {
    track: Track;
    sourceId: string;
    buffer: AudioBuffer;
    bpm: number;
    recordingStartBar: number;
    latencyCompensationBars?: number;
    recordedAt?: number;
    idFactory?: (prefix: string) => string;
}

export interface RecordingTakeCommit {
    trackId: string;
    clip: Clip;
    take: RecordingTake;
    laneId: string;
    laneName: string;
}

const buildRuntimeId = (prefix: string): string => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const cloneTakeLane = (lane: TakeLane): TakeLane => {
    return {
        ...lane,
        takeIds: [...lane.takeIds],
        compSegments: lane.compSegments ? lane.compSegments.map((segment) => ({ ...segment })) : undefined
    };
};

const resolveTakeLane = (
    track: Track,
    idFactory: (prefix: string) => string
): { laneId: string; laneName: string } => {
    const existingLane = (track.takeLanes || []).find((lane) => !lane.isCompLane);
    if (existingLane) {
        return {
            laneId: existingLane.id,
            laneName: existingLane.name
        };
    }

    const laneCount = (track.takeLanes || []).filter((lane) => !lane.isCompLane).length;
    return {
        laneId: idFactory('lane-rec'),
        laneName: `Take Lane ${laneCount + 1}`
    };
};

const resolveCompensatedPlacement = (
    recordingStartBar: number,
    latencyCompensationBars: number
): { clipStartBar: number; clipOffsetBars: number } => {
    const safeStartBar = Math.max(1, Number.isFinite(recordingStartBar) ? recordingStartBar : 1);
    const safeCompensationBars = Math.max(0, Number.isFinite(latencyCompensationBars) ? latencyCompensationBars : 0);
    const idealStartBar = safeStartBar - safeCompensationBars;

    if (idealStartBar >= 1) {
        return {
            clipStartBar: idealStartBar,
            clipOffsetBars: 0
        };
    }

    return {
        clipStartBar: 1,
        clipOffsetBars: Math.max(0, 1 - idealStartBar)
    };
};

export const buildRecordingTakeCommit = (input: BuildRecordingTakeCommitInput): RecordingTakeCommit => {
    const idFactory = input.idFactory || buildRuntimeId;
    const recordedAt = input.recordedAt || Date.now();
    const secondsPerBar = getSecondsPerBar(input.bpm);
    const lengthBars = Math.max(MIN_TAKE_LENGTH_BARS, input.buffer.duration / secondsPerBar);
    const placement = resolveCompensatedPlacement(input.recordingStartBar, input.latencyCompensationBars || 0);
    const { laneId, laneName } = resolveTakeLane(input.track, idFactory);

    const clipId = idFactory('rec');
    const takeId = idFactory('take');
    const takeNumber = (input.track.recordingTakes?.length || 0) + 1;

    return {
        trackId: input.track.id,
        laneId,
        laneName,
        clip: {
            id: clipId,
            name: `Audio REC ${new Date(recordedAt).toLocaleTimeString()}`,
            color: input.track.color || DEFAULT_TRACK_COLOR,
            start: placement.clipStartBar,
            length: lengthBars,
            buffer: input.buffer,
            sourceId: input.sourceId,
            notes: [],
            originalBpm: input.bpm,
            offset: placement.clipOffsetBars,
            fadeIn: 0,
            fadeOut: 0,
            gain: 1,
            playbackRate: 1
        },
        take: {
            id: takeId,
            clipId,
            trackId: input.track.id,
            laneId,
            sourceId: input.sourceId,
            startBar: placement.clipStartBar,
            lengthBars,
            offsetBars: placement.clipOffsetBars,
            createdAt: recordedAt,
            label: `Take ${takeNumber}`,
            gain: 1,
            muted: false
        }
    };
};

export const commitRecordingTakeBatch = (tracks: Track[], commits: RecordingTakeCommit[]): Track[] => {
    if (commits.length === 0) {
        return tracks;
    }

    const commitsByTrack = new Map<string, RecordingTakeCommit[]>();
    commits.forEach((commit) => {
        const existing = commitsByTrack.get(commit.trackId);
        if (existing) {
            existing.push(commit);
            return;
        }
        commitsByTrack.set(commit.trackId, [commit]);
    });

    return tracks.map((track) => {
        const trackCommits = commitsByTrack.get(track.id);
        if (!trackCommits || trackCommits.length === 0) {
            return track;
        }

        const nextClips = [...track.clips];
        const nextTakes = [...(track.recordingTakes || [])];
        const nextLanes = (track.takeLanes || []).map(cloneTakeLane);
        const laneById = new Map(nextLanes.map((lane) => [lane.id, lane]));

        trackCommits.forEach((commit) => {
            nextClips.push(commit.clip);
            nextTakes.push(commit.take);

            let lane = laneById.get(commit.laneId);
            if (!lane) {
                lane = {
                    id: commit.laneId,
                    name: commit.laneName,
                    trackId: track.id,
                    isCompLane: false,
                    isMuted: false,
                    takeIds: []
                };
                nextLanes.push(lane);
                laneById.set(lane.id, lane);
            }

            if (!lane.takeIds.includes(commit.take.id)) {
                lane.takeIds = [...lane.takeIds, commit.take.id];
            }
        });

        return {
            ...track,
            clips: nextClips,
            recordingTakes: nextTakes,
            takeLanes: nextLanes
        };
    });
};
