import React, { useEffect, useMemo, useRef } from 'react';
import { ScoreDocument, ScoreEvent } from '../types';

interface ScoreViewportProps {
    document: ScoreDocument | null;
    playhead16th: number;
    bpm: number;
    isPlaying: boolean;
    selectedNoteKey: string | null;
    followTransport: boolean;
    zoom?: number;
    emptyTitle?: string;
    emptyMessage?: string;
    onSelectNoteKey?: (noteKey: string | null) => void;
    onSeekToTimeline16th?: (timeline16th: number) => void;
}

interface FlatScoreEvent extends ScoreEvent {
    absoluteStart16th: number;
    measureIndex: number;
    measureDuration16th: number;
}

const STAFF_LINE_GAP = 12;
const MEASURE_BASE_WIDTH = 340;
const MEASURE_LEFT_PADDING = 72;
const TREBLE_CLEF = '\uD834\uDD1E';
const BASS_CLEF = '\uD834\uDD22';

const flattenScoreEvents = (document: ScoreDocument): FlatScoreEvent[] => {
    return document.measures.flatMap((measure) => {
        return measure.voices.flatMap((voice) => {
            return voice.events.map((event) => ({
                ...event,
                absoluteStart16th: measure.start16th + event.start16th,
                measureIndex: measure.index,
                measureDuration16th: measure.duration16th
            }));
        });
    });
};

const pitchToScoreY = (pitch: number | undefined, hand: ScoreEvent['hand']): number => {
    const safePitch = typeof pitch === 'number' ? pitch : hand === 'right' ? 64 : 45;
    const rightBase = 142;
    const leftBase = 286;

    if (hand === 'right') {
        return rightBase - ((safePitch - 60) * 4);
    }

    return leftBase - ((safePitch - 36) * 4);
};

const renderStaffLines = (width: number) => {
    const lines: React.ReactNode[] = [];
    const groups = [
        { top: 96 },
        { top: 240 }
    ];

    groups.forEach((group, groupIndex) => {
        for (let i = 0; i < 5; i += 1) {
            const y = group.top + (i * STAFF_LINE_GAP);
            lines.push(
                <line
                    key={`staff-${groupIndex}-${i}`}
                    x1={0}
                    y1={y}
                    x2={width}
                    y2={y}
                    stroke="rgba(148,163,184,0.16)"
                    strokeWidth={1}
                />
            );
        }
    });

    return lines;
};

const ScoreViewport: React.FC<ScoreViewportProps> = ({
    document,
    playhead16th,
    bpm,
    isPlaying,
    selectedNoteKey,
    followTransport,
    zoom = 1,
    emptyTitle = 'Sin partitura',
    emptyMessage = 'Selecciona una fuente musical para construir la vista.',
    onSelectNoteKey,
    onSeekToTimeline16th
}) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
    const playheadLineRef = useRef<SVGLineElement>(null);
    const measureWidth = Math.max(180, MEASURE_BASE_WIDTH * zoom);
    const contentWidth = Math.max(120, measureWidth - MEASURE_LEFT_PADDING);

    const flattenedEvents = useMemo(() => {
        return document ? flattenScoreEvents(document) : [];
    }, [document]);

    const totalWidth = useMemo(() => {
        if (!document) return measureWidth;
        return Math.max(measureWidth, document.measures.length * measureWidth);
    }, [document, measureWidth]);

    useEffect(() => {
        if (!followTransport || !scrollRef.current || !document) return;

        const measureDuration16th = document.measures[0]?.duration16th || 16;
        const playheadMeasureIndex = Math.floor(playhead16th / measureDuration16th);
        const playheadOffset16th = playhead16th - (playheadMeasureIndex * measureDuration16th);
        const x = (playheadMeasureIndex * measureWidth) + MEASURE_LEFT_PADDING + ((playheadOffset16th / measureDuration16th) * contentWidth);
        const viewportWidth = scrollRef.current.clientWidth;
        const leftThreshold = scrollRef.current.scrollLeft + (viewportWidth * 0.22);
        const rightThreshold = scrollRef.current.scrollLeft + (viewportWidth * 0.78);

        if (x < leftThreshold || x > rightThreshold) {
            const targetScrollLeft = Math.max(0, x - (viewportWidth * 0.35));
            scrollRef.current.scrollTo({
                left: targetScrollLeft,
                behavior: 'auto'
            });
        }
    }, [document, followTransport, measureWidth, playhead16th]);

    useEffect(() => {
        if (!document || !playheadLineRef.current) return;

        const measureDuration16th = document.measures[0]?.duration16th || 16;
        const msPer16th = Math.max(1, 60000 / Math.max(1, bpm) / 4);
        const startedAt = performance.now();
        const basePlayhead16th = playhead16th;
        let frameId = 0;

        const paint = () => {
            const elapsed16ths = isPlaying ? (performance.now() - startedAt) / msPer16th : 0;
            const current16th = basePlayhead16th + elapsed16ths;
            const measureIndex = Math.floor(current16th / measureDuration16th);
            const offset16th = current16th - (measureIndex * measureDuration16th);
            const x = (measureIndex * measureWidth) + MEASURE_LEFT_PADDING + ((offset16th / measureDuration16th) * contentWidth);
            playheadLineRef.current?.setAttribute('x1', String(x));
            playheadLineRef.current?.setAttribute('x2', String(x));

            if (isPlaying) {
                frameId = window.requestAnimationFrame(paint);
            }
        };

        paint();
        return () => window.cancelAnimationFrame(frameId);
    }, [bpm, contentWidth, document, isPlaying, measureWidth, playhead16th]);

    const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
        if (!scrollRef.current) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) && !event.shiftKey) return;
        event.preventDefault();
        scrollRef.current.scrollLeft += event.shiftKey ? event.deltaY : event.deltaY * 1.1;
    };

    const handlePointerDown: React.PointerEventHandler<HTMLDivElement> = (event) => {
        if (!scrollRef.current) return;
        if ((event.target as HTMLElement).closest('[data-score-interactive="true"]')) return;
        dragStateRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            scrollLeft: scrollRef.current.scrollLeft
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove: React.PointerEventHandler<HTMLDivElement> = (event) => {
        if (!scrollRef.current || !dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) return;
        const delta = event.clientX - dragStateRef.current.startX;
        scrollRef.current.scrollLeft = dragStateRef.current.scrollLeft - delta;
    };

    const handlePointerUp: React.PointerEventHandler<HTMLDivElement> = (event) => {
        if (dragStateRef.current?.pointerId === event.pointerId) {
            dragStateRef.current = null;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    if (!document) {
        return (
            <div className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-daw-border bg-[#12141b]">
                <div className="flex h-9 items-center justify-between border-b border-daw-border bg-[#18181b] px-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Gran Pentagrama</span>
                    <span className="text-[9px] uppercase tracking-wider text-gray-600">Score View</span>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center bg-[#12141b] p-5">
                    <div className="w-full rounded-sm border border-dashed border-white/10 bg-[#0f1219] px-5 py-6">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{emptyTitle}</div>
                        <div className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                            {emptyMessage}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const measureDuration16th = document.measures[0]?.duration16th || 16;
    const playheadMeasureIndex = Math.floor(playhead16th / measureDuration16th);
    const playheadOffset16th = playhead16th - (playheadMeasureIndex * measureDuration16th);
    const playheadX = (playheadMeasureIndex * measureWidth) + MEASURE_LEFT_PADDING + ((playheadOffset16th / measureDuration16th) * contentWidth);

    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-sm border border-daw-border bg-[#12141b]">
            <div className="flex h-9 items-center justify-between border-b border-daw-border bg-[#18181b] px-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Gran Pentagrama</span>
                <span className="text-[9px] uppercase tracking-wider text-gray-400">
                    {document.timeSignature[0]}/{document.timeSignature[1]} | {document.sourceNoteCount} notas
                </span>
            </div>

            <div
                ref={scrollRef}
                className="min-h-0 flex-1 overflow-auto bg-[#12141b] cursor-grab active:cursor-grabbing"
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <svg
                    className="block"
                    width={totalWidth}
                    height={380}
                    viewBox={`0 0 ${totalWidth} 380`}
                    preserveAspectRatio="xMinYMin meet"
                >
                    <defs>
                        <linearGradient id="score-note-fill" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#f8fafc" stopOpacity="0.96" />
                            <stop offset="100%" stopColor="#cbd5e1" stopOpacity="0.9" />
                        </linearGradient>
                    </defs>

                    <rect x={0} y={0} width={totalWidth} height={380} fill="#12141b" />
                    {renderStaffLines(totalWidth)}

                    {document.measures.map((measure) => {
                        const x = measure.index * measureWidth;
                        return (
                            <g key={`measure-${measure.index}`}>
                                <rect
                                    x={x}
                                    y={18}
                                    width={measureWidth}
                                    height={334}
                                    fill={measure.confidence !== undefined
                                        ? `rgba(${measure.confidence >= 0.75 ? '52,211,242' : '245,158,11'},${measure.confidence >= 0.75 ? '0.03' : '0.06'})`
                                        : 'transparent'}
                                />
                                <line
                                    x1={x}
                                    y1={70}
                                    x2={x}
                                    y2={332}
                                    stroke="rgba(148,163,184,0.22)"
                                    strokeWidth={measure.index === 0 ? 1.5 : 1}
                                />
                                <text
                                    x={x + 14}
                                    y={40}
                                    fill="rgba(148,163,184,0.65)"
                                    fontSize={11}
                                    letterSpacing="0.22em"
                                >
                                    {measure.index + 1}
                                </text>
                                {measure.index === 0 && (
                                    <>
                                        <text
                                            x={x + 18}
                                            y={142}
                                            fill="rgba(226,232,240,0.92)"
                                            fontSize={46}
                                            fontFamily="'Noto Music','Bravura','Times New Roman',serif"
                                        >
                                            {TREBLE_CLEF}
                                        </text>
                                        <text
                                            x={x + 22}
                                            y={292}
                                            fill="rgba(226,232,240,0.92)"
                                            fontSize={42}
                                            fontFamily="'Noto Music','Bravura','Times New Roman',serif"
                                        >
                                            {BASS_CLEF}
                                        </text>
                                    </>
                                )}
                            </g>
                        );
                    })}

                    <line x1={totalWidth} y1={70} x2={totalWidth} y2={332} stroke="rgba(148,163,184,0.22)" strokeWidth={1.25} />

                    {flattenedEvents.map((event) => {
                        if (event.type === 'rest') {
                            const restX = (event.measureIndex * measureWidth) + MEASURE_LEFT_PADDING + ((event.start16th / event.measureDuration16th) * contentWidth);
                            const restY = event.hand === 'right' ? 126 : 270;
                            return (
                                <rect
                                    key={event.id}
                                    x={restX}
                                    y={restY}
                                    width={Math.max(10, (event.duration16th / event.measureDuration16th) * contentWidth * 0.55)}
                                    height={4}
                                    rx={2}
                                    fill="rgba(148,163,184,0.5)"
                                />
                            );
                        }

                        const absoluteX = (event.measureIndex * measureWidth) + MEASURE_LEFT_PADDING + ((event.start16th / event.measureDuration16th) * contentWidth);
                        const noteWidth = Math.max(12, ((event.duration16th / event.measureDuration16th) * contentWidth) - 4);
                        const noteY = pitchToScoreY(event.pitch, event.hand);
                        const isSelected = selectedNoteKey !== null && event.sourceNoteKey === selectedNoteKey;
                        const stemX = event.hand === 'right' ? absoluteX + 12 : absoluteX + 2;
                        const stemY2 = event.hand === 'right' ? noteY - 34 : noteY + 34;

                        return (
                            <g key={event.id}>
                                <ellipse
                                    data-score-interactive="true"
                                    cx={absoluteX + 10}
                                    cy={noteY}
                                    rx={10}
                                    ry={7}
                                    fill="url(#score-note-fill)"
                                    stroke={isSelected ? '#34d3f2' : 'rgba(15,23,42,0.85)'}
                                    strokeWidth={isSelected ? 2.5 : 1.5}
                                    onClick={() => {
                                        onSelectNoteKey?.(event.sourceNoteKey || null);
                                        onSeekToTimeline16th?.(event.absoluteStart16th);
                                    }}
                                    className="cursor-pointer"
                                />
                                <line
                                    x1={stemX}
                                    y1={noteY}
                                    x2={stemX}
                                    y2={stemY2}
                                    stroke="rgba(248,250,252,0.82)"
                                    strokeWidth={1.6}
                                />
                                {event.tieEnd && (
                                    <path
                                        d={`M ${absoluteX + 6} ${noteY + 12} Q ${absoluteX + (noteWidth * 0.55)} ${noteY + 22} ${absoluteX + noteWidth + 10} ${noteY + 12}`}
                                        fill="none"
                                        stroke="rgba(248,250,252,0.8)"
                                        strokeWidth={1.5}
                                    />
                                )}
                                {event.pedalDown && (
                                    <text
                                        x={absoluteX}
                                        y={342}
                                        fill="rgba(52,211,242,0.85)"
                                        fontSize={10}
                                        letterSpacing="0.18em"
                                    >
                                        PED
                                    </text>
                                )}
                            </g>
                        );
                    })}

                    <line
                        ref={playheadLineRef}
                        x1={playheadX}
                        y1={20}
                        x2={playheadX}
                        y2={352}
                        stroke="rgba(52,211,242,0.88)"
                        strokeWidth={2}
                    />
                </svg>
            </div>
        </div>
    );
};

export default React.memo(ScoreViewport);
