import React, { useEffect, useRef, useCallback } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
    suspendAnimation?: boolean;
}

interface StageParticle {
    x: number;
    y: number;
    depth: number;
    size: number;
    driftX: number;
    driftY: number;
    twinkleSpeed: number;
    phase: number;
    hue: number;
    alpha: number;
}

interface RigPatchDefinition {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    feather: number;
}

interface RigPatchRuntime {
    def: RigPatchDefinition;
    layer: HTMLCanvasElement;
    layerCtx: CanvasRenderingContext2D;
    mask: HTMLCanvasElement;
}

interface PatchTransform {
    dx?: number;
    dy?: number;
    scaleX?: number;
    scaleY?: number;
    rotation?: number;
    shearX?: number;
    shearY?: number;
    opacity?: number;
}

interface BlinkState {
    nextBlinkAtMs: number;
    activeStartMs: number;
    durationMs: number;
    amount: number;
}

const FRAME_CANVAS_SIZE = 384;
const BASE_PERFORMER_IMAGE_SRC = `${import.meta.env.BASE_URL}performer/performer.png`;
const PARTICLE_COUNT = 72;
const MAX_FRAME_DELTA_MS = 64;

const RIG_PATCHES: RigPatchDefinition[] = [
    { id: 'torso', x: 156, y: 242, w: 228, h: 142, feather: 16 },
    { id: 'shoulders', x: 178, y: 258, w: 178, h: 124, feather: 14 },
    { id: 'head', x: 160, y: 94, w: 190, h: 202, feather: 14 },
    { id: 'bangs', x: 142, y: 72, w: 170, h: 236, feather: 18 },
    { id: 'pony', x: 0, y: 144, w: 202, h: 240, feather: 20 },
    { id: 'eye', x: 246, y: 172, w: 42, h: 32, feather: 6 },
    { id: 'mouth', x: 248, y: 216, w: 96, h: 56, feather: 8 }
];

const clamp = (value: number, min: number, max: number): number => {
    return Math.max(min, Math.min(max, value));
};

const mix = (from: number, to: number, amount: number): number => {
    return from + ((to - from) * amount);
};

const createSeededRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

const randomRange = (random: () => number, min: number, max: number): number => {
    return min + ((max - min) * random());
};

const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load performer image: ${src}`));
        img.src = src;
    });
};

const createSoftRectMask = (width: number, height: number, feather: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return canvas;
    }

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.fillRect(0, 0, width, height);

    const safeFeatherX = Math.max(1, Math.min(Math.floor(width / 2), feather));
    const safeFeatherY = Math.max(1, Math.min(Math.floor(height / 2), feather));

    const horizontal = ctx.createLinearGradient(0, 0, width, 0);
    horizontal.addColorStop(0, 'rgba(255,255,255,0)');
    horizontal.addColorStop(safeFeatherX / width, 'rgba(255,255,255,1)');
    horizontal.addColorStop(1 - (safeFeatherX / width), 'rgba(255,255,255,1)');
    horizontal.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = horizontal;
    ctx.fillRect(0, 0, width, height);

    const vertical = ctx.createLinearGradient(0, 0, 0, height);
    vertical.addColorStop(0, 'rgba(255,255,255,0)');
    vertical.addColorStop(safeFeatherY / height, 'rgba(255,255,255,1)');
    vertical.addColorStop(1 - (safeFeatherY / height), 'rgba(255,255,255,1)');
    vertical.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = vertical;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';

    return canvas;
};

const createPatchRuntime = (def: RigPatchDefinition): RigPatchRuntime | null => {
    const layer = document.createElement('canvas');
    layer.width = def.w;
    layer.height = def.h;

    const layerCtx = layer.getContext('2d');
    if (!layerCtx) {
        return null;
    }

    return {
        def,
        layer,
        layerCtx,
        mask: createSoftRectMask(def.w, def.h, def.feather)
    };
};

const createParticleField = (count: number): StageParticle[] => {
    const random = createSeededRandom(0x9a53e5d1);
    const particles: StageParticle[] = [];

    for (let i = 0; i < count; i += 1) {
        const depth = 0.28 + (random() * 0.72);
        particles.push({
            x: random(),
            y: random(),
            depth,
            size: 1 + (random() * (depth > 0.72 ? 2.4 : 1.6)),
            driftX: (random() - 0.5) * 0.09,
            driftY: -0.016 - (random() * 0.065),
            twinkleSpeed: 0.9 + (random() * 1.9),
            phase: random() * Math.PI * 2,
            hue: random() < 0.75 ? 286 + (random() * 34) : 198 + (random() * 24),
            alpha: 0.1 + (random() * 0.25)
        });
    }

    return particles;
};

const drawParticleField = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeSec: number,
    isPlaying: boolean,
    particles: StageParticle[]
) => {
    const activity = isPlaying ? 1 : 0.5;

    const glowCenterX = width * (0.52 + (Math.sin(timeSec * 0.35) * 0.08));
    const glowCenterY = height * (0.24 + (Math.cos(timeSec * 0.28) * 0.06));
    const ambient = ctx.createRadialGradient(
        glowCenterX,
        glowCenterY,
        width * 0.04,
        glowCenterX,
        glowCenterY,
        width * 0.82
    );

    ambient.addColorStop(0, 'rgba(132, 52, 186, 0.34)');
    ambient.addColorStop(0.58, 'rgba(28, 14, 56, 0.26)');
    ambient.addColorStop(1, 'rgba(8, 6, 16, 0.56)');

    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';

    for (const particle of particles) {
        const driftTime = timeSec * activity;

        const normalizedX = (
            particle.x
            + (driftTime * particle.driftX)
            + (Math.sin(driftTime * 0.9 + particle.phase) * 0.022 * particle.depth)
        );
        const normalizedY = (
            particle.y
            + (driftTime * particle.driftY)
            + (Math.cos(driftTime * 0.78 + particle.phase) * 0.015 * particle.depth)
        );

        const wrappedX = ((normalizedX % 1) + 1) % 1;
        const wrappedY = ((normalizedY % 1) + 1) % 1;

        const twinkle = 0.5 + (0.5 * Math.sin((timeSec * particle.twinkleSpeed * 2.2) + particle.phase));
        const alpha = particle.alpha * (0.5 + (twinkle * 0.45)) * (0.45 + (particle.depth * 0.72));
        const size = Math.max(1, Math.round(particle.size));

        const px = Math.round(wrappedX * width);
        const py = Math.round(wrappedY * height);

        ctx.fillStyle = `hsla(${Math.round(particle.hue)}, 100%, 78%, ${alpha.toFixed(3)})`;
        ctx.fillRect(px, py, size, size);

        ctx.fillStyle = `hsla(${Math.round(particle.hue)}, 100%, 92%, ${(alpha * 0.62).toFixed(3)})`;
        ctx.fillRect(px, py, 1, 1);
    }

    const sweepSpeed = isPlaying ? 46 : 18;
    const sweepX = ((timeSec * sweepSpeed) % (width + 160)) - 80;
    const sweep = ctx.createLinearGradient(sweepX - 36, 0, sweepX + 36, 0);
    sweep.addColorStop(0, 'rgba(0,0,0,0)');
    sweep.addColorStop(0.5, 'rgba(255, 193, 255, 0.082)');
    sweep.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(sweepX - 40, 0, 80, height);

    ctx.restore();
};

const drawPatch = (
    targetCtx: CanvasRenderingContext2D,
    sourceCanvas: HTMLCanvasElement,
    runtime: RigPatchRuntime,
    transform: PatchTransform = {}
) => {
    const {
        dx = 0,
        dy = 0,
        scaleX = 1,
        scaleY = 1,
        rotation = 0,
        shearX = 0,
        shearY = 0,
        opacity = 1
    } = transform;

    const { def, layer, layerCtx, mask } = runtime;

    layerCtx.clearRect(0, 0, def.w, def.h);
    layerCtx.imageSmoothingEnabled = false;

    layerCtx.save();
    layerCtx.translate((def.w / 2) + dx, (def.h / 2) + dy);
    layerCtx.rotate(rotation);
    layerCtx.transform(1, shearY, shearX, 1, 0, 0);
    layerCtx.scale(scaleX, scaleY);
    layerCtx.translate(-(def.w / 2), -(def.h / 2));
    layerCtx.drawImage(sourceCanvas, def.x, def.y, def.w, def.h, 0, 0, def.w, def.h);
    layerCtx.restore();

    layerCtx.globalCompositeOperation = 'destination-in';
    layerCtx.drawImage(mask, 0, 0, def.w, def.h);
    layerCtx.globalCompositeOperation = 'source-over';

    targetCtx.save();
    targetCtx.globalAlpha = opacity;
    targetCtx.imageSmoothingEnabled = false;
    targetCtx.drawImage(layer, def.x, def.y);
    targetCtx.restore();
};

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying, suspendAnimation = false }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const patchMapRef = useRef<Map<string, RigPatchRuntime>>(new Map());
    const particlesRef = useRef<StageParticle[]>(createParticleField(PARTICLE_COUNT));
    const randomRef = useRef<() => number>(createSeededRandom(0x21a4ce7d));
    const blinkStateRef = useRef<BlinkState>({
        nextBlinkAtMs: 900,
        activeStartMs: -1,
        durationMs: 120,
        amount: 0
    });

    const animFrameRef = useRef<number>(0);
    const lastTimestampRef = useRef<number | null>(null);
    const sceneClockMsRef = useRef(0);
    const loadedRef = useRef(false);
    const isPlayingRef = useRef(isPlaying);
    const suspendAnimationRef = useRef(suspendAnimation);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
    }, [isPlaying]);

    useEffect(() => {
        suspendAnimationRef.current = suspendAnimation;
    }, [suspendAnimation]);

    const updateBlinkState = useCallback((timeMs: number) => {
        const blink = blinkStateRef.current;
        const random = randomRef.current;

        if (blink.activeStartMs < 0 && timeMs >= blink.nextBlinkAtMs) {
            blink.activeStartMs = timeMs;
            blink.durationMs = randomRange(random, 86, 138);
        }

        if (blink.activeStartMs >= 0) {
            const progress = (timeMs - blink.activeStartMs) / blink.durationMs;
            if (progress >= 1) {
                blink.activeStartMs = -1;
                blink.amount = 0;
                const minDelay = isPlayingRef.current ? 850 : 1500;
                const maxDelay = isPlayingRef.current ? 2300 : 3600;
                blink.nextBlinkAtMs = timeMs + randomRange(random, minDelay, maxDelay);
                return;
            }

            const shaped = Math.sin(progress * Math.PI);
            blink.amount = shaped * shaped;
            return;
        }

        blink.amount = 0;
    }, []);

    const renderScene = useCallback(() => {
        const canvas = canvasRef.current;
        const sourceCanvas = sourceCanvasRef.current;
        if (!canvas || !sourceCanvas || !loadedRef.current) {
            return;
        }

        const ctx = contextRef.current || canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        contextRef.current = ctx;

        const width = canvas.width;
        const height = canvas.height;
        const timeSec = sceneClockMsRef.current / 1000;

        drawParticleField(ctx, width, height, timeSec, isPlayingRef.current, particlesRef.current);

        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1;
        ctx.drawImage(sourceCanvas, 0, 0, width, height);

        const performanceMix = isPlayingRef.current ? 1 : 0.38;
        const breath = Math.sin((timeSec * Math.PI * 2 * 0.28) - 0.42);
        const grooveA = Math.sin((timeSec * Math.PI * 2 * (isPlayingRef.current ? 2.15 : 0.78)) + 0.18);
        const grooveB = Math.sin((timeSec * Math.PI * 2 * (isPlayingRef.current ? 3.8 : 1.18)) + 1.12);
        const groove = (grooveA * 0.72) + (grooveB * 0.28);

        const headDx = ((Math.sin((timeSec * Math.PI * 2 * 1.34) + 0.26) * 1.9) + (groove * 0.65)) * performanceMix;
        const headDy = ((Math.cos((timeSec * Math.PI * 2 * 1.07) - 0.28) * 1.2) + (breath * 0.92)) * performanceMix;
        const headRotation = ((Math.sin((timeSec * Math.PI * 2 * 1.12) + 0.14) * 0.022) + (groove * 0.007)) * performanceMix;

        const ponyLag = ((Math.sin((timeSec * Math.PI * 2 * 0.92) - 0.22) * 2.7) + (Math.sin((timeSec * Math.PI * 2 * 3.1) + 0.52) * 1.35)) * performanceMix;
        const bangsLag = ((headDx * 1.05) + (Math.sin((timeSec * Math.PI * 2 * 4.1) + 0.08) * 1.1)) * performanceMix;

        const blinkAmount = clamp(blinkStateRef.current.amount, 0, 1);

        const gazeX = ((Math.sin((timeSec * Math.PI * 2 * 0.62) + 0.5) * 0.56) + (Math.sin((timeSec * Math.PI * 2 * 1.42) + 1.26) * 0.32)) * performanceMix;
        const gazeY = (Math.cos((timeSec * Math.PI * 2 * 0.54) - 0.1) * 0.36) * performanceMix;

        const vocalA = 0.5 + (0.5 * Math.sin((timeSec * Math.PI * 2 * (isPlayingRef.current ? 4.6 : 1.4)) + 0.23));
        const vocalB = 0.5 + (0.5 * Math.sin((timeSec * Math.PI * 2 * (isPlayingRef.current ? 7.4 : 2.1)) + 1.1));
        const phrase = 0.58 + (0.42 * (0.5 + (0.5 * Math.sin((timeSec * Math.PI * 2 * 0.72) + 1.34))));
        const mouthOpen = clamp(((vocalA * 0.62) + (vocalB * 0.38)) * phrase * performanceMix + ((0.12 + (Math.max(0, breath) * 0.2)) * (1 - performanceMix)), 0, 1);

        const patches = patchMapRef.current;
        const torso = patches.get('torso');
        const shoulders = patches.get('shoulders');
        const head = patches.get('head');
        const bangs = patches.get('bangs');
        const pony = patches.get('pony');
        const eye = patches.get('eye');
        const mouth = patches.get('mouth');

        if (torso) {
            drawPatch(ctx, sourceCanvas, torso, {
                dx: headDx * 0.22,
                dy: (Math.max(0, breath) * 1.4) + (groove * 0.25 * performanceMix),
                scaleX: 1 + (Math.max(0, breath) * 0.013 * performanceMix),
                scaleY: 1 + (Math.max(0, breath) * 0.031 * performanceMix),
                shearX: headDx * 0.003
            });
        }

        if (shoulders) {
            drawPatch(ctx, sourceCanvas, shoulders, {
                dx: headDx * 0.35,
                dy: (Math.max(0, breath) * 0.9) + (groove * 0.5 * performanceMix),
                scaleY: 1 + (Math.max(0, breath) * 0.012 * performanceMix),
                shearX: headDx * 0.0025
            });
        }

        if (head) {
            drawPatch(ctx, sourceCanvas, head, {
                dx: headDx,
                dy: headDy,
                rotation: headRotation,
                shearX: headDx * 0.0036,
                scaleX: 1 + (Math.max(0, breath) * 0.004),
                scaleY: 1 + (Math.max(0, breath) * 0.008)
            });
        }

        if (bangs) {
            drawPatch(ctx, sourceCanvas, bangs, {
                dx: bangsLag,
                dy: Math.abs(bangsLag) * 0.15,
                shearX: bangsLag * 0.01,
                opacity: 0.99
            });
        }

        if (pony) {
            drawPatch(ctx, sourceCanvas, pony, {
                dx: ponyLag,
                dy: Math.sin((timeSec * Math.PI * 2 * 1.9) + 0.6) * 1.4 * performanceMix,
                shearY: ponyLag * 0.008,
                rotation: ponyLag * 0.003,
                opacity: 0.98
            });
        }

        if (eye) {
            drawPatch(ctx, sourceCanvas, eye, {
                dx: gazeX + (headDx * 0.18),
                dy: gazeY + (blinkAmount * 1.6),
                scaleY: clamp(1 - (blinkAmount * 0.84), 0.2, 1),
                shearX: gazeX * 0.01
            });
        }

        if (mouth) {
            drawPatch(ctx, sourceCanvas, mouth, {
                dx: headDx * 0.16,
                dy: (mouthOpen * 2.05) + (headDy * 0.14),
                scaleX: 1 - (mouthOpen * 0.11),
                scaleY: 1 + (mouthOpen * 0.34),
                shearX: headDx * 0.0028
            });
        }

        const mouthLineY = Math.round(242 + (mouthOpen * 4) + (headDy * 0.2));
        const mouthLineX = Math.round(270 + (headDx * 0.2));
        const mouthLineWidth = Math.round(44 + (mouthOpen * 10));

        ctx.fillStyle = `rgba(52, 28, 96, ${(0.18 + (mouthOpen * 0.42)).toFixed(3)})`;
        ctx.fillRect(mouthLineX, mouthLineY, mouthLineWidth, 1 + Math.round(mouthOpen * 1.5));

        if (blinkAmount < 0.25) {
            const eyeSparkX = Math.round(272 + (gazeX * 0.6) + (headDx * 0.18));
            const eyeSparkY = Math.round(185 + (gazeY * 0.5) + (headDy * 0.12));
            const eyeSparkAlpha = mix(0.26, 0.52, performanceMix);
            ctx.fillStyle = `rgba(255, 235, 255, ${eyeSparkAlpha.toFixed(3)})`;
            ctx.fillRect(eyeSparkX, eyeSparkY, 1, 1);
        }
    }, []);

    const renderStaticFrame = useCallback(() => {
        const canvas = canvasRef.current;
        const sourceCanvas = sourceCanvasRef.current;
        if (!canvas || !sourceCanvas || !loadedRef.current) {
            return;
        }

        const ctx = contextRef.current || canvas.getContext('2d');
        if (!ctx) {
            return;
        }
        contextRef.current = ctx;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);
        const ambient = ctx.createRadialGradient(
            width * 0.52,
            height * 0.22,
            width * 0.04,
            width * 0.52,
            height * 0.22,
            width * 0.8
        );
        ambient.addColorStop(0, 'rgba(132, 52, 186, 0.24)');
        ambient.addColorStop(0.58, 'rgba(28, 14, 56, 0.2)');
        ambient.addColorStop(1, 'rgba(8, 6, 16, 0.48)');
        ctx.fillStyle = ambient;
        ctx.fillRect(0, 0, width, height);

        ctx.imageSmoothingEnabled = false;
        ctx.globalAlpha = 1;
        ctx.drawImage(sourceCanvas, 0, 0, width, height);
    }, []);

    const draw = useCallback((timestamp: number) => {
        if (!loadedRef.current) {
            animFrameRef.current = requestAnimationFrame(draw);
            return;
        }

        if (suspendAnimationRef.current) {
            renderStaticFrame();
            animFrameRef.current = 0;
            return;
        }

        const previous = lastTimestampRef.current ?? timestamp;
        const deltaMs = clamp(timestamp - previous, 0, MAX_FRAME_DELTA_MS);
        lastTimestampRef.current = timestamp;

        const playbackRate = isPlayingRef.current ? 1 : 0.55;
        sceneClockMsRef.current += deltaMs * playbackRate;

        updateBlinkState(sceneClockMsRef.current);
        renderScene();

        animFrameRef.current = requestAnimationFrame(draw);
    }, [renderScene, renderStaticFrame, updateBlinkState]);

    useEffect(() => {
        let cancelled = false;

        const setup = async () => {
            const image = await loadImage(BASE_PERFORMER_IMAGE_SRC);
            if (cancelled) return;

            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = FRAME_CANVAS_SIZE;
            sourceCanvas.height = FRAME_CANVAS_SIZE;

            const sourceCtx = sourceCanvas.getContext('2d');
            if (!sourceCtx) {
                return;
            }

            sourceCtx.clearRect(0, 0, FRAME_CANVAS_SIZE, FRAME_CANVAS_SIZE);
            sourceCtx.imageSmoothingEnabled = false;
            sourceCtx.drawImage(image, 0, 0, FRAME_CANVAS_SIZE, FRAME_CANVAS_SIZE);
            sourceCanvasRef.current = sourceCanvas;

            const patchMap = new Map<string, RigPatchRuntime>();
            RIG_PATCHES.forEach((definition) => {
                const runtime = createPatchRuntime(definition);
                if (runtime) {
                    patchMap.set(definition.id, runtime);
                }
            });
            patchMapRef.current = patchMap;

            const canvas = canvasRef.current;
            if (canvas) {
                canvas.width = FRAME_CANVAS_SIZE;
                canvas.height = FRAME_CANVAS_SIZE;
                contextRef.current = canvas.getContext('2d');
            }

            sceneClockMsRef.current = 0;
            lastTimestampRef.current = null;
            loadedRef.current = true;

            if (suspendAnimationRef.current) {
                renderStaticFrame();
                animFrameRef.current = 0;
                return;
            }

            if (!animFrameRef.current) {
                animFrameRef.current = requestAnimationFrame(draw);
            }
        };

        void setup().catch(() => {
            if (cancelled) return;
            loadedRef.current = false;
            sourceCanvasRef.current = null;
            patchMapRef.current = new Map();
        });

        return () => {
            cancelled = true;
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
            }
            loadedRef.current = false;
            sourceCanvasRef.current = null;
            patchMapRef.current = new Map();
            contextRef.current = null;
            animFrameRef.current = 0;
            sceneClockMsRef.current = 0;
            lastTimestampRef.current = null;
        };
    }, [draw, renderStaticFrame]);

    useEffect(() => {
        if (!loadedRef.current) return;

        if (suspendAnimation) {
            if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
                animFrameRef.current = 0;
            }
            renderStaticFrame();
            return;
        }

        if (!animFrameRef.current) {
            lastTimestampRef.current = null;
            animFrameRef.current = requestAnimationFrame(draw);
        }
    }, [draw, renderStaticFrame, suspendAnimation]);

    return (
        <aside
            className={`performer-shell h-full aspect-square shrink-0 relative overflow-hidden transition-all duration-300 border-2 ${isPlaying ? 'border-purple-500/40 shadow-[0_0_10px_rgba(168,85,247,0.2)]' : 'border-white/20'} ${isPlaying ? 'ascii-dock-playing' : 'ascii-dock-idle'}`}
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

export default React.memo(AsciiPerformerDock);
