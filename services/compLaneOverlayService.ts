import { CompSegment, TakeLane, Track } from '../types';
import { COMP_CLIP_ID_PREFIX } from './takeCompingService';

const MIN_COMP_SEGMENT_BARS = 1 / 1024;
const DEFAULT_VIEWPORT_PADDING_PX = 300;

export interface CompSegmentOverlayModel {
    id: string;
    segment: CompSegment;
    leftPx: number;
    widthPx: number;
    takeAlias: string;
    takeLabel: string | null;
    isMutedTake: boolean;
}

export interface CompBoundaryBlendHandleModel {
    id: string;
    leftSegmentId: string;
    rightSegmentId: string;
    leftClipId: string;
    rightClipId: string;
    boundaryBar: number;
    boundaryLeftPx: number;
    maxFadeBars: number;
    currentFadeBars: number;
    currentLeftFadeOutBars: number;
    currentRightFadeInBars: number;
    overlayLeftPx: number;
    overlayWidthPx: number;
}

export interface CompLaneOverlayModel {
    laneId: string | null;
    laneName: string | null;
    isActiveLane: boolean;
    visibleSegments: CompSegmentOverlayModel[];
    boundaryHandles: CompBoundaryBlendHandleModel[];
}

interface BuildCompLaneOverlayModelParams {
    track: Track;
    zoom: number;
    viewportLeftPx: number;
    viewportWidthPx: number;
    viewportPaddingPx?: number;
}

const resolveCompLane = (track: Track): TakeLane | null => {
    const lanes = track.takeLanes || [];
    const selectedLane = lanes.find((lane) => lane.id === track.activeCompLaneId && lane.isCompLane);
    if (selectedLane) return selectedLane;
    return lanes.find((lane) => lane.isCompLane) || null;
};

const resolveSegmentLengthBars = (segment: CompSegment): number => {
    const length = Number.isFinite(segment.sourceEndBar - segment.sourceStartBar)
        ? segment.sourceEndBar - segment.sourceStartBar
        : MIN_COMP_SEGMENT_BARS;
    return Math.max(MIN_COMP_SEGMENT_BARS, length);
};

const resolveTakeAlias = (takeId: string): string => {
    const alias = takeId.split('-').pop();
    if (alias && alias.length > 0) return alias;
    return takeId;
};

export const buildCompLaneOverlayModel = ({
    track,
    zoom,
    viewportLeftPx,
    viewportWidthPx,
    viewportPaddingPx = DEFAULT_VIEWPORT_PADDING_PX
}: BuildCompLaneOverlayModelParams): CompLaneOverlayModel => {
    const compLane = resolveCompLane(track);
    const compSegments = compLane?.compSegments || [];
    const isActiveLane = Boolean(compLane && (!track.activeCompLaneId || track.activeCompLaneId === compLane.id));

    if (!compLane || compSegments.length === 0 || !Number.isFinite(zoom) || zoom <= 0) {
        return {
            laneId: compLane?.id || null,
            laneName: compLane?.name || null,
            isActiveLane,
            visibleSegments: [],
            boundaryHandles: []
        };
    }

    const paddedStartPx = Math.max(0, viewportLeftPx - viewportPaddingPx);
    const paddedEndPx = viewportLeftPx + viewportWidthPx + viewportPaddingPx;

    const sortedSegments = [...compSegments].sort((left, right) => left.targetStartBar - right.targetStartBar);
    const takeById = new Map((track.recordingTakes || []).map((take) => [take.id, take]));
    const derivedClipIds = new Set(track.clips.map((clip) => clip.id));

    const visibleSegments = sortedSegments
        .map((segment) => {
            const segmentLengthBars = resolveSegmentLengthBars(segment);
            const leftPx = (segment.targetStartBar - 1) * 4 * zoom;
            const widthPx = segmentLengthBars * 4 * zoom;
            const take = takeById.get(segment.takeId);
            return {
                id: segment.id,
                segment,
                leftPx,
                widthPx,
                takeAlias: take?.label || resolveTakeAlias(segment.takeId),
                takeLabel: take?.label || null,
                isMutedTake: Boolean(take?.muted)
            };
        })
        .filter((segment) => (segment.leftPx + segment.widthPx) > paddedStartPx && segment.leftPx < paddedEndPx);

    const boundaryHandles: CompBoundaryBlendHandleModel[] = [];
    for (let index = 0; index < sortedSegments.length - 1; index += 1) {
        const leftSegment = sortedSegments[index];
        const rightSegment = sortedSegments[index + 1];
        const boundaryBar = rightSegment.targetStartBar;
        const boundaryLeftPx = (boundaryBar - 1) * 4 * zoom;
        if (boundaryLeftPx < paddedStartPx - 48 || boundaryLeftPx > paddedEndPx + 48) {
            continue;
        }

        const leftLengthBars = resolveSegmentLengthBars(leftSegment);
        const rightLengthBars = resolveSegmentLengthBars(rightSegment);
        const maxFadeBars = Math.max(MIN_COMP_SEGMENT_BARS, Math.min(leftLengthBars, rightLengthBars));
        const currentLeftFadeOutBars = Math.max(0, leftSegment.fadeOutBars || 0);
        const currentRightFadeInBars = Math.max(0, rightSegment.fadeInBars || 0);
        const currentFadeBars = Math.max(0, Math.min(maxFadeBars, Math.max(currentLeftFadeOutBars, currentRightFadeInBars)));

        const leftClipId = `${COMP_CLIP_ID_PREFIX}${leftSegment.id}`;
        const rightClipId = `${COMP_CLIP_ID_PREFIX}${rightSegment.id}`;
        if (!derivedClipIds.has(leftClipId) || !derivedClipIds.has(rightClipId)) {
            continue;
        }

        boundaryHandles.push({
            id: `comp-boundary-${leftSegment.id}-${rightSegment.id}`,
            leftSegmentId: leftSegment.id,
            rightSegmentId: rightSegment.id,
            leftClipId,
            rightClipId,
            boundaryBar,
            boundaryLeftPx,
            maxFadeBars,
            currentFadeBars,
            currentLeftFadeOutBars,
            currentRightFadeInBars,
            overlayLeftPx: boundaryLeftPx - (currentFadeBars * 4 * zoom),
            overlayWidthPx: Math.max(0, currentFadeBars * 8 * zoom)
        });
    }

    return {
        laneId: compLane.id,
        laneName: compLane.name,
        isActiveLane,
        visibleSegments,
        boundaryHandles
    };
};

