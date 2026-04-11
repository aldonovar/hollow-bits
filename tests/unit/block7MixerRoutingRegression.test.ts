import { beforeEach, describe, expect, it } from 'vitest';
import { audioEngine } from '../../services/audioEngine';
import { normalizeTrackParam, sampleAutomationLaneAtBar, writeAutomationPoint } from '../../services/automationService';
import { buildMixerAuditSnapshot } from '../../services/mixerAuditService';
import { repairProjectData } from '../../services/projectIntegrityService';
import { ProjectData, Track, TrackType, TransportState } from '../../types';

const transportFixture: TransportState = {
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
};

const buildTrack = (overrides: Partial<Track>): Track => ({
  id: overrides.id || 'track-1',
  name: overrides.name || 'Track 1',
  type: overrides.type || TrackType.AUDIO,
  color: overrides.color || '#ff00aa',
  volume: overrides.volume ?? 0,
  pan: overrides.pan ?? 0,
  reverb: overrides.reverb ?? 0.25,
  transpose: overrides.transpose ?? 0,
  monitor: overrides.monitor || 'auto',
  isMuted: overrides.isMuted ?? false,
  isSoloed: overrides.isSoloed ?? false,
  isArmed: overrides.isArmed ?? false,
  sends: overrides.sends || {},
  sendModes: overrides.sendModes || {},
  groupId: overrides.groupId,
  vcaGroupId: overrides.vcaGroupId,
  soloSafe: overrides.soloSafe ?? false,
  automationMode: overrides.automationMode || 'read',
  clips: overrides.clips || [],
  sessionClips: overrides.sessionClips || [],
  devices: overrides.devices || [],
  automationLanes: overrides.automationLanes
});

describe('block 7 mixer/routing/automation regression', () => {
  beforeEach(() => {
    audioEngine.clearCueMonitor();
  });

  it('keeps cue monitor as a single explicit contract', () => {
    audioEngine.setCueMonitor('track-a', 'pfl');
    expect(audioEngine.getCueMonitor()).toEqual({ trackId: 'track-a', mode: 'pfl' });

    audioEngine.setCueMonitor('track-b', 'afl');
    expect(audioEngine.getCueMonitor()).toEqual({ trackId: 'track-b', mode: 'afl' });

    audioEngine.clearCueMonitor();
    expect(audioEngine.getCueMonitor()).toEqual({ trackId: null, mode: null });
  });

  it('repairs routing cycles and invalid automation/routing references on project open', () => {
    const corruptedProject: ProjectData = {
      version: '3.0-reference',
      name: 'Block 7',
      tracks: [
        buildTrack({
          id: 'audio-1',
          name: 'Lead',
          groupId: 'group-a',
          vcaGroupId: 'ghost-vca',
          sends: { 'return-a': 0.35, ghost: 0.5 },
          sendModes: { 'return-a': 'pre', ghost: 'post' },
          automationMode: 'touch',
          automationLanes: [{
            id: 'lane-vol',
            param: 'volume',
            paramName: 'Volume',
            color: '#22d3ee',
            isExpanded: false,
            points: [{ id: 'pt-1', time: 1, value: 0.5, curveType: 'linear' }],
            minValue: 0,
            maxValue: 1
          }]
        }),
        buildTrack({
          id: 'group-a',
          name: 'Bus A',
          type: TrackType.GROUP,
          groupId: 'group-b'
        }),
        buildTrack({
          id: 'group-b',
          name: 'Bus B',
          type: TrackType.GROUP,
          groupId: 'audio-1'
        }),
        buildTrack({
          id: 'return-a',
          name: 'Return A',
          type: TrackType.RETURN,
          automationMode: 'off'
        })
      ],
      transport: transportFixture,
      audioSettings: {
        sampleRate: 48000,
        bufferSize: 'auto',
        latencyHint: 'interactive'
      },
      createdAt: 10,
      lastModified: 20
    };

    const result = repairProjectData(corruptedProject, { source: 'block7-routing' });
    const repairedTrack = result.project.tracks.find((track) => track.id === 'audio-1');
    const repairedGroupA = result.project.tracks.find((track) => track.id === 'group-a');
    const repairedGroupB = result.project.tracks.find((track) => track.id === 'group-b');

    expect(repairedTrack?.sends).toEqual({ 'return-a': 0.35 });
    expect(repairedTrack?.sendModes).toEqual({ 'return-a': 'pre' });
    expect(repairedTrack?.vcaGroupId).toBeUndefined();
    expect(repairedTrack?.automationMode).toBe('touch');
    expect(repairedTrack?.automationLanes?.[0]?.points).toHaveLength(1);
    expect(repairedGroupA?.groupId).toBeUndefined();
    expect(repairedGroupB?.groupId).toBeUndefined();
    expect(result.report.issues.some((issue) => issue.code === 'routing.group-cycle')).toBe(true);
  });

  it('keeps mixer automation and audit summary aligned for 1.0 behavior', () => {
    const track = buildTrack({
      id: 'vox',
      name: 'Lead Vox',
      groupId: 'group-a',
      vcaGroupId: 'group-a',
      soloSafe: true,
      sends: { 'return-a': 0.5 },
      sendModes: { 'return-a': 'post' },
      automationMode: 'latch',
      automationLanes: [{
        id: 'lane-vol',
        param: 'volume',
        paramName: 'Volume',
        color: '#22d3ee',
        isExpanded: false,
        points: [
          { id: 'pt-1', time: 1, value: 0.25, curveType: 'linear' },
          { id: 'pt-2', time: 3, value: 0.75, curveType: 'linear' }
        ],
        minValue: 0,
        maxValue: 1
      }]
    });
    const groupTrack = buildTrack({ id: 'group-a', name: 'Bus', type: TrackType.GROUP, automationMode: 'read' });
    const returnTrack = buildTrack({ id: 'return-a', name: 'Verb', type: TrackType.RETURN, automationMode: 'off' });

    const writtenTrack = writeAutomationPoint(track, 'volume', 4, normalizeTrackParam(track, 'volume'));
    const lane = writtenTrack.automationLanes?.[0];
    expect(lane?.points.at(-1)?.time).toBe(4);
    expect(sampleAutomationLaneAtBar(lane, 2)).toBeCloseTo(0.5, 6);

    const audit = buildMixerAuditSnapshot([writtenTrack, groupTrack, returnTrack], { trackId: 'vox', mode: 'afl' });
    expect(audit.groupTrackCount).toBe(1);
    expect(audit.returnTrackCount).toBe(1);
    expect(audit.activeSendRouteCount).toBe(1);
    expect(audit.postFaderSendCount).toBe(1);
    expect(audit.vcaAssignedTrackCount).toBe(1);
    expect(audit.soloSafeTrackCount).toBe(1);
    expect(audit.automationModeCounts.latch).toBe(1);
    expect(audit.automationWriteReadyTrackCount).toBe(1);
    expect(audit.cueLabel).toBe('AFL Lead Vox');
  });
});
