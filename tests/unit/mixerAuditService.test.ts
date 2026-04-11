import { describe, expect, it } from 'vitest';
import { buildMixerAuditSnapshot, summarizeMixerAuditSnapshot } from '../../services/mixerAuditService';
import { Track, TrackType } from '../../types';

const buildTrack = (overrides: Partial<Track>): Track => ({
  id: overrides.id || 'track-1',
  name: overrides.name || 'Track 1',
  type: overrides.type || TrackType.AUDIO,
  color: overrides.color || '#ff00aa',
  volume: overrides.volume ?? 0,
  pan: overrides.pan ?? 0,
  reverb: overrides.reverb ?? 0,
  transpose: overrides.transpose ?? 0,
  monitor: overrides.monitor || 'auto',
  isMuted: overrides.isMuted ?? false,
  isSoloed: overrides.isSoloed ?? false,
  isArmed: overrides.isArmed ?? false,
  inputDeviceId: overrides.inputDeviceId,
  micSettings: overrides.micSettings,
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

describe('mixerAuditService', () => {
  it('summarizes routing, sends, automation and cue state from tracks', () => {
    const tracks: Track[] = [
      buildTrack({
        id: 'vox',
        name: 'Lead Vox',
        type: TrackType.AUDIO,
        groupId: 'group-a',
        vcaGroupId: 'group-a',
        soloSafe: true,
        sends: { 'return-a': 0.5, 'return-b': 0.3 },
        sendModes: { 'return-a': 'pre', 'return-b': 'post' },
        automationMode: 'write',
        automationLanes: [{
          id: 'lane-vol',
          param: 'volume',
          paramName: 'Volume',
          color: '#22d3ee',
          isExpanded: false,
          points: [{ id: 'pt-1', time: 1, value: 0.7, curveType: 'linear' }],
          minValue: 0,
          maxValue: 1
        }]
      }),
      buildTrack({
        id: 'midi-1',
        name: 'Pad',
        type: TrackType.MIDI,
        automationMode: 'touch'
      }),
      buildTrack({
        id: 'group-a',
        name: 'Drum Bus',
        type: TrackType.GROUP,
        automationMode: 'read'
      }),
      buildTrack({
        id: 'return-a',
        name: 'Return A',
        type: TrackType.RETURN,
        automationMode: 'off'
      }),
      buildTrack({
        id: 'return-b',
        name: 'Return B',
        type: TrackType.RETURN,
        automationMode: 'off'
      })
    ];

    const snapshot = buildMixerAuditSnapshot(tracks, { trackId: 'vox', mode: 'pfl' });

    expect(snapshot.trackCount).toBe(5);
    expect(snapshot.audioTrackCount).toBe(1);
    expect(snapshot.midiTrackCount).toBe(1);
    expect(snapshot.groupTrackCount).toBe(1);
    expect(snapshot.returnTrackCount).toBe(2);
    expect(snapshot.routedTrackCount).toBe(1);
    expect(snapshot.vcaAssignedTrackCount).toBe(1);
    expect(snapshot.soloSafeTrackCount).toBe(1);
    expect(snapshot.activeSendRouteCount).toBe(2);
    expect(snapshot.preFaderSendCount).toBe(1);
    expect(snapshot.postFaderSendCount).toBe(1);
    expect(snapshot.automatedTrackCount).toBe(1);
    expect(snapshot.automationLaneCount).toBe(1);
    expect(snapshot.automationWriteReadyTrackCount).toBe(2);
    expect(snapshot.automationModeCounts.write).toBe(1);
    expect(snapshot.automationModeCounts.touch).toBe(1);
    expect(snapshot.cueLabel).toBe('PFL Lead Vox');

    const summary = summarizeMixerAuditSnapshot(snapshot);
    expect(summary).toContain('Tracks 5');
    expect(summary).toContain('Sends 2 (1 pre / 1 post)');
    expect(summary).toContain('PFL Lead Vox');
  });
});
