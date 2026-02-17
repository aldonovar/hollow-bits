import React, { useEffect, useRef, useCallback } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

// --- Sparkle animation config ---
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

const BREATHING_AMPLITUDE = 2;     // px vertical shift
const BREATHING_PERIOD = 3000;     // ms per full breath cycle
const HAIR_SWAY_AMPLITUDE = 1.5;   // px horizontal shift
const HAIR_SWAY_PERIOD = 4000;     // ms per full sway cycle

function drawSparkle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1, size * 0.2);
    ctx.lineCap = 'round';

    // Cross shape
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    // Smaller diagonal cross
    const d = size * 0.5;
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(x - d, y - d);
    ctx.lineTo(x + d, y + d);
    ctx.moveTo(x + d, y - d);
    ctx.lineTo(x - d, y + d);
    ctx.stroke();

    // Center glow dot
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

// --- Frame Animation Config ---
const PERFORMER_FRAME_SOURCES = [
    '/performer/performer_frame_1.png',
    '/performer/performer_frame_2.png',
];

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fallbackImgRef = useRef<HTMLImageElement | null>(null);
    const frameImagesRef = useRef<HTMLImageElement[]>([]);
    const animFrameRef = useRef<number>(0);
    const loadedRef = useRef(false);

    const draw = useCallback((realTime: number) => {
        const canvas = canvasRef.current;
        if (!canvas || !loadedRef.current) return;

        // Quantize time to strictly simulate 12fps (approx 83ms per frame)
        // This makes the movement look like distinct pixel art frames rather than smooth vector motion
        const FPS = 12;
        const STEP_MS = 1000 / FPS;
        const time = Math.floor(realTime / STEP_MS) * STEP_MS;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = canvas.width;
        const H = canvas.height;
        const frameImages = frameImagesRef.current;
        // Cycle through frames if we have them and are playing
        const animatedImage = frameImages.length > 0
            ? frameImages[Math.floor(time / STEP_MS) % frameImages.length]
            : fallbackImgRef.current;
        const idleImage = frameImages[0] || fallbackImgRef.current;
        const activeImage = isPlaying ? animatedImage : idleImage;

        if (!activeImage) return;

        ctx.clearRect(0, 0, W, H);
        // Disable interpolation for crisp pixel look during transforms
        ctx.imageSmoothingEnabled = false;

        if (isPlaying) {
            // Breathing: subtle vertical oscillation, quantized
            const breathCycle = (time / BREATHING_PERIOD) * Math.PI * 2;
            // Use Math.round to snap to nearest pixel for authentic pixel art look
            const breathOffset = Math.round(Math.sin(breathCycle) * BREATHING_AMPLITUDE);

            // Hair sway: subtle horizontal oscillation, quantized
            const swayCycle = (time / HAIR_SWAY_PERIOD) * Math.PI * 2;
            const swayOffset = Math.round(Math.sin(swayCycle) * HAIR_SWAY_AMPLITUDE);

            ctx.save();
            ctx.translate(swayOffset, breathOffset);
            ctx.drawImage(activeImage, 0, 0, W, H);
            ctx.restore();

            // Draw animated sparkles with stepped phases
            for (const sp of SPARKLE_POSITIONS) {
                // Quantize sparkle cycle too
                const cycle = (time * sp.speed * 0.001 + sp.phase) % (Math.PI * 2);

                // Stepped alpha: strictly 0, 0.5, or 1 for retro feel? 
                // Or just keep smooth alpha but stepped position? 
                // Let's keep alpha somewhat smooth but quantized steps
                let alpha = Math.max(0, Math.sin(cycle));

                // Hard threshold for "blink" effect
                if (alpha > 0.05) {
                    drawSparkle(ctx, sp.x * W, sp.y * H, sp.size * (W / 1024), alpha);
                }
            }
        } else {
            // Static idle
            ctx.drawImage(activeImage, 0, 0, W, H);
        }

        animFrameRef.current = requestAnimationFrame(draw);
    }, [isPlaying]);

    // Load image once
    useEffect(() => {
        let cancelled = false;
        const loadImage = (src: string) => new Promise<HTMLImageElement | null>((resolve) => {
            const img = new Image();
            img.src = src;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
        });

        const bootstrap = async () => {
            const fallbackImage = await loadImage('/performer/performer.png');
            if (!fallbackImage || cancelled) return;

            const loadedFrames = await Promise.all(PERFORMER_FRAME_SOURCES.map(loadImage));
            if (cancelled) return;

            fallbackImgRef.current = fallbackImage;
            frameImagesRef.current = loadedFrames.filter((frame): frame is HTMLImageElement => Boolean(frame));
            loadedRef.current = true;

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = fallbackImage.naturalWidth;
                canvas.height = fallbackImage.naturalHeight;
            }

            animFrameRef.current = requestAnimationFrame(draw);
        };

        void bootstrap();

        return () => {
            cancelled = true;
            if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        };
    }, [draw]);

    // Restart animation loop when isPlaying changes
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
                    style={{ imageRendering: 'pixelated' }}
                />
            </div>
        </aside>
    );
};

export default AsciiPerformerDock;
