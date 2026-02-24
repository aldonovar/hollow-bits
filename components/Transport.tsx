
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Square, Circle, Download, RotateCcw, Pause, SkipBack, SkipForward, Repeat, Activity, Minus, X, Maximize2, Minimize2 } from 'lucide-react';
import { TransportState } from '../types';
import { MidiDevice } from '../services/MidiService';
import { audioEngine } from '../services/audioEngine';
import { platformService } from '../services/platformService';
import { positionToBarTime } from '../services/transportStateService';
import Knob from './Knob';
import AppLogo from './AppLogo';

type AppRegionStyle = React.CSSProperties & {
    WebkitAppRegion: 'drag' | 'no-drag';
};

// --- SUB-COMPONENT: DRAGGABLE NUMBER (BPM) ---
interface DraggableNumberProps {
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    label?: string;
    color?: string;
    integerOnly?: boolean;
}

const DraggableNumber: React.FC<DraggableNumberProps> = ({
    value,
    onChange,
    min = 20,
    max = 999,
    label,
    color = 'white',
    integerOnly = false,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [inputValue, setInputValue] = useState(value.toString());
    const prevValue = useRef(value);
    const startX = useRef(0);

    // If not editing, ensure input value matches prop
    useEffect(() => {
        if (!isEditing) setInputValue(value.toString());
    }, [value, isEditing]);

    const handlePointerDown = (e: React.PointerEvent) => {
        if (isEditing) return;
        e.preventDefault();

        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);

        prevValue.current = value;
        startX.current = e.clientX;

        // Visual feedback
        document.body.style.cursor = 'ew-resize';
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        e.preventDefault();

        const deltaX = e.clientX - startX.current; // Right is positive
        if (deltaX === 0) return;

        // Sensitivity
        let step = 1;
        if (!integerOnly && e.shiftKey) step = 0.1; // Fine adjustment

        // Scale delta for comfortable feel
        const change = deltaX * (step * 0.5);

        let newVal = prevValue.current + change;
        newVal = Math.min(max, Math.max(min, newVal));

        if (integerOnly || !e.shiftKey) newVal = Math.round(newVal);
        else newVal = Number(newVal.toFixed(2));

        onChange(newVal);
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);
        document.body.style.cursor = 'default';

        // Detect click (no drag) to enter edit mode
        if (Math.abs(e.clientX - startX.current) < 3) {
            setIsEditing(true);
        }
    };

    const commitEdit = () => {
        let val = parseFloat(inputValue);
        if (isNaN(val)) val = value;
        val = Math.min(max, Math.max(min, val));
        if (integerOnly) {
            val = Math.round(val);
        }
        onChange(val);
        setIsEditing(false);
    };

    return (
        <div className="flex flex-col relative group">
            {label && (
                <span className="absolute -top-2 left-1 text-[8px] font-bold text-gray-500 bg-daw-bg px-1 z-10">{label}</span>
            )}
            <div
                className={`h-8 min-w-[60px] bg-[#1a1a1a] border rounded-[2px] overflow-hidden flex items-center relative transition-colors 
                    ${isEditing ? 'border-daw-cyan' : 'border-daw-border hover:border-gray-500'}
                `}
            >
                {isEditing ? (
                    <input
                        autoFocus
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
                        className="bg-[#050505] text-white font-mono font-bold text-sm w-full h-full text-center outline-none"
                    />
                ) : (
                    <div
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        className="w-full h-full flex items-center justify-center cursor-ew-resize select-none relative z-0"
                        title="Drag left/right to change, Shift for fine, Click to edit"
                    >
                        <span
                            className="font-mono font-bold text-sm"
                            style={{ color: color }}
                        >
                            {value}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- MAIN TRANSPORT COMPONENT ---

interface TransportProps {
    transport: TransportState;
    midiDevices: MidiDevice[];
    onPlay: () => void;
    onPause: () => void;
    onStop: () => void;
    onRecordToggle: () => void;
    onLoopToggle: () => void;
    onSkipStart: () => void;
    onSkipEnd: () => void;
    setBpm: (bpm: number) => void;
    setMasterTranspose: (semitones: number) => void;
    onExport: () => void;
    setScaleRoot?: (root: number) => void;
    setScaleType?: (type: string) => void;
    projectName?: string;
}

const Transport: React.FC<TransportProps> = React.memo(({
    transport,
    // midiDevices, // Unused
    onPlay,
    onPause,
    onStop,
    onRecordToggle,
    onLoopToggle,
    onSkipStart,
    onSkipEnd,
    setBpm,
    setMasterTranspose,
    onExport
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frequencyDataRef = useRef<Uint8Array | null>(null);
    const windowActionLockRef = useRef(false);
    const breathResetTimerRef = useRef<number | null>(null);
    const [cpuLoad, setCpuLoad] = useState(0);
    const [isMaximized, setIsMaximized] = useState(false);
    const [windowControlPulse, setWindowControlPulse] = useState<'min' | 'max' | 'close' | null>(null);
    const [logoBreathing, setLogoBreathing] = useState(false);

    const triggerLogoBreath = useCallback((durationMs: number) => {
        setLogoBreathing(true);
        if (breathResetTimerRef.current) {
            window.clearTimeout(breathResetTimerRef.current);
        }
        breathResetTimerRef.current = window.setTimeout(() => {
            setLogoBreathing(false);
            breathResetTimerRef.current = null;
        }, durationMs);
    }, []);

    useEffect(() => {
        let lastTime = performance.now();
        const smoothingFactor = 0.9;
        const interval = transport.isPlaying ? 120 : 420;

        const timer = window.setInterval(() => {
            const now = performance.now();
            const delta = now - lastTime;
            lastTime = now;
            const expected = interval;
            const excess = Math.max(0, delta - expected);
            const instantLoad = Math.min(100, (excess / Math.max(1, expected)) * 100);
            const baseAudioLoad = transport.isPlaying ? (8 + Math.random() * 4.5) : 0.8;
            setCpuLoad((prev) => (prev * smoothingFactor) + ((instantLoad + baseAudioLoad) * (1 - smoothingFactor)));
        }, interval);

        return () => window.clearInterval(timer);
    }, [transport.isPlaying]);

    useEffect(() => {
        let animationFrame: number;
        let lastFrameTime = 0;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        const render = (time: number) => {
            const targetFps = transport.isPlaying ? 60 : 16;
            const minFrameDelta = 1000 / targetFps;
            if (time - lastFrameTime < minFrameDelta) {
                animationFrame = requestAnimationFrame(render);
                return;
            }
            lastFrameTime = time;

            const width = canvas.width;
            const height = canvas.height;
            const data = audioEngine.getFrequencyDataInto(frequencyDataRef.current || undefined);
            if (frequencyDataRef.current !== data) {
                frequencyDataRef.current = data;
            }

            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, width, height);

            // Grid lines
            ctx.fillStyle = 'rgba(168, 85, 247, 0.03)';
            for (let i = 0; i < width; i += 4) ctx.fillRect(i, 0, 1, height);

            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(0.2, '#f43f5e');
            gradient.addColorStop(0.7, '#a855f7');
            gradient.addColorStop(1, 'rgba(168, 85, 247, 0.05)');
            ctx.fillStyle = gradient;

            ctx.beginPath();
            const visibleBins = transport.isPlaying ? data.length * 0.5 : data.length * 0.35;
            const sliceWidth = width * 1.0 / Math.max(1, visibleBins);
            let x = 0;
            ctx.moveTo(0, height);
            for (let i = 0; i < visibleBins; i++) {
                const raw = data[i] ?? 0;
                const intensity = transport.isPlaying ? raw : raw * 0.52;
                const y = height - ((intensity / 255.0) * height);
                ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.fill();
            animationFrame = requestAnimationFrame(render);
        };

        animationFrame = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animationFrame);
    }, [transport.isPlaying]);

    const handleGlobalReset = () => { setBpm(124); setMasterTranspose(0); };
    const buttonClass = "w-9 h-7 flex items-center justify-center rounded-[2px] border border-transparent transition-all";
    const inactiveClass = "bg-[#2d2d2d] text-gray-400 hover:bg-[#3d3d3d] hover:text-gray-200";
    const engineIsPlaying = audioEngine.getIsPlaying();
    const hasResumeOffset = audioEngine.getCurrentTime() > 0.0001;
    const isPaused = !transport.isPlaying && !engineIsPlaying && (positionToBarTime(transport) > 1.0001 || hasResumeOffset);
    const isLoopEnabled = transport.loopMode !== 'off';
    const loopBadge = transport.loopMode === 'once' ? '1' : transport.loopMode === 'infinite' ? '∞' : '';
    const loopTitle = transport.loopMode === 'off'
        ? 'Bucle: Desactivado'
        : transport.loopMode === 'once'
            ? 'Bucle: Repetir una vez'
            : 'Bucle: Repetición infinita';
    const semitoneStep = Math.max(-12, Math.min(12, Math.round(transport.masterTranspose)));
    const pitchTempoMultiplier = Math.pow(2, semitoneStep / 12);
    const effectiveBpmExact = transport.bpm * pitchTempoMultiplier;
    const displayedBpm = Math.round(effectiveBpmExact);
    const bpmMin = Math.round(20 * pitchTempoMultiplier);
    const bpmMax = Math.round(999 * pitchTempoMultiplier);

    const handleDisplayedBpmChange = (newDisplayedBpm: number) => {
        const quantizedBpm = Math.round(newDisplayedBpm);
        const clampedBpm = Math.max(bpmMin, Math.min(bpmMax, quantizedBpm));
        const normalizedBpm = clampedBpm / pitchTempoMultiplier;
        setBpm(normalizedBpm);
    };

    const isDesktop = platformService.isDesktop;

    useEffect(() => {
        if (!isDesktop) return;

        let mounted = true;

        platformService.getWindowState().then((state) => {
            if (!mounted || !state) return;
            setIsMaximized(state.isMaximized || state.isFullScreen);
        });

        const unsubscribe = platformService.onWindowStateChange((state) => {
            setIsMaximized(state.isMaximized || state.isFullScreen);
        });

        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [isDesktop]);

    useEffect(() => {
        if (!windowControlPulse) return;
        const timer = window.setTimeout(() => setWindowControlPulse(null), 180);
        return () => window.clearTimeout(timer);
    }, [windowControlPulse]);

    useEffect(() => {
        let isDisposed = false;
        let triggerTimer: number | undefined;

        const scheduleBreath = () => {
            const minDelay = transport.isPlaying ? 5200 : 9800;
            const maxDelay = transport.isPlaying ? 9400 : 17600;
            const breathDuration = transport.isPlaying ? 1080 : 1500;
            const delay = Math.round(minDelay + (Math.random() * (maxDelay - minDelay)));

            triggerTimer = window.setTimeout(() => {
                if (isDisposed) return;

                triggerLogoBreath(breathDuration);
                scheduleBreath();
            }, delay);
        };

        scheduleBreath();

        return () => {
            isDisposed = true;
            if (triggerTimer) window.clearTimeout(triggerTimer);
        };
    }, [transport.isPlaying, triggerLogoBreath]);

    useEffect(() => {
        if (!transport.isPlaying && !transport.isRecording) {
            setLogoBreathing(false);
            return;
        }

        triggerLogoBreath(transport.isPlaying ? 1080 : 1320);
    }, [transport.isPlaying, transport.isRecording, triggerLogoBreath]);

    useEffect(() => {
        if (!transport.isPlaying) return;
        if (transport.currentBeat !== 1 || transport.currentSixteenth !== 1) return;

        triggerLogoBreath(1040);
    }, [transport.currentBar, transport.currentBeat, transport.currentSixteenth, transport.isPlaying, triggerLogoBreath]);

    useEffect(() => () => {
        if (breathResetTimerRef.current) {
            window.clearTimeout(breathResetTimerRef.current);
            breathResetTimerRef.current = null;
        }
    }, []);

    const handleMinimizeWindow = () => {
        if (windowActionLockRef.current) return;
        windowActionLockRef.current = true;
        setWindowControlPulse('min');
        platformService.minimize();
        window.setTimeout(() => {
            windowActionLockRef.current = false;
        }, 150);
    };

    const handleToggleMaximizeWindow = () => {
        if (windowActionLockRef.current) return;
        windowActionLockRef.current = true;
        setWindowControlPulse('max');
        platformService.maximize();
        window.setTimeout(() => {
            windowActionLockRef.current = false;
        }, 220);
    };

    const handleCloseWindow = () => {
        if (windowActionLockRef.current) return;
        windowActionLockRef.current = true;
        setWindowControlPulse('close');
        platformService.close();
    };

    const handleTransportDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!isDesktop) return;
        const target = event.target as HTMLElement;
        if (target.closest('[data-no-window-toggle="true"]')) return;
        handleToggleMaximizeWindow();
    };

    const useFastBreath = transport.isPlaying || transport.isRecording;

    return (
        <div
            className="h-[50px] bg-[#11131a]/92 backdrop-blur-md border-b border-white/10 flex items-center px-4 justify-between select-none z-50 text-daw-text font-sans transition-[background-color,border-color] duration-500"
            style={{ WebkitAppRegion: isDesktop ? 'drag' : 'no-drag' } as AppRegionStyle}
            onDoubleClick={handleTransportDoubleClick}
        >
            <div className="flex items-center gap-6" style={{ WebkitAppRegion: 'no-drag' } as AppRegionStyle} data-no-window-toggle="true">
                {/* BRANDING */}
                <div className="flex items-center gap-2 select-none group cursor-pointer mr-4">
                    <div className="relative w-8 h-8 flex items-center justify-center logo-breath-shell">
                        <span className={`pointer-events-none absolute -inset-[6px] rounded-full logo-breathing-aura ${logoBreathing ? `logo-breathing-aura-active ${useFastBreath ? 'logo-breathing-aura-fast' : ''}` : ''}`} />
                        <div className={`relative z-10 w-8 h-8 flex items-center justify-center logo-breathing-core ${logoBreathing ? `logo-breathing-active ${useFastBreath ? 'logo-breathing-fast' : ''}` : ''}`}>
                            <AppLogo size={28} withGlow={logoBreathing} />
                        </div>
                    </div>
                    <div className="flex flex-col justify-center items-center leading-none min-w-[108px]">
                        <span className="font-black tracking-[0.3em] text-[12px] text-white text-center">HOLLOW</span>
                        <span
                            className="inline-block text-[19px] -mt-[1px] text-transparent bg-clip-text bg-gradient-to-r from-daw-violet to-daw-ruby text-center"
                            style={{
                                fontFamily: "'Brittany', 'Brittany Signature', cursive",
                                letterSpacing: '0.01em',
                                transform: 'scaleX(1.26)',
                                transformOrigin: 'center center',
                                lineHeight: 0.9
                            }}
                        >
                            bits
                        </span>
                    </div>
                </div>

                {/* CONTROLS GROUP 1: Pitch & BPM */}
                <div className="flex items-center gap-4 border-r border-daw-border pr-4 h-8">

                    {/* PITCH KNOB */}
                    <div className="flex items-center gap-2" title="Master Pitch (Varispeed: también afecta tempo)">
                        <div className="bg-[#1a1a1a] border border-daw-border rounded-[2px] p-0.5 px-1 flex items-center justify-center shadow-inner">
                            <Knob
                                value={semitoneStep}
                                min={-12}
                                max={12}
                                size={28}
                                defaultValue={0}
                                color="#f43f5e"
                                bipolar={true}
                                onChange={(val) => setMasterTranspose(Math.round(val))}
                            />
                        </div>
                        <div className="flex flex-col justify-center">
                            <span className="text-[9px] font-bold text-daw-ruby tracking-wider">PITCH</span>
                            <span className="text-[8px] font-mono text-gray-500">
                                {semitoneStep > 0 ? '+' : ''}{semitoneStep} st
                            </span>
                        </div>
                    </div>

                    {/* BPM BOX */}
                    <div className="flex items-center gap-2">
                        <DraggableNumber
                            value={displayedBpm}
                            onChange={handleDisplayedBpmChange}
                            min={bpmMin}
                            max={bpmMax}
                            label="BPM"
                            integerOnly
                        />
                    </div>

                    {/* TIME DISPLAY */}
                    <div className="flex flex-col relative group">
                        <span className="absolute -top-2 left-1 text-[8px] font-bold text-gray-500 bg-daw-bg px-1 z-10">POSICIÓN</span>
                        <div className="h-8 px-3 bg-[#1a1a1a] border border-daw-border rounded-[2px] flex items-center justify-center min-w-[80px]">
                            <span className="font-mono font-bold text-sm text-daw-violet">
                                {transport.currentBar}<span className="text-gray-600">.</span>{transport.currentBeat}<span className="text-gray-600">.</span>{transport.currentSixteenth}
                            </span>
                        </div>
                    </div>
                </div>

                {/* CONTROLS GROUP 2: Transport Buttons */}
                <div className="flex items-center gap-1 bg-[#1a1a1a] p-1 rounded-sm border border-[#2d2d2d]">
                    <button
                        onClick={onLoopToggle}
                        className={`${buttonClass} ${isLoopEnabled ? 'bg-daw-violet text-white shadow-[0_0_10px_rgba(168,85,247,0.5)] relative' : `${inactiveClass} relative`}`}
                        title={loopTitle}
                    >
                        <Repeat size={12} />
                        {loopBadge && (
                            <span className="absolute -top-1 -right-1 min-w-[12px] h-3 px-[2px] rounded-full bg-black/80 border border-daw-cyan text-[8px] leading-[10px] font-black text-daw-cyan flex items-center justify-center">
                                {loopBadge}
                            </span>
                        )}
                    </button>
                    <div className="w-px h-4 bg-[#333] mx-1"></div>

                    <button onClick={onSkipStart} className={`${buttonClass} ${inactiveClass}`} title="Ir al Inicio"><SkipBack size={12} fill="currentColor" /></button>
                    <button onClick={onStop} className={`${buttonClass} ${inactiveClass}`} title="Detener"><Square size={10} fill="currentColor" /></button>

                    <button
                        onClick={onPlay}
                        className={`${buttonClass} ${transport.isPlaying && !transport.isRecording ? 'bg-green-600 text-white shadow-[0_0_10px_rgba(22,163,74,0.5)]' : 'bg-[#2d2d2d] text-green-500 hover:text-green-400'}`}
                        title="Reproducir"
                    >
                        <Play size={12} fill="currentColor" />
                    </button>

                    <button
                        onClick={onPause}
                        className={`${buttonClass} ${isPaused ? 'bg-yellow-600 text-white shadow-[0_0_10px_rgba(202,138,4,0.5)]' : inactiveClass}`}
                        title={isPaused ? "Reanudar" : "Pausar"}
                    >
                        <Pause size={12} fill="currentColor" />
                    </button>

                    <button onClick={onSkipEnd} className={`${buttonClass} ${inactiveClass}`} title="Ir al Final"><SkipForward size={12} fill="currentColor" /></button>

                    <div className="w-px h-4 bg-[#333] mx-1"></div>
                    <button
                        onClick={onRecordToggle}
                        className={`${buttonClass} ${transport.isRecording ? 'bg-daw-ruby text-white animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-[#2d2d2d] text-daw-ruby hover:text-red-400'}`}
                        title="Grabar"
                    >
                        <Circle size={10} fill="currentColor" />
                    </button>
                </div>
            </div>

            {/* CENTER: VISUALIZER */}
            <div className="flex-1 max-w-[400px] h-[32px] mx-4 bg-[#050505] border border-gray-800 relative rounded-[2px] overflow-hidden opacity-80">
                <canvas ref={canvasRef} className="w-full h-full" />
            </div>

            {/* RIGHT: SYSTEM & EXPORT */}
            <div className="flex items-center gap-4 border-l border-daw-border pl-4 h-8" style={{ WebkitAppRegion: 'no-drag' } as AppRegionStyle} data-no-window-toggle="true">
                <div className="flex flex-col items-end justify-center">
                    <div className="w-12 h-1.5 bg-[#111] border border-gray-700 rounded-[1px] overflow-hidden">
                        <div className="h-full bg-gray-400" style={{ width: `${Math.min(100, cpuLoad)}%`, backgroundColor: cpuLoad > 50 ? '#f43f5e' : '#a855f7' }}></div>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                        <Activity size={8} className="text-gray-600" />
                        <span className="text-[8px] font-mono text-gray-500">{Math.round(cpuLoad)}% CPU</span>
                    </div>
                </div>

                <div className="h-6 w-px bg-[#333]"></div>

                <div className="flex items-center gap-2">
                    <button onClick={handleGlobalReset} className="w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white" title="Resetear Transporte"><RotateCcw size={14} /></button>
                    <button onClick={onExport} className="flex items-center gap-2 text-gray-300 hover:text-white transition-all px-3 py-1.5 bg-gradient-to-r from-[#2d2d2d] to-[#222] hover:from-daw-violet/20 hover:to-daw-ruby/20 rounded-[2px] border border-daw-border hover:border-daw-violet shadow-sm">
                        <Download size={12} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">Exportar</span>
                    </button>
                </div>

                {isDesktop && (
                    <>
                        <div className="h-6 w-px bg-[#333]"></div>
                        <div className="flex h-7 border border-white/10 rounded-[2px] overflow-hidden bg-[#101218] shadow-[0_0_0_1px_rgba(255,255,255,0.03)]" data-window-controls>
                            <button
                                onClick={handleMinimizeWindow}
                                className={`window-control-btn w-8 h-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-[transform,background-color,color,opacity] duration-150 active:scale-95 ${windowControlPulse === 'min' ? 'scale-95 bg-white/10 text-white' : ''}`}
                                title="Minimizar"
                            >
                                <Minus size={12} />
                            </button>
                            <button
                                onClick={handleToggleMaximizeWindow}
                                className={`window-control-btn w-8 h-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-[transform,background-color,color,opacity] duration-150 active:scale-95 ${windowControlPulse === 'max' ? 'scale-95 bg-white/10 text-white' : ''}`}
                                title={isMaximized ? 'Restaurar' : 'Maximizar'}
                            >
                                {isMaximized ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
                            </button>
                            <button
                                onClick={handleCloseWindow}
                                className={`window-control-btn w-8 h-full flex items-center justify-center text-gray-500 hover:text-white hover:bg-daw-ruby transition-[transform,background-color,color,opacity] duration-150 active:scale-95 ${windowControlPulse === 'close' ? 'scale-95 bg-daw-ruby text-white' : ''}`}
                                title="Cerrar"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});

export default Transport;
