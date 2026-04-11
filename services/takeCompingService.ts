import { Clip, CompSegment, PunchRange, RecordingTake, TakeLane, Track, TrackType } from '../types';

const COMP_LANE_NAME = 'Comp Lane';
const COMP_LANE_ID_PREFIX = 'lane-comp';
const COMP_SEGMENT_ID_PREFIX = 'comp-segment';
export const COMP_CLIP_ID_PREFIX = 'comp-seg-';

const DEFAULT_PUNCH_RANGE: PunchRange = {
    enabled: false,
    inBar: 1,
    outBar: 2,
    preRollBars: 1,
    countInBars: 0
};

const MIN_RANGE_BARS = 1 / 1024;
const EPSILON = 1e-6;

export interface PunchRecordingPlan {
    punchInBar: number;
    punchOutBar: number;
    preRollBars: number;
    countInBars: number;
    startPlaybackBar: number;
    sourceTrimOffsetBars: number;
}

export interface PunchRecordingSessionMetaLike {
    punchOutBar?: number;
}

export interface TrackClipEditingContext {
    clip: Clip | null;
    isCompClip: boolean;
    isTakeClip: boolean;
    take?: RecordingTake;
    takeLane?: TakeLane;
    compLane?: TakeLane;
    compSegment?: CompSegment;
}

interface PromoteTakeToCompOptions {
    replaceExisting?: boolean;
    sourceStartBar?: number;
    sourceEndBar?: number;
    targetStartBar?: number;
    fadeInBars?: number;
    fadeOutBars?: number;
    idFactory?: (prefix: string) => string;
}

const buildRuntimeId = (prefix: string): string => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const clampNumber = (value: number, fallback: number): number => {
    return Number.isFinite(value) ? value : fallback;
};

const cloneTakeLane = (lane: TakeLane): TakeLane => {
    return {
        ...lane,
        takeIds: [...lane.takeIds],
        compSegments: lane.compSegments ? lane.compSegments.map((segment) => ({ ...segment })) : undefined
    };
};

const mergeCompSegments = (segments: CompSegment[]): CompSegment[] => {
    const sorted = [...segments].sort((a, b) => a.targetStartBar - b.targetStartBar);
    if (sorted.length <= 1) {
        return sorted;
    }

    const merged: CompSegment[] = [{ ...sorted[0] }];

    for (let index = 1; index < sorted.length; index += 1) {
        const current = sorted[index];
        const previous = merged[merged.length - 1];

        const previousLength = previous.sourceEndBar - previous.sourceStartBar;
        const previousTargetEnd = previous.targetStartBar + previousLength;

        const canMerge =
            previous.takeId === current.takeId
            && Math.abs(previous.sourceEndBar - current.sourceStartBar) <= EPSILON
            && Math.abs(previousTargetEnd - current.targetStartBar) <= EPSILON
            && !previous.fadeOutBars
            && !current.fadeInBars;

        if (!canMerge) {
            merged.push({ ...current });
            continue;
        }

        previous.sourceEndBar = current.sourceEndBar;
        previous.fadeOutBars = current.fadeOutBars;
    }

    return merged;
};

const ensureCompLane = (
    track: Track,
    idFactory: (prefix: string) => string
): { lanes: TakeLane[]; compLane: TakeLane } => {
    const lanes = (track.takeLanes || []).map(cloneTakeLane);

    let compLane = lanes.find((lane) => lane.id === track.activeCompLaneId && lane.isCompLane);
    if (!compLane) {
        compLane = lanes.find((lane) => lane.isCompLane);
    }

    if (!compLane) {
        compLane = {
            id: idFactory(COMP_LANE_ID_PREFIX),
            name: COMP_LANE_NAME,
            trackId: track.id,
            isCompLane: true,
            isMuted: false,
            takeIds: [],
            compSegments: []
        };
        lanes.push(compLane);
    }

    if (!compLane.compSegments) {
        compLane.compSegments = [];
    }

    return { lanes, compLane };
};

const buildCompClipFromSegment = (
    track: Track,
    sourceClipsById: Map<string, Clip>,
    segment: CompSegment
): Clip | null => {
    const take = (track.recordingTakes || []).find((item) => item.id === segment.takeId);
    if (!take) return null;

    const sourceClip = sourceClipsById.get(take.clipId);
    if (!sourceClip) return null;

    const segmentLength = Math.max(MIN_RANGE_BARS, segment.sourceEndBar - segment.sourceStartBar);
    const offsetInsideTake = Math.max(0, segment.sourceStartBar - take.startBar);
    const sourceOffset = Math.max(0, (sourceClip.offset || 0) + offsetInsideTake);

    return {
        ...sourceClip,
        id: `${COMP_CLIP_ID_PREFIX}${segment.id}`,
        name: sourceClip.name.startsWith('[COMP]') ? sourceClip.name : `[COMP] ${sourceClip.name}`,
        color: track.color,
        start: segment.targetStartBar,
        length: segmentLength,
        offset: sourceOffset,
        fadeIn: Math.max(0, segment.fadeInBars || 0),
        fadeOut: Math.max(0, segment.fadeOutBars || 0),
        notes: sourceClip.notes.map((note) => ({ ...note }))
    };
};

export const isCompDerivedClipId = (clipId: string): boolean => {
    return clipId.startsWith(COMP_CLIP_ID_PREFIX);
};

export const isCompDerivedClip = (clip: Clip): boolean => {
    return isCompDerivedClipId(clip.id);
};

const clampClipMutation = (clip: Clip, updates: Partial<Clip>): Partial<Clip> => {
    const nextStart = Object.prototype.hasOwnProperty.call(updates, 'start')
        ? Math.max(0, clampNumber(updates.start ?? clip.start, clip.start))
        : clip.start;
    const nextLength = Object.prototype.hasOwnProperty.call(updates, 'length')
        ? Math.max(MIN_RANGE_BARS, clampNumber(updates.length ?? clip.length, clip.length))
        : clip.length;
    const nextOffset = Object.prototype.hasOwnProperty.call(updates, 'offset')
        ? Math.max(0, clampNumber(updates.offset ?? (clip.offset || 0), clip.offset || 0))
        : (clip.offset || 0);
    const maxFadeBars = Math.max(MIN_RANGE_BARS, nextLength);

    const nextFadeIn = Object.prototype.hasOwnProperty.call(updates, 'fadeIn')
        ? Math.max(0, Math.min(maxFadeBars, clampNumber(updates.fadeIn ?? (clip.fadeIn || 0), clip.fadeIn || 0)))
        : (clip.fadeIn || 0);
    const nextFadeOut = Object.prototype.hasOwnProperty.call(updates, 'fadeOut')
        ? Math.max(0, Math.min(maxFadeBars, clampNumber(updates.fadeOut ?? (clip.fadeOut || 0), clip.fadeOut || 0)))
        : (clip.fadeOut || 0);

    return {
        ...updates,
        ...(Object.prototype.hasOwnProperty.call(updates, 'start') ? { start: nextStart } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'length') ? { length: nextLength } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'offset') ? { offset: nextOffset } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'fadeIn') ? { fadeIn: nextFadeIn } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'fadeOut') ? { fadeOut: nextFadeOut } : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'gain')
            ? { gain: Math.max(0, clampNumber(updates.gain ?? clip.gain, clip.gain)) }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'playbackRate')
            ? { playbackRate: Math.max(0.25, clampNumber(updates.playbackRate ?? clip.playbackRate, clip.playbackRate)) }
            : {}),
        ...(Object.prototype.hasOwnProperty.call(updates, 'transpose')
            ? { transpose: Math.round(clampNumber(updates.transpose ?? (clip.transpose || 0), clip.transpose || 0)) }
            : {})
    };
};

export const resolveTrackClipEditingContext = (track: Track, clipId: string): TrackClipEditingContext => {
    const clip = track.clips.find((candidate) => candidate.id === clipId) || null;
    const isCompClip = isCompDerivedClipId(clipId);
    const take = (track.recordingTakes || []).find((candidate) => candidate.clipId === clipId);
    const takeLane = take
        ? (track.takeLanes || []).find((lane) => lane.id === take.laneId)
        : undefined;

    if (!isCompClip) {
        return {
            clip,
            isCompClip: false,
            isTakeClip: Boolean(take),
            take,
            takeLane
        };
    }

    const segmentId = clipId.slice(COMP_CLIP_ID_PREFIX.length);
    const compLane = (track.takeLanes || []).find((lane) => lane.compSegments?.some((segment) => segment.id === segmentId));
    const compSegment = compLane?.compSegments?.find((segment) => segment.id === segmentId);
    const sourceTake = compSegment
        ? (track.recordingTakes || []).find((candidate) => candidate.id === compSegment.takeId)
        : undefined;

    return {
        clip,
        isCompClip: true,
        isTakeClip: false,
        take: sourceTake,
        takeLane: sourceTake ? (track.takeLanes || []).find((lane) => lane.id === sourceTake.laneId) : undefined,
        compLane,
        compSegment
    };
};

export const normalizePunchRange = (range?: PunchRange): PunchRange => {
    const safeIn = Math.max(1, clampNumber(range?.inBar ?? DEFAULT_PUNCH_RANGE.inBar, DEFAULT_PUNCH_RANGE.inBar));
    const safeOutCandidate = Math.max(1, clampNumber(range?.outBar ?? DEFAULT_PUNCH_RANGE.outBar, DEFAULT_PUNCH_RANGE.outBar));
    const safeOut = Math.max(safeIn + MIN_RANGE_BARS, safeOutCandidate);

    return {
        enabled: Boolean(range?.enabled),
        inBar: safeIn,
        outBar: safeOut,
        preRollBars: Math.max(0, clampNumber(range?.preRollBars ?? DEFAULT_PUNCH_RANGE.preRollBars!, DEFAULT_PUNCH_RANGE.preRollBars!)),
        countInBars: Math.max(0, clampNumber(range?.countInBars ?? DEFAULT_PUNCH_RANGE.countInBars!, DEFAULT_PUNCH_RANGE.countInBars!))
    };
};

export const updateTrackPunchRange = (track: Track, updates: Partial<PunchRange>): Track => {
    const current = normalizePunchRange(track.punchRange);
    return {
        ...track,
        punchRange: normalizePunchRange({
            ...current,
            ...updates
        })
    };
};

export const resolvePunchRecordingPlan = (armedTracks: Track[]): PunchRecordingPlan | null => {
    const enabledRanges = armedTracks
        .filter((track) => track.type === TrackType.AUDIO)
        .map((track) => normalizePunchRange(track.punchRange))
        .filter((range) => range.enabled && (range.outBar - range.inBar) >= MIN_RANGE_BARS);

    if (enabledRanges.length === 0) {
        return null;
    }

    const punchInBar = Math.min(...enabledRanges.map((range) => range.inBar));
    const punchOutBar = Math.max(...enabledRanges.map((range) => range.outBar));
    const preRollBars = Math.max(...enabledRanges.map((range) => range.preRollBars || 0));
    const countInBars = Math.max(...enabledRanges.map((range) => range.countInBars || 0));
    const startPlaybackBar = Math.max(1, punchInBar - preRollBars - countInBars);

    return {
        punchInBar,
        punchOutBar,
        preRollBars,
        countInBars,
        startPlaybackBar,
        sourceTrimOffsetBars: Math.max(0, punchInBar - startPlaybackBar)
    };
};

export const shouldFinalizePunchRecording = (
    currentBar: number,
    activeRecordingTrackIds: string[],
    sessionMetaByTrackId: Map<string, PunchRecordingSessionMetaLike>
): { shouldFinalize: boolean; targetPunchOutBar: number | null } => {
    if (!Number.isFinite(currentBar) || activeRecordingTrackIds.length === 0) {
        return {
            shouldFinalize: false,
            targetPunchOutBar: null
        };
    }

    const punchOutBars = activeRecordingTrackIds
        .map((trackId) => sessionMetaByTrackId.get(trackId)?.punchOutBar)
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (punchOutBars.length === 0) {
        return {
            shouldFinalize: false,
            targetPunchOutBar: null
        };
    }

    const targetPunchOutBar = Math.max(...punchOutBars);
    return {
        shouldFinalize: currentBar >= targetPunchOutBar - 0.0005,
        targetPunchOutBar
    };
};

export const rebuildCompDerivedClips = (track: Track): Track => {
    const nonCompClips = track.clips.filter((clip) => !isCompDerivedClip(clip));
    const compLane = (track.takeLanes || []).find((lane) => lane.id === track.activeCompLaneId && lane.isCompLane)
        || (track.takeLanes || []).find((lane) => lane.isCompLane);

    if (!compLane || !compLane.compSegments || compLane.compSegments.length === 0) {
        if (nonCompClips.length === track.clips.length) {
            return track;
        }

        return {
            ...track,
            clips: nonCompClips
        };
    }

    const sourceClipsById = new Map(nonCompClips.map((clip) => [clip.id, clip]));
    const compSegments = mergeCompSegments(compLane.compSegments);
    const derivedCompClips = compSegments
        .map((segment) => buildCompClipFromSegment(track, sourceClipsById, segment))
        .filter((clip): clip is Clip => Boolean(clip));

    const nextClips = [...nonCompClips, ...derivedCompClips].sort((left, right) => left.start - right.start);

    const nextTakeLanes = (track.takeLanes || []).map((lane) => {
        if (lane.id !== compLane.id) return lane;
        return {
            ...lane,
            compSegments
        };
    });

    return {
        ...track,
        clips: nextClips,
        takeLanes: nextTakeLanes,
        activeCompLaneId: compLane.id
    };
};

export const promoteTakeToComp = (
    track: Track,
    takeId: string,
    options: PromoteTakeToCompOptions = {}
): Track => {
    const take = (track.recordingTakes || []).find((item) => item.id === takeId);
    if (!take) {
        return track;
    }

    const sourceClip = track.clips.find((clip) => clip.id === take.clipId);
    if (!sourceClip) {
        return track;
    }

    const idFactory = options.idFactory || buildRuntimeId;
    const { lanes, compLane } = ensureCompLane(track, idFactory);

    const takeStart = take.startBar;
    const takeEnd = take.startBar + take.lengthBars;
    const sourceStartBar = Math.max(takeStart, clampNumber(options.sourceStartBar ?? takeStart, takeStart));
    const sourceEndBar = Math.min(takeEnd, clampNumber(options.sourceEndBar ?? takeEnd, takeEnd));

    if ((sourceEndBar - sourceStartBar) < MIN_RANGE_BARS) {
        return track;
    }

    const targetStartBar = clampNumber(options.targetStartBar ?? sourceStartBar, sourceStartBar);

    const newSegment: CompSegment = {
        id: idFactory(COMP_SEGMENT_ID_PREFIX),
        takeId,
        sourceStartBar,
        sourceEndBar,
        targetStartBar,
        fadeInBars: Math.max(0, options.fadeInBars || 0),
        fadeOutBars: Math.max(0, options.fadeOutBars || 0)
    };

    const nextSegments = options.replaceExisting
        ? [newSegment]
        : [...(compLane.compSegments || []), newSegment];

    const normalizedSegments = mergeCompSegments(nextSegments);

    const nextTakeLanes = lanes.map((lane) => {
        if (lane.id !== compLane.id) return lane;
        return {
            ...lane,
            compSegments: normalizedSegments
        };
    });

    return rebuildCompDerivedClips({
        ...track,
        takeLanes: nextTakeLanes,
        activeCompLaneId: compLane.id
    });
};

export const applyCompClipEdits = (track: Track, compClipId: string, updates: Partial<Clip>): Track => {
    if (!isCompDerivedClipId(compClipId)) {
        return track;
    }

    const targetClip = track.clips.find((clip) => clip.id === compClipId);
    if (!targetClip) {
        return track;
    }

    const segmentId = compClipId.slice(COMP_CLIP_ID_PREFIX.length);
    let didUpdate = false;

    const nextTakeLanes = (track.takeLanes || []).map((lane) => {
        if (!lane.compSegments || lane.compSegments.length === 0) {
            return lane;
        }

        const nextSegments = lane.compSegments.map((segment) => {
            if (segment.id !== segmentId) {
                return { ...segment };
            }

            const take = (track.recordingTakes || []).find((item) => item.id === segment.takeId);
            if (!take) {
                return { ...segment };
            }

            const sourceClip = track.clips.find((clip) => clip.id === take.clipId && !isCompDerivedClip(clip));
            if (!sourceClip) {
                return { ...segment };
            }

            const takeStart = take.startBar;
            const takeEnd = take.startBar + take.lengthBars;
            const sourceOffsetInTake = Math.max(0, segment.sourceStartBar - take.startBar);
            const expectedOffset = (sourceClip.offset || 0) + sourceOffsetInTake;

            const requestedOffset = clampNumber(updates.offset ?? targetClip.offset, expectedOffset);
            const sourceShift = requestedOffset - expectedOffset;

            let nextSourceStart = segment.sourceStartBar + sourceShift;
            let nextTargetStart = clampNumber(updates.start ?? segment.targetStartBar, segment.targetStartBar);
            const requestedLength = clampNumber(updates.length ?? (segment.sourceEndBar - segment.sourceStartBar), segment.sourceEndBar - segment.sourceStartBar);
            let nextSourceEnd = nextSourceStart + Math.max(MIN_RANGE_BARS, requestedLength);

            if (nextSourceStart < takeStart) {
                const correction = takeStart - nextSourceStart;
                nextSourceStart = takeStart;
                nextTargetStart += correction;
            }
            if (nextSourceEnd > takeEnd) {
                nextSourceEnd = takeEnd;
            }
            if ((nextSourceEnd - nextSourceStart) < MIN_RANGE_BARS) {
                nextSourceEnd = Math.min(takeEnd, nextSourceStart + MIN_RANGE_BARS);
            }

            const segmentLength = Math.max(MIN_RANGE_BARS, nextSourceEnd - nextSourceStart);
            const nextFadeIn = Object.prototype.hasOwnProperty.call(updates, 'fadeIn')
                ? Math.max(0, Math.min(segmentLength, clampNumber(updates.fadeIn ?? segment.fadeInBars ?? 0, segment.fadeInBars ?? 0)))
                : (segment.fadeInBars ?? 0);
            const nextFadeOut = Object.prototype.hasOwnProperty.call(updates, 'fadeOut')
                ? Math.max(0, Math.min(segmentLength, clampNumber(updates.fadeOut ?? segment.fadeOutBars ?? 0, segment.fadeOutBars ?? 0)))
                : (segment.fadeOutBars ?? 0);

            didUpdate = true;
            return {
                ...segment,
                sourceStartBar: nextSourceStart,
                sourceEndBar: nextSourceEnd,
                targetStartBar: nextTargetStart,
                fadeInBars: nextFadeIn,
                fadeOutBars: nextFadeOut
            };
        });

        return {
            ...lane,
            compSegments: mergeCompSegments(nextSegments)
        };
    });

    if (!didUpdate) {
        return track;
    }

    return rebuildCompDerivedClips({
        ...track,
        takeLanes: nextTakeLanes
    });
};

export const applyTrackClipEdits = (track: Track, clipId: string, updates: Partial<Clip>): Track => {
    if (isCompDerivedClipId(clipId)) {
        return applyCompClipEdits(track, clipId, updates);
    }

    let clipChanged = false;
    const nextClips = track.clips.map((clip) => {
        if (clip.id !== clipId) return clip;
        clipChanged = true;
        return {
            ...clip,
            ...clampClipMutation(clip, updates)
        };
    });

    let sessionClipChanged = false;
    const nextSessionClips = track.sessionClips.map((slot) => {
        if (!slot.clip || slot.clip.id !== clipId) return slot;
        sessionClipChanged = true;
        return {
            ...slot,
            clip: {
                ...slot.clip,
                ...clampClipMutation(slot.clip, updates)
            }
        };
    });

    if (!clipChanged && !sessionClipChanged) {
        return track;
    }

    const updatedTrack: Track = {
        ...track,
        clips: nextClips,
        sessionClips: nextSessionClips
    };

    return syncTakeMetadataForClip(updatedTrack, clipId);
};

export const syncTakeMetadataForClip = (track: Track, clipId: string): Track => {
    const sourceTakeIndex = (track.recordingTakes || []).findIndex((take) => take.clipId === clipId);
    if (sourceTakeIndex < 0) {
        return track;
    }

    const sourceClip = track.clips.find((clip) => clip.id === clipId);
    if (!sourceClip) {
        return track;
    }

    const nextTake = {
        ...(track.recordingTakes || [])[sourceTakeIndex],
        startBar: sourceClip.start,
        lengthBars: sourceClip.length,
        offsetBars: sourceClip.offset || 0
    };

    const nextRecordingTakes = [...(track.recordingTakes || [])];
    nextRecordingTakes[sourceTakeIndex] = nextTake;

    const takeStart = nextTake.startBar;
    const takeEnd = nextTake.startBar + nextTake.lengthBars;

    const nextTakeLanes = (track.takeLanes || []).map((lane) => {
        if (!lane.compSegments || lane.compSegments.length === 0) {
            return lane;
        }

        const adjustedSegments = lane.compSegments.flatMap((segment) => {
            if (segment.takeId !== nextTake.id) {
                return [{ ...segment }];
            }

            const clampedSourceStart = Math.max(takeStart, segment.sourceStartBar);
            const clampedSourceEnd = Math.min(takeEnd, segment.sourceEndBar);
            if ((clampedSourceEnd - clampedSourceStart) < MIN_RANGE_BARS) {
                return [];
            }

            const sourceDelta = clampedSourceStart - segment.sourceStartBar;
            return [{
                ...segment,
                sourceStartBar: clampedSourceStart,
                sourceEndBar: clampedSourceEnd,
                targetStartBar: segment.targetStartBar + sourceDelta
            }];
        });

        return {
            ...lane,
            compSegments: mergeCompSegments(adjustedSegments)
        };
    });

    return rebuildCompDerivedClips({
        ...track,
        recordingTakes: nextRecordingTakes,
        takeLanes: nextTakeLanes
    });
};

export const splitTakeForClip = (
    track: Track,
    sourceClipId: string,
    leftClip: Clip,
    rightClip: Clip,
    idFactory: (prefix: string) => string = buildRuntimeId
): Track => {
    const sourceTakeIndex = (track.recordingTakes || []).findIndex((take) => take.clipId === sourceClipId);
    if (sourceTakeIndex < 0) {
        return track;
    }

    const sourceTake = (track.recordingTakes || [])[sourceTakeIndex];
    const splitBar = rightClip.start;

    const leftTake = {
        ...sourceTake,
        clipId: leftClip.id,
        startBar: leftClip.start,
        lengthBars: leftClip.length,
        offsetBars: leftClip.offset || 0
    };

    const rightTake = {
        ...sourceTake,
        id: idFactory('take-split'),
        clipId: rightClip.id,
        startBar: rightClip.start,
        lengthBars: rightClip.length,
        offsetBars: rightClip.offset || 0,
        label: sourceTake.label ? `${sourceTake.label} B` : undefined,
        createdAt: Date.now()
    };

    const nextRecordingTakes = [...(track.recordingTakes || [])];
    nextRecordingTakes.splice(sourceTakeIndex, 1, leftTake, rightTake);

    const nextTakeLanes = (track.takeLanes || []).map((lane) => {
        const sourceTakePosition = lane.takeIds.indexOf(sourceTake.id);
        const nextTakeIds = sourceTakePosition < 0
            ? [...lane.takeIds]
            : [
                ...lane.takeIds.slice(0, sourceTakePosition),
                leftTake.id,
                rightTake.id,
                ...lane.takeIds.slice(sourceTakePosition + 1)
            ];

        if (!lane.compSegments || lane.compSegments.length === 0) {
            return {
                ...lane,
                takeIds: nextTakeIds
            };
        }

        const splitSegments = lane.compSegments.flatMap((segment) => {
            if (segment.takeId !== sourceTake.id) {
                return [{ ...segment }];
            }

            if (segment.sourceEndBar <= splitBar + EPSILON) {
                return [{ ...segment, takeId: leftTake.id }];
            }

            if (segment.sourceStartBar >= splitBar - EPSILON) {
                return [{ ...segment, takeId: rightTake.id }];
            }

            const leftLength = splitBar - segment.sourceStartBar;
            const rightLength = segment.sourceEndBar - splitBar;

            const leftSegment: CompSegment = {
                ...segment,
                takeId: leftTake.id,
                sourceEndBar: splitBar,
                fadeOutBars: segment.fadeOutBars ? Math.min(segment.fadeOutBars, leftLength) : segment.fadeOutBars
            };

            const rightSegment: CompSegment = {
                ...segment,
                id: idFactory('comp-split'),
                takeId: rightTake.id,
                sourceStartBar: splitBar,
                targetStartBar: segment.targetStartBar + leftLength,
                fadeInBars: segment.fadeInBars ? Math.min(segment.fadeInBars, rightLength) : segment.fadeInBars
            };

            return [leftSegment, rightSegment];
        });

        return {
            ...lane,
            takeIds: nextTakeIds,
            compSegments: mergeCompSegments(splitSegments)
        };
    });

    return rebuildCompDerivedClips({
        ...track,
        recordingTakes: nextRecordingTakes,
        takeLanes: nextTakeLanes
    });
};
