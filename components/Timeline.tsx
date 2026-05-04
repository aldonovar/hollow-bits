
import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react';
import { Track, TrackType, Clip, AutomationPoint, PunchRange } from '../types';
import TrackHeader from './TrackHeader';
import AutomationLane from './AutomationLane';
import { audioEngine } from '../services/audioEngine';
import { trackHeaderMeterStore } from '../services/trackHeaderMeterStore';
import type { TrackHeaderMeterSnapshot } from '../services/trackHeaderMeterStore';
import { Scissors, FileAudio, Copy, ArrowRightLeft, AlignLeft, Grid, Magnet, GitMerge } from 'lucide-react';
import { BrowserDragPayload, readBrowserDragPayload } from '../services/browserDragService';
import {
    resolveCompBoundaryFadeCommitBars,
    resolveCompBoundaryFadePreviewBars,
    resolveCrossfadeCommitBars,
    resolveCrossfadePreviewBars
} from '../services/timelineCrossfadeService';
import {
    getTransportClockSnapshot
} from '../services/transportClockStore';
import { barToSeconds, positionToBarTime } from '../services/transportStateService';
import {
    buildCompLaneOverlayModel,
    type CompLaneOverlayModel,
    type CompBoundaryBlendHandleModel
} from '../services/compLaneOverlayService';
import { COMP_CLIP_ID_PREFIX } from '../services/takeCompingService';

interface TimelineMutationOptions {
    noHistory?: boolean;
    reason?: string;
    historyGroupId?: string;
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
    simplifyPlaybackVisuals: boolean;
}



const HEADER_WIDTH = 300;
const VISIBLE_RECT_SCROLL_QUANTUM = 16;
const VISIBLE_RECT_WIDTH_QUANTUM = 16;
const VISIBLE_RECT_TOP_QUANTUM = 12;
const VISIBLE_RECT_HEIGHT_QUANTUM = 12;
const TRACK_VIRTUALIZATION_OVERSCAN_PX = 480;
const TRACK_VIRTUALIZATION_PLAYBACK_OVERSCAN_PX = 220;
const MAX_ACTIVE_METER_TRACKS = 128;
const WAVEFORM_CACHE_LIMIT = 320;
const MIDI_DECORATION_CACHE_LIMIT = 640;
const MIN_CROSSFADE_BARS = 1 / 1024;

const createHistoryGroupId = (prefix: string, trackId: string, clipId: string): string => {
    return `${prefix}:${trackId}:${clipId}:${Date.now()}:${Math.floor(Math.random() * 100000)}`;
};

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

interface CachedWaveformBitmap {
    canvas: HTMLCanvasElement;
    widthBucket: number;
    heightBucket: number;
}

interface MidiDecorationBar {
    leftPercent: number;
    topPercent: number;
    widthPercent: number;
}

type ClipRenderMode = 'full' | 'lite-playback';

interface WaveformBitmapCanvasProps {
    bitmap: CachedWaveformBitmap;
    width: number;
    height: number;
    className?: string;
}

const WaveformBitmapCanvas: React.FC<WaveformBitmapCanvasProps> = React.memo(({
    bitmap,
    width,
    height,
    className
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const drawBitmap = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = typeof window !== 'undefined' ? Math.max(1, Math.min(2, window.devicePixelRatio || 1)) : 1;
        const displayWidth = Math.max(1, Math.round(width));
        const displayHeight = Math.max(1, Math.round(height));
        const renderWidth = Math.max(1, Math.round(displayWidth * dpr));
        const renderHeight = Math.max(1, Math.round(displayHeight * dpr));

        if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
            canvas.width = renderWidth;
            canvas.height = renderHeight;
        }

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, displayWidth, displayHeight);
        ctx.shadowBlur = 1;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.drawImage(bitmap.canvas, 0, 0, displayWidth, displayHeight);
    };

    useLayoutEffect(() => {
        drawBitmap();
    }, [bitmap, width, height]);

    useEffect(() => {
        const handleVis = () => {
            if (document.visibilityState === 'visible') {
                requestAnimationFrame(() => drawBitmap());
            }
        };
        document.addEventListener('visibilitychange', handleVis);
        return () => document.removeEventListener('visibilitychange', handleVis);
    }, [bitmap, width, height]);

    return (
        <canvas
            ref={canvasRef}
            className={className}
            style={{ width: `${Math.max(1, width)}px`, height: `${Math.max(1, height)}px` }}
        />
    );
}, (prev, next) => (
    prev.bitmap === next.bitmap
    && Math.abs(prev.width - next.width) < 0.5
    && Math.abs(prev.height - next.height) < 0.5
    && prev.className === next.className
));

const seededRatio = (seed: number): number => {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
};

// const EMPTY_COMP_OVERLAY_MODEL: CompLaneOverlayModel = {
//     laneId: null,
//     laneName: null,
//     isActiveLane: false,
//     visibleSegments: [],
//     boundaryHandles: []
// };

type ClipDragAction = {
    type: 'trim-left' | 'trim-right' | 'fade-in' | 'fade-out' | 'stretch';
    clip: Clip;
    startX: number;
    startY: number;
    historyGroupId: string;
};

type CrossfadeDragAction = {
    type: 'crossfade';
    leftClip: Clip;
    rightClip: Clip;
    overlapLengthBars: number;
    initialFadeBars: number;
    startX: number;
    startY: number;
    historyGroupId: string;
};

type CompBoundaryCrossfadeDragAction = {
    type: 'comp-boundary-crossfade';
    leftClipId: string;
    rightClipId: string;
    maxFadeBars: number;
    currentLeftFadeOutBars: number;
    currentRightFadeInBars: number;
    initialFadeBars: number;
    startX: number;
    startY: number;
    historyGroupId: string;
};

type DragAction = ClipDragAction | CrossfadeDragAction | CompBoundaryCrossfadeDragAction;

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
    snapToGrid,
    simplifyPlaybackVisuals
}) => {
    // Local State for Smart Tool Dragging
    const [dragAction, setDragAction] = useState<DragAction | null>(null);
    const dragPreviewRef = useRef<Partial<Clip> | null>(null);
    const crossfadePreviewRef = useRef<number | null>(null);
    const compBoundaryFadePreviewRef = useRef<number | null>(null);
    const waveformBitmapCacheRef = useRef<Map<string, CachedWaveformBitmap>>(new Map());
    const midiDecorationCacheRef = useRef<Map<string, MidiDecorationBar[]>>(new Map());

    // --- SMART TOOL LOGIC (TRIM & FADE) ---
    useEffect(() => {
        if (!dragAction) return;

        const handleGlobalMove = (e: MouseEvent) => {
            const dx = e.clientX - dragAction.startX;
            const deltaBars = dx / zoom / 4;

            if (dragAction.type === 'crossfade') {
                const nextFadeBars = resolveCrossfadePreviewBars(
                    dragAction.overlapLengthBars,
                    dragAction.initialFadeBars,
                    deltaBars
                );

                crossfadePreviewRef.current = nextFadeBars;
                onClipUpdate(track.id, dragAction.leftClip.id, { fadeOut: nextFadeBars }, {
                    noHistory: true,
                    reason: 'timeline-crossfade-preview-left',
                    historyGroupId: dragAction.historyGroupId
                });
                onClipUpdate(track.id, dragAction.rightClip.id, { fadeIn: nextFadeBars }, {
                    noHistory: true,
                    reason: 'timeline-crossfade-preview-right',
                    historyGroupId: dragAction.historyGroupId
                });
                return;
            }

            if (dragAction.type === 'comp-boundary-crossfade') {
                const nextFadeBars = resolveCompBoundaryFadePreviewBars(
                    dragAction.maxFadeBars,
                    dragAction.initialFadeBars,
                    deltaBars
                );
                compBoundaryFadePreviewRef.current = nextFadeBars;

                onClipUpdate(track.id, dragAction.leftClipId, { fadeOut: nextFadeBars }, {
                    noHistory: true,
                    reason: 'timeline-comp-boundary-crossfade-preview-left',
                    historyGroupId: dragAction.historyGroupId
                });
                onClipUpdate(track.id, dragAction.rightClipId, { fadeIn: nextFadeBars }, {
                    noHistory: true,
                    reason: 'timeline-comp-boundary-crossfade-preview-right',
                    historyGroupId: dragAction.historyGroupId
                });
                return;
            }

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
                    reason: 'timeline-clip-gesture-preview',
                    historyGroupId: dragAction.historyGroupId
                });
            }
        };

        const handleGlobalUp = () => {
            if (dragAction.type === 'crossfade') {
                const fadeBars = typeof crossfadePreviewRef.current === 'number'
                    ? crossfadePreviewRef.current
                    : resolveCrossfadeCommitBars(
                        dragAction.overlapLengthBars,
                        dragAction.leftClip.fadeOut || 0,
                        dragAction.rightClip.fadeIn || 0
                    );
                if (typeof fadeBars === 'number') {
                    onClipUpdate(track.id, dragAction.leftClip.id, { fadeOut: fadeBars }, {
                        reason: 'timeline-crossfade-finalize-left',
                        historyGroupId: dragAction.historyGroupId
                    });
                    onClipUpdate(track.id, dragAction.rightClip.id, { fadeIn: fadeBars }, {
                        reason: 'timeline-crossfade-adjust',
                        historyGroupId: dragAction.historyGroupId
                    });
                }
                crossfadePreviewRef.current = null;
                dragPreviewRef.current = null;
                setDragAction(null);
                return;
            }

            if (dragAction.type === 'comp-boundary-crossfade') {
                const fadeBars = typeof compBoundaryFadePreviewRef.current === 'number'
                    ? compBoundaryFadePreviewRef.current
                    : resolveCompBoundaryFadeCommitBars(
                        dragAction.maxFadeBars,
                        dragAction.currentLeftFadeOutBars,
                        dragAction.currentRightFadeInBars
                    );

                onClipUpdate(track.id, dragAction.leftClipId, { fadeOut: fadeBars }, {
                    reason: 'timeline-comp-boundary-crossfade-finalize-left',
                    historyGroupId: dragAction.historyGroupId
                });
                onClipUpdate(track.id, dragAction.rightClipId, { fadeIn: fadeBars }, {
                    reason: 'timeline-comp-boundary-crossfade-finalize-right',
                    historyGroupId: dragAction.historyGroupId
                });

                compBoundaryFadePreviewRef.current = null;
                crossfadePreviewRef.current = null;
                dragPreviewRef.current = null;
                setDragAction(null);
                return;
            }

            const updates = dragPreviewRef.current;
            if (updates) {
                const reasonByType: Record<ClipDragAction['type'], string> = {
                    'trim-left': 'timeline-clip-trim-left',
                    'trim-right': 'timeline-clip-trim-right',
                    'fade-in': 'timeline-clip-fade-in',
                    'fade-out': 'timeline-clip-fade-out',
                    stretch: 'timeline-clip-stretch'
                };

                onClipUpdate(track.id, dragAction.clip.id, updates, {
                    reason: reasonByType[dragAction.type],
                    historyGroupId: dragAction.historyGroupId
                });
            }

            dragPreviewRef.current = null;
            crossfadePreviewRef.current = null;
            compBoundaryFadePreviewRef.current = null;
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
    const shouldSimplifyVisuals = simplifyPlaybackVisuals;
    const clipRenderMode: ClipRenderMode = shouldSimplifyVisuals ? 'lite-playback' : 'full';
    const audioWaveformRenderMode: ClipRenderMode = 'full';
    const showDetailGrid = zoom > 50;
    const showBeatGrid = zoom > 20;

    const getWaveformBitmap = (clip: Clip, width: number, height: number, renderMode: ClipRenderMode): CachedWaveformBitmap | null => {
        const buffer = clip.buffer;
        if (!buffer || typeof document === 'undefined') {
            return null;
        }

        const dpr = typeof window !== 'undefined' ? Math.max(1, Math.min(2, window.devicePixelRatio || 1)) : 1;
        const widthBucket = renderMode === 'full'
            ? Math.max(192, Math.round(width / 16) * 16)
            : Math.max(128, Math.round(width / 24) * 24);
        const heightBucket = renderMode === 'full'
            ? Math.max(40, Math.round(height / 4) * 4)
            : Math.max(32, Math.round(height / 6) * 6);
        const cacheKey = `bmp:${clip.id}:${buffer.length}:${buffer.sampleRate}:${widthBucket}:${heightBucket}:${renderMode}:${dpr}`;
        const cached = waveformBitmapCacheRef.current.get(cacheKey);
        if (cached) {
            return cached;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(widthBucket * dpr));
        canvas.height = Math.max(1, Math.round(heightBucket * dpr));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return null;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const centerY = heightBucket / 2;
        const amp = heightBucket * (renderMode === 'full' ? 0.47 : 0.44);
        // Elite fidelity: Massive sample rate for high-definition waveform plotting
        const sampleSteps = renderMode === 'full'
            ? Math.min(16000, Math.max(1600, Math.ceil(widthBucket * (zoom < 35 ? 6.0 : zoom < 90 ? 8.0 : 12.0))))
            : Math.min(2400, Math.max(256, Math.ceil(widthBucket * 1.5)));
        const envelope = audioEngine.getWaveformEnvelopeData(buffer, sampleSteps);
        const pointCount = Math.min(envelope.max.length, envelope.min.length);
        if (pointCount === 0) {
            return null;
        }

        ctx.clearRect(0, 0, widthBucket, heightBucket);
        ctx.strokeStyle = `${track.color}33`; // Subtler center line
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(widthBucket, centerY);
        ctx.stroke();

        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const gradient = ctx.createLinearGradient(0, centerY - amp, 0, centerY + amp);
        if (renderMode === 'full') {
            gradient.addColorStop(0, `${track.color}E6`);
            gradient.addColorStop(0.2, `${track.color}A0`);
            gradient.addColorStop(0.5, `${track.color}20`);
            gradient.addColorStop(0.8, `${track.color}A0`);
            gradient.addColorStop(1, `${track.color}E6`);
        } else {
            gradient.addColorStop(0, `${track.color}80`);
            gradient.addColorStop(0.5, `${track.color}15`);
            gradient.addColorStop(1, `${track.color}80`);
        }

        ctx.fillStyle = gradient;
        ctx.strokeStyle = renderMode === 'full' ? `${track.color}FF` : `${track.color}D8`;
        ctx.lineWidth = renderMode === 'full' ? 1.5 : 1.05;
        
        if (renderMode === 'full') {
            ctx.shadowColor = `${track.color}80`;
            ctx.shadowBlur = 5;
            ctx.shadowOffsetY = 0;
        }

        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let i = 0; i < pointCount; i += 1) {
            const x = (i / Math.max(1, pointCount - 1)) * widthBucket;
            const y = centerY - (envelope.max[i] * amp);
            ctx.lineTo(x, y);
        }
        for (let i = pointCount - 1; i >= 0; i -= 1) {
            const x = (i / Math.max(1, pointCount - 1)) * widthBucket;
            const y = centerY - (envelope.min[i] * amp);
            ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        const nextBitmap = {
            canvas,
            widthBucket,
            heightBucket
        };
        waveformBitmapCacheRef.current.set(cacheKey, nextBitmap);
        if (waveformBitmapCacheRef.current.size > Math.floor(WAVEFORM_CACHE_LIMIT / 2)) {
            const oldestKey = waveformBitmapCacheRef.current.keys().next().value;
            if (oldestKey) {
                waveformBitmapCacheRef.current.delete(oldestKey);
            }
        }
        return nextBitmap;
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

        const payload = readBrowserDragPayload(event.dataTransfer);
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

    const compOverlayModel = useMemo(() => {
        // Removed shouldSimplifyVisuals check to keep nodes stable
        return buildCompLaneOverlayModel({
            track,
            zoom,
            viewportLeftPx: visibleRect.left,
            viewportWidthPx: visibleRect.width,
            viewportPaddingPx: 300
        });
    }, [track, zoom, visibleRect.left, visibleRect.width]);

    const visibleCompSegments = compOverlayModel.visibleSegments;
    const compBoundaryHandles = compOverlayModel.boundaryHandles;

    const crossfades = useMemo(() => {
        // Removed shouldSimplifyVisuals check to keep nodes stable
        const fades: Array<{
            id: string;
            left: number;
            width: number;
            overlapWidth: number;
            leftClip: Clip;
            rightClip: Clip;
            overlapLengthBars: number;
            fadeLengthBars: number;
        }> = [];
        const sortedClips = [...track.clips].sort((a, b) => a.start - b.start);

        for (let i = 0; i < sortedClips.length - 1; i++) {
            const current = sortedClips[i];
            const next = sortedClips[i + 1];
            const isCompPair = current.id.startsWith(COMP_CLIP_ID_PREFIX) && next.id.startsWith(COMP_CLIP_ID_PREFIX);
            if (isCompPair) {
                continue;
            }

            const currentEnd = current.start + current.length;

            if (currentEnd > next.start) {
                const overlapStart = next.start;
                const overlapEnd = Math.min(currentEnd, next.start + next.length);
                const overlapLen = overlapEnd - overlapStart;

                if (overlapLen > MIN_CROSSFADE_BARS) {
                    const configuredFade = Math.max(0, Math.min(overlapLen, Math.max(current.fadeOut || 0, next.fadeIn || 0)));
                    const fadeLengthBars = configuredFade > MIN_CROSSFADE_BARS ? configuredFade : overlapLen;
                    const leftPx = (overlapStart - 1) * 4 * zoom;
                    const overlapWidthPx = overlapLen * 4 * zoom;
                    const widthPx = Math.max(2, fadeLengthBars * 4 * zoom);

                    fades.push({
                        id: `xfade-${current.id}-${next.id}`,
                        left: leftPx,
                        width: widthPx,
                        overlapWidth: overlapWidthPx,
                        leftClip: current,
                        rightClip: next,
                        overlapLengthBars: overlapLen,
                        fadeLengthBars
                    });
                }
            }
        }
        return fades;
    }, [shouldSimplifyVisuals, track.clips, zoom]);

    // VIRTUALIZATION FILTER
    const visibleClips = useMemo(() => {
        // Unified bufferPx to prevent unmounts when simplifyPlaybackVisuals toggles
        const bufferPx = Math.max(320, Math.min(560, Math.round(visibleRect.width * 0.34)));
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
                className={`shrink-0 sticky left-0 z-[100] bg-[#121212] border-r border-daw-border ${shouldSimplifyVisuals ? '' : 'shadow-[4px_0_15px_-4px_rgba(0,0,0,0.8)]'}`}
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
                {visibleCompSegments.length > 0 && (
                    <div className={`absolute inset-0 z-[12] pointer-events-none transition-opacity duration-150 ${shouldSimplifyVisuals ? 'opacity-0' : 'opacity-100'}`}>
                        <div className="absolute left-1 top-1 h-4 px-1.5 rounded-[2px] border border-daw-violet/45 bg-[#0b0c12]/80 text-[8px] font-black uppercase tracking-wider text-daw-violet/95 flex items-center gap-1.5">
                            <span>Comp</span>
                            <span className={`${compOverlayModel.isActiveLane ? 'text-emerald-300' : 'text-amber-300'}`}>
                                {compOverlayModel.isActiveLane ? 'ACTIVE' : 'STAGED'}
                            </span>
                            <span className="text-gray-400">
                                {compOverlayModel.laneName || 'Lane'}
                            </span>
                        </div>
                        {visibleCompSegments.map((item) => (
                            <div
                                key={`comp-overlay-${item.segment.id}`}
                                className="absolute top-0 bottom-0 border border-daw-violet/40 bg-gradient-to-r from-daw-violet/12 via-daw-cyan/5 to-transparent"
                                style={{
                                    left: `${item.leftPx}px`,
                                    width: `${item.widthPx}px`
                                }}
                            >
                                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-daw-violet/80 via-daw-cyan/70 to-transparent" />
                                <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-daw-violet/55" />
                                <div className="absolute top-0 bottom-0 right-0 w-[1px] bg-daw-violet/35" />
                                <div className="absolute right-1 top-1 text-[8px] uppercase tracking-wide text-daw-violet/90 bg-black/35 px-1 rounded-sm flex items-center gap-1">
                                    <span>Comp {item.takeAlias}</span>
                                    {item.isMutedTake && (
                                        <span className="text-[7px] text-amber-300">M</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* CLIPS (VIRTUALIZED) */}
                {visibleClips.map(clip => {
                    const widthPx = clip.length * 4 * zoom;
                    const showClipName = clipRenderMode === 'full' && widthPx > 30;
                    const showHandles = !shouldSimplifyVisuals && widthPx > 50;
                    const EDGE_WIDTH = 8; // Trim handle hit zone width
                    const isCompDerivedClip = clip.id.startsWith(COMP_CLIP_ID_PREFIX) || clip.name.startsWith('[COMP]');

                    return (
                        <div
                            key={clip.id}
                            className={`absolute top-0 bottom-0 overflow-visible cursor-grab active:cursor-grabbing z-20 group/clip rounded-[2px] ${shouldSimplifyVisuals ? '' : 'transition-shadow hover:shadow-lg'}`}
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
                                background: isCompDerivedClip
                                    ? (shouldSimplifyVisuals ? `linear-gradient(120deg, ${track.color}10 0%, rgba(10, 11, 16, 0.82) 78%)` : `linear-gradient(120deg, ${track.color}3A 0%, rgba(13, 14, 22, 0.92) 75%)`)
                                    : (showWaveforms ? 'rgba(255, 255, 255, 0.04)' : `${track.color}20`),
                                borderLeft: `2px solid ${isCompDerivedClip ? '#a855f7' : track.color}`,
                                borderRight: `1px solid ${isCompDerivedClip ? '#a855f780' : `${track.color}40`}`,
                                boxShadow: shouldSimplifyVisuals
                                    ? undefined
                                    : (isCompDerivedClip ? 'inset 0 0 0 1px rgba(168,85,247,0.38)' : undefined),
                                contain: 'layout paint style',
                                contentVisibility: 'auto'
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
                                            startY: e.clientY,
                                            historyGroupId: createHistoryGroupId('trim-left', track.id, clip.id)
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
                                            startY: e.clientY,
                                            historyGroupId: createHistoryGroupId(e.altKey ? 'stretch' : 'trim-right', track.id, clip.id)
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
                                            startY: e.clientY,
                                            historyGroupId: createHistoryGroupId('fade-in', track.id, clip.id)
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
                                            startY: e.clientY,
                                            historyGroupId: createHistoryGroupId('fade-out', track.id, clip.id)
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
                                    <div className="flex items-center justify-between px-1 gap-1">
                                        <span
                                            className="text-[9px] font-bold text-gray-100 uppercase tracking-wide truncate"
                                            style={{ color: track.color }}
                                        >
                                            {clip.name}
                                        </span>
                                        {isCompDerivedClip && (
                                            <span className="shrink-0 text-[8px] font-black uppercase tracking-wide text-daw-violet bg-daw-violet/20 border border-daw-violet/40 px-1 rounded-[2px]">
                                                COMP
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Waveform / MIDI Viz - Conditional Rendering based on Zoom */}
                            {showWaveforms && (
                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                    {track.type === TrackType.AUDIO && clip.buffer ? (
                                        <div className="w-full h-full opacity-95">
                                            {(() => {
                                                const waveformBitmap = getWaveformBitmap(clip, clip.length * 4 * zoom, trackHeight, audioWaveformRenderMode);
                                                return waveformBitmap ? (
                                                    <WaveformBitmapCanvas
                                                        bitmap={waveformBitmap}
                                                        width={clip.length * 4 * zoom}
                                                        height={trackHeight}
                                                        className="w-full h-full block"
                                                    />
                                                ) : null;
                                            })()}
                                        </div>
                                    ) : track.type === TrackType.MIDI ? (
                                        <div className={`w-full h-full relative ${clipRenderMode === 'lite-playback' ? 'opacity-60' : 'opacity-80'}`}>
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

                            {!shouldSimplifyVisuals && (
                                <div className="absolute inset-0 border border-transparent group-hover/clip:border-white/10 transition-colors pointer-events-none"></div>
                            )}
                        </div>
                    );
                })}

                {compBoundaryHandles.length > 0 && (
                    <div className={`absolute inset-0 z-[34] pointer-events-none transition-opacity duration-150 ${shouldSimplifyVisuals ? 'opacity-0' : 'opacity-100'}`}>
                        {compBoundaryHandles.map((handle: CompBoundaryBlendHandleModel) => (
                            <div
                                key={handle.id}
                                className="absolute top-0 bottom-0"
                                style={{ left: `${handle.boundaryLeftPx}px` }}
                            >
                                <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-daw-cyan/45" />

                                {handle.overlayWidthPx > 0 && (
                                    <div
                                        className="absolute top-0 bottom-0"
                                        style={{
                                            left: `${handle.overlayLeftPx - handle.boundaryLeftPx}px`,
                                            width: `${handle.overlayWidthPx}px`
                                        }}
                                    >
                                        <svg width={handle.overlayWidthPx} height="100%" preserveAspectRatio="none" className="overflow-visible">
                                            <path
                                                d={`M 0 ${trackHeight} C ${handle.overlayWidthPx * 0.25} ${trackHeight}, ${handle.overlayWidthPx * 0.25} 0, ${handle.overlayWidthPx * 0.5} 0`}
                                                fill="none"
                                                stroke="#67e8f9"
                                                strokeOpacity="0.72"
                                                strokeWidth="1.2"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                            <path
                                                d={`M ${handle.overlayWidthPx * 0.5} 0 C ${handle.overlayWidthPx * 0.75} 0, ${handle.overlayWidthPx * 0.75} ${trackHeight}, ${handle.overlayWidthPx} ${trackHeight}`}
                                                fill="none"
                                                stroke="#a78bfa"
                                                strokeOpacity="0.72"
                                                strokeWidth="1.2"
                                                vectorEffect="non-scaling-stroke"
                                            />
                                        </svg>
                                    </div>
                                )}

                                <button
                                    data-handle-type="comp-boundary-crossfade"
                                    className="pointer-events-auto absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border border-daw-violet/70 bg-[#090b12] shadow-[0_0_10px_rgba(167,139,250,0.4)] hover:scale-110 transition-transform"
                                    title={`Comp blend ${handle.currentFadeBars.toFixed(2)} / ${handle.maxFadeBars.toFixed(2)} bars`}
                                    onMouseDown={(event) => {
                                        event.stopPropagation();
                                        setDragAction({
                                            type: 'comp-boundary-crossfade',
                                            leftClipId: handle.leftClipId,
                                            rightClipId: handle.rightClipId,
                                            maxFadeBars: handle.maxFadeBars,
                                            currentLeftFadeOutBars: handle.currentLeftFadeOutBars,
                                            currentRightFadeInBars: handle.currentRightFadeInBars,
                                            initialFadeBars: handle.currentFadeBars,
                                            startX: event.clientX,
                                            startY: event.clientY,
                                            historyGroupId: createHistoryGroupId('comp-boundary-crossfade', track.id, `${handle.leftClipId}|${handle.rightClipId}`)
                                        });
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* AUTOMATIC CROSSFADE OVERLAYS */}
                <div className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-150 ${shouldSimplifyVisuals ? 'opacity-0' : 'opacity-100'}`}>
                    {crossfades.map(xfade => (
                        <div
                            key={xfade.id}
                            className="absolute top-0 bottom-0 pointer-events-none"
                            style={{
                                left: `${xfade.left}px`,
                                width: `${xfade.overlapWidth}px`,
                                background: 'linear-gradient(to right, rgba(0,0,0,0), rgba(255,255,255,0.035), rgba(0,0,0,0))'
                            }}
                        >
                            <svg width={xfade.width} height="100%" preserveAspectRatio="none" className="overflow-visible">
                                <path
                                    d={`M 0 0 C ${xfade.width * 0.5} 0, ${xfade.width * 0.5} ${trackHeight}, ${xfade.width} ${trackHeight}`}
                                    fill="none"
                                    stroke="#e5e7eb"
                                    strokeWidth="1.5"
                                    strokeOpacity="0.72"
                                    vectorEffect="non-scaling-stroke"
                                />
                                <path
                                    d={`M 0 ${trackHeight} C ${xfade.width * 0.5} ${trackHeight}, ${xfade.width * 0.5} 0, ${xfade.width} 0`}
                                    fill="none"
                                    stroke="#e5e7eb"
                                    strokeWidth="1.5"
                                    strokeOpacity="0.72"
                                    vectorEffect="non-scaling-stroke"
                                />
                            </svg>

                            <button
                                data-handle-type="crossfade"
                                className="pointer-events-auto absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border border-daw-cyan/80 bg-[#0a0a0f] shadow-[0_0_10px_rgba(34,211,238,0.35)] hover:scale-110 transition-transform"
                                style={{ left: `${Math.max(0, xfade.width - 7)}px` }}
                                title={`Crossfade ${xfade.fadeLengthBars.toFixed(2)} bars`}
                                onMouseDown={(event) => {
                                    event.stopPropagation();
                                    setDragAction({
                                        type: 'crossfade',
                                        leftClip: xfade.leftClip,
                                        rightClip: xfade.rightClip,
                                        overlapLengthBars: xfade.overlapLengthBars,
                                        initialFadeBars: xfade.fadeLengthBars,
                                        startX: event.clientX,
                                        startY: event.clientY,
                                        historyGroupId: createHistoryGroupId('crossfade', track.id, `${xfade.leftClip.id}|${xfade.rightClip.id}`)
                                    });
                                }}
                            />
                        </div>
                    ))}
                </div>
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
        prev.snapToGrid === next.snapToGrid &&
        prev.simplifyPlaybackVisuals === next.simplifyPlaybackVisuals
    );
});


// --- Main Timeline Component ---

interface TimelineProps {
    tracks: Track[];
    bars: number;
    zoom: number;
    trackHeight: number;
    bpm: number;
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
    onPromoteToComp?: (track: Track, clip: Clip) => void;
    onAddTrack?: (type?: TrackType) => void; // [UPDATED]
    onTimeUpdate?: (bar: number, beat: number, sixteenth: number) => void; // [NEW] Synced with playhead RAF
    gridSize: number;
    snapToGrid: boolean;
    selectedTrackId: string | null;
    selectedTrackPunchRange?: PunchRange | null;
    selectedTrackColor?: string | null;
    containerRef: React.RefObject<HTMLDivElement | null>;
    uiFrameBudgetMs?: number;
    meterFrameBudgetMs?: number;
    maxActiveMeterTracks?: number;
    simplifyPlaybackVisuals?: boolean;
}

const Timeline: React.FC<TimelineProps> = React.memo(({
    tracks,
    bars,
    zoom,
    trackHeight,
    bpm,
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
    onPromoteToComp,
    onAddTrack,
    onTimeUpdate: _onTimeUpdate, // intentionally unused; transport authority now owns clock sync
    gridSize,
    snapToGrid,
    selectedTrackId,
    selectedTrackPunchRange,
    selectedTrackColor,
    containerRef,
    uiFrameBudgetMs = 16,
    meterFrameBudgetMs = 0,
    maxActiveMeterTracks = MAX_ACTIVE_METER_TRACKS,
    simplifyPlaybackVisuals = false
}) => {
    const totalBeats = bars * 4;
    const totalGridWidth = totalBeats * zoom;
    const totalLayoutWidth = totalGridWidth + HEADER_WIDTH;

    const cursorRef = useRef<HTMLDivElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const commitCursorRef = useRef<((currentSeconds: number, forcedPosition?: { bar: number; beat: number; sixteenth: number }) => void) | null>(null);

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
        const overscanPx = simplifyPlaybackVisuals ? TRACK_VIRTUALIZATION_PLAYBACK_OVERSCAN_PX : TRACK_VIRTUALIZATION_OVERSCAN_PX;
        const start = Math.max(0, visibleRect.top - overscanPx);
        const end = visibleRect.top + visibleRect.height + overscanPx;

        return trackRows.filter((row) => {
            const rowBottom = row.top + row.totalHeight;
            return rowBottom > start && row.top < end;
        });
    }, [simplifyPlaybackVisuals, trackRows, visibleRect.top, visibleRect.height]);

    const trackTopById = useMemo(() => {
        const index = new Map<string, number>();
        trackRows.forEach((row) => {
            index.set(row.track.id, row.top);
        });
        return index;
    }, [trackRows]);

    const allTrackIds = useMemo(() => trackRows.map((row) => row.track.id), [trackRows]);
    const visibleTrackIds = useMemo(() => visibleTrackRows.map((row) => row.track.id), [visibleTrackRows]);
    const effectiveMaxActiveMeterTracks = Math.max(1, Math.floor(maxActiveMeterTracks));
    const effectiveMeterFrameBudgetMs = Math.max(0, meterFrameBudgetMs);

    const activeMeterTrackIds = useMemo(() => {
        const ids = [...visibleTrackIds].slice(0, effectiveMaxActiveMeterTracks);

        if (selectedTrackId && !ids.includes(selectedTrackId)) {
            if (ids.length >= effectiveMaxActiveMeterTracks) {
                ids[ids.length - 1] = selectedTrackId;
            } else {
                ids.push(selectedTrackId);
            }
        }

        if (ids.length > 0) {
            return ids;
        }

        return allTrackIds.slice(0, Math.min(12, allTrackIds.length));
    }, [allTrackIds, effectiveMaxActiveMeterTracks, selectedTrackId, visibleTrackIds]);

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
            const playingFps = 60;
            const idleFps = 60;
            const baseFrameDelta = audioEngine.getIsPlaying() ? (1000 / playingFps) : (1000 / idleFps);
            const minFrameDelta = Math.max(baseFrameDelta, effectiveMeterFrameBudgetMs);
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
    }, [activeMeterTrackIds, activeMeterTrackIdsKey, allTrackIds, allTrackIdsKey, effectiveMeterFrameBudgetMs]);

    // Drag State with Ghost Preview
    const [dragging, setDragging] = useState<{
        clipId: string;
        trackId: string;
        startX: number;
        originalStartBar: number;
        clip: Clip | null; // Reference to the clip being dragged
        historyGroupId: string;
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

        const commitCursor = (currentSeconds: number) => {
            const secondsPerBeat = 60 / bpm;
            const totalBeatsElapsed = currentSeconds / secondsPerBeat;
            const px = totalBeatsElapsed * zoom;

            if (cursorRef.current) {
                cursorRef.current.style.transform = `translate3d(${px}px, 0, 0)`;
            }
            if (playheadRef.current) {
                playheadRef.current.style.transform = `translate3d(${px}px, 0, 0)`;
            }
        };
        commitCursorRef.current = commitCursor;

        const updateCursor = (timestamp: number) => {
            const isPlayingNow = audioEngine.getIsPlaying();
            const baseFrameDelta = isPlayingNow ? (1000 / 60) : (1000 / 10);
            const minFrameDelta = isPlayingNow ? baseFrameDelta : Math.max(baseFrameDelta, Math.max(8, uiFrameBudgetMs));
            
            if (timestamp - lastFrameTime < minFrameDelta) {
                animationFrameId = requestAnimationFrame(updateCursor);
                return;
            }
            lastFrameTime = timestamp;

            if (isPlayingNow) {
                commitCursor(audioEngine.getCurrentTime());
            } else {
                const clockSnapshot = getTransportClockSnapshot();
                const idleBarTime = positionToBarTime(clockSnapshot);
                commitCursor(barToSeconds(idleBarTime, bpm));
            }

            animationFrameId = requestAnimationFrame(updateCursor);
        };

        // Close context menu on click elsewhere
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);

        animationFrameId = requestAnimationFrame(updateCursor);

        return () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
            }
            commitCursorRef.current = null;
            window.removeEventListener('click', closeMenu);
        };
    }, [
        bpm,
        uiFrameBudgetMs,
        zoom
    ]);

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
                reason: 'timeline-drag-clip-preview',
                historyGroupId: dragging.historyGroupId
            });
        };

        const handleMouseUp = () => {
            if (dragging && dragStartPreviewRef.current !== null) {
                onClipUpdate(dragging.trackId, dragging.clipId, { start: dragStartPreviewRef.current }, {
                    reason: 'timeline-drag-clip',
                    historyGroupId: dragging.historyGroupId
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
            clip: clip, // Reference for ghost preview
            historyGroupId: createHistoryGroupId('drag-clip', trackId, clip.id)
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

    const selectedPunchWindow = useMemo(() => {
        if (!selectedTrackPunchRange?.enabled) return null;

        const inBar = Math.max(1, Number.isFinite(selectedTrackPunchRange.inBar) ? selectedTrackPunchRange.inBar : 1);
        const outBarCandidate = Number.isFinite(selectedTrackPunchRange.outBar) ? selectedTrackPunchRange.outBar : inBar + 0.25;
        const outBar = Math.max(inBar + 0.25, outBarCandidate);

        return {
            inBar,
            outBar,
            widthBars: outBar - inBar
        };
    }, [selectedTrackPunchRange]);

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

                {selectedPunchWindow && (
                    <>
                        <div
                            className="absolute inset-y-0 pointer-events-none z-[18]"
                            style={{
                                left: HEADER_WIDTH + ((selectedPunchWindow.inBar - 1) * 4 * zoom),
                                width: selectedPunchWindow.widthBars * 4 * zoom,
                                background: 'linear-gradient(to right, rgba(244,63,94,0.16), rgba(239,68,68,0.08), rgba(244,63,94,0.16))'
                            }}
                        />
                        <div
                            className="absolute top-0 bottom-0 w-[1px] pointer-events-none z-[19]"
                            style={{
                                left: HEADER_WIDTH + ((selectedPunchWindow.inBar - 1) * 4 * zoom),
                                backgroundColor: selectedTrackColor || '#f43f5e'
                            }}
                        >
                            <span className="absolute top-[10px] -left-3 text-[8px] font-black tracking-wider text-white bg-[#7f1d1d]/90 border border-red-400/60 px-1 rounded-sm">IN</span>
                        </div>
                        <div
                            className="absolute top-0 bottom-0 w-[1px] pointer-events-none z-[19]"
                            style={{
                                left: HEADER_WIDTH + ((selectedPunchWindow.outBar - 1) * 4 * zoom),
                                backgroundColor: selectedTrackColor || '#f43f5e'
                            }}
                        >
                            <span className="absolute top-[10px] -left-3 text-[8px] font-black tracking-wider text-white bg-[#7f1d1d]/90 border border-red-400/60 px-1 rounded-sm">OUT</span>
                        </div>
                    </>
                )}

                {/* Playhead Triangle - NOW ALIGNED WITH CURSOR LINE */}
                <div
                    ref={playheadRef}
                    className="absolute top-0 w-[10px] h-[10px] will-change-transform pointer-events-none z-40"
                    style={{ left: 0, marginLeft: HEADER_WIDTH - 5 }}
                >
                    <svg width="10" height="10" viewBox="0 0 10 10">
                        <path d="M0 0 L10 0 L5 8 Z" fill="white" />
                    </svg>
                </div>

                <div
                    ref={cursorRef}
                    className="absolute top-0 bottom-0 w-[1px] bg-white/95 z-30 pointer-events-none will-change-transform"
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
                                    simplifyPlaybackVisuals={simplifyPlaybackVisuals}
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
                            disabled={contextMenu.clip.id.startsWith(COMP_CLIP_ID_PREFIX)}
                            onClick={() => { onConsolidate(contextMenu.track, [contextMenu.clip]); setContextMenu(null); }}
                            className="w-full text-left px-3 py-1.5 hover:bg-[#222] disabled:hover:bg-transparent text-xs text-gray-200 disabled:text-gray-500 flex items-center gap-2 group disabled:cursor-not-allowed"
                            title={contextMenu.clip.id.startsWith(COMP_CLIP_ID_PREFIX) ? 'Consolida la toma fuente desde el editor para materializar el comp.' : undefined}
                        >
                            <FileAudio size={12} className="text-gray-500 group-hover:text-white" />
                            Consolidar (Bounce)
                        </button>

                        {/* NEW EDITING TOOLS */}
                        {contextMenu.track.type === TrackType.AUDIO && (
                            <>
                                <button
                                    disabled={contextMenu.clip.id.startsWith(COMP_CLIP_ID_PREFIX)}
                                    onClick={() => { onReverse(contextMenu.track, contextMenu.clip); setContextMenu(null); }}
                                    className="w-full text-left px-3 py-1.5 hover:bg-[#222] disabled:hover:bg-transparent text-xs text-gray-200 disabled:text-gray-500 flex items-center gap-2 group disabled:cursor-not-allowed"
                                    title={contextMenu.clip.id.startsWith(COMP_CLIP_ID_PREFIX) ? 'El reverse directo se aplica sobre clips fuente, no sobre clips comp derivados.' : undefined}
                                >
                                    <ArrowRightLeft size={12} className="text-daw-cyan group-hover:text-white" />
                                    Invertir Audio
                                </button>
                                {onPromoteToComp && !contextMenu.clip.id.startsWith(COMP_CLIP_ID_PREFIX) && (
                                    <button
                                        onClick={() => { onPromoteToComp(contextMenu.track, contextMenu.clip); setContextMenu(null); }}
                                        className="w-full text-left px-3 py-1.5 hover:bg-[#222] text-xs text-gray-200 flex items-center gap-2 group"
                                    >
                                        <GitMerge size={12} className="text-daw-violet group-hover:text-white" />
                                        Enviar a Comp Lane
                                    </button>
                                )}
                            </>
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
