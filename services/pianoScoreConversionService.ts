import {
    Note,
    ScoreConfidenceRegion,
    ScoreDocument,
    ScoreEvent,
    ScoreHand,
    ScoreMeasure,
    ScoreNotationOverride,
    ScoreVoice,
    ScoreWorkspaceState
} from '../types';

interface BuildScoreDocumentOptions {
    notes: Note[];
    bpm: number;
    timeSignature: [number, number];
    title: string;
    workspaceId?: string;
    notationOverrides?: ScoreNotationOverride[];
    confidenceRegions?: ScoreConfidenceRegion[];
}

interface NormalizedNote extends Note {
    index: number;
    hand: ScoreHand;
    spelling: string;
    sourceNoteKey: string;
}

interface SegmentedEventInput extends NormalizedNote {
    measureIndex: number;
    eventIndex: number;
    start16thInMeasure: number;
    duration16thInMeasure: number;
    tieStart?: boolean;
    tieEnd?: boolean;
}

const SHARP_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const quantizeNotationValue = (value: number): number => {
    return Math.round(value * 4) / 4;
};

const buildMeasure16ths = (timeSignature: [number, number]): number => {
    const numerator = Math.max(1, Math.round(timeSignature[0] || 4));
    const denominator = Math.max(1, Math.round(timeSignature[1] || 4));
    return Math.max(1, numerator * (16 / denominator));
};

const buildPitchSpelling = (pitch: number): string => {
    const safePitch = clamp(Math.round(pitch), 0, 127);
    const octave = Math.floor(safePitch / 12) - 1;
    return `${SHARP_NOTE_NAMES[safePitch % 12]}${octave}`;
};

export const buildScoreWorkspaceId = (trackId: string, clipId: string): string => {
    return `score:${trackId}:${clipId}`;
};

export const buildScoreNoteKey = (note: Pick<Note, 'pitch' | 'start' | 'duration'>, index: number): string => {
    return `${index}:${Math.round(note.pitch)}:${note.start.toFixed(4)}:${note.duration.toFixed(4)}`;
};

export const normalizeMidiVelocity = (velocity: number): number => {
    return clamp(Math.round(Number.isFinite(velocity) ? velocity : 96), 1, 127);
};

export const normalizeClipNotes = (notes: Note[]): Note[] => {
    return [...notes]
        .map((note) => ({
            pitch: clamp(Math.round(note.pitch), 0, 127),
            start: Math.max(0, Number.isFinite(note.start) ? note.start : 0),
            duration: Math.max(0.25, Number.isFinite(note.duration) ? note.duration : 1),
            velocity: normalizeMidiVelocity(note.velocity)
        }))
        .sort((left, right) => left.start - right.start || left.pitch - right.pitch);
};

const assignHands = (notes: Note[]): NormalizedNote[] => {
    let leftAnchor = 48;
    let rightAnchor = 72;

    return normalizeClipNotes(notes).map((note, index) => {
        const safePitch = Math.round(note.pitch);
        const leftCost = Math.abs(safePitch - leftAnchor) + (safePitch >= 60 ? 9 : 0);
        const rightCost = Math.abs(safePitch - rightAnchor) + (safePitch <= 57 ? 9 : 0);
        const hand: ScoreHand = leftCost <= rightCost ? 'left' : 'right';

        if (hand === 'left') {
            leftAnchor = Math.round((leftAnchor * 0.62) + (safePitch * 0.38));
        } else {
            rightAnchor = Math.round((rightAnchor * 0.62) + (safePitch * 0.38));
        }

        return {
            ...note,
            index,
            hand,
            spelling: buildPitchSpelling(safePitch),
            sourceNoteKey: buildScoreNoteKey(note, index)
        };
    });
};

const splitAcrossMeasures = (
    notes: NormalizedNote[],
    measure16ths: number
): SegmentedEventInput[] => {
    const segmented: SegmentedEventInput[] = [];

    notes.forEach((note) => {
        let remainingDuration = quantizeNotationValue(note.duration);
        let currentStart = quantizeNotationValue(note.start);
        let eventIndex = 0;

        while (remainingDuration > 0.0001) {
            const measureIndex = Math.floor(currentStart / measure16ths);
            const measureStart = measureIndex * measure16ths;
            const offsetInMeasure = currentStart - measureStart;
            const availableInMeasure = measure16ths - offsetInMeasure;
            const durationInMeasure = Math.min(remainingDuration, availableInMeasure);

            segmented.push({
                ...note,
                measureIndex,
                eventIndex,
                start16thInMeasure: offsetInMeasure,
                duration16thInMeasure: durationInMeasure,
                tieStart: eventIndex > 0,
                tieEnd: remainingDuration > availableInMeasure + 0.0001
            });

            currentStart += durationInMeasure;
            remainingDuration -= durationInMeasure;
            eventIndex += 1;
        }
    });

    return segmented;
};

const assignVoices = (
    events: SegmentedEventInput[],
    overridesByNoteKey: Map<string, ScoreNotationOverride>
): ScoreVoice[] => {
    const groups = new Map<ScoreHand, SegmentedEventInput[]>();
    groups.set('left', []);
    groups.set('right', []);

    events.forEach((event) => {
        groups.get(event.hand)?.push(event);
    });

    const voices: ScoreVoice[] = [];
    (['right', 'left'] as ScoreHand[]).forEach((hand) => {
        const handEvents = (groups.get(hand) || []).sort((left, right) => {
            return left.start16thInMeasure - right.start16thInMeasure || right.pitch - left.pitch;
        });

        const voiceEnds: number[] = [];
        const voiceEvents = new Map<number, ScoreEvent[]>();

        handEvents.forEach((event) => {
            const override = overridesByNoteKey.get(event.sourceNoteKey);
            const forcedVoice = override?.voice;
            let voiceNumber = forcedVoice && forcedVoice > 0 ? forcedVoice : 1;

            if (!forcedVoice) {
                const reusableVoiceIndex = voiceEnds.findIndex((end16th) => end16th <= event.start16thInMeasure + 0.001);
                voiceNumber = reusableVoiceIndex >= 0 ? reusableVoiceIndex + 1 : voiceEnds.length + 1;
            }

            while (voiceEnds.length < voiceNumber) {
                voiceEnds.push(0);
            }

            voiceEnds[voiceNumber - 1] = event.start16thInMeasure + event.duration16thInMeasure;

            const noteEvents = voiceEvents.get(voiceNumber) || [];
            noteEvents.push({
                id: `${event.sourceNoteKey}:${event.measureIndex}:${event.eventIndex}`,
                type: 'note',
                start16th: event.start16thInMeasure,
                duration16th: event.duration16thInMeasure,
                voice: voiceNumber,
                hand: override?.hand || event.hand,
                pitch: event.pitch,
                velocity: event.velocity,
                spelling: override?.spelling || event.spelling,
                tieStart: typeof override?.tieStart === 'boolean' ? override.tieStart : event.tieStart,
                tieEnd: typeof override?.tieEnd === 'boolean' ? override.tieEnd : event.tieEnd,
                pedalDown: override?.pedal,
                sourceNoteKey: event.sourceNoteKey,
                sourceNoteIndex: event.index
            });
            voiceEvents.set(voiceNumber, noteEvents);
        });

        Array.from(voiceEvents.entries())
            .sort((left, right) => left[0] - right[0])
            .forEach(([voiceNumber, noteEvents]) => {
                const completeEvents: ScoreEvent[] = [];
                let cursor = 0;
                noteEvents
                    .sort((left, right) => left.start16th - right.start16th || (right.pitch || 0) - (left.pitch || 0))
                    .forEach((event, index) => {
                        if (event.start16th > cursor + 0.001) {
                            completeEvents.push({
                                id: `${hand}-rest-${voiceNumber}-${index}`,
                                type: 'rest',
                                start16th: cursor,
                                duration16th: event.start16th - cursor,
                                voice: voiceNumber,
                                hand
                            });
                        }

                        completeEvents.push(event);
                        cursor = Math.max(cursor, event.start16th + event.duration16th);
                    });

                voices.push({
                    id: `${hand}-voice-${voiceNumber}`,
                    hand,
                    voice: voiceNumber,
                    events: completeEvents
                });
            });
    });

    return voices;
};

const buildMeasureConfidence = (
    measureStart16th: number,
    measureEnd16th: number,
    confidenceRegions: ScoreConfidenceRegion[]
): number | undefined => {
    const overlapping = confidenceRegions.filter((region) => {
        return region.start16th < measureEnd16th && region.end16th > measureStart16th;
    });
    if (overlapping.length === 0) return undefined;

    const total = overlapping.reduce((sum, region) => sum + region.confidence, 0);
    return total / overlapping.length;
};

export const createDefaultScoreWorkspace = (
    trackId: string,
    clipId: string,
    title: string,
    kind: 'midi' | 'audio-derived'
): ScoreWorkspaceState => {
    return {
        id: buildScoreWorkspaceId(trackId, clipId),
        title,
        mode: kind === 'audio-derived' ? 'transcribe' : 'score',
        source: {
            kind,
            trackId,
            clipId
        },
        layout: {
            splitRatio: 0.66,
            followTransport: true,
            zoom: 1
        },
        notationOverrides: [],
        confidenceRegions: [],
        updatedAt: Date.now()
    };
};

export const buildScoreDocument = ({
    notes,
    bpm,
    timeSignature,
    title,
    workspaceId,
    notationOverrides = [],
    confidenceRegions = []
}: BuildScoreDocumentOptions): ScoreDocument => {
    const normalized = assignHands(notes);
    const measure16ths = buildMeasure16ths(timeSignature);
    const segmented = splitAcrossMeasures(normalized, measure16ths);
    const total16ths = normalized.reduce((maxEnd, note) => {
        return Math.max(maxEnd, quantizeNotationValue(note.start + note.duration));
    }, 0);
    const measureCount = Math.max(1, Math.ceil(total16ths / measure16ths));
    const overridesByNoteKey = new Map(notationOverrides.map((override) => [override.noteKey, override]));
    const measureBuckets = new Map<number, SegmentedEventInput[]>();

    segmented.forEach((event) => {
        const bucket = measureBuckets.get(event.measureIndex) || [];
        bucket.push(event);
        measureBuckets.set(event.measureIndex, bucket);
    });

    const measures: ScoreMeasure[] = Array.from({ length: measureCount }, (_, measureIndex) => {
        const start16th = measureIndex * measure16ths;
        const end16th = start16th + measure16ths;
        return {
            index: measureIndex,
            start16th,
            duration16th: measure16ths,
            voices: assignVoices(measureBuckets.get(measureIndex) || [], overridesByNoteKey),
            confidence: buildMeasureConfidence(start16th, end16th, confidenceRegions)
        };
    });

    return {
        id: workspaceId || `score-doc:${title}:${measureCount}`,
        title,
        bpm,
        timeSignature,
        total16ths: Math.max(measure16ths, total16ths),
        sourceNoteCount: normalized.length,
        generatedAt: Date.now(),
        measures
    };
};

export const cloneScoreWorkspaceState = (workspace: ScoreWorkspaceState): ScoreWorkspaceState => {
    return {
        ...workspace,
        source: { ...workspace.source },
        layout: { ...workspace.layout },
        notationOverrides: workspace.notationOverrides.map((override) => ({ ...override })),
        confidenceRegions: workspace.confidenceRegions.map((region) => ({ ...region }))
    };
};

