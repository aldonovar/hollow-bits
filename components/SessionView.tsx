import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock3, Play, Square } from 'lucide-react';
import { Clip, Track, TrackType } from '../types';
import { audioEngine } from '../services/audioEngine';
import { BROWSER_DRAG_MIME, BrowserDragPayload, parseBrowserDragPayload } from '../services/browserDragService';

interface SessionViewProps {
    tracks: Track[];
    bpm: number;
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

const SCENES = 8;
const QUANTIZE_OPTIONS = [
    { value: 0.25, label: '1/4 Bar' },
    { value: 0.5, label: '1/2 Bar' },
    { value: 1, label: '1 Bar' },
    { value: 2, label: '2 Bars' }
];

const SessionView: React.FC<SessionViewProps> = ({ tracks, bpm, onExternalDrop, onClipSelect }) => {
    const [trackLaunchState, setTrackLaunchState] = useState<Record<string, TrackLaunchState>>({});
    const [launchQuantizeBars, setLaunchQuantizeBars] = useState<number>(1);
    const pendingTimersRef = useRef<number[]>([]);
    const sessionTracks = useMemo(
        () => tracks.filter((track) => track.type === TrackType.AUDIO || track.type === TrackType.MIDI),
        [tracks]
    );

    useEffect(() => {
        return () => {
            pendingTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
            pendingTimersRef.current = [];
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
        if (delayMs <= 1) {
            callback();
            return;
        }

        const timerId = window.setTimeout(callback, delayMs);
        pendingTimersRef.current.push(timerId);
    }, []);

    const computeLaunchAt = useCallback(() => {
        return audioEngine.getSessionLaunchTime(launchQuantizeBars);
    }, [launchQuantizeBars]);

    const queueClipLaunch = useCallback((track: Track, clip: Clip, launchAt: number) => {
        if (track.type !== TrackType.AUDIO || !clip.buffer) return;

        const now = audioEngine.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        setTrackLaunchState((prev) => ({
            ...prev,
            [track.id]: {
                ...(prev[track.id] || {}),
                queuedClipId: clip.id
            }
        }));

        audioEngine.launchClip(track, clip, launchAt);

        scheduleUiUpdate(() => {
            setTrackLaunchState((prev) => ({
                ...prev,
                [track.id]: {
                    playingClipId: clip.id,
                    queuedClipId: undefined
                }
            }));
        }, delayMs + 24);
    }, [scheduleUiUpdate]);

    const stopTrackLaunch = useCallback((trackId: string, launchAt: number) => {
        const now = audioEngine.getContext().currentTime;
        const delayMs = Math.max(0, Math.round((launchAt - now) * 1000));

        audioEngine.stopTrackClips(trackId, launchAt);

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

    const handleLaunch = useCallback((track: Track, clip: Clip) => {
        if (track.type !== TrackType.AUDIO || !clip.buffer) return;

        const launchAt = computeLaunchAt();
        const trackState = trackLaunchState[track.id];
        const isSameClipPlaying = trackState?.playingClipId === clip.id && !trackState?.queuedClipId;

        if (isSameClipPlaying) {
            stopTrackLaunch(track.id, launchAt);
            return;
        }

        queueClipLaunch(track, clip, launchAt);
    }, [computeLaunchAt, queueClipLaunch, stopTrackLaunch, trackLaunchState]);

    const handleSceneLaunch = useCallback((sceneIndex: number) => {
        const launchAt = computeLaunchAt();

        sessionTracks.forEach((track) => {
            const slotClip = sessionSlotsByTrack[track.id]?.[sceneIndex]?.clip;
            if (!slotClip || !slotClip.buffer || track.type !== TrackType.AUDIO) return;
            queueClipLaunch(track, slotClip, launchAt);
        });
    }, [computeLaunchAt, queueClipLaunch, sessionSlotsByTrack, sessionTracks]);

    const stopAllSessionClips = useCallback(() => {
        const launchAt = computeLaunchAt();
        sessionTracks.forEach((track) => {
            stopTrackLaunch(track.id, launchAt);
        });
    }, [computeLaunchAt, stopTrackLaunch, sessionTracks]);

    const handleSlotDrop = useCallback((event: React.DragEvent<HTMLDivElement>, trackId: string, sceneIndex: number) => {
        if (!onExternalDrop) return;

        event.preventDefault();
        const payload = parseBrowserDragPayload(event.dataTransfer.getData(BROWSER_DRAG_MIME));
        if (!payload) return;

        onExternalDrop(trackId, sceneIndex, payload);
    }, [onExternalDrop]);

    return (
        <div className="flex-1 bg-[#111218] overflow-x-auto overflow-y-hidden flex p-4 gap-2">
            <div className="w-[76px] shrink-0 flex flex-col gap-2">
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

            {sessionTracks.map((track) => {
                const slots = sessionSlotsByTrack[track.id] || [];
                const state = trackLaunchState[track.id] || {};

                return (
                    <div key={track.id} className="w-36 bg-[#171924] flex flex-col rounded-sm border border-daw-border shrink-0">
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
                                                        handleLaunch(track, slotClip);
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
                                                        <div className="w-8 h-8 rounded-full bg-green-500/90 animate-pulse flex items-center justify-center shadow-[0_0_12px_rgba(34,197,94,0.55)]">
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

                                                <div className="text-[8px] text-gray-500 font-mono text-center uppercase">
                                                    {slotClip.length.toFixed(2)} BAR
                                                </div>
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
        </div>
    );
};

export default SessionView;
