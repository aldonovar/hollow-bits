import { Track, TrackType } from '../types';

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
}

const cloneTracksCollection = <T>(source: T[] | undefined): T[] => {
    if (!source) return [];
    return [...source];
};

export const createTrack = (options: CreateTrackOptions): Track => {
    return {
        id: options.id,
        name: options.name,
        type: options.type,
        color: options.color ?? '#B34BE4',
        volume: options.volume ?? 0,
        pan: options.pan ?? 0,
        reverb: options.reverb ?? 0,
        transpose: options.transpose ?? 0,
        monitor: options.monitor ?? 'auto',
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
        automationLanes: options.automationLanes ? [...options.automationLanes] : undefined
    };
};

export const withTrackRuntimeDefaults = (track: Track): Track => {
    return {
        ...track,
        sends: track.sends || {},
        sendModes: track.sendModes || {},
        soloSafe: track.soloSafe ?? false,
        automationMode: track.automationMode ?? 'read'
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
