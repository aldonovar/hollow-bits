import React, { useEffect, useRef, useCallback } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

// --- Sparkle animation config ---
// Static now.
// const BREATHING_AMPLITUDE = 2;
// const BREATHING_PERIOD = 3000;

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const animFrameRef = useRef<number>(0);
    const loadedRef = useRef(false);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !loadedRef.current) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;

        // Static draw without external transforms
        ctx.drawImage(img, 0, 0, W, H);

        // Optional: Keep loop running if we want to add other reactive effects in future, 
        // but for now it's static. We could technically stop the loop, 
        // but keeping it simplifies the structure if we re-add features.
        animFrameRef.current = requestAnimationFrame(draw);
    }, []);

    // Load image once
    useEffect(() => {
        const img = new Image();
        img.src = 'performer/performer.png';
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
            className={`h-full aspect-square shrink-0 relative overflow-hidden transition-all duration-300 border-2 ${isPlaying ? 'border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'border-white/20'} ${isPlaying ? 'ascii-dock-playing' : 'ascii-dock-idle'}`}
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
