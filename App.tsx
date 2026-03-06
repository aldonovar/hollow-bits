// path: src/App.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Transport from './components/Transport';
import DeviceRack from './components/DeviceRack';
import Timeline from './components/Timeline';
import Mixer from './components/Mixer';
import Editor from './components/Editor';
import Browser from './components/Browser';
import type { ApplyScanPayload } from './components/NoteScannerPanel';
import AppLogo from './components/AppLogo';
import SessionView from './components/SessionView';
import Modal from './components/Modal';
import { FluidPanel } from './components/FluidPanel';
import AsciiPerformerDock from './components/AsciiPerformerDock';
import CollabPanel, { CollabActivityEntry } from './components/CollabPanel';
import { INITIAL_TRACKS, getTrackColorByPosition } from './constants';
import { LoopMode, Note, Track, TransportState, TrackType, AudioSettings, Clip, ProjectData, AutomationMode, ScannedFileEntry } from './types';
import { engineAdapter, type EngineDiagnostics } from './services/engineAdapter';
import { midiService, MidiDevice } from './services/MidiService';
import { platformService } from './services/platformService';
import { assetDb } from './services/db';
import {
    createTrack,
    removeTrackRoutingReferences,
    withTrackRuntimeDefaults
} from './services/projectCoreService';
import type { BrowserDragPayload } from './services/browserDragService';
import {
    AUTOMATION_TARGETS,
    denormalizeTrackParam,
    getLaneByParam,
    getTrackParamValue,
    normalizeTrackParam,
    sampleAutomationLaneAtBar,
    writeAutomationPoint
} from './services/automationService';
import { sanitizeAudioSettingsCandidate } from './services/audioSettingsNormalizer';
import {
    CollabCommandRecord,
    loadCollabSessionSnapshot,
    saveCollabSessionSnapshot
} from './services/collabSessionService';
import {
    ProjectAutosaveSnapshot,
    clearAutosaveSnapshot,
    getLatestAutosaveSnapshot,
    saveAutosaveSnapshot,
    startRecoverySession,
    stopRecoverySession
} from './services/projectRecoveryService';
import {
    barTimeToPosition,
    barToSeconds,
    getLoopEndAction,
    getSecondsPerBar,
    positionToBarTime,
    shouldRestartAtSongBoundary
} from './services/transportStateService';
import {
    buildRecordingTakeCommit,
    commitRecordingTakeBatch
} from './services/recordingTakeService';
import {
    applyCompClipEdits,
    isCompDerivedClipId,
    promoteTakeToComp,
    resolvePunchRecordingPlan,
    splitTakeForClip,
    syncTakeMetadataForClip,
    updateTrackPunchRange
} from './services/takeCompingService';
import { useUndoRedo } from './hooks/useUndoRedo';
import {
    FolderInput, Settings, Cpu, LayoutGrid, Search, Users, Layers, Sliders, Sparkles, AlertTriangle, Undo2, Redo2, PlayCircle, Folder, HardDrive, Save, Trash2, Piano
} from 'lucide-react';
import { HardwareSettingsModal } from './components/HardwareSettingsModal';

const AISidebar = React.lazy(() => import('./components/AISidebar'));
const NoteScannerPanel = React.lazy(() => import('./components/NoteScannerPanel'));
const ExportModal = React.lazy(() => import('./components/ExportModal'));

// --- ATOMIC COMPONENTS (Extracted for Performance) ---

interface SidebarItemProps {
    icon: React.ElementType;
    label: string;
    active?: boolean;
    onClick: () => void;
    color?: string;
}

const SidebarItem: React.FC<SidebarItemProps> = React.memo(({ icon: Icon, label, active = false, onClick, color }) => (
    <button
        onClick={onClick}
        className={`w-10 h-10 flex items-center justify-center relative group rounded-sm transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${active
                ? 'bg-gradient-to-br from-purple-500/20 to-rose-500/20 text-white shadow-[0_0_20px_rgba(168,85,247,0.15)] ring-1 ring-white/10 scale-100'
                : 'text-gray-500 hover:text-white hover:bg-white/5 hover:scale-105 active:scale-95'
            }
      `}
        title={label}
    >
        {/* Active Indicator Strip */}
        {active && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-gradient-to-b from-purple-500 to-rose-500 rounded-r-full shadow-[0_0_8px_rgba(244,63,94,0.6)] animate-in fade-in duration-300"></span>
        )}

        {/* Hover Gradient Overlay */}
        {!active && (
            <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/10 to-rose-500/10 opacity-0 group-hover:opacity-100 rounded-sm transition-opacity duration-300 pointer-events-none" />
        )}

        <Icon
            size={18}
            strokeWidth={active ? 2 : 1.5}
            className={`transition-all duration-300 relative z-10 ${active ? 'text-white drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]' : color || 'text-current group-hover:text-purple-200'}`}
        />
    </button>
));

const getNextLoopMode = (mode: LoopMode): LoopMode => {
    if (mode === 'off') return 'once';
    if (mode === 'once') return 'infinite';
    return 'off';
};

const normalizeLoopMode = (transport: Partial<TransportState>): LoopMode => {
    if (transport.loopMode === 'off' || transport.loopMode === 'once' || transport.loopMode === 'infinite') {
        return transport.loopMode;
    }
    if (transport.isLooping) return 'infinite';
    return 'off';
};

interface ImportAudioSource {
    name: string;
    arrayBuffer: ArrayBuffer;
    persistBlob?: Blob;
}

interface ClipDropDestination {
    trackId?: string;
    bar?: number;
    sceneIndex?: number;
    placeInSession?: boolean;
}

type MixSnapshotSlot = 'A' | 'B';

interface TrackMixSnapshot {
    volume: number;
    pan: number;
    reverb: number;
    isMuted: boolean;
    isSoloed: boolean;
    monitor: Track['monitor'];
    sends?: Record<string, number>;
    sendModes?: Record<string, 'pre' | 'post'>;
    groupId?: string;
    vcaGroupId?: string;
    soloSafe?: boolean;
}

interface MixSnapshot {
    capturedAt: number;
    masterVolumeDb: number;
    tracks: Record<string, TrackMixSnapshot>;
}

interface RecordingSessionMeta {
    recordingStartBar: number;
    latencyCompensationBars: number;
    sourceTrimOffsetBars?: number;
    punchOutBar?: number;
}

type ToolPanel = 'browser' | 'ai' | 'scanner' | null;

const AUDIO_SETTINGS_STORAGE_KEY = 'hollowbits.audio-settings.v1';
const AUDIO_SETTINGS_STORAGE_KEY_LEGACY = 'ethereal.audio-settings.v1';
const AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY = 'hollowbits.audio-effective-settings.v1';
const AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY_LEGACY = 'ethereal.audio-effective-settings.v1';
const BLOCK1_KPI_STORAGE_KEY = 'hollowbits.block1-kpi.v1';
const MIN_CLIP_LENGTH_BARS = 0.0625;
const AUTOSAVE_DEBOUNCE_MS = 1200;
const IMPORT_AUDIO_CONCURRENCY = 2;

const buildRuntimeId = (prefix: string): string => {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
};

const getDefaultAudioSettings = (): AudioSettings => ({
    sampleRate: 48000,
    bufferSize: 'auto',
    latencyHint: 'interactive'
});

const sanitizeAudioSettings = (candidate: Partial<AudioSettings> | null | undefined): AudioSettings => {
    const defaults = getDefaultAudioSettings();
    return sanitizeAudioSettingsCandidate(candidate, defaults);
};

const loadAudioSettingsFromStorage = (): AudioSettings => {
    try {
        const raw = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<AudioSettings>;
            return sanitizeAudioSettings(parsed);
        }

        const legacyRaw = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY_LEGACY);
        if (!legacyRaw) return getDefaultAudioSettings();

        const parsedLegacy = sanitizeAudioSettings(JSON.parse(legacyRaw) as Partial<AudioSettings>);
        localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(parsedLegacy));
        localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY_LEGACY);
        return parsedLegacy;
    } catch (error) {
        console.warn('No se pudieron leer preferencias de audio guardadas.', error);
        return getDefaultAudioSettings();
    }
};

const migrateLegacyEffectiveAudioSettings = (): void => {
    try {
        if (localStorage.getItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY)) {
            localStorage.removeItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY_LEGACY);
            return;
        }

        const legacyRaw = localStorage.getItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY_LEGACY);
        if (!legacyRaw) return;

        localStorage.setItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY, legacyRaw);
        localStorage.removeItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY_LEGACY);
    } catch {
        // Non-blocking migration path.
    }
};

const toPersistentClip = (clip: Clip): Clip => {
    const { buffer, isOffline, ...persistentClip } = clip;
    return persistentClip;
};

const App: React.FC = () => {
    const initialCollabSnapshot = useMemo(() => loadCollabSessionSnapshot(), []);

    // --- STATE ---
    const [projectName, setProjectName] = useState("Sin TÃ­tulo");
    const [loadingProject, setLoadingProject] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("");
    const [importProgress, setImportProgress] = useState<{ total: number; completed: number; currentFile: string | null } | null>(null);

    // Undo/Redo Hook
    const { state: tracks, setState: setTracks, setStateNoHistory: setTracksNoHistory, undo, redo, canUndo, canRedo } = useUndoRedo<Track[]>(INITIAL_TRACKS);

    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(INITIAL_TRACKS[0]?.id || null);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(INITIAL_TRACKS[0]?.clips[0]?.id || null);
    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);

    // Views
    const [mainView, setMainView] = useState<'arrange' | 'session' | 'mixer'>('arrange');
    const [bottomView, setBottomView] = useState<'devices' | 'editor'>('devices');
    const [mixSnapshots, setMixSnapshots] = useState<Partial<Record<MixSnapshotSlot, MixSnapshot>>>({});
    const [activeMixSnapshot, setActiveMixSnapshot] = useState<MixSnapshotSlot | null>(null);
    const [projectCommandCount, setProjectCommandCount] = useState(() => initialCollabSnapshot.commandCount);
    const [collabSessionId, setCollabSessionId] = useState<string | null>(() => initialCollabSnapshot.sessionId);
    const [collabUserName, setCollabUserName] = useState(() => initialCollabSnapshot.userName);
    const [collabActivity, setCollabActivity] = useState<CollabActivityEntry[]>(() => initialCollabSnapshot.activity);
    const [collabCommandJournal, setCollabCommandJournal] = useState<CollabCommandRecord[]>(() => initialCollabSnapshot.commandJournal);

    // Side Panels
    const [activeToolPanel, setActiveToolPanel] = useState<ToolPanel>(null);
    const [hasLoadedAISidebar, setHasLoadedAISidebar] = useState(false);
    const [hasLoadedNoteScanner, setHasLoadedNoteScanner] = useState(false);
    const [hasLoadedExportModal, setHasLoadedExportModal] = useState(false);

    // Menus & Modals
    const [showFileMenu, setShowFileMenu] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [activeModal, setActiveModal] = useState<'settings' | 'help' | 'collab' | 'new-project-confirm' | 'recovery' | null>(null);
    const [showExportModal, setShowExportModal] = useState(false);
    const [recoverySnapshot, setRecoverySnapshot] = useState<ProjectAutosaveSnapshot | null>(null);
    const [lastAutosaveAt, setLastAutosaveAt] = useState<number | null>(null);
    const [lastAutosaveReason, setLastAutosaveReason] = useState<string>('initial-snapshot');

    const showBrowser = activeToolPanel === 'browser';
    const showAI = activeToolPanel === 'ai';
    const showNoteScanner = activeToolPanel === 'scanner';

    useEffect(() => {
        if (showAI) {
            setHasLoadedAISidebar(true);
        }
    }, [showAI]);

    useEffect(() => {
        if (showNoteScanner) {
            setHasLoadedNoteScanner(true);
        }
    }, [showNoteScanner]);

    useEffect(() => {
        if (showExportModal) {
            setHasLoadedExportModal(true);
        }
    }, [showExportModal]);

    // Zoom & UI
    const [zoom] = useState(40);
    const [trackHeight] = useState(92);

    // Engine State
    const [audioSettings, setAudioSettings] = useState<AudioSettings>(() => loadAudioSettingsFromStorage());
    const [engineStats, setEngineStats] = useState<EngineDiagnostics>({
        sampleRate: 0,
        latency: 0,
        state: 'closed',
        requestedSampleRate: audioSettings.sampleRate,
        activeSampleRate: 0,
        sampleRateMismatch: false,
        sampleRateMismatchMessage: null,
        highLoadDetected: false,
        profileSuggestion: null,
        configuredBufferSize: audioSettings.bufferSize,
        effectiveBufferSize: 0,
        bufferStrategy: 'auto',
        lookaheadMs: 25,
        scheduleAheadTimeMs: 100,
        schedulerMode: engineAdapter.getSchedulerMode(),
        schedulerP95TickDriftMs: 0,
        schedulerP99TickDriftMs: 0,
        schedulerP99LoopMs: 0
    });

    // Refs
    const fileMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Project Input Ref removed
    const timelineContainerRef = useRef<HTMLDivElement>(null);
    const recordingSessionMetaRef = useRef<Map<string, RecordingSessionMeta>>(new Map());
    const finalizeRecordingsPromiseRef = useRef<Promise<void> | null>(null);
    const loopOnceRemainingRef = useRef(0);
    const automationTouchUntilRef = useRef<Map<string, number>>(new Map());
    const automationLatchActiveRef = useRef<Set<string>>(new Set());
    const automationLastWriteRef = useRef<Map<string, number>>(new Map());
    const wasPlayingRef = useRef(false);
    const monoCheckStateRef = useRef<{ active: boolean; pans: Record<string, number> }>({ active: false, pans: {} });
    const lastCollabCommandRef = useRef(initialCollabSnapshot.commandCount);
    const collabHydratedRef = useRef(false);
    const pendingCollabReasonsRef = useRef<string[]>([]);
    const playbackSilenceGuardRef = useRef<{ lastAudibleAt: number; recovering: boolean }>({
        lastAudibleAt: Date.now(),
        recovering: false
    });
    const latestTracksRef = useRef<Track[]>(tracks);
    const trackSyncQueuedRef = useRef(false);
    const trackSyncFrameRef = useRef<number | null>(null);
    const boundaryTransitionInFlightRef = useRef(false);
    const finalizeActiveRecordingsRef = useRef<(() => Promise<void>) | null>(null);
    const hasActiveRecordingSessionsRef = useRef<(() => boolean) | null>(null);

    // Audio Lock Ref (Prevents double-fire on rapid clicks)
    const isPlayingRef = useRef(false);
    const transportCommandTokenRef = useRef(0);
    const pauseResumeArmedRef = useRef(false);

    const [transport, setTransport] = useState<TransportState>({
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
    });

    const applyTrackGradientColors = useCallback((sourceTracks: Track[]): Track[] => {
        if (sourceTracks.length === 0) return sourceTracks;

        const used = new Set<string>();
        const total = sourceTracks.length;
        let changed = false;

        const recoloredTracks = sourceTracks.map((track, index) => {
            let color = getTrackColorByPosition(index, total);
            let guard = 0;

            while (used.has(color.toLowerCase()) && guard < 40) {
                guard += 1;
                color = getTrackColorByPosition(index, total, guard);
            }
            used.add(color.toLowerCase());

            const clipsNeedUpdate = track.clips.some((clip) => clip.color !== color);
            if (track.color === color && !clipsNeedUpdate) {
                return track;
            }

            changed = true;

            return {
                ...track,
                color,
                clips: clipsNeedUpdate
                    ? track.clips.map((clip) => ({ ...clip, color }))
                    : track.clips
            };
        });

        return changed ? recoloredTracks : sourceTracks;
    }, []);

    const toggleToolPanel = useCallback((panel: Exclude<ToolPanel, null>) => {
        setActiveToolPanel((prev) => (prev === panel ? null : panel));
    }, []);

    const closeAllToolPanels = useCallback(() => {
        setActiveToolPanel(null);
    }, []);

    interface TrackMutationOptions {
        noHistory?: boolean;
        recolor?: boolean;
        reason?: string;
    }

    const applyTrackMutation = useCallback((
        recipe: (currentTracks: Track[]) => Track[],
        options?: TrackMutationOptions
    ) => {
        const updater = options?.noHistory ? setTracksNoHistory : setTracks;

        updater((prevTracks) => {
            const nextTracks = recipe(prevTracks);
            if (nextTracks === prevTracks) return prevTracks;
            if (!options?.noHistory) {
                pendingCollabReasonsRef.current.push(options?.reason || 'track-mutation');
                setProjectCommandCount((count) => count + 1);
            }
            return options?.recolor ? applyTrackGradientColors(nextTracks) : nextTracks;
        });
    }, [applyTrackGradientColors, setTracks, setTracksNoHistory]);

    const updateTrackById = useCallback((trackId: string, updates: Partial<Track>, options?: TrackMutationOptions) => {
        applyTrackMutation((prevTracks) => prevTracks.map((track) => (
            track.id === trackId
                ? (
                    updates.punchRange
                        ? updateTrackPunchRange({ ...track, ...updates }, updates.punchRange)
                        : { ...track, ...updates }
                )
                : track
        )), options);
    }, [applyTrackMutation]);

    const updateClipById = useCallback((trackId: string, clipId: string, updates: Partial<Clip>, options?: TrackMutationOptions) => {
        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.id !== trackId) return track;

            if (isCompDerivedClipId(clipId)) {
                return applyCompClipEdits(track, clipId, updates);
            }

            let clipChanged = false;
            const nextClips = track.clips.map((clip) => {
                if (clip.id !== clipId) return clip;
                clipChanged = true;
                return { ...clip, ...updates };
            });

            let sessionClipChanged = false;
            const nextSessionClips = track.sessionClips.map((slot) => {
                if (!slot.clip || slot.clip.id !== clipId) return slot;
                sessionClipChanged = true;
                return {
                    ...slot,
                    clip: { ...slot.clip, ...updates }
                };
            });

            if (!clipChanged && !sessionClipChanged) {
                return track;
            }

            const updatedTrack = {
                ...track,
                clips: nextClips,
                sessionClips: nextSessionClips
            };
            return syncTakeMetadataForClip(updatedTrack, clipId);
        }), options);
    }, [applyTrackMutation]);

    const appendTrack = useCallback((track: Track, options?: TrackMutationOptions) => {
        applyTrackMutation((prevTracks) => [...prevTracks, track], { ...options, recolor: options?.recolor ?? false });
    }, [applyTrackMutation]);

    const appendTracks = useCallback((nextTracks: Track[], options?: TrackMutationOptions) => {
        applyTrackMutation((prevTracks) => [...prevTracks, ...nextTracks], { ...options, recolor: options?.recolor ?? false });
    }, [applyTrackMutation]);

    const replaceTracks = useCallback((nextTracks: Track[], options?: TrackMutationOptions) => {
        applyTrackMutation(() => nextTracks, options);
    }, [applyTrackMutation]);

    // --- INIT & LOOPS ---
    useEffect(() => {
        engineAdapter.init(audioSettings);
        midiService.init();
        assetDb.init().catch(console.error);
        migrateLegacyEffectiveAudioSettings();

        const unsubscribe = midiService.subscribeDevices((devices: MidiDevice[]) => {
            setMidiDevices(devices.filter(d => d.type === 'input'));
        });

        const interval = setInterval(() => {
            const diagnostics = engineAdapter.getDiagnostics();
            setEngineStats(diagnostics);

            try {
                localStorage.setItem(BLOCK1_KPI_STORAGE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    route: engineAdapter.getBackendRoute(),
                    schedulerMode: diagnostics.schedulerMode || 'interval',
                    driftP95Ms: diagnostics.schedulerP95TickDriftMs || 0,
                    driftP99Ms: diagnostics.schedulerP99TickDriftMs || 0,
                    loopP99Ms: diagnostics.schedulerP99LoopMs || 0,
                    cpuLoadP95Percent: diagnostics.schedulerCpuLoadP95Percent || 0,
                    overrunRatio: diagnostics.schedulerOverrunRatio || 0,
                    underrunCount: diagnostics.schedulerUnderrunCount || 0,
                    dropoutCount: diagnostics.schedulerDropoutCount || 0,
                    monitorLatencyMs: (diagnostics.latency || 0) * 1000
                }));
            } catch {
                // Non-blocking KPI persistence path.
            }
        }, 1000);

        const handleClickOutside = (event: MouseEvent) => {
            if (fileMenuRef.current && !fileMenuRef.current.contains(event.target as Node)) {
                setShowFileMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            unsubscribe();
            clearInterval(interval);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        try {
            localStorage.setItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY, JSON.stringify({
                sampleRate: engineStats.activeSampleRate,
                latencyHint: audioSettings.latencyHint,
                bufferSize: audioSettings.bufferSize,
                updatedAt: Date.now()
            }));
            localStorage.removeItem(AUDIO_EFFECTIVE_SETTINGS_STORAGE_KEY_LEGACY);
        } catch {
            // Non-blocking diagnostics persistence.
        }
    }, [audioSettings.bufferSize, audioSettings.latencyHint, engineStats.activeSampleRate]);

    useEffect(() => {
        engineAdapter.setAudioConfiguration(audioSettings);
        try {
            localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(audioSettings));
            localStorage.removeItem(AUDIO_SETTINGS_STORAGE_KEY_LEGACY);
        } catch (error) {
            console.warn('No se pudieron guardar preferencias de audio.', error);
        }
    }, [audioSettings]);

    // Sync Ref with State when stopped externally (e.g. end of song)
    useEffect(() => {
        isPlayingRef.current = transport.isPlaying;
    }, [transport.isPlaying]);

    useEffect(() => {
        loopOnceRemainingRef.current = transport.loopMode === 'once' ? 1 : 0;
    }, [transport.loopMode]);

    useEffect(() => {
        if (tracks.length === 0) {
            if (selectedTrackId !== null) setSelectedTrackId(null);
            if (selectedClipId !== null) setSelectedClipId(null);
            return;
        }

        const activeTrack = selectedTrackId ? tracks.find((track) => track.id === selectedTrackId) : null;
        if (!activeTrack) {
            const fallbackTrack = tracks[0];
            setSelectedTrackId(fallbackTrack?.id ?? null);
            setSelectedClipId(fallbackTrack?.clips[0]?.id ?? null);
            return;
        }

        if (selectedClipId && activeTrack.clips.some((clip) => clip.id === selectedClipId)) {
            return;
        }

        const nextClipId = activeTrack.clips[0]?.id ?? null;
        if (selectedClipId !== nextClipId) {
            setSelectedClipId(nextClipId);
        }
    }, [selectedClipId, selectedTrackId, tracks]);

    useEffect(() => {
        collabHydratedRef.current = true;
    }, []);

    useEffect(() => {
        if (!collabHydratedRef.current) return;

        const reason = pendingCollabReasonsRef.current.shift();
        if (!reason) return;

        const now = Date.now();
        setCollabCommandJournal((prev) => ([
            {
                id: `cmd-${projectCommandCount}-${now}`,
                timestamp: now,
                commandIndex: projectCommandCount,
                reason
            },
            ...prev
        ].slice(0, 240)));
    }, [projectCommandCount]);

    useEffect(() => {
        if (!collabHydratedRef.current) return;

        saveCollabSessionSnapshot({
            sessionId: collabSessionId,
            userName: collabUserName,
            commandCount: projectCommandCount,
            activity: collabActivity,
            commandJournal: collabCommandJournal,
            updatedAt: Date.now()
        });
    }, [collabActivity, collabCommandJournal, collabSessionId, collabUserName, projectCommandCount]);

    // Sync Tracks with Audio Engine
    useEffect(() => {
        latestTracksRef.current = tracks;
    }, [tracks]);

    useEffect(() => {
        if (trackSyncQueuedRef.current) {
            return;
        }

        trackSyncQueuedRef.current = true;
        trackSyncFrameRef.current = window.requestAnimationFrame(() => {
            trackSyncQueuedRef.current = false;
            trackSyncFrameRef.current = null;
            engineAdapter.updateTracks(latestTracksRef.current);
        });
    }, [tracks]);

    useEffect(() => {
        return () => {
            if (trackSyncFrameRef.current !== null) {
                window.cancelAnimationFrame(trackSyncFrameRef.current);
            }
            trackSyncFrameRef.current = null;
            trackSyncQueuedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (!transport.isPlaying) {
            playbackSilenceGuardRef.current.lastAudibleAt = Date.now();
            playbackSilenceGuardRef.current.recovering = false;
            return;
        }

        const interval = window.setInterval(() => {
            const diagnostics = engineAdapter.getRuntimeDiagnostics();
            const meter = engineAdapter.getMasterMeter();
            const audible = meter.peakDb > -58 || meter.rmsDb > -62;

            if (audible || diagnostics.activeSourceCount === 0) {
                playbackSilenceGuardRef.current.lastAudibleAt = Date.now();
                return;
            }

            const silenceMs = Date.now() - playbackSilenceGuardRef.current.lastAudibleAt;
            if (silenceMs < 1400 || playbackSilenceGuardRef.current.recovering) {
                return;
            }

            playbackSilenceGuardRef.current.recovering = true;

            void engineAdapter.recoverPlaybackGraph(latestTracksRef.current)
                .catch((error) => {
                    console.warn('Audio silence guard recovery failed.', error);
                })
                .finally(() => {
                    window.setTimeout(() => {
                        playbackSilenceGuardRef.current.recovering = false;
                    }, 600);
                });
        }, 320);

        return () => window.clearInterval(interval);
    }, [transport.isPlaying]);

    // --- HELPER: GET PROJECT DURATION ---
    const projectEndBar = useMemo(() => {
        let maxBar = 0;
        tracks.forEach((t: Track) => {
            t.clips.forEach((c: Clip) => {
                const end = c.start + c.length;
                if (end > maxBar) maxBar = end;
            });
        });
        // Tight loop: Use exact maxBar if content exists, otherwise default to 8.
        return maxBar > 0 ? maxBar : 8;
    }, [tracks]);

    const getProjectEndBar = useCallback(() => projectEndBar, [projectEndBar]);

    // Dynamic Calculation of Total Bars for Infinite Scroll
    const totalProjectBars = useMemo(() => {
        return Math.max(200, projectEndBar + 40); // Base 200, or End + padding
    }, [projectEndBar]);

    // --- HANDLE LOOPING & END OF SONG (Transport display now synced from Timeline) ---
    useEffect(() => {
        let animationFrame: number;

        const checkLoopAndEnd = () => {
            if (transport.isPlaying) {
                const currentProjectTime = engineAdapter.getCurrentTime();

                // Check for Loop / End of Song
                const endBar = getProjectEndBar();
                const endSeconds = barToSeconds(endBar, transport.bpm);

                if (currentProjectTime >= endSeconds && endSeconds > 0) {
                    const loopAction = getLoopEndAction(transport.loopMode, loopOnceRemainingRef.current);
                    const applyBoundaryAction = (): boolean => {
                        if (loopAction.action === 'restart') {
                            loopOnceRemainingRef.current = loopAction.nextOnceRemaining;
                            engineAdapter.seek(0, tracks, transport.bpm);
                            setTransport((prev: TransportState) => ({
                                ...prev,
                                currentBar: 1,
                                currentBeat: 1,
                                currentSixteenth: 1,
                                ...(loopAction.nextLoopMode ? { loopMode: loopAction.nextLoopMode } : {})
                            }));
                            return false;
                        }

                        loopOnceRemainingRef.current = loopAction.nextOnceRemaining;
                        engineAdapter.stop(true);
                        isPlayingRef.current = false;
                        pauseResumeArmedRef.current = false;
                        setTransport((prev: TransportState) => ({
                            ...prev,
                            isPlaying: false,
                            isRecording: false,
                            currentBar: 1,
                            currentBeat: 1,
                            currentSixteenth: 1,
                            ...(loopAction.nextLoopMode ? { loopMode: loopAction.nextLoopMode } : {})
                        }));
                        return true;
                    };

                    if (boundaryTransitionInFlightRef.current) {
                        animationFrame = requestAnimationFrame(checkLoopAndEnd);
                        return;
                    }

                    const requiresFinalize = hasActiveRecordingSessionsRef.current?.() || false;
                    if (requiresFinalize) {
                        boundaryTransitionInFlightRef.current = true;
                        void (async () => {
                            try {
                                const finalizeFn = finalizeActiveRecordingsRef.current;
                                if (finalizeFn) {
                                    await finalizeFn();
                                }

                                const shouldStop = applyBoundaryAction();
                                if (!shouldStop) {
                                    animationFrame = requestAnimationFrame(checkLoopAndEnd);
                                }
                            } finally {
                                boundaryTransitionInFlightRef.current = false;
                            }
                        })();
                        return;
                    }

                    const shouldStop = applyBoundaryAction();
                    if (shouldStop) {
                        return;
                    }
                }
            }
            animationFrame = requestAnimationFrame(checkLoopAndEnd);
        };

        if (transport.isPlaying) {
            animationFrame = requestAnimationFrame(checkLoopAndEnd);
        }
        return () => cancelAnimationFrame(animationFrame);
    }, [transport.isPlaying, transport.bpm, transport.loopMode, tracks, getProjectEndBar]);

    useEffect(() => {
        if (!transport.isPlaying) {
            boundaryTransitionInFlightRef.current = false;
        }
    }, [transport.isPlaying]);

    useEffect(() => {
        engineAdapter.setMasterPitch(transport.masterTranspose);
    }, [transport.masterTranspose]);

    const beginTransportCommand = useCallback((): number => {
        transportCommandTokenRef.current += 1;
        return transportCommandTokenRef.current;
    }, []);

    const isTransportCommandCurrent = useCallback((token: number): boolean => {
        return transportCommandTokenRef.current === token;
    }, []);

    const playFromTransportCursor = useCallback(async (commandToken: number): Promise<boolean> => {
        if (isPlayingRef.current || engineAdapter.getIsPlaying()) {
            pauseResumeArmedRef.current = false;
            return true;
        }

        const ready = await engineAdapter.ensurePlaybackReady();
        if (!isTransportCommandCurrent(commandToken)) {
            return false;
        }

        if (!ready) {
            isPlayingRef.current = false;
            setTransport((prev: TransportState) => ({ ...prev, isPlaying: false }));
            return false;
        }

        const cursorBarTime = positionToBarTime(transport);
        const cursorTime = barToSeconds(cursorBarTime, transport.bpm);
        const projectEndBar = getProjectEndBar();
        const projectEndTime = barToSeconds(projectEndBar, transport.bpm);
        const shouldRestartFromBeginning = shouldRestartAtSongBoundary(cursorTime, projectEndTime);
        const playbackStartTime = shouldRestartFromBeginning ? 0 : cursorTime;
        const playbackStartBarTime = Math.max(1, 1 + (playbackStartTime / getSecondsPerBar(transport.bpm)));
        const playbackStartPosition = barTimeToPosition(playbackStartBarTime);

        if (playbackStartTime <= 0.0001) {
            loopOnceRemainingRef.current = transport.loopMode === 'once' ? 1 : 0;
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return false;
        }

        isPlayingRef.current = true;
        pauseResumeArmedRef.current = false;
        engineAdapter.play(latestTracksRef.current, transport.bpm, 1, playbackStartTime);

        if (!engineAdapter.getIsPlaying()) {
            isPlayingRef.current = false;
            pauseResumeArmedRef.current = false;
            setTransport((prev: TransportState) => ({ ...prev, isPlaying: false }));
            return false;
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return false;
        }

        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: true,
            currentBar: playbackStartPosition.currentBar,
            currentBeat: playbackStartPosition.currentBeat,
            currentSixteenth: playbackStartPosition.currentSixteenth
        }));

        return true;
    }, [getProjectEndBar, isTransportCommandCurrent, transport]);


    // --- TRANSPORT HANDLERS ---

    const handlePlay = useCallback(async () => {
        if (isPlayingRef.current || engineAdapter.getIsPlaying()) {
            pauseResumeArmedRef.current = false;
            return;
        }
        const commandToken = beginTransportCommand();
        await playFromTransportCursor(commandToken);
    }, [beginTransportCommand, playFromTransportCursor]);

    const hasActiveRecordingSessions = useCallback((): boolean => {
        return transport.isRecording || engineAdapter.getActiveRecordingTrackIds().length > 0;
    }, [transport.isRecording]);

    const finalizeActiveRecordings = useCallback(async () => {
        if (finalizeRecordingsPromiseRef.current) {
            await finalizeRecordingsPromiseRef.current;
            return;
        }

        const finalizeTask = (async () => {
            const activeRecordingTrackIds = engineAdapter.getActiveRecordingTrackIds();
            if (activeRecordingTrackIds.length === 0) {
                recordingSessionMetaRef.current.clear();
                setTransport((prev: TransportState) => ({ ...prev, isRecording: false }));
                return;
            }

            const trackById = new Map(latestTracksRef.current.map((track) => [track.id, track]));
            const recordingCommits: ReturnType<typeof buildRecordingTakeCommit>[] = [];
            const finalizeErrors: string[] = [];
            const secondsPerBar = getSecondsPerBar(transport.bpm);

            for (const trackId of activeRecordingTrackIds) {
                const track = trackById.get(trackId);
                const sessionMeta = recordingSessionMetaRef.current.get(trackId);
                const result = await engineAdapter.finalizeRecording(trackId);
                recordingSessionMetaRef.current.delete(trackId);

                if (!result) {
                    finalizeErrors.push(`No se obtuvo audio final para track ${trackId}.`);
                    continue;
                }

                if (!track) {
                    finalizeErrors.push(`La pista ${trackId} ya no existe; se descarta la toma finalizada.`);
                    continue;
                }

                try {
                    const hash = await assetDb.saveFile(result.blob);
                    const fallbackStartBar = Math.max(1, 1 + (result.startedAtContextTime / secondsPerBar));
                    const fallbackCompensationBars = Math.max(0, (result.estimatedLatencyMs / 1000) / secondsPerBar);

                    recordingCommits.push(buildRecordingTakeCommit({
                        track,
                        sourceId: hash,
                        buffer: result.buffer,
                        bpm: transport.bpm,
                        recordingStartBar: sessionMeta?.recordingStartBar ?? fallbackStartBar,
                        latencyCompensationBars: sessionMeta?.latencyCompensationBars ?? fallbackCompensationBars,
                        sourceTrimOffsetBars: sessionMeta?.sourceTrimOffsetBars ?? 0,
                        recordedAt: Date.now(),
                        idFactory: buildRuntimeId
                    }));
                } catch (error) {
                    console.error(`No se pudo persistir la toma grabada en ${track.name}.`, error);
                    finalizeErrors.push(`Fallo al persistir toma en ${track.name}.`);
                }
            }

            if (recordingCommits.length > 0) {
                applyTrackMutation((prevTracks) => commitRecordingTakeBatch(prevTracks, recordingCommits), { recolor: false });
            }

            if (finalizeErrors.length > 0) {
                console.warn('[Recording] Finalize completed with issues:', finalizeErrors);
            }

            setTransport((prev: TransportState) => ({ ...prev, isRecording: false }));
        })();

        finalizeRecordingsPromiseRef.current = finalizeTask;
        try {
            await finalizeTask;
        } finally {
            if (finalizeRecordingsPromiseRef.current === finalizeTask) {
                finalizeRecordingsPromiseRef.current = null;
            }
        }
    }, [applyTrackMutation, transport.bpm]);

    useEffect(() => {
        finalizeActiveRecordingsRef.current = finalizeActiveRecordings;
    }, [finalizeActiveRecordings]);

    useEffect(() => {
        hasActiveRecordingSessionsRef.current = hasActiveRecordingSessions;
    }, [hasActiveRecordingSessions]);

    const handlePause = useCallback(async () => {
        const commandToken = beginTransportCommand();
        const isTransportRunning = isPlayingRef.current || engineAdapter.getIsPlaying() || transport.isPlaying;

        if (isTransportRunning) {
            if (hasActiveRecordingSessions()) {
                await finalizeActiveRecordings();
            }

            if (!isTransportCommandCurrent(commandToken)) {
                return;
            }

            const pauseTime = Math.max(0, engineAdapter.getCurrentTime());
            const pauseBarTime = Math.max(1, 1 + (pauseTime / getSecondsPerBar(transport.bpm)));
            const pausePosition = barTimeToPosition(pauseBarTime);
            engineAdapter.pause();
            setTransport((prev: TransportState) => ({
                ...prev,
                isPlaying: false,
                isRecording: false,
                currentBar: pausePosition.currentBar,
                currentBeat: pausePosition.currentBeat,
                currentSixteenth: pausePosition.currentSixteenth
            }));
            isPlayingRef.current = false;
            pauseResumeArmedRef.current = true;
            return;
        }

        const canResumeFromPause = pauseResumeArmedRef.current && engineAdapter.getCurrentTime() > 0.0001;
        if (canResumeFromPause) {
            await playFromTransportCursor(commandToken);
            return;
        }

        const fallbackPauseTime = Math.max(0, engineAdapter.getCurrentTime());
        const fallbackPauseBarTime = Math.max(1, 1 + (fallbackPauseTime / getSecondsPerBar(transport.bpm)));
        const fallbackPausePosition = barTimeToPosition(fallbackPauseBarTime);

        engineAdapter.pause();
        isPlayingRef.current = false;
        pauseResumeArmedRef.current = fallbackPauseTime > 0.0001;
        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: false,
            isRecording: false,
            currentBar: fallbackPausePosition.currentBar,
            currentBeat: fallbackPausePosition.currentBeat,
            currentSixteenth: fallbackPausePosition.currentSixteenth
        }));
    }, [beginTransportCommand, transport.isPlaying, transport.bpm, finalizeActiveRecordings, hasActiveRecordingSessions, isTransportCommandCurrent, playFromTransportCursor]);

    const handleStop = useCallback(async () => {
        const commandToken = beginTransportCommand();

        if (hasActiveRecordingSessions()) {
            await finalizeActiveRecordings();
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        engineAdapter.stop(true); // True resets offset to 0
        loopOnceRemainingRef.current = transport.loopMode === 'once' ? 1 : 0;
        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: false,
            isRecording: false,
            currentBar: 1,
            currentBeat: 1,
            currentSixteenth: 1
        }));
        isPlayingRef.current = false;
        pauseResumeArmedRef.current = false;
    }, [beginTransportCommand, transport.loopMode, finalizeActiveRecordings, hasActiveRecordingSessions, isTransportCommandCurrent]);

    const handleSkipStart = useCallback(async () => {
        const commandToken = beginTransportCommand();

        if (hasActiveRecordingSessions()) {
            await finalizeActiveRecordings();
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        engineAdapter.seek(0, latestTracksRef.current, transport.bpm);
        const engineIsPlaying = engineAdapter.getIsPlaying() || isPlayingRef.current;
        loopOnceRemainingRef.current = transport.loopMode === 'once' ? 1 : 0;
        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: engineIsPlaying,
            isRecording: false,
            currentBar: 1,
            currentBeat: 1,
            currentSixteenth: 1
        }));
    }, [beginTransportCommand, transport.bpm, transport.loopMode, finalizeActiveRecordings, hasActiveRecordingSessions, isTransportCommandCurrent]);

    const handleSkipEnd = useCallback(async () => {
        const commandToken = beginTransportCommand();
        const endBar = getProjectEndBar();

        if (hasActiveRecordingSessions()) {
            await finalizeActiveRecordings();
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        const targetBarTime = Math.max(1, endBar);
        const targetTime = barToSeconds(targetBarTime, transport.bpm);
        const targetPosition = barTimeToPosition(targetBarTime);

        if (isPlayingRef.current || engineAdapter.getIsPlaying() || transport.isPlaying) {
            engineAdapter.pause();
            isPlayingRef.current = false;
            pauseResumeArmedRef.current = false;
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        engineAdapter.seek(targetTime, latestTracksRef.current, transport.bpm);
        if (transport.loopMode === 'once') {
            loopOnceRemainingRef.current = 0;
        }

        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: false,
            isRecording: false,
            currentBar: targetPosition.currentBar,
            currentBeat: targetPosition.currentBeat,
            currentSixteenth: targetPosition.currentSixteenth
        }));
    }, [beginTransportCommand, transport.bpm, getProjectEndBar, transport.loopMode, transport.isPlaying, finalizeActiveRecordings, hasActiveRecordingSessions, isTransportCommandCurrent]);

    const handleSeekToBar = useCallback(async (bar: number) => {
        const commandToken = beginTransportCommand();
        const safeBar = Math.max(1, Number.isFinite(bar) ? bar : 1);

        if (hasActiveRecordingSessions()) {
            await finalizeActiveRecordings();
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        engineAdapter.seek(barToSeconds(safeBar, transport.bpm), latestTracksRef.current, transport.bpm);
        const engineIsPlaying = engineAdapter.getIsPlaying() || isPlayingRef.current;

        if (safeBar <= 1.0001 && transport.loopMode === 'once') {
            loopOnceRemainingRef.current = 1;
        }

        const position = barTimeToPosition(safeBar);
        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: engineIsPlaying,
            isRecording: false,
            currentBar: position.currentBar,
            currentBeat: position.currentBeat,
            currentSixteenth: position.currentSixteenth
        }));
    }, [beginTransportCommand, finalizeActiveRecordings, hasActiveRecordingSessions, transport.bpm, transport.loopMode, isTransportCommandCurrent]);

    const handleLoopToggle = useCallback(() => {
        setTransport((prev: TransportState) => {
            const nextLoopMode = getNextLoopMode(prev.loopMode);
            return { ...prev, loopMode: nextLoopMode };
        });
    }, []);

    const handleBpmChange = useCallback((newBpm: number) => {
        const clamped = Math.max(20, Math.min(999, newBpm));
        setTransport((prev: TransportState) => ({ ...prev, bpm: clamped }));
        engineAdapter.setBpm(clamped);
    }, []);

    const getTransportCursorBar = useCallback(() => {
        return positionToBarTime(transport);
    }, [transport.currentBar, transport.currentBeat, transport.currentSixteenth]);

    const toggleSelectedTrackPunch = useCallback(() => {
        if (!selectedTrackId) return;

        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.id !== selectedTrackId) return track;
            return updateTrackPunchRange(track, {
                enabled: !(track.punchRange?.enabled || false)
            });
        }), { recolor: false, reason: 'punch-toggle-selected-track' });
    }, [applyTrackMutation, selectedTrackId]);

    const setSelectedTrackPunchBoundary = useCallback((boundary: 'in' | 'out') => {
        if (!selectedTrackId) return;
        const cursorBar = getTransportCursorBar();

        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.id !== selectedTrackId) return track;

            const baseRange = track.punchRange || {
                enabled: true,
                inBar: 1,
                outBar: 2,
                preRollBars: 1,
                countInBars: 0
            };

            if (boundary === 'in') {
                return updateTrackPunchRange(track, {
                    enabled: true,
                    inBar: cursorBar,
                    outBar: Math.max(baseRange.outBar, cursorBar + 0.25)
                });
            }

            return updateTrackPunchRange(track, {
                enabled: true,
                outBar: Math.max(cursorBar, baseRange.inBar + 0.25)
            });
        }), { recolor: false, reason: `punch-set-${boundary}` });
    }, [applyTrackMutation, getTransportCursorBar, selectedTrackId]);

    useEffect(() => {
        const handlePunchHotkeys = (event: KeyboardEvent) => {
            if (!event.altKey || event.ctrlKey || event.metaKey) return;

            const target = event.target as HTMLElement | null;
            const tagName = target?.tagName;
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
                return;
            }

            const key = event.key.toLowerCase();
            if (key === 'p') {
                event.preventDefault();
                toggleSelectedTrackPunch();
                return;
            }

            if (key === 'i') {
                event.preventDefault();
                setSelectedTrackPunchBoundary('in');
                return;
            }

            if (key === 'o') {
                event.preventDefault();
                setSelectedTrackPunchBoundary('out');
            }
        };

        window.addEventListener('keydown', handlePunchHotkeys);
        return () => window.removeEventListener('keydown', handlePunchHotkeys);
    }, [setSelectedTrackPunchBoundary, toggleSelectedTrackPunch]);

    const handleSplitClipAtCursor = useCallback((track: Track, clip: Clip) => {
        const cursorBar = getTransportCursorBar();
        const clipStart = clip.start;
        const clipEnd = clip.start + clip.length;

        if (cursorBar <= clipStart + MIN_CLIP_LENGTH_BARS || cursorBar >= clipEnd - MIN_CLIP_LENGTH_BARS) {
            alert('Coloca el cursor dentro del clip para dividirlo.');
            return;
        }

        const rightClipId = `c-split-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        let didSplit = false;

        applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
            if (existingTrack.id !== track.id) return existingTrack;

            const clipIndex = existingTrack.clips.findIndex((existingClip) => existingClip.id === clip.id);
            if (clipIndex < 0) return existingTrack;

            const sourceClip = existingTrack.clips[clipIndex];
            const boundedSplitBar = Math.min(
                sourceClip.start + sourceClip.length - MIN_CLIP_LENGTH_BARS,
                Math.max(sourceClip.start + MIN_CLIP_LENGTH_BARS, cursorBar)
            );
            const leftLength = boundedSplitBar - sourceClip.start;
            const rightLength = sourceClip.length - leftLength;

            if (leftLength < MIN_CLIP_LENGTH_BARS || rightLength < MIN_CLIP_LENGTH_BARS) {
                return existingTrack;
            }

            const splitOffset16 = leftLength * 16;
            const leftNotes: Note[] = [];
            const rightNotes: Note[] = [];

            sourceClip.notes.forEach((note) => {
                const start = note.start;
                const end = note.start + note.duration;

                if (end <= splitOffset16) {
                    leftNotes.push({ ...note });
                    return;
                }

                if (start >= splitOffset16) {
                    rightNotes.push({
                        ...note,
                        start: start - splitOffset16
                    });
                    return;
                }

                leftNotes.push({
                    ...note,
                    duration: Math.max(1, splitOffset16 - start)
                });

                rightNotes.push({
                    ...note,
                    start: 0,
                    duration: Math.max(1, end - splitOffset16)
                });
            });

            const nextOffset = existingTrack.type === TrackType.AUDIO
                ? Math.max(0, (sourceClip.offset || 0) + leftLength)
                : sourceClip.offset || 0;

            const leftClip: Clip = {
                ...sourceClip,
                length: leftLength,
                fadeIn: Math.min(sourceClip.fadeIn || 0, leftLength),
                fadeOut: 0,
                notes: leftNotes
            };

            const rightClip: Clip = {
                ...sourceClip,
                id: rightClipId,
                start: boundedSplitBar,
                length: rightLength,
                offset: nextOffset,
                fadeIn: 0,
                fadeOut: Math.min(sourceClip.fadeOut || 0, rightLength),
                notes: rightNotes
            };

            const nextClips = [...existingTrack.clips];
            nextClips[clipIndex] = leftClip;
            nextClips.splice(clipIndex + 1, 0, rightClip);

            let nextTrack: Track = {
                ...existingTrack,
                clips: nextClips,
                sessionClips: existingTrack.sessionClips.map((slot) => {
                    if (slot.clip?.id !== sourceClip.id) return slot;
                    return {
                        ...slot,
                        clip: leftClip
                    };
                })
            };

            nextTrack = splitTakeForClip(nextTrack, sourceClip.id, leftClip, rightClip, buildRuntimeId);
            didSplit = true;

            return nextTrack;
        }), { recolor: false, reason: 'timeline-split-clip-at-cursor' });

        if (!didSplit) {
            alert('No se pudo dividir el clip seleccionado.');
            return;
        }

        setSelectedTrackId(track.id);
        setSelectedClipId(rightClipId);
        setBottomView('editor');
    }, [applyTrackMutation, getTransportCursorBar]);

    const handleDuplicateClip = useCallback((track: Track, clip: Clip) => {
        const duplicateClipId = `c-dup-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        let duplicated = false;

        applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
            if (existingTrack.id !== track.id) return existingTrack;

            const sourceClip = existingTrack.clips.find((existingClip) => existingClip.id === clip.id);
            if (!sourceClip) return existingTrack;

            const duplicatedClip: Clip = {
                ...sourceClip,
                id: duplicateClipId,
                start: sourceClip.start + sourceClip.length,
                notes: sourceClip.notes.map((note) => ({ ...note }))
            };

            duplicated = true;

            return {
                ...existingTrack,
                clips: [...existingTrack.clips, duplicatedClip].sort((a, b) => a.start - b.start)
            };
        }), { recolor: false, reason: 'timeline-duplicate-clip' });

        if (!duplicated) {
            alert('No se pudo duplicar el clip seleccionado.');
            return;
        }

        setSelectedTrackId(track.id);
        setSelectedClipId(duplicateClipId);
        setBottomView('editor');
    }, [applyTrackMutation]);

    const handlePromoteClipToComp = useCallback((track: Track, clip: Clip) => {
        let promoted = false;
        let missingTake = false;

        applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
            if (existingTrack.id !== track.id) return existingTrack;

            const sourceTake = (existingTrack.recordingTakes || []).find((take) => take.clipId === clip.id);
            if (!sourceTake) {
                missingTake = true;
                return existingTrack;
            }

            promoted = true;
            return promoteTakeToComp(existingTrack, sourceTake.id, {
                replaceExisting: false,
                idFactory: buildRuntimeId
            });
        }), { recolor: false, reason: 'timeline-promote-take-to-comp' });

        if (missingTake) {
            alert('Este clip no pertenece a una toma grabada.');
            return;
        }

        if (!promoted) {
            alert('No se pudo enviar la toma al Comp Lane.');
        }
    }, [applyTrackMutation]);

    const handleConsolidateClips = useCallback(async (track: Track, clipsToConsolidate: Clip[]) => {
        const targetClip = clipsToConsolidate[0];
        if (!targetClip || track.type !== TrackType.AUDIO) return;
        if (!targetClip.buffer) {
            alert('No se puede consolidar un clip sin audio cargado.');
            return;
        }
        if (targetClip.isWarped) {
            alert('Consolidar clips con Warp activo aun no esta habilitado.');
            return;
        }

        try {
            const secondsPerBar = getSecondsPerBar(transport.bpm);
            const renderDuration = Math.max(0.01, targetClip.length * secondsPerBar);
            const sampleRate = targetClip.buffer.sampleRate;
            const numChannels = Math.max(1, targetClip.buffer.numberOfChannels);
            const frameCount = Math.max(1, Math.ceil(renderDuration * sampleRate));

            const offlineCtx = new OfflineAudioContext(numChannels, frameCount, sampleRate);
            const source = offlineCtx.createBufferSource();
            source.buffer = targetClip.buffer;

            const clipGain = offlineCtx.createGain();
            source.connect(clipGain);
            clipGain.connect(offlineCtx.destination);

            const baseGain = Math.max(0, Math.min(2, targetClip.gain ?? 1));
            const fadeInSeconds = Math.max(0, targetClip.fadeIn || 0) * secondsPerBar;
            const fadeOutSeconds = Math.max(0, targetClip.fadeOut || 0) * secondsPerBar;
            const safeFadeIn = Math.min(fadeInSeconds, renderDuration);
            const safeFadeOut = Math.min(fadeOutSeconds, Math.max(0, renderDuration - safeFadeIn));
            const fadeOutStart = Math.max(0, renderDuration - safeFadeOut);

            clipGain.gain.setValueAtTime(safeFadeIn > 0 ? 0 : baseGain, 0);
            if (safeFadeIn > 0) {
                clipGain.gain.linearRampToValueAtTime(baseGain, safeFadeIn);
            }
            if (safeFadeOut > 0) {
                clipGain.gain.setValueAtTime(baseGain, fadeOutStart);
                clipGain.gain.linearRampToValueAtTime(0, renderDuration);
            }

            const bpmRatio = transport.bpm / (targetClip.originalBpm || transport.bpm);
            const transposeSemitones = targetClip.transpose || 0;
            source.playbackRate.value = bpmRatio * Math.pow(2, transposeSemitones / 12);

            const offsetSeconds = Math.max(0, (targetClip.offset || 0) * secondsPerBar);
            source.start(0, offsetSeconds, renderDuration);

            const renderedBuffer = await offlineCtx.startRendering();

            applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
                if (existingTrack.id !== track.id) return existingTrack;

                const nextTrack: Track = {
                    ...existingTrack,
                    clips: existingTrack.clips.map((existingClip) => {
                        if (existingClip.id !== targetClip.id) return existingClip;

                        return {
                            ...existingClip,
                            name: existingClip.name.endsWith(' [CONS]') ? existingClip.name : `${existingClip.name} [CONS]`,
                            buffer: renderedBuffer,
                            sourceId: undefined,
                            offset: 0,
                            fadeIn: 0,
                            fadeOut: 0,
                            gain: 1,
                            transpose: 0,
                            isWarped: false,
                            playbackRate: 1,
                            originalBpm: transport.bpm
                        };
                    })
                };
                return syncTakeMetadataForClip(nextTrack, targetClip.id);
            }), { recolor: false });
        } catch (error) {
            console.error('Consolidate clip failed', error);
            alert('No se pudo consolidar el clip seleccionado.');
        }
    }, [applyTrackMutation, transport.bpm]);

    const handleReverseClip = useCallback((track: Track, clip: Clip) => {
        if (track.type !== TrackType.AUDIO || !clip.buffer) {
            alert('Solo se puede invertir un clip de audio cargado.');
            return;
        }

        const srcBuffer = clip.buffer;
        const reverseCtx = engineAdapter.getContext();
        const reversedBuffer = reverseCtx.createBuffer(
            srcBuffer.numberOfChannels,
            srcBuffer.length,
            srcBuffer.sampleRate
        );

        for (let ch = 0; ch < srcBuffer.numberOfChannels; ch++) {
            const src = srcBuffer.getChannelData(ch);
            const dst = reversedBuffer.getChannelData(ch);
            for (let i = 0; i < src.length; i++) {
                dst[i] = src[src.length - 1 - i];
            }
        }

        applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
            if (existingTrack.id !== track.id) return existingTrack;

            const nextTrack: Track = {
                ...existingTrack,
                clips: existingTrack.clips.map((existingClip) => {
                    if (existingClip.id !== clip.id) return existingClip;

                    return {
                        ...existingClip,
                        name: existingClip.name.endsWith(' [REV]') ? existingClip.name : `${existingClip.name} [REV]`,
                        buffer: reversedBuffer,
                        sourceId: undefined,
                        offset: 0,
                        fadeIn: clip.fadeOut || 0,
                        fadeOut: clip.fadeIn || 0
                    };
                })
            };
            return syncTakeMetadataForClip(nextTrack, clip.id);
        }), { recolor: false });
    }, [applyTrackMutation]);

    const handleQuantizeClip = useCallback((track: Track, clip: Clip) => {
        if (track.type !== TrackType.MIDI || clip.notes.length === 0) {
            alert('Solo se puede cuantizar un clip MIDI con notas.');
            return;
        }

        const step16 = Math.max(1, Math.round(transport.gridSize * 16));

        const quantizedNotes = clip.notes
            .map((note) => ({
                ...note,
                start: Math.max(0, Math.round(note.start / step16) * step16),
                duration: Math.max(step16, Math.round(note.duration / step16) * step16)
            }))
            .sort((a, b) => a.start - b.start || b.pitch - a.pitch);

        applyTrackMutation((prevTracks) => prevTracks.map((existingTrack) => {
            if (existingTrack.id !== track.id) return existingTrack;

            return {
                ...existingTrack,
                clips: existingTrack.clips.map((existingClip) => {
                    if (existingClip.id !== clip.id) return existingClip;
                    return {
                        ...existingClip,
                        notes: quantizedNotes
                    };
                })
            };
        }), { recolor: false });
    }, [applyTrackMutation, transport.gridSize]);

    const buildScannedMidiClip = useCallback((notes: Note[], clipName: string, color: string): Clip => {
        const maxEnd16th = notes.reduce((maxEnd, note) => {
            return Math.max(maxEnd, note.start + note.duration);
        }, 0);
        const clipLengthBars = Math.max(1, Math.ceil(maxEnd16th / 16));
        const now = Date.now();
        const entropy = Math.floor(Math.random() * 10000);

        return {
            id: `c-scan-${now}-${entropy}`,
            name: clipName,
            color,
            start: Math.max(1, transport.currentBar),
            length: clipLengthBars,
            notes,
            offset: 0,
            fadeIn: 0,
            fadeOut: 0,
            gain: 1,
            playbackRate: 1
        };
    }, [transport.currentBar]);

    const handleCreateMidiTrackFromScan = useCallback((payload: ApplyScanPayload) => {
        if (payload.notes.length === 0) {
            alert('El escaneo no detecto notas validas para crear un clip MIDI.');
            return;
        }

        const trackId = `t-scan-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const newTrack = createTrack({
            id: trackId,
            name: `SCAN ${tracks.length + 1}`,
            type: TrackType.MIDI,
            color: '#B34BE4',
            volume: -6,
            clips: [buildScannedMidiClip(payload.notes, payload.clipName, '#B34BE4')]
        });

        appendTrack(newTrack);
        setSelectedTrackId(trackId);
        setSelectedClipId(newTrack.clips[0]?.id ?? null);
        setMainView('arrange');
        setBottomView('editor');
        closeAllToolPanels();
    }, [appendTrack, buildScannedMidiClip, closeAllToolPanels, tracks.length]);

    const handleInsertScanIntoMidiTrack = useCallback((trackId: string, payload: ApplyScanPayload) => {
        if (payload.notes.length === 0) {
            alert('El escaneo no contiene notas para insertar.');
            return;
        }

        let inserted = false;
        let insertedClipId: string | null = null;
        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.id !== trackId) return track;
            if (track.type !== TrackType.MIDI) return track;

            inserted = true;
            const clipColor = track.color;
            const newClip = buildScannedMidiClip(payload.notes, payload.clipName, clipColor);
            insertedClipId = newClip.id;

            return {
                ...track,
                clips: [...track.clips, newClip]
            };
        }), { recolor: false });

        if (!inserted) {
            alert('No se pudo insertar el clip: la pista destino no es MIDI.');
            return;
        }

        setSelectedTrackId(trackId);
        setSelectedClipId(insertedClipId);
        setMainView('arrange');
        setBottomView('editor');
        closeAllToolPanels();
    }, [applyTrackMutation, buildScannedMidiClip, closeAllToolPanels]);

    const removeTrackWithRoutingCleanup = useCallback((trackId: string) => {
        applyTrackMutation((prevTracks) => removeTrackRoutingReferences(prevTracks, trackId), { recolor: false, reason: 'delete-track' });

        if (selectedTrackId === trackId) {
            setSelectedTrackId(null);
            setSelectedClipId(null);
        }
    }, [applyTrackMutation, selectedTrackId]);

    const getPlaybackBarTime = useCallback(() => {
        const secondsPerBar = getSecondsPerBar(transport.bpm);
        const currentSeconds = engineAdapter.getCurrentTime();
        return (currentSeconds / Math.max(0.0001, secondsPerBar)) + 1;
    }, [transport.bpm]);

    const handleMixerTrackUpdate = useCallback((trackId: string, updates: Partial<Track>) => {
        const nowMs = performance.now();
        const barTime = getPlaybackBarTime();

        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.id !== trackId) return track;

            let nextTrack: Track = { ...track, ...updates };
            const mode: AutomationMode = nextTrack.automationMode ?? 'read';

            if (Object.prototype.hasOwnProperty.call(updates, 'automationMode')) {
                if (mode !== 'latch') {
                    Array.from(automationLatchActiveRef.current).forEach((key) => {
                        if (key.startsWith(`${trackId}:`)) {
                            automationLatchActiveRef.current.delete(key);
                        }
                    });
                }

                if (mode !== 'touch') {
                    Array.from(automationTouchUntilRef.current.keys()).forEach((key) => {
                        if (key.startsWith(`${trackId}:`)) {
                            automationTouchUntilRef.current.delete(key);
                        }
                    });
                }
            }

            if (!transport.isPlaying || mode === 'off' || mode === 'read') {
                return nextTrack;
            }

            AUTOMATION_TARGETS.forEach((param) => {
                const hasUpdate = Object.prototype.hasOwnProperty.call(updates, param);
                if (!hasUpdate) return;

                const key = `${trackId}:${param}`;

                if (mode === 'touch') {
                    automationTouchUntilRef.current.set(key, nowMs + 240);
                }

                if (mode === 'latch') {
                    automationLatchActiveRef.current.add(key);
                }

                const normalized = normalizeTrackParam(nextTrack, param);
                const withPoint = writeAutomationPoint(nextTrack, param, barTime, normalized);
                if (withPoint !== nextTrack) {
                    nextTrack = withPoint;
                }

                automationLastWriteRef.current.set(key, nowMs);
            });

            return nextTrack;
        }), { recolor: false });
    }, [applyTrackMutation, getPlaybackBarTime, transport.isPlaying]);

    const shouldRunAutomationLoop = useMemo(() => {
        return tracks.some((track) => {
            const mode: AutomationMode = track.automationMode ?? 'read';
            if (mode === 'off') return false;
            if (mode === 'read') {
                return Boolean(track.automationLanes && track.automationLanes.length > 0);
            }
            return true;
        });
    }, [tracks]);

    useEffect(() => {
        if (!transport.isPlaying || !shouldRunAutomationLoop) {
            return;
        }

        let animationFrame = 0;
        let lastFrameTime = 0;

        const targetFps = 30;
        const minFrameDelta = 1000 / targetFps;

        const tick = (timestamp: number) => {
            if ((timestamp - lastFrameTime) >= minFrameDelta) {
                lastFrameTime = timestamp;
                const nowMs = performance.now();
                const barTime = getPlaybackBarTime();

                applyTrackMutation((prevTracks) => {
                    let changed = false;

                    const nextTracks = prevTracks.map((track) => {
                        const mode: AutomationMode = track.automationMode ?? 'read';
                        if (mode === 'off') {
                            return track;
                        }

                        let nextTrack = track;

                        AUTOMATION_TARGETS.forEach((param) => {
                            const key = `${track.id}:${param}`;
                            const touchUntil = automationTouchUntilRef.current.get(key) ?? 0;
                            const isTouchActive = mode === 'touch' && nowMs <= touchUntil;
                            const isLatchActive = mode === 'latch' && automationLatchActiveRef.current.has(key);

                            const shouldRead = mode === 'read' || (mode === 'touch' && !isTouchActive) || (mode === 'latch' && !isLatchActive);

                            if (shouldRead) {
                                const laneValue = sampleAutomationLaneAtBar(getLaneByParam(nextTrack, param), barTime);
                                if (laneValue !== null) {
                                    const desired = denormalizeTrackParam(nextTrack, param, laneValue);
                                    const current = getTrackParamValue(nextTrack, param);
                                    if (Math.abs(desired - current) > 0.001) {
                                        nextTrack = { ...nextTrack, [param]: desired };
                                        changed = true;
                                    }
                                }
                            }

                            const shouldWrite = mode === 'write' || isLatchActive;
                            if (!shouldWrite) return;

                            const lastWrite = automationLastWriteRef.current.get(key) ?? 0;
                            if (nowMs - lastWrite < 110) return;

                            const normalized = normalizeTrackParam(nextTrack, param);
                            const withPoint = writeAutomationPoint(nextTrack, param, barTime, normalized);
                            if (withPoint !== nextTrack) {
                                nextTrack = withPoint;
                                changed = true;
                            }
                            automationLastWriteRef.current.set(key, nowMs);
                        });

                        return nextTrack;
                    });

                    return changed ? nextTracks : prevTracks;
                }, { noHistory: true, recolor: false });
            }

            animationFrame = requestAnimationFrame(tick);
        };

        animationFrame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animationFrame);
    }, [applyTrackMutation, getPlaybackBarTime, shouldRunAutomationLoop, transport.isPlaying]);

    useEffect(() => {
        if (!transport.isPlaying && wasPlayingRef.current) {
            automationTouchUntilRef.current.clear();
            automationLatchActiveRef.current.clear();
            automationLastWriteRef.current.clear();
        }

        wasPlayingRef.current = transport.isPlaying;
    }, [transport.isPlaying]);

    const storeMixSnapshot = useCallback((slot: MixSnapshotSlot) => {
        const tracksSnapshot: Record<string, TrackMixSnapshot> = {};

        tracks.forEach((track) => {
            tracksSnapshot[track.id] = {
                volume: track.volume,
                pan: track.pan,
                reverb: track.reverb,
                isMuted: track.isMuted,
                isSoloed: track.isSoloed,
                monitor: track.monitor,
                sends: track.sends ? { ...track.sends } : undefined,
                sendModes: track.sendModes ? { ...track.sendModes } : undefined,
                groupId: track.groupId,
                vcaGroupId: track.vcaGroupId,
                soloSafe: track.soloSafe
            };
        });

        const snapshot: MixSnapshot = {
            capturedAt: Date.now(),
            masterVolumeDb: engineAdapter.getMasterVolumeDb(),
            tracks: tracksSnapshot
        };

        setMixSnapshots((prev) => ({ ...prev, [slot]: snapshot }));
        setActiveMixSnapshot(slot);
    }, [tracks]);

    const recallMixSnapshot = useCallback((slot: MixSnapshotSlot) => {
        const snapshot = mixSnapshots[slot];
        if (!snapshot) return;

        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            const trackSnapshot = snapshot.tracks[track.id];
            if (!trackSnapshot) return track;

            return {
                ...track,
                volume: trackSnapshot.volume,
                pan: trackSnapshot.pan,
                reverb: trackSnapshot.reverb,
                isMuted: trackSnapshot.isMuted,
                isSoloed: trackSnapshot.isSoloed,
                monitor: trackSnapshot.monitor,
                sends: trackSnapshot.sends ? { ...trackSnapshot.sends } : {},
                sendModes: trackSnapshot.sendModes ? { ...trackSnapshot.sendModes } : {},
                groupId: trackSnapshot.groupId,
                vcaGroupId: trackSnapshot.vcaGroupId,
                soloSafe: trackSnapshot.soloSafe ?? false
            };
        }), { recolor: false });

        engineAdapter.setMasterVolumeDb(snapshot.masterVolumeDb);
        setActiveMixSnapshot(slot);
    }, [applyTrackMutation, mixSnapshots]);

    const toggleMixSnapshotCompare = useCallback(() => {
        const hasA = Boolean(mixSnapshots.A);
        const hasB = Boolean(mixSnapshots.B);

        if (hasA && hasB) {
            const nextSlot: MixSnapshotSlot = activeMixSnapshot === 'A' ? 'B' : 'A';
            recallMixSnapshot(nextSlot);
            return;
        }

        if (hasA) {
            recallMixSnapshot('A');
            return;
        }

        if (hasB) {
            recallMixSnapshot('B');
        }
    }, [activeMixSnapshot, mixSnapshots, recallMixSnapshot]);

    const handleStartCollabSession = useCallback(() => {
        const now = Date.now();
        const sessionId = `ETH-${now.toString(36).toUpperCase()}-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;
        setCollabSessionId(sessionId);
        lastCollabCommandRef.current = projectCommandCount;
        setCollabActivity([
            {
                id: `collab-${now}`,
                timestamp: now,
                message: `${collabUserName || 'Host'} inicio sesion ${sessionId}`
            }
        ]);
    }, [collabUserName, projectCommandCount]);

    const handleStopCollabSession = useCallback(() => {
        const now = Date.now();
        setCollabActivity((prev) => ([
            {
                id: `collab-stop-${now}`,
                timestamp: now,
                message: `Sesion ${collabSessionId} cerrada por host`
            },
            ...prev
        ].slice(0, 60)));
        setCollabSessionId(null);
    }, [collabSessionId]);

    const handleCopyCollabInvite = useCallback(async () => {
        if (!collabSessionId) return;

        const invite = `HOLLOWBITS://session/${collabSessionId}`;
        try {
            await navigator.clipboard.writeText(invite);
            const now = Date.now();
            setCollabActivity((prev) => ([
                {
                    id: `collab-copy-${now}`,
                    timestamp: now,
                    message: 'Invite de sesion copiado al portapapeles'
                },
                ...prev
            ].slice(0, 60)));
        } catch (error) {
            console.warn('No se pudo copiar el invite de colaboracion.', error);
            alert(`Invite de colaboracion:\n${invite}`);
        }
    }, [collabSessionId]);

    useEffect(() => {
        if (!collabSessionId) {
            lastCollabCommandRef.current = projectCommandCount;
            return;
        }

        if (projectCommandCount <= lastCollabCommandRef.current) {
            return;
        }

        const delta = projectCommandCount - lastCollabCommandRef.current;
        const now = Date.now();
        setCollabActivity((prev) => ([
            {
                id: `collab-sync-${now}`,
                timestamp: now,
                message: `${delta} cambio(s) agregado(s) al stream colaborativo por ${collabUserName || 'Host'}`
            },
            ...prev
        ].slice(0, 60)));
        lastCollabCommandRef.current = projectCommandCount;
    }, [collabSessionId, collabUserName, projectCommandCount]);

    const handleMixerMacroApply = useCallback((macroId: 'vocal-up' | 'drum-glue' | 'mono-check' | 'headroom-safe') => {
        const isKeywordMatch = (name: string, keywords: string[]) => {
            const lower = name.toLowerCase();
            return keywords.some((keyword) => lower.includes(keyword));
        };

        if (macroId === 'mono-check') {
            if (!monoCheckStateRef.current.active) {
                const panSnapshot: Record<string, number> = {};

                applyTrackMutation((prevTracks) => prevTracks.map((track) => {
                    panSnapshot[track.id] = track.pan;
                    return {
                        ...track,
                        pan: 0
                    };
                }), { recolor: false });

                monoCheckStateRef.current = {
                    active: true,
                    pans: panSnapshot
                };
            } else {
                const panSnapshot = monoCheckStateRef.current.pans;
                applyTrackMutation((prevTracks) => prevTracks.map((track) => ({
                    ...track,
                    pan: panSnapshot[track.id] ?? track.pan
                })), { recolor: false });
                monoCheckStateRef.current = { active: false, pans: {} };
            }

            return;
        }

        applyTrackMutation((prevTracks) => prevTracks.map((track) => {
            if (track.type === TrackType.RETURN) return track;

            if (macroId === 'vocal-up') {
                const isVocalTrack = isKeywordMatch(track.name, ['vocal', 'voz', 'lead', 'vox']);
                const delta = isVocalTrack ? 2 : -0.8;
                return {
                    ...track,
                    volume: Math.max(-60, Math.min(6, track.volume + delta))
                };
            }

            if (macroId === 'drum-glue') {
                const isDrumTrack = isKeywordMatch(track.name, ['drum', 'kick', 'snare', 'hihat', 'hat', 'perc', 'bombo']);
                if (!isDrumTrack) {
                    return {
                        ...track,
                        reverb: Math.max(0, track.reverb > 1 ? track.reverb - 5 : track.reverb - 0.05)
                    };
                }

                const boostedReverb = track.reverb > 1
                    ? Math.min(100, track.reverb + 8)
                    : Math.min(1, track.reverb + 0.08);

                return {
                    ...track,
                    volume: Math.max(-60, Math.min(6, track.volume + 1.2)),
                    reverb: boostedReverb
                };
            }

            if (macroId === 'headroom-safe') {
                return {
                    ...track,
                    volume: Math.min(track.volume, -6),
                    reverb: track.reverb > 1 ? Math.min(track.reverb, 25) : Math.min(track.reverb, 0.25)
                };
            }

            return track;
        }), { recolor: false });

        if (macroId === 'headroom-safe') {
            engineAdapter.setMasterVolumeDb(Math.min(engineAdapter.getMasterVolumeDb(), -3));
        }
    }, [applyTrackMutation]);

    useEffect(() => {
        const handleMixSnapshotHotkeys = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return;

            const target = event.target as HTMLElement | null;
            const tagName = target?.tagName;
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target?.isContentEditable) {
                return;
            }

            const key = event.key.toLowerCase();

            if (event.altKey && key === '1') {
                event.preventDefault();
                storeMixSnapshot('A');
                return;
            }

            if (event.altKey && key === '2') {
                event.preventDefault();
                storeMixSnapshot('B');
                return;
            }

            if (event.shiftKey && key === 'x') {
                event.preventDefault();
                toggleMixSnapshotCompare();
                return;
            }

            if (!event.altKey && !event.shiftKey && key === '1') {
                event.preventDefault();
                recallMixSnapshot('A');
                return;
            }

            if (!event.altKey && !event.shiftKey && key === '2') {
                event.preventDefault();
                recallMixSnapshot('B');
            }
        };

        window.addEventListener('keydown', handleMixSnapshotHotkeys);
        return () => window.removeEventListener('keydown', handleMixSnapshotHotkeys);
    }, [recallMixSnapshot, storeMixSnapshot, toggleMixSnapshotCompare]);

    const handleRecordToggle = useCallback(async () => {
        const commandToken = beginTransportCommand();

        if (hasActiveRecordingSessions()) {
            await finalizeActiveRecordings();
            return;
        }

        let armedTracks = tracks.filter((track) => track.isArmed && track.type === TrackType.AUDIO);

        if (armedTracks.length === 0) {
            const newTrack = createTrack({
                id: buildRuntimeId('t-rec'),
                name: `REC VOCAL ${tracks.length + 1}`,
                type: TrackType.AUDIO,
                color: getTrackColorByPosition(tracks.length, tracks.length + 1),
                isArmed: true,
                monitor: 'in',
                micSettings: {
                    profile: 'studio-voice',
                    inputGain: 1,
                    monitoringEnabled: true,
                    monitoringReverb: false,
                    monitoringEcho: false
                }
            });

            appendTracks([newTrack], { reason: 'record-auto-track' });
            armedTracks = [newTrack];
        }

        if (!isTransportCommandCurrent(commandToken)) {
            return;
        }

        const secondsPerBar = getSecondsPerBar(transport.bpm);
        const diagnostics = engineAdapter.getDiagnostics();
        const estimatedLatencyCompensationBars = Math.max(0, (diagnostics.latency || 0) / secondsPerBar);

        const punchPlan = resolvePunchRecordingPlan(armedTracks);
        const transportWasRunning = isPlayingRef.current || engineAdapter.getIsPlaying() || transport.isPlaying;

        if (punchPlan) {
            const playbackStartBar = punchPlan.startPlaybackBar;
            const playbackStartTime = barToSeconds(playbackStartBar, transport.bpm);
            const playbackStartPosition = barTimeToPosition(playbackStartBar);

            engineAdapter.seek(playbackStartTime, latestTracksRef.current, transport.bpm);

            if (!transportWasRunning) {
                const ready = await engineAdapter.ensurePlaybackReady();
                if (!ready || !isTransportCommandCurrent(commandToken)) {
                    return;
                }

                isPlayingRef.current = true;
                pauseResumeArmedRef.current = false;
                engineAdapter.play(latestTracksRef.current, transport.bpm, 1, playbackStartTime);

                if (!engineAdapter.getIsPlaying() || !isTransportCommandCurrent(commandToken)) {
                    isPlayingRef.current = false;
                    return;
                }
            }

            setTransport((prev: TransportState) => ({
                ...prev,
                isPlaying: true,
                currentBar: playbackStartPosition.currentBar,
                currentBeat: playbackStartPosition.currentBeat,
                currentSixteenth: playbackStartPosition.currentSixteenth
            }));
        } else if (!transportWasRunning) {
            const startedPlayback = await playFromTransportCursor(commandToken);
            if (!startedPlayback || !isTransportCommandCurrent(commandToken)) {
                return;
            }
        }

        const recordingStartSeconds = Math.max(0, engineAdapter.getCurrentTime());
        const recordingCaptureStartBar = Math.max(1, 1 + (recordingStartSeconds / secondsPerBar));
        const recordingTargetStartBar = punchPlan ? punchPlan.punchInBar : recordingCaptureStartBar;
        const sourceTrimOffsetBars = punchPlan
            ? Math.max(0, recordingTargetStartBar - recordingCaptureStartBar)
            : 0;

        pauseResumeArmedRef.current = false;
        setTransport((prev: TransportState) => ({ ...prev, isPlaying: true, isRecording: true }));
        await Promise.all(armedTracks.map(async (track) => {
            try {
                await engineAdapter.startRecording(track.id, track.inputDeviceId);
                recordingSessionMetaRef.current.set(track.id, {
                    recordingStartBar: recordingTargetStartBar,
                    latencyCompensationBars: estimatedLatencyCompensationBars,
                    sourceTrimOffsetBars,
                    punchOutBar: punchPlan?.punchOutBar
                });
            } catch (error) {
                console.error(`No se pudo iniciar grabacion para ${track.name}.`, error);
                recordingSessionMetaRef.current.delete(track.id);
            }
        }));

        const activeRecordingTrackIds = new Set(engineAdapter.getActiveRecordingTrackIds());
        armedTracks.forEach((track) => {
            if (!activeRecordingTrackIds.has(track.id)) {
                recordingSessionMetaRef.current.delete(track.id);
            }
        });

        if (activeRecordingTrackIds.size === 0) {
            setTransport((prev: TransportState) => ({ ...prev, isRecording: false }));
        }
    }, [beginTransportCommand, transport.isPlaying, tracks, hasActiveRecordingSessions, finalizeActiveRecordings, appendTracks, isTransportCommandCurrent, playFromTransportCursor, transport.bpm]);

    useEffect(() => {
        if (!transport.isRecording) return;

        let animationFrame = 0;
        const checkPunchAutoStop = () => {
            if (!transport.isRecording) return;

            const activeRecordingTrackIds = engineAdapter.getActiveRecordingTrackIds();
            if (activeRecordingTrackIds.length === 0) {
                animationFrame = requestAnimationFrame(checkPunchAutoStop);
                return;
            }

            const punchOutBars = activeRecordingTrackIds
                .map((trackId) => recordingSessionMetaRef.current.get(trackId)?.punchOutBar)
                .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

            if (punchOutBars.length === 0) {
                animationFrame = requestAnimationFrame(checkPunchAutoStop);
                return;
            }

            const targetPunchOutBar = Math.max(...punchOutBars);
            const currentBar = Math.max(1, 1 + (Math.max(0, engineAdapter.getCurrentTime()) / getSecondsPerBar(transport.bpm)));
            if (currentBar >= targetPunchOutBar - 0.0005) {
                void finalizeActiveRecordings();
                return;
            }

            animationFrame = requestAnimationFrame(checkPunchAutoStop);
        };

        animationFrame = requestAnimationFrame(checkPunchAutoStop);
        return () => cancelAnimationFrame(animationFrame);
    }, [transport.isRecording, transport.bpm, finalizeActiveRecordings]);

    const buildPersistedTracks = useCallback((sourceTracks: Track[]): Track[] => {
        return sourceTracks.map((track) => ({
            ...track,
            clips: track.clips.map(toPersistentClip),
            sessionClips: track.sessionClips.map((slot) => ({
                ...slot,
                clip: slot.clip ? toPersistentClip(slot.clip) : null,
                isPlaying: false,
                isQueued: false
            })),
            recordingTakes: (track.recordingTakes || []).map((take) => ({ ...take })),
            takeLanes: (track.takeLanes || []).map((lane) => ({
                ...lane,
                takeIds: [...lane.takeIds],
                compSegments: lane.compSegments ? lane.compSegments.map((segment) => ({ ...segment })) : undefined
            })),
            punchRange: track.punchRange ? { ...track.punchRange } : undefined
        }));
    }, []);

    const autosaveTransportSnapshot = useMemo<TransportState>(() => ({
        ...transport,
        isPlaying: false,
        isRecording: false,
        currentBar: 1,
        currentBeat: 1,
        currentSixteenth: 1
    }), [
        transport.bpm,
        transport.gridSize,
        transport.loopMode,
        transport.masterTranspose,
        transport.scaleRoot,
        transport.scaleType,
        transport.snapToGrid,
        transport.timeSignature
    ]);

    const createProjectDataSnapshot = useCallback((transportSnapshot: TransportState, nameOverride?: string): ProjectData => {
        return {
            version: '3.0-reference',
            name: nameOverride || projectName,
            tracks: buildPersistedTracks(tracks),
            transport: transportSnapshot,
            audioSettings,
            createdAt: Date.now(),
            lastModified: Date.now()
        };
    }, [audioSettings, buildPersistedTracks, projectName, tracks]);

    const hydrateProjectData = useCallback(async (projectData: ProjectData, preferredName?: string) => {
        if (!projectData.version || !Array.isArray(projectData.tracks) || !projectData.transport) {
            throw new Error('Formato de archivo invalido');
        }

        engineAdapter.stop(true);
        isPlayingRef.current = false;
        pauseResumeArmedRef.current = false;
        setLoadingMessage('Relacionando Archivos...');

        const rehydratedTracks = await Promise.all(projectData.tracks.map(async (track: Track) => {
            const rehydratedClips = await Promise.all(track.clips.map(async (clip: Clip) => {
                if (track.type === TrackType.AUDIO && clip.sourceId) {
                    const blob = await assetDb.getFile(clip.sourceId);
                    if (blob) {
                        const arrayBuffer = await blob.arrayBuffer();
                        const buffer = await engineAdapter.decodeAudioData(arrayBuffer);
                        return { ...clip, buffer, isOffline: false };
                    }

                    return { ...clip, isOffline: true, buffer: undefined };
                }

                return clip;
            }));

            const clipById = new Map(rehydratedClips.map((clip) => [clip.id, clip]));
            const sourceSessionClips = Array.isArray(track.sessionClips) ? track.sessionClips : [];
            const normalizedSessionClips = sourceSessionClips.map((slot, index) => ({
                id: slot.id || `slot-${track.id}-${index}`,
                clip: slot.clip ? clipById.get(slot.clip.id) || null : null,
                isPlaying: false,
                isQueued: false
            }));

            return withTrackRuntimeDefaults({
                ...track,
                clips: rehydratedClips,
                sessionClips: normalizedSessionClips
            });
        }));

        replaceTracks(rehydratedTracks, { recolor: true });

        const normalizedTransport: TransportState = {
            ...projectData.transport,
            loopMode: normalizeLoopMode(projectData.transport),
            isLooping: undefined,
            isPlaying: false,
            isRecording: false
        };

        setTransport(normalizedTransport);
        setAudioSettings(sanitizeAudioSettings(projectData.audioSettings || getDefaultAudioSettings()));
        setProjectName(preferredName || projectData.name || 'Sin TÃ­tulo');

        engineAdapter.setBpm(normalizedTransport.bpm);
        engineAdapter.setMasterPitch(normalizedTransport.masterTranspose);

        setSelectedTrackId(rehydratedTracks[0]?.id || null);
        setSelectedClipId(rehydratedTracks[0]?.clips[0]?.id || null);
    }, [replaceTracks]);

    const handleRestoreRecoverySnapshot = useCallback(async () => {
        if (!recoverySnapshot) {
            setActiveModal(null);
            return;
        }

        setLoadingProject(true);
        setLoadingMessage('Restaurando autosave...');

        try {
            await hydrateProjectData(recoverySnapshot.project, recoverySnapshot.projectName);
            clearAutosaveSnapshot(recoverySnapshot.id);
            setRecoverySnapshot(null);
            setActiveModal(null);
        } catch (error) {
            console.error('Recovery restore failed', error);
            alert('No se pudo restaurar el autosave.');
        } finally {
            setLoadingProject(false);
            setLoadingMessage('');
        }
    }, [hydrateProjectData, recoverySnapshot]);

    const handleDiscardRecoverySnapshot = useCallback(() => {
        if (recoverySnapshot) {
            clearAutosaveSnapshot(recoverySnapshot.id);
        }
        setRecoverySnapshot(null);
        setActiveModal(null);
    }, [recoverySnapshot]);

    useEffect(() => {
        const sessionInfo = startRecoverySession();
        if (sessionInfo.hadUncleanExit) {
            const latestSnapshot = getLatestAutosaveSnapshot();
            if (latestSnapshot) {
                setRecoverySnapshot(latestSnapshot);
                setLastAutosaveAt(latestSnapshot.timestamp);
                setLastAutosaveReason(latestSnapshot.reason);
                setActiveModal('recovery');
            }
        }

        const handleBeforeUnload = () => {
            stopRecoverySession();
        };

        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
            stopRecoverySession();
        };
    }, []);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            const snapshot: ProjectAutosaveSnapshot = {
                id: `autosave-${Date.now()}`,
                timestamp: Date.now(),
                reason: projectCommandCount > 0 ? `mutation-${projectCommandCount}` : 'initial-snapshot',
                commandCount: projectCommandCount,
                projectName,
                project: createProjectDataSnapshot(autosaveTransportSnapshot, projectName)
            };

            saveAutosaveSnapshot(snapshot);
            setLastAutosaveAt(snapshot.timestamp);
            setLastAutosaveReason(snapshot.reason);
        }, AUTOSAVE_DEBOUNCE_MS);

        return () => window.clearTimeout(timeoutId);
    }, [autosaveTransportSnapshot, createProjectDataSnapshot, projectCommandCount, projectName]);

    // ... (Project management handlers remain same)

    const resetProjectToEmpty = useCallback(() => {
        replaceTracks([], { recolor: false });
        setProjectName("Sin TÃ­tulo");
        setSelectedTrackId(null);
        setSelectedClipId(null);
        closeAllToolPanels();
        setTransport((prev: TransportState) => ({
            ...prev,
            isPlaying: false,
            isRecording: false,
            currentBar: 1,
            currentBeat: 1,
            currentSixteenth: 1,
            bpm: 124,
            masterTranspose: 0,
            loopMode: 'off',
            scaleRoot: 0,
            scaleType: 'minor'
        }));
        setActiveModal(null);
        engineAdapter.stop(true);
        isPlayingRef.current = false;
        pauseResumeArmedRef.current = false;
    }, [closeAllToolPanels, replaceTracks]);

    const handleNewProject = useCallback(() => { setActiveModal('new-project-confirm'); }, []);

    // Updated Open Project Handler using PlatformService
    const handleOpenProject = async () => {
        try {
            setLoadingProject(true);
            setLoadingMessage("Leyendo proyecto...");

            const result = await platformService.openProjectFile();
            if (!result) {
                setLoadingProject(false);
                return; // User cancelled
            }

            const { text, filename } = result;
            const projectData: ProjectData = JSON.parse(text);

            const nameFromDisk = filename.replace(/\.esp$/i, '');
            await hydrateProjectData(projectData, nameFromDisk || projectData.name);

        } catch (err) {
            console.error("Open Project Error", err);
            alert("Error crÃ­tico al leer el archivo. El formato puede estar corrupto.");
        } finally {
            setLoadingProject(false);
            setLoadingMessage("");
            setShowFileMenu(false);
            closeAllToolPanels();
        }
    };

    const handleSaveProject = useCallback(async () => {
        setLoadingProject(true);
        setLoadingMessage("Guardando metadatos...");

        setTimeout(async () => {
            try {
                if (transport.isPlaying) {
                    engineAdapter.pause();
                    setTransport((prev: TransportState) => ({ ...prev, isPlaying: false }));
                    isPlayingRef.current = false;
                    pauseResumeArmedRef.current = false;
                }
                const projectMetadata = createProjectDataSnapshot({
                    ...transport,
                    isPlaying: false,
                    isRecording: false
                }, projectName);
                const jsonString = JSON.stringify(projectMetadata, null, 2);
                setLoadingMessage("Escribiendo disco...");

                // FIX: Update Project Name from Save Result
                const result = await platformService.saveProject(jsonString, projectName);
                if (result.success && result.filePath) {
                    setProjectName(result.filePath);
                }

            } catch (e) {
                console.error("Failed to save project", e);
                alert("Error al guardar.");
            } finally {
                setLoadingProject(false);
                setLoadingMessage("");
                setActiveModal(null);
                setShowFileMenu(false);
            }
        }, 20);
    }, [createProjectDataSnapshot, projectName, transport]);

    const assignClipToSessionSlot = useCallback((track: Track, sceneIndex: number, clip: Clip): Track => {
        const safeSceneIndex = Math.max(0, Math.min(7, sceneIndex));
        const nextSlots = [...track.sessionClips];
        while (nextSlots.length <= safeSceneIndex) {
            const slotIndex = nextSlots.length;
            nextSlots.push({
                id: `slot-${track.id}-${slotIndex}`,
                clip: null,
                isPlaying: false,
                isQueued: false
            });
        }

        nextSlots[safeSceneIndex] = {
            ...nextSlots[safeSceneIndex],
            clip,
            isPlaying: false,
            isQueued: false
        };

        const clipExists = track.clips.some((existingClip) => existingClip.id === clip.id);

        return {
            ...track,
            clips: clipExists ? track.clips : [...track.clips, clip],
            sessionClips: nextSlots
        };
    }, []);

    const buildAudioClipFromBuffer = useCallback((
        name: string,
        color: string,
        buffer: AudioBuffer,
        startBar: number,
        sourceId?: string
    ): Clip => {
        return {
            id: buildRuntimeId('c-audio'),
            name,
            color,
            start: Math.max(1, startBar),
            length: buffer.duration / getSecondsPerBar(transport.bpm),
            buffer,
            sourceId,
            notes: [],
            originalBpm: transport.bpm,
            offset: 0,
            fadeIn: 0,
            fadeOut: 0,
            gain: 1,
            playbackRate: 1
        };
    }, [transport.bpm]);

    const importAudioSources = useCallback(async (sources: ImportAudioSource[]) => {
        if (sources.length === 0) return;

        const importStamp = Date.now();

        setImportProgress({
            total: sources.length,
            completed: 0,
            currentFile: sources[0]?.name || null
        });

        const importedTracks: Array<Track | null> = new Array(sources.length).fill(null);
        const totalTrackCountAfterImport = tracks.length + sources.length;
        let nextIndex = 0;

        const processSource = async (index: number) => {
            const source = sources[index];
            if (!source) return;

            setImportProgress((prev) => prev ? { ...prev, currentFile: source.name } : prev);

            try {
                const arrayBuffer = source.arrayBuffer.slice(0);
                const audioBuffer = await engineAdapter.decodeAudioData(arrayBuffer);

                let sourceId: string | undefined;
                try {
                    const blobToPersist = source.persistBlob || new Blob([source.arrayBuffer], { type: 'application/octet-stream' });
                    sourceId = await assetDb.saveFile(blobToPersist);
                } catch (persistError) {
                    console.warn(`Asset cache unavailable for ${source.name}`, persistError);
                }

                const newTrack = createTrack({
                    id: `t-imp-${importStamp}-${index}`,
                    name: source.name.replace(/\.[^/.]+$/, '').substring(0, 12),
                    type: TrackType.AUDIO,
                    color: getTrackColorByPosition(tracks.length + index, totalTrackCountAfterImport),
                    volume: -3
                });

                const newClip = buildAudioClipFromBuffer(source.name, newTrack.color, audioBuffer, 1, sourceId);
                newTrack.clips.push(newClip);
                importedTracks[index] = newTrack;
            } catch (fileError) {
                console.error(`Failed to import ${source.name}`, fileError);
                importedTracks[index] = null;
            } finally {
                setImportProgress((prev) => prev
                    ? {
                        ...prev,
                        completed: Math.min(prev.total, prev.completed + 1)
                    }
                    : prev);
            }
        };

        const workerCount = Math.min(IMPORT_AUDIO_CONCURRENCY, sources.length);
        const workers = Array.from({ length: workerCount }, async () => {
            while (nextIndex < sources.length) {
                const currentIndex = nextIndex;
                nextIndex += 1;
                await processSource(currentIndex);

                await new Promise<void>((resolve) => {
                    window.setTimeout(resolve, 0);
                });
            }
        });

        await Promise.all(workers);

        window.setTimeout(() => {
            setImportProgress(null);
        }, 160);

        const validTracks = importedTracks.filter((track): track is Track => track !== null);
        if (validTracks.length === 0) {
            throw new Error('No se pudo decodificar ningÃºn archivo de audio.');
        }

        appendTracks(validTracks, { reason: 'import-audio-files', recolor: false });

        if (validTracks.length < sources.length) {
            alert('Algunos archivos no se pudieron importar, pero el resto se agregÃ³ correctamente.');
        }
    }, [appendTracks, buildAudioClipFromBuffer, tracks.length]);

    const importLibraryEntryIntoDestination = useCallback(async (
        entry: ScannedFileEntry,
        destination?: ClipDropDestination
    ) => {
        if (!platformService.isDesktop) {
            alert('La importacion por ruta de libreria requiere la version desktop.');
            return;
        }

        const fileData = await platformService.readFileFromPath(entry.path);
        if (!fileData) {
            alert('No se pudo abrir el archivo seleccionado desde la libreria.');
            return;
        }

        const decoded = await engineAdapter.decodeAudioData(fileData.data.slice(0));
        let sourceId: string | undefined;
        try {
            sourceId = await assetDb.saveFile(new Blob([fileData.data], { type: 'application/octet-stream' }));
        } catch (persistError) {
            console.warn('Asset cache unavailable for library import', persistError);
        }

        const destinationTrack = destination?.trackId
            ? tracks.find((track) => track.id === destination.trackId)
            : undefined;

        const startBar = destination?.bar ?? 1;
        const sceneIndex = destination?.sceneIndex ?? 0;
        const placeInSession = Boolean(destination?.placeInSession);

        if (destinationTrack && destinationTrack.type === TrackType.AUDIO) {
            const clip = buildAudioClipFromBuffer(fileData.name, destinationTrack.color, decoded, startBar, sourceId);

            applyTrackMutation((prevTracks) => prevTracks.map((track) => {
                if (track.id !== destinationTrack.id) return track;

                if (placeInSession) {
                    return assignClipToSessionSlot(track, sceneIndex, clip);
                }

                return {
                    ...track,
                    clips: [...track.clips, clip]
                };
            }), { recolor: false, reason: 'browser-drop-library-to-track' });
            setSelectedTrackId(destinationTrack.id);
            setSelectedClipId(clip.id);
            return;
        }

        const newTrack = createTrack({
            id: buildRuntimeId('t-lib'),
            name: fileData.name.replace(/\.[^/.]+$/, "").substring(0, 12) || 'Library Audio',
            type: TrackType.AUDIO,
            color: getTrackColorByPosition(tracks.length, tracks.length + 1),
            volume: -3
        });

        const clip = buildAudioClipFromBuffer(fileData.name, newTrack.color, decoded, startBar, sourceId);
        newTrack.clips.push(clip);
        if (placeInSession) {
            newTrack.sessionClips = [{ id: `slot-${newTrack.id}-${sceneIndex}`, clip, isPlaying: false, isQueued: false }];
        }

        appendTrack(newTrack, { reason: 'browser-drop-library-create-track' });
        setSelectedTrackId(newTrack.id);
        setSelectedClipId(clip.id);
    }, [appendTrack, applyTrackMutation, assignClipToSessionSlot, buildAudioClipFromBuffer, tracks]);

    const handleImportLibraryEntry = useCallback(async (entry: ScannedFileEntry) => {
        try {
            await importLibraryEntryIntoDestination(entry);
        } catch (error) {
            console.error('Library import failed', error);
            alert('Fallo la importacion desde libreria.');
        }
    }, [importLibraryEntryIntoDestination]);

    const insertGeneratorIntoDestination = useCallback((
        type: 'noise' | 'sine',
        destination?: ClipDropDestination
    ): { trackId: string; clipId: string } => {
        const isNoise = type === 'noise';
        const clipName = isNoise ? 'White Noise Burst' : 'Sine 440Hz';
        const clipBuffer = isNoise
            ? engineAdapter.createNoiseBuffer(4)
            : engineAdapter.createSineBuffer(440, 4);
        const destinationTrack = destination?.trackId
            ? tracks.find((track) => track.id === destination.trackId)
            : undefined;
        const startBar = destination?.bar ?? 1;
        const sceneIndex = destination?.sceneIndex ?? 0;
        const placeInSession = Boolean(destination?.placeInSession);

        if (destinationTrack && destinationTrack.type === TrackType.AUDIO) {
            const clip = buildAudioClipFromBuffer(clipName, destinationTrack.color, clipBuffer, startBar);

            applyTrackMutation((prevTracks) => prevTracks.map((track) => {
                if (track.id !== destinationTrack.id) return track;

                if (placeInSession) {
                    return assignClipToSessionSlot(track, sceneIndex, clip);
                }

                return {
                    ...track,
                    clips: [...track.clips, clip]
                };
            }), { recolor: false, reason: 'browser-drop-generator-to-track' });

            return { trackId: destinationTrack.id, clipId: clip.id };
        }

        const trackName = isNoise ? 'Noise Generator' : 'Tone Generator';
        const newTrack = createTrack({
            id: buildRuntimeId(`t-gen-${type}`),
            name: trackName,
            type: TrackType.AUDIO,
            color: isNoise ? '#F472B6' : '#3BF9F6',
            volume: -9
        });
        const clip = buildAudioClipFromBuffer(clipName, newTrack.color, clipBuffer, startBar);
        newTrack.clips.push(clip);
        if (placeInSession) {
            newTrack.sessionClips = [{ id: `slot-${newTrack.id}-${sceneIndex}`, clip, isPlaying: false, isQueued: false }];
        }

        appendTrack(newTrack, { reason: 'browser-drop-generator-create-track' });
        return { trackId: newTrack.id, clipId: clip.id };
    }, [appendTrack, applyTrackMutation, assignClipToSessionSlot, buildAudioClipFromBuffer, tracks]);

    const handleCreateBrowserGeneratorTrack = useCallback((type: 'noise' | 'sine') => {
        const selection = insertGeneratorIntoDestination(type);
        setSelectedTrackId(selection.trackId);
        setSelectedClipId(selection.clipId);
        setMainView('arrange');
        setBottomView('editor');
    }, [insertGeneratorIntoDestination]);

    const cloneClipForDrop = useCallback((clip: Clip, color: string, startBar: number): Clip => {
        return {
            ...clip,
            id: buildRuntimeId('c-drop'),
            color,
            start: Math.max(1, startBar),
            notes: clip.notes.map((note) => ({ ...note }))
        };
    }, []);

    const handleTimelineExternalDrop = useCallback(async (trackId: string, bar: number, payload: BrowserDragPayload) => {
        try {
            if (payload.kind === 'library-entry') {
                await importLibraryEntryIntoDestination(payload.entry, { trackId, bar });
                return;
            }

            if (payload.kind === 'generator') {
                const selection = insertGeneratorIntoDestination(payload.generatorType, { trackId, bar });
                setSelectedTrackId(selection.trackId);
                setSelectedClipId(selection.clipId);
                return;
            }

            const sourceTrack = tracks.find((track) => track.id === payload.sourceTrackId);
            const sourceClip = sourceTrack?.clips.find((clip) => clip.id === payload.clipId);
            const targetTrack = tracks.find((track) => track.id === trackId);
            if (!sourceClip || !sourceTrack || !targetTrack) return;

            const isAudioClip = sourceTrack.type === TrackType.AUDIO;
            const expectedTrackType = isAudioClip ? TrackType.AUDIO : TrackType.MIDI;

            if (targetTrack.type === expectedTrackType) {
                const clip = cloneClipForDrop(sourceClip, targetTrack.color, bar);
                updateTrackById(trackId, {
                    clips: [...targetTrack.clips, clip]
                }, { recolor: false, reason: 'browser-drop-project-clip-to-track' });
                setSelectedTrackId(trackId);
                setSelectedClipId(clip.id);
                return;
            }

            const newTrack = createTrack({
                id: `t-drop-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                name: sourceTrack.name,
                type: expectedTrackType,
                color: sourceTrack.color,
                volume: sourceTrack.volume,
                pan: sourceTrack.pan,
                reverb: sourceTrack.reverb
            });

            const clip = cloneClipForDrop(sourceClip, newTrack.color, bar);
            newTrack.clips.push(clip);

            appendTrack(newTrack, { reason: 'browser-drop-project-clip-create-track' });
            setSelectedTrackId(newTrack.id);
            setSelectedClipId(clip.id);
        } catch (error) {
            console.error('Timeline external drop failed', error);
            alert('No se pudo completar el drop en timeline.');
        }
    }, [appendTrack, cloneClipForDrop, importLibraryEntryIntoDestination, insertGeneratorIntoDestination, tracks, updateTrackById]);

    const handleSessionExternalDrop = useCallback(async (trackId: string, sceneIndex: number, payload: BrowserDragPayload) => {
        try {
            const targetTrack = tracks.find((track) => track.id === trackId);
            if (!targetTrack) return;

            if (payload.kind === 'library-entry') {
                await importLibraryEntryIntoDestination(payload.entry, {
                    trackId,
                    sceneIndex,
                    bar: sceneIndex + 1,
                    placeInSession: true
                });
                return;
            }

            if (payload.kind === 'generator') {
                const selection = insertGeneratorIntoDestination(payload.generatorType, {
                    trackId,
                    sceneIndex,
                    bar: sceneIndex + 1,
                    placeInSession: true
                });
                setSelectedTrackId(selection.trackId);
                setSelectedClipId(selection.clipId);
                return;
            }

            const sourceTrack = tracks.find((track) => track.id === payload.sourceTrackId);
            const sourceClip = sourceTrack?.clips.find((clip) => clip.id === payload.clipId);
            if (!sourceTrack || !sourceClip) return;

            const isAudioClip = sourceTrack.type === TrackType.AUDIO;
            const expectedTrackType = isAudioClip ? TrackType.AUDIO : TrackType.MIDI;

            if (targetTrack.type === expectedTrackType) {
                const clip = cloneClipForDrop(sourceClip, targetTrack.color, sceneIndex + 1);
                applyTrackMutation((prevTracks) => prevTracks.map((track) => {
                    if (track.id !== targetTrack.id) return track;
                    return assignClipToSessionSlot(track, sceneIndex, clip);
                }), { recolor: false, reason: 'browser-drop-session-slot' });
                setSelectedTrackId(targetTrack.id);
                setSelectedClipId(clip.id);
                return;
            }

            const newTrack = createTrack({
                id: `t-session-drop-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                name: sourceTrack.name,
                type: expectedTrackType,
                color: sourceTrack.color,
                volume: sourceTrack.volume,
                pan: sourceTrack.pan,
                reverb: sourceTrack.reverb
            });

            const clip = cloneClipForDrop(sourceClip, newTrack.color, sceneIndex + 1);
            newTrack.clips.push(clip);
            newTrack.sessionClips = [{ id: `slot-${newTrack.id}-${sceneIndex}`, clip, isPlaying: false, isQueued: false }];

            appendTrack(newTrack, { reason: 'browser-drop-session-create-track' });
            setSelectedTrackId(newTrack.id);
            setSelectedClipId(clip.id);
        } catch (error) {
            console.error('Session external drop failed', error);
            alert('No se pudo completar el drop en session view.');
        }
    }, [appendTrack, applyTrackMutation, assignClipToSessionSlot, cloneClipForDrop, importLibraryEntryIntoDestination, insertGeneratorIntoDestination, tracks]);

    const handleImportAudio = useCallback(async () => {
        if (platformService.isElectron) {
            try {
                const files = await platformService.selectAudioFiles();
                if (!files || files.length === 0) return;

                const sources: ImportAudioSource[] = files.map(file => ({
                    name: file.name,
                    arrayBuffer: file.data,
                    persistBlob: new Blob([file.data], { type: 'application/octet-stream' })
                }));

                await importAudioSources(sources);
            } catch (err) {
                console.error("Electron import failed", err);
                alert(err instanceof Error ? err.message : "No se pudo importar el archivo de audio.");
            }
            return;
        }

        fileInputRef.current?.click();
    }, [importAudioSources]);

    const handleFileImport = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        try {
            const fileArray = Array.from(files);
            const sources: ImportAudioSource[] = await Promise.all(fileArray.map(async (file: File) => ({
                name: file.name,
                arrayBuffer: await file.arrayBuffer(),
                persistBlob: file
            })));

            await importAudioSources(sources);

        } catch (err) {
            console.error("Import failed", err);
            alert("No se pudo importar el archivo de audio.");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    }, [importAudioSources]);

    const handleTrackSelect = useCallback((trackId: string) => {
        setSelectedTrackId(trackId);
        setBottomView('editor');
    }, []);

    const handleClipSelect = useCallback((trackId: string, clipId: string) => {
        setSelectedTrackId(trackId);
        setSelectedClipId(clipId);
        setBottomView('editor');
    }, []);

    const handleTimelineSeek = useCallback((bar: number) => {
        void handleSeekToBar(bar);
    }, [handleSeekToBar]);

    const handleTimelineTrackUpdate = useCallback((id: string, updates: Partial<Track>, options?: { noHistory?: boolean; reason?: string }) => {
        updateTrackById(id, updates, { recolor: false, ...options });
    }, [updateTrackById]);

    const handleTimelineClipUpdate = useCallback((trackId: string, clipId: string, updates: Partial<Clip>, options?: { noHistory?: boolean; reason?: string }) => {
        updateClipById(trackId, clipId, updates, { recolor: false, ...options });
    }, [updateClipById]);

    const handleTimelineGridChange = useCallback((size: number, enabled: boolean) => {
        setTransport((prev: TransportState) => ({ ...prev, gridSize: size, snapToGrid: enabled }));
    }, []);

    const handleTimelineTimeUpdate = useCallback((bar: number, beat: number, sixteenth: number) => {
        const engineIsPlaying = engineAdapter.getIsPlaying() || isPlayingRef.current;
        setTransport((prev: TransportState) => {
            if (
                prev.currentBar === bar
                && prev.currentBeat === beat
                && prev.currentSixteenth === sixteenth
                && prev.isPlaying === engineIsPlaying
            ) {
                return prev;
            }

            return {
                ...prev,
                isPlaying: engineIsPlaying,
                currentBar: bar,
                currentBeat: beat,
                currentSixteenth: sixteenth
            };
        });
    }, []);

    const handleTimelineAddTrack = useCallback((type = TrackType.AUDIO) => {
        const count = tracks.filter((track) => track.type === type).length + 1;
        const baseName =
            type === TrackType.RETURN
                ? `Return ${String.fromCharCode(64 + count)}`
                : type === TrackType.GROUP
                    ? `Group ${count}`
                    : `${type === TrackType.MIDI ? 'Midi' : 'Audio'} ${count}`;

        const newTrack = createTrack({
            id: buildRuntimeId(`t-${type.toLowerCase()}`),
            name: baseName,
            type,
            color: getTrackColorByPosition(tracks.length, tracks.length + 1)
        });

        appendTrack(newTrack, { reason: 'timeline-add-track', recolor: false });
    }, [appendTrack, tracks]);

    const handleMixerCreateGroup = useCallback(() => {
        const count = tracks.filter((track) => track.type === TrackType.GROUP).length + 1;
        const newTrack = createTrack({
            id: buildRuntimeId('t-group'),
            name: `Group ${count}`,
            type: TrackType.GROUP,
            color: getTrackColorByPosition(tracks.length, tracks.length + 1)
        });

        appendTrack(newTrack, { reason: 'mixer-create-group', recolor: false });
    }, [appendTrack, tracks]);

    const isScannerImmersive = showNoteScanner;
    const selectedTrack = tracks.find((track) => track.id === selectedTrackId) || null;

    return (
        <div className="daw-immersive-shell flex flex-col h-screen w-screen bg-[#111218] text-daw-text font-sans overflow-hidden selection:bg-daw-ruby selection:text-white">

            {loadingProject && (
                <div className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-300">
                    <div className="bg-[#1a1a1a] p-8 rounded-xl border border-daw-border flex flex-col items-center shadow-2xl">
                        <AppLogo className="animate-bounce mb-4" size={48} withGlow />
                        <h2 className="text-xl font-black text-white tracking-widest uppercase">Procesando</h2>
                        <p className="text-gray-500 text-xs mt-2 font-mono">{loadingMessage}</p>
                    </div>
                </div>
            )}

            {importProgress && (
                <div className="fixed right-4 bottom-12 z-[120] w-[320px] rounded-sm border border-daw-border bg-[#10131c]/96 backdrop-blur-md px-3 py-2 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-400">
                        <span>Importando audio</span>
                        <span className="font-mono text-gray-200">{importProgress.completed}/{importProgress.total}</span>
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-black/40 overflow-hidden">
                        <div
                            className="h-full bg-gradient-to-r from-daw-cyan to-daw-violet transition-all duration-200"
                            style={{ width: `${Math.max(0, Math.min(100, (importProgress.completed / Math.max(1, importProgress.total)) * 100))}%` }}
                        />
                    </div>
                    <div className="mt-1 text-[10px] text-gray-500 truncate">{importProgress.currentFile || 'Preparando importacion...'}</div>
                </div>
            )}

            {!isScannerImmersive && (
                <Transport
                    transport={transport}
                    midiDevices={midiDevices}
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onStop={handleStop}
                    onRecordToggle={handleRecordToggle}
                    onLoopToggle={handleLoopToggle}
                    onSkipStart={handleSkipStart}
                    onSkipEnd={handleSkipEnd}
                    setBpm={handleBpmChange}
                    setMasterTranspose={(t) => setTransport((p: TransportState) => ({ ...p, masterTranspose: t }))}
                    onExport={() => setShowExportModal(true)}
                    setScaleRoot={(r) => setTransport((p: TransportState) => ({ ...p, scaleRoot: r }))}
                    setScaleType={(t: string) => setTransport((p: TransportState) => ({ ...p, scaleType: t as TransportState['scaleType'] }))}
                />
            )}

            <HardwareSettingsModal
                isOpen={showSettings}
                onClose={() => setShowSettings(false)}
                audioSettings={audioSettings}
                onAudioSettingsChange={(nextSettings) => setAudioSettings(sanitizeAudioSettings(nextSettings))}
                engineStats={engineStats}
            />

            <div className={`flex-1 overflow-hidden flex relative transition-[transform,opacity,filter] duration-500 ease-[cubic-bezier(0.22,0.84,0.26,1)] ${showSettings ? 'blur-[1px] scale-[0.995] pointer-events-none select-none brightness-90' : ''}`}>

                <div className="w-[50px] bg-[#1a1a1a] border-r border-daw-border flex flex-col items-center py-3 gap-3 z-[100] shrink-0 relative shadow-xl">
                    {/* ... Sidebar Icons (unchanged) ... */}
                    <div className="relative group" ref={fileMenuRef}>
                        <button onClick={() => setShowFileMenu(!showFileMenu)} className={`w-10 h-10 flex items-center justify-center rounded-sm transition-all duration-100 relative ${showFileMenu ? 'bg-[#333] text-white' : 'text-gray-400 hover:text-white hover:bg-[#222]'}`} title="MenÃº de Proyecto">
                            <Folder size={20} strokeWidth={1.5} />
                        </button>
                        {showFileMenu && (
                            <div className="absolute left-[52px] top-0 w-56 bg-[#1a1a1a] border border-[#444] shadow-[0_5px_15px_rgba(0,0,0,0.5)] z-[101] flex flex-col py-1 animate-in slide-in-from-left-2 duration-100">
                                <div className="px-4 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider border-b border-white/5 mb-1">Archivo</div>
                                <button onClick={handleNewProject} className="text-xs text-left px-4 py-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex justify-between group"><span>Nuevo Proyecto</span></button>
                                <button onClick={() => { handleOpenProject(); setShowFileMenu(false); }} className="text-xs text-left px-4 py-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex justify-between group"><span>Abrir Proyecto...</span></button>
                                <button
                                    onClick={() => {
                                        setShowSettings(true);
                                        setShowFileMenu(false);
                                    }}
                                    className="text-xs text-left px-4 py-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                                >
                                    Configuracion de Audio...
                                </button>

                                <div className="h-px bg-daw-border w-1/2 my-2"></div>
                                <button onClick={handleSaveProject} className="text-xs text-left px-4 py-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex justify-between group"><span>Guardar Proyecto</span><span className="opacity-50 text-[10px]">Ctrl+S</span></button>
                                <button onClick={() => setShowExportModal(true)} className="text-xs text-left px-4 py-2 text-gray-300 hover:bg-white/10 hover:text-white transition-colors flex justify-between group"><span>Exportar Audio</span></button>
                            </div>
                        )}
                    </div>
                    <div className="w-6 h-px bg-white/5 my-1"></div>
                    <div className="flex flex-col gap-2 w-full items-center">
                        <SidebarItem icon={Search} label="Navegador de Archivos" active={showBrowser} onClick={() => toggleToolPanel('browser')} />
                        <SidebarItem icon={Sparkles} label="Generador AI" active={showAI} onClick={() => toggleToolPanel('ai')} color="text-daw-cyan" />
                        <SidebarItem icon={Piano} label="Scanner de Notas" active={showNoteScanner} onClick={() => toggleToolPanel('scanner')} color="text-daw-violet" />
                    </div>
                    <div className="w-6 h-px bg-white/5 my-1"></div>
                    <div className="flex flex-col gap-2 w-full items-center">
                        <SidebarItem icon={LayoutGrid} label="Vista de Arreglo" active={mainView === 'arrange'} onClick={() => setMainView('arrange')} />
                        <SidebarItem icon={PlayCircle} label="Vista de SesiÃ³n (Live)" active={mainView === 'session'} onClick={() => setMainView('session')} color="text-daw-ruby" />
                        <SidebarItem icon={Sliders} label="Mezclador" active={mainView === 'mixer'} onClick={() => setMainView('mixer')} />
                    </div>
                    <div className="w-6 h-px bg-white/5 my-1"></div>
                    <div className="flex flex-col gap-2 w-full items-center">
                        <SidebarItem icon={Cpu} label="Rack de Dispositivos" onClick={() => setBottomView('devices')} active={bottomView === 'devices'} />
                        <SidebarItem icon={Layers} label="Editor de Notas/Audio" onClick={() => setBottomView('editor')} active={bottomView === 'editor'} />
                        <button onClick={handleImportAudio} className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-all" title="Importar RÃ¡pido">
                            <FolderInput size={18} />
                        </button>
                    </div>
                    <div className="flex flex-col gap-1 w-full items-center mt-2">
                        <button onClick={undo} disabled={!canUndo} className={`w-8 h-8 flex items-center justify-center rounded-md transition-all ${!canUndo ? 'text-gray-700 cursor-not-allowed opacity-30' : 'text-gray-400 hover:text-white hover:bg-white/5'}`} title="Deshacer (Ctrl+Z)"><Undo2 size={16} /></button>
                        <button onClick={redo} disabled={!canRedo} className={`w-8 h-8 flex items-center justify-center rounded-md transition-all ${!canRedo ? 'text-gray-700 cursor-not-allowed opacity-30' : 'text-gray-400 hover:text-white hover:bg-white/5'}`} title="Rehacer (Ctrl+Y)"><Redo2 size={16} /></button>
                    </div>
                    <div className="mt-auto flex flex-col gap-3 w-full items-center pb-3">
                        <SidebarItem icon={Users} label="ColaboraciÃ³n" onClick={() => setActiveModal('collab')} active={activeModal === 'collab'} />
                        <SidebarItem icon={Settings} label="Preferencias de Audio/MIDI" onClick={() => setShowSettings(true)} active={showSettings} />
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" multiple accept=".wav,.mp3,.aif,.aiff,.ogg,.flac" onChange={handleFileImport} />
                    {/* Project Input removed in favor of platformService */}
                </div>

                {hasLoadedAISidebar && (
                    <React.Suspense fallback={null}>
                        <AISidebar
                            isOpen={showAI}
                            onClose={closeAllToolPanels}
                            bpm={transport.bpm}
                            onPatternGenerated={(notes: Note[], name: string) => {
                                const newTrack = createTrack({
                                    id: `t-ai-${Date.now()}`,
                                    name: name || 'AI Generator',
                                    type: TrackType.MIDI,
                                    color: '#B34BE4',
                                    volume: -6,
                                    clips: [{
                                        id: `c-ai-${Date.now()}`,
                                        name,
                                        color: '#B34BE4',
                                        start: 1,
                                        length: 4,
                                        notes,
                                        offset: 0,
                                        fadeIn: 0,
                                        fadeOut: 0,
                                        gain: 1,
                                        playbackRate: 1
                                    }]
                                });

                                appendTrack(newTrack);
                                closeAllToolPanels();
                            }}
                            tracks={tracks}
                        />
                    </React.Suspense>
                )}

                <FluidPanel
                    isOpen={showBrowser}
                    direction="left"
                    className="absolute left-[50px] top-0 bottom-0 w-[300px] z-30 h-full border-r border-[#333] shadow-2xl bg-[#1a1a1a]"
                >
                    <Browser
                        onImport={handleImportAudio}
                        onImportFromLibrary={handleImportLibraryEntry}
                        onCreateGeneratorTrack={handleCreateBrowserGeneratorTrack}
                        tracks={tracks}
                    />
                </FluidPanel>

                <FluidPanel
                    isOpen={showNoteScanner}
                    direction="fade"
                    keepMounted
                    className="absolute left-[50px] top-0 right-0 bottom-0 z-[80] h-full border-l border-[#333] shadow-2xl bg-[#0a0a0d]/95 backdrop-blur-[2px]"
                >
                    {hasLoadedNoteScanner && (
                        <React.Suspense fallback={<div className="h-full w-full bg-[#0a0a0d]" />}>
                            <NoteScannerPanel
                                isOpen={showNoteScanner}
                                tracks={tracks}
                                bpm={transport.bpm}
                                selectedTrackId={selectedTrackId}
                                onClose={closeAllToolPanels}
                                onCreateMidiTrack={handleCreateMidiTrackFromScan}
                                onInsertIntoTrack={handleInsertScanIntoMidiTrack}
                            />
                        </React.Suspense>
                    )}
                </FluidPanel>

                <div className="flex-1 overflow-hidden relative flex flex-col bg-transparent">
                    {mainView === 'arrange' ? (
                        <div key="arrange" ref={timelineContainerRef} className="flex-1 overflow-auto bg-transparent relative animate-view-enter" style={{ scrollBehavior: 'auto' }}>
                            <Timeline
                                tracks={tracks}
                                bars={totalProjectBars}
                                zoom={zoom}
                                trackHeight={trackHeight}
                                bpm={transport.bpm}
                                onSeek={handleTimelineSeek}
                                onTrackSelect={handleTrackSelect}
                                onClipSelect={handleClipSelect}
                                onTrackUpdate={handleTimelineTrackUpdate}
                                onTrackDelete={removeTrackWithRoutingCleanup}
                                onClipUpdate={handleTimelineClipUpdate}
                                onConsolidate={handleConsolidateClips}
                                onReverse={handleReverseClip}
                                onQuantize={handleQuantizeClip}
                                onSplitClip={handleSplitClipAtCursor}
                                onDuplicateClip={handleDuplicateClip}
                                onPromoteToComp={handlePromoteClipToComp}
                                onGridChange={handleTimelineGridChange}
                                onExternalDrop={handleTimelineExternalDrop}
                                onAddTrack={handleTimelineAddTrack}
                                gridSize={transport.gridSize}
                                snapToGrid={transport.snapToGrid}
                                isPlaying={transport.isPlaying}
                                selectedTrackId={selectedTrackId}
                                containerRef={timelineContainerRef}
                                onTimeUpdate={handleTimelineTimeUpdate}
                            />
                        </div>
                    ) : mainView === 'session' ? (
                        <div key="session" className="flex-1 overflow-hidden animate-view-enter">
                            <SessionView
                                tracks={tracks}
                                bpm={transport.bpm}
                                onClipSelect={handleClipSelect}
                                onExternalDrop={(trackId, sceneIndex, payload) => {
                                    void handleSessionExternalDrop(trackId, sceneIndex, payload);
                                }}
                            />
                        </div>
                    ) : (
                        <div key="mixer" className="flex-1 bg-transparent overflow-hidden animate-view-enter">
                            <Mixer
                                tracks={tracks}
                                onUpdate={handleMixerTrackUpdate}
                                onDelete={removeTrackWithRoutingCleanup}
                                onStoreSnapshot={storeMixSnapshot}
                                onRecallSnapshot={recallMixSnapshot}
                                onToggleSnapshotCompare={toggleMixSnapshotCompare}
                                canRecallSnapshotA={Boolean(mixSnapshots.A)}
                                canRecallSnapshotB={Boolean(mixSnapshots.B)}
                                activeSnapshot={activeMixSnapshot}
                                onMacroApply={handleMixerMacroApply}
                                onCreateGroup={handleMixerCreateGroup}
                            />
                        </div>
                    )}
                    <div className="h-[300px] bg-[#1a1a1a] border-t border-daw-border relative z-50 shadow-[0_-5px_30px_rgba(0,0,0,0.3)] shrink-0 flex flex-col">
                        <div className="h-7 bg-[#121212] border-b border-daw-border flex items-end px-2 gap-1">
                            <button onClick={() => setBottomView('devices')} className={`text-[9px] font-bold px-4 py-1.5 rounded-t-sm transition-all uppercase tracking-wider flex items-center gap-2 ${bottomView === 'devices' ? 'bg-[#1a1a1a] text-white border-t border-l border-r border-daw-border relative top-[1px]' : 'text-gray-500 hover:text-white bg-[#0e0e0e]'}`}><Cpu size={10} /> Dispositivos</button>
                            <button onClick={() => setBottomView('editor')} className={`text-[9px] font-bold px-4 py-1.5 rounded-t-sm transition-all uppercase tracking-wider flex items-center gap-2 ${bottomView === 'editor' ? 'bg-[#1a1a1a] text-white border-t border-l border-r border-daw-border relative top-[1px]' : 'text-gray-500 hover:text-white bg-[#0e0e0e]'}`}><Layers size={10} /> Editor</button>
                        </div>
                        <div className="flex-1 overflow-hidden relative bg-[#1a1a1a] flex">
                            <div className="min-w-0 flex-1 h-full">
                                {bottomView === 'devices' ? (
                                    <div key="devices" className="h-full animate-view-enter">
                                        <DeviceRack selectedTrack={selectedTrack} onTrackUpdate={(id, updates) => updateTrackById(id, updates, { recolor: false })} />
                                    </div>
                                ) : (
                                    <div key="editor" className="h-full animate-view-enter">
                                        <Editor
                                            track={selectedTrack}
                                            selectedClipId={selectedClipId}
                                            onClipUpdate={(trackId, clipId, updates, options) => updateClipById(trackId, clipId, updates, { recolor: false, ...options })}
                                            transport={transport}
                                        />
                                    </div>
                                )}
                            </div>
                            <AsciiPerformerDock isPlaying={transport.isPlaying} />
                        </div>
                    </div>
                </div>
            </div>
            {!isScannerImmersive && (
                <div className="h-8 bg-[#11131a]/96 border-t border-white/10 flex items-center justify-between px-4 select-none shrink-0 z-50 backdrop-blur-sm">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-white/10 bg-white/[0.03] text-gray-300">
                            <HardDrive size={11} className="text-daw-violet" />
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em]">{projectName}</span>
                        </div>
                        {selectedTrack && (
                            <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-white/10 bg-white/[0.03]">
                                <span className="text-[9px] uppercase tracking-[0.14em] text-gray-500">Track</span>
                                <span className="text-[9px] font-mono text-gray-200">{selectedTrack.name}</span>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-3">
                        {engineStats.sampleRateMismatch && (
                            <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-amber-400/40 bg-amber-500/10" title={engineStats.sampleRateMismatchMessage || `Solicitado ${engineStats.requestedSampleRate}, activo ${engineStats.activeSampleRate}`}>
                                <AlertTriangle size={11} className="text-amber-300" />
                                <span className="text-[9px] font-mono text-amber-100">SR solicitado {engineStats.requestedSampleRate}, activo {engineStats.activeSampleRate}</span>
                            </div>
                        )}
                        <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-white/10 bg-white/[0.03]">
                            <span className="text-[9px] uppercase tracking-[0.14em] text-gray-500">View</span>
                            <span className="text-[9px] font-mono text-gray-200">{bottomView === 'devices' ? 'Devices' : 'Editor'}</span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-white/10 bg-white/[0.03]">
                            <span className={`w-1.5 h-1.5 rounded-full ${engineStats.state === 'running' ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.9)]' : 'bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.8)]'}`}></span>
                            <span className="text-[9px] font-mono text-gray-300">{Math.round(transport.bpm)} BPM</span>
                        </div>
                        <div className="flex items-center gap-2 px-2.5 h-5 rounded-sm border border-white/10 bg-white/[0.03]" title={`Autosave reason: ${lastAutosaveReason}`}>
                            <span className="text-[9px] uppercase tracking-[0.14em] text-gray-500">Autosave</span>
                            <span className="text-[9px] font-mono text-gray-200">
                                {lastAutosaveAt ? new Date(lastAutosaveAt).toLocaleTimeString() : '--:--:--'}
                            </span>
                        </div>
                    </div>
                </div>
            )}
            {hasLoadedExportModal && (
                <React.Suspense fallback={null}>
                    <ExportModal isOpen={showExportModal} onClose={() => setShowExportModal(false)} tracks={tracks} totalBars={200} bpm={transport.bpm} />
                </React.Suspense>
            )}
            <Modal isOpen={activeModal === 'recovery'} onClose={handleDiscardRecoverySnapshot} title="RecuperaciÃ³n automÃ¡tica">
                <div className="flex flex-col gap-4">
                    <p className="text-xs text-gray-300 leading-relaxed">
                        Detectamos un cierre inesperado en la sesiÃ³n anterior. Puedes restaurar el Ãºltimo autosave para continuar donde te quedaste.
                    </p>
                    {recoverySnapshot && (
                        <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3">
                            <div className="text-[10px] uppercase tracking-wider text-gray-500">Ãšltimo autosave</div>
                            <div className="mt-2 text-xs text-gray-200 font-semibold">{recoverySnapshot.projectName}</div>
                            <div className="mt-1 text-[10px] text-gray-500 font-mono">{new Date(recoverySnapshot.timestamp).toLocaleString()}</div>
                            <div className="mt-1 text-[10px] text-daw-cyan">{recoverySnapshot.reason}</div>
                        </div>
                    )}
                    <div className="flex flex-col gap-2">
                        <button
                            onClick={() => {
                                void handleRestoreRecoverySnapshot();
                            }}
                            className="w-full py-2.5 rounded-sm bg-daw-cyan text-[#071017] text-xs font-bold uppercase tracking-wider hover:brightness-110 transition-all"
                        >
                            Restaurar autosave
                        </button>
                        <button
                            onClick={handleDiscardRecoverySnapshot}
                            className="w-full py-2 rounded-sm border border-white/15 text-xs text-gray-300 hover:bg-white/[0.06] transition-all"
                        >
                            Descartar y continuar
                        </button>
                    </div>
                </div>
            </Modal>
            <Modal isOpen={activeModal === 'new-project-confirm'} onClose={() => setActiveModal(null)} title="Nuevo Proyecto"><div className="flex flex-col gap-6"><div className="flex items-start gap-4 text-white"><div className="p-3 bg-daw-ruby/20 rounded-full shrink-0"><AlertTriangle className="text-daw-ruby" size={24} /></div><div><h3 className="font-bold text-lg mb-1">Â¿Deseas guardar los cambios?</h3><p className="text-gray-400 text-xs leading-relaxed">Si continÃºas sin guardar, perderÃ¡s todo el trabajo actual para abrir un espacio de trabajo limpio.</p></div></div><div className="flex flex-col gap-2"><button onClick={async () => { await handleSaveProject(); resetProjectToEmpty(); }} className="w-full flex items-center justify-between px-4 py-3 bg-white text-black rounded-sm font-bold text-xs hover:bg-gray-200 transition-all group"><div className="flex items-center gap-3"><Save size={16} /><span>GUARDAR Y CREAR NUEVO</span></div></button><button onClick={resetProjectToEmpty} className="w-full flex items-center gap-3 px-4 py-3 bg-[#222] text-daw-ruby border border-daw-ruby/30 rounded-sm font-bold text-xs hover:bg-daw-ruby hover:text-white transition-all"><Trash2 size={16} /><span>CONTINUAR SIN GUARDAR</span></button><button onClick={() => setActiveModal(null)} className="w-full py-2 text-gray-500 hover:text-white text-[10px] font-bold uppercase tracking-widest mt-2">CANCELAR</button></div></div></Modal>

            <Modal isOpen={activeModal === 'collab'} onClose={() => setActiveModal(null)} title="ColaboraciÃ³n">
                <CollabPanel
                    sessionId={collabSessionId}
                    userName={collabUserName}
                    commandCount={projectCommandCount}
                    activity={collabActivity}
                    onUserNameChange={setCollabUserName}
                    onStartSession={handleStartCollabSession}
                    onStopSession={handleStopCollabSession}
                    onCopyInvite={handleCopyCollabInvite}
                />
            </Modal>
        </div>
    );
};

export default App;

