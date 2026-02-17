import React, { useEffect, useRef, useCallback } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

interface Sparkle {
    x: number;
    y: number;
    size: number;
    phase: number;
    speed: number;
}

const SPARKLE_POSITIONS: Sparkle[] = [
    { x: 0.78, y: 0.06, size: 12, phase: 0, speed: 1.8 },
    { x: 0.84, y: 0.14, size: 8, phase: 1.2, speed: 2.1 },
    { x: 0.06, y: 0.38, size: 10, phase: 2.4, speed: 1.5 },
    { x: 0.04, y: 0.44, size: 7, phase: 0.8, speed: 2.4 },
    { x: 0.82, y: 0.68, size: 9, phase: 3.1, speed: 1.9 },
    { x: 0.76, y: 0.74, size: 11, phase: 1.6, speed: 1.6 },
    { x: 0.50, y: 0.90, size: 6, phase: 0.3, speed: 2.8 },
    { x: 0.12, y: 0.56, size: 5, phase: 2.0, speed: 2.2 },
];

const FPS = 12;
const STEP_MS = 1000 / FPS;
const BREATHING_AMPLITUDE = 1;
const BREATHING_PERIOD = 3000;
const HAIR_SWAY_AMPLITUDE = 1;
const HAIR_SWAY_PERIOD = 4000;

const MOTION_FRAMES = Array.from({ length: 24 }, (_, index) => {
    const t = (Math.PI * 2 * index) / 24;
    const x = Math.round(2.5 * Math.sin(t) + 0.9 * Math.sin(2 * t + 0.45));
    const y = Math.round(2.5 * Math.cos(t + 0.3) + 0.7 * Math.sin(3 * t + 0.2));
    return { x, y };
});

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1, size * 0.2);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    const d = size * 0.5;
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();

    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const animFrameRef = useRef<number>(0);
    const loadedRef = useRef(false);

    const draw = useCallback((realTime: number) => {
        const canvas = canvasRef.current;
        const image = imageRef.current;
        if (!canvas || !loadedRef.current || !image) return;

        const time = Math.floor(realTime / STEP_MS) * STEP_MS;
        const frameIndex = Math.floor(time / STEP_MS) % MOTION_FRAMES.length;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = canvas.width;
        const H = canvas.height;
        const frameOffset = isPlaying ? MOTION_FRAMES[frameIndex] : { x: 0, y: 0 };

        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;

        const breathCycle = (time / BREATHING_PERIOD) * Math.PI * 2;
        const breathOffsetY = isPlaying ? Math.round(Math.sin(breathCycle) * BREATHING_AMPLITUDE) : 0;

        const swayCycle = (time / HAIR_SWAY_PERIOD) * Math.PI * 2;
        const swayOffsetX = isPlaying ? Math.round(Math.sin(swayCycle) * HAIR_SWAY_AMPLITUDE) : 0;

        ctx.save();
        ctx.translate(frameOffset.x + swayOffsetX, frameOffset.y + breathOffsetY);
        ctx.drawImage(image, 0, 0, W, H);
        ctx.restore();

        if (isPlaying) {
            for (const sp of SPARKLE_POSITIONS) {
                const cycle = (time * sp.speed * 0.001 + sp.phase) % (Math.PI * 2);
                const alpha = Math.max(0, Math.sin(cycle));
                if (alpha > 0.05) {
                    drawSparkle(ctx, sp.x * W, sp.y * H, sp.size * (W / 1024), alpha);
                }
            }
        }

        animFrameRef.current = requestAnimationFrame(draw);
    }, [isPlaying]);

    useEffect(() => {
        let cancelled = false;
        const img = new Image();
        img.src = '/performer/performer.png';
        img.onload = () => {
            if (cancelled) return;
            imageRef.current = img;
            loadedRef.current = true;

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
            }

            animFrameRef.current = requestAnimationFrame(draw);
        };

        return () => {
            cancelled = true;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [draw]);

    useEffect(() => {
        if (loadedRef.current) {
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = requestAnimationFrame(draw);
        }
    }, [isPlaying, draw]);

    return (
        <aside
            className={`h-full aspect-square shrink-0 performer-shell relative overflow-hidden ${isPlaying ? 'ascii-dock-playing' : 'ascii-dock-idle'}`}
        >
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_55%_20%,rgba(244,218,255,0.22),transparent_58%)]" />

            <div className="relative h-full w-full performer-stage flex items-center justify-center">
                <canvas
                    ref={canvasRef}
                    aria-label="Pixel art performer"
                    className={`pixel-art-canvas ${isPlaying ? 'pixel-art-live' : 'pixel-art-idle'}`}
                />
            </div>
        </aside>
    );
};

export default AsciiPerformerDock;
