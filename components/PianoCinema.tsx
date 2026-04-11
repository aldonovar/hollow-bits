import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Note } from '../types';
import { buildScoreNoteKey, normalizeMidiVelocity } from '../services/pianoScoreConversionService';

interface PianoCinemaProps {
    notes: Note[];
    playhead16th: number;
    bpm: number;
    isPlaying: boolean;
    total16ths: number;
    selectedNoteKey: string | null;
    activeNoteIndexes: number[];
    livePitches: number[];
    sustainActive: boolean;
    zoom?: number;
    emptyTitle?: string;
    emptyMessage?: string;
    onSelectNoteKey?: (noteKey: string | null) => void;
    onSeekToTimeline16th?: (timeline16th: number) => void;
    onUpdateNote?: (noteIndex: number, nextNote: Note) => void;
}

interface PianoLaneNote extends Note {
    index: number;
    noteKey: string;
}

type DragMode = 'move' | 'trim-duration';

interface DragState {
    noteIndex: number;
    mode: DragMode;
    originPointerY: number;
    originStart: number;
    originDuration: number;
    originPitch: number;
}

const PIANO_MIN_MIDI = 21;
const PIANO_MAX_MIDI = 108;
const WHITE_KEY_SET = new Set([0, 2, 4, 5, 7, 9, 11]);
const BLACK_KEY_SET = new Set([1, 3, 6, 8, 10]);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const isBlackKey = (pitch: number): boolean => BLACK_KEY_SET.has(((pitch % 12) + 12) % 12);

const buildKeyboardLayout = (minPitch: number, maxPitch: number) => {
    const layoutMinPitch = isBlackKey(minPitch) ? Math.max(PIANO_MIN_MIDI, minPitch - 1) : minPitch;
    const layoutMaxPitch = isBlackKey(maxPitch) ? Math.min(PIANO_MAX_MIDI, maxPitch + 1) : maxPitch;
    const keyFrames = new Map<number, { x: number; width: number; center: number; black: boolean }>();
    const whiteKeys: Array<{ pitch: number; x: number; width: number }> = [];
    const blackKeys: Array<{ pitch: number; x: number; width: number }> = [];
    const whiteKeyWidth = 28;
    const blackKeyWidth = 18;
    let whiteIndex = 0;

    for (let pitch = layoutMinPitch; pitch <= layoutMaxPitch; pitch += 1) {
        if (WHITE_KEY_SET.has(pitch % 12)) {
            const x = whiteIndex * whiteKeyWidth;
            whiteKeys.push({ pitch, x, width: whiteKeyWidth });
            keyFrames.set(pitch, {
                x,
                width: whiteKeyWidth,
                center: x + (whiteKeyWidth / 2),
                black: false
            });
            whiteIndex += 1;
        }
    }

    for (let pitch = layoutMinPitch; pitch <= layoutMaxPitch; pitch += 1) {
        if (!isBlackKey(pitch)) continue;
        const previousWhite = pitch - 1;
        const frame = keyFrames.get(previousWhite);
        if (!frame) continue;
        const x = frame.x + (frame.width * 0.68);
        blackKeys.push({ pitch, x, width: blackKeyWidth });
        keyFrames.set(pitch, {
            x,
            width: blackKeyWidth,
            center: x + (blackKeyWidth / 2),
            black: true
        });
    }

    return {
        width: whiteKeys.length * whiteKeyWidth,
        whiteKeys,
        blackKeys,
        keyFrames
    };
};

const findNearestPitch = (x: number, keyFrames: Map<number, { center: number }>): number => {
    let closestPitch = 60;
    let closestDistance = Number.POSITIVE_INFINITY;

    keyFrames.forEach((frame, pitch) => {
        const distance = Math.abs(frame.center - x);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestPitch = pitch;
        }
    });

    return closestPitch;
};

const PianoCinema: React.FC<PianoCinemaProps> = ({
    notes,
    playhead16th,
    bpm,
    isPlaying,
    total16ths,
    selectedNoteKey,
    activeNoteIndexes,
    livePitches,
    sustainActive,
    zoom = 1,
    emptyTitle = 'Sin material en Piano Cinema',
    emptyMessage = 'Cuando haya notas, el editor inferior seguira el transporte en tiempo real.',
    onSelectNoteKey,
    onSeekToTimeline16th,
    onUpdateNote
}) => {
    const pitchRange = useMemo(() => {
        const allPitches = [...notes.map((note) => note.pitch), ...livePitches];
        if (allPitches.length === 0) {
            return { min: 36, max: 84 };
        }

        let min = clamp(Math.min(...allPitches) - 3, PIANO_MIN_MIDI, PIANO_MAX_MIDI);
        let max = clamp(Math.max(...allPitches) + 4, PIANO_MIN_MIDI, PIANO_MAX_MIDI);
        const minimumSpan = 28;

        if ((max - min) < minimumSpan) {
            const center = (min + max) / 2;
            min = clamp(Math.floor(center - (minimumSpan / 2)), PIANO_MIN_MIDI, PIANO_MAX_MIDI - minimumSpan);
            max = clamp(min + minimumSpan, PIANO_MIN_MIDI + minimumSpan, PIANO_MAX_MIDI);
        }

        return { min, max };
    }, [livePitches, notes]);

    const keyboard = useMemo(() => buildKeyboardLayout(pitchRange.min, pitchRange.max), [pitchRange.max, pitchRange.min]);
    const svgRef = useRef<SVGSVGElement>(null);
    const motionLayerRef = useRef<SVGGElement>(null);
    const ribbonPlayheadRef = useRef<SVGLineElement>(null);
    const [dragState, setDragState] = useState<DragState | null>(null);

    const laneNotes = useMemo<PianoLaneNote[]>(() => {
        return [...notes]
            .map((note, index) => ({
                ...note,
                index,
                noteKey: buildScoreNoteKey(note, index)
            }))
            .sort((left, right) => left.start - right.start || left.pitch - right.pitch);
    }, [notes]);

    const selectedNote = useMemo(() => {
        return laneNotes.find((note) => note.noteKey === selectedNoteKey) || null;
    }, [laneNotes, selectedNoteKey]);

    const activeIndexSet = useMemo(() => new Set(activeNoteIndexes), [activeNoteIndexes]);
    const livePitchSet = useMemo(() => new Set(livePitches), [livePitches]);
    const pixelsPer16th = 16 * zoom;
    const lookAhead16ths = 56;
    const lookBehind16ths = 8;
    const headerHeight = 36;
    const mainHeight = 500;
    const keyboardHeight = 72;
    const noteViewportHeight = mainHeight - keyboardHeight;
    const keyboardTop = noteViewportHeight + 18;

    useEffect(() => {
        const msPer16th = Math.max(1, 60000 / Math.max(1, bpm) / 4);
        const startedAt = performance.now();
        const basePlayhead16th = playhead16th;
        let frameId = 0;

        const paint = () => {
            const elapsed16ths = isPlaying ? (performance.now() - startedAt) / msPer16th : 0;
            const current16th = basePlayhead16th + elapsed16ths;
            const clamped16th = clamp(current16th, 0, Math.max(16, total16ths));

            if (motionLayerRef.current) {
                motionLayerRef.current.setAttribute('transform', `translate(0 ${clamped16th * pixelsPer16th})`);
            }

            const ribbonX = (clamped16th / Math.max(16, total16ths)) * keyboard.width;
            ribbonPlayheadRef.current?.setAttribute('x1', String(ribbonX));
            ribbonPlayheadRef.current?.setAttribute('x2', String(ribbonX));

            if (isPlaying) {
                frameId = window.requestAnimationFrame(paint);
            }
        };

        paint();
        return () => window.cancelAnimationFrame(frameId);
    }, [bpm, isPlaying, keyboard.width, pixelsPer16th, playhead16th, total16ths]);

    useEffect(() => {
        if (!dragState) return;

        const handlePointerMove = (event: PointerEvent) => {
            if (!svgRef.current || !dragState) return;
            const rect = svgRef.current.getBoundingClientRect();
            const viewScaleY = mainHeight / rect.height;
            const viewScaleX = keyboard.width / rect.width;
            const pointerY = (event.clientY - rect.top) * viewScaleY;
            const pointerX = (event.clientX - rect.left) * viewScaleX;
            const targetPitch = clamp(findNearestPitch(pointerX, keyboard.keyFrames), PIANO_MIN_MIDI, PIANO_MAX_MIDI);
            const delta16th = (dragState.originPointerY - pointerY) / pixelsPer16th;
            const targetStart = clamp(dragState.originStart - delta16th, 0, Math.max(0, total16ths));

            if (dragState.mode === 'move') {
                onUpdateNote?.(dragState.noteIndex, {
                    pitch: targetPitch,
                    start: Math.round(targetStart * 4) / 4,
                    duration: dragState.originDuration,
                    velocity: normalizeMidiVelocity(notes[dragState.noteIndex]?.velocity ?? 96)
                });
                return;
            }

            const targetDuration = clamp(((keyboardTop - pointerY) / pixelsPer16th), 0.25, 64);
            onUpdateNote?.(dragState.noteIndex, {
                pitch: dragState.originPitch,
                start: dragState.originStart,
                duration: Math.round(targetDuration * 4) / 4,
                velocity: normalizeMidiVelocity(notes[dragState.noteIndex]?.velocity ?? 96)
            });
        };

        const handlePointerUp = () => {
            setDragState(null);
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        return () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
        };
    }, [dragState, keyboard.keyFrames, keyboard.width, keyboardTop, mainHeight, notes, onUpdateNote, pixelsPer16th, total16ths]);

    const handleSeekRibbonClick = (event: React.MouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        onSeekToTimeline16th?.(ratio * Math.max(16, total16ths));
    };

    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-daw-border bg-[#12141b]">
            <div className="flex h-9 items-center justify-between border-b border-daw-border bg-[#18181b] px-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Piano Cinema</span>
                <div className="flex items-center gap-2">
                    <span className={`rounded-sm border px-2 py-1 text-[9px] font-bold uppercase tracking-wider ${sustainActive ? 'border-cyan-400/35 bg-cyan-500/10 text-cyan-200' : 'border-white/10 bg-[#151824] text-gray-500'}`}>
                        Sustain {sustainActive ? 'On' : 'Off'}
                    </span>
                    {livePitches.length > 0 && (
                        <span className="rounded-sm border border-emerald-400/35 bg-emerald-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-200">
                            Live {livePitches.length}
                        </span>
                    )}
                </div>
            </div>

            <div className="border-b border-daw-border bg-[#121620] px-3 py-2">
                <svg
                    className="h-8 w-full cursor-pointer"
                    viewBox={`0 0 ${keyboard.width} ${headerHeight}`}
                    preserveAspectRatio="none"
                    onClick={handleSeekRibbonClick}
                >
                    <rect x={0} y={0} width={keyboard.width} height={headerHeight} fill="rgba(10,12,18,0.98)" />
                    {Array.from({ length: Math.max(1, Math.ceil(total16ths / 16)) }, (_, index) => {
                        const x = (index / Math.max(1, Math.ceil(total16ths / 16))) * keyboard.width;
                        return (
                            <g key={`seek-bar-${index}`}>
                                <line x1={x} y1={6} x2={x} y2={30} stroke="rgba(148,163,184,0.2)" strokeWidth={1} />
                                <text x={x + 6} y={15} fill="rgba(148,163,184,0.58)" fontSize={9} letterSpacing="0.2em">
                                    {index + 1}
                                </text>
                            </g>
                        );
                    })}
                    <line
                        ref={ribbonPlayheadRef}
                        x1={(clamp(playhead16th, 0, Math.max(16, total16ths)) / Math.max(16, total16ths)) * keyboard.width}
                        y1={4}
                        x2={(clamp(playhead16th, 0, Math.max(16, total16ths)) / Math.max(16, total16ths)) * keyboard.width}
                        y2={32}
                        stroke="rgba(52,211,242,0.95)"
                        strokeWidth={3}
                    />
                </svg>
            </div>

            <div className="relative min-h-0 flex-1 bg-[#12141b] p-3">
                <svg
                    ref={svgRef}
                    className="block h-full w-full rounded-sm bg-[#0b0e14]"
                    viewBox={`0 0 ${keyboard.width} ${mainHeight}`}
                    preserveAspectRatio="xMidYMid meet"
                >
                    <defs>
                        <linearGradient id="cinema-note-fill" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="rgba(52,211,242,0.95)" />
                            <stop offset="100%" stopColor="rgba(168,85,247,0.92)" />
                        </linearGradient>
                    </defs>

                    <rect x={0} y={0} width={keyboard.width} height={mainHeight} fill="rgba(9,12,18,0.98)" />

                    <g ref={motionLayerRef}>
                        {Array.from({ length: Math.ceil((lookAhead16ths + lookBehind16ths) / 4) }, (_, index) => {
                            const timeline16th = playhead16th - lookBehind16ths + (index * 4);
                            const y = keyboardTop - (timeline16th * pixelsPer16th);
                            return (
                                <g key={`grid-${index}`}>
                                    <line
                                        x1={0}
                                        y1={y}
                                        x2={keyboard.width}
                                        y2={y}
                                        stroke={index % 4 === 0 ? 'rgba(148,163,184,0.16)' : 'rgba(71,85,105,0.12)'}
                                        strokeWidth={index % 4 === 0 ? 1.2 : 1}
                                    />
                                </g>
                            );
                        })}

                        {laneNotes.map((note) => {
                            const frame = keyboard.keyFrames.get(note.pitch);
                            if (!frame) return null;

                            const relativeNoteBottom = keyboardTop - ((note.start - playhead16th) * pixelsPer16th);
                            const noteHeight = Math.max(8, note.duration * pixelsPer16th);
                            const noteBottom = keyboardTop - (note.start * pixelsPer16th);
                            const noteTop = noteBottom - noteHeight;

                            if (relativeNoteBottom < -24 || (relativeNoteBottom - noteHeight) > noteViewportHeight + 48) {
                                return null;
                            }

                            const isSelected = note.noteKey === selectedNoteKey;
                            const isActive = activeIndexSet.has(note.index) || livePitchSet.has(note.pitch);
                            const noteWidth = frame.black ? frame.width + 4 : frame.width - 4;
                            const noteX = frame.black ? frame.x - 2 : frame.x + 2;
                            const glow = isActive ? 'rgba(52,211,242,0.35)' : 'rgba(168,85,247,0.12)';

                            return (
                                <g key={note.noteKey}>
                                    <rect
                                        x={noteX - 1}
                                        y={noteTop - 2}
                                        width={noteWidth + 2}
                                        height={noteHeight + 4}
                                        rx={4}
                                        fill={glow}
                                        opacity={isSelected || isActive ? 1 : 0.5}
                                    />
                                    <rect
                                        x={noteX}
                                        y={noteTop}
                                        width={noteWidth}
                                        height={noteHeight}
                                        rx={4}
                                        fill="url(#cinema-note-fill)"
                                        opacity={isSelected || isActive ? 0.96 : 0.82}
                                        stroke={isSelected ? '#f8fafc' : 'rgba(15,23,42,0.55)'}
                                        strokeWidth={isSelected ? 1.75 : 1}
                                        className="cursor-pointer"
                                        onPointerDown={(event) => {
                                            onSelectNoteKey?.(note.noteKey);
                                            setDragState({
                                                noteIndex: note.index,
                                                mode: 'move',
                                                originPointerY: ((event.clientY - event.currentTarget.getBoundingClientRect().top) + (event.currentTarget.getBoundingClientRect().top - svgRef.current!.getBoundingClientRect().top)) * (mainHeight / svgRef.current!.getBoundingClientRect().height),
                                                originStart: note.start,
                                                originDuration: note.duration,
                                                originPitch: note.pitch
                                            });
                                        }}
                                    />
                                    <rect
                                        x={noteX}
                                        y={noteTop}
                                        width={noteWidth}
                                        height={5}
                                        rx={2}
                                        fill="rgba(248,250,252,0.7)"
                                        className="cursor-ns-resize"
                                        onPointerDown={(event) => {
                                            event.stopPropagation();
                                            onSelectNoteKey?.(note.noteKey);
                                            setDragState({
                                                noteIndex: note.index,
                                                mode: 'trim-duration',
                                                originPointerY: ((event.clientY - event.currentTarget.getBoundingClientRect().top) + (event.currentTarget.getBoundingClientRect().top - svgRef.current!.getBoundingClientRect().top)) * (mainHeight / svgRef.current!.getBoundingClientRect().height),
                                                originStart: note.start,
                                                originDuration: note.duration,
                                                originPitch: note.pitch
                                            });
                                        }}
                                    />
                                </g>
                            );
                        })}
                    </g>

                    <line
                        x1={0}
                        y1={keyboardTop}
                        x2={keyboard.width}
                        y2={keyboardTop}
                        stroke="rgba(52,211,242,0.75)"
                        strokeWidth={2}
                    />

                    {keyboard.whiteKeys.map((key) => {
                        const isLit = livePitchSet.has(key.pitch) || laneNotes.some((note) => activeIndexSet.has(note.index) && note.pitch === key.pitch);
                        return (
                            <rect
                                key={`white-${key.pitch}`}
                                x={key.x}
                                y={keyboardTop}
                                width={key.width}
                                height={keyboardHeight}
                                fill={isLit ? 'rgba(224,242,254,0.96)' : 'rgba(245,247,250,0.95)'}
                                stroke="rgba(15,23,42,0.3)"
                                strokeWidth={1}
                            />
                        );
                    })}

                    {keyboard.blackKeys.map((key) => {
                        const isLit = livePitchSet.has(key.pitch) || laneNotes.some((note) => activeIndexSet.has(note.index) && note.pitch === key.pitch);
                        return (
                            <rect
                                key={`black-${key.pitch}`}
                                x={key.x}
                                y={keyboardTop}
                                width={key.width}
                                height={keyboardHeight * 0.62}
                                rx={3}
                                fill={isLit ? 'rgba(52,211,242,0.95)' : 'rgba(10,12,18,0.98)'}
                                stroke={isLit ? 'rgba(224,242,254,0.4)' : 'rgba(255,255,255,0.04)'}
                                strokeWidth={1}
                            />
                        );
                    })}
                </svg>

                {laneNotes.length === 0 && livePitches.length === 0 && (
                    <div className="pointer-events-none absolute inset-6 flex items-center justify-center">
                        <div className="max-w-xl rounded-sm border border-dashed border-white/10 bg-[#0f1219]/96 px-5 py-4 text-center">
                            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{emptyTitle}</div>
                            <div className="mt-2 text-sm leading-6 text-gray-400">
                                {emptyMessage}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-daw-border bg-[#11131a] px-3 py-2 text-xs text-gray-300">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="rounded-sm border border-white/10 bg-[#151824] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                        Editor Time
                    </span>
                    <span className="truncate">
                        {selectedNote
                            ? `Pitch ${selectedNote.pitch} | Start ${selectedNote.start.toFixed(2)} | Dur ${selectedNote.duration.toFixed(2)}`
                            : 'Selecciona una nota para editarla desde el piano inferior.'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Velocity</span>
                        <input
                            type="range"
                            min={1}
                            max={127}
                            value={selectedNote ? normalizeMidiVelocity(selectedNote.velocity) : 96}
                            disabled={!selectedNote}
                            onChange={(event) => {
                                if (!selectedNote) return;
                                onUpdateNote?.(selectedNote.index, {
                                    pitch: selectedNote.pitch,
                                    start: selectedNote.start,
                                    duration: selectedNote.duration,
                                    velocity: normalizeMidiVelocity(Number(event.target.value))
                                });
                            }}
                            className="accent-daw-cyan"
                        />
                    </label>
                </div>
            </div>
        </div>
    );
};

export default React.memo(PianoCinema);
