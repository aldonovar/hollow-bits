import { AudioSettings, Clip, EngineBackendRoute, Track } from '../types';
import {
    audioEngine,
    EngineDiagnostics,
    EngineRecordingResult,
    EngineSchedulerMode,
    GraphUpdateStats,
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
    getRuntimeDiagnostics: () => {
        contextState: AudioContextState | 'closed';
        hasMasterGraph: boolean;
        activeSourceCount: number;
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
    ensurePlaybackReady: () => Promise<boolean>;
    play: (tracks: Track[], bpm: number, pitch: number, offsetTime: number) => void;
    pause: () => void;
    stop: (reset: boolean) => void;
    seek: (time: number, tracks: Track[], bpm: number) => void;

    recoverPlaybackGraph: (tracks: Track[]) => Promise<void>;

    getSchedulerMode: () => EngineSchedulerMode;
    setSchedulerMode: (mode: EngineSchedulerMode) => void;
    getSchedulerTelemetry: () => SchedulerTelemetrySnapshot;
    getLastGraphUpdateStats: () => GraphUpdateStats;

    getSessionLaunchTime: (quantizeBars?: number) => number;
    getContext: () => AudioContext;
    launchClip: (track: Track, clip: Clip, launchTime?: number) => void;
    stopTrackClips: (trackId: string, stopAt?: number) => void;

    startRecording: (trackId: string, deviceId?: string) => Promise<void>;
    stopRecording: (trackId: string) => Promise<EngineRecordingResult | null>;
    finalizeRecording: (trackId: string) => Promise<EngineRecordingResult | null>;
    getActiveRecordingTrackIds: () => string[];

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
        audioEngine.launchClip(track, clip, launchTime);
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
        return audioEngine.stopRecording(trackId);
    },

    getActiveRecordingTrackIds() {
        return audioEngine.getActiveRecordingTrackIds();
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
    EngineDiagnostics,
    EngineRecordingResult,
    EngineSchedulerMode,
    GraphUpdateStats,
    SchedulerTelemetrySnapshot
};
export type { EngineBackendRoute } from '../types';

