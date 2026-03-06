import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Play, Square } from 'lucide-react';
import { Clip, Track, TrackType } from '../types';
import { engineAdapter } from '../services/engineAdapter';
import type { EngineDiagnostics } from '../services/engineAdapter';
import type { SessionLaunchTelemetryEvent } from '../services/engineAdapter';
import { BrowserDragPayload, readBrowserDragPayload } from '../services/browserDragService';
import {
    assessSessionOverload,
    buildSessionTrackWindow,
    summarizeSessionLaunchTelemetry,
    type SessionLaunchTelemetrySample
} from '../services/sessionPerformanceService';
import {
    appendSceneRecordingEvent,
    buildSceneReplayPlan,
    createSceneRecordingEvent,
    type SceneRecordingEvent,
    type SceneTrackClipRef
} from '../services/sessionSceneRecordingService';

interface SessionViewProps {
    tracks: Track[];
    bpm: number;
    engineStats?: Pick<
        EngineDiagnostics,
        'highLoadDetected'
        | 'schedulerCpuLoadP95Percent'
        | 'schedulerOverrunRatio'
        | 'schedulerDropoutCount'
        | 'schedulerUnderrunCount'
    > | null;
    onExternalDrop?: (trackId: string, sceneIndex: number, payload: BrowserDragPayload) => void;
    onClipSelect?: (trackId: string, clipId: string) => void;
}

interface TrackLaunchState {
    playingClipId?: string;
    queuedClipId?: string;
}

interface SceneSlot {
    clip: Clip | null;
}

interface VisibleTrackColumn {
    track: Track;
    index: number;
    rightGapPx: number;
}

const SCENES = 8;
const SCENE_COLUMN_WIDTH_PX = 76;
const TRACK_COLUMN_WIDTH_PX = 144;
const TRACK_COLUMN_GAP_PX = 8;
const TRACK_WINDOW_OVERSCAN = 3;

const QUANTIZE_OPTIONS = [
    { value: 0.25, label: '1/4 Bar' },
    { value: 0.5, label: '1/2 Bar' },
    { value: 1, label: '1 Bar' },
    { value: 2, label: '2 Bars' }
];

const SessionView: React.FC<SessionViewProps> = ({ tracks, bpm, engineStats, onExternalDrop, onClipSelect }) => {
    const [trackLaunchState, setTrackLaunchState] = useState<Record<string, TrackLaunchState>>({});
    const [launchQuantizeBars, setLaunchQuantizeBars] = useState<number>(1);
    const [trackViewport, setTrackViewport] = useState({ left: 0, width: 1280 });
    const [isSceneRecording, setIsSceneRecording] = useState(false);
    const [sceneRecordingEvents, setSceneRecordingEvents] = useState<SceneRecordingEvent[]>([]);
    const [isSceneReplayRunning, setIsSceneReplayRunning] = useState(false);
    const [launchTelemetrySamples, setLaunchTelemetrySamples] = useState<SessionLaunchTelemetrySample[]>([]);

    const pendingTimersRef = useRef<number[]>([]);
    const replayTimersRef = useRef<number[]>([]);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const overloadBaselineRef = useRef<{
        dropoutCount: number;
        underrunCount: number;
    } | null>(null);

    const sessionTracks = useMemo(
        () => tracks.filter((track) => track.type === TrackType.AUDIO || track.type === TrackType.MIDI),
        [tracks]
    );

    useEffect(() => {
        if (overloadBaselineRef.current) return;
        overloadBaselineRef.current = {
            dropoutCount: Math.max(0, Number(engineStats?.schedulerDropoutCount || 0)),
            underrunCount: Math.max(0, Number(engineStats?.schedulerUnderrunCount || 0))
        };
    }, [engineStats?.schedulerDropoutCount, engineStats?.schedulerUnderrunCount]);

    const recentDropoutDelta = useMemo(() => {
        const baseline = overloadBaselineRef.current;
        if (!baseline) return 0;
        const currentDropouts = Math.max(0, Number(engineStats?.schedulerDropoutCount || 0));
        return Math.max(0, currentDropouts - baseline.dropoutCount);
    }, [engineStats?.schedulerDropoutCount]);

    const recentUnderrunDelta = useMemo(() => {
        const baseline = overloadBaselineRef.current;
        if (!baseline) return 0;
        const currentUnderruns = Math.max(0, Number(engineStats?.schedulerUnderrunCount || 0));
        return Math.max(0, currentUnderruns - baseline.underrunCount);
    }, [engineStats?.schedulerUnderrunCount]);

    const overloadDecision = useMemo(() => {
        return assessSessionOverload({
            engineStats: engineStats || null,
            sessionTrackCount: sessionTracks.length,
            sceneCount: SCENES,
            recentDropoutDelta,
            recentUnderrunDelta
        });
    }, [
        engineStats,
        recentDropoutDelta,
        recentUnderrunDelta,
        sessionTracks.length
    ]);

    useEffect(() => {
        return () => {
            pendingTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
            pendingTimersRef.current = [];
            replayTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
            replayTimersRef.current = [];
        };
    }, []);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let rafId = 0;
        let pending = false;

        const commitViewport = () => {
            pending = false;
            const left = Math.max(0, container.scrollLeft - SCENE_COLUMN_WIDTH_PX - TRACK_COLUMN_GAP_PX);
            const width = Math.max(1, container.clientWidth - SCENE_COLUMN_WIDTH_PX - TRACK_COLUMN_GAP_PX);

            setTrackViewport((prev) => {
                if (prev.left === left && prev.width === width) {
                    return prev;
                }
                return { left, width };
            });
        };

        const scheduleViewportCommit = () => {
            if (pending) return;
            pending = true;
            rafId = requestAnimationFrame(commitViewport);
        };

        scheduleViewportCommit();
        container.addEventListener('scroll', scheduleViewportCommit, { passive: true });
        window.addEventListener('resize', scheduleViewportCommit);

        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            container.removeEventListener('scroll', scheduleViewportCommit);
            window.removeEventListener('resize', scheduleViewportCommit);
        };
    }, []);

    useEffect(() => {
        const validTrackIds = new Set(sessionTracks.map((track) => track.id));
        setTrackLaunchState((prev) => {
            const next: Record<string, TrackLaunchState> = {};
            let changed = false;

            Object.entries(prev).forEach(([trackId, state]) => {
                if (validTrackIds.has(trackId)) {
                    next[trackId] = state;
                    return;
                }
                changed = true;
            });

            return changed ? next : prev;
        });
    }, [sessionTracks]);

    const scheduleUiUpdate = useCallback((callback: () => void, delayMs: number) => {
        const effectiveDelayMs = Math.max(delayMs, overloadDecision.uiUpdateDebounceMs);

        if (effectiveDelayMs <= 1) {
            callback();
            return;
        }

        const timerId = window.setTimeout(callback, effectiveDelayMs);
        pendingTimersRef.current.push(timerId);
    }, [overloadDecision.uiUpdateDebounceMs]);

    const pushLaunchTelemetrySamples = useCallback((samples: SessionLaunchTelemetrySample[]) => {
        if (samples.length === 0) return;

        setLaunchTelemetrySamples((prev) => {
            const merged = [...prev, ...samples];
            if (merged.length <= 1200) {
                return merged;
            }
            return merged.slice(merged.length - 1200);
        });
    }, []);

    const toLaunchTelemetrySample = useCallback((
        event: SessionLaunchTelemetryEvent,
        sceneIndex?: number | null
    ): SessionLaunchTelemetrySample => {
        return {
            trackId: event.trackId,
            clipId: event.clipId,
            sceneIndex: typeof sceneIndex === 'number' ? sceneIndex : null,
            requestedLaunchTimeSec: event.requestedLaunchTimeSec,
            effectiveLaunchTimeSec: event.effectiveLaunchTimeSec,
            launchErrorMs: event.launchErrorMs,
            quantized: event.quantized,
            wasLate: event.wasLate,
            capturedAtMs: event.capturedAtMs
        };
    }, []);

    const launchTelemetrySummary = useMemo(() => {
        return summarizeSessionLaunchTelemetry(launchTelemetrySamples, 2);
    }, [launchTelemetrySamples]);

    useEffect(() => {
        if (launchTelemetrySummary.sampleCount === 0) return;

        try {
            localStorage.setItem('hollowbits.session-launch.telemetry.v1', JSON.stringify({
                capturedAt: Date.now(),
                summary: launchTelemetrySummary,
                samples: launchTelemetrySamples.slice(-200)
            }));
        } catch {
            // Non-blocking persistence path.
        }
    }, [launchTelemetrySamples, launchTelemetrySummary]);

    const computeLaunchAt = useCallback(() => {
        return engineAdapter.getSessionLaunchTime(launchQuantizeBars);
    }, [launchQuantizeBars]);

    const queueClipLaunch = useCallback((track: Track, clip: Clip, launchAt: number, sceneIndex?: number) => {
        if (track.type !== TrackType.AUDIO || !clip.buffer) return;

        const now = engineAdapter.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        setTrackLaunchState((prev) => ({
            ...prev,
            [track.id]: {
                ...(prev[track.id] || {}),
                queuedClipId: clip.id
            }
        }));

        const telemetryEvent = engineAdapter.launchClip(track, clip, launchAt);
        if (telemetryEvent) {
            pushLaunchTelemetrySamples([toLaunchTelemetrySample(telemetryEvent, sceneIndex)]);
        }

        scheduleUiUpdate(() => {
            setTrackLaunchState((prev) => ({
                ...prev,
                [track.id]: {
                    playingClipId: clip.id,
                    queuedClipId: undefined
                }
            }));
        }, delayMs + 24);
    }, [pushLaunchTelemetrySamples, scheduleUiUpdate, toLaunchTelemetrySample]);

    const queueSceneLaunchBatch = useCallback((
        entries: Array<{ track: Track; clip: Clip }>,
        launchAt: number,
        sceneIndex?: number
    ) => {
        if (entries.length === 0) return;

        const now = engineAdapter.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        setTrackLaunchState((prev) => {
            const next = { ...prev };
            entries.forEach(({ track, clip }) => {
                next[track.id] = {
                    ...(next[track.id] || {}),
                    queuedClipId: clip.id
                };
            });
            return next;
        });

        const telemetrySamples: SessionLaunchTelemetrySample[] = [];
        entries.forEach(({ track, clip }) => {
            const telemetryEvent = engineAdapter.launchClip(track, clip, launchAt);
            if (telemetryEvent) {
                telemetrySamples.push(toLaunchTelemetrySample(telemetryEvent, sceneIndex));
            }
        });
        pushLaunchTelemetrySamples(telemetrySamples);

        scheduleUiUpdate(() => {
            setTrackLaunchState((prev) => {
                const next = { ...prev };
                entries.forEach(({ track, clip }) => {
                    next[track.id] = {
                        playingClipId: clip.id,
                        queuedClipId: undefined
                    };
                });
                return next;
            });
        }, delayMs + 24);
    }, [pushLaunchTelemetrySamples, scheduleUiUpdate, toLaunchTelemetrySample]);

    const stopTrackLaunch = useCallback((trackId: string, launchAt: number) => {
        const now = engineAdapter.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        engineAdapter.stopTrackClips(trackId, launchAt);

        scheduleUiUpdate(() => {
            setTrackLaunchState((prev) => ({
                ...prev,
                [trackId]: {
                    playingClipId: undefined,
                    queuedClipId: undefined
                }
            }));
        }, delayMs + 24);
    }, [scheduleUiUpdate]);

    const getSceneSlotsForTrack = useCallback((track: Track): SceneSlot[] => {
        const slots: SceneSlot[] = Array.from({ length: SCENES }, () => ({ clip: null }));

        track.sessionClips.forEach((sessionSlot, index) => {
            if (index >= SCENES || !sessionSlot.clip) return;
            slots[index] = { clip: sessionSlot.clip };
        });

        if (slots.some((slot) => slot.clip)) {
            return slots;
        }

        const clipsByStart = [...track.clips].sort((a, b) => a.start - b.start);
        clipsByStart.forEach((clip) => {
            const sceneIndex = Math.floor(Math.max(0, clip.start - 1));
            if (sceneIndex >= SCENES) return;
            if (!slots[sceneIndex].clip) {
                slots[sceneIndex] = { clip };
            }
        });

        return slots;
    }, []);

    const sessionSlotsByTrack = useMemo(() => {
        return sessionTracks.reduce<Record<string, SceneSlot[]>>((acc, track) => {
            acc[track.id] = getSceneSlotsForTrack(track);
            return acc;
        }, {});
    }, [getSceneSlotsForTrack, sessionTracks]);

    const trackWindow = useMemo(() => {
        const baseWindow = buildSessionTrackWindow({
            totalTracks: sessionTracks.length,
            trackColumnWidthPx: TRACK_COLUMN_WIDTH_PX,
            trackGapPx: TRACK_COLUMN_GAP_PX,
            viewportLeftPx: trackViewport.left,
            viewportWidthPx: trackViewport.width,
            overscanTracks: TRACK_WINDOW_OVERSCAN
        });

        if (!overloadDecision.virtualizeTracks || sessionTracks.length === 0) {
            return {
                ...baseWindow,
                startIndex: 0,
                endIndex: sessionTracks.length - 1,
                leftSpacerPx: 0,
                rightSpacerPx: 0
            };
        }

        const maxVisible = overloadDecision.maxVisibleTrackColumns;
        if (!maxVisible || baseWindow.endIndex < baseWindow.startIndex) {
            return baseWindow;
        }

        const currentVisibleCount = (baseWindow.endIndex - baseWindow.startIndex) + 1;
        if (currentVisibleCount <= maxVisible) {
            return baseWindow;
        }

        const center = baseWindow.startIndex + Math.floor(currentVisibleCount / 2);
        let startIndex = Math.max(0, center - Math.floor(maxVisible / 2));
        let endIndex = Math.min(sessionTracks.length - 1, startIndex + maxVisible - 1);
        startIndex = Math.max(0, endIndex - maxVisible + 1);

        const stride = TRACK_COLUMN_WIDTH_PX + TRACK_COLUMN_GAP_PX;
        const leftSpacerPx = startIndex * stride;
        const visibleCount = (endIndex - startIndex) + 1;
        const visibleWidthPx = (visibleCount * TRACK_COLUMN_WIDTH_PX) + (Math.max(0, visibleCount - 1) * TRACK_COLUMN_GAP_PX);
        const rightSpacerPx = Math.max(0, baseWindow.totalWidthPx - leftSpacerPx - visibleWidthPx);

        return {
            ...baseWindow,
            startIndex,
            endIndex,
            leftSpacerPx,
            rightSpacerPx
        };
    }, [
        overloadDecision.maxVisibleTrackColumns,
        overloadDecision.virtualizeTracks,
        sessionTracks.length,
        trackViewport.left,
        trackViewport.width
    ]);

    const visibleTrackColumns = useMemo<VisibleTrackColumn[]>(() => {
        if (trackWindow.endIndex < trackWindow.startIndex || sessionTracks.length === 0) {
            return [];
        }

        const slice = sessionTracks.slice(trackWindow.startIndex, trackWindow.endIndex + 1);
        return slice.map((track, offset) => {
            const index = trackWindow.startIndex + offset;
            return {
                track,
                index,
                rightGapPx: index < sessionTracks.length - 1 ? TRACK_COLUMN_GAP_PX : 0
            };
        });
    }, [sessionTracks, trackWindow.endIndex, trackWindow.startIndex]);

    const clearReplayTimers = useCallback(() => {
        replayTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
        replayTimersRef.current = [];
    }, []);

    const buildSceneTrackClipRefs = useCallback((entries: Array<{ track: Track; clip: Clip }>): SceneTrackClipRef[] => {
        return entries.map(({ track, clip }) => ({
            trackId: track.id,
            clipId: clip.id
        }));
    }, []);

    const handleLaunch = useCallback((track: Track, clip: Clip, sceneIndex: number) => {
        if (track.type !== TrackType.AUDIO || !clip.buffer) return;

        const launchAt = computeLaunchAt();
        const trackState = trackLaunchState[track.id];
        const isSameClipPlaying = trackState?.playingClipId === clip.id && !trackState?.queuedClipId;

        if (isSameClipPlaying) {
            stopTrackLaunch(track.id, launchAt);
            return;
        }

        queueClipLaunch(track, clip, launchAt, sceneIndex);
    }, [computeLaunchAt, queueClipLaunch, stopTrackLaunch, trackLaunchState]);

    const handleSceneLaunch = useCallback((sceneIndex: number) => {
        const launchAt = computeLaunchAt();

        const entries = sessionTracks.flatMap((track) => {
            const slotClip = sessionSlotsByTrack[track.id]?.[sceneIndex]?.clip;
            if (!slotClip || !slotClip.buffer || track.type !== TrackType.AUDIO) {
                return [];
            }
            return [{ track, clip: slotClip }];
        });

        if (entries.length === 0) return;

        if (isSceneRecording) {
            const nextEvent = createSceneRecordingEvent(
                sceneIndex,
                launchAt,
                launchQuantizeBars,
                buildSceneTrackClipRefs(entries)
            );
            setSceneRecordingEvents((prev) => appendSceneRecordingEvent(prev, nextEvent, 1024));
        }

        queueSceneLaunchBatch(entries, launchAt, sceneIndex);
    }, [
        buildSceneTrackClipRefs,
        computeLaunchAt,
        isSceneRecording,
        launchQuantizeBars,
        queueSceneLaunchBatch,
        sessionSlotsByTrack,
        sessionTracks
    ]);

    const clearSceneRecording = useCallback(() => {
        clearReplayTimers();
        setIsSceneReplayRunning(false);
        setSceneRecordingEvents([]);
    }, [clearReplayTimers]);

    const resetLaunchTelemetry = useCallback(() => {
        setLaunchTelemetrySamples([]);
    }, []);

    const handleReplaySceneRecording = useCallback(() => {
        if (sceneRecordingEvents.length === 0 || isSceneReplayRunning) return;

        clearReplayTimers();
        const replayStartLaunchAtSec = computeLaunchAt();
        const replayPlan = buildSceneReplayPlan(sceneRecordingEvents, replayStartLaunchAtSec);
        if (replayPlan.length === 0) return;

        const now = engineAdapter.getContext().currentTime;
        setIsSceneReplayRunning(true);

        replayPlan.forEach((event, index) => {
            const delayMs = Math.max(0, Math.round((event.replayLaunchAtSec - now) * 1000));
            const timerId = window.setTimeout(() => {
                const entries = event.entries.flatMap((entry) => {
                    const track = sessionTracks.find((candidate) => candidate.id === entry.trackId);
                    if (!track || track.type !== TrackType.AUDIO) return [];

                    const slotClip = sessionSlotsByTrack[track.id]?.[event.sceneIndex]?.clip || null;
                    const clip = slotClip?.id === entry.clipId
                        ? slotClip
                        : track.clips.find((candidate) => candidate.id === entry.clipId);

                    if (!clip || !clip.buffer) return [];
                    return [{ track, clip }];
                });

                queueSceneLaunchBatch(entries, event.replayLaunchAtSec, event.sceneIndex);

                if (index === replayPlan.length - 1) {
                    const settleTimer = window.setTimeout(() => {
                        setIsSceneReplayRunning(false);
                    }, 160);
                    replayTimersRef.current.push(settleTimer);
                }
            }, delayMs);

            replayTimersRef.current.push(timerId);
        });
    }, [
        clearReplayTimers,
        computeLaunchAt,
        isSceneReplayRunning,
        queueSceneLaunchBatch,
        sceneRecordingEvents,
        sessionSlotsByTrack,
        sessionTracks
    ]);

    const stopAllSessionClips = useCallback(() => {
        const launchAt = computeLaunchAt();
        const now = engineAdapter.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        sessionTracks.forEach((track) => {
            engineAdapter.stopTrackClips(track.id, launchAt);
        });

        scheduleUiUpdate(() => {
            setTrackLaunchState((prev) => {
                const next = { ...prev };
                sessionTracks.forEach((track) => {
                    next[track.id] = {
                        playingClipId: undefined,
                        queuedClipId: undefined
                    };
                });
                return next;
            });
        }, delayMs + 24);
    }, [computeLaunchAt, scheduleUiUpdate, sessionTracks]);

    const handleSlotDrop = useCallback((event: React.DragEvent<HTMLDivElement>, trackId: string, sceneIndex: number) => {
        if (!onExternalDrop) return;

        event.preventDefault();
        const payload = readBrowserDragPayload(event.dataTransfer);
        if (!payload) return;

        onExternalDrop(trackId, sceneIndex, payload);
    }, [onExternalDrop]);

    const usePulseAnimation = overloadDecision.animationLevel === 'full';
    const showSlotFooter = overloadDecision.mode !== 'critical';
    const showOverloadBanner = overloadDecision.showOverloadBanner;

    return (
        <div ref={scrollContainerRef} className="flex-1 bg-[#111218] overflow-x-auto overflow-y-hidden relative p-4">
            {showOverloadBanner && (
                <div className="absolute top-2 right-3 z-30 px-2.5 py-1 rounded-sm border border-daw-ruby/45 bg-[#1a1115]/88 text-[9px] uppercase tracking-wider font-bold text-daw-ruby flex items-center gap-2">
                    <span>Audio Priority</span>
                    <span className={overloadDecision.mode === 'critical' ? 'text-red-300' : 'text-amber-300'}>{overloadDecision.mode.toUpperCase()}</span>
                    <span className="text-gray-400">{sessionTracks.length}T x {SCENES}S</span>
                </div>
            )}

            {launchTelemetrySummary.sampleCount > 0 && (
                <div className="absolute top-2 left-3 z-30 px-2.5 py-1 rounded-sm border border-white/15 bg-[#101420]/88 text-[9px] uppercase tracking-wider font-bold text-gray-200 flex items-center gap-2">
                    <span>Launch Gate</span>
                    <span className={launchTelemetrySummary.gatePass ? 'text-emerald-300' : 'text-red-300'}>
                        {launchTelemetrySummary.gatePass ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-gray-400">p95 {launchTelemetrySummary.p95LaunchErrorMs.toFixed(2)}ms</span>
                    <span className="text-gray-500">n={launchTelemetrySummary.sampleCount}</span>
                </div>
            )}

            <div className="flex gap-2 min-h-full">
                <div className="w-[76px] shrink-0 flex flex-col gap-2 sticky left-0 z-20">
                    <div className="h-8 rounded-sm border border-white/10 bg-[#171924] px-2 flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-400">
                        <span>Scene</span>
                        <Play size={10} className="text-daw-violet" />
                    </div>

                    <div className="h-8 rounded-sm border border-white/10 bg-[#171924] px-2 flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-400">
                        <Clock3 size={10} className="text-daw-cyan" />
                        <select
                            value={String(launchQuantizeBars)}
                            onChange={(event) => setLaunchQuantizeBars(Number(event.target.value))}
                            className="bg-transparent text-[9px] text-gray-300 outline-none"
                        >
                            {QUANTIZE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value} className="bg-[#111218]">
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button
                        onClick={stopAllSessionClips}
                        className="h-8 rounded-sm border border-daw-ruby/35 bg-daw-ruby/10 text-daw-ruby hover:bg-daw-ruby/20 transition-colors flex items-center justify-center"
                        title="Detener todos los clips"
                    >
                        <Square size={11} />
                    </button>

                    <div className="text-[9px] text-gray-500 uppercase tracking-wider text-center">{Math.round(bpm)} BPM</div>

                    <div className="grid grid-cols-2 gap-1">
                        <button
                            onClick={() => setIsSceneRecording((prev) => !prev)}
                            className={`h-6 rounded-sm border text-[8px] font-bold tracking-wider ${isSceneRecording ? 'border-red-400/70 bg-red-500/20 text-red-200' : 'border-white/10 bg-[#161a29] text-gray-300 hover:text-white'}`}
                            title="Scene Recording"
                        >
                            {isSceneRecording ? 'REC ON' : 'REC'}
                        </button>
                        <button
                            onClick={handleReplaySceneRecording}
                            disabled={sceneRecordingEvents.length === 0 || isSceneReplayRunning}
                            className={`h-6 rounded-sm border text-[8px] font-bold tracking-wider ${sceneRecordingEvents.length > 0 && !isSceneReplayRunning ? 'border-daw-cyan/60 bg-daw-cyan/15 text-daw-cyan hover:bg-daw-cyan/25' : 'border-white/10 bg-[#161a29] text-gray-500 cursor-not-allowed'}`}
                            title="Replay Scene Recording"
                        >
                            {isSceneReplayRunning ? 'RUN' : 'REPLAY'}
                        </button>
                        <button
                            onClick={clearSceneRecording}
                            disabled={sceneRecordingEvents.length === 0 && !isSceneReplayRunning}
                            className={`h-6 rounded-sm border text-[8px] font-bold tracking-wider ${sceneRecordingEvents.length > 0 || isSceneReplayRunning ? 'border-amber-400/60 bg-amber-500/12 text-amber-200 hover:bg-amber-500/20' : 'border-white/10 bg-[#161a29] text-gray-500 cursor-not-allowed'}`}
                            title="Clear Scene Recording"
                        >
                            CLR SCN
                        </button>
                        <button
                            onClick={resetLaunchTelemetry}
                            disabled={launchTelemetrySummary.sampleCount === 0}
                            className={`h-6 rounded-sm border text-[8px] font-bold tracking-wider ${launchTelemetrySummary.sampleCount > 0 ? 'border-daw-violet/60 bg-daw-violet/15 text-daw-violet hover:bg-daw-violet/25' : 'border-white/10 bg-[#161a29] text-gray-500 cursor-not-allowed'}`}
                            title="Reset Launch Telemetry"
                        >
                            CLR GATE
                        </button>
                    </div>

                    <div className="text-[8px] text-gray-500 uppercase tracking-wider text-center">
                        Scenes REC: {sceneRecordingEvents.length}
                    </div>

                    <div className="pt-[6px] flex flex-col gap-2">
                        {Array.from({ length: SCENES }).map((_, index) => (
                            <div key={`scene-launch-${index}`} className="h-24 flex items-center justify-center">
                                <button
                                    onClick={() => handleSceneLaunch(index)}
                                    className="w-7 h-7 rounded-full bg-[#1e2130] border border-white/10 hover:border-daw-violet/40 hover:bg-daw-violet/15 transition-colors flex items-center justify-center"
                                    title={`Lanzar escena ${index + 1}`}
                                >
                                    <Play size={10} className="text-gray-300 ml-[1px]" fill="currentColor" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="shrink-0 flex" style={{ width: `${trackWindow.totalWidthPx}px` }}>
                    {trackWindow.leftSpacerPx > 0 && (
                        <div className="shrink-0" style={{ width: `${trackWindow.leftSpacerPx}px` }} />
                    )}

                    {visibleTrackColumns.map((column) => {
                        const { track, rightGapPx } = column;
                        const slots = sessionSlotsByTrack[track.id] || [];
                        const state = trackLaunchState[track.id] || {};

                        return (
                            <div
                                key={track.id}
                                className="bg-[#171924] flex flex-col rounded-sm border border-daw-border shrink-0"
                                style={{
                                    width: `${TRACK_COLUMN_WIDTH_PX}px`,
                                    marginRight: `${rightGapPx}px`
                                }}
                            >
                                <div className="h-8 bg-[#202332] border-b border-daw-border flex items-center justify-between px-2">
                                    <span className="text-[10px] font-bold truncate text-gray-200 w-24 uppercase">{track.name}</span>
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: track.color }}></div>
                                </div>

                                <div className="flex-1 flex flex-col p-1 gap-2 bg-[#131622]">
                                    {Array.from({ length: SCENES }).map((_, sceneIndex) => {
                                        const slotClip = slots[sceneIndex]?.clip || null;
                                        const canPlay = Boolean(slotClip?.buffer) && track.type === TrackType.AUDIO;
                                        const isPlaying = slotClip ? state.playingClipId === slotClip.id : false;
                                        const isQueued = slotClip ? state.queuedClipId === slotClip.id : false;

                                        return (
                                            <div
                                                key={`scene-${sceneIndex}`}
                                                className={`h-24 rounded-[2px] border transition-all relative group ${slotClip
                                                    ? 'bg-[#25283a] border-[#373b51]'
                                                    : 'bg-[#151826] border-transparent opacity-60'}
                                                ${canPlay ? 'hover:bg-[#2d3148] cursor-pointer' : ''}`}
                                                onDragOver={(event) => {
                                                    if (!onExternalDrop) return;
                                                    event.preventDefault();
                                                    event.dataTransfer.dropEffect = 'copy';
                                                }}
                                                onDrop={(event) => handleSlotDrop(event, track.id, sceneIndex)}
                                            >
                                                {slotClip ? (
                                                    <div
                                                        className="w-full h-full p-2 flex flex-col justify-between"
                                                        onClick={() => {
                                                            onClipSelect?.(track.id, slotClip.id);
                                                            if (canPlay) {
                                                                handleLaunch(track, slotClip, sceneIndex);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex justify-between items-start gap-2">
                                                            <span className="text-[9px] font-bold text-white truncate px-1 bg-black/40 rounded-sm">{slotClip.name}</span>
                                                            {!canPlay && (
                                                                <span className="text-[8px] uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded-sm px-1">
                                                                    MIDI
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className="flex items-center justify-center">
                                                            {isPlaying ? (
                                                                <div className={`w-8 h-8 rounded-full bg-green-500/90 flex items-center justify-center ${usePulseAnimation ? 'animate-pulse shadow-[0_0_12px_rgba(34,197,94,0.55)]' : ''}`}>
                                                                    <Play size={13} fill="white" className="text-white ml-[1px]" />
                                                                </div>
                                                            ) : isQueued ? (
                                                                <div className="w-8 h-8 rounded-full border border-daw-violet/65 bg-daw-violet/20 flex items-center justify-center shadow-[0_0_10px_rgba(168,85,247,0.35)]">
                                                                    <Clock3 size={12} className="text-daw-violet" />
                                                                </div>
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all group-hover:scale-110" style={{ borderColor: track.color }}>
                                                                    <Play size={10} fill={track.color} className="ml-[1px]" style={{ color: track.color }} />
                                                                </div>
                                                            )}
                                                        </div>

                                                        {showSlotFooter && (
                                                            <div className="text-[8px] text-gray-500 font-mono text-center uppercase">
                                                                {slotClip.length.toFixed(2)} BAR
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-600 uppercase tracking-wider">
                                                        Vacio
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}

                    {trackWindow.rightSpacerPx > 0 && (
                        <div className="shrink-0" style={{ width: `${trackWindow.rightSpacerPx}px` }} />
                    )}
                </div>
            </div>
        </div>
    );
};

export default SessionView;
