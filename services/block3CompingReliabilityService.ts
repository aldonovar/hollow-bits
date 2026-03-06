import { Clip, Track, TrackType } from '../types';
import { createTrack } from './projectCoreService';
import { buildRecordingTakeCommit, commitRecordingTakeBatch } from './recordingTakeService';
import {
    applyCompClipEdits,
    COMP_CLIP_ID_PREFIX,
    promoteTakeToComp,
    resolvePunchRecordingPlan,
    shouldFinalizePunchRecording,
    syncTakeMetadataForClip,
    updateTrackPunchRange
} from './takeCompingService';
import { setTrackActiveTake, toggleTrackTakeMute, toggleTrackTakeSolo } from './takeLaneControlService';

export type Block3RegressionCaseStatus = 'pass' | 'fail';

export interface Block3RegressionCaseResult {
    id: string;
    label: string;
    status: Block3RegressionCaseStatus;
    elapsedMs: number;
    issues: string[];
    metrics: Record<string, number>;
}

export interface Block3RegressionReport {
    startedAt: number;
    finishedAt: number;
    elapsedMs: number;
    totalCases: number;
    passedCases: number;
    failedCases: number;
    results: Block3RegressionCaseResult[];
}

export interface Block3RegressionRunOptions {
    recordingCycles?: number;
    compEditCycles?: number;
    simulatedLiveMinutes?: number;
}

const MIN_CLIP_LENGTH_BARS = 1 / 1024;

const makeIdFactory = () => {
    let index = 0;
    return (prefix: string) => {
        index += 1;
        return `${prefix}-${index}`;
    };
};

const makeAudioClip = (
    id: string,
    start: number,
    length: number,
    color = '#7c3aed'
): Clip => ({
    id,
    name: id,
    color,
    notes: [],
    start,
    length,
    offset: 0,
    fadeIn: 0,
    fadeOut: 0,
    gain: 1,
    playbackRate: 1
});

const makeAudioBufferLike = (durationSeconds: number): AudioBuffer => {
    const sampleRate = 48000;
    const duration = Math.max(0.001, durationSeconds);
    const length = Math.max(1, Math.round(duration * sampleRate));
    const data = new Float32Array(length);
    return {
        duration,
        length,
        sampleRate,
        numberOfChannels: 1,
        getChannelData: () => data
    } as unknown as AudioBuffer;
};

const findFirstSourceClip = (track: Track): Clip | null => {
    return track.clips.find((clip) => !clip.id.startsWith(COMP_CLIP_ID_PREFIX)) || null;
};

const countDuplicateIds = (ids: string[]): number => {
    const seen = new Set<string>();
    let duplicates = 0;

    ids.forEach((id) => {
        if (seen.has(id)) {
            duplicates += 1;
            return;
        }
        seen.add(id);
    });

    return duplicates;
};

const validateTrackTakeIntegrity = (track: Track): string[] => {
    const issues: string[] = [];
    const takes = track.recordingTakes || [];
    const clipIds = new Set(track.clips.map((clip) => clip.id));

    const duplicateTakeIds = countDuplicateIds(takes.map((take) => take.id));
    if (duplicateTakeIds > 0) {
        issues.push(`Se detectaron ${duplicateTakeIds} IDs de takes duplicados.`);
    }

    takes.forEach((take) => {
        if (!clipIds.has(take.clipId)) {
            issues.push(`Take ${take.id} referencia clip faltante ${take.clipId}.`);
        }
        if (take.lengthBars < MIN_CLIP_LENGTH_BARS) {
            issues.push(`Take ${take.id} tiene longitud invalida ${take.lengthBars}.`);
        }
    });

    (track.takeLanes || []).forEach((lane) => {
        (lane.compSegments || []).forEach((segment) => {
            const take = takes.find((candidate) => candidate.id === segment.takeId);
            if (!take) {
                issues.push(`Comp segment ${segment.id} referencia take inexistente ${segment.takeId}.`);
                return;
            }

            const takeStart = take.startBar;
            const takeEnd = take.startBar + take.lengthBars;
            if (segment.sourceStartBar < takeStart - 0.0005 || segment.sourceEndBar > takeEnd + 0.0005) {
                issues.push(`Comp segment ${segment.id} fuera de rango de su take ${segment.takeId}.`);
            }
            if ((segment.sourceEndBar - segment.sourceStartBar) < MIN_CLIP_LENGTH_BARS) {
                issues.push(`Comp segment ${segment.id} colapsado (< ${MIN_CLIP_LENGTH_BARS}).`);
            }
        });
    });

    return issues;
};

const runRecordingFinalizeStressCase = (cycles: number): Block3RegressionCaseResult => {
    const startedAt = Date.now();
    const issues: string[] = [];
    const idFactory = makeIdFactory();

    let track = createTrack({
        id: 'track-recording-stress',
        name: 'Recording Stress',
        type: TrackType.AUDIO,
        clips: [],
        sessionClips: [],
        devices: []
    });

    const bpm = 120;
    const buffer = makeAudioBufferLike(1.8);

    for (let index = 0; index < cycles; index += 1) {
        const commit = buildRecordingTakeCommit({
            track,
            sourceId: `src-${index}`,
            buffer,
            bpm,
            recordingStartBar: 1 + (index * 0.125),
            sourceTrimOffsetBars: index % 7 === 0 ? 0.0625 : 0,
            idFactory
        });

        track = commitRecordingTakeBatch([track], [commit])[0];
    }

    if ((track.recordingTakes || []).length !== cycles) {
        issues.push(`Esperados ${cycles} takes y se obtuvieron ${(track.recordingTakes || []).length}.`);
    }

    const laneTakeCount = (track.takeLanes || [])
        .filter((lane) => !lane.isCompLane)
        .reduce((acc, lane) => acc + lane.takeIds.length, 0);
    if (laneTakeCount !== cycles) {
        issues.push(`Esperados ${cycles} takeIds en lanes y se obtuvo ${laneTakeCount}.`);
    }

    issues.push(...validateTrackTakeIntegrity(track));

    return {
        id: 'recording-finalize-1000-cycles',
        label: 'Recording finalize stress sin perdida de takes',
        status: issues.length > 0 ? 'fail' : 'pass',
        elapsedMs: Date.now() - startedAt,
        issues,
        metrics: {
            recordingCycles: cycles,
            resultingTakes: (track.recordingTakes || []).length,
            resultingClips: track.clips.length,
            laneTakeCount,
            issues: issues.length
        }
    };
};

const runPunchRegressionCase = (): Block3RegressionCaseResult => {
    const startedAt = Date.now();
    const issues: string[] = [];

    const trackA = createTrack({
        id: 'track-punch-a',
        name: 'Punch A',
        type: TrackType.AUDIO,
        isArmed: true,
        punchRange: {
            enabled: true,
            inBar: 8,
            outBar: 12,
            preRollBars: 2,
            countInBars: 1
        }
    });
    const trackB = createTrack({
        id: 'track-punch-b',
        name: 'Punch B',
        type: TrackType.AUDIO,
        isArmed: true,
        punchRange: {
            enabled: true,
            inBar: 10,
            outBar: 16,
            preRollBars: 3,
            countInBars: 0
        }
    });

    const mergedPlan = resolvePunchRecordingPlan([trackA, trackB]);
    if (!mergedPlan) {
        issues.push('No se pudo resolver el plan de punch merged.');
    } else {
        if (mergedPlan.punchInBar !== 8) issues.push(`Punch in esperado 8, recibido ${mergedPlan.punchInBar}.`);
        if (mergedPlan.punchOutBar !== 16) issues.push(`Punch out esperado 16, recibido ${mergedPlan.punchOutBar}.`);
        if (mergedPlan.startPlaybackBar !== 4) issues.push(`Start playback esperado 4, recibido ${mergedPlan.startPlaybackBar}.`);
    }

    const sessionMeta = new Map([
        ['track-punch-a', { punchOutBar: 12 }],
        ['track-punch-b', { punchOutBar: 16 }]
    ]);

    let prematureFinalizeCount = 0;
    let firstFinalizeBar: number | null = null;
    for (let bar = 5; bar <= 18; bar += 0.125) {
        const evaluation = shouldFinalizePunchRecording(bar, ['track-punch-a', 'track-punch-b'], sessionMeta);
        if (evaluation.shouldFinalize && bar < 16 - 0.0005) {
            prematureFinalizeCount += 1;
        }
        if (evaluation.shouldFinalize && firstFinalizeBar === null) {
            firstFinalizeBar = bar;
        }
    }

    if (prematureFinalizeCount > 0) {
        issues.push(`Auto-stop punch se disparo prematuramente ${prematureFinalizeCount} veces.`);
    }
    if (firstFinalizeBar === null || firstFinalizeBar < 15.999) {
        issues.push(`Primer finalize esperado cerca de 16 y se obtuvo ${firstFinalizeBar ?? 'null'}.`);
    }

    return {
        id: 'punch-auto-stop-mixed-ranges',
        label: 'Regression punch auto-stop en rangos mixtos',
        status: issues.length > 0 ? 'fail' : 'pass',
        elapsedMs: Date.now() - startedAt,
        issues,
        metrics: {
            firstFinalizeBar: firstFinalizeBar || 0,
            prematureFinalizeCount,
            issues: issues.length
        }
    };
};

const runCompingEditRegressionCase = (cycles: number): Block3RegressionCaseResult => {
    const startedAt = Date.now();
    const issues: string[] = [];
    const idFactory = makeIdFactory();

    const sourceClip = makeAudioClip('clip-src', 4, 4);
    let track = createTrack({
        id: 'track-comp-regression',
        name: 'Comp Regression',
        type: TrackType.AUDIO,
        clips: [sourceClip],
        recordingTakes: [
            {
                id: 'take-src',
                clipId: sourceClip.id,
                trackId: 'track-comp-regression',
                laneId: 'lane-rec',
                startBar: sourceClip.start,
                lengthBars: sourceClip.length,
                offsetBars: 0,
                createdAt: 1
            }
        ],
        takeLanes: [
            {
                id: 'lane-rec',
                name: 'Take Lane 1',
                trackId: 'track-comp-regression',
                takeIds: ['take-src']
            }
        ]
    });

    track = promoteTakeToComp(track, 'take-src', {
        replaceExisting: true,
        idFactory
    });

    for (let index = 0; index < cycles; index += 1) {
        const compClip = track.clips.find((clip) => clip.id.startsWith(COMP_CLIP_ID_PREFIX));
        if (!compClip) {
            issues.push(`No existe comp clip para iteracion ${index}.`);
            break;
        }

        const shift = (index % 2 === 0 ? 1 : -1) * 0.015625;
        const lengthDelta = (index % 3 === 0 ? 0.03125 : -0.015625);
        const nextLength = Math.max(0.5, compClip.length + lengthDelta);
        const nextStart = Math.max(1, compClip.start + shift);
        const nextOffset = Math.max(0, (compClip.offset || 0) + shift);

        track = applyCompClipEdits(track, compClip.id, {
            start: nextStart,
            length: nextLength,
            offset: nextOffset,
            fadeIn: Math.max(0, Math.min(nextLength, (compClip.fadeIn || 0) + 0.015625)),
            fadeOut: Math.max(0, Math.min(nextLength, (compClip.fadeOut || 0) + 0.015625))
        });

        if (index % 20 === 0) {
            const source = findFirstSourceClip(track);
            if (source) {
                const syncedSource: Clip = {
                    ...source,
                    start: Math.max(1, source.start + 0.03125),
                    length: Math.max(0.5, source.length - 0.03125),
                    offset: Math.max(0, (source.offset || 0) + 0.03125)
                };

                track = syncTakeMetadataForClip({
                    ...track,
                    clips: track.clips.map((clip) => clip.id === source.id ? syncedSource : clip)
                }, source.id);
            }
        }

        const cycleIssues = validateTrackTakeIntegrity(track);
        if (cycleIssues.length > 0) {
            issues.push(...cycleIssues.map((message) => `[cycle ${index}] ${message}`));
            break;
        }
    }

    return {
        id: 'comping-edit-regression-matrix',
        label: 'Regression comping/metadata bajo edicion intensa',
        status: issues.length > 0 ? 'fail' : 'pass',
        elapsedMs: Date.now() - startedAt,
        issues,
        metrics: {
            compEditCycles: cycles,
            totalTakes: (track.recordingTakes || []).length,
            totalClips: track.clips.length,
            totalLanes: (track.takeLanes || []).length,
            issues: issues.length
        }
    };
};

const runLiveEdit90MinModelCase = (minutes: number): Block3RegressionCaseResult => {
    const startedAt = Date.now();
    const issues: string[] = [];
    const eventsPerMinute = 24;
    const totalEvents = Math.max(1, Math.round(minutes * eventsPerMinute));

    let track = createTrack({
        id: 'track-live-model',
        name: 'Live Model',
        type: TrackType.AUDIO,
        clips: [makeAudioClip('clip-live', 1, 8)],
        recordingTakes: [
            {
                id: 'take-live',
                clipId: 'clip-live',
                trackId: 'track-live-model',
                laneId: 'lane-live',
                startBar: 1,
                lengthBars: 8,
                offsetBars: 0,
                createdAt: 1,
                muted: false
            }
        ],
        takeLanes: [
            {
                id: 'lane-live',
                name: 'Take Lane 1',
                trackId: 'track-live-model',
                takeIds: ['take-live']
            }
        ],
        activeTakeId: 'take-live'
    });

    track = updateTrackPunchRange(track, {
        enabled: true,
        inBar: 9,
        outBar: 13,
        preRollBars: 1,
        countInBars: 0
    });

    const sessionMeta = new Map([
        [track.id, { punchOutBar: 13 }]
    ]);
    let currentBar = 1;
    let finalizeEvents = 0;

    for (let index = 0; index < totalEvents; index += 1) {
        currentBar += 0.5;

        if (index % 2 === 0) {
            track = toggleTrackTakeMute(track, 'take-live');
        }

        if (index % 3 === 0) {
            track = toggleTrackTakeSolo(track, 'take-live');
        }

        if (index % 5 === 0) {
            track = setTrackActiveTake(track, 'take-live');
        }

        const shouldFinalize = shouldFinalizePunchRecording(currentBar, [track.id], sessionMeta);
        if (shouldFinalize.shouldFinalize) {
            finalizeEvents += 1;
            track = updateTrackPunchRange(track, {
                inBar: track.punchRange ? track.punchRange.inBar + 8 : 9,
                outBar: track.punchRange ? track.punchRange.outBar + 8 : 13
            });
            sessionMeta.set(track.id, { punchOutBar: track.punchRange?.outBar || 13 });
        }

        const perCycleIssues = validateTrackTakeIntegrity(track);
        if (perCycleIssues.length > 0) {
            issues.push(...perCycleIssues.map((message) => `[event ${index}] ${message}`));
            break;
        }
    }

    if (finalizeEvents === 0) {
        issues.push('El modelo live no genero eventos de auto-finalize punch.');
    }

    return {
        id: 'live-edit-90min-model',
        label: 'Modelo acelerado 90 min de live edit',
        status: issues.length > 0 ? 'fail' : 'pass',
        elapsedMs: Date.now() - startedAt,
        issues,
        metrics: {
            simulatedMinutes: minutes,
            eventsExecuted: totalEvents,
            finalizeEvents,
            issues: issues.length
        }
    };
};

export const runBlock3CompingRegressionMatrix = (
    options: Block3RegressionRunOptions = {}
): Block3RegressionReport => {
    const startedAt = Date.now();
    const recordingCycles = Math.max(1, Math.round(options.recordingCycles || 1000));
    const compEditCycles = Math.max(1, Math.round(options.compEditCycles || 400));
    const simulatedLiveMinutes = Math.max(1, Math.round(options.simulatedLiveMinutes || 90));

    const results: Block3RegressionCaseResult[] = [
        runRecordingFinalizeStressCase(recordingCycles),
        runPunchRegressionCase(),
        runCompingEditRegressionCase(compEditCycles),
        runLiveEdit90MinModelCase(simulatedLiveMinutes)
    ];

    const finishedAt = Date.now();
    const failedCases = results.filter((result) => result.status === 'fail').length;
    const passedCases = results.length - failedCases;

    return {
        startedAt,
        finishedAt,
        elapsedMs: finishedAt - startedAt,
        totalCases: results.length,
        passedCases,
        failedCases,
        results
    };
};
