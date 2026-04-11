import { describe, expect, it } from 'vitest';
import {
  denormalizeTrackParam,
  getLaneByParam,
  normalizeTrackParam,
  sampleAutomationLaneAtBar,
  writeAutomationPoint
} from '../../services/automationService';
import { AutomationLane, Track, TrackType } from '../../types';

const buildTrack = (overrides: Partial<Track> = {}): Track => ({
  id: overrides.id || 'track-1',
  name: overrides.name || 'Track 1',
  type: overrides.type || TrackType.AUDIO,
  color: overrides.color || '#ff00aa',
  volume: overrides.volume ?? -6,
  pan: overrides.pan ?? 0,
  reverb: overrides.reverb ?? 0.25,
  transpose: overrides.transpose ?? 0,
  monitor: overrides.monitor || 'auto',
  isMuted: overrides.isMuted ?? false,
  isSoloed: overrides.isSoloed ?? false,
  isArmed: overrides.isArmed ?? false,
  sends: overrides.sends || {},
  sendModes: overrides.sendModes || {},
  soloSafe: overrides.soloSafe ?? false,
  automationMode: overrides.automationMode || 'read',
  clips: overrides.clips || [],
  sessionClips: overrides.sessionClips || [],
  devices: overrides.devices || [],
  automationLanes: overrides.automationLanes
});

const buildLane = (overrides: Partial<AutomationLane> = {}): AutomationLane => ({
  id: overrides.id || 'lane-1',
  param: overrides.param || 'volume',
  paramName: overrides.paramName || 'Volume',
  color: overrides.color || '#22d3ee',
  isExpanded: overrides.isExpanded ?? false,
  minValue: overrides.minValue,
  maxValue: overrides.maxValue,
  points: overrides.points || []
});

describe('automationService', () => {
  it('normalizes and denormalizes supported mixer params', () => {
    const track = buildTrack({ volume: -6, pan: -25, reverb: 30 });

    const volumeNormalized = normalizeTrackParam(track, 'volume');
    const panNormalized = normalizeTrackParam(track, 'pan');
    const reverbNormalized = normalizeTrackParam(track, 'reverb');

    expect(volumeNormalized).toBeCloseTo((track.volume + 60) / 66, 6);
    expect(panNormalized).toBeCloseTo(0.25, 6);
    expect(reverbNormalized).toBeCloseTo(0.3, 6);

    expect(denormalizeTrackParam(track, 'volume', volumeNormalized)).toBeCloseTo(track.volume, 6);
    expect(denormalizeTrackParam(track, 'pan', panNormalized)).toBeCloseTo(track.pan, 6);
    expect(denormalizeTrackParam(track, 'reverb', reverbNormalized)).toBeCloseTo(track.reverb, 6);
  });

  it('samples lanes with linear and hold curves correctly', () => {
    const linearLane = buildLane({
      points: [
        { id: 'pt-1', time: 1, value: 0.2, curveType: 'linear' },
        { id: 'pt-2', time: 3, value: 0.8, curveType: 'linear' }
      ]
    });
    const holdLane = buildLane({
      points: [
        { id: 'pt-h1', time: 2, value: 0.6, curveType: 'hold' },
        { id: 'pt-h2', time: 4, value: 0.1, curveType: 'linear' }
      ]
    });

    expect(sampleAutomationLaneAtBar(linearLane, 2)).toBeCloseTo(0.5, 6);
    expect(sampleAutomationLaneAtBar(holdLane, 3)).toBeCloseTo(0.6, 6);
    expect(sampleAutomationLaneAtBar(undefined, 3)).toBeNull();
  });

  it('writes automation points without duplicating near-identical samples', () => {
    const track = buildTrack({
      automationLanes: [
        buildLane({
          id: 'lane-vol',
          param: 'volume',
          points: [{ id: 'pt-1', time: 1, value: 0.4, curveType: 'linear' }]
        })
      ]
    });

    const firstWrite = writeAutomationPoint(track, 'volume', 1.02, 0.41);
    const updatedLane = getLaneByParam(firstWrite, 'volume');
    expect(updatedLane?.points).toHaveLength(1);
    expect(updatedLane?.points[0].value).toBeCloseTo(0.41, 6);

    const secondWrite = writeAutomationPoint(firstWrite, 'volume', 2.5, 0.8);
    const appendedLane = getLaneByParam(secondWrite, 'volume');
    expect(appendedLane?.points).toHaveLength(2);
    expect(appendedLane?.points[1].time).toBeCloseTo(2.5, 6);
  });
});
