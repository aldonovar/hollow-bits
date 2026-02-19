
import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Track, TrackType, Clip, AutomationPoint } from '../types';
import TrackHeader from './TrackHeader';
import AutomationLane from './AutomationLane';
import { audioEngine } from '../services/audioEngine';
import { trackHeaderMeterStore } from '../services/trackHeaderMeterStore';
import type { TrackHeaderMeterSnapshot } from '../services/trackHeaderMeterStore';
import { Scissors, FileAudio, Copy, ArrowRightLeft, AlignLeft, Grid, Magnet } from 'lucide-react';
import { BROWSER_DRAG_MIME, BrowserDragPayload, parseBrowserDragPayload } from '../services/browserDragService';

interface TimelineMutationOptions {
    noHistory?: boolean;
    reason?: string;
}

interface TrackLaneProps {
    track: Track;
    trackHeight: number;
    zoom: number;
    totalWidth: number;
    isSelected: boolean;
    onSelect: (id: string) => void;
    onUpdate: (id: string, updates: Partial<Track>, options?: TimelineMutationOptions) => void;
    onClipUpdate: (trackId: string, clipId: string, updates: Partial<Clip>, options?: TimelineMutationOptions) => void;
    onDelete: (id: string) => void;
    onSeek: (bar: number) => void;
    onClipSelect?: (trackId: string, clipId: string) => void;
    onClipMouseDown: (e: React.MouseEvent, trackId: string, clip: Clip) => void;
    onContextMenu: (e: React.MouseEvent, track: Track, clip: Clip) => void;
    onExternalDrop?: (trackId: string, bar: number, payload: BrowserDragPayload) => void;
    visibleRect: { left: number, width: number };
    gridSize: number; // [NEW]
    snapToGrid: boolean;
}



const HEADER_WIDTH = 300;
const VISIBLE_RECT_SCROLL_QUANTUM = 16;
const VISIBLE_RECT_WIDTH_QUANTUM = 16;
const VISIBLE_RECT_TOP_QUANTUM = 12;
const VISIBLE_RECT_HEIGHT_QUANTUM = 12;
const TRACK_VIRTUALIZATION_OVERSCAN_PX = 480;
const MAX_ACTIVE_METER_TRACKS = 128;
const WAVEFORM_CACHE_LIMIT = 320;
const MIDI_DECORATION_CACHE_LIMIT = 640;

interface TimelineViewportRect {
    left: number;
    width: number;
    top: number;
    height: number;
}

interface TrackLayoutRow {
    track: Track;
    top: number;
    totalHeight: number;
    automationRows: {
        lane: NonNullable<Track['automationLanes']>[number];
        height: number;
    }[];
}

interface CachedWaveformShape {
    pathData: string;
    crestPath: string;
    troughPath: string;
    centerY: number;
}

interface MidiDecorationBar {
    leftPercent: number;
    topPercent: number;
    widthPercent: number;
}

const seededRatio = (seed: number): number => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
};

type DragAction = {
    type: 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out' | 'stretch';
    clip: Clip;
    startX: number;
    startY: number;
};

const TrackLane: React.FC<TrackLaneProps> = React.memo(({
    track,
    trackHeight,
    zoom,
    totalWidth,
    isSelected,
    onSelect,
    onUpdate,
    onClipUpdate,
    onDelete,
    onSeek,
    onClipSelect,
    onClipMouseDown,
    onContextMenu,
    onExternalDrop,
    visibleRect,
    gridSize, // [NEW]
    snapToGrid
}) => {
    // Local State for Smart Tool Dragging
    const [dragAction, setDragAction] = useState<DragAction | null>(null);
    const dragPreviewRef = useRef<Partial<Clip> | null>(null);
    const waveformCacheRef = useRef<Map<string, CachedWaveformShape>>(new Map());
    const midiDecorationCacheRef = useRef<Map<string, MidiDecorationBar[]>>(new Map());

    // --- SMART TOOL LOGIC (TRIM & FADE) ---
    useEffect(() => {
        if (!dragAction) return;

        const handleGlobalMove = (e: MouseEvent) => {
            const dx = e.clientX - dragAction.startX;
            const deltaBars = dx / zoom / 4;
            const { clip } = dragAction;

            let updates: Partial<Clip> = {};

            if (dragAction.type === 'trim-left') {
                // Constraint: Length >= 0.0625 (1/16th) AND Start >= 0
                const maxDelta = clip.length - 0.0625;
                let actualDelta = Math.min(deltaBars, maxDelta);

                // Prevent negative start
                if (clip.start + actualDelta < 0) {
                    actualDelta = -clip.start;
                }

                updates = {
                    start: clip.start + actualDelta,
                    length: clip.length - actualDelta,
                    offset: (clip.offset || 0) + actualDelta
                };
            } else if (dragAction.type === 'trim-right') {
                const newLength = Math.max(0.0625, clip.length + deltaBars);
                updates = { length: newLength };
            } else if (dragAction.type === 'stretch') {
                const newLength = Math.max(0.0625, clip.length + deltaBars);
                // initialRate * (initialLength / newLength)
                // If I stretch 1 bar to 2 bars (newLength > length), speed should be 0.5 (Slower)
                const ratio = clip.length / newLength;
                const newRate = (clip.playbackRate || 1) * ratio;

                updates = {
                    length: newLength,
                    playbackRate: newRate
                };
            } else if (dragAction.type === 'fade-in') {
                // Dragging right -> Increase fade
                const newFadeIn = Math.max(0, Math.min(clip.length, (clip.fadeIn || 0) + deltaBars));
                updates = { fadeIn: newFadeIn };
            } else if (dragAction.type === 'fade-out') {
                // Dragging LEFT -> Increase fade (delta is negative when moving left)
                // Start X is at right edge. 
                const newFadeOut = Math.max(0, Math.min(clip.length, (clip.fadeOut || 0) - deltaBars));
                updates = { fadeOut: newFadeOut };
            }

            if (Object.keys(updates).length > 0) {
                dragPreviewRef.current = updates;
                onClipUpdate(track.id, clip.id, updates, {
                    noHistory: true,
                    reason: 'timeline-clip-gesture-preview'
                });
            }
        };

        const handleGlobalUp = () => {
            const updates = dragPreviewRef.current;
            if (updates) {
                const reasonByType: Record<DragAction['type'], string> = {
                    'trim-left': 'timeline-clip-trim-left',
                    'trim-right': 'timeline-clip-trim-right',
                    'fade-in': 'timeline-clip-fade-in',
                    'fade-out': 'timeline-clip-fade-out',
                    stretch: 'timeline-clip-stretch'
                };

                onClipUpdate(track.id, dragAction.clip.id, updates, {
                    reason: reasonByType[dragAction.type]
                });
            }

            dragPreviewRef.current = null;
            setDragAction(null);
        };

        window.addEventListener('mousemove', handleGlobalMove);
        window.addEventListener('mouseup', handleGlobalUp);
        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
        };
    }, [dragAction, onClipUpdate, track.id, zoom]);

    // Smart Zoom Thresholds
    const showWaveforms = zoom > 15;
    const showDetailGrid = zoom > 50;
    const showBeatGrid = zoom > 20;

    const getWaveformPath = (clip: Clip, width: number, height: number) => {
        const buffer = clip.buffer;
        if (!buffer) return null;

        const widthBucket = Math.max(64, Math.round(width / 24) * 24);
        const heightBucket = Math.max(24, Math.round(height / 6) * 6);
        const zoomBucket = zoom < 35 ? 1 : zoom < 90 ? 2 : 3;
        const cacheKey = `${clip.id}:${buffer.length}:${buffer.sampleRate}:${widthBucket}:${heightBucket}:${zoomBucket}`;

        let cached = waveformCacheRef.current.get(cacheKey);

        if (!cached) {
            // LOD Optimization: increase density for clearer transients/highs-lows.
            const quality = zoom < 35 ? 1.0 : zoom < 90 ? 1.4 : 1.9;
            const maxSteps = Math.max(1200, Math.floor(6000 * quality));
            const steps = Math.min(Math.max(64, Math.ceil(widthBucket * quality)), maxSteps);

            const envelope = audioEngine.getWaveformEnvelopeData(buffer, steps);
            const pointCount = Math.min(envelope.max.length, envelope.min.length);
            const centerY = heightBucket / 2;
            const amp = heightBucket * 0.92;

            if (pointCount === 0) {
                return null;
            }

            let pathData = `M 0 ${centerY}`;
            let crestPath = `M 0 ${centerY}`;
            let troughPath = `M 0 ${centerY}`;

            for (let i = 0; i < pointCount; i++) {
                const x = (i / Math.max(1, pointCount - 1)) * widthBucket;
                const yMax = centerY - (envelope.max[i] * (amp / 2));
                pathData += ` L ${x} ${yMax}`;
                crestPath += ` L ${x} ${yMax}`;
            }

            for (let i = pointCount - 1; i >= 0; i--) {
                const x = (i / Math.max(1, pointCount - 1)) * widthBucket;
                const yMin = centerY - (envelope.min[i] * (amp / 2));
                pathData += ` L ${x} ${yMin}`;
                troughPath += ` L ${x} ${yMin}`;
            }

            pathData += ' Z';

            cached = {
                pathData,
                crestPath,
                troughPath,
                centerY
            };

            waveformCacheRef.current.set(cacheKey, cached);

            if (waveformCacheRef.current.size > WAVEFORM_CACHE_LIMIT) {
                const oldestKey = waveformCacheRef.current.keys().next().value;
                if (oldestKey) {
                    waveformCacheRef.current.delete(oldestKey);
                }
            }
        }

        const scaleX = Math.max(0.0001, width / Math.max(1, widthBucket));
        const scaleY = Math.max(0.0001, height / Math.max(1, heightBucket));

        // LOD Optimization: increase density for clearer transients/highs-lows.
        return (
            <g transform={`scale(${scaleX}, ${scaleY})`}>
                <line x1="0" y1={cached.centerY} x2={widthBucket} y2={cached.centerY} stroke={track.color} strokeOpacity="0.3" strokeWidth="1" />
                <path
                    d={cached.pathData}
                    fill={track.color}
                    fillOpacity="0.72"
                    stroke={track.color}
                    strokeWidth="0.9"
                    vectorEffect="non-scaling-stroke"
                    shapeRendering="geometricPrecision"
                />
                <path
                    d={cached.crestPath}
                    fill="none"
                    stroke={track.color}
                    strokeOpacity="0.85"
                    strokeWidth="0.85"
                    vectorEffect="non-scaling-stroke"
                    shapeRendering="geometricPrecision"
                />
                <path
                    d={cached.troughPath}
                    fill="none"
                    stroke={track.color}
                    strokeOpacity="0.78"
                    strokeWidth="0.85"
                    vectorEffect="non-scaling-stroke"
                    shapeRendering="geometricPrecision"
                />
            </g>
        );
    };

    const getMidiDecorationBars = (clip: Clip): MidiDecorationBar[] => {
        const count = Math.max(1, Math.min(30, Math.round(clip.length * 4)));
        const widthBucket = Math.max(1, Math.round((clip.length * zoom) / 24));
        const cacheKey = `${clip.id}:${count}:${widthBucket}`;
        const cached = midiDecorationCacheRef.current.get(cacheKey);
        if (cached) return cached;

        const seedBase = clip.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const bars: MidiDecorationBar[] = [];

        for (let i = 0; i < count; i++) {
            const leftPercent = (i / count) * 100;
            const topPercent = 28 + (seededRatio(seedBase + i * 17.13) * 44);
            const widthPercent = 5 + (seededRatio(seedBase + i * 29.71) * 10);
            bars.push({ leftPercent, topPercent, widthPercent });
        }

        midiDecorationCacheRef.current.set(cacheKey, bars);
        if (midiDecorationCacheRef.current.size > MIDI_DECORATION_CACHE_LIMIT) {
            const oldestKey = midiDecorationCacheRef.current.keys().next().value;
            if (oldestKey) {
                midiDecorationCacheRef.current.delete(oldestKey);
            }
        }

        return bars;
    };

    const handleLaneClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const bar = (x / zoom / 4) + 1;
        onSeek(bar);
        onSelect(track.id);
    };

    const handleLaneDrop = (event: React.DragEvent<HTMLDivElement>) => {
        if (!onExternalDrop) return;

        event.preventDefault();

        const payload = parseBrowserDragPayload(event.dataTransfer.getData(BROWSER_DRAG_MIME));
        if (!payload) return;

        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;

        let bar = (x / zoom / 4) + 1;
        if (snapToGrid) {
            bar = Math.max(1, Math.round(bar / gridSize) * gridSize);
        } else {
            bar = Math.max(1, bar);
        }

        onExternalDrop(track.id, bar, payload);
        onSelect(track.id);
    };

    // SMART GRID GENERATION
    // SMART GRID GENERATION
    const gridStyle = useMemo(() => {
        const barWidth = zoom * 4;
        const barColor = 'rgba(255,255,255,0.08)';

        // Helper for triplet check (if denominator is roughly multiple of 3)
        // 1/3 ~ 0.333, 1/6 ~ 0.166, 1/12 ~ 0.083
        const isTriplet = Math.abs((gridSize * 3) - Math.round(gridSize * 3)) < 0.001 ||
            Math.abs((gridSize * 6) - Math.round(gridSize * 6)) < 0.001;

        // Hint purple for triplets to distinct visually if Triplet enabled
        const beatColor = isTriplet ? 'rgba(180, 160, 255, 0.05)' : 'rgba(255,255,255,0.03)';
        const subColor = isTriplet ? 'rgba(180, 160, 255, 0.02)' : 'rgba(255,255,255,0.015)';

        let bgImage = `linear-gradient(90deg, ${barColor} 1px, transparent 1px)`; // Always show bars

        if (showBeatGrid) {
            // Add beats
            const beatWidth = zoom;
            bgImage += `, linear-gradient(90deg, 
              transparent, 
              transparent ${beatWidth}px, ${beatColor} ${beatWidth}px, ${beatColor} ${beatWidth + 1}px, transparent ${beatWidth + 1}px,
              transparent ${beatWidth * 2}px, ${beatColor} ${beatWidth * 2}px, ${beatColor} ${beatWidth * 2 + 1}px, transparent ${beatWidth * 2 + 1}px,
              transparent ${beatWidth * 3}px, ${beatColor} ${beatWidth * 3}px, ${beatColor} ${beatWidth * 3 + 1}px, transparent ${beatWidth * 3 + 1}px
          )`;
        }

        if (showDetailGrid) {
            // Standard 16th note visual fallback for now to ensure stability
            // If triplet, we ideally want to show 3 lines per beat, but CSS gradients for 33.333% are tricky without advanced logic
            // For now we keep the 4 grid lines visual but the snapping will work for triplets

            const q = zoom / 4;
            bgImage += `, linear-gradient(90deg, 
              transparent,
              transparent ${q}px, ${subColor} ${q}px, transparent ${q + 1}px,
              transparent ${q * 2}px, ${subColor} ${q * 2}px, transparent ${q * 2 + 1}px,
              transparent ${q * 3}px, ${subColor} ${q * 3}px, transparent ${q * 3 + 1}px
          )`;
        }

        return {
            width: totalWidth,
            minWidth: totalWidth,
            backgroundImage: bgImage,
            backgroundSize: `${barWidth}px 100%`
        };
    }, [zoom, totalWidth, showBeatGrid, showDetailGrid, gridSize]);

    const crossfades = useMemo(() => {
        const fades = [];
        const sortedClips = [...track.clips].sort((a, b) => a.start - b.start);

        for (let i = 0; i < sortedClips.length - 1; i++) {
            const current = sortedClips[i];
            const next = sortedClips[i + 1];

            const currentEnd = current.start + current.length;

            if (currentEnd > next.start) {
                const overlapStart = next.start;
                const overlapEnd = Math.min(currentEnd, next.start + next.length);
                const overlapLen = overlapEnd - overlapStart;

                if (overlapLen > 0) {
                    const leftPx = (overlapStart - 1) * 4 * zoom;
                    const widthPx = overlapLen * 4 * zoom;

                    fades.push({
                        id: `xfade-${current.id}-${next.id}`,
                        left: leftPx,
                        width: widthPx
                    });
                }
            }
        }
        return fades;
    }, [track.clips, zoom]);

    // VIRTUALIZATION FILTER
    const visibleClips = useMemo(() => {
        const bufferPx = 500; // Render extra pixels to prevent flickering
        const startPx = Math.max(0, visibleRect.left - bufferPx);
        const endPx = visibleRect.left + visibleRect.width + bufferPx;

        return track.clips.filter(clip => {
            const clipStartPx = (clip.start - 1) * 4 * zoom;
            const clipWidthPx = clip.length * 4 * zoom;
            const clipEndPx = clipStartPx + clipWidthPx;

            // Check Intersection
            return clipEndPx > startPx && clipStartPx < endPx;
        });
    }, [track.clips, visibleRect, zoom]);

    return (
        <div
            className="flex bg-[#121212] border-b border-daw-border"
            style={{ height: trackHeight, width: totalWidth + HEADER_WIDTH }}
        >
            {/* Sticky Track Header - High Z-index to cover scrolling content */}
            <div
                className="shrink-0 sticky left-0 z-[100] bg-[#121212] border-r border-daw-border shadow-[4px_0_15px_-4px_rgba(0,0,0,0.8)]"
                style={{ width: HEADER_WIDTH }}
            >
                <TrackHeader
                    track={track}
                    height={trackHeight}
                    isSelected={isSelected}
                    onSelect={() => onSelect(track.id)}
                    onUpdate={(u) => onUpdate(track.id, u)}
                    onDelete={() => onDelete(track.id)}
                />
            </div>

            {/* Timeline Lane Content - Lower Z-index */}
            <div
                className={`relative z-10 group transition-colors duration-150 ${isSelected ? 'bg-[#181818]' : 'bg-[#0e0e0e]'}`}
                onClick={handleLaneClick}
                onDragOver={(event) => {
                    if (!onExternalDrop) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={handleLaneDrop}
                style={gridStyle}
            >
                {/* CLIPS (VIRTUALIZED) */}
                {visibleClips.map(clip => {
                    const widthPx = clip.length * 4 * zoom;
                    const showClipName = widthPx > 30; // LOD: Hide text if too small
                    const showHandles = widthPx > 50; // Only show handles if clip is wide enough
                    const EDGE_WIDTH = 8; // Trim handle hit zone width

                    return (
                        <div
                            key={clip.id}
                            className="absolute top-0 bottom-0 overflow-visible cursor-grab active:cursor-grabbing transition-shadow z-20 group/clip hover:shadow-lg rounded-[2px]"
                            onMouseDown={(e) => {
                                // Don't start drag if clicking on handles
                                const target = e.target as HTMLElement;
                                if (target.dataset.handleType) return;
                                onClipMouseDown(e, track.id, clip);
                                onClipSelect?.(track.id, clip.id);
                            }}
                            onContextMenu={(e) => {
                                onClipSelect?.(track.id, clip.id);
                                onContextMenu(e, track, clip);
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(track.id);
                                onClipSelect?.(track.id, clip.id);
                            }}
                            style={{
                                left: `${(clip.start - 1) * 4 * zoom}px`,
                                width: `${widthPx}px`,
                                backgroundColor: showWaveforms ? 'rgba(255, 255, 255, 0.04)' : `${track.color}20`,
                                borderLeft: `2px solid ${track.color}`,
                                borderRight: `1px solid ${track.color}40`
                            }}
                        >
                            {/* === LEFT TRIM HANDLE === */}
                            {showHandles && (
                                <div
                                    data-handle-type="trim-left"
                                    className="absolute left-0 top-0 bottom-0 cursor-ew-resize z-40 opacity-0 group-hover/clip:opacity-100 transition-opacity"
                                    style={{ width: EDGE_WIDTH }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragAction({
                                            type: 'trim-left',
                                            clip,
                                            startX: e.clientX,
                                            startY: e.clientY
                                        });
                                    }}
                                >
                                    <div
                                        className="absolute inset-y-0 left-0 w-1 transition-colors"
                                        style={{ backgroundColor: `${track.color}CC` }}
                                    />
                                    {/* Offset/Start Tooltip could go here */}
                                </div>
                            )}

                            {/* === RIGHT TRIM HANDLE === */}
                            {showHandles && (
                                <div
                                    data-handle-type="trim-right"
                                    className="absolute right-0 top-0 bottom-0 cursor-ew-resize z-40 opacity-0 group-hover/clip:opacity-100 transition-opacity"
                                    style={{ width: EDGE_WIDTH }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragAction({
                                            type: e.altKey ? 'stretch' : 'trim-right',
                                            clip,
                                            startX: e.clientX,
                                            startY: e.clientY
                                        });
                                    }}
                                >
                                    <div
                                        className="absolute inset-y-0 right-0 w-1 transition-colors"
                                        style={{ backgroundColor: `${track.color}CC` }}
                                    />
                                </div>
                            )}

                            {/* === FADE IN HANDLE (Top Left Corner) === */}
                            {showHandles && (
                                <div
                                    data-handle-type="fade-in"
                                    className="absolute left-0 top-0 w-4 h-4 cursor-crosshair z-50 opacity-0 group-hover/clip:opacity-100 transition-opacity flex items-center justify-center"
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragAction({
                                            type: 'fade-in',
                                            clip,
                                            startX: e.clientX,
                                            startY: e.clientY
                                        });
                                    }}
                                >
                                    <div
                                        className="w-2 h-2 rounded-full border-2 bg-black/50 backdrop-blur-sm shadow-lg hover:scale-125 transition-transform"
                                        style={{ borderColor: track.color }}
                                    />
                                    {/* Visual Viz of Fade Line */}
                                    {dragAction?.type === 'fade-in' && dragAction.clip.id === clip.id && (
                                        <div className="absolute top-0 left-0 border-l border-t border-white/50 w-full h-full pointer-events-none opacity-50" />
                                    )}
                                </div>
                            )}

                            {/* === FADE OUT HANDLE (Top Right Corner) === */}
                            {showHandles && (
                                <div
                                    data-handle-type="fade-out"
                                    className="absolute right-0 top-0 w-4 h-4 cursor-crosshair z-50 opacity-0 group-hover/clip:opacity-100 transition-opacity flex items-center justify-center"
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        setDragAction({
                                            type: 'fade-out',
                                            clip,
                                            startX: e.clientX,
                                            startY: e.clientY
                                        });
                                    }}
                                >
                                    <div
                                        className="w-2 h-2 rounded-full border-2 bg-black/50 backdrop-blur-sm shadow-lg hover:scale-125 transition-transform"
                                        style={{ borderColor: track.color }}
                                    />
                                </div>
                            )}

                            {/* Clip Name Overlay */}
                            {showClipName && (
                                <div className="absolute top-0 left-0 right-0 h-4 z-30 pointer-events-none opacity-80 group-hover/clip:opacity-100 transition-opacity bg-gradient-to-b from-black/60 to-transparent">
                                    <div className="flex items-center px-1">
                                        <span
                                            className="text-[9px] font-bold text-gray-100 uppercase tracking-wide truncate"
                                            style={{ color: track.color }}
                                        >
                                            {clip.name}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Waveform / MIDI Viz - Conditional Rendering based on Zoom */}
                            {showWaveforms && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none top-2">
                                    {track.type === TrackType.AUDIO && clip.buffer ? (
                                        <div className="w-full h-full opacity-90">
                                            <svg
                                                width="100%"
                                                height="100%"
                                                preserveAspectRatio="none"
                                                className="w-full h-full overflow-visible"
                                            >
                                                {getWaveformPath(clip, clip.length * 4 * zoom, trackHeight)}
                                            </svg>
                                        </div>
                                    ) : track.type === TrackType.MIDI ? (
                                        <div className="w-full h-full relative opacity-80">
                                            {getMidiDecorationBars(clip).map((bar, i) => (
                                                <div
                                                    key={i}
                                                    className="absolute h-[3px] rounded-full"
                                                    style={{
                                                        backgroundColor: track.color,
                                                        left: `${bar.leftPercent}%`,
                                                        top: `${bar.topPercent}%`,
                                                        width: `${bar.widthPercent}%`
                                                    }}
                                                ></div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            <div className="absolute inset-0 border border-transparent group-hover/clip:border-white/10 transition-colors pointer-events-none"></div>
                        </div>
                    );
                })}

                {/* AUTOMATIC CROSSFADE OVERLAYS */}
                {crossfades.map(xfade => (
                    <div
                        key={xfade.id}
                        className="absolute top-0 bottom-0 z-30 pointer-events-none"
                        style={{
                            left: `${xfade.left}px`,
                            width: `${xfade.width}px`,
                            background: 'linear-gradient(to right, rgba(0,0,0,0), rgba(255,255,255,0.05), rgba(0,0,0,0))'
                        }}
                    >
                        <svg width="100%" height="100%" preserveAspectRatio="none" className="overflow-visible">
                            <path
                                d={`M 0 0 C ${xfade.width * 0.5} 0, ${xfade.width * 0.5} ${trackHeight}, ${xfade.width} ${trackHeight}`}
                                fill="none"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeOpacity="0.8"
                                vectorEffect="non-scaling-stroke"
                            />
                            <path
                                d={`M 0 ${trackHeight} C ${xfade.width * 0.5} ${trackHeight}, ${xfade.width * 0.5} 0, ${xfade.width} 0`}
                                fill="none"
                                stroke="white"
                                strokeWidth="1.5"
                                strokeOpacity="0.8"
                                vectorEffect="non-scaling-stroke"
                            />
                        </svg>
                    </div>
                ))}
            </div>
        </div>
    );
}, (prev, next) => {
    return (
        prev.track === next.track &&
        prev.trackHeight === next.trackHeight &&
        prev.zoom === next.zoom &&
        prev.isSelected === next.isSelected &&
        prev.totalWidth === next.totalWidth &&
        // We only re-render if visibleRect changes significantly (e.g. > 100px) OR if it affects visibility count.
        // Actually, for smoothness, we just let it pass visibleRect updates. 
        // React.memo on objects (visibleRect) is by ref.
        prev.visibleRect.left === next.visibleRect.left &&
        prev.visibleRect.width === next.visibleRect.width &&
        prev.gridSize === next.gridSize &&
        prev.snapToGrid === next.snapToGrid
    );
});


// --- Main Timeline Component ---

interface TimelineProps {
    tracks: Track[];
    bars: number;
    zoom: number;
    trackHeight: number;
    bpm: number;
    isPlaying: boolean;
    onSeek: (bar: number) => void;
    onTrackSelect: (id: string) => void;
    onTrackUpdate: (id: string, updates: Partial<Track>, options?: TimelineMutationOptions) => void;
    onTrackDelete: (id: string) => void;
    onClipSelect?: (trackId: string, clipId: string) => void;
    onClipUpdate: (trackId: string, clipId: string, updates: Partial<Clip>, options?: TimelineMutationOptions) => void;
    onConsolidate: (track: Track, clips: Clip[]) => void;
    onReverse: (track: Track, clip: Clip) => void;
    onQuantize: (track: Track, clip: Clip) => void;
    onGridChange: (size: number, enabled: boolean) => void;
    onExternalDrop?: (trackId: string, bar: number, payload: BrowserDragPayload) => void;
    onSplitClip?: (track: Track, clip: Clip) => void;
    onDuplicateClip?: (track: Track, clip: Clip) => void;
    onAddTrack?: (type?: TrackType) => void; // [UPDATED]
    onTimeUpdate?: (bar: number, beat: number, sixteenth: number) => void; // [NEW] Synced with playhead RAF
    gridSize: number;
    snapToGrid: boolean;
    selectedTrackId: string | null;
    containerRef: React.RefObject<HTMLDivElement | null>;
}

const Timeline: React.FC<TimelineProps> = React.memo(({
    tracks,
    bars,
    zoom,
    trackHeight,
    bpm,
    isPlaying,
    onSeek,
    onTrackSelect,
    onTrackUpdate,
    onTrackDelete,
    onClipSelect,
    onClipUpdate,
    onConsolidate,
    onReverse,
    onQuantize,
    onGridChange,
    onExternalDrop,
    onSplitClip,
    onDuplicateClip,
    onAddTrack,
    onTimeUpdate, // [NEW] Sync transport with playhead
    gridSize,
    snapToGrid,
    selectedTrackId,
    containerRef
}) => {
    const totalBeats = bars * 4;
    const totalGridWidth = totalBeats * zoom;
    const totalLayoutWidth = totalGridWidth + HEADER_WIDTH;

    const cursorRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);

    // [NEW] Virtualization State
    const [visibleRect, setVisibleRect] = useState<TimelineViewportRect>(() => ({
        left: 0,
        width: typeof window !== 'undefined' ? window.innerWidth : 1280,
        top: 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 720
    }));

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let animationFrameId = 0;
        let hasPendingCommit = false;

        const commitVisibleRect = () => {
            hasPendingCommit = false;
            const left = Math.max(0, Math.round(container.scrollLeft / VISIBLE_RECT_SCROLL_QUANTUM) * VISIBLE_RECT_SCROLL_QUANTUM);
            const width = Math.max(1, Math.round(container.clientWidth / VISIBLE_RECT_WIDTH_QUANTUM) * VISIBLE_RECT_WIDTH_QUANTUM);
            const top = Math.max(0, Math.round(container.scrollTop / VISIBLE_RECT_TOP_QUANTUM) * VISIBLE_RECT_TOP_QUANTUM);
            const height = Math.max(1, Math.round(container.clientHeight / VISIBLE_RECT_HEIGHT_QUANTUM) * VISIBLE_RECT_HEIGHT_QUANTUM);
            setVisibleRect((prev) => {
                if (prev.left === left && prev.width === width && prev.top === top && prev.height === height) {
                    return prev;
                }

                return { left, width, top, height };
            });
        };

        const scheduleCommit = () => {
            if (hasPendingCommit) return;
            hasPendingCommit = true;
            animationFrameId = requestAnimationFrame(commitVisibleRect);
        };

        const handleScroll = () => {
            scheduleCommit();
        };

        // Initial Read
        scheduleCommit();

        container.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll);

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            container.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [containerRef]);

    const horizontalVisibleRect = useMemo(
        () => ({ left: visibleRect.left, width: visibleRect.width }),
        [visibleRect.left, visibleRect.width]
    );

    const trackRows = useMemo<TrackLayoutRow[]>(() => {
        let nextTop = 0;

        return tracks.map((track) => {
            const automationRows = (track.automationLanes || []).map((lane) => ({
                lane,
                height: lane.isExpanded ? 60 : 24
            }));

            const totalHeight = trackHeight + automationRows.reduce((sum, row) => sum + row.height, 0);

            const row: TrackLayoutRow = {
                track,
                top: nextTop,
                totalHeight,
                automationRows
            };

            nextTop += totalHeight;
            return row;
        });
    }, [tracks, trackHeight]);

    const totalTracksHeight = useMemo(
        () => trackRows.reduce((max, row) => Math.max(max, row.top + row.totalHeight), 0),
        [trackRows]
    );
    const totalTimelineHeight = totalTracksHeight + trackHeight;

    const visibleTrackRows = useMemo(() => {
        const start = Math.max(0, visibleRect.top - TRACK_VIRTUALIZATION_OVERSCAN_PX);
        const end = visibleRect.top + visibleRect.height + TRACK_VIRTUALIZATION_OVERSCAN_PX;

        return trackRows.filter((row) => {
            const rowBottom = row.top + row.totalHeight;
            return rowBottom > start && row.top < end;
        });
    }, [trackRows, visibleRect.top, visibleRect.height]);

    const trackTopById = useMemo(() => {
        const index = new Map<string, number>();
        trackRows.forEach((row) => {
            index.set(row.track.id, row.top);
        });
        return index;
    }, [trackRows]);

    const allTrackIds = useMemo(() => trackRows.map((row) => row.track.id), [trackRows]);
    const visibleTrackIds = useMemo(() => visibleTrackRows.map((row) => row.track.id), [visibleTrackRows]);

    const activeMeterTrackIds = useMemo(() => {
        const ids = [...visibleTrackIds].slice(0, MAX_ACTIVE_METER_TRACKS);

        if (selectedTrackId && !ids.includes(selectedTrackId)) {
            if (ids.length >= MAX_ACTIVE_METER_TRACKS) {
                ids[ids.length - 1] = selectedTrackId;
            } else {
                ids.push(selectedTrackId);
            }
        }

        if (ids.length > 0) {
            return ids;
        }

        return allTrackIds.slice(0, Math.min(12, allTrackIds.length));
    }, [allTrackIds, selectedTrackId, visibleTrackIds]);

    const activeMeterTrackIdsKey = useMemo(() => activeMeterTrackIds.join('|'), [activeMeterTrackIds]);
    const allTrackIdsKey = useMemo(() => allTrackIds.join('|'), [allTrackIds]);
    const clipHoldUntilRef = useRef<Map<string, number>>(new Map());

    useEffect(() => {
        const validTrackIds = new Set(allTrackIds);
        trackHeaderMeterStore.prune(validTrackIds);

        if (activeMeterTrackIds.length === 0) {
            return;
        }

        let rafId = 0;
        let lastFrameTime = 0;

        const updateMeters = (timestamp: number) => {
            const trackLoad = activeMeterTrackIds.length;
            const playingFps = trackLoad > 96 ? 12 : trackLoad > 48 ? 18 : 24;
            const idleFps = trackLoad > 96 ? 5 : 8;
            const minFrameDelta = audioEngine.getIsPlaying() ? (1000 / playingFps) : (1000 / idleFps);
            if ((timestamp - lastFrameTime) >= minFrameDelta) {
                lastFrameTime = timestamp;
                const meterSnapshot = audioEngine.getMeterSnapshot(activeMeterTrackIds);
                const holdNow = performance.now();
                const nextBatch: Record<string, TrackHeaderMeterSnapshot> = {};

                activeMeterTrackIds.forEach((trackId) => {
                    const meter = meterSnapshot.tracks[trackId] || { rmsDb: -72, peakDb: -72 };
                    const prevHold = clipHoldUntilRef.current.get(trackId) || 0;
                    const nextHold = meter.peakDb >= -0.3 ? holdNow + 1000 : prevHold;

                    if (nextHold > holdNow) {
                        clipHoldUntilRef.current.set(trackId, nextHold);
                    } else {
                        clipHoldUntilRef.current.delete(trackId);
                    }

                    nextBatch[trackId] = {
                        rmsDb: meter.rmsDb,
                        peakDb: meter.peakDb,
                        clipped: nextHold > holdNow
                    };
                });

                trackHeaderMeterStore.publishBatch(nextBatch);
            }

            rafId = requestAnimationFrame(updateMeters);
        };

        rafId = requestAnimationFrame(updateMeters);
        return () => {
            cancelAnimationFrame(rafId);
        };
    }, [activeMeterTrackIds, activeMeterTrackIdsKey, allTrackIds, allTrackIdsKey]);

    // Drag State with Ghost Preview
    const [dragging, setDragging] = useState<{
        clipId: string;
        trackId: string;
        startX: number;
        originalStartBar: number;
        clip: Clip | null; // Reference to the clip being dragged
    } | null>(null);
    const dragStartPreviewRef = useRef<number | null>(null);

    // Ghost Snapping Preview State
    const [ghostPosition, setGhostPosition] = useState<{
        bar: number;
        trackId: string;
        clipLength: number;
    } | null>(null);

    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: Track, clip: Clip } | null>(null);

    // --- GRID OPTIONS ---
    const GRID_OPTIONS = [
        { value: 1, label: "1 Compás" },
        { value: 0.5, label: "1/2 Nota" },
        { value: 0.25, label: "1/4 Nota" },
        { value: 0.125, label: "1/8 Nota" },
        { value: 0.0625, label: "1/16 Nota" },
        { value: 0.03125, label: "1/32 Nota" },
        // Triplets
        { value: 1 / 3, label: "1/2T (Tresillo)" },
        { value: 1 / 6, label: "1/4T (Tresillo)" },
        { value: 1 / 12, label: "1/8T (Tresillo)" },
    ];

    // Smart Ruler Labels
    const getRulerStride = (z: number) => {
        if (z < 10) return 4;
        if (z < 25) return 2;
        return 1;
    };
    const rulerStride = getRulerStride(zoom);

    useEffect(() => {
        let animationFrameId: number;
        let lastFrameTime = 0;
        let lastBar = 0, lastBeat = 0, lastSixteenth = 0; // Throttle state updates

        const updateCursor = (timestamp: number) => {
            const minFrameDelta = isPlaying ? (1000 / 60) : (1000 / 10);
            if (timestamp - lastFrameTime < minFrameDelta) {
                animationFrameId = requestAnimationFrame(updateCursor);
                return;
            }
            lastFrameTime = timestamp;

            const currentSeconds = audioEngine.getCurrentTime();
            const secondsPerBeat = 60 / bpm;
            const totalBeatsElapsed = currentSeconds / secondsPerBeat;
            const px = totalBeatsElapsed * zoom;

            // Update visual playhead elements (DOM direct manipulation for performance)
            if (cursorRef.current) {
                cursorRef.current.style.transform = `translate3d(${px}px, 0, 0)`;
            }
            if (playheadRef.current) {
                // Both use same px value - marginLeft handles the -5 offset for centering
                playheadRef.current.style.transform = `translate3d(${px}px, 0, 0)`;
            }

            // Calculate transport position from SAME time value (ensures sync)
            const bar = Math.floor(totalBeatsElapsed / 4) + 1;
            const beat = Math.floor(totalBeatsElapsed % 4) + 1;
            const sixteenth = Math.floor((totalBeatsElapsed % 1) * 4) + 1;

            // Only call callback if changed (throttle React re-renders)
            if (onTimeUpdate && (bar !== lastBar || beat !== lastBeat || sixteenth !== lastSixteenth)) {
                lastBar = bar;
                lastBeat = beat;
                lastSixteenth = sixteenth;
                onTimeUpdate(bar, beat, sixteenth);
            }

            animationFrameId = requestAnimationFrame(updateCursor);
        };

        animationFrameId = requestAnimationFrame(updateCursor);

        // Close context menu on click elsewhere
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);

        return () => {
            cancelAnimationFrame(animationFrameId);
            window.removeEventListener('click', closeMenu);
        };
    }, [bpm, isPlaying, zoom, onTimeUpdate]);

    // Global Drag Events with Ghost Preview
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!dragging || !dragging.clip) return;

            const deltaPx = e.clientX - dragging.startX;
            const pixelsPerBar = zoom * 4;
            const deltaBars = deltaPx / pixelsPerBar;

            let newStart = dragging.originalStartBar + deltaBars;

            // DYNAMIC SNAPPING LOGIC
            if (snapToGrid) {
                newStart = Math.max(1, Math.round(newStart / gridSize) * gridSize);
            } else {
                newStart = Math.max(1, newStart);
            }

            // Update Ghost Preview Position
            setGhostPosition({
                bar: newStart,
                trackId: dragging.trackId,
                clipLength: dragging.clip.length
            });

            dragStartPreviewRef.current = newStart;
            onClipUpdate(dragging.trackId, dragging.clipId, { start: newStart }, {
                noHistory: true,
                reason: 'timeline-drag-clip-preview'
            });
        };

        const handleMouseUp = () => {
            if (dragging && dragStartPreviewRef.current !== null) {
                onClipUpdate(dragging.trackId, dragging.clipId, { start: dragStartPreviewRef.current }, {
                    reason: 'timeline-drag-clip'
                });
            }

            dragStartPreviewRef.current = null;
            setDragging(null);
            setGhostPosition(null); // Clear ghost on drop
            document.body.style.cursor = 'default';
        };

        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            document.body.style.cursor = 'grabbing';
        }

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [dragging, zoom, onClipUpdate, gridSize, snapToGrid]);

    const handleClipMouseDown = (e: React.MouseEvent, trackId: string, clip: Clip) => {
        e.stopPropagation();
        if (e.button === 2) return; // Ignore right click for drag start

        setDragging({
            clipId: clip.id,
            trackId: trackId,
            startX: e.clientX,
            originalStartBar: clip.start,
            clip: clip // Reference for ghost preview
        });

        // Initialize ghost preview
        setGhostPosition({
            bar: clip.start,
            trackId: trackId,
            clipLength: clip.length
        });
        dragStartPreviewRef.current = clip.start;

        onTrackSelect(trackId);
    };

    const handleContextMenu = (e: React.MouseEvent, track: Track, clip: Clip) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            track,
            clip
        });
    };

    const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const beats = clickX / zoom;
        const clickedBar = (beats / 4) + 1;
        onSeek(clickedBar);
    };

    // Grid Menu State
    const [isGridMenuOpen, setIsGridMenuOpen] = useState(false); // [NEW]

    return (
        <div className="flex flex-col min-w-max" style={{ minWidth: totalLayoutWidth, width: totalLayoutWidth }} onClick={() => setIsGridMenuOpen(false)}>

            {/* Ruler Row & Editing Toolbar - High Z-Index to stay above everything */}
            <div className="flex h-8 z-[110] sticky top-0 min-w-max bg-transparent" style={{ minWidth: totalLayoutWidth }}>
                {/* Controls Area (Above Track Headers) - Highest Z to cover ruler when scrolling */}
                <div
                    className="shrink-0 bg-[#0a0a0a]/90 backdrop-blur-md border-b border-white/5 border-r z-[130] sticky left-0 flex items-center px-4 justify-between"
                    style={{ width: HEADER_WIDTH }}
                >
                    <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">ARREGLO</span>

                    {/* GRID CONTROLS */}
                    <div className="flex items-center gap-2">
                        {/* Magnet Button - Rubí (Snapping/Force) */}
                        <button
                            onClick={(e) => { e.stopPropagation(); onGridChange(gridSize, !snapToGrid); }}
                            className={`flex items-center justify-center w-6 h-6 rounded-md transition-all duration-300 ${snapToGrid
                                ? 'text-daw-ruby bg-daw-ruby/10 ring-1 ring-daw-ruby/30 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                                }`}
                            title={`Snap: ${snapToGrid ? 'On' : 'Off'} (J)`}
                        >
                            <Magnet size={13} className={snapToGrid ? "brightness-125" : ""} />
                        </button>

                        {/* Grid Dropdown - Lila (Violet) - Main UI Brand Color */}
                        <div className="relative">
                            <button
                                onClick={(e) => { e.stopPropagation(); setIsGridMenuOpen(!isGridMenuOpen); }}
                                className={`flex items-center gap-2 px-2 h-6 rounded-md border transition-all duration-200 group ${isGridMenuOpen
                                    ? 'bg-white/10 border-white/10 text-white'
                                    : 'bg-transparent border-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
                                    }`}
                            >
                                <Grid size={12} className={`transition-colors ${isGridMenuOpen ? 'text-daw-violet' : 'text-zinc-500 group-hover:text-zinc-400'}`} />
                                <span className={isGridMenuOpen ? 'text-white' : ''} style={{ fontSize: '10px', minWidth: '60px', textAlign: 'left' }}>
                                    {GRID_OPTIONS.find(o => o.value === gridSize)?.label || "Custom"}
                                </span>
                            </button>

                            {/* Custom Glass Dropdown Menu */}
                            {isGridMenuOpen && (
                                <div className="absolute top-full right-0 mt-2 w-48 bg-[#0a0a0a]/95 backdrop-blur-xl border border-white/10 rounded-lg shadow-2xl z-[200] py-1.5 animate-in fade-in zoom-in-95 duration-200 origin-top-right ring-1 ring-black/50">
                                    <div className="px-3 py-2 border-b border-white/5 mb-1 flex items-center justify-between">
                                        <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Rejilla</span>
                                        <span className="text-[9px] text-zinc-600 font-mono">1/{Math.round(1 / (gridSize * 4))}</span>
                                    </div>
                                    <div className="max-h-[300px] overflow-y-auto px-1 space-y-0.5 custom-scrollbar">
                                        {GRID_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => { onGridChange(opt.value, true); setIsGridMenuOpen(false); }}
                                                className={`w-full text-left px-3 py-1.5 text-[11px] rounded-[4px] flex items-center justify-between transition-all ${gridSize === opt.value
                                                    ? 'text-daw-violet bg-daw-violet/10'
                                                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5'
                                                    }`}
                                            >
                                                <span>{opt.label}</span>
                                                {gridSize === opt.value && <div className="w-1.5 h-1.5 rounded-full bg-daw-violet shadow-[0_0_6px_rgba(168,85,247,0.6)]" />}
                                            </button>
                                        ))}
                                        <div className="h-px bg-white/5 my-1 mx-2"></div>
                                        <button
                                            className="w-full text-left px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-white/5 rounded-[4px] transition-colors"
                                            onClick={() => { setIsGridMenuOpen(false); }}
                                        >
                                            Adaptativo (Auto)
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Ruler - Positioned as second flex child, scrolls with content */}
                <div
                    className="bg-daw-panel h-8 relative cursor-pointer border-b border-daw-border shrink-0 overflow-hidden"
                    style={{ width: totalGridWidth, minWidth: totalGridWidth }}
                    onClick={handleRulerClick}
                >
                    {
                        Array.from({ length: Math.ceil(bars / rulerStride) }).map((_, idx) => {
                            const i = idx * rulerStride;
                            return (
                                <div key={i} className="absolute top-0 bottom-0 border-l border-gray-600 pl-1 select-none pointer-events-none group" style={{ left: `${i * 4 * zoom}px` }}>
                                    <span className="text-[10px] text-gray-400 font-sans font-medium group-hover:text-white transition-colors">{i + 1}</span>
                                </div>
                            );
                        })
                    }
                </div>
            </div>

            {/* Track Rows Container */}
            <div
                className="relative bg-[#121212]"
                style={{
                    width: totalLayoutWidth,
                    minWidth: totalLayoutWidth,
                    height: totalTimelineHeight
                }}
            >
                <div
                    className="absolute inset-y-0 pointer-events-none z-0"
                    style={{
                        left: HEADER_WIDTH,
                        width: totalGridWidth,
                        backgroundImage: `linear-gradient(to right, #2a2a2a 1px, transparent 1px)`, // Slightly lighter bar lines
                        backgroundSize: `${zoom * 4}px 100%`
                    }}
                >
                </div>

                {/* Playhead Triangle - NOW ALIGNED WITH CURSOR LINE */}
                <div
                    ref={playheadRef}
                    className="absolute top-0 w-[10px] h-[10px] will-change-transform pointer-events-none z-40"
                    style={{ left: 0, marginLeft: HEADER_WIDTH - 5 }}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" className="drop-shadow-sm">
                        <path d="M0 0 L10 0 L5 8 Z" fill="white" />
                    </svg>
                </div>

                <div
                    ref={cursorRef}
                    className="absolute top-0 bottom-0 w-[1px] bg-white z-30 pointer-events-none will-change-transform shadow-[0_0_4px_rgba(255,255,255,0.5)]"
                    style={{ left: 0, marginLeft: HEADER_WIDTH, height: '100%' }}
                >
                    {/* Playhead line */}
                </div>

                {
                    visibleTrackRows.map((row) => {
                        const { track } = row;

                        return (
                            <div
                                key={track.id}
                                className="absolute left-0"
                                style={{
                                    top: row.top,
                                    width: totalLayoutWidth
                                }}
                            >
                                <TrackLane
                                    track={track}
                                    trackHeight={trackHeight}
                                    zoom={zoom}
                                    totalWidth={totalGridWidth}
                                    isSelected={track.id === selectedTrackId}
                                    onSelect={onTrackSelect}
                                    onUpdate={onTrackUpdate}
                                    onClipUpdate={onClipUpdate}
                                    onDelete={onTrackDelete}
                                    onSeek={onSeek}
                                    onClipSelect={onClipSelect}
                                    onClipMouseDown={handleClipMouseDown}
                                    onContextMenu={handleContextMenu}
                                    onExternalDrop={onExternalDrop}
                                    visibleRect={horizontalVisibleRect}
                                    gridSize={gridSize}
                                    snapToGrid={snapToGrid}
                                />

                                {row.automationRows.map((automationRow) => {
                                    const lane = automationRow.lane;

                                    return (
                                        <AutomationLane
                                            key={lane.id}
                                            lane={lane}
                                            trackId={track.id}
                                            width={totalGridWidth}
                                            height={automationRow.height}
                                            zoom={zoom}
                                            bars={bars}
                                            onPointAdd={(laneId, time, value) => {
                                                const newPoint: AutomationPoint = {
                                                    id: `ap-${Date.now()}`,
                                                    time,
                                                    value,
                                                    curveType: 'linear'
                                                };
                                                const updatedLanes = track.automationLanes?.map(l =>
                                                    l.id === laneId
                                                        ? { ...l, points: [...l.points, newPoint].sort((a, b) => a.time - b.time) }
                                                        : l
                                                );
                                                onTrackUpdate(track.id, { automationLanes: updatedLanes });
                                            }}
                                            onPointMove={(laneId, pointId, time, value) => {
                                                const updatedLanes = track.automationLanes?.map(l =>
                                                    l.id === laneId
                                                        ? {
                                                            ...l,
                                                            points: l.points.map(p =>
                                                                p.id === pointId ? { ...p, time, value } : p
                                                            ).sort((a, b) => a.time - b.time)
                                                        }
                                                        : l
                                                );
                                                onTrackUpdate(track.id, { automationLanes: updatedLanes });
                                            }}
                                            onPointDelete={(laneId, pointId) => {
                                                const updatedLanes = track.automationLanes?.map(l =>
                                                    l.id === laneId
                                                        ? { ...l, points: l.points.filter(p => p.id !== pointId) }
                                                        : l
                                                );
                                                onTrackUpdate(track.id, { automationLanes: updatedLanes });
                                            }}
                                            onCurveTypeChange={(laneId, pointId, curveType) => {
                                                const updatedLanes = track.automationLanes?.map(l =>
                                                    l.id === laneId
                                                        ? {
                                                            ...l,
                                                            points: l.points.map(p =>
                                                                p.id === pointId ? { ...p, curveType } : p
                                                            )
                                                        }
                                                        : l
                                                );
                                                onTrackUpdate(track.id, { automationLanes: updatedLanes });
                                            }}
                                            onToggleExpand={(laneId) => {
                                                const updatedLanes = track.automationLanes?.map(l =>
                                                    l.id === laneId ? { ...l, isExpanded: !l.isExpanded } : l
                                                );
                                                onTrackUpdate(track.id, { automationLanes: updatedLanes });
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        );
                    })
                }

                {/* === GHOST SNAPPING PREVIEW === */}
                {ghostPosition && dragging && (
                    <div
                        className="absolute z-[60] pointer-events-none transition-all duration-75 ease-out"
                        style={{
                            left: HEADER_WIDTH + ((ghostPosition.bar - 1) * 4 * zoom),
                            width: ghostPosition.clipLength * 4 * zoom,
                            height: trackHeight,
                            top: trackTopById.get(ghostPosition.trackId) ?? 0,
                        }}
                    >
                        {/* Ghost Clip Visual */}
                        <div
                            className="w-full h-full rounded-[2px] border-2 border-dashed animate-pulse"
                            style={{
                                borderColor: dragging.clip ? tracks.find(t => t.id === dragging.trackId)?.color || '#a855f7' : '#a855f7',
                                backgroundColor: `${dragging.clip ? tracks.find(t => t.id === dragging.trackId)?.color + '15' || 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.1)'}`,
                                boxShadow: `0 0 20px ${dragging.clip ? tracks.find(t => t.id === dragging.trackId)?.color + '40' || 'rgba(168, 85, 247, 0.25)' : 'rgba(168, 85, 247, 0.25)'}`,
                            }}
                        >
                            {/* Snap Position Indicator */}
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[10px] font-bold text-white/60 uppercase tracking-wider bg-black/30 px-2 py-0.5 rounded-sm backdrop-blur-sm">
                                    BAR {ghostPosition.bar.toFixed(2)}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                <div
                    className="flex min-w-max absolute left-0"
                    style={{
                        top: totalTracksHeight,
                        height: trackHeight,
                        width: totalLayoutWidth
                    }}
                >
                    <div
                        className="shrink-0 sticky left-0 z-[100] bg-[#1a1a1a] border-r border-daw-border flex flex-col items-center justify-center opacity-60 hover:opacity-100 transition-opacity group shadow-[4px_0_15px_-4px_rgba(0,0,0,0.8)] gap-2 py-4"
                        style={{ width: HEADER_WIDTH }}
                    >
                        <div className="flex gap-2">
                            <button onClick={() => onAddTrack?.(TrackType.AUDIO)} className="text-[10px] text-gray-400 hover:text-daw-cyan hover:border-daw-cyan transition-colors font-bold uppercase tracking-wider px-3 py-1.5 rounded-[2px] border border-dashed border-gray-700">
                                + Audio
                            </button>
                            <button onClick={() => onAddTrack?.(TrackType.MIDI)} className="text-[10px] text-gray-400 hover:text-daw-orange hover:border-daw-orange transition-colors font-bold uppercase tracking-wider px-3 py-1.5 rounded-[2px] border border-dashed border-gray-700">
                                + MIDI
                            </button>
                            <button onClick={() => onAddTrack?.(TrackType.GROUP)} className="text-[10px] text-gray-400 hover:text-blue-300 hover:border-blue-300 transition-colors font-bold uppercase tracking-wider px-3 py-1.5 rounded-[2px] border border-dashed border-gray-700">
                                + Group
                            </button>
                        </div>
                        <button onClick={() => onAddTrack?.(TrackType.RETURN)} className="text-[9px] text-gray-500 hover:text-daw-violet hover:border-daw-violet transition-colors font-bold uppercase tracking-wider px-8 py-1 rounded-[2px] border border-transparent hover:border-dashed hover:border-daw-violet/50">
                            + Return Track
                        </button>
                    </div>
                    <div
                        className="bg-transparent border-b border-daw-border"
                        style={{ width: totalGridWidth }}
                    ></div>
                </div>
            </div >

            {/* Context Menu Portal */}
            {
                contextMenu && (
                    <div
                        className="fixed z-[999] bg-[#0f0f11] border border-daw-border rounded-sm shadow-2xl py-1 min-w-[160px] animate-in zoom-in-95 duration-100"
                        style={{ top: contextMenu.y, left: contextMenu.x }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-3 py-1.5 text-[9px] font-bold text-gray-500 uppercase border-b border-daw-border mb-1">
                            Acciones de Clip
                        </div>
                        <button
                            onClick={() => { onConsolidate(contextMenu.track, [contextMenu.clip]); setContextMenu(null); }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                        >
                            <FileAudio size={12} className="text-gray-500 group-hover:text-white" />
                            Consolidar (Bounce)
                        </button>

                        {/* NEW EDITING TOOLS */}
                        {contextMenu.track.type === TrackType.AUDIO && (
                            <button
                                onClick={() => { onReverse(contextMenu.track, contextMenu.clip); setContextMenu(null); }}
                                className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                            >
                                <ArrowRightLeft size={12} className="text-daw-cyan group-hover:text-white" />
                                Invertir Audio
                            </button>
                        )}

                        {contextMenu.track.type === TrackType.MIDI && (
                            <button
                                onClick={() => { onQuantize(contextMenu.track, contextMenu.clip); setContextMenu(null); }}
                                className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                            >
                                <AlignLeft size={12} className="text-daw-violet group-hover:text-white" />
                                Cuantizar ({gridSize < 1 ? `1/${Math.round(1 / (gridSize * 4))}` : 'Bar'})
                            </button>
                        )}

                        <div className="h-px bg-white/10 my-1"></div>

                        <button
                            onClick={() => {
                                if (onSplitClip) {
                                    onSplitClip(contextMenu.track, contextMenu.clip);
                                }
                                setContextMenu(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                        >
                            <Scissors size={12} className="text-gray-500 group-hover:text-white" />
                            Dividir en Cursor
                        </button>
                        <button
                            onClick={() => {
                                if (onDuplicateClip) {
                                    onDuplicateClip(contextMenu.track, contextMenu.clip);
                                }
                                setContextMenu(null);
                            }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                        >
                            <Copy size={12} className="text-gray-500 group-hover:text-white" />
                            Duplicar
                        </button>
                    </div>
                )
            }

        </div >
    );
});

export default Timeline;
