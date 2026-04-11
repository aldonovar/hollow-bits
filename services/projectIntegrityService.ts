import {
    AudioSettings,
    AutomationLane,
    AutomationMode,
    Clip,
    ClipSlot,
    CompSegment,
    Device,
    Note,
    ProjectData,
    PunchRange,
    RecordingTake,
    ScoreConfidenceRegion,
    ScoreLayoutPreferences,
    ScoreNotationOverride,
    ScoreWorkspaceMode,
    ScoreWorkspaceState,
    ScoreHand,
    TakeLane,
    Track,
    TrackType,
    TransportState
} from '../types';
import { sanitizeAudioSettingsCandidate } from './audioSettingsNormalizer';
import { withTrackRuntimeDefaults } from './projectCoreService';
import { rebuildCompDerivedClips, isCompDerivedClipId, normalizePunchRange } from './takeCompingService';

const DEFAULT_PROJECT_VERSION = '3.0-reference';
const DEFAULT_TRACK_COLOR = '#B34BE4';
const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
    sampleRate: 48000,
    bufferSize: 'auto',
    latencyHint: 'interactive'
};
const DEFAULT_TRANSPORT: TransportState = {
    isPlaying: false,
    isRecording: false,
    loopMode: 'off',
    bpm: 124,
    timeSignature: [4, 4],
    currentBar: 1,
    currentBeat: 1,
    currentSixteenth: 1,
    masterTranspose: 0,
    gridSize: 0.25,
    snapToGrid: true,
    scaleRoot: 0,
    scaleType: 'minor'
};
const MIN_CLIP_LENGTH_BARS = 1 / 1024;
const MIN_NOTE_DURATION = 1;
const DEFAULT_TRACK_NAMES: Record<TrackType, string> = {
    [TrackType.AUDIO]: 'Audio',
    [TrackType.MIDI]: 'MIDI',
    [TrackType.GROUP]: 'Group',
    [TrackType.RETURN]: 'Return',
    [TrackType.MASTER]: 'Master'
};
const VALID_MONITOR_MODES = new Set<Track['monitor']>(['in', 'auto', 'off']);
const VALID_DEVICE_TYPES = new Set<Device['type']>(['instrument', 'effect', 'eq', 'vst-loader']);
const VALID_AUTOMATION_MODES = new Set<AutomationMode>(['off', 'read', 'touch', 'latch', 'write']);
const VALID_AUTOMATION_PARAMS = new Set<AutomationLane['param']>([
    'volume',
    'pan',
    'mute',
    'filterCutoff',
    'filterResonance',
    'reverb',
    'custom'
]);
const VALID_CURVE_TYPES = new Set(['linear', 'easeIn', 'easeOut', 'sCurve', 'hold']);
const VALID_SCALE_TYPES = new Set<TransportState['scaleType']>([
    'major',
    'minor',
    'dorian',
    'phrygian',
    'chromatic',
    'pentatonic-major',
    'pentatonic-minor'
]);
const VALID_SCORE_MODES = new Set<ScoreWorkspaceMode>(['score', 'transcribe', 'correct', 'compare']);
const VALID_SCORE_HANDS = new Set<ScoreHand>(['left', 'right']);

export type ProjectIntegritySeverity = 'warning' | 'error';

export interface ProjectIntegrityIssue {
    severity: ProjectIntegritySeverity;
    code: string;
    message: string;
    repaired: boolean;
    trackId?: string;
    clipId?: string;
}

export interface ProjectIntegrityReport {
    source: string;
    issueCount: number;
    errorCount: number;
    warningCount: number;
    repaired: boolean;
    issues: ProjectIntegrityIssue[];
}

export interface ProjectIntegrityResult {
    project: ProjectData;
    report: ProjectIntegrityReport;
}

export class ProjectIntegrityError extends Error {
    report: ProjectIntegrityReport;

    constructor(message: string, report?: ProjectIntegrityReport) {
        super(message);
        this.name = 'ProjectIntegrityError';
        this.report = report || {
            source: 'unknown',
            issueCount: 1,
            errorCount: 1,
            warningCount: 0,
            repaired: false,
            issues: [{
                severity: 'error',
                code: 'project.invalid-shape',
                message,
                repaired: false
            }]
        };
    }
}

interface RepairProjectDataOptions {
    source?: string;
    now?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const asFiniteNumber = (value: unknown, fallback: number): number => isFiniteNumber(value) ? value : fallback;
const asNonEmptyString = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const ensureUniqueId = (
    candidate: unknown,
    usedIds: Set<string>,
    fallbackPrefix: string,
    issues: ProjectIntegrityIssue[],
    issueBase: Omit<ProjectIntegrityIssue, 'message' | 'severity' | 'repaired' | 'code'>
): string => {
    const rawId = asNonEmptyString(candidate);
    let nextId = rawId || fallbackPrefix;

    if (!rawId) {
        issues.push({
            ...issueBase,
            severity: 'warning',
            code: `${fallbackPrefix}.missing-id`,
            message: `Se genero un ID nuevo para ${fallbackPrefix}.`,
            repaired: true
        });
    }

    if (!usedIds.has(nextId)) {
        usedIds.add(nextId);
        return nextId;
    }

    let suffix = 2;
    while (usedIds.has(`${nextId}-${suffix}`)) {
        suffix += 1;
    }

    const repairedId = `${nextId}-${suffix}`;
    usedIds.add(repairedId);
    issues.push({
        ...issueBase,
        severity: 'error',
        code: `${fallbackPrefix}.duplicate-id`,
        message: `ID duplicado detectado (${nextId}). Se reparo como ${repairedId}.`,
        repaired: true
    });
    return repairedId;
};

const sanitizeColor = (value: unknown, fallback: string): string => asNonEmptyString(value) || fallback;

const sanitizeTrackType = (
    value: unknown,
    index: number,
    issues: ProjectIntegrityIssue[],
    trackId?: string
): TrackType => {
    if (value && Object.values(TrackType).includes(value as TrackType)) {
        return value as TrackType;
    }

    issues.push({
        severity: 'warning',
        code: 'track.invalid-type',
        message: `Track ${index + 1} tenia un tipo invalido y fue reparado como AUDIO.`,
        repaired: true,
        trackId
    });
    return TrackType.AUDIO;
};

const sanitizeNotes = (candidate: unknown): Note[] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .filter(isRecord)
        .map((note) => ({
            pitch: clamp(Math.round(asFiniteNumber(note.pitch, 60)), 0, 127),
            start: Math.max(0, asFiniteNumber(note.start, 0)),
            duration: Math.max(MIN_NOTE_DURATION, asFiniteNumber(note.duration, MIN_NOTE_DURATION)),
            velocity: clamp(Math.round(asFiniteNumber(note.velocity, 96)), 1, 127)
        }))
        .sort((left, right) => left.start - right.start || left.pitch - right.pitch);
};

const sanitizeScoreLayoutPreferences = (candidate: unknown): ScoreLayoutPreferences => {
    const input = isRecord(candidate) ? candidate : {};
    return {
        splitRatio: clamp(asFiniteNumber(input.splitRatio, 0.66), 0.3, 0.82),
        followTransport: typeof input.followTransport === 'boolean' ? input.followTransport : true,
        zoom: clamp(asFiniteNumber(input.zoom, 1), 0.6, 2.4)
    };
};

const sanitizeScoreNotationOverrides = (candidate: unknown): ScoreNotationOverride[] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .filter(isRecord)
        .map((override, index) => ({
            id: asNonEmptyString(override.id) || `score-override-${index + 1}`,
            noteKey: asNonEmptyString(override.noteKey) || `note-${index + 1}`,
            hand: VALID_SCORE_HANDS.has(override.hand as ScoreHand) ? override.hand as ScoreHand : undefined,
            spelling: asNonEmptyString(override.spelling) || undefined,
            voice: Math.max(1, Math.round(asFiniteNumber(override.voice, 1))) || undefined,
            tieStart: typeof override.tieStart === 'boolean' ? override.tieStart : undefined,
            tieEnd: typeof override.tieEnd === 'boolean' ? override.tieEnd : undefined,
            pedal: typeof override.pedal === 'boolean' ? override.pedal : undefined
        }));
};

const sanitizeScoreConfidenceRegions = (candidate: unknown): ScoreConfidenceRegion[] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .filter(isRecord)
        .map((region, index) => {
            const start16th = Math.max(0, asFiniteNumber(region.start16th, 0));
            const end16th = Math.max(start16th, asFiniteNumber(region.end16th, start16th));
            return {
                id: asNonEmptyString(region.id) || `score-confidence-${index + 1}`,
                start16th,
                end16th,
                confidence: clamp(asFiniteNumber(region.confidence, 0.75), 0, 1),
                label: asNonEmptyString(region.label) || undefined
            };
        });
};

const sanitizeScoreWorkspaces = (candidate: unknown): ScoreWorkspaceState[] => {
    if (!Array.isArray(candidate)) return [];

    const usedIds = new Set<string>();
    const sanitized: ScoreWorkspaceState[] = [];

    candidate.filter(isRecord).forEach((workspace, index) => {
        const source = isRecord(workspace.source) ? workspace.source : {};
        const sourceTrackId = asNonEmptyString(source.trackId);
        const sourceClipId = asNonEmptyString(source.clipId);
        if (!sourceTrackId || !sourceClipId) {
            return;
        }

        const kind: ScoreWorkspaceState['source']['kind'] = source.kind === 'audio-derived' ? 'audio-derived' : 'midi';
        sanitized.push({
            id: ensureUniqueId(
                workspace.id,
                usedIds,
                `score-workspace-${index + 1}`,
                [],
                {}
            ),
            title: asNonEmptyString(workspace.title) || `Piano Score ${index + 1}`,
            mode: VALID_SCORE_MODES.has(workspace.mode as ScoreWorkspaceMode)
                ? workspace.mode as ScoreWorkspaceMode
                : (kind === 'audio-derived' ? 'transcribe' : 'score'),
            source: {
                kind,
                trackId: sourceTrackId,
                clipId: sourceClipId,
                derivedMidiTrackId: asNonEmptyString(source.derivedMidiTrackId) || undefined,
                derivedMidiClipId: asNonEmptyString(source.derivedMidiClipId) || undefined
            },
            layout: sanitizeScoreLayoutPreferences(workspace.layout),
            notationOverrides: sanitizeScoreNotationOverrides(workspace.notationOverrides),
            confidenceRegions: sanitizeScoreConfidenceRegions(workspace.confidenceRegions),
            lastAverageConfidence: isFiniteNumber(workspace.lastAverageConfidence)
                ? clamp(Number(workspace.lastAverageConfidence), 0, 1)
                : undefined,
            updatedAt: Math.max(0, asFiniteNumber(workspace.updatedAt, Date.now()))
        });
    });

    return sanitized;
};

const sanitizeClip = (
    candidate: unknown,
    index: number,
    track: { id: string; color: string; type: TrackType },
    usedIds: Set<string>,
    issues: ProjectIntegrityIssue[]
): Clip | null => {
    if (!isRecord(candidate)) {
        issues.push({
            severity: 'warning',
            code: 'clip.invalid-shape',
            message: `Se descarto un clip invalido en ${track.id}.`,
            repaired: true,
            trackId: track.id
        });
        return null;
    }

    const clipId = ensureUniqueId(candidate.id, usedIds, `clip-${index + 1}`, issues, { trackId: track.id });
    const length = Math.max(MIN_CLIP_LENGTH_BARS, asFiniteNumber(candidate.length, 1));

    return {
        id: clipId,
        name: asNonEmptyString(candidate.name) || `Clip ${index + 1}`,
        color: sanitizeColor(candidate.color, track.color),
        notes: sanitizeNotes(candidate.notes),
        start: Math.max(1, asFiniteNumber(candidate.start, 1)),
        length,
        offset: Math.max(0, asFiniteNumber(candidate.offset, 0)),
        fadeIn: clamp(Math.max(0, asFiniteNumber(candidate.fadeIn, 0)), 0, length),
        fadeOut: clamp(Math.max(0, asFiniteNumber(candidate.fadeOut, 0)), 0, length),
        gain: clamp(asFiniteNumber(candidate.gain, 1), 0, 4),
        playbackRate: Math.max(0.01, asFiniteNumber(candidate.playbackRate, 1)),
        originalBpm: isFiniteNumber(candidate.originalBpm) && candidate.originalBpm > 0 ? candidate.originalBpm : undefined,
        isWarped: Boolean(candidate.isWarped),
        transpose: asFiniteNumber(candidate.transpose, 0),
        sourceId: asNonEmptyString(candidate.sourceId) || undefined
    };
};

const sanitizeDeviceParams = (candidate: unknown): Device['params'] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .filter(isRecord)
        .map((param, index) => ({
            name: asNonEmptyString(param.name) || `Param ${index + 1}`,
            value: asFiniteNumber(param.value, 0),
            min: asFiniteNumber(param.min, 0),
            max: asFiniteNumber(param.max, 1),
            unit: asNonEmptyString(param.unit) || undefined
        }));
};

const sanitizeDevices = (candidate: unknown): Device[] => {
    if (!Array.isArray(candidate)) return [];

    return candidate
        .filter(isRecord)
        .map((device, index) => ({
            id: asNonEmptyString(device.id) || `device-${index + 1}`,
            name: asNonEmptyString(device.name) || `Device ${index + 1}`,
            type: VALID_DEVICE_TYPES.has(device.type as Device['type']) ? device.type as Device['type'] : 'effect',
            params: sanitizeDeviceParams(device.params)
        }));
};

const sanitizeAutomationLanes = (candidate: unknown, trackColor: string): AutomationLane[] | undefined => {
    if (!Array.isArray(candidate)) return undefined;

    const usedLaneIds = new Set<string>();
    const sanitized = candidate
        .filter(isRecord)
        .map((lane, index) => ({
            id: ensureUniqueId(lane.id, usedLaneIds, `auto-${index + 1}`, [], {}),
            param: VALID_AUTOMATION_PARAMS.has(lane.param as AutomationLane['param'])
                ? lane.param as AutomationLane['param']
                : 'custom',
            paramName: asNonEmptyString(lane.paramName) || `Automation ${index + 1}`,
            color: sanitizeColor(lane.color, trackColor),
            isExpanded: Boolean(lane.isExpanded),
            minValue: isFiniteNumber(lane.minValue) ? Number(lane.minValue) : undefined,
            maxValue: isFiniteNumber(lane.maxValue) ? Number(lane.maxValue) : undefined,
            points: Array.isArray(lane.points)
                ? lane.points
                    .filter(isRecord)
                    .map((point, pointIndex) => ({
                        id: asNonEmptyString(point.id) || `point-${pointIndex + 1}`,
                        time: Math.max(0, asFiniteNumber(point.time, 0)),
                        value: clamp(asFiniteNumber(point.value, 0), 0, 1),
                        curveType: typeof point.curveType === 'string' && VALID_CURVE_TYPES.has(point.curveType)
                            ? point.curveType as AutomationLane['points'][number]['curveType']
                            : 'linear',
                        tangentIn: isRecord(point.tangentIn)
                            ? { x: asFiniteNumber(point.tangentIn.x, 0), y: asFiniteNumber(point.tangentIn.y, 0) }
                            : undefined,
                        tangentOut: isRecord(point.tangentOut)
                            ? { x: asFiniteNumber(point.tangentOut.x, 0), y: asFiniteNumber(point.tangentOut.y, 0) }
                            : undefined
                    }))
                    .sort((left, right) => left.time - right.time)
                : []
        }));

    return sanitized.length > 0 ? sanitized : undefined;
};

const sanitizeSessionClips = (
    candidate: unknown,
    trackId: string,
    clipsById: Map<string, Clip>,
    usedClipIds: Set<string>,
    fallbackColor: string,
    trackType: TrackType,
    issues: ProjectIntegrityIssue[]
): { slots: ClipSlot[]; promotedClips: Clip[] } => {
    if (!Array.isArray(candidate)) {
        return { slots: [], promotedClips: [] };
    }

    const usedSlotIds = new Set<string>();
    const promotedClips: Clip[] = [];
    const slots = candidate
        .filter(isRecord)
        .map((slot, index) => {
            const slotId = ensureUniqueId(slot.id, usedSlotIds, `slot-${trackId}-${index}`, issues, { trackId });
            let slotClip: Clip | null = null;

            if (isRecord(slot.clip)) {
                const rawClipId = asNonEmptyString(slot.clip.id);
                slotClip = rawClipId ? clipsById.get(rawClipId) || null : null;

                if (!slotClip) {
                    const repairedClip = sanitizeClip(slot.clip, promotedClips.length, { id: trackId, color: fallbackColor, type: trackType }, usedClipIds, issues);
                    if (repairedClip) {
                        promotedClips.push(repairedClip);
                        clipsById.set(repairedClip.id, repairedClip);
                        slotClip = repairedClip;
                        issues.push({
                            severity: 'warning',
                            code: 'session-slot.promoted-clip',
                            message: `Un clip de Session sin contraparte en Arrange fue preservado en ${trackId}.`,
                            repaired: true,
                            trackId,
                            clipId: repairedClip.id
                        });
                    }
                }
            }

            return {
                id: slotId,
                clip: slotClip,
                isPlaying: false,
                isQueued: false
            };
        });

    return { slots, promotedClips };
};

const sanitizeRecordingTakes = (
    candidate: unknown,
    trackId: string,
    sourceClipsById: Map<string, Clip>,
    issues: ProjectIntegrityIssue[]
): RecordingTake[] => {
    if (!Array.isArray(candidate)) return [];

    const usedTakeIds = new Set<string>();
    const sanitized: RecordingTake[] = [];

    candidate.forEach((takeCandidate, index) => {
        if (!isRecord(takeCandidate)) {
            issues.push({
                severity: 'warning',
                code: 'take.invalid-shape',
                message: `Se descarto una toma invalida en ${trackId}.`,
                repaired: true,
                trackId
            });
            return;
        }

        const clipId = asNonEmptyString(takeCandidate.clipId);
        if (!clipId || !sourceClipsById.has(clipId) || isCompDerivedClipId(clipId)) {
            issues.push({
                severity: 'error',
                code: 'take.missing-source-clip',
                message: `Se descarto una toma que apuntaba a un clip inexistente en ${trackId}.`,
                repaired: true,
                trackId,
                clipId: clipId || undefined
            });
            return;
        }

        const sourceClip = sourceClipsById.get(clipId);
        const takeId = ensureUniqueId(takeCandidate.id, usedTakeIds, `take-${index + 1}`, issues, { trackId, clipId });
        sanitized.push({
            id: takeId,
            clipId,
            trackId,
            laneId: asNonEmptyString(takeCandidate.laneId) || 'lane-rec-1',
            sourceId: asNonEmptyString(takeCandidate.sourceId) || undefined,
            startBar: Math.max(1, asFiniteNumber(takeCandidate.startBar, sourceClip?.start || 1)),
            lengthBars: Math.max(MIN_CLIP_LENGTH_BARS, asFiniteNumber(takeCandidate.lengthBars, sourceClip?.length || 1)),
            offsetBars: Math.max(0, asFiniteNumber(takeCandidate.offsetBars, sourceClip?.offset || 0)),
            createdAt: Math.max(0, asFiniteNumber(takeCandidate.createdAt, Date.now())),
            label: asNonEmptyString(takeCandidate.label) || `Take ${sanitized.length + 1}`,
            gain: clamp(asFiniteNumber(takeCandidate.gain, 1), 0, 4),
            muted: Boolean(takeCandidate.muted)
        });
    });

    return sanitized;
};

const sanitizeCompSegments = (
    candidate: unknown,
    trackId: string,
    validTakeIds: Set<string>,
    issues: ProjectIntegrityIssue[]
): CompSegment[] | undefined => {
    if (!Array.isArray(candidate)) return undefined;

    const usedSegmentIds = new Set<string>();
    const sanitized = candidate
        .filter(isRecord)
        .map((segment, index): CompSegment | null => {
            const takeId = asNonEmptyString(segment.takeId);
            if (!takeId || !validTakeIds.has(takeId)) {
                issues.push({
                    severity: 'error',
                    code: 'comp-segment.invalid-take',
                    message: `Se descarto un segmento de comp con takeId faltante en ${trackId}.`,
                    repaired: true,
                    trackId
                });
                return null;
            }

            const sourceStartBar = Math.max(1, asFiniteNumber(segment.sourceStartBar, 1));
            const sourceEndBar = Math.max(sourceStartBar + MIN_CLIP_LENGTH_BARS, asFiniteNumber(segment.sourceEndBar, sourceStartBar + 1));

            return {
                id: ensureUniqueId(segment.id, usedSegmentIds, `segment-${index + 1}`, issues, { trackId }),
                takeId,
                sourceStartBar,
                sourceEndBar,
                targetStartBar: Math.max(1, asFiniteNumber(segment.targetStartBar, sourceStartBar)),
                fadeInBars: Math.max(0, asFiniteNumber(segment.fadeInBars, 0)) || undefined,
                fadeOutBars: Math.max(0, asFiniteNumber(segment.fadeOutBars, 0)) || undefined
            };
        })
        .filter((segment): segment is CompSegment => Boolean(segment))
        .sort((left, right) => left.targetStartBar - right.targetStartBar);

    return sanitized.length > 0 ? sanitized : undefined;
};

const sanitizeTakeLanes = (
    candidate: unknown,
    trackId: string,
    takes: RecordingTake[],
    issues: ProjectIntegrityIssue[]
): TakeLane[] => {
    if (!Array.isArray(candidate)) return [];

    const usedLaneIds = new Set<string>();
    const validTakeIds = new Set(takes.map((take) => take.id));
    let firstCompLaneFound = false;

    return candidate
        .filter(isRecord)
        .map((lane, index) => {
            const hasCompSegments = Array.isArray(lane.compSegments) && lane.compSegments.length > 0;
            let isCompLane = Boolean(lane.isCompLane) || hasCompSegments;

            if (isCompLane && firstCompLaneFound) {
                issues.push({
                    severity: 'warning',
                    code: 'take-lane.multiple-comp-lanes',
                    message: `Se detectaron multiples comp lanes en ${trackId}; solo se conserva una como comp lane.`,
                    repaired: true,
                    trackId
                });
                isCompLane = false;
            }

            if (isCompLane) {
                firstCompLaneFound = true;
            }

            const laneId = ensureUniqueId(lane.id, usedLaneIds, `lane-${index + 1}`, issues, { trackId });
            const compSegments = isCompLane
                ? sanitizeCompSegments(lane.compSegments, trackId, validTakeIds, issues)
                : undefined;
            const takeIds = Array.isArray(lane.takeIds)
                ? Array.from(new Set(lane.takeIds.filter((takeId): takeId is string => typeof takeId === 'string' && validTakeIds.has(takeId))))
                : [];

            return {
                id: laneId,
                name: asNonEmptyString(lane.name) || (isCompLane ? 'Comp Lane' : `Take Lane ${index + 1}`),
                trackId,
                isCompLane,
                isMuted: Boolean(lane.isMuted),
                takeIds,
                compSegments
            };
        });
};

const normalizeTakeLaneAssignments = (
    track: Track,
    issues: ProjectIntegrityIssue[]
): Track => {
    const takes = [...(track.recordingTakes || [])];
    const lanes = [...(track.takeLanes || [])];

    if (takes.length === 0 && lanes.length === 0) {
        return track;
    }

    let nonCompLanes = lanes.filter((lane) => !lane.isCompLane);
    if (takes.length > 0 && nonCompLanes.length === 0) {
        lanes.push({
            id: 'lane-rec-1',
            name: 'Take Lane 1',
            trackId: track.id,
            isCompLane: false,
            isMuted: false,
            takeIds: []
        });
        nonCompLanes = lanes.filter((lane) => !lane.isCompLane);
        issues.push({
            severity: 'warning',
            code: 'take-lane.created-fallback',
            message: `Se creo un Take Lane de respaldo en ${track.id}.`,
            repaired: true,
            trackId: track.id
        });
    }

    const fallbackLane = nonCompLanes[0];
    const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
    const assignedTakeIdsByLane = new Map<string, string[]>();

    const nextTakes = takes.map((originalTake) => {
        let take = originalTake;
        const lane = laneById.get(take.laneId);
        if (!lane || lane.isCompLane) {
            const nextLaneId = fallbackLane?.id || take.laneId;
            issues.push({
                severity: 'warning',
                code: 'take.invalid-lane-reference',
                message: `La toma ${take.id} tenia un lane invalido y fue reasignada en ${track.id}.`,
                repaired: true,
                trackId: track.id,
                clipId: take.clipId
            });
            take = { ...take, laneId: nextLaneId };
        }

        const laneTakeIds = assignedTakeIdsByLane.get(take.laneId) || [];
        laneTakeIds.push(take.id);
        assignedTakeIdsByLane.set(take.laneId, laneTakeIds);
        return take;
    });

    const nextLanes = lanes.map((lane) => {
        const laneTakeIds = lane.isCompLane
            ? Array.from(new Set([
                ...(lane.takeIds || []),
                ...((lane.compSegments || []).map((segment) => segment.takeId))
            ]))
            : assignedTakeIdsByLane.get(lane.id) || [];

        return {
            ...lane,
            takeIds: laneTakeIds
        };
    });

    const validTakeIds = new Set(nextTakes.map((take) => take.id));
    const activeTakeId = track.activeTakeId && validTakeIds.has(track.activeTakeId) ? track.activeTakeId : undefined;
    const soloTakeId = track.soloTakeId && validTakeIds.has(track.soloTakeId) ? track.soloTakeId : undefined;
    const compLane = nextLanes.find((lane) => lane.isCompLane);
    const activeCompLaneId = track.activeCompLaneId && nextLanes.some((lane) => lane.id === track.activeCompLaneId && lane.isCompLane)
        ? track.activeCompLaneId
        : compLane?.id;

    return {
        ...track,
        recordingTakes: nextTakes,
        takeLanes: nextLanes,
        activeTakeId,
        soloTakeId,
        activeCompLaneId
    };
};

const sanitizeTransport = (candidate: unknown): TransportState => {
    const input = isRecord(candidate) ? candidate : {};
    const timeSignature: [number, number] = Array.isArray(input.timeSignature) && input.timeSignature.length === 2
        ? [
            Math.max(1, Math.round(asFiniteNumber(input.timeSignature[0], DEFAULT_TRANSPORT.timeSignature[0]))),
            Math.max(1, Math.round(asFiniteNumber(input.timeSignature[1], DEFAULT_TRANSPORT.timeSignature[1])))
        ]
        : DEFAULT_TRANSPORT.timeSignature;

    return {
        isPlaying: Boolean(input.isPlaying),
        isRecording: Boolean(input.isRecording),
        loopMode: input.loopMode === 'once' || input.loopMode === 'infinite'
            ? input.loopMode
            : input.isLooping
                ? 'infinite'
                : 'off',
        isLooping: undefined,
        bpm: clamp(asFiniteNumber(input.bpm, DEFAULT_TRANSPORT.bpm), 20, 320),
        timeSignature,
        currentBar: Math.max(1, asFiniteNumber(input.currentBar, DEFAULT_TRANSPORT.currentBar)),
        currentBeat: Math.max(1, asFiniteNumber(input.currentBeat, DEFAULT_TRANSPORT.currentBeat)),
        currentSixteenth: Math.max(1, asFiniteNumber(input.currentSixteenth, DEFAULT_TRANSPORT.currentSixteenth)),
        masterTranspose: clamp(asFiniteNumber(input.masterTranspose, DEFAULT_TRANSPORT.masterTranspose), -24, 24),
        gridSize: Math.max(MIN_CLIP_LENGTH_BARS, asFiniteNumber(input.gridSize, DEFAULT_TRANSPORT.gridSize)),
        snapToGrid: typeof input.snapToGrid === 'boolean' ? input.snapToGrid : DEFAULT_TRANSPORT.snapToGrid,
        scaleRoot: clamp(Math.round(asFiniteNumber(input.scaleRoot, DEFAULT_TRANSPORT.scaleRoot)), 0, 11),
        scaleType: VALID_SCALE_TYPES.has(input.scaleType as TransportState['scaleType'])
            ? input.scaleType as TransportState['scaleType']
            : DEFAULT_TRANSPORT.scaleType
    };
};

const repairTrackRoutingReferences = (
    tracks: Track[],
    issues: ProjectIntegrityIssue[]
): Track[] => {
    const trackById = new Map(tracks.map((track) => [track.id, track]));
    const returnTrackIds = new Set(tracks.filter((track) => track.type === TrackType.RETURN).map((track) => track.id));
    const groupTrackIds = new Set(tracks.filter((track) => track.type === TrackType.GROUP).map((track) => track.id));

    return tracks.map((track) => {
        let groupId = track.groupId;
        let vcaGroupId = track.vcaGroupId;

        if (groupId && (!groupTrackIds.has(groupId) || groupId === track.id)) {
            issues.push({
                severity: 'warning',
                code: 'routing.invalid-group-reference',
                message: `Se limpio un group routing invalido en ${track.id}.`,
                repaired: true,
                trackId: track.id
            });
            groupId = undefined;
        }

        if (vcaGroupId && (!groupTrackIds.has(vcaGroupId) || vcaGroupId === track.id || vcaGroupId === groupId)) {
            issues.push({
                severity: 'warning',
                code: 'routing.invalid-vca-reference',
                message: `Se limpio un VCA routing invalido en ${track.id}.`,
                repaired: true,
                trackId: track.id
            });
            vcaGroupId = undefined;
        }

        const sends: Record<string, number> = {};
        Object.entries(track.sends || {}).forEach(([targetId, value]) => {
            const keep = returnTrackIds.has(targetId) && targetId !== track.id && isFiniteNumber(value);
            if (!keep) {
                issues.push({
                    severity: 'warning',
                    code: 'routing.invalid-send-reference',
                    message: `Se elimino un send invalido (${targetId}) en ${track.id}.`,
                    repaired: true,
                    trackId: track.id
                });
                return;
            }

            sends[targetId] = value;
        });

        const sendModes: Record<string, 'pre' | 'post'> = {};
        Object.entries(track.sendModes || {}).forEach(([targetId, value]) => {
            if (!Object.prototype.hasOwnProperty.call(sends, targetId)) {
                return;
            }

            sendModes[targetId] = value === 'pre' ? 'pre' : 'post';
        });

        if (groupId) {
            const visited = new Set<string>([track.id]);
            let cursor = groupId;
            let cycleDetected = false;

            while (cursor) {
                if (visited.has(cursor)) {
                    cycleDetected = true;
                    break;
                }
                visited.add(cursor);
                const nextTrack = trackById.get(cursor);
                cursor = nextTrack?.groupId || '';
            }

            if (cycleDetected) {
                issues.push({
                    severity: 'error',
                    code: 'routing.group-cycle',
                    message: `Se rompio un ciclo de buses en ${track.id}.`,
                    repaired: true,
                    trackId: track.id
                });
                groupId = undefined;
            }
        }

        return {
            ...track,
            sends,
            sendModes,
            groupId,
            vcaGroupId
        };
    });
};

const sanitizeTrack = (
    candidate: unknown,
    index: number,
    usedTrackIds: Set<string>,
    issues: ProjectIntegrityIssue[]
): Track | null => {
    if (!isRecord(candidate)) {
        issues.push({
            severity: 'warning',
            code: 'track.invalid-shape',
            message: `Se descarto un track invalido en la posicion ${index + 1}.`,
            repaired: true
        });
        return null;
    }

    const provisionalTrackId = asNonEmptyString(candidate.id) || `track-${index + 1}`;
    const type = sanitizeTrackType(candidate.type, index, issues, provisionalTrackId);
    const trackId = ensureUniqueId(candidate.id, usedTrackIds, `track-${index + 1}`, issues, {});
    const trackColor = sanitizeColor(candidate.color, DEFAULT_TRACK_COLOR);
    const usedClipIds = new Set<string>();

    const clips = Array.isArray(candidate.clips)
        ? candidate.clips
            .map((clip, clipIndex) => sanitizeClip(clip, clipIndex, { id: trackId, color: trackColor, type }, usedClipIds, issues))
            .filter((clip): clip is Clip => clip !== null)
        : [];
    const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
    const { slots, promotedClips } = sanitizeSessionClips(candidate.sessionClips, trackId, clipsById, usedClipIds, trackColor, type, issues);
    const allSourceClips = [...clips, ...promotedClips].sort((left, right) => left.start - right.start);
    const sourceClipById = new Map(allSourceClips.filter((clip) => !isCompDerivedClipId(clip.id)).map((clip) => [clip.id, clip]));
    const recordingTakes = sanitizeRecordingTakes(candidate.recordingTakes, trackId, sourceClipById, issues);
    const takeLanes = sanitizeTakeLanes(candidate.takeLanes, trackId, recordingTakes, issues);

    let track = withTrackRuntimeDefaults({
        id: trackId,
        name: asNonEmptyString(candidate.name) || `${DEFAULT_TRACK_NAMES[type]} ${index + 1}`,
        type,
        color: trackColor,
        volume: asFiniteNumber(candidate.volume, 0),
        pan: clamp(asFiniteNumber(candidate.pan, 0), -1, 1),
        reverb: clamp(asFiniteNumber(candidate.reverb, 0), 0, 1),
        transpose: clamp(asFiniteNumber(candidate.transpose, 0), -24, 24),
        monitor: VALID_MONITOR_MODES.has(candidate.monitor as Track['monitor']) ? candidate.monitor as Track['monitor'] : 'auto',
        isMuted: Boolean(candidate.isMuted),
        isSoloed: Boolean(candidate.isSoloed),
        isArmed: Boolean(candidate.isArmed),
        inputDeviceId: asNonEmptyString(candidate.inputDeviceId) || undefined,
        micSettings: isRecord(candidate.micSettings)
            ? {
                profile: candidate.micSettings.profile === 'podcast' || candidate.micSettings.profile === 'raw'
                    ? candidate.micSettings.profile
                    : 'studio-voice',
                inputGain: clamp(asFiniteNumber(candidate.micSettings.inputGain, 1), 0, 4),
                monitoringEnabled: Boolean(candidate.micSettings.monitoringEnabled),
                monitoringReverb: Boolean(candidate.micSettings.monitoringReverb),
                monitoringEcho: Boolean(candidate.micSettings.monitoringEcho),
                monitorInputMode: candidate.micSettings.monitorInputMode === 'stereo'
                    || candidate.micSettings.monitorInputMode === 'left'
                    || candidate.micSettings.monitorInputMode === 'right'
                    ? candidate.micSettings.monitorInputMode
                    : 'mono',
                monitorLatencyCompensationMs: Math.max(0, asFiniteNumber(candidate.micSettings.monitorLatencyCompensationMs, 0))
            }
            : undefined,
        sends: isRecord(candidate.sends) ? candidate.sends as Record<string, number> : {},
        sendModes: isRecord(candidate.sendModes) ? candidate.sendModes as Record<string, 'pre' | 'post'> : {},
        groupId: asNonEmptyString(candidate.groupId) || undefined,
        vcaGroupId: asNonEmptyString(candidate.vcaGroupId) || undefined,
        soloSafe: Boolean(candidate.soloSafe),
        automationMode: VALID_AUTOMATION_MODES.has(candidate.automationMode as AutomationMode)
            ? candidate.automationMode as AutomationMode
            : 'read',
        clips: allSourceClips,
        sessionClips: slots,
        devices: sanitizeDevices(candidate.devices),
        automationLanes: sanitizeAutomationLanes(candidate.automationLanes, trackColor),
        recordingTakes,
        takeLanes,
        activeCompLaneId: asNonEmptyString(candidate.activeCompLaneId) || undefined,
        activeTakeId: asNonEmptyString(candidate.activeTakeId) || undefined,
        soloTakeId: asNonEmptyString(candidate.soloTakeId) || undefined,
        punchRange: normalizePunchRange(candidate.punchRange as PunchRange | undefined)
    });

    track = normalizeTakeLaneAssignments(track, issues);
    track = rebuildCompDerivedClips(track);
    return track;
};

export const repairProjectData = (
    candidate: unknown,
    options: RepairProjectDataOptions = {}
): ProjectIntegrityResult => {
    const source = options.source || 'project';
    const now = options.now || Date.now();
    const issues: ProjectIntegrityIssue[] = [];

    if (!isRecord(candidate) || !Array.isArray(candidate.tracks) || !isRecord(candidate.transport)) {
        throw new ProjectIntegrityError('Formato de proyecto invalido o incompleto.', {
            source,
            issueCount: 1,
            errorCount: 1,
            warningCount: 0,
            repaired: false,
            issues: [{
                severity: 'error',
                code: 'project.invalid-shape',
                message: 'Faltan campos minimos del proyecto (tracks/transport).',
                repaired: false
            }]
        });
    }

    const usedTrackIds = new Set<string>();
    const sanitizedTracks = candidate.tracks
        .map((track, index) => sanitizeTrack(track, index, usedTrackIds, issues))
        .filter((track): track is Track => track !== null);
    const repairedTracks = repairTrackRoutingReferences(sanitizedTracks, issues);

    const project: ProjectData = {
        version: asNonEmptyString(candidate.version) || DEFAULT_PROJECT_VERSION,
        name: asNonEmptyString(candidate.name) || 'Sin Titulo',
        tracks: repairedTracks,
        transport: sanitizeTransport(candidate.transport),
        audioSettings: sanitizeAudioSettingsCandidate(candidate.audioSettings as Partial<AudioSettings> | undefined, DEFAULT_AUDIO_SETTINGS),
        scoreWorkspaces: sanitizeScoreWorkspaces(candidate.scoreWorkspaces),
        createdAt: Math.max(0, asFiniteNumber(candidate.createdAt, now)),
        lastModified: Math.max(0, asFiniteNumber(candidate.lastModified, now))
    };

    if (project.lastModified < project.createdAt) {
        project.lastModified = project.createdAt;
        issues.push({
            severity: 'warning',
            code: 'project.last-modified-before-created',
            message: 'Se ajusto lastModified para mantener consistencia temporal.',
            repaired: true
        });
    }

    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.length - errorCount;
    const report: ProjectIntegrityReport = {
        source,
        issueCount: issues.length,
        errorCount,
        warningCount,
        repaired: issues.some((issue) => issue.repaired),
        issues
    };

    return {
        project,
        report
    };
};

export const summarizeProjectIntegrityReport = (report: ProjectIntegrityReport, contextLabel = 'Proyecto'): string => {
    if (report.issueCount === 0) {
        return `${contextLabel}: integridad OK.`;
    }

    const headline = `${contextLabel}: se repararon ${report.issueCount} inconsistencias (${report.errorCount} errores, ${report.warningCount} advertencias).`;
    const details = report.issues
        .slice(0, 3)
        .map((issue) => `- ${issue.message}`)
        .join('\n');

    return details.length > 0 ? `${headline}\n${details}` : headline;
};
