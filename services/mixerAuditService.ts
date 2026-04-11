import { AutomationMode, Track, TrackType } from '../types';

export interface MixerCueSnapshot {
  trackId: string | null;
  mode: 'pfl' | 'afl' | null;
}

export interface MixerAuditSnapshot {
  trackCount: number;
  audioTrackCount: number;
  midiTrackCount: number;
  groupTrackCount: number;
  returnTrackCount: number;
  routedTrackCount: number;
  vcaAssignedTrackCount: number;
  soloSafeTrackCount: number;
  activeSendRouteCount: number;
  preFaderSendCount: number;
  postFaderSendCount: number;
  automatedTrackCount: number;
  automationLaneCount: number;
  automationWriteReadyTrackCount: number;
  automationModeCounts: Record<AutomationMode, number>;
  cueTrackId: string | null;
  cueMode: 'pfl' | 'afl' | null;
  cueLabel: string;
}

const createAutomationModeCounts = (): Record<AutomationMode, number> => ({
  off: 0,
  read: 0,
  touch: 0,
  latch: 0,
  write: 0
});

export const buildMixerAuditSnapshot = (
  tracks: Track[],
  cue: MixerCueSnapshot | null = null
): MixerAuditSnapshot => {
  const automationModeCounts = createAutomationModeCounts();
  const trackById = new Map(tracks.map((track) => [track.id, track]));

  let audioTrackCount = 0;
  let midiTrackCount = 0;
  let groupTrackCount = 0;
  let returnTrackCount = 0;
  let routedTrackCount = 0;
  let vcaAssignedTrackCount = 0;
  let soloSafeTrackCount = 0;
  let activeSendRouteCount = 0;
  let preFaderSendCount = 0;
  let postFaderSendCount = 0;
  let automatedTrackCount = 0;
  let automationLaneCount = 0;
  let automationWriteReadyTrackCount = 0;

  tracks.forEach((track) => {
    if (track.type === TrackType.AUDIO) audioTrackCount += 1;
    if (track.type === TrackType.MIDI) midiTrackCount += 1;
    if (track.type === TrackType.GROUP) groupTrackCount += 1;
    if (track.type === TrackType.RETURN) returnTrackCount += 1;
    if (track.groupId) routedTrackCount += 1;
    if (track.vcaGroupId) vcaAssignedTrackCount += 1;
    if (track.soloSafe) soloSafeTrackCount += 1;

    const automationMode: AutomationMode = track.automationMode ?? 'read';
    automationModeCounts[automationMode] += 1;
    if (automationMode === 'touch' || automationMode === 'latch' || automationMode === 'write') {
      automationWriteReadyTrackCount += 1;
    }

    const lanes = track.automationLanes ?? [];
    automationLaneCount += lanes.length;
    if (lanes.some((lane) => lane.points.length > 0)) {
      automatedTrackCount += 1;
    }

    Object.entries(track.sends ?? {}).forEach(([targetId, value]) => {
      if (!Number.isFinite(value)) return;
      const numericValue = Number(value);
      if (numericValue <= 0.0001) return;
      activeSendRouteCount += 1;
      if (track.sendModes?.[targetId] === 'pre') {
        preFaderSendCount += 1;
      } else {
        postFaderSendCount += 1;
      }
    });
  });

  const cueTrackId = cue?.trackId ?? null;
  const cueMode = cue?.mode ?? null;
  const cueTrackName = cueTrackId ? trackById.get(cueTrackId)?.name ?? cueTrackId : null;
  const cueLabel = cueMode && cueTrackName
    ? `${cueMode.toUpperCase()} ${cueTrackName}`
    : 'Cue idle';

  return {
    trackCount: tracks.length,
    audioTrackCount,
    midiTrackCount,
    groupTrackCount,
    returnTrackCount,
    routedTrackCount,
    vcaAssignedTrackCount,
    soloSafeTrackCount,
    activeSendRouteCount,
    preFaderSendCount,
    postFaderSendCount,
    automatedTrackCount,
    automationLaneCount,
    automationWriteReadyTrackCount,
    automationModeCounts,
    cueTrackId,
    cueMode,
    cueLabel
  };
};

export const summarizeMixerAuditSnapshot = (snapshot: MixerAuditSnapshot): string => {
  return [
    `Tracks ${snapshot.trackCount}`,
    `Groups ${snapshot.groupTrackCount}`,
    `Returns ${snapshot.returnTrackCount}`,
    `Sends ${snapshot.activeSendRouteCount} (${snapshot.preFaderSendCount} pre / ${snapshot.postFaderSendCount} post)`,
    `Automation ${snapshot.automatedTrackCount} tracks / ${snapshot.automationLaneCount} lanes`,
    `Write-ready ${snapshot.automationWriteReadyTrackCount}`,
    snapshot.cueLabel
  ].join(' · ');
};
