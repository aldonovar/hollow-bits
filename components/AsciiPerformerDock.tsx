import React, { useEffect, useRef, useCallback } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

// --- Sparkle animation config ---
const BREATHING_AMPLITUDE = 2;     // px vertical shift
const BREATHING_PERIOD = 3000;     // ms per full breath cycle

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const animFrameRef = useRef<number>(0);
    const loadedRef = useRef(false);

    const draw = useCallback((realTime: number) => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !loadedRef.current) return;

        const FPS = 12;
        const STEP_MS = 1000 / FPS;
        const time = Math.floor(realTime / STEP_MS) * STEP_MS;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;

        const breathCycle = (time / BREATHING_PERIOD) * Math.PI * 2;
        const breathOffset = isPlaying ? Math.round(Math.sin(breathCycle) * BREATHING_AMPLITUDE) : 0;

        ctx.save();
        ctx.translate(0, breathOffset);
        ctx.drawImage(img, 0, 0, W, H);
        ctx.restore();

        animFrameRef.current = requestAnimationFrame(draw);
    }, [isPlaying]);

    // Load image once
    useEffect(() => {
        const img = new Image();
        img.src = '/performer/performer.png';
        img.onload = () => {
            imgRef.current = img;
            loadedRef.current = true;

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = 1024;
                canvas.height = 1024;
            }

            // Start render loop
            animFrameRef.current = requestAnimationFrame(draw);
        };

        return () => {
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
                />
            </div>
        </aside>
    );
};

export default AsciiPerformerDock;
