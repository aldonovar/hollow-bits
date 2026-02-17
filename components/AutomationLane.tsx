// path: src/components/AutomationLane.tsx
// Visual Automation Lane with SVG Bezier Curves for Ethereal Studio
// Renders parameter automation curves below tracks with drag-and-drop editing

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { AutomationLane as AutomationLaneType, AutomationPoint, AutomationCurveType } from '../types';

// ============================================================================
// INTERFACES
// ============================================================================

interface AutomationLaneProps {
    lane: AutomationLaneType;
    trackId: string;
    width: number;
    height: number;
    zoom: number; // Pixels per beat
    bars: number; // Total project bars
    onPointAdd: (laneId: string, time: number, value: number) => void;
    onPointMove: (laneId: string, pointId: string, time: number, value: number) => void;
    onPointDelete: (laneId: string, pointId: string) => void;
    onCurveTypeChange: (laneId: string, pointId: string, curveType: AutomationCurveType) => void;
    onToggleExpand: (laneId: string) => void;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POINT_RADIUS = 6;
const POINT_HOVER_RADIUS = 8;
const LANE_HEIGHT_COLLAPSED = 24;
const LANE_HEIGHT_EXPANDED = 60;
const HEADER_WIDTH = 180; // Match Timeline header

// Color palette for automation parameters
const PARAM_COLORS: Record<string, string> = {
    volume: '#FACC15',     // Yellow
    pan: '#22D3EE',        // Cyan
    mute: '#EF4444',       // Red
    filterCutoff: '#E879F9', // Magenta
    filterResonance: '#A855F7', // Violet
    reverb: '#3B82F6',     // Blue
    custom: '#10B981'      // Emerald
};

// ============================================================================
// UTILITY: Generate SVG Path for Bezier Curve
// ============================================================================

function generateCurvePath(
    points: AutomationPoint[],
    _width: number,
    height: number,
    zoom: number,
    bars: number
): string {
    if (points.length === 0) return '';

    const sortedPoints = [...points].sort((a, b) => a.time - b.time);
    const beatsPerBar = 4;
    const totalBeats = bars * beatsPerBar;
    const totalWidth = totalBeats * zoom;

    // Convert time/value to pixel coordinates
    const toX = (time: number) => Math.min(((time - 1) * beatsPerBar * zoom), totalWidth);
    const toY = (value: number) => height - (value * height);

    let path = '';

    // Start from left edge if first point doesn't start at beginning
    const firstPoint = sortedPoints[0];
    if (firstPoint.time > 1) {
        path = `M 0 ${toY(firstPoint.value)}`;
        path += ` L ${toX(firstPoint.time)} ${toY(firstPoint.value)}`;
    } else {
        path = `M ${toX(firstPoint.time)} ${toY(firstPoint.value)}`;
    }

    // Draw curves between points
    for (let i = 1; i < sortedPoints.length; i++) {
        const prev = sortedPoints[i - 1];
        const curr = sortedPoints[i];

        const x1 = toX(prev.time);
        const y1 = toY(prev.value);
        const x2 = toX(curr.time);
        const y2 = toY(curr.value);

        switch (prev.curveType) {
            case 'linear':
                path += ` L ${x2} ${y2}`;
                break;

            case 'hold':
                // Step function - hold value until next point, then jump
                path += ` L ${x2} ${y1} L ${x2} ${y2}`;
                break;

            case 'easeIn':
                // Cubic bezier that starts slow, ends fast
                const cp1x_eIn = x1 + (x2 - x1) * 0.6;
                const cp1y_eIn = y1;
                const cp2x_eIn = x2;
                const cp2y_eIn = y2;
                path += ` C ${cp1x_eIn} ${cp1y_eIn} ${cp2x_eIn} ${cp2y_eIn} ${x2} ${y2}`;
                break;

            case 'easeOut':
                // Cubic bezier that starts fast, ends slow
                const cp1x_eOut = x1;
                const cp1y_eOut = y1;
                const cp2x_eOut = x1 + (x2 - x1) * 0.4;
                const cp2y_eOut = y2;
                path += ` C ${cp1x_eOut} ${cp1y_eOut} ${cp2x_eOut} ${cp2y_eOut} ${x2} ${y2}`;
                break;

            case 'sCurve':
                // S-shaped curve (ease-in-out)
                const midX = (x1 + x2) / 2;
                const cp1x_s = x1 + (midX - x1) * 0.8;
                const cp2x_s = x2 - (x2 - midX) * 0.8;
                path += ` C ${cp1x_s} ${y1} ${cp2x_s} ${y2} ${x2} ${y2}`;
                break;

            default:
                path += ` L ${x2} ${y2}`;
        }
    }

    // Extend to right edge if last point doesn't reach end
    const lastPoint = sortedPoints[sortedPoints.length - 1];
    if (toX(lastPoint.time) < totalWidth) {
        path += ` L ${totalWidth} ${toY(lastPoint.value)}`;
    }

    return path;
}

// ============================================================================
// COMPONENT
// ============================================================================

const AutomationLane: React.FC<AutomationLaneProps> = ({
    lane,
    trackId: _trackId,
    width: _width,
    height: _providedHeight,
    zoom,
    bars,
    onPointAdd,
    onPointMove,
    onPointDelete,
    onCurveTypeChange,
    onToggleExpand
}) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const [dragging, setDragging] = useState<{
        pointId: string;
        startX: number;
        startY: number;
        originalTime: number;
        originalValue: number;
    } | null>(null);
    const [hoveredPointId, setHoveredPointId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<{
        pointId: string;
        x: number;
        y: number;
    } | null>(null);

    const laneHeight = lane.isExpanded ? LANE_HEIGHT_EXPANDED : LANE_HEIGHT_COLLAPSED;
    const color = lane.color || PARAM_COLORS[lane.param] || PARAM_COLORS.custom;

    const beatsPerBar = 4;
    const totalWidth = bars * beatsPerBar * zoom;

    // Generate curve path
    const curvePath = useMemo(() =>
        generateCurvePath(lane.points, totalWidth, laneHeight, zoom, bars),
        [lane.points, totalWidth, laneHeight, zoom, bars]
    );

    // Convert pixel to time/value
    const pixelToTime = useCallback((px: number) => {
        return 1 + (px / (beatsPerBar * zoom));
    }, [zoom]);

    const pixelToValue = useCallback((py: number) => {
        return Math.max(0, Math.min(1, 1 - (py / laneHeight)));
    }, [laneHeight]);

    // Convert time/value to pixel
    const timeToPixel = useCallback((time: number) => {
        return (time - 1) * beatsPerBar * zoom;
    }, [zoom]);

    const valueToPixel = useCallback((value: number) => {
        return laneHeight - (value * laneHeight);
    }, [laneHeight]);

    // Handle double-click to add point
    const handleDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
        if (!svgRef.current || !lane.isExpanded) return;

        const rect = svgRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const time = pixelToTime(x);
        const value = pixelToValue(y);

        onPointAdd(lane.id, time, value);
    }, [lane.id, lane.isExpanded, onPointAdd, pixelToTime, pixelToValue]);

    // Handle point drag start
    const handlePointMouseDown = useCallback((e: React.MouseEvent, point: AutomationPoint) => {
        e.stopPropagation();
        e.preventDefault();

        setDragging({
            pointId: point.id,
            startX: e.clientX,
            startY: e.clientY,
            originalTime: point.time,
            originalValue: point.value
        });
    }, []);

    // Handle point drag
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!dragging || !svgRef.current) return;

        const deltaX = e.clientX - dragging.startX;
        const deltaY = e.clientY - dragging.startY;

        const deltaTime = deltaX / (beatsPerBar * zoom);
        const deltaValue = -deltaY / laneHeight;

        let newTime = Math.max(1, dragging.originalTime + deltaTime);
        let newValue = Math.max(0, Math.min(1, dragging.originalValue + deltaValue));

        // Snap to grid (optional: could add modifier key check)
        newTime = Math.round(newTime * 4) / 4; // Snap to 16ths

        onPointMove(lane.id, dragging.pointId, newTime, newValue);
    }, [dragging, lane.id, laneHeight, onPointMove, zoom]);

    // Handle point drag end
    const handleMouseUp = useCallback(() => {
        setDragging(null);
    }, []);

    // Attach global mouse handlers when dragging
    React.useEffect(() => {
        if (dragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [dragging, handleMouseMove, handleMouseUp]);

    // Handle right-click context menu
    const handlePointContextMenu = useCallback((e: React.MouseEvent, point: AutomationPoint) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            pointId: point.id,
            x: e.clientX,
            y: e.clientY
        });
    }, []);

    // Close context menu
    React.useEffect(() => {
        const closeMenu = () => setContextMenu(null);
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    return (
        <div className="relative flex border-b border-white/5 bg-black/20">
            {/* Lane Header */}
            <div
                className="flex-shrink-0 flex items-center gap-2 px-3 bg-[#161616] border-r border-white/10 cursor-pointer hover:bg-[#1c1c1c] transition-colors select-none"
                style={{ width: HEADER_WIDTH, height: laneHeight }}
                onClick={() => onToggleExpand(lane.id)}
            >
                {lane.isExpanded ? (
                    <ChevronDown size={12} className="text-zinc-500" />
                ) : (
                    <ChevronRight size={12} className="text-zinc-500" />
                )}

                <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: color }}
                />

                <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-400 truncate flex-1">
                    {lane.paramName}
                </span>

                {lane.isExpanded && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                            className="p-0.5 hover:bg-white/10 rounded"
                            onClick={(e) => { e.stopPropagation(); }}
                            title="Add Point"
                        >
                            <Plus size={10} className="text-zinc-500" />
                        </button>
                    </div>
                )}
            </div>

            {/* Lane Content (SVG) */}
            <div className="flex-1 relative overflow-hidden" style={{ height: laneHeight }}>
                <svg
                    ref={svgRef}
                    width={totalWidth}
                    height={laneHeight}
                    className="absolute left-0 top-0"
                    onDoubleClick={handleDoubleClick}
                    style={{ cursor: lane.isExpanded ? 'crosshair' : 'default' }}
                >
                    {/* Background gradient */}
                    <defs>
                        <linearGradient id={`lane-gradient-${lane.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor={color} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                        </linearGradient>
                    </defs>

                    {/* Fill area under curve */}
                    {lane.isExpanded && curvePath && (
                        <path
                            d={`${curvePath} L ${totalWidth} ${laneHeight} L 0 ${laneHeight} Z`}
                            fill={`url(#lane-gradient-${lane.id})`}
                        />
                    )}

                    {/* Curve line */}
                    <path
                        d={curvePath || `M 0 ${laneHeight / 2} L ${totalWidth} ${laneHeight / 2}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={lane.isExpanded ? 2 : 1}
                        strokeLinecap="round"
                        className="transition-all duration-150"
                    />

                    {/* Points */}
                    {lane.isExpanded && lane.points.map(point => {
                        const x = timeToPixel(point.time);
                        const y = valueToPixel(point.value);
                        const isHovered = hoveredPointId === point.id;
                        const isDragging = dragging?.pointId === point.id;

                        return (
                            <g key={point.id}>
                                {/* Hover/selection ring */}
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={isHovered || isDragging ? POINT_HOVER_RADIUS + 2 : 0}
                                    fill="none"
                                    stroke={color}
                                    strokeWidth={2}
                                    opacity={0.3}
                                    className="transition-all duration-150"
                                />

                                {/* Point */}
                                <circle
                                    cx={x}
                                    cy={y}
                                    r={isHovered || isDragging ? POINT_HOVER_RADIUS : POINT_RADIUS}
                                    fill={isDragging ? color : '#1a1a1a'}
                                    stroke={color}
                                    strokeWidth={2}
                                    className="cursor-grab active:cursor-grabbing transition-all duration-75"
                                    onMouseDown={(e) => handlePointMouseDown(e, point)}
                                    onMouseEnter={() => setHoveredPointId(point.id)}
                                    onMouseLeave={() => setHoveredPointId(null)}
                                    onContextMenu={(e) => handlePointContextMenu(e, point)}
                                />

                                {/* Value label on hover */}
                                {isHovered && (
                                    <text
                                        x={x}
                                        y={y - 14}
                                        textAnchor="middle"
                                        className="text-[8px] font-mono fill-white"
                                    >
                                        {Math.round(point.value * 100)}%
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-[1000] bg-[#1a1a1a] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[140px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <div className="px-3 py-1 text-[9px] text-zinc-500 uppercase tracking-wider border-b border-white/5">
                        Curve Type
                    </div>
                    {(['linear', 'easeIn', 'easeOut', 'sCurve', 'hold'] as AutomationCurveType[]).map(type => {
                        const currentPoint = lane.points.find(p => p.id === contextMenu.pointId);
                        const isActive = currentPoint?.curveType === type;

                        return (
                            <button
                                key={type}
                                className={`w-full text-left px-3 py-1.5 text-[10px] hover:bg-white/5 flex items-center justify-between ${isActive ? 'text-white' : 'text-zinc-400'
                                    }`}
                                onClick={() => {
                                    onCurveTypeChange(lane.id, contextMenu.pointId, type);
                                    setContextMenu(null);
                                }}
                            >
                                <span className="capitalize">{type === 'sCurve' ? 'S-Curve' : type}</span>
                                {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />}
                            </button>
                        );
                    })}
                    <div className="border-t border-white/5 mt-1">
                        <button
                            className="w-full text-left px-3 py-1.5 text-[10px] text-red-400 hover:bg-red-500/10"
                            onClick={() => {
                                onPointDelete(lane.id, contextMenu.pointId);
                                setContextMenu(null);
                            }}
                        >
                            Delete Point
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AutomationLane;
