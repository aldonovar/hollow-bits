import { Track, TrackType } from '../types';
import { loadStudioSettings } from './studioSettingsService';

interface CreateTrackOptions {
    id: string;
    name: string;
    type: TrackType;
    color?: string;
    volume?: number;
    pan?: number;
    reverb?: number;
    transpose?: number;
    monitor?: Track['monitor'];
    isMuted?: boolean;
    isSoloed?: boolean;
    isArmed?: boolean;
    clips?: Track['clips'];
    sessionClips?: Track['sessionClips'];
    devices?: Track['devices'];
    sends?: Record<string, number>;
    sendModes?: Record<string, 'pre' | 'post'>;
    groupId?: string;
    vcaGroupId?: string;
    soloSafe?: boolean;
    automationMode?: Track['automationMode'];
    automationLanes?: Track['automationLanes'];
    recordingTakes?: Track['recordingTakes'];
    takeLanes?: Track['takeLanes'];
    activeCompLaneId?: Track['activeCompLaneId'];
    punchRange?: Track['punchRange'];
    micSettings?: Track['micSettings'];
}

const cloneTracksCollection = <T>(source: T[] | undefined): T[] => {
    if (!source) return [];
    return [...source];
};

const cloneRecordingTakes = (source: Track['recordingTakes'] | undefined): NonNullable<Track['recordingTakes']> => {
    if (!source) return [];
    return source.map((take) => ({ ...take }));
};

const cloneTakeLanes = (source: Track['takeLanes'] | undefined): NonNullable<Track['takeLanes']> => {
    if (!source) return [];
    return source.map((lane) => ({
        ...lane,
        takeIds: [...lane.takeIds],
        compSegments: lane.compSegments ? lane.compSegments.map((segment) => ({ ...segment })) : undefined
    }));
};

const resolveDefaultAudioListening = (): { monitor: Track['monitor']; monitoringEnabled: boolean } => {
    const settings = loadStudioSettings();

    if (settings.defaultListenMode === 'always') {
        return {
            monitor: 'in',
            monitoringEnabled: true
        };
    }

    if (settings.defaultListenMode === 'armed') {
        return {
            monitor: 'auto',
            monitoringEnabled: true
        };
    }

    return {
        monitor: 'auto',
        monitoringEnabled: false
    };
};

export const createTrack = (options: CreateTrackOptions): Track => {
    const defaultAudioListening = options.type === TrackType.AUDIO ? resolveDefaultAudioListening() : null;

    return {
        id: options.id,
        name: options.name,
        type: options.type,
        color: options.color ?? '#B34BE4',
        volume: options.volume ?? 0,
        pan: options.pan ?? 0,
        reverb: options.reverb ?? 0,
        transpose: options.transpose ?? 0,
        monitor: options.monitor ?? defaultAudioListening?.monitor ?? 'auto',
        isMuted: options.isMuted ?? false,
        isSoloed: options.isSoloed ?? false,
        isArmed: options.isArmed ?? false,
        clips: cloneTracksCollection(options.clips),
        sessionClips: cloneTracksCollection(options.sessionClips),
        devices: cloneTracksCollection(options.devices),
        sends: { ...(options.sends || {}) },
        sendModes: { ...(options.sendModes || {}) },
        groupId: options.groupId,
        vcaGroupId: options.vcaGroupId,
        soloSafe: options.soloSafe ?? false,
        automationMode: options.automationMode ?? 'read',
        automationLanes: options.automationLanes ? [...options.automationLanes] : undefined,
        recordingTakes: cloneRecordingTakes(options.recordingTakes),
        takeLanes: cloneTakeLanes(options.takeLanes),
        activeCompLaneId: options.activeCompLaneId,
        punchRange: options.punchRange ? { ...options.punchRange } : undefined,
        micSettings: options.micSettings
            ? { ...options.micSettings }
            : {
                profile: 'studio-voice',
                inputGain: 1,
                monitoringEnabled: defaultAudioListening?.monitoringEnabled ?? false,
                monitoringReverb: false,
                monitoringEcho: false
            }
    };
};

export const withTrackRuntimeDefaults = (track: Track): Track => {
    return {
        ...track,
        sends: track.sends || {},
        sendModes: track.sendModes || {},
        soloSafe: track.soloSafe ?? false,
        automationMode: track.automationMode ?? 'read',
        recordingTakes: cloneRecordingTakes(track.recordingTakes),
        takeLanes: cloneTakeLanes(track.takeLanes),
        activeCompLaneId: track.activeCompLaneId,
        punchRange: track.punchRange
            ? { ...track.punchRange }
            : {
                enabled: false,
                inBar: 1,
                outBar: 2,
                preRollBars: 1,
                countInBars: 0
            },
        micSettings: track.micSettings
            ? { ...track.micSettings }
            : {
                profile: 'studio-voice',
                inputGain: 1,
                monitoringEnabled: false,
                monitoringReverb: false,
                monitoringEcho: false
            }
    };
};

export const removeTrackRoutingReferences = (tracks: Track[], trackId: string): Track[] => {
    const filtered = tracks.filter((track) => track.id !== trackId);

    return filtered.map((track) => {
        const nextSends = track.sends
            ? Object.fromEntries(Object.entries(track.sends).filter(([targetId]) => targetId !== trackId))
            : track.sends;

        const nextSendModes = track.sendModes
            ? Object.fromEntries(Object.entries(track.sendModes).filter(([targetId]) => targetId !== trackId))
            : track.sendModes;

        return {
            ...track,
            sends: nextSends,
            sendModes: nextSendModes,
            groupId: track.groupId === trackId ? undefined : track.groupId,
            vcaGroupId: track.vcaGroupId === trackId ? undefined : track.vcaGroupId
        };
    });
};
