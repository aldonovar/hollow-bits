import React, { useMemo } from 'react';
import { Headphones, GitMerge } from 'lucide-react';
import { RecordingTake, TakeLane, Track } from '../types';

interface TakeLanesPanelProps {
    track: Track | null;
    selectedClipId: string | null;
    onSelectTake: (trackId: string, takeId: string) => void;
    onToggleTakeMute: (trackId: string, takeId: string) => void;
    onToggleTakeSolo: (trackId: string, takeId: string) => void;
    onAuditionTake: (trackId: string, takeId: string) => void;
    onSetCompLane: (trackId: string, laneId: string) => void;
}

interface LaneWithTakes {
    lane: TakeLane;
    takes: RecordingTake[];
}

const TakeLanesPanel: React.FC<TakeLanesPanelProps> = React.memo(({
    track,
    selectedClipId,
    onSelectTake,
    onToggleTakeMute,
    onToggleTakeSolo,
    onAuditionTake,
    onSetCompLane
}) => {
    const laneRows = useMemo<LaneWithTakes[]>(() => {
        if (!track || track.type !== 'AUDIO') return [];

        const takes = track.recordingTakes || [];
        const lanes = track.takeLanes || [];
        const takeById = new Map(takes.map((take) => [take.id, take]));

        const recordingRows = lanes
            .filter((lane) => !lane.isCompLane)
            .map((lane) => ({
                lane,
                takes: lane.takeIds
                    .map((takeId) => takeById.get(takeId))
                    .filter((take): take is RecordingTake => Boolean(take))
                    .sort((left, right) => left.startBar - right.startBar)
            }));

        if (recordingRows.length > 0) {
            return recordingRows;
        }

        if (takes.length === 0) {
            return [];
        }

        return [{
            lane: {
                id: 'lane-fallback',
                name: 'Take Lane',
                trackId: track.id,
                takeIds: takes.map((take) => take.id)
            },
            takes: [...takes].sort((left, right) => left.startBar - right.startBar)
        }];
    }, [track]);

    const compLane = useMemo(() => {
        if (!track || track.type !== 'AUDIO') return null;
        return (track.takeLanes || []).find((lane) => lane.id === track.activeCompLaneId && lane.isCompLane)
            || (track.takeLanes || []).find((lane) => lane.isCompLane)
            || {
                id: 'lane-comp-virtual',
                name: 'Comp Lane',
                trackId: track.id,
                isCompLane: true,
                takeIds: [],
                compSegments: []
            };
    }, [track]);

    if (!track || track.type !== 'AUDIO') {
        return (
            <div className="h-full w-full bg-[#0f1118]/94 border-l border-daw-border flex items-center justify-center p-5">
                <div className="text-center">
                    <div className="text-[11px] font-black uppercase tracking-wider text-gray-300">Take Lanes</div>
                    <div className="mt-1 text-[10px] text-gray-500">Selecciona una pista de audio para editar tomas.</div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-[#0f1118]/94 border-l border-daw-border backdrop-blur-sm flex flex-col">
            <div className="px-3 py-2 border-b border-daw-border bg-[#121522]/85">
                <div className="text-[10px] uppercase tracking-[0.14em] font-black text-daw-violet">Take Lanes</div>
                <div className="text-[11px] font-bold text-gray-200 truncate mt-1">{track.name}</div>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-3">
                {compLane && (
                    <section className="rounded-[4px] border border-daw-violet/40 bg-[#171328]/70">
                        <div className="px-2 py-1.5 flex items-center justify-between border-b border-daw-violet/30">
                            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-daw-violet">
                                <GitMerge size={12} />
                                {compLane.name}
                            </div>
                            <button
                                onClick={() => onSetCompLane(track.id, compLane.id)}
                                className={`text-[9px] px-2 h-5 rounded-[2px] border ${track.activeCompLaneId === compLane.id ? 'bg-daw-violet/25 text-daw-violet border-daw-violet/60' : 'bg-[#1f2230] text-gray-400 border-[#2d3140] hover:text-white'}`}
                            >
                                {track.activeCompLaneId === compLane.id ? 'ACTIVA' : 'ACTIVAR'}
                            </button>
                        </div>
                        <div className="px-2 py-1.5 text-[10px] text-gray-400">
                            Segmentos: <span className="font-mono text-gray-200">{compLane.compSegments?.length || 0}</span>
                        </div>
                    </section>
                )}

                {laneRows.length === 0 && (
                    <div className="rounded-[4px] border border-daw-border bg-[#11141e] px-3 py-3 text-[10px] text-gray-500">
                        No hay tomas grabadas en esta pista.
                    </div>
                )}

                {laneRows.map((laneRow) => (
                    <section key={laneRow.lane.id} className="rounded-[4px] border border-daw-border bg-[#131722]/78">
                        <div className="px-2 py-1.5 border-b border-daw-border text-[10px] uppercase tracking-wider font-bold text-gray-300">
                            {laneRow.lane.name}
                        </div>

                        <div className="p-2 space-y-1.5">
                            {laneRow.takes.map((take) => {
                                const relatedClip = track.clips.find((clip) => clip.id === take.clipId);
                                const isActive = track.activeTakeId === take.id || selectedClipId === take.clipId;
                                const isSolo = track.soloTakeId === take.id;
                                const isMuted = Boolean(take.muted);

                                return (
                                    <div
                                        key={take.id}
                                        className={`rounded-[3px] border px-2 py-1.5 ${isActive ? 'border-daw-cyan/70 bg-daw-cyan/10' : 'border-daw-border bg-[#0f121a] hover:bg-[#141a25]'}`}
                                    >
                                        <button
                                            onClick={() => onSelectTake(track.id, take.id)}
                                            className="w-full text-left"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-[10px] font-bold text-gray-100 truncate">{take.label || take.id}</span>
                                                <span className="text-[9px] font-mono text-gray-500 shrink-0">B{take.startBar.toFixed(2)}</span>
                                            </div>
                                            <div className="text-[9px] text-gray-500 font-mono mt-0.5">
                                                Len {take.lengthBars.toFixed(2)} | Off {(take.offsetBars || 0).toFixed(2)}
                                            </div>
                                        </button>

                                        <div className="mt-1.5 flex items-center gap-1">
                                            <button
                                                onClick={() => onAuditionTake(track.id, take.id)}
                                                className="h-5 px-2 text-[9px] rounded-[2px] border border-[#2f3647] bg-[#1b2130] text-gray-300 hover:text-white flex items-center gap-1"
                                                title="Audition"
                                            >
                                                <Headphones size={10} />
                                                A
                                            </button>
                                            <button
                                                onClick={() => onToggleTakeSolo(track.id, take.id)}
                                                className={`h-5 px-2 text-[9px] rounded-[2px] border ${isSolo ? 'bg-[#2563eb]/25 text-blue-300 border-blue-400/60' : 'bg-[#1b2130] text-gray-300 border-[#2f3647] hover:text-white'}`}
                                                title="Solo Take"
                                            >
                                                S
                                            </button>
                                            <button
                                                onClick={() => onToggleTakeMute(track.id, take.id)}
                                                className={`h-5 px-2 text-[9px] rounded-[2px] border ${isMuted ? 'bg-[#d97706]/20 text-amber-300 border-amber-400/60' : 'bg-[#1b2130] text-gray-300 border-[#2f3647] hover:text-white'}`}
                                                title="Mute Take"
                                            >
                                                M
                                            </button>
                                            <div className="ml-auto text-[9px] font-mono text-gray-500 truncate max-w-[90px]">
                                                {relatedClip?.name || take.clipId}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
});

export default TakeLanesPanel;
