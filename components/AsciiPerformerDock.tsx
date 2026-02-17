import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface AsciiPerformerDockProps {
    isPlaying: boolean;
}

const FACE_ZOOM = 1.42;
const FACE_OFFSET_X = -50;
const FACE_OFFSET_Y = -50;
const FIT_MULTIPLIER = 1.34;

const normalizeFrame = (frame: string): string => {
    const lines = frame.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n');
    const nonEmpty = lines.filter((line) => line.trim().length > 0);
    const minIndent = nonEmpty.length
        ? Math.min(...nonEmpty.map((line) => line.match(/^\s*/)?.[0].length ?? 0))
        : 0;

    return lines.map((line) => line.slice(minIndent)).join('\n');
};

const RAW_FRAMES = [
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  0 | |        ;
             |      | |  --  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                    .-'/  ||  \'-.
                 .-'  /___||___\  '-.
               .'    /   /||\   \    '.
              /_____/___/ || \___\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | -  - | |        ;
             |      | |  --  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                    .-'/  ||  \'-.
                 .-'  /___||___\  '-.
               .'    /   /||\   \    '.
              /_____/___/ || \___\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  0 | |        ;
             |      | |  --  | |        |
             |      |  \_~~_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                    .-'/  ||  \'-.
                 .-'  /___||___\  '-.
               .'    /   /||\   \    '.
              /_____/___/ || \___\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  0 | |        ;
             |      | |  __  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                   .-'/   ||   \'-.
                .-'  /____||____\  '-.
              .'    /    /||\    \    '.
             /_____/____/ || \____\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  0 | |        ;
             |      | |  --  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                  .-'/    ||    \'-.
               .-'  /_____||_____\  '-.
             .'    /     /||\     \    '.
            /_____/_____/ || \_____\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  - | |        ;
             |      | |  ~~  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                   .-'/   ||   \'-.
                .-'  /____||____\  '-.
              .'    /    /||\    \    '.
             /_____/____/ || \____\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | -  - | |        ;
             |      | |  --  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                    .-'/  ||  \'-.
                 .-'  /___||___\  '-.
               .'    /   /||\   \    '.
              /_____/___/ || \___\_____\
    `,
    String.raw`
                     .-""""""""-.
                  .-'   _  _     '-.
                .'    .' \/ '.      '.
               /     /  .--.  \       \
              /     |  /    \  |       \
             ;      | | 0  0 | |        ;
             |      | |  --  | |        |
             |      |  \_==_/  |        |
             ;      |  /____\  |        ;
              \      \  \__/  /        /
               '.     '.___.'       .'
                 '-._         _..-'
                      '"-...-"'
                    .-'/  ||  \'-.
                 .-'  /___||___\  '-.
               .'    /   /||\   \    '.
              /_____/___/ || \___\_____\
    `
] as const;

const ANIME_GESTURE_FRAMES = RAW_FRAMES.map(normalizeFrame);
const PLAY_SEQUENCE = [0, 1, 0, 2, 0, 3, 4, 5, 4, 3, 2, 1, 0, 6, 0, 7] as const;

const AsciiPerformerDock: React.FC<AsciiPerformerDockProps> = ({ isPlaying }) => {
    const viewportRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<HTMLPreElement>(null);
    const [fitScale, setFitScale] = useState(1);
    const [sequenceStep, setSequenceStep] = useState(0);

    const activeFrame = useMemo(
        () => (isPlaying ? ANIME_GESTURE_FRAMES[PLAY_SEQUENCE[sequenceStep]] : ANIME_GESTURE_FRAMES[0]),
        [isPlaying, sequenceStep]
    );

    useEffect(() => {
        if (!isPlaying) {
            setSequenceStep(0);
            return;
        }

        const interval = window.setInterval(() => {
            setSequenceStep((previous) => (previous + 1) % PLAY_SEQUENCE.length);
        }, 120);

        return () => window.clearInterval(interval);
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
    }, [activeFrame]);

    return (
        <aside
            className={`h-full aspect-square shrink-0 performer-shell relative overflow-hidden ${isPlaying ? 'ascii-dock-playing' : 'ascii-dock-idle'}`}
        >
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_55%_20%,rgba(244,218,255,0.22),transparent_58%)]" />

            <div ref={viewportRef} className="relative h-full w-full performer-stage">
                <pre
                    ref={artRef}
                    aria-label="Anime ASCII performer"
                    className={`anime-ascii-art ${isPlaying ? 'anime-ascii-live' : 'anime-ascii-idle'}`}
                    style={{ transform: `translate(${FACE_OFFSET_X}%, ${FACE_OFFSET_Y}%) scale(${fitScale * FACE_ZOOM})` }}
                >
                    {activeFrame}
                </pre>
            </div>
        </aside>
    );
};

export default AsciiPerformerDock;
