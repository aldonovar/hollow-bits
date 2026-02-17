// path: components/Knob.tsx
import React, { useState, useRef, useEffect } from 'react';

interface KnobProps {
  value: number;
  min: number;
  max: number;
  size?: number;
  label?: string;
  unit?: string;
  onChange: (val: number) => void;
  color?: string;
  defaultValue?: number;
  bipolar?: boolean;
}

const Knob: React.FC<KnobProps> = ({
  value,
  min,
  max,
  size = 46,
  label,
  unit = '',
  onChange,
  color = '#f0003c',
  defaultValue = 0,
  bipolar = false
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const knobRef = useRef<HTMLDivElement>(null);

  // Refs for drag logic to avoid closure staleness
  const valueRef = useRef(value);
  const startYRef = useRef(0);
  const startValueRef = useRef(0);

  // Sync ref
  useEffect(() => { valueRef.current = value; }, [value]);

  // SVG Geometry Constants
  const strokeWidth = 3;
  const radius = (size / 2) - strokeWidth - 2;
  const center = size / 2;

  // Angles: 3 o'clock is 0 degrees.
  // 7:30 (Bottom Left) -> 135 deg
  // 4:30 (Bottom Right) -> 405 deg
  const startAngle = 135;
  const endAngle = 405;

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = (angleInDegrees * Math.PI) / 180.0;
    return {
      x: centerX + (radius * Math.cos(angleInRadians)),
      y: centerY + (radius * Math.sin(angleInRadians))
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  // --- INTERACTION LOGIC ---

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent text selection or other drags elsewhere

    const element = checkTarget(e.currentTarget);
    element.setPointerCapture(e.pointerId);

    setIsDragging(true);
    startYRef.current = e.clientX; // Using StartYRef to store X for minimal refactoring
    startValueRef.current = valueRef.current;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;

    e.preventDefault();

    // Horizontal Drag: Right increases value
    const deltaX = e.clientX - startYRef.current;

    // Sensitivity
    const range = max - min;
    const pxRange = 200; // 200px drag = full range
    let sensitivity = range / pxRange;

    if (e.shiftKey) sensitivity *= 0.1; // Fine mode

    let newValue = startValueRef.current + (deltaX * sensitivity);
    newValue = Math.min(Math.max(newValue, min), max);

    // Rounding logic for specific ranges (optional but helps clean values)
    if (range > 100 && unit !== 'ms' && !e.shiftKey) {
      // e.g. BPM, Freq > 100
      // Keep decimals if shift is held, else integer
      newValue = Math.round(newValue);
    }

    if (newValue !== valueRef.current) {
      onChange(newValue);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    const element = checkTarget(e.currentTarget);
    element.releasePointerCapture(e.pointerId);
  };

  const checkTarget = (target: EventTarget) => target as HTMLElement;

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onChange(defaultValue);
  };

  const handleWheel = (e: React.WheelEvent) => {
    // Allow scroll to change value
    e.stopPropagation();
    e.preventDefault(); // Stop page scroll

    const range = max - min;
    const step = e.shiftKey ? (range * 0.001) : (range * 0.05);

    const delta = e.deltaY < 0 ? 1 : -1; // Up scroll = positive
    let newValue = value + (delta * step);
    newValue = Math.min(Math.max(newValue, min), max);

    onChange(newValue);
  };

  // --- RENDER CALCS ---

  const range = max - min;
  const clampedValue = Math.min(Math.max(value, min), max);
  const percentage = (clampedValue - min) / range;

  let activeStartAngle = startAngle;
  let activeEndAngle = startAngle + (percentage * (endAngle - startAngle));

  if (bipolar) {
    const centerAngle = 270;
    const currentAngle = startAngle + (percentage * (endAngle - startAngle));
    if (clampedValue >= (min + max) / 2) {
      activeStartAngle = centerAngle;
      activeEndAngle = currentAngle;
    } else {
      activeStartAngle = currentAngle;
      activeEndAngle = centerAngle;
    }
  }

  // Indicator
  const indicatorAngle = startAngle + (percentage * (endAngle - startAngle));
  const indicatorPos = polarToCartesian(center, center, radius, indicatorAngle);
  const indicatorInner = polarToCartesian(center, center, radius * 0.6, indicatorAngle);

  // Tick Marks
  const minTick = polarToCartesian(center, center, radius + 2, startAngle);
  const maxTick = polarToCartesian(center, center, radius + 2, endAngle);

  return (
    <div className="flex flex-col items-center gap-1 select-none group/knob cursor-ew-resize">
      {/* Container with cursor-ew-resize to indicate horizontal drag */}

      <div
        ref={knobRef}
        className="relative touch-none"
        style={{ width: size, height: size }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        title={`${label || 'Value'}: ${value.toFixed(2)}${unit} (Shift+Drag for fine, DblClick reset)`}
      >
        <svg width={size} height={size} className="overflow-visible drop-shadow-sm">
          {/* Tick Marks */}
          <line x1={center} y1={center} x2={minTick.x} y2={minTick.y} stroke="#333" strokeWidth="1" strokeLinecap="round" />
          <line x1={center} y1={center} x2={maxTick.x} y2={maxTick.y} stroke="#333" strokeWidth="1" strokeLinecap="round" />

          {/* Background Track */}
          <path
            d={describeArc(center, center, radius, startAngle, endAngle)}
            fill="none"
            stroke="#1a1a1a"
            strokeWidth={strokeWidth + 2} // Slightly wider for border effect
            strokeLinecap="round"
          />
          <path
            d={describeArc(center, center, radius, startAngle, endAngle)}
            fill="none"
            stroke="#2a2a2a" // Inner track color
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />

          {/* Value Arc */}
          <path
            d={describeArc(center, center, radius, activeStartAngle, activeEndAngle)}
            fill="none"
            stroke={isDragging ? '#fff' : color} // White when dragging for feedback
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            className="transition-colors duration-200"
            style={{
              filter: isDragging ? `drop-shadow(0 0 5px ${color})` : 'none'
            }}
          />

          {/* Pointer */}
          <line
            x1={indicatorInner.x}
            y1={indicatorInner.y}
            x2={indicatorPos.x}
            y2={indicatorPos.y}
            stroke="white"
            strokeWidth={2}
            strokeLinecap="round"
          />
        </svg>

        {/* Invisible Overlay for easier grabbing */}
        <div className="absolute inset-0 z-10 rounded-full" />
      </div>

      {label && (
        <div className={`text-[9px] font-bold font-sans uppercase tracking-wider transition-colors ${isDragging ? 'text-white' : 'text-gray-500'}`}>
          {label}
        </div>
      )}

      {/* Value Tooltip (Verify if needed, or if title is enough. Popups can lag. We'll use title for now to stay clean) */}
    </div>
  );
};

export default React.memo(Knob); // Memoize for performance
