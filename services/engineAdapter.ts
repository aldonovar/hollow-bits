import {
    AudioSettings,
    AutomationRuntimeFrame,
    Clip,
    EngineBackendRoute,
    MonitoringRouteSnapshot,
    SessionHealthSnapshot,
    Track,
    TransportPlaybackSessionId,
    TransportAuthoritySnapshot
} from '../types';
import {
    audioEngine,
    AudioRuntimeCounters,
    EngineDiagnostics,
    EngineRecordingResult,
    EngineSchedulerMode,
    GraphUpdateStats,
    SessionLaunchTelemetryEvent,
    SchedulerTelemetrySnapshot
} from './audioEngine';

export type EngineRouteImplementationStatus = 'native' | 'simulated';

export interface EngineRouteDescriptor {
    route: EngineBackendRoute;
    label: string;
    status: EngineRouteImplementationStatus;
    description: string;
}

export interface EngineAdapter {
    setBackendRoute: (route: EngineBackendRoute) => void;
    getBackendRoute: () => EngineBackendRoute;
    getAvailableRoutes: () => EngineRouteDescriptor[];
    getBackendImplementationStatus: (route?: EngineBackendRoute) => EngineRouteImplementationStatus;

    init: (settings?: AudioSettings) => Promise<void>;
    getDiagnostics: () => EngineDiagnostics;
    getAudioRuntimeCounters: () => AudioRuntimeCounters;
    resetRuntimeTelemetry: () => void;
    getSessionHealthSnapshot: (overrides?: Partial<SessionHealthSnapshot>) => SessionHealthSnapshot;
    getRuntimeDiagnostics: () => {
        contextState: AudioContextState | 'closed';
        hasMasterGraph: boolean;
        activeSourceCount: number;
        activePlaybackSessionId: TransportPlaybackSessionId;
        transportCommandEpoch: number;
        offsetTimeSec: number;
        trackNodeCount: number;
        masterVolumeDb: number;
        cueTrackId: string | null;
        cueMode: 'pfl' | 'afl' | null;
    };

    setAudioConfiguration: (newSettings: AudioSettings) => void;
    getSettings: () => AudioSettings;
    restartEngine: (newSettings?: AudioSettings) => Promise<void>;
    getAvailableDevices: () => Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;

    updateTracks: (tracks: Track[]) => void;
    getMasterMeter: () => { rmsDb: number; peakDb: number };
    getMasterVolumeDb: () => number;
    setMasterVolumeDb: (volumeDb: number) => void;
    setMasterPitch: (semitones: number) => void;
    setBpm: (bpm: number) => void;

    getIsPlaying: () => boolean;
    getCurrentTime: () => number;
    getTransportAuthoritySnapshot: () => TransportAuthoritySnapshot;
    ensurePlaybackReady: () => Promise<boolean>;
    play: (tracks: Track[], bpm: number, pitch: number, offsetTime: number) => void;
    pause: () => void;
    stop: (reset: boolean) => void;
    seek: (time: number, tracks: Track[], bpm: number) => void;
    applyAutomationRuntimeFrame: (frame: AutomationRuntimeFrame) => void;

    recoverPlaybackGraph: (tracks: Track[]) => Promise<void>;

    getSchedulerMode: () => EngineSchedulerMode;
    setSchedulerMode: (mode: EngineSchedulerMode) => void;
    getSchedulerTelemetry: () => SchedulerTelemetrySnapshot;
    getLastGraphUpdateStats: () => GraphUpdateStats;

    getSessionLaunchTime: (quantizeBars?: number) => number;
    getContext: () => AudioContext;
    launchClip: (track: Track, clip: Clip, launchTime?: number) => SessionLaunchTelemetryEvent | null;
    stopTrackClips: (trackId: string, stopAt?: number) => void;

    startRecording: (trackId: string, deviceId?: string) => Promise<void>;
    stopRecording: (trackId: string) => Promise<EngineRecordingResult | null>;
    finalizeRecording: (trackId: string) => Promise<EngineRecordingResult | null>;
    getActiveRecordingTrackIds: () => string[];
    getPendingFinalizeTrackIds: () => string[];
    stopTrackMonitoring: (trackId: string) => void;
    getMonitoringRouteSnapshots: () => MonitoringRouteSnapshot[];

    decodeAudioData: (arrayBuffer: ArrayBuffer) => Promise<AudioBuffer>;
    createNoiseBuffer: (seconds?: number) => AudioBuffer;
    createSineBuffer: (freq?: number, seconds?: number) => AudioBuffer;
}

const ROUTE_DESCRIPTORS: EngineRouteDescriptor[] = [
    {
        route: 'webaudio',
        label: 'TS/WebAudio (Hardening)',
        status: 'native',
        description: 'Ruta principal actual con scheduler interval/worklet y telemetria activa.'
    },
    {
        route: 'worker-dsp',
        label: 'TS + Worker DSP',
        status: 'simulated',
        description: 'Ruta en evaluacion. Actualmente corre sobre el backend webaudio para benchmark comparable.'
    },
    {
        route: 'native-sidecar',
        label: 'Native Sidecar (Rust/C++)',
        status: 'simulated',
        description: 'Ruta en evaluacion. Actualmente emulada para matriz tecnica sin romper UI.'
    }
];

let activeRoute: EngineBackendRoute = 'webaudio';

const findRouteDescriptor = (route: EngineBackendRoute): EngineRouteDescriptor => {
    return ROUTE_DESCRIPTORS.find((descriptor) => descriptor.route === route) || ROUTE_DESCRIPTORS[0];
};

export const engineAdapter: EngineAdapter = {
    setBackendRoute(route) {
        activeRoute = route;
    },

    getBackendRoute() {
        return activeRoute;
    },

    getAvailableRoutes() {
        return ROUTE_DESCRIPTORS.map((descriptor) => ({ ...descriptor }));
    },

    getBackendImplementationStatus(route = activeRoute) {
        return findRouteDescriptor(route).status;
    },

    init(settings) {
        return audioEngine.init(settings);
    },

    getDiagnostics() {
        return audioEngine.getDiagnostics();
    },

    getAudioRuntimeCounters() {
        return audioEngine.getAudioRuntimeCounters();
    },

    resetRuntimeTelemetry() {
        audioEngine.resetRuntimeTelemetry();
    },

    getSessionHealthSnapshot(overrides) {
        const counters = audioEngine.getAudioRuntimeCounters();
        return {
            capturedAt: Number.isFinite(overrides?.capturedAt) ? Number(overrides?.capturedAt) : counters.capturedAt,
            profile: overrides?.profile === 'stage-safe' ? 'stage-safe' : 'studio',
            hasRealtimeAudio: Boolean(overrides?.hasRealtimeAudio),
            cpuAudioP95Percent: Number.isFinite(overrides?.cpuAudioP95Percent)
                ? Math.max(0, Number(overrides?.cpuAudioP95Percent))
                : counters.cpuAudioP95Percent,
            dropoutsDelta: Number.isFinite(overrides?.dropoutsDelta)
                ? Math.max(0, Math.floor(Number(overrides?.dropoutsDelta)))
                : 0,
            underrunsDelta: Number.isFinite(overrides?.underrunsDelta)
                ? Math.max(0, Math.floor(Number(overrides?.underrunsDelta)))
                : 0,
            launchErrorP95Ms: Number.isFinite(overrides?.launchErrorP95Ms)
                ? Math.max(0, Number(overrides?.launchErrorP95Ms))
                : 0,
            uiFpsP95: Number.isFinite(overrides?.uiFpsP95)
                ? Math.max(0, Number(overrides?.uiFpsP95))
                : 60,
            uiFrameDropRatio: Number.isFinite(overrides?.uiFrameDropRatio)
                ? Math.max(0, Number(overrides?.uiFrameDropRatio))
                : 0,
            transportDriftP99Ms: Number.isFinite(overrides?.transportDriftP99Ms)
                ? Math.max(0, Number(overrides?.transportDriftP99Ms))
                : counters.transportDriftP99Ms,
            monitorLatencyP95Ms: Number.isFinite(overrides?.monitorLatencyP95Ms)
                ? Math.max(0, Number(overrides?.monitorLatencyP95Ms))
                : counters.monitorLatencyP95Ms
        };
    },

    getRuntimeDiagnostics() {
        return audioEngine.getRuntimeDiagnostics();
    },

    setAudioConfiguration(newSettings) {
        audioEngine.setAudioConfiguration(newSettings);
    },

    getSettings() {
        return audioEngine.getSettings();
    },

    restartEngine(newSettings) {
        return audioEngine.restartEngine(newSettings);
    },

    getAvailableDevices() {
        return audioEngine.getAvailableDevices();
    },

    updateTracks(tracks) {
        audioEngine.updateTracks(tracks);
    },

    getMasterMeter() {
        return audioEngine.getMasterMeter();
    },

    getMasterVolumeDb() {
        return audioEngine.getMasterVolumeDb();
    },

    setMasterVolumeDb(volumeDb) {
        audioEngine.setMasterVolumeDb(volumeDb);
    },

    setMasterPitch(semitones) {
        audioEngine.setMasterPitch(semitones);
    },

    setBpm(bpm) {
        audioEngine.setBpm(bpm);
    },

    getIsPlaying() {
        return audioEngine.getIsPlaying();
    },

    getCurrentTime() {
        return audioEngine.getCurrentTime();
    },

    getTransportAuthoritySnapshot() {
        return audioEngine.getTransportAuthoritySnapshot();
    },

    ensurePlaybackReady() {
        return audioEngine.ensurePlaybackReady();
    },

    play(tracks, bpm, pitch, offsetTime) {
        audioEngine.play(tracks, bpm, pitch, offsetTime);
    },

    pause() {
        audioEngine.pause();
    },

    stop(reset) {
        audioEngine.stop(reset);
    },

    seek(time, tracks, bpm) {
        audioEngine.seek(time, tracks, bpm);
    },

    applyAutomationRuntimeFrame(frame) {
        audioEngine.applyAutomationRuntimeFrame(frame);
    },

    recoverPlaybackGraph(tracks) {
        return audioEngine.recoverPlaybackGraph(tracks);
    },

    getSchedulerMode() {
        return audioEngine.getSchedulerMode();
    },

    setSchedulerMode(mode) {
        audioEngine.setSchedulerMode(mode);
    },

    getSchedulerTelemetry() {
        return audioEngine.getSchedulerTelemetry();
    },

    getLastGraphUpdateStats() {
        return audioEngine.getLastGraphUpdateStats();
    },

    getSessionLaunchTime(quantizeBars) {
        return audioEngine.getSessionLaunchTime(quantizeBars);
    },

    getContext() {
        return audioEngine.getContext();
    },

    launchClip(track, clip, launchTime) {
        return audioEngine.launchClip(track, clip, launchTime);
    },

    stopTrackClips(trackId, stopAt) {
        audioEngine.stopTrackClips(trackId, stopAt);
    },

    startRecording(trackId, deviceId) {
        return audioEngine.startRecording(trackId, deviceId);
    },

    stopRecording(trackId) {
        return audioEngine.stopRecording(trackId);
    },

    finalizeRecording(trackId) {
        return audioEngine.finalizeRecording(trackId);
    },

    getActiveRecordingTrackIds() {
        return audioEngine.getActiveRecordingTrackIds();
    },

    getPendingFinalizeTrackIds() {
        return audioEngine.getPendingFinalizeTrackIds();
    },

    stopTrackMonitoring(trackId) {
        audioEngine.stopTrackMonitoring(trackId);
    },

    getMonitoringRouteSnapshots() {
        return audioEngine.getMonitoringRouteSnapshots();
    },

    decodeAudioData(arrayBuffer) {
        return audioEngine.decodeAudioData(arrayBuffer);
    },

    createNoiseBuffer(seconds) {
        return audioEngine.createNoiseBuffer(seconds);
    },

    createSineBuffer(freq, seconds) {
        return audioEngine.createSineBuffer(freq, seconds);
    }
};

export type {
    AudioRuntimeCounters,
    EngineDiagnostics,
    EngineRecordingResult,
    EngineSchedulerMode,
    GraphUpdateStats,
    SessionLaunchTelemetryEvent,
    SchedulerTelemetrySnapshot
};
export type { EngineBackendRoute } from '../types';



