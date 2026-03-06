
export enum TrackType {
  MIDI = 'MIDI',
  AUDIO = 'AUDIO',
  GROUP = 'GROUP',
  RETURN = 'RETURN',
  MASTER = 'MASTER'
}

export interface Note {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface Clip {
  id: string;
  name: string;
  color: string;
  notes: Note[];
  start: number; // Start position in bars
  length: number; // in bars
  offset: number; // Start point within the source audio (in bars)
  fadeIn: number; // fade in length in bars
  fadeOut: number; // fade out length in bars
  gain: number; // clip volume (linear 0-1, default 1)
  playbackRate: number; // Playback speed (1 = normal, 0.5 = half speed)
  originalBpm?: number;
  isWarped?: boolean; // [NEW] If true, use Granular Engine for independent Pitch/Time. If false, use Native Buffer.
  transpose?: number; // [NEW] Semitones (+/- 24). Controls Pitch.

  // RUNTIME DATA (Not Saved)
  buffer?: AudioBuffer;
  isOffline?: boolean; // If true, the source file is missing from DB

  // PERSISTENCE (Saved)
  sourceId?: string; // The Hash key to look up in IndexedDB
}

export interface ClipSlot {
  id: string;
  clip: Clip | null;
  isPlaying: boolean;
  isQueued: boolean;
}

export interface Device {
  id: string;
  name: string;
  type: 'instrument' | 'effect' | 'eq' | 'vst-loader';
  params: {
    name: string;
    value: number;
    min: number;
    max: number;
    unit?: string;
  }[];
}

// ============================================================================
// AUTOMATION TYPES
// ============================================================================

export type AutomationCurveType = 'linear' | 'easeIn' | 'easeOut' | 'sCurve' | 'hold';

export interface AutomationPoint {
  id: string;
  time: number; // In bars (e.g., 1.5 = beat 3 of bar 1)
  value: number; // Normalized 0-1
  curveType: AutomationCurveType;
  // Bezier control point offsets for custom curves (optional)
  tangentIn?: { x: number; y: number };
  tangentOut?: { x: number; y: number };
}

export type AutomationParam = 'volume' | 'pan' | 'mute' | 'filterCutoff' | 'filterResonance' | 'reverb' | 'custom';
export type AutomationMode = 'off' | 'read' | 'touch' | 'latch' | 'write';

export interface AutomationLane {
  id: string;
  param: AutomationParam;
  paramName: string; // Display name (e.g., "Volume", "Filter Cutoff")
  color: string; // Hex color for the lane
  isExpanded: boolean;
  points: AutomationPoint[];
  minValue?: number; // Parameter minimum (default 0)
  maxValue?: number; // Parameter maximum (default 1)
}

export interface RecordingTake {
  id: string;
  clipId: string;
  trackId: string;
  laneId: string;
  sourceId?: string;
  startBar: number;
  lengthBars: number;
  offsetBars: number;
  createdAt: number;
  label?: string;
  gain?: number;
  muted?: boolean;
}

export interface CompSegment {
  id: string;
  takeId: string;
  sourceStartBar: number;
  sourceEndBar: number;
  targetStartBar: number;
  fadeInBars?: number;
  fadeOutBars?: number;
}

export interface TakeLane {
  id: string;
  name: string;
  trackId: string;
  isCompLane?: boolean;
  isMuted?: boolean;
  takeIds: string[];
  compSegments?: CompSegment[];
}

export interface PunchRange {
  enabled: boolean;
  inBar: number;
  outBar: number;
  preRollBars?: number;
  countInBars?: number;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volume: number;
  pan: number;
  reverb: number;
  transpose: number;
  monitor: 'in' | 'auto' | 'off';
  isMuted: boolean;
  isSoloed: boolean;
  isArmed: boolean;
  inputDeviceId?: string;
  micSettings?: MicSettings;
  sends?: Record<string, number>; // Map of Return Track ID -> Send Amount (linear 0-1, legacy dB accepted)
  sendModes?: Record<string, 'pre' | 'post'>;
  groupId?: string;
  vcaGroupId?: string;
  soloSafe?: boolean;
  automationMode?: AutomationMode;
  clips: Clip[];
  sessionClips: ClipSlot[];
  devices: Device[];
  automationLanes?: AutomationLane[];
  recordingTakes?: RecordingTake[];
  takeLanes?: TakeLane[];
  activeCompLaneId?: string;
  activeTakeId?: string;
  soloTakeId?: string;
  punchRange?: PunchRange;
}

export type MicInputProfile = 'studio-voice' | 'podcast' | 'raw';

export interface MicSettings {
  profile: MicInputProfile;
  inputGain: number;
  monitoringEnabled: boolean;
  monitoringReverb: boolean;
  monitoringEcho: boolean;
}

export type LoopMode = 'off' | 'once' | 'infinite';

export interface TransportState {
  isPlaying: boolean;
  isRecording: boolean;
  loopMode: LoopMode;
  isLooping?: boolean; // Legacy project compatibility
  bpm: number;
  timeSignature: [number, number];
  currentBar: number;
  currentBeat: number;
  currentSixteenth: number;
  masterTranspose: number;
  gridSize: number;
  snapToGrid: boolean;
  scaleRoot: number;
  scaleType: 'major' | 'minor' | 'dorian' | 'phrygian' | 'chromatic' | 'pentatonic-major' | 'pentatonic-minor';
}

export interface AudioSettings {
  sampleRate: 44100 | 48000 | 88200 | 96000 | 192000;
  bufferSize: 'auto' | 128 | 256 | 512 | 1024 | 2048;
  latencyHint: 'interactive' | 'balanced' | 'playback' | string;
  inputDeviceId?: string;
  outputDeviceId?: string;
  lastFailedOutputDeviceId?: string;
}

export type EngineBackendRoute = 'webaudio' | 'worker-dsp' | 'native-sidecar';

export interface EngineRouteKpiSnapshot {
  route: EngineBackendRoute;
  timestamp: number;
  contextState: AudioContextState | 'closed';
  monitorLatencyMs: number;
  schedulerP95TickDriftMs: number;
  schedulerP99TickDriftMs: number;
  schedulerP99LoopMs: number;
  schedulerCpuLoadP95Percent: number;
  schedulerOverrunRatio: number;
  schedulerUnderrunCount: number;
  schedulerDropoutCount: number;
}

export interface Block1RouteEvaluation {
  route: EngineBackendRoute;
  implementationStatus: 'native' | 'simulated';
  cpuAudioP95Ms: number;
  cpuAudioP95ImprovementRatio: number;
  dropouts: number;
  dropoutReductionRatio: number;
  driftP99Ms: number;
  monitorLatencyP95Ms: number;
  passesGate: boolean;
  notes: string[];
}

// LIGHTWEIGHT PROJECT MANIFEST
// Just logic, no binaries.
export interface ProjectData {
  version: string;
  name: string;
  tracks: Track[];
  transport: TransportState;
  audioSettings: AudioSettings;
  createdAt: number;
  lastModified: number;
}

export interface FileData {
  name: string;
  data: ArrayBuffer;
  path?: string;
}

export type ExportAudioFormat = 'wav' | 'aiff' | 'flac' | 'mp3';

export interface AudioTranscodeRequest {
  inputData: ArrayBuffer;
  outputFormat: ExportAudioFormat;
  sampleRate: number;
  bitDepth: 16 | 24 | 32;
}

export interface AudioTranscodeResult {
  success: boolean;
  data?: ArrayBuffer;
  mimeType?: string;
  extension?: ExportAudioFormat;
  error?: string;
}

export interface DirectoryScanRequest {
  directory: string;
  extensions: string[];
}

export interface ScannedFileEntry {
  name: string;
  path: string;
  size: number;
}

export interface DesktopWindowState {
  isMaximized: boolean;
  isMinimized: boolean;
  isFullScreen: boolean;
}

export interface DesktopHostAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  getWindowState?: () => Promise<DesktopWindowState>;
  onWindowStateChange?: (callback: (state: DesktopWindowState) => void) => (() => void);
  selectFiles: () => Promise<FileData[]>;
  readFileFromPath?: (filePath: string) => Promise<FileData | null>;
  selectDirectory?: () => Promise<string | null>;
  scanDirectoryFiles?: (request: DirectoryScanRequest) => Promise<ScannedFileEntry[]>;
  saveProject: (data: string, filename: string) => Promise<{ success: boolean; filePath?: string }>;
  openProject: () => Promise<{ text: string; filename: string } | null>;
  transcodeAudio?: (request: AudioTranscodeRequest) => Promise<AudioTranscodeResult>;
  platform: string;
}

export interface ElectronAPI extends DesktopHostAPI { }

declare global {
  interface Window {
    electron?: ElectronAPI;
    nativeWindows?: DesktopHostAPI;
  }
}
