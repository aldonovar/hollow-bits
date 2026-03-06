import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers3, Plus, RotateCcw, X } from 'lucide-react';
import { MicInputChannelMode, Track, TrackType } from '../types';
import Knob from './Knob';
import { audioEngine } from '../services/audioEngine';

interface MixerProps {
  tracks: Track[];
  onUpdate: (id: string, updates: Partial<Track>) => void;
  onDelete: (id: string) => void;
  onCreateGroup?: () => void;
  onMacroApply?: (macroId: 'vocal-up' | 'drum-glue' | 'mono-check' | 'headroom-safe') => void;
  onStoreSnapshot?: (slot: 'A' | 'B') => void;
  onRecallSnapshot?: (slot: 'A' | 'B') => void;
  onToggleSnapshotCompare?: () => void;
  canRecallSnapshotA?: boolean;
  canRecallSnapshotB?: boolean;
  activeSnapshot?: 'A' | 'B' | null;
}

interface MeterSnapshot {
  rmsDb: number;
  peakDb: number;
}

const FADER_MIN_DB = -60;
const FADER_MAX_DB = 6;
const SEND_MIN_DB = -60;
const SEND_MAX_DB = 6;
const METER_MIN_DB = -72;
const METER_MAX_DB = 6;
const METER_UPDATE_EPSILON_DB = 0.2;

const monitorModes: Track['monitor'][] = ['in', 'auto', 'off'];
const monitorInputModes: MicInputChannelMode[] = ['mono', 'stereo', 'left', 'right'];


const ensureMicSettings = (track: Track): NonNullable<Track['micSettings']> => ({
  profile: track.micSettings?.profile || 'studio-voice',
  inputGain: track.micSettings?.inputGain ?? 1,
  monitoringEnabled: track.micSettings?.monitoringEnabled ?? false,
  monitoringReverb: track.micSettings?.monitoringReverb ?? false,
  monitoringEcho: track.micSettings?.monitoringEcho ?? false,
  monitorInputMode: track.micSettings?.monitorInputMode || 'mono',
  monitorLatencyCompensationMs: track.micSettings?.monitorLatencyCompensationMs ?? 0
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const dbToMeterRatio = (db: number): number => {
  const normalized = (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB);
  return Math.pow(clamp(normalized, 0, 1), 1.15);
};

const formatDb = (db: number): string => {
  if (db <= FADER_MIN_DB + 0.01) return '-inf';
  return `${db.toFixed(1)} dB`;
};

const normalizeReverbUiValue = (reverb: number): number => {
  if (!Number.isFinite(reverb)) return 0;
  return reverb <= 1 ? reverb * 100 : reverb;
};

const normalizeStoredSendDb = (sendLevel: number | undefined): number => {
  if (!Number.isFinite(sendLevel)) return SEND_MIN_DB;
  const value = Number(sendLevel);

  if (value >= 0 && value <= 1) {
    if (value <= 0.0001) return SEND_MIN_DB;
    return clamp(20 * Math.log10(value), SEND_MIN_DB, SEND_MAX_DB);
  }

  return clamp(value, SEND_MIN_DB, SEND_MAX_DB);
};

const getTrackKindLabel = (trackType: TrackType): string => {
  if (trackType === TrackType.RETURN) return 'RETURN';
  if (trackType === TrackType.GROUP) return 'GROUP';
  if (trackType === TrackType.MIDI) return 'MIDI';
  return 'AUDIO';
};

const getFaderPosition = (dbValue: number): number => {
  return ((clamp(dbValue, FADER_MIN_DB, FADER_MAX_DB) - FADER_MIN_DB) / (FADER_MAX_DB - FADER_MIN_DB)) * 100;
};

const isMeterSnapshotDifferent = (prev: MeterSnapshot, next: MeterSnapshot): boolean => {
  return (
    Math.abs(prev.rmsDb - next.rmsDb) > METER_UPDATE_EPSILON_DB
    || Math.abs(prev.peakDb - next.peakDb) > METER_UPDATE_EPSILON_DB
  );
};

const areTrackMetersDifferent = (
  prev: Record<string, MeterSnapshot>,
  next: Record<string, MeterSnapshot>
): boolean => {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;

  for (const key of nextKeys) {
    const prevMeter = prev[key];
    const nextMeter = next[key];
    if (!prevMeter || !nextMeter || isMeterSnapshotDifferent(prevMeter, nextMeter)) {
      return true;
    }
  }

  return false;
};

const areClipHoldsDifferent = (
  prev: Record<string, boolean>,
  next: Record<string, boolean>
): boolean => {
  const prevKeys = Object.keys(prev);
  const nextKeys = Object.keys(next);
  if (prevKeys.length !== nextKeys.length) return true;

  for (const key of nextKeys) {
    if (prev[key] !== next[key]) return true;
  }

  return false;
};

const MeterColumn: React.FC<{ meter: MeterSnapshot; isClipHold: boolean; widthClass?: string; onReset: () => void }> = ({
  meter,
  isClipHold,
  widthClass = 'w-3',
  onReset
}) => {
  const rmsHeight = `${dbToMeterRatio(meter.rmsDb) * 100}%`;
  const peakBottom = `${dbToMeterRatio(meter.peakDb) * 100}%`;

  return (
    <div className={`${widthClass} relative rounded-[2px] border border-[#1d2433] overflow-hidden bg-[#03040a]`}>
      <button
        onClick={onReset}
        className={`absolute top-[2px] right-[2px] z-20 w-2 h-2 rounded-full border ${isClipHold ? 'bg-red-400 border-red-300 shadow-[0_0_6px_rgba(248,113,113,0.8)]' : 'bg-[#2a344a] border-[#3b4864]'}`}
        title="Reset peak/clip hold"
      ></button>
      <div className="absolute inset-[1px] bg-[linear-gradient(180deg,#0b0f19_0%,#06080f_60%,#03040a_100%)]"></div>
      <div
        className="absolute inset-x-[2px] bottom-[2px] rounded-[1px] bg-[linear-gradient(180deg,#ef4444_0%,#f59e0b_20%,#22c55e_55%,#14b8a6_100%)]"
        style={{ height: rmsHeight }}
      ></div>
      <div className="absolute inset-x-[2px] h-[2px] bg-white/90" style={{ bottom: peakBottom }}></div>
    </div>
  );
};

const Mixer: React.FC<MixerProps> = ({
  tracks,
  onUpdate,
  onDelete,
  onCreateGroup,
  onMacroApply,
  onStoreSnapshot,
  onRecallSnapshot,
  onToggleSnapshotCompare,
  canRecallSnapshotA = false,
  canRecallSnapshotB = false,
  activeSnapshot = null
}) => {
  const [trackMeters, setTrackMeters] = useState<Record<string, MeterSnapshot>>({});
  const [trackClipHolds, setTrackClipHolds] = useState<Record<string, boolean>>({});
  const [masterMeter, setMasterMeter] = useState<MeterSnapshot>({ rmsDb: -72, peakDb: -72 });
  const [masterClipHold, setMasterClipHold] = useState<boolean>(false);
  const [masterVolumeDb, setMasterVolumeDb] = useState<number>(() => audioEngine.getMasterVolumeDb());
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  const [cueState, setCueState] = useState<{ trackId: string; mode: 'pfl' | 'afl' } | null>(() => {
    const currentCue = audioEngine.getCueMonitor();
    if (!currentCue.trackId || !currentCue.mode) return null;
    return { trackId: currentCue.trackId, mode: currentCue.mode };
  });

  const returnTracks = useMemo(() => tracks.filter((track) => track.type === TrackType.RETURN), [tracks]);
  const groupTracks = useMemo(() => tracks.filter((track) => track.type === TrackType.GROUP), [tracks]);
  const focusedTrack = useMemo(
    () => (focusedTrackId ? tracks.find((track) => track.id === focusedTrackId) || null : null),
    [focusedTrackId, tracks]
  );
  const orderedTracks = useMemo(() => {
    const standardTracks = tracks.filter((track) => track.type !== TrackType.RETURN && track.type !== TrackType.GROUP);
    return [...standardTracks, ...groupTracks, ...returnTracks];
  }, [tracks, groupTracks, returnTracks]);
  const trackIds = useMemo(() => tracks.map((track) => track.id), [tracks]);

  useEffect(() => {
    if (!focusedTrackId && orderedTracks.length > 0) {
      setFocusedTrackId(orderedTracks[0].id);
      return;
    }

    if (focusedTrackId && !tracks.some((track) => track.id === focusedTrackId)) {
      setFocusedTrackId(orderedTracks[0]?.id || null);
    }
  }, [focusedTrackId, orderedTracks, tracks]);

  useEffect(() => {
    let rafId = 0;
    let lastFrame = 0;

        const animate = (time: number) => {
          if (time - lastFrame >= 33) {
            lastFrame = time;

            const snapshot = audioEngine.getMeterSnapshot(trackIds);

            setTrackMeters((prev) => (areTrackMetersDifferent(prev, snapshot.tracks) ? snapshot.tracks : prev));
            setTrackClipHolds((prev) => (areClipHoldsDifferent(prev, snapshot.clipHolds) ? snapshot.clipHolds : prev));
            setMasterMeter((prev) => (isMeterSnapshotDifferent(prev, snapshot.master) ? snapshot.master : prev));
            setMasterClipHold((prev) => (prev !== snapshot.masterClipHold ? snapshot.masterClipHold : prev));
          }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafId);
  }, [trackIds]);

  useEffect(() => {
    setMasterVolumeDb(audioEngine.getMasterVolumeDb());
  }, []);

  useEffect(() => {
    if (!cueState) {
      audioEngine.clearCueMonitor();
      return;
    }

    audioEngine.setCueMonitor(cueState.trackId, cueState.mode);
  }, [cueState]);

  useEffect(() => {
    if (!cueState) return;
    const cueTrackStillExists = tracks.some((track) => track.id === cueState.trackId);
    if (!cueTrackStillExists) {
      setCueState(null);
    }
  }, [cueState, tracks]);

  useEffect(() => {
    return () => {
      audioEngine.clearCueMonitor();
    };
  }, []);

  const handleTrackFaderDragStart = useCallback((event: React.MouseEvent, track: Track) => {
    event.preventDefault();

    const startY = event.clientY;
    const startVolume = track.volume;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const sensitivity = moveEvent.shiftKey ? 0.1 : 0.35;
      const nextVolume = clamp(startVolume + (delta * sensitivity), FADER_MIN_DB, FADER_MAX_DB);
      onUpdate(track.id, { volume: nextVolume });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [onUpdate]);

  const handleMasterFaderDragStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();

    const startY = event.clientY;
    const startVolume = masterVolumeDb;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const sensitivity = moveEvent.shiftKey ? 0.1 : 0.35;
      const nextVolume = clamp(startVolume + (delta * sensitivity), FADER_MIN_DB, FADER_MAX_DB);
      setMasterVolumeDb(nextVolume);
      audioEngine.setMasterVolumeDb(nextVolume);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [masterVolumeDb]);

  const resetMasterFader = useCallback(() => {
    setMasterVolumeDb(0);
    audioEngine.setMasterVolumeDb(0);
  }, []);

  const resetTrackMeter = useCallback((trackId: string) => {
    audioEngine.resetTrackMeter(trackId);
    setTrackClipHolds((prev) => ({ ...prev, [trackId]: false }));
  }, []);

  const resetMasterMeter = useCallback(() => {
    audioEngine.resetMasterMeter();
    setMasterClipHold(false);
  }, []);

  const resetAllMeters = useCallback(() => {
    audioEngine.resetAllMeters();
    setTrackClipHolds({});
    setMasterClipHold(false);
  }, []);

  const toggleCueMode = useCallback((trackId: string, mode: 'pfl' | 'afl') => {
    setCueState((prev) => {
      if (prev?.trackId === trackId && prev.mode === mode) {
        return null;
      }
      return { trackId, mode };
    });
  }, []);

  return (
    <div className="h-full w-full bg-[#06080f] flex flex-col overflow-hidden">
      <div className="h-9 shrink-0 px-3 border-b border-[#1b2233] bg-[#0d1220] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-[10px] uppercase tracking-[0.16em] text-gray-400 font-bold">Pro Mixer</div>
          {onCreateGroup && (
            <button
              onClick={onCreateGroup}
              className="h-6 px-2 rounded-sm border border-daw-violet/30 bg-daw-violet/10 hover:bg-daw-violet/20 text-daw-violet text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"
            >
              <Plus size={10} /> Group Bus
            </button>
          )}
          <div className="ml-1 flex items-center gap-1">
            {onStoreSnapshot && (
              <button
                onClick={() => onStoreSnapshot('A')}
                className="h-6 px-1.5 rounded-sm border border-cyan-400/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 text-[8px] font-bold uppercase tracking-wider"
                title="Guardar snapshot A"
              >
                Store A
              </button>
            )}
            {onRecallSnapshot && (
              <button
                onClick={() => onRecallSnapshot('A')}
                disabled={!canRecallSnapshotA}
                className={`h-6 px-1.5 rounded-sm border text-[8px] font-bold uppercase tracking-wider ${activeSnapshot === 'A' ? 'border-cyan-300 bg-cyan-400/25 text-white' : canRecallSnapshotA ? 'border-cyan-400/35 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200' : 'border-[#2b3448] bg-[#171e2d] text-gray-600 cursor-not-allowed'}`}
                title="Recuperar snapshot A"
              >
                A
              </button>
            )}
            {onStoreSnapshot && (
              <button
                onClick={() => onStoreSnapshot('B')}
                className="h-6 px-1.5 rounded-sm border border-violet-400/35 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200 text-[8px] font-bold uppercase tracking-wider"
                title="Guardar snapshot B"
              >
                Store B
              </button>
            )}
            {onRecallSnapshot && (
              <button
                onClick={() => onRecallSnapshot('B')}
                disabled={!canRecallSnapshotB}
                className={`h-6 px-1.5 rounded-sm border text-[8px] font-bold uppercase tracking-wider ${activeSnapshot === 'B' ? 'border-violet-300 bg-violet-400/25 text-white' : canRecallSnapshotB ? 'border-violet-400/35 bg-violet-500/10 hover:bg-violet-500/20 text-violet-200' : 'border-[#2b3448] bg-[#171e2d] text-gray-600 cursor-not-allowed'}`}
                title="Recuperar snapshot B"
              >
                B
              </button>
            )}
            {onToggleSnapshotCompare && (
              <button
                onClick={onToggleSnapshotCompare}
                disabled={!canRecallSnapshotA && !canRecallSnapshotB}
                className="h-6 px-1.5 rounded-sm border border-white/20 bg-white/[0.04] hover:bg-white/[0.1] disabled:border-[#2b3448] disabled:bg-[#171e2d] disabled:text-gray-600 text-[8px] font-bold uppercase tracking-wider text-gray-200"
                title="Comparar snapshots A/B"
              >
                A/B
              </button>
            )}
            {onMacroApply && (
              <>
                <button
                  onClick={() => onMacroApply('vocal-up')}
                  className="h-6 px-1.5 rounded-sm border border-emerald-400/35 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 text-[8px] font-bold uppercase tracking-wider"
                  title="Vocal Up"
                >
                  Vocal+
                </button>
                <button
                  onClick={() => onMacroApply('drum-glue')}
                  className="h-6 px-1.5 rounded-sm border border-amber-400/35 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 text-[8px] font-bold uppercase tracking-wider"
                  title="Drum Glue"
                >
                  Drums
                </button>
                <button
                  onClick={() => onMacroApply('mono-check')}
                  className="h-6 px-1.5 rounded-sm border border-sky-400/35 bg-sky-500/10 hover:bg-sky-500/20 text-sky-200 text-[8px] font-bold uppercase tracking-wider"
                  title="Mono Check"
                >
                  Mono
                </button>
                <button
                  onClick={() => onMacroApply('headroom-safe')}
                  className="h-6 px-1.5 rounded-sm border border-rose-400/35 bg-rose-500/10 hover:bg-rose-500/20 text-rose-200 text-[8px] font-bold uppercase tracking-wider"
                  title="Headroom Safe"
                >
                  Safe
                </button>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cueState && (
            <div className="h-6 px-2 rounded-sm border border-amber-400/40 bg-amber-500/10 text-[8px] font-bold uppercase tracking-wider text-amber-200 flex items-center gap-1">
              Cue {cueState.mode.toUpperCase()}
            </div>
          )}
          <button
            onClick={resetAllMeters}
            className="h-6 px-2 rounded-sm border border-white/15 bg-white/[0.04] hover:bg-white/[0.08] text-[9px] font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1"
            title="Reset global de peak/clip hold"
          >
            <RotateCcw size={10} /> Reset Meters
          </button>
        </div>
      </div>

      {focusedTrack && (
        <div className="h-11 shrink-0 px-3 border-b border-[#1b2233] bg-[#0b111d] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: focusedTrack.color }}></div>
            <div className="text-[10px] font-bold text-white uppercase tracking-wider truncate max-w-[180px]">{focusedTrack.name}</div>
            <div className="text-[8px] text-gray-500 uppercase tracking-[0.14em]">Inspector</div>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-[8px] text-gray-500 uppercase">Vol</div>
            <input
              type="range"
              min={FADER_MIN_DB}
              max={FADER_MAX_DB}
              step={0.1}
              value={focusedTrack.volume}
              onChange={(event) => onUpdate(focusedTrack.id, { volume: Number(event.target.value) })}
              className="w-24 accent-cyan-300"
            />
            <div className="text-[8px] text-cyan-200 font-mono w-12 text-right">{formatDb(focusedTrack.volume)}</div>

            <div className="text-[8px] text-gray-500 uppercase ml-2">Mode</div>
            <select
              value={focusedTrack.automationMode || 'read'}
              onChange={(event) => onUpdate(focusedTrack.id, { automationMode: event.target.value as Track['automationMode'] })}
              className="h-6 bg-[#0f1728] border border-[#26324a] rounded-[2px] text-[9px] text-gray-200"
            >
              <option value="off">Off</option>
              <option value="read">Read</option>
              <option value="touch">Touch</option>
              <option value="latch">Latch</option>
              <option value="write">Write</option>
            </select>
          </div>
        </div>
      )}

      <div className="flex-1 w-full bg-[#06080f] flex overflow-x-auto p-4 gap-2 items-stretch">
        {orderedTracks.map((track, index) => {
          const meter = trackMeters[track.id] || { rmsDb: -72, peakDb: -72 };
          const isClipHold = trackClipHolds[track.id] || false;
          const faderBottom = `${getFaderPosition(track.volume)}%`;
          const canRouteToGroup = track.type !== TrackType.RETURN && track.type !== TrackType.GROUP;
          const canUseVca = track.type !== TrackType.RETURN && track.type !== TrackType.GROUP;
          const canArm = track.type === TrackType.AUDIO || track.type === TrackType.MIDI;
          const routeValue = track.groupId && groupTracks.some((group) => group.id === track.groupId) ? track.groupId : 'master';
          const vcaValue = track.vcaGroupId && groupTracks.some((group) => group.id === track.vcaGroupId) ? track.vcaGroupId : 'none';
          const isCuePfl = cueState?.trackId === track.id && cueState.mode === 'pfl';
          const isCueAfl = cueState?.trackId === track.id && cueState.mode === 'afl';
          const isFocused = focusedTrackId === track.id;
          const micSettings = ensureMicSettings(track);

          return (
            <div
              key={track.id}
              onClick={() => setFocusedTrackId(track.id)}
              className={`w-[118px] min-h-full bg-[#0a0e16] border rounded-sm flex flex-col shrink-0 overflow-hidden ${isFocused ? 'border-cyan-300/50 ring-1 ring-cyan-300/25' : 'border-[#1b2233]'}`}
            >
              <div className="px-2 py-1.5 bg-[#131a29] border-b border-[#1b2233]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[8px] font-mono uppercase tracking-wider text-gray-500">CH {index + 1}</span>
                  <button
                    onClick={() => onDelete(track.id)}
                    className="w-4 h-4 rounded-sm text-gray-600 hover:text-red-300 hover:bg-red-500/10 transition-colors flex items-center justify-center"
                    title="Eliminar pista"
                  >
                    <X size={10} />
                  </button>
                </div>

                <div className="text-[10px] font-bold text-white truncate uppercase tracking-tight">{track.name}</div>
                <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mt-0.5">{getTrackKindLabel(track.type)}</div>
                <div className="h-[2px] w-full mt-2 rounded-full" style={{ backgroundColor: track.color }}></div>
              </div>

              {canRouteToGroup && groupTracks.length > 0 && (
                <div className="px-2 py-1 border-b border-[#1b2233] bg-[#101829]">
                  <div className="text-[7px] uppercase tracking-wider text-gray-500 mb-1 flex items-center gap-1">
                    <Layers3 size={9} /> Submix
                  </div>
                  <select
                    value={routeValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      onUpdate(track.id, { groupId: value === 'master' ? undefined : value });
                    }}
                    className="w-full h-6 bg-[#0b111d] border border-[#25314a] rounded-[2px] text-[9px] text-gray-200 outline-none"
                  >
                    <option value="master">Master</option>
                    {groupTracks.map((groupTrack) => (
                      <option key={groupTrack.id} value={groupTrack.id}>
                        {groupTrack.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {canUseVca && groupTracks.length > 0 && (
                <div className="px-2 py-1 border-b border-[#1b2233] bg-[#0f1727]">
                  <div className="text-[7px] uppercase tracking-wider text-gray-500 mb-1">VCA</div>
                  <select
                    value={vcaValue}
                    onChange={(event) => {
                      const value = event.target.value;
                      onUpdate(track.id, { vcaGroupId: value === 'none' ? undefined : value });
                    }}
                    className="w-full h-6 bg-[#0b111d] border border-[#25314a] rounded-[2px] text-[9px] text-gray-200 outline-none"
                  >
                    <option value="none">None</option>
                    {groupTracks.map((groupTrack) => (
                      <option key={groupTrack.id} value={groupTrack.id}>
                        {groupTrack.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="px-2 py-2 border-b border-[#1b2233] bg-[#0b1019] flex justify-center gap-2">
                <div className="flex flex-col items-center">
                  <Knob
                    value={track.pan}
                    defaultValue={0}
                    min={-50}
                    max={50}
                    size={30}
                    color="#22d3ee"
                    bipolar
                    onChange={(value) => onUpdate(track.id, { pan: value })}
                  />
                  <span className="text-[7px] font-mono text-gray-500 uppercase">Pan</span>
                </div>

                <div className="flex flex-col items-center">
                  <Knob
                    value={normalizeReverbUiValue(track.reverb)}
                    defaultValue={0}
                    min={0}
                    max={100}
                    size={30}
                    color="#a855f7"
                    onChange={(value) => onUpdate(track.id, { reverb: value })}
                  />
                  <span className="text-[7px] font-mono text-gray-500 uppercase">Rev</span>
                </div>
              </div>

              {track.type !== TrackType.RETURN && returnTracks.length > 0 && (
                <div className="px-2 py-2 border-b border-[#1b2233] bg-[#0a0f18]">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-wider mb-1">Sends</div>
                  <div className="grid grid-cols-2 gap-2">
                    {returnTracks.map((returnTrack) => {
                      const sendDb = normalizeStoredSendDb(track.sends?.[returnTrack.id]);
                      const sendMode: 'pre' | 'post' = track.sendModes?.[returnTrack.id] === 'pre' ? 'pre' : 'post';

                      return (
                        <div key={returnTrack.id} className="flex flex-col items-center gap-0.5" title={`Send a ${returnTrack.name}`}>
                          <Knob
                            value={sendDb}
                            defaultValue={SEND_MIN_DB}
                            min={SEND_MIN_DB}
                            max={SEND_MAX_DB}
                            size={24}
                            color={returnTrack.color}
                            onChange={(value) => {
                              const linearSend = value <= SEND_MIN_DB + 0.01 ? 0 : Math.pow(10, value / 20);
                              onUpdate(track.id, {
                                sends: {
                                  ...(track.sends || {}),
                                  [returnTrack.id]: linearSend
                                }
                              });
                            }}
                          />
                          <button
                            onClick={() => {
                              onUpdate(track.id, {
                                sendModes: {
                                  ...(track.sendModes || {}),
                                  [returnTrack.id]: sendMode === 'pre' ? 'post' : 'pre'
                                }
                              });
                            }}
                            className={`h-4 px-1 rounded-[2px] text-[7px] font-bold uppercase tracking-wider ${sendMode === 'pre' ? 'bg-amber-400/25 text-amber-200 border border-amber-300/40' : 'bg-cyan-400/20 text-cyan-200 border border-cyan-300/35'}`}
                            title="Toggle Pre/Post"
                          >
                            {sendMode === 'pre' ? 'Pre' : 'Post'}
                          </button>
                          <span className="text-[7px] font-mono text-gray-500 uppercase truncate max-w-[42px]">
                            {returnTrack.name.replace('Return ', 'R')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-[220px] bg-[#090d15] px-2 py-2 flex items-stretch justify-center gap-2">
                <MeterColumn meter={meter} isClipHold={isClipHold} onReset={() => resetTrackMeter(track.id)} />

                <div className="w-8 relative rounded-[2px] border border-[#1d2433] bg-[#05070e]">
                  <div className="absolute inset-x-1 top-1 bottom-1 bg-[repeating-linear-gradient(to_top,rgba(255,255,255,0.04)_0,rgba(255,255,255,0.04)_1px,transparent_1px,transparent_12px)] rounded-[2px]"></div>
                  <div
                    className="absolute left-1/2 -translate-x-1/2 w-10 h-5 rounded-[2px] border border-black bg-[linear-gradient(180deg,#3a435e_0%,#1b2234_100%)] shadow-[0_2px_8px_rgba(0,0,0,0.45)] cursor-ns-resize flex items-center justify-center"
                    style={{ bottom: `calc(${faderBottom} - 10px)` }}
                    onMouseDown={(event) => handleTrackFaderDragStart(event, track)}
                    onDoubleClick={() => onUpdate(track.id, { volume: 0 })}
                    title="Drag vertical para volumen, Shift para fino, doble clic para 0 dB"
                  >
                    <div className="w-6 h-px bg-white/70"></div>
                  </div>
                </div>
              </div>

              <div className="px-2 py-1 border-t border-[#1b2233] bg-[#10182a] text-center text-[9px] font-mono text-[#45d3f3]">
                {formatDb(track.volume)}
              </div>

              <div className="p-1 border-t border-[#1b2233] bg-[#0f1524] grid grid-cols-4 gap-1">
                <button
                  onClick={() => onUpdate(track.id, { isMuted: !track.isMuted })}
                  className={`h-6 text-[9px] font-bold rounded-sm border transition-colors ${track.isMuted ? 'bg-amber-400 text-black border-amber-300' : 'bg-[#1d2639] text-gray-400 border-transparent hover:text-white'}`}
                >
                  M
                </button>
                <button
                  onClick={() => onUpdate(track.id, { isSoloed: !track.isSoloed })}
                  className={`h-6 text-[9px] font-bold rounded-sm border transition-colors ${track.isSoloed ? 'bg-cyan-300 text-black border-cyan-200' : 'bg-[#1d2639] text-gray-400 border-transparent hover:text-white'}`}
                >
                  S
                </button>
                <button
                  disabled={!canArm}
                  onClick={() => canArm && onUpdate(track.id, { isArmed: !track.isArmed })}
                  className={`h-6 text-[9px] font-bold rounded-sm border transition-colors ${canArm ? (track.isArmed ? 'bg-rose-500 text-white border-rose-400' : 'bg-[#1d2639] text-gray-400 border-transparent hover:text-white') : 'bg-[#171c2a] text-gray-600 border-transparent cursor-not-allowed'}`}
                >
                  A
                </button>
                <button
                  onClick={() => onUpdate(track.id, { soloSafe: !track.soloSafe })}
                  className={`h-6 text-[8px] font-bold rounded-sm border transition-colors ${track.soloSafe ? 'bg-emerald-400 text-black border-emerald-300' : 'bg-[#1d2639] text-gray-400 border-transparent hover:text-white'}`}
                  title="Solo Safe"
                >
                  SAFE
                </button>
              </div>

              <div className="p-1 border-t border-[#1b2233] bg-[#0d1320] grid grid-cols-3 gap-1">
                {monitorModes.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onUpdate(track.id, { monitor: mode })}
                    className={`h-5 text-[7px] font-bold uppercase rounded-sm transition-colors ${track.monitor === mode ? 'bg-[#34d3f2] text-black' : 'bg-[#1d2639] text-gray-500 hover:text-gray-300'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {track.type === TrackType.AUDIO && (
                <div className="p-1 border-t border-[#1b2233] bg-[#0a1220] space-y-1">
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          profile: 'studio-voice',
                          inputGain: 1,
                          monitoringReverb: false,
                          monitoringEcho: false
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.profile === 'studio-voice' ? 'bg-fuchsia-400/35 text-white' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Voice
                    </button>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          profile: 'podcast',
                          inputGain: 1,
                          monitoringReverb: false,
                          monitoringEcho: false
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.profile === 'podcast' ? 'bg-fuchsia-400/35 text-white' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Podcast
                    </button>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          profile: 'raw',
                          inputGain: 1,
                          monitoringReverb: false,
                          monitoringEcho: false
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.profile === 'raw' ? 'bg-fuchsia-400/35 text-white' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Raw
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          monitoringEnabled: !micSettings.monitoringEnabled
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.monitoringEnabled ? 'bg-fuchsia-300 text-[#190a1f]' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Mon
                    </button>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          monitoringReverb: !micSettings.monitoringReverb
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.monitoringReverb ? 'bg-fuchsia-300 text-[#190a1f]' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Rev
                    </button>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          monitoringEcho: !micSettings.monitoringEcho
                        }
                      })}
                      className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.monitoringEcho ? 'bg-fuchsia-300 text-[#190a1f]' : 'bg-[#1d2639] text-gray-400'}`}
                    >
                      Echo
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {monitorInputModes.map((inputMode) => (
                      <button
                        key={inputMode}
                        onClick={() => onUpdate(track.id, {
                          micSettings: {
                            ...micSettings,
                            monitorInputMode: inputMode
                          }
                        })}
                        className={`h-5 text-[7px] font-bold uppercase rounded-sm ${micSettings.monitorInputMode === inputMode ? 'bg-rose-300 text-[#190b12]' : 'bg-[#1d2639] text-gray-400'}`}
                        title={`Input mode: ${inputMode}`}
                      >
                        {inputMode === 'stereo' ? 'ST' : inputMode === 'mono' ? 'M' : inputMode === 'left' ? 'L' : 'R'}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-[32px_1fr_32px] gap-1 items-center">
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          inputGain: Math.max(0, Number((micSettings.inputGain - 0.05).toFixed(2)))
                        }
                      })}
                      className="h-5 text-[8px] font-bold rounded-sm bg-[#1d2639] text-gray-300 hover:text-white"
                      title="Bajar ganancia de entrada"
                    >
                      -
                    </button>
                    <div className="h-5 rounded-sm bg-[#121a2b] border border-[#24314a] text-[8px] text-gray-200 flex items-center justify-center font-mono">
                      IN {micSettings.inputGain.toFixed(2)}x
                    </div>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          inputGain: Math.min(2, Number((micSettings.inputGain + 0.05).toFixed(2)))
                        }
                      })}
                      className="h-5 text-[8px] font-bold rounded-sm bg-[#1d2639] text-gray-300 hover:text-white"
                      title="Subir ganancia de entrada"
                    >
                      +
                    </button>
                  </div>
                  <div className="grid grid-cols-[32px_1fr_32px] gap-1 items-center">
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          monitorLatencyCompensationMs: Number(clamp((micSettings.monitorLatencyCompensationMs || 0) - 0.25, 0, 24).toFixed(2))
                        }
                      })}
                      className="h-5 text-[8px] font-bold rounded-sm bg-[#1d2639] text-gray-300 hover:text-white"
                      title="Reducir compensacion de monitoreo"
                    >
                      -
                    </button>
                    <div className="h-5 rounded-sm bg-[#121a2b] border border-[#24314a] text-[8px] text-gray-200 flex items-center justify-center font-mono">
                      LAT {(micSettings.monitorLatencyCompensationMs || 0).toFixed(2)}ms
                    </div>
                    <button
                      onClick={() => onUpdate(track.id, {
                        micSettings: {
                          ...micSettings,
                          monitorLatencyCompensationMs: Number(clamp((micSettings.monitorLatencyCompensationMs || 0) + 0.25, 0, 24).toFixed(2))
                        }
                      })}
                      className="h-5 text-[8px] font-bold rounded-sm bg-[#1d2639] text-gray-300 hover:text-white"
                      title="Incrementar compensacion de monitoreo"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              <div className="p-1 border-t border-[#1b2233] bg-[#10182a] grid grid-cols-5 gap-1">
                {(['off', 'read', 'touch', 'latch', 'write'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => onUpdate(track.id, { automationMode: mode })}
                    className={`h-5 text-[7px] font-bold uppercase rounded-sm transition-colors ${
                      (track.automationMode || 'read') === mode
                        ? 'bg-violet-400/30 text-violet-100 border border-violet-300/40'
                        : 'bg-[#1d2639] text-gray-500 hover:text-gray-300'
                    }`}
                    title={`Automation ${mode}`}
                  >
                    {mode === 'off' ? 'O' : mode === 'read' ? 'R' : mode === 'touch' ? 'T' : mode === 'latch' ? 'L' : 'W'}
                  </button>
                ))}
              </div>

              <div className="p-1 border-t border-[#1b2233] bg-[#0d1422] grid grid-cols-2 gap-1">
                <button
                  onClick={() => toggleCueMode(track.id, 'pfl')}
                  className={`h-5 text-[7px] font-bold uppercase rounded-sm transition-colors ${isCuePfl ? 'bg-amber-300 text-black' : 'bg-[#1d2639] text-gray-500 hover:text-gray-300'}`}
                  title="Pre-fader listen"
                >
                  PFL
                </button>
                <button
                  onClick={() => toggleCueMode(track.id, 'afl')}
                  className={`h-5 text-[7px] font-bold uppercase rounded-sm transition-colors ${isCueAfl ? 'bg-amber-300 text-black' : 'bg-[#1d2639] text-gray-500 hover:text-gray-300'}`}
                  title="After-fader listen"
                >
                  AFL
                </button>
              </div>
            </div>
          );
        })}

        <div className="w-[128px] min-h-full bg-[#0b101b] border border-[#213048] rounded-sm flex flex-col shrink-0 overflow-hidden">
          <div className="px-2 py-2 bg-[#162239] border-b border-[#213048]">
            <div className="text-[8px] font-mono uppercase tracking-wider text-gray-500">Output</div>
            <div className="text-[11px] font-bold text-white tracking-wide">MASTER</div>
            <div className="h-[2px] w-full mt-2 rounded-full bg-[#4fd1c5]"></div>
          </div>

          <div className="flex-1 min-h-[260px] bg-[#0b121f] px-2 py-2 flex items-stretch justify-center gap-2">
            <MeterColumn meter={masterMeter} isClipHold={masterClipHold} widthClass="w-4" onReset={resetMasterMeter} />

            <div className="w-9 relative rounded-[2px] border border-[#22324f] bg-[#050a13]">
              <div className="absolute inset-x-1 top-1 bottom-1 bg-[repeating-linear-gradient(to_top,rgba(255,255,255,0.04)_0,rgba(255,255,255,0.04)_1px,transparent_1px,transparent_12px)] rounded-[2px]"></div>
              <div
                className="absolute left-1/2 -translate-x-1/2 w-11 h-5 rounded-[2px] border border-black bg-[linear-gradient(180deg,#4c5d82_0%,#28354f_100%)] shadow-[0_2px_10px_rgba(0,0,0,0.55)] cursor-ns-resize flex items-center justify-center"
                style={{ bottom: `calc(${getFaderPosition(masterVolumeDb)}% - 10px)` }}
                onMouseDown={handleMasterFaderDragStart}
                onDoubleClick={resetMasterFader}
                title="Master volume"
              >
                <div className="w-7 h-px bg-white/80"></div>
              </div>
            </div>
          </div>

          <div className="px-2 py-1 border-t border-[#213048] bg-[#131f35] text-center text-[10px] font-mono text-[#4fd1c5]">
            {formatDb(masterVolumeDb)}
          </div>

          <div className="px-2 py-1 border-t border-[#213048] bg-[#0f182b] text-[8px] font-mono text-gray-400 space-y-0.5">
            <div className="flex justify-between"><span>RMS</span><span>{masterMeter.rmsDb.toFixed(1)} dB</span></div>
            <div className="flex justify-between"><span>Peak</span><span className={masterClipHold ? 'text-red-300' : ''}>{masterMeter.peakDb.toFixed(1)} dB</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mixer;
