
import React, { useCallback, useSyncExternalStore } from 'react';
import { Track } from '../types';
import { Trash2, Circle } from 'lucide-react';
import Knob from './Knob';
import { trackHeaderMeterStore } from '../services/trackHeaderMeterStore';

interface TrackHeaderProps {
    track: Track;
    height: number;
    isSelected: boolean;
    onSelect: () => void;
    onUpdate: (updates: Partial<Track>) => void;
    onDelete: () => void;
}

const TrackHeader: React.FC<TrackHeaderProps> = React.memo(({ track, height, isSelected, onSelect, onUpdate, onDelete }) => {
    const monitorModes: Track['monitor'][] = ['in', 'auto', 'off'];

    const meterSnapshot = useSyncExternalStore(
        useCallback((listener) => trackHeaderMeterStore.subscribe(track.id, listener), [track.id]),
        useCallback(() => trackHeaderMeterStore.getSnapshot(track.id), [track.id]),
        () => trackHeaderMeterStore.getSnapshot(track.id)
    );

    const dbToMeterNormalized = (db: number): number => {
        const minDb = -72;
        const maxDb = 6;
        const clamped = Math.min(maxDb, Math.max(minDb, db));
        const normalized = (clamped - minDb) / (maxDb - minDb);
        return Math.pow(normalized, 1.35);
    };

    const showKnobs = height >= 70;
    const showMonitor = height >= 86;
    const isCompact = height < 100;
    const punchRange = track.punchRange || {
        enabled: false,
        inBar: 1,
        outBar: 2,
        preRollBars: 1,
        countInBars: 0
    };
    const punchEnabled = Boolean(punchRange.enabled);

    const peakMeterLevel = track.isMuted ? 0 : dbToMeterNormalized(meterSnapshot.peakDb);
    const rmsMeterLevel = track.isMuted ? 0 : Math.min(peakMeterLevel, dbToMeterNormalized(meterSnapshot.rmsDb));
    const clipped = !track.isMuted && meterSnapshot.clipped;

    const peakHeight = Math.min(100, peakMeterLevel * 100);
    const rmsHeight = Math.min(100, rmsMeterLevel * 100);
    const peakLineBottom = Math.max(0, Math.min(99, peakHeight));

    return (
        <div
            className={`h-full w-full flex border-b border-daw-border relative group select-none overflow-hidden font-sans transition-colors
        ${isSelected ? 'bg-[#262626]' : 'bg-[#1e1e1e] hover:bg-[#222]'}
        ${isCompact ? 'p-1' : 'p-2'}
      `}
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
            <div
                className="w-2.5 h-full shrink-0 rounded-r-[1px]"
                style={{
                    backgroundColor: track.color,
                    boxShadow: `0 0 10px ${track.color}55`
                }}
            ></div>

            <div className="flex-1 flex flex-col min-w-0 relative h-full pl-2">
                <div className={`flex items-center justify-between shrink-0 h-4 ${showKnobs ? 'mb-0.5' : 'mb-0'}`}>
                    <div className="flex items-center gap-2 overflow-hidden min-w-0">
                        <span className={`font-black text-[11px] truncate uppercase tracking-wider ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                            {track.name}
                        </span>
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); onDelete(); }}
                        className="text-gray-600 hover:text-daw-ruby opacity-0 group-hover:opacity-100 transition-opacity p-0.5 shrink-0"
                    >
                        <Trash2 size={11} />
                    </button>
                </div>

                {showKnobs && (
                    <div className="flex-1 flex items-center justify-between px-1 min-h-0 my-0.5">
                        <Knob label="VOL" value={track.volume} min={-60} max={6} defaultValue={0} size={24} color={track.color} onChange={(val) => onUpdate({ volume: val })} />
                        <Knob label="PAN" value={track.pan} min={-50} max={50} defaultValue={0} size={24} color="#00fff2" bipolar={true} onChange={(val) => onUpdate({ pan: Math.round(val) })} />
                        <Knob label="REV" value={track.reverb} min={0} max={100} defaultValue={0} size={24} color="#f43f5e" onChange={(val) => onUpdate({ reverb: val })} />
                    </div>
                )}

                {!showKnobs && <div className="flex-1"></div>}

                <div className="mt-auto flex flex-col gap-1 shrink-0">
                    {showMonitor && (
                        <div className="flex items-center gap-1 bg-[#121212] p-0.5 rounded-sm border border-[#333] mb-0.5 h-4">
                            <span className="text-[7px] font-bold text-gray-600 uppercase pl-1">In</span>
                            <div className="flex-1 flex gap-[1px]">
                                {monitorModes.map((mode) => (
                                    <button key={mode} onClick={(e) => { e.stopPropagation(); onUpdate({ monitor: mode }); }} className={`flex-1 py-0 text-[7px] font-bold uppercase rounded-[1px] transition-all ${track.monitor === mode ? 'bg-daw-cyan text-black' : 'bg-[#1a1a1a] text-gray-500 hover:bg-[#222]'}`}>{mode}</button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-4 gap-1 h-5 relative">
                        <button onClick={(e) => { e.stopPropagation(); onUpdate({ isMuted: !track.isMuted }) }} className={`rounded-[1px] flex items-center justify-center font-bold text-[9px] border ${track.isMuted ? 'bg-[#eab308] text-black border-[#eab308]' : 'bg-[#2a2a2a] text-[#eab308] border-[#333]'}`}>M</button>
                        <button onClick={(e) => { e.stopPropagation(); onUpdate({ isSoloed: !track.isSoloed }) }} className={`rounded-[1px] flex items-center justify-center font-bold text-[9px] border ${track.isSoloed ? 'bg-[#3b82f6] text-white border-[#3b82f6]' : 'bg-[#2a2a2a] text-[#3b82f6] border-[#333]'}`}>S</button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onUpdate({ isArmed: !track.isArmed }) }}
                            className={`rounded-[1px] flex items-center justify-center border transition-all ${track.isArmed ? 'bg-daw-ruby text-white border-daw-ruby animate-pulse' : 'bg-[#2a2a2a] text-daw-ruby border-[#333]'}`}
                        >
                            <Circle size={7} fill={track.isArmed ? "currentColor" : "none"} strokeWidth={3} />
                        </button>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onUpdate({
                                    punchRange: {
                                        ...punchRange,
                                        enabled: !punchEnabled
                                    }
                                });
                            }}
                            title={`Punch ${punchEnabled ? 'ON' : 'OFF'} (${punchRange.inBar.toFixed(2)}-${punchRange.outBar.toFixed(2)})`}
                            className={`rounded-[1px] flex items-center justify-center font-bold text-[9px] border transition-all ${punchEnabled ? 'bg-daw-violet text-white border-daw-violet' : 'bg-[#2a2a2a] text-daw-violet border-[#333]'}`}
                        >
                            P
                        </button>
                    </div>
                </div>
            </div>

            <div className="w-2.5 h-full bg-[#0a0a0a] border-l border-[#333] flex flex-col relative shrink-0">
                <div className={`w-full h-px mb-[1px] transition-colors duration-100 ${clipped ? 'bg-red-500 shadow-[0_0_5px_red]' : 'bg-[#1a1a1a]'}`}></div>
                <div className="flex-1 relative bg-[#050505] overflow-hidden">
                    <div
                        className="w-full absolute bottom-0 bg-meter-gradient opacity-85 transition-[height] duration-50 ease-out"
                        style={{ height: `${peakHeight}%` }}
                    ></div>
                    <div
                        className="w-full absolute bottom-0 bg-white/18 transition-[height] duration-50 ease-out"
                        style={{ height: `${rmsHeight}%` }}
                    ></div>
                    <div
                        className="absolute left-0 right-0 h-[1px] bg-white/90 shadow-[0_0_4px_rgba(255,255,255,0.5)] transition-[bottom] duration-50 ease-out"
                        style={{ bottom: `${peakLineBottom}%` }}
                    ></div>
                </div>
            </div>
        </div>
    );
});

export default TrackHeader;
