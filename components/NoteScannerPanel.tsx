import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Sparkles, Wand2, X } from 'lucide-react';
import { Note, Track, TrackType } from '../types';
import {
    DEFAULT_SCAN_SETTINGS,
    NoteScanProgress,
    NoteScanResult,
    noteScannerService
} from '../services/noteScannerService';
import SynthesiaVisualizer from './SynthesiaVisualizer';

interface ApplyScanPayload {
    notes: Note[];
    clipName: string;
    sourceTrackId: string;
    sourceClipId: string;
}

interface NoteScannerPanelProps {
    isOpen: boolean;
    tracks: Track[];
    bpm: number;
    selectedTrackId: string | null;
    onClose: () => void;
    onCreateMidiTrack: (payload: ApplyScanPayload) => void;
    onInsertIntoTrack: (trackId: string, payload: ApplyScanPayload) => void;
}

interface AudioSourceOption {
    id: string;
    trackId: string;
    clipId: string;
    label: string;
    clipName: string;
    trackColor: string;
    buffer: AudioBuffer;
}

const SCAN_PRESETS = {
    ultra: {
        label: 'Ultra Poly',
        description: 'General polifonico de alta precision',
        settings: {
            ...DEFAULT_SCAN_SETTINGS,
            mode: 'polyphonic' as const,
            sensitivity: 0.78,
            maxPolyphony: 6,
            minMidi: 21,
            maxMidi: 108,
            quantize: false,
            quantizeStep16th: 1,
            minDuration16th: 0.5
        }
    },
    vocal: {
        label: 'Vocal Lead',
        description: 'Monofonico enfocado en melodias vocales',
        settings: {
            ...DEFAULT_SCAN_SETTINGS,
            mode: 'quick' as const,
            sensitivity: 0.72,
            maxPolyphony: 1,
            minMidi: 40,
            maxMidi: 96,
            quantize: false,
            quantizeStep16th: 1,
            minDuration16th: 0.4
        }
    },
    bass: {
        label: 'Bassline',
        description: 'Rango bajo con duraciones limpias',
        settings: {
            ...DEFAULT_SCAN_SETTINGS,
            mode: 'quick' as const,
            sensitivity: 0.69,
            maxPolyphony: 1,
            minMidi: 24,
            maxMidi: 72,
            quantize: true,
            quantizeStep16th: 1,
            minDuration16th: 0.6
        }
    },
    piano: {
        label: 'Piano Poly',
        description: 'Acordes y arpegios con mayor densidad',
        settings: {
            ...DEFAULT_SCAN_SETTINGS,
            mode: 'polyphonic' as const,
            sensitivity: 0.76,
            maxPolyphony: 8,
            minMidi: 21,
            maxMidi: 108,
            quantize: false,
            quantizeStep16th: 1,
            minDuration16th: 0.45
        }
    }
} as const;

type ScanPresetKey = keyof typeof SCAN_PRESETS;

interface ScanResultEntry {
    result: NoteScanResult;
    preset: ScanPresetKey;
    scannedAt: number;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

const formatMidiNote = (midi: number): string => {
    const clamped = Math.min(127, Math.max(0, Math.round(midi)));
    const note = NOTE_NAMES[clamped % 12];
    const octave = Math.floor(clamped / 12) - 1;
    return `${note}${octave}`;
};

const NoteScannerPanel: React.FC<NoteScannerPanelProps> = ({
    isOpen,
    tracks,
    bpm,
    selectedTrackId,
    onClose,
    onCreateMidiTrack,
    onInsertIntoTrack
}) => {
    const [selectedSourceId, setSelectedSourceId] = useState<string>('');
    const [scanResultsBySource, setScanResultsBySource] = useState<Record<string, ScanResultEntry>>({});
    const [activeResultSourceId, setActiveResultSourceId] = useState<string>('');
    const [progress, setProgress] = useState<NoteScanProgress | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [batchSummary, setBatchSummary] = useState<string | null>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [targetMidiTrackId, setTargetMidiTrackId] = useState<string>('');
    const [scanPreset, setScanPreset] = useState<ScanPresetKey>('ultra');

    const abortControllerRef = useRef<AbortController | null>(null);

    const audioSources = useMemo<AudioSourceOption[]>(() => {
        const options: AudioSourceOption[] = [];
        tracks.forEach((track) => {
            if (track.type !== TrackType.AUDIO) return;
            track.clips.forEach((clip) => {
                if (!clip.buffer) return;
                options.push({
                    id: `${track.id}:${clip.id}`,
                    trackId: track.id,
                    clipId: clip.id,
                    label: `${track.name} / ${clip.name}`,
                    clipName: clip.name,
                    trackColor: track.color,
                    buffer: clip.buffer
                });
            });
        });
        return options;
    }, [tracks]);

    const midiTracks = useMemo(() => tracks.filter((track) => track.type === TrackType.MIDI), [tracks]);

    const selectedSource = useMemo(() => {
        return audioSources.find((source) => source.id === selectedSourceId) || null;
    }, [audioSources, selectedSourceId]);

    const activeResultSource = useMemo(() => {
        if (activeResultSourceId) {
            return audioSources.find((source) => source.id === activeResultSourceId) || null;
        }
        return selectedSource;
    }, [activeResultSourceId, audioSources, selectedSource]);

    const activeResultEntry = useMemo(() => {
        const sourceId = activeResultSource?.id;
        if (!sourceId) return null;
        return scanResultsBySource[sourceId] || null;
    }, [activeResultSource, scanResultsBySource]);

    useEffect(() => {
        if (!isOpen) return;

        if (!selectedSourceId && audioSources.length > 0) {
            setSelectedSourceId(audioSources[0].id);
        }

        if (audioSources.length > 0 && !audioSources.some((source) => source.id === selectedSourceId)) {
            setSelectedSourceId(audioSources[0].id);
        }
    }, [audioSources, isOpen, selectedSourceId]);

    useEffect(() => {
        if (!activeResultSourceId) {
            if (selectedSourceId && scanResultsBySource[selectedSourceId]) {
                setActiveResultSourceId(selectedSourceId);
            }
            return;
        }

        if (scanResultsBySource[activeResultSourceId]) return;

        const fallback = Object.keys(scanResultsBySource)[0] || '';
        setActiveResultSourceId(fallback);
    }, [activeResultSourceId, scanResultsBySource, selectedSourceId]);

    useEffect(() => {
        const selectedTrackIsMidi = midiTracks.some((track) => track.id === selectedTrackId);
        if (selectedTrackIsMidi && selectedTrackId) {
            setTargetMidiTrackId(selectedTrackId);
            return;
        }

        if (midiTracks.length > 0 && !midiTracks.some((track) => track.id === targetMidiTrackId)) {
            setTargetMidiTrackId(midiTracks[0].id);
        }
    }, [midiTracks, selectedTrackId, targetMidiTrackId]);

    useEffect(() => {
        if (isOpen) return;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsScanning(false);
    }, [isOpen]);

    const runSingleScan = async (
        source: AudioSourceOption,
        signal: AbortSignal,
        progressMapper?: (progress: NoteScanProgress) => NoteScanProgress
    ): Promise<NoteScanResult> => {
        return noteScannerService.scanAudioBuffer(
            source.buffer,
            bpm,
            SCAN_PRESETS[scanPreset].settings,
            (nextProgress) => {
                setProgress(progressMapper ? progressMapper(nextProgress) : nextProgress);
            },
            signal
        );
    };

    const handleScan = async () => {
        if (!selectedSource) return;

        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setError(null);
        setBatchSummary(null);
        setIsScanning(true);
        setProgress({ stage: 'preparing', progress: 0, message: 'Inicializando escaneo de notas...' });

        try {
            const scanResult = await runSingleScan(selectedSource, abortControllerRef.current.signal);

            setScanResultsBySource((prev) => ({
                ...prev,
                [selectedSource.id]: {
                    result: scanResult,
                    preset: scanPreset,
                    scannedAt: Date.now()
                }
            }));
            setActiveResultSourceId(selectedSource.id);
        } catch (scanError) {
            const rawMessage = scanError instanceof Error ? scanError.message : 'No se pudo completar el escaneo.';
            const message = /fragment\s+shader|webgl|gpu/i.test(rawMessage)
                ? 'El modo GPU no es compatible en este equipo. Reintentamos automaticamente en CPU estable.'
                : rawMessage;
            setError(message);
        } finally {
            setIsScanning(false);
            abortControllerRef.current = null;
        }
    };

    const handleBatchScan = async () => {
        if (audioSources.length === 0) return;

        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        setError(null);
        setBatchSummary(null);
        setIsScanning(true);
        setProgress({ stage: 'preparing', progress: 0, message: 'Preparando escaneo batch...' });

        const nextEntries: Record<string, ScanResultEntry> = {};
        let completed = 0;
        let failed = 0;

        try {
            for (let index = 0; index < audioSources.length; index++) {
                const source = audioSources[index];

                const base = index / audioSources.length;
                const span = 1 / audioSources.length;

                try {
                    const scanResult = await runSingleScan(
                        source,
                        abortControllerRef.current.signal,
                        (chunkProgress) => ({
                            ...chunkProgress,
                            progress: Math.min(1, base + (chunkProgress.progress * span)),
                            message: `Batch ${index + 1}/${audioSources.length} · ${source.clipName} · ${chunkProgress.message}`
                        })
                    );

                    nextEntries[source.id] = {
                        result: scanResult,
                        preset: scanPreset,
                        scannedAt: Date.now()
                    };
                    completed += 1;
                } catch (itemError) {
                    if (abortControllerRef.current?.signal.aborted) {
                        throw itemError;
                    }
                    failed += 1;
                }
            }

            setScanResultsBySource((prev) => ({ ...prev, ...nextEntries }));

            const firstScanned = Object.keys(nextEntries)[0];
            if (firstScanned) {
                setActiveResultSourceId(firstScanned);
                setSelectedSourceId(firstScanned);
            }

            setBatchSummary(`Batch completado: ${completed} exitosos · ${failed} fallidos.`);
        } catch (scanError) {
            const rawMessage = scanError instanceof Error ? scanError.message : 'No se pudo completar el escaneo batch.';
            const message = /abort|cancel/i.test(rawMessage)
                ? 'Escaneo batch cancelado por el usuario.'
                : rawMessage;
            setError(message);
        } finally {
            setIsScanning(false);
            abortControllerRef.current = null;
        }
    };

    const handleCancelScan = () => {
        if (!abortControllerRef.current) return;
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        setIsScanning(false);
    };

    const applyPayload: ApplyScanPayload | null = useMemo(() => {
        if (!activeResultEntry || !activeResultSource) return null;

        const notes: Note[] = activeResultEntry.result.notes.map((note) => ({
            pitch: note.pitch,
            start: note.start,
            duration: note.duration,
            velocity: note.velocity
        }));

        return {
            notes,
            clipName: `${activeResultSource.clipName} [SCAN]`,
            sourceTrackId: activeResultSource.trackId,
            sourceClipId: activeResultSource.clipId
        };
    }, [activeResultEntry, activeResultSource]);

    const hasDetectedNotes = (applyPayload?.notes.length || 0) > 0;

    const detectedRangeLabel = useMemo(() => {
        const result = activeResultEntry?.result;
        if (!result || result.notes.length === 0) {
            return 'A0 - C8';
        }

        const minPitch = Math.min(...result.notes.map((note) => note.pitch));
        const maxPitch = Math.max(...result.notes.map((note) => note.pitch));
        return `${formatMidiNote(minPitch)} - ${formatMidiNote(maxPitch)}`;
    }, [activeResultEntry]);

    const precisionTier = useMemo(() => {
        const result = activeResultEntry?.result;
        if (!result) return 'EN ESPERA';

        const confidence = result.averageConfidence;
        if (confidence >= 0.82) return 'PRECISION REFERENCIA';
        if (confidence >= 0.68) return 'PRECISION ESTUDIO';
        if (confidence >= 0.54) return 'PRECISION AVANZADA';
        return 'PRECISION EN AJUSTE';
    }, [activeResultEntry]);

    const scannedSourceOptions = useMemo(() => {
        return audioSources.filter((source) => Boolean(scanResultsBySource[source.id]));
    }, [audioSources, scanResultsBySource]);

    const scanButtonLabel = isScanning ? 'Escaneando...' : 'Escanear Notas';
    const hasResult = Boolean(activeResultEntry);

    return (
        <div className="relative h-full overflow-hidden bg-[#080d15] text-white">
            <div className="pointer-events-none absolute -top-20 right-[-70px] h-[320px] w-[320px] rounded-full bg-daw-violet/18 blur-[90px] opacity-65" />
            <div className="pointer-events-none absolute -bottom-20 left-[-80px] h-[320px] w-[360px] rounded-full bg-daw-ruby/12 blur-[110px] opacity-55" />
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.06),transparent_60%)]" />

            <div className="relative z-10 flex h-full flex-col">
                <div className="h-14 px-4 border-b border-white/10 bg-[#0e141f]/95 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-sm bg-gradient-to-br from-daw-violet/25 to-daw-ruby/15 border border-white/15 flex items-center justify-center shadow-[0_0_12px_rgba(168,85,247,0.2)]">
                            <Wand2 size={14} className="text-white" />
                        </div>
                        <div>
                            <h2 className="text-[11px] font-black tracking-[0.15em] uppercase text-gray-100">Synthesis Workspace</h2>
                            <p className="text-[9px] text-gray-400 uppercase tracking-widest">Scanner Polifonico · Precision Lock Engine</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-sm border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:border-white/30 flex items-center justify-center"
                        title="Cerrar scanner"
                    >
                        <X size={13} />
                    </button>
                </div>

                <div className="flex-1 min-h-0 flex flex-col border-t border-white/5">
                    <div className="shrink-0 border-b border-white/10 px-4 py-3 bg-[#10141d]/95">
                        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-3 items-center">
                            <div className="flex flex-wrap items-center gap-3">
                                <div className="text-[9px] font-bold text-gray-500 uppercase tracking-widest">Fuente de audio</div>
                                <select
                                    value={selectedSourceId}
                                    onChange={(event) => setSelectedSourceId(event.target.value)}
                                    className="h-9 min-w-[320px] bg-[#0b1018] border border-white/10 rounded-sm px-2 text-xs text-gray-200 focus:outline-none focus:border-daw-violet/50"
                                >
                                    {audioSources.length === 0 ? (
                                        <option value="">No hay clips de audio disponibles</option>
                                    ) : (
                                        audioSources.map((source) => (
                                            <option key={source.id} value={source.id}>{source.label}</option>
                                        ))
                                    )}
                                </select>

                                <select
                                    value={scanPreset}
                                    onChange={(event) => setScanPreset(event.target.value as ScanPresetKey)}
                                    className="h-9 min-w-[170px] bg-[#0b1018] border border-white/10 rounded-sm px-2 text-xs text-gray-200 focus:outline-none focus:border-daw-cyan/50"
                                >
                                    {Object.entries(SCAN_PRESETS).map(([key, preset]) => (
                                        <option key={key} value={key}>{preset.label}</option>
                                    ))}
                                </select>

                                <div className="text-[10px] text-gray-500 max-w-[280px] truncate" title={SCAN_PRESETS[scanPreset].description}>
                                    {SCAN_PRESETS[scanPreset].description}
                                </div>

                                {scannedSourceOptions.length > 0 && (
                                    <select
                                        value={activeResultSourceId || ''}
                                        onChange={(event) => setActiveResultSourceId(event.target.value)}
                                        className="h-9 min-w-[260px] bg-[#0b1018] border border-white/10 rounded-sm px-2 text-xs text-gray-200 focus:outline-none focus:border-emerald-400/50"
                                    >
                                        {scannedSourceOptions.map((source) => {
                                            const entry = scanResultsBySource[source.id];
                                            const presetLabel = entry ? SCAN_PRESETS[entry.preset].label : 'N/A';
                                            return (
                                                <option key={source.id} value={source.id}>
                                                    Resultado: {source.label} [{presetLabel}]
                                                </option>
                                            );
                                        })}
                                    </select>
                                )}
                            </div>

                            <div className="flex items-center gap-2 justify-end">
                                <span className="px-2 py-1 rounded-sm border border-emerald-400/40 bg-emerald-400/10 text-emerald-200 text-[9px] font-bold uppercase tracking-wider">
                                    Precision Lock
                                </span>
                                {!hasResult && (
                                    <span className="px-2 py-1 rounded-sm border border-daw-violet/25 bg-[#1a1630] text-daw-violet text-[9px] font-bold uppercase tracking-wider">
                                        Neural + Fisico
                                    </span>
                                )}
                                <button
                                    onClick={handleScan}
                                    disabled={!selectedSource || isScanning}
                                    className={`h-9 px-4 rounded-sm border font-bold text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${!selectedSource || isScanning
                                        ? 'bg-[#0f0f14] border-white/10 text-gray-600 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-daw-violet to-daw-ruby text-white border-daw-violet/70 hover:brightness-110 shadow-[0_0_16px_rgba(168,85,247,0.28)]'
                                        }`}
                                >
                                    {isScanning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                                    {scanButtonLabel}
                                </button>
                                <button
                                    onClick={handleBatchScan}
                                    disabled={audioSources.length === 0 || isScanning}
                                    className={`h-9 px-4 rounded-sm border font-bold text-[10px] uppercase tracking-wider transition-all ${audioSources.length === 0 || isScanning
                                        ? 'bg-[#0f0f14] border-white/10 text-gray-600 cursor-not-allowed'
                                        : 'bg-[#171f2f] border-cyan-400/40 text-cyan-200 hover:bg-[#1d2940]'
                                        }`}
                                >
                                    Escaneo Batch
                                </button>
                                {isScanning && (
                                    <button
                                        onClick={handleCancelScan}
                                        className="h-9 px-4 rounded-sm border border-amber-400/40 bg-[#2a2113] text-amber-300 hover:bg-[#332818] text-[10px] font-bold uppercase tracking-wider"
                                    >
                                        Cancelar
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {isScanning && progress && (
                        <div className="px-4 py-2 border-b border-white/10 bg-[#0d131d] flex items-center gap-3">
                            <div className="flex-1 h-2 rounded-full bg-[#0a0f17] border border-white/10 overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-daw-violet to-daw-ruby" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                            </div>
                            <div className="text-[10px] text-gray-400 truncate max-w-[540px]">{progress.message}</div>
                            <div className="text-[10px] font-mono text-gray-300 min-w-[36px] text-right">{Math.round(progress.progress * 100)}%</div>
                        </div>
                    )}

                    {batchSummary && (
                        <div className="mx-4 mt-3 px-3 py-2 rounded-sm border border-cyan-400/30 bg-cyan-400/10 text-[11px] text-cyan-200">
                            {batchSummary}
                        </div>
                    )}

                    {error && (
                        <div className="mx-4 mt-3 px-3 py-2 rounded-sm border border-red-400/30 bg-red-400/10 text-[11px] text-red-300">
                            {error}
                        </div>
                    )}

                    {hasResult ? (
                        <>
                            <div className="h-11 shrink-0 border-b border-white/10 px-4 bg-[#0e1520] flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <Check size={14} className="text-green-400" />
                                    <span className="text-[10px] uppercase tracking-wider font-bold text-green-300">Escaneo completado</span>
                                    <span className="px-2 py-1 rounded-sm border border-white/10 bg-[#111a27] text-[9px] uppercase tracking-wider text-gray-300">{activeResultEntry?.result.notes.length || 0} notas</span>
                                    <span className="px-2 py-1 rounded-sm border border-white/10 bg-[#111a27] text-[9px] uppercase tracking-wider text-gray-300">Rango {detectedRangeLabel}</span>
                                    {activeResultEntry && (
                                        <span className="px-2 py-1 rounded-sm border border-cyan-400/25 bg-cyan-400/10 text-[9px] uppercase tracking-wider text-cyan-200">
                                            {SCAN_PRESETS[activeResultEntry.preset].label}
                                        </span>
                                    )}
                                </div>
                                <span className="px-2 py-1 rounded-sm border border-emerald-400/35 bg-emerald-400/10 text-emerald-200 text-[9px] uppercase tracking-wider font-bold">
                                    {precisionTier}
                                </span>
                            </div>

                            <div className="flex-1 min-h-0 bg-[#090d15]">
                                <SynthesiaVisualizer notes={activeResultEntry?.result.notes || []} bpm={bpm} accentColor="#a855f7" height={780} />
                            </div>

                            <div className="h-[72px] shrink-0 border-t border-white/10 bg-[#0f1622] px-3 flex items-center gap-2">
                                <button
                                    onClick={() => {
                                        if (!applyPayload) return;
                                        onCreateMidiTrack(applyPayload);
                                    }}
                                    disabled={!hasDetectedNotes}
                                    className="h-9 px-4 rounded-sm border border-daw-violet/55 bg-daw-violet/20 text-white hover:bg-daw-violet/30 text-[10px] font-bold uppercase tracking-wider"
                                >
                                    Crear nueva pista MIDI
                                </button>

                                <select
                                    value={targetMidiTrackId}
                                    onChange={(event) => setTargetMidiTrackId(event.target.value)}
                                    className="h-9 flex-1 min-w-[220px] bg-[#0c1118] border border-white/10 rounded-sm px-2 text-xs text-gray-200"
                                >
                                    {midiTracks.length === 0 && <option value="">No hay pistas MIDI</option>}
                                    {midiTracks.map((track) => (
                                        <option key={track.id} value={track.id}>{track.name}</option>
                                    ))}
                                </select>

                                <button
                                    onClick={() => {
                                        if (!applyPayload || !targetMidiTrackId) return;
                                        onInsertIntoTrack(targetMidiTrackId, applyPayload);
                                    }}
                                    disabled={!hasDetectedNotes || !targetMidiTrackId}
                                    className="h-9 px-4 rounded-sm border border-amber-400/50 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 text-[10px] font-bold uppercase tracking-wider"
                                >
                                    Insertar
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="flex-1 min-h-0 border-t border-white/5 bg-[#111722]/85 flex flex-col items-center justify-center gap-5 text-center px-10">
                            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-daw-violet/20 to-daw-ruby/15 border border-white/10 flex items-center justify-center shadow-[0_0_16px_rgba(168,85,247,0.2)]">
                                {isScanning ? <Loader2 size={26} className="text-daw-violet animate-spin" /> : <Wand2 size={26} className="text-daw-violet" />}
                            </div>
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-gray-100">Synthesis Workspace</h3>
                                <p className="text-[11px] text-gray-400 mt-3 max-w-[700px] leading-relaxed">
                                    Inicia el escaneo para abrir una vista protagonista del piano roll con cinta de reproduccion,
                                    navegacion por compases y control de tempo local independiente del DAW.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export type { ApplyScanPayload };
export default React.memo(NoteScannerPanel);
