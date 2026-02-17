import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

const FACE_ZOOM = 1.2;
const FACE_OFFSET_X = -50;
const FACE_OFFSET_Y = -50;
const FIT_MULTIPLIER = 1.08;
const FRAME_WIDTH = 42;
const FRAME_HEIGHT = 24;
const SHADE_RAMP = '.,-~:;=!*#$@';

const renderDonutFrame = (rotationA: number, rotationB: number): string => {
    const buffer = Array(FRAME_WIDTH * FRAME_HEIGHT).fill(' ');
    const zBuffer = Array(FRAME_WIDTH * FRAME_HEIGHT).fill(0);

    const cosA = Math.cos(rotationA);
    const sinA = Math.sin(rotationA);
    const cosB = Math.cos(rotationB);
    const sinB = Math.sin(rotationB);

    for (let theta = 0; theta < Math.PI * 2; theta += 0.07) {
        const cosTheta = Math.cos(theta);
        const sinTheta = Math.sin(theta);

        for (let phi = 0; phi < Math.PI * 2; phi += 0.02) {
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);

            const ringRadius = 1;
            const tubeRadius = 2;
            const circleX = tubeRadius + ringRadius * cosTheta;
            const circleY = ringRadius * sinTheta;

            const x = circleX * (cosB * cosPhi + sinA * sinB * sinPhi) - circleY * cosA * sinB;
            const y = circleX * (sinB * cosPhi - sinA * cosB * sinPhi) + circleY * cosA * cosB;
            const z = 5 + cosA * circleX * sinPhi + circleY * sinA;
            const depth = 1 / z;

            const screenX = Math.floor(FRAME_WIDTH / 2 + 14 * depth * x);
            const screenY = Math.floor(FRAME_HEIGHT / 2 - 8 * depth * y);

            if (screenX < 0 || screenX >= FRAME_WIDTH || screenY < 0 || screenY >= FRAME_HEIGHT) {
                continue;
            }

            const luminance =
                cosPhi * cosTheta * sinB -
                cosA * cosTheta * sinPhi -
                sinA * sinTheta +
                cosB * (cosA * sinTheta - cosTheta * sinA * sinPhi);

            if (luminance <= 0) continue;

            const index = screenX + FRAME_WIDTH * screenY;
            if (depth > zBuffer[index]) {
                zBuffer[index] = depth;
                const rampIndex = Math.min(SHADE_RAMP.length - 1, Math.floor(luminance * 8));
                buffer[index] = SHADE_RAMP[rampIndex];
            }
        }
    }

    const rows: string[] = [];
    for (let row = 0; row < FRAME_HEIGHT; row += 1) {
        rows.push(buffer.slice(row * FRAME_WIDTH, (row + 1) * FRAME_WIDTH).join(''));
    }

    return rows.join('\n');
};

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<HTMLPreElement>(null);
    const [fitScale, setFitScale] = useState(1);
    const [artFrame, setArtFrame] = useState(() => renderDonutFrame(0.8, 0.2));

    useEffect(() => {
        if (!isPlaying) {
            setArtFrame(renderDonutFrame(0.8, 0.2));
            return;
        }

        let animationFrame = 0;
        let rotationA = 0.8;
        let rotationB = 0.2;

        const tick = () => {
            rotationA += 0.06;
            rotationB += 0.03;
            setArtFrame(renderDonutFrame(rotationA, rotationB));
            animationFrame = window.setTimeout(tick, 52);
        };

        tick();
        return () => window.clearTimeout(animationFrame);
    }, [isPlaying]);

    useLayoutEffect(() => {
        const measure = () => {
            const viewport = viewportRef.current;
            const art = artRef.current;
            if (!viewport || !art) return;

            const availableWidth = viewport.clientWidth;
            const availableHeight = viewport.clientHeight;
            const naturalWidth = art.scrollWidth;
            const naturalHeight = art.scrollHeight;

            if (naturalWidth <= 0 || naturalHeight <= 0) return;

            const scaleX = availableWidth / naturalWidth;
            const scaleY = availableHeight / naturalHeight;
            const nextScale = Math.max(0.72, Math.min(6.4, Math.min(scaleX, scaleY) * FIT_MULTIPLIER));

            setFitScale((prev) => (Math.abs(prev - nextScale) < 0.01 ? prev : nextScale));
        };

        measure();

        const observer = new ResizeObserver(() => measure());
        if (viewportRef.current) observer.observe(viewportRef.current);

        window.addEventListener('resize', measure);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [artFrame]);

    return (
        <aside
            className={`h-full aspect-square shrink-0 performer-shell relative overflow-hidden ${isPlaying ? 'ascii-dock-playing' : 'ascii-dock-idle'}`}
        >
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_55%_20%,rgba(244,218,255,0.22),transparent_58%)]" />

            <div ref={viewportRef} className="relative h-full w-full performer-stage">
                <pre
                    ref={artRef}
                    aria-label="3D ASCII performer"
                    className={`anime-ascii-art ${isPlaying ? 'anime-ascii-live' : 'anime-ascii-idle'}`}
                    style={{ transform: `translate(${FACE_OFFSET_X}%, ${FACE_OFFSET_Y}%) scale(${fitScale * FACE_ZOOM})` }}
                >
                    {artFrame}
                </pre>
            </div>
        </aside>
    );
};

export default AsciiPerformerDock;
