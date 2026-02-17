// path: src/components/WaveformVisualizer.tsx
import React, { useRef, useEffect } from 'react';

interface WaveformVisualizerProps {
    buffer?: AudioBuffer;
    color?: string;
    height?: number;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ buffer, color = '#00fff2', height = 120 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !buffer) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const left = buffer.getChannelData(0);
        const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
        const step = Math.max(1, Math.floor(left.length / width));
        const amp = height / 2;

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.82;
        ctx.beginPath();

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const idx = (i * step) + j;
                if (idx >= left.length) break;

                const mixed = (left[idx] + right[idx]) * 0.5;
                if (mixed < min) min = mixed;
                if (mixed > max) max = mixed;
            }

            const yTop = (1 + min) * amp;
            const yHeight = Math.max(1, (max - min) * amp);
            ctx.fillRect(i, yTop, 1, yHeight);
        }

        ctx.globalAlpha = 1;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.92;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < width; i++) {
            const idx = Math.min(left.length - 1, i * step);
            const mixed = (left[idx] + right[idx]) * 0.5;
            const y = amp - (mixed * amp * 0.9);
            if (i === 0) ctx.moveTo(0, y);
            else ctx.lineTo(i, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }, [buffer, color, height]);

    if (!buffer) {
        return (
            <div className="w-full h-full flex items-center justify-center text-white/20 text-xs font-mono">
                NO AUDIO DATA
            </div>
        );
    }

    return (
        <canvas
            ref={canvasRef}
            width={800}
            height={height}
            className="w-full h-full"
            style={{ width: '100%', height: '100%' }} // CSS scaling
        />
    );
};

export default WaveformVisualizer;
