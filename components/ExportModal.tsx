import React, { useEffect, useMemo, useState } from 'react';
import {
    AlertCircle,
    Archive,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
    Cpu,
    Download,
    Loader2,
    SlidersHorizontal,
    Sparkles,
    X
} from 'lucide-react';
import { ExportAudioFormat, Track, TrackType } from '../types';
import { audioEngine } from '../services/audioEngine';
import { audioTranscodeService } from '../services/audioTranscodeService';
import { stemExporter, StemProgress } from '../services/stemExporter';

interface ExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    tracks: Track[];
    totalBars: number;
    bpm: number;
}

type FileFormat = ExportAudioFormat;
type BitDepth = '16' | '24' | '32';
type SampleRate = '44100' | '48000' | '88200' | '96000' | '192000';
type DitherType = 'none' | 'triangular' | 'pow-r3';
type ExportSource = 'master' | 'stems';

interface ExportPreset {
    name: string;
    desc: string;
    format: FileFormat;
    rate: SampleRate;
    depth: BitDepth;
    dither: DitherType;
    normalize: boolean;
}

const EXPORT_PRESETS: Record<'low' | 'high' | 'max', ExportPreset> = {
    low: {
        name: 'LOW',
        desc: 'Ligero y portable',
        format: 'mp3',
        rate: '44100',
        depth: '16',
        dither: 'pow-r3',
        normalize: true
    },
    high: {
        name: 'HIGH',
        desc: 'Sin perdida balanceado',
        format: 'flac',
        rate: '48000',
        depth: '24',
        dither: 'none',
        normalize: false
    },
    max: {
        name: 'MAX',
        desc: 'Maxima resolucion',
        format: 'aiff',
        rate: '192000',
        depth: '32',
        dither: 'none',
        normalize: false
    }
};

const SAMPLE_RATE_OPTIONS: SampleRate[] = ['44100', '48000', '88200', '96000', '192000'];
const BIT_DEPTH_OPTIONS: BitDepth[] = ['16', '24', '32'];
const DITHER_OPTIONS: Array<{ id: DitherType; label: string }> = [
    { id: 'none', label: 'OFF' },
    { id: 'triangular', label: 'TPDF' },
    { id: 'pow-r3', label: 'POW-r #3' }
];

const FORMAT_OPTIONS: Array<{ id: FileFormat; label: string; sub: string }> = [
    { id: 'wav', label: 'WAV', sub: 'PCM sin perdida' },
    { id: 'aiff', label: 'AIFF', sub: 'Master PCM' },
    { id: 'flac', label: 'FLAC', sub: 'Sin perdida comprimido' },
    { id: 'mp3', label: 'MP3', sub: '320 kbps CBR' }
];

const sectionTitle = 'text-[10px] font-bold uppercase tracking-wider text-gray-500';
const toMiB = (bytes: number): string => {
    const size = bytes / 1024 / 1024;
    return size < 1 ? '< 1' : size.toFixed(1);
};

const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, tracks, bpm }) => {
    const [isRendered, setIsRendered] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    const [sourceMode, setSourceMode] = useState<ExportSource>('master');
    const [format, setFormat] = useState<FileFormat>('aiff');
    const [sampleRate, setSampleRate] = useState<SampleRate>('192000');
    const [bitDepth, setBitDepth] = useState<BitDepth>('32');
    const [dither, setDither] = useState<DitherType>('none');
    const [normalize, setNormalize] = useState(false);
    const [filenamePattern, setFilenamePattern] = useState('$PROJECT_$BPM');
    const [selectedPreset, setSelectedPreset] = useState<keyof typeof EXPORT_PRESETS | 'custom'>('max');
    const [showAdvanced, setShowAdvanced] = useState(false);

    const [isProcessing, setIsProcessing] = useState(false);
    const [currentProgress, setCurrentProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('LISTO');
    const [stemProgressList, setStemProgressList] = useState<StemProgress[]>([]);
    const [exportError, setExportError] = useState<string | null>(null);

    const canTranscode = audioTranscodeService.canTranscode;

    useEffect(() => {
        if (isOpen) {
            const maxPreset = EXPORT_PRESETS.max;
            setIsRendered(true);
            setSourceMode('master');
            setSelectedPreset(canTranscode ? 'max' : 'custom');
            setFormat(canTranscode ? maxPreset.format : 'wav');
            setSampleRate(maxPreset.rate);
            setBitDepth(maxPreset.depth);
            setDither(maxPreset.dither);
            setNormalize(maxPreset.normalize);
            setFilenamePattern('$PROJECT_$BPM');
            setShowAdvanced(false);
            setIsProcessing(false);
            setCurrentProgress(0);
            setStatusMessage('LISTO');
            setStemProgressList([]);
            setExportError(null);
            const timer = setTimeout(() => setIsVisible(true), 40);
            return () => clearTimeout(timer);
        }

        setIsVisible(false);
        const timer = setTimeout(() => setIsRendered(false), 350);
        return () => clearTimeout(timer);
    }, [canTranscode, isOpen]);

    const exportableTracks = useMemo(() => {
        return tracks.filter((track) => {
            const isAudioLike = track.type === TrackType.AUDIO || track.type === TrackType.MIDI;
            if (!isAudioLike) return false;
            return track.clips.some((clip) => Boolean(clip.buffer));
        });
    }, [tracks]);

    const isFormatSupported = (candidate: FileFormat, source: ExportSource): boolean => {
        if (source === 'stems') {
            if (candidate === 'wav') return true;
            return canTranscode;
        }
        if (candidate === 'wav') return true;
        return canTranscode;
    };

    useEffect(() => {
        if (isFormatSupported(format, sourceMode)) return;
        setFormat('wav');
        setSelectedPreset('custom');
    }, [canTranscode, format, sourceMode]);

    useEffect(() => {
        if (bitDepth === '32' && dither !== 'none') {
            setDither('none');
        }
    }, [bitDepth, dither]);

    useEffect(() => {
        if (format !== 'mp3') return;
        if (parseInt(sampleRate, 10) <= 48000) return;
        setSampleRate('48000');
    }, [format, sampleRate]);

    const loadPreset = (key: keyof typeof EXPORT_PRESETS) => {
        const preset = EXPORT_PRESETS[key];
        setSelectedPreset(key);

        const nextFormat = isFormatSupported(preset.format, sourceMode) ? preset.format : 'wav';
        setFormat(nextFormat);
        setSampleRate(preset.rate);
        setBitDepth(preset.depth);
        setDither(preset.depth === '32' ? 'none' : preset.dither);
        setNormalize(preset.normalize);
    };

    const setCustomPreset = () => {
        setSelectedPreset('custom');
    };

    const handleBitDepthChange = (depth: BitDepth) => {
        setBitDepth(depth);
        setCustomPreset();
        if (depth === '32') {
            setDither('none');
        }
    };

    const resolvedFormat: FileFormat = format;

    const formatHint = useMemo(() => {
        if (sourceMode === 'stems') {
            if (resolvedFormat === 'wav') {
                return 'Stems WAV no usa compresion para maxima fidelidad y fase consistente; el tamano final puede ser alto.';
            }
            if (resolvedFormat === 'mp3') {
                return 'Stems MP3 se generan en CBR 320 kbps para intercambio rapido y escucha de referencia.';
            }
            return `Stems se transcodifica a ${resolvedFormat.toUpperCase()} dentro de un ZIP final.`;
        }
        if (!canTranscode && (format === 'aiff' || format === 'flac' || format === 'mp3')) {
            return 'Esta build no tiene transcodificacion FFmpeg activa. WAV sigue disponible como fallback seguro.';
        }
        if (format === 'mp3') {
            return 'MP3 se exporta en CBR 320 kbps y maximo 48 kHz para compatibilidad universal.';
        }
        return null;
    }, [canTranscode, format, resolvedFormat, sourceMode]);

    const { sizeStr, perFileSizeStr, preflightNote, durationStr, rawDuration } = useMemo(() => {
        let maxBar = 0;
        let hasContent = false;

        tracks.forEach((track) => {
            track.clips.forEach((clip) => {
                if (!clip.buffer) return;
                const end = clip.start + clip.length;
                if (end > maxBar) maxBar = end;
                hasContent = true;
            });
        });

        const effectiveBars = hasContent ? Math.max(0, maxBar - 1) : 0;
        const durationSeconds = effectiveBars * (60 / bpm) * 4;
        const minutes = Math.floor(durationSeconds / 60);
        const seconds = Math.floor(durationSeconds % 60);
        const nextDurationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        const rate = parseInt(sampleRate, 10);
        const depth = parseInt(bitDepth, 10);
        const channels = 2;
        const bytesPerSample = depth / 8;
        const pcmBytes = durationSeconds > 0 ? (durationSeconds * rate * channels * bytesPerSample) + 64 : 0;

        let bytes = 0;
        let perFileBytes = 0;
        if (sourceMode === 'stems') {
            if (resolvedFormat === 'flac') {
                perFileBytes = pcmBytes * 0.58;
            } else if (resolvedFormat === 'mp3') {
                perFileBytes = durationSeconds * (320000 / 8);
            } else {
                perFileBytes = pcmBytes;
            }
            bytes = perFileBytes * exportableTracks.length;
        } else if (resolvedFormat === 'flac') {
            bytes = pcmBytes * 0.58;
            perFileBytes = bytes;
        } else if (resolvedFormat === 'mp3') {
            bytes = durationSeconds * (320000 / 8);
            perFileBytes = bytes;
        } else {
            bytes = pcmBytes;
            perFileBytes = bytes;
        }

        const nextSizeStr = toMiB(bytes);
        const nextPerFileStr = toMiB(perFileBytes);

        let nextPreflightNote = 'Estimacion basada en audio renderizable (clips cargados en memoria).';
        if (sourceMode === 'stems') {
            if (resolvedFormat === 'wav' || resolvedFormat === 'aiff') {
                nextPreflightNote = 'Cada stem mantiene la duracion completa del tema para alineacion perfecta; PCM sin compresion puede pesar bastante.';
            } else if (resolvedFormat === 'flac') {
                nextPreflightNote = 'FLAC es sin perdida con compresion variable; el tamano real puede variar segun el contenido.';
            } else {
                nextPreflightNote = 'MP3 usa 320 kbps CBR para compatibilidad universal; se aplica tope de 48 kHz.';
            }
        }

        return {
            sizeStr: nextSizeStr,
            perFileSizeStr: nextPerFileStr,
            preflightNote: nextPreflightNote,
            durationStr: nextDurationStr,
            rawDuration: durationSeconds
        };
    }, [bitDepth, bpm, exportableTracks.length, resolvedFormat, sampleRate, sourceMode, tracks]);

    const estimatedFiles = sourceMode === 'stems' ? exportableTracks.length : 1;

    const resolvedFilenamePreview = useMemo(() => {
        const today = new Date().toISOString().slice(0, 10);
        return filenamePattern
            .replace('$PROJECT', 'MyProject')
            .replace('$BPM', bpm.toString())
            .replace('$DATE', today);
    }, [bpm, filenamePattern]);

    const processExport = async () => {
        if (rawDuration <= 0) {
            alert('Proyecto vacio. Agrega contenido antes de exportar.');
            return;
        }

        if (sourceMode === 'stems' && exportableTracks.length === 0) {
            alert('No hay pistas con audio renderizable para exportar stems.');
            return;
        }

        setExportError(null);
        setIsProcessing(true);
        setCurrentProgress(0);
        setStemProgressList([]);

        const barDuration = (60 / bpm) * 4;
        const barsToRender = Math.max(1, Math.ceil(rawDuration / barDuration));
        const targetSampleRate = parseInt(sampleRate, 10);
        const targetBitDepth = parseInt(bitDepth, 10) as 16 | 24 | 32;

        if (sourceMode === 'stems') {
            setStatusMessage('PREPARANDO EXPORT DE STEMS...');
            setCurrentProgress(5);

            try {
                const result = await stemExporter.exportStems(
                    tracks,
                    bpm,
                    barsToRender,
                    {
                        format: resolvedFormat,
                        sampleRate: targetSampleRate as 44100 | 48000 | 88200 | 96000 | 192000,
                        bitDepth: targetBitDepth,
                        includeEffects: true,
                        normalizeLevel: normalize ? 0.95 : 0
                    },
                    (progress) => {
                        setStemProgressList([...progress]);
                        const done = progress.filter((item) => item.status === 'complete').length;
                        const total = Math.max(1, progress.length);
                        setCurrentProgress(Math.round((done / total) * 100));
                    }
                );

                if (!result.success || !result.zipBlob) {
                    throw new Error('No se pudieron exportar stems.');
                }

                const timestamp = new Date().toISOString().slice(0, 10);
                const filename = `${resolvedFilenamePreview}_stems_${timestamp}.zip`;
                stemExporter.downloadBlob(result.zipBlob, filename);

                setStatusMessage('STEMS EXPORTADOS');
                setCurrentProgress(100);
                setTimeout(() => {
                    setIsProcessing(false);
                    onClose();
                }, 1200);
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Error al exportar stems.';
                setExportError(message);
                setStatusMessage('ERROR');
                setIsProcessing(false);
            }
            return;
        }

        try {
            setStatusMessage('RENDERIZANDO MASTER...');
            setCurrentProgress(10);

            const rendered = await audioEngine.renderProject(tracks, {
                bars: barsToRender,
                bpm,
                sampleRate: targetSampleRate,
                sourceId: 'master'
            });

            setCurrentProgress(58);
            setStatusMessage('CODIFICANDO WAV PCM...');

            const wavBlob = await audioEngine.encodeAudio(rendered, {
                format: 'wav',
                bitDepth: targetBitDepth,
                float: bitDepth === '32',
                normalize,
                dither
            });

            setCurrentProgress(78);
            let outputBlob = wavBlob;

            if (resolvedFormat !== 'wav') {
                setStatusMessage(`TRANSCODIFICANDO ${resolvedFormat.toUpperCase()}...`);
                outputBlob = await audioTranscodeService.transcodeFromWavBlob(wavBlob, {
                    format: resolvedFormat,
                    sampleRate: targetSampleRate,
                    bitDepth: targetBitDepth
                });
            }

            setCurrentProgress(100);

            const link = document.createElement('a');
            const url = URL.createObjectURL(outputBlob);
            const ext = resolvedFormat;
            link.href = url;
            link.download = `${resolvedFilenamePreview}.${ext}`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            setStatusMessage('COMPLETADO');
            setTimeout(() => {
                setIsProcessing(false);
                onClose();
            }, 1000);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Error al exportar master.';
            setExportError(message);
            setStatusMessage('ERROR');
            setIsProcessing(false);
        }
    };

    const handleClose = () => {
        if (isProcessing) return;
        onClose();
    };

    const renderSourceButton = (id: ExportSource, label: string, desc: string) => {
        const active = sourceMode === id;
        return (
            <button
                key={id}
                onClick={() => setSourceMode(id)}
                disabled={isProcessing}
                className={`h-12 px-4 rounded-sm border text-left transition-all ${active
                    ? 'border-daw-ruby/50 bg-daw-ruby/10 text-white'
                    : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'
                    }`}
            >
                <div className="text-[10px] font-bold uppercase tracking-wider">{label}</div>
                <div className="text-[9px] text-gray-500">{desc}</div>
            </button>
        );
    };

    if (!isRendered) return null;

    return (
        <div
            className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-300 ${isVisible ? 'bg-black/80 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'}`}
            onClick={handleClose}
        >
            <div
                className={`w-[940px] max-h-[90vh] bg-[#0b0c10] border border-white/10 rounded-sm overflow-hidden flex flex-col transition-all duration-300 ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-[0.98]'}`}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="h-12 px-5 border-b border-white/10 bg-[#111118] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Sparkles size={14} className="text-daw-ruby" />
                        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Export Manager</span>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={isProcessing}
                        className="w-8 h-8 rounded-sm border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:border-white/30 flex items-center justify-center disabled:opacity-40"
                        title="Cerrar"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="px-5 py-4 border-b border-white/10 bg-[#0f1118]">
                    <div className={sectionTitle}>Quick Setup</div>
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 mt-3">
                        <div className="grid grid-cols-2 gap-2">
                            {renderSourceButton('master', 'Master Mix', 'Un archivo final estereo')}
                            {renderSourceButton('stems', 'Stems', `${exportableTracks.length} pistas separadas (ZIP)`)}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            <button
                                onClick={() => setSelectedPreset('custom')}
                                disabled={isProcessing}
                                className={`h-12 rounded-sm border px-3 text-left transition-all ${selectedPreset === 'custom'
                                    ? 'border-daw-violet/45 bg-daw-violet/10 text-white'
                                    : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'
                                    }`}
                            >
                                <div className="text-[10px] font-bold uppercase tracking-wider">CUSTOM</div>
                                <div className="text-[9px] text-gray-500 truncate">Control total manual</div>
                            </button>

                            {(Object.entries(EXPORT_PRESETS) as Array<[keyof typeof EXPORT_PRESETS, ExportPreset]>).map(([key, preset]) => {
                                const active = selectedPreset === key;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => loadPreset(key)}
                                        disabled={isProcessing}
                                        className={`h-12 rounded-sm border px-3 text-left transition-all ${active
                                            ? 'border-daw-violet/45 bg-daw-violet/10 text-white'
                                            : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'
                                            }`}
                                    >
                                        <div className="text-[10px] font-bold uppercase tracking-wider">{preset.name}</div>
                                        <div className="text-[9px] text-gray-500 truncate">{preset.desc}</div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-5">
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5">
                        <div className="space-y-5">
                            <div>
                                <div className={sectionTitle}>Formato</div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
                                    {FORMAT_OPTIONS.map((option) => {
                                        const enabled = isFormatSupported(option.id, sourceMode);
                                        const active = format === option.id;
                                        return (
                                            <button
                                                key={option.id}
                                                onClick={() => {
                                                    if (!enabled) return;
                                                    setCustomPreset();
                                                    setFormat(option.id);
                                                }}
                                                disabled={isProcessing || !enabled}
                                                className={`h-16 rounded-sm border p-2 text-left transition-all ${active
                                                    ? 'border-daw-ruby/55 bg-daw-ruby/10 text-white'
                                                    : enabled
                                                        ? 'border-white/10 bg-[#121418] text-gray-300 hover:text-white hover:border-white/25'
                                                        : 'border-white/10 bg-[#101217] text-gray-600 cursor-not-allowed'
                                                    }`}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <span className="text-[10px] font-black uppercase tracking-wider">{option.label}</span>
                                                    {active && enabled && <Check size={12} className="text-daw-ruby" />}
                                                </div>
                                                <div className="text-[9px] mt-1">{enabled ? option.sub : 'No disponible'}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <div className={sectionTitle}>Sample Rate</div>
                                    <div className="grid grid-cols-3 gap-2 mt-3">
                                        {SAMPLE_RATE_OPTIONS.map((rate) => {
                                            const active = sampleRate === rate;
                                            return (
                                                <button
                                                    key={rate}
                                                    onClick={() => {
                                                        setCustomPreset();
                                                        setSampleRate(rate);
                                                    }}
                                                    disabled={isProcessing}
                                                    className={`h-9 rounded-sm border text-[10px] font-bold uppercase tracking-wider transition-all ${active
                                                        ? 'border-daw-violet/55 bg-daw-violet/12 text-daw-violet'
                                                        : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'
                                                        }`}
                                                >
                                                    {parseInt(rate, 10) / 1000} kHz
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div>
                                    <div className={sectionTitle}>Bit Depth</div>
                                    <div className="grid grid-cols-3 gap-2 mt-3">
                                        {BIT_DEPTH_OPTIONS.map((depth) => {
                                            const active = bitDepth === depth;
                                            return (
                                                <button
                                                    key={depth}
                                                    onClick={() => handleBitDepthChange(depth)}
                                                    disabled={isProcessing}
                                                    className={`h-9 rounded-sm border text-[10px] font-bold uppercase tracking-wider transition-all ${active
                                                        ? 'border-daw-violet/55 bg-daw-violet/12 text-daw-violet'
                                                        : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'
                                                        }`}
                                                >
                                                    {depth}-bit
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <div className={sectionTitle}>Nombre de archivo</div>
                                <div className="mt-3 rounded-sm border border-white/10 bg-[#11131a] overflow-hidden">
                                    <div className="flex items-center">
                                        <input
                                            value={filenamePattern}
                                            onChange={(event) => setFilenamePattern(event.target.value)}
                                            disabled={isProcessing}
                                            className="flex-1 h-10 px-3 bg-transparent text-xs font-mono text-white outline-none"
                                            placeholder="$PROJECT_$BPM"
                                        />
                                        <button
                                            onClick={() => setFilenamePattern('$PROJECT_$BPM')}
                                            disabled={isProcessing}
                                            className="h-10 px-3 border-l border-white/10 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white"
                                        >
                                            Reset
                                        </button>
                                    </div>
                                    <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2 flex-wrap">
                                        {['$PROJECT', '$BPM', '$DATE'].map((token) => (
                                            <button
                                                key={token}
                                                onClick={() => setFilenamePattern((prev) => `${prev}_${token}`)}
                                                disabled={isProcessing}
                                                className="h-6 px-2 rounded-sm border border-white/10 text-[9px] font-mono text-gray-400 hover:text-white hover:border-white/25"
                                            >
                                                {token}
                                            </button>
                                        ))}
                                        <span className="text-[9px] text-gray-500 ml-auto truncate">Preview: {resolvedFilenamePreview}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="rounded-sm border border-white/10 bg-[#11131a] p-4">
                                <div className={sectionTitle}>Preflight</div>
                                <div className="mt-3 space-y-3">
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-gray-500 flex items-center gap-2"><Clock size={12} /> Duracion</span>
                                        <span className="font-mono text-white">{durationStr}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-gray-500 flex items-center gap-2"><Cpu size={12} /> Tamano est.</span>
                                        <span className="font-mono text-white">{sizeStr} MiB</span>
                                    </div>
                                    {sourceMode === 'stems' && (
                                        <div className="flex items-center justify-between text-[11px]">
                                            <span className="text-gray-500">Por stem aprox.</span>
                                            <span className="font-mono text-white">{perFileSizeStr} MiB</span>
                                        </div>
                                    )}
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-gray-500 flex items-center gap-2"><Archive size={12} /> Archivos</span>
                                        <span className="font-mono text-white">{estimatedFiles}</span>
                                    </div>
                                    <div className="flex items-center justify-between text-[11px]">
                                        <span className="text-gray-500">Salida real</span>
                                        <span className="font-mono text-daw-violet uppercase">{sourceMode === 'stems' ? `ZIP (${resolvedFormat.toUpperCase()})` : resolvedFormat.toUpperCase()}</span>
                                    </div>
                                    <div className="text-[10px] leading-relaxed text-gray-500 border-t border-white/10 pt-2">
                                        {preflightNote}
                                    </div>
                                </div>
                            </div>

                            <div className="rounded-sm border border-white/10 bg-[#11131a] overflow-hidden">
                                <button
                                    onClick={() => setShowAdvanced((prev) => !prev)}
                                    className="w-full h-10 px-4 border-b border-white/10 flex items-center justify-between text-left"
                                >
                                    <span className={`${sectionTitle} flex items-center gap-2`}><SlidersHorizontal size={12} /> Avanzado</span>
                                    {showAdvanced ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                                </button>

                                {showAdvanced && (
                                    <div className="p-4 space-y-4">
                                        <div>
                                            <div className={sectionTitle}>Dither</div>
                                            <div className="mt-2 grid grid-cols-3 gap-2">
                                                {DITHER_OPTIONS.map((option) => {
                                                    const active = dither === option.id;
                                                    const disabled = isProcessing || bitDepth === '32';
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            onClick={() => {
                                                                if (disabled) return;
                                                                setCustomPreset();
                                                                setDither(option.id);
                                                            }}
                                                            disabled={disabled}
                                                            className={`h-8 rounded-sm border text-[9px] font-bold uppercase tracking-wider transition-all ${active
                                                                ? 'border-daw-ruby/50 bg-daw-ruby/12 text-daw-ruby'
                                                                : 'border-white/10 bg-[#121418] text-gray-400 hover:text-white hover:border-white/25'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                        >
                                                            {option.label}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            {bitDepth === '32' && (
                                                <div className="mt-2 text-[9px] text-gray-500">32-bit no requiere dithering.</div>
                                            )}
                                        </div>

                                        <label className="h-10 px-3 rounded-sm border border-white/10 bg-[#121418] flex items-center gap-3 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={normalize}
                                                onChange={(event) => {
                                                    setCustomPreset();
                                                    setNormalize(event.target.checked);
                                                }}
                                                disabled={isProcessing}
                                                className="w-4 h-4"
                                            />
                                            <div>
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-300">Normalizar (0dB)</div>
                                                <div className="text-[9px] text-gray-500">Maximiza pico sin clipping</div>
                                            </div>
                                        </label>

                                        {formatHint && (
                                            <div className="px-3 py-2 rounded-sm border border-amber-400/30 bg-amber-400/10 text-[10px] text-amber-200 flex items-start gap-2">
                                                <AlertCircle size={12} className="mt-0.5 shrink-0" />
                                                <span>{formatHint}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {exportError && (
                        <div className="px-3 py-2 rounded-sm border border-red-400/30 bg-red-400/10 text-[11px] text-red-300 flex items-start gap-2">
                            <AlertCircle size={13} className="mt-0.5 shrink-0" />
                            <span>{exportError}</span>
                        </div>
                    )}
                </div>

                <div className="border-t border-white/10 bg-[#101118]">
                    {isProcessing ? (
                        <div className="px-5 py-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-[11px] font-black uppercase tracking-wider text-white flex items-center gap-2">
                                    <Loader2 size={13} className="animate-spin text-daw-violet" />
                                    {statusMessage}
                                </div>
                                <div className="text-[10px] font-mono text-daw-violet">{Math.round(currentProgress)}%</div>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden border border-white/10 bg-[#0d0f14]">
                                <div
                                    className="h-full bg-gradient-to-r from-daw-violet via-fuchsia-500 to-daw-ruby transition-all duration-200"
                                    style={{ width: `${currentProgress}%` }}
                                />
                            </div>

                            {sourceMode === 'stems' && stemProgressList.length > 0 && (
                                <div className="max-h-[140px] overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                                    {stemProgressList.map((stem) => (
                                        <div key={stem.trackId} className="flex items-center gap-2 text-[10px]">
                                            <div className="w-4 h-4 flex items-center justify-center">
                                                {(stem.status === 'rendering' || stem.status === 'encoding') && <Loader2 size={11} className="animate-spin text-daw-violet" />}
                                                {stem.status === 'complete' && <CheckCircle2 size={11} className="text-green-400" />}
                                                {stem.status === 'error' && <AlertCircle size={11} className="text-red-400" />}
                                                {stem.status === 'pending' && <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />}
                                            </div>
                                            <span className="w-[190px] truncate font-mono text-gray-300">{stem.trackName}.{resolvedFormat}</span>
                                            <div className="flex-1 h-1.5 rounded-full bg-[#1a1d25] overflow-hidden border border-white/10">
                                                <div
                                                    className={`h-full ${stem.status === 'error' ? 'bg-red-500' : stem.status === 'complete' ? 'bg-green-500' : 'bg-daw-violet'}`}
                                                    style={{ width: `${stem.progress}%` }}
                                                />
                                            </div>
                                            <span className="w-9 text-right font-mono text-gray-500">{Math.round(stem.progress)}%</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div className="text-[10px] text-gray-400 uppercase tracking-wider">
                                <span className="text-gray-500">Salida:</span>{' '}
                                <span className="text-daw-ruby font-bold">{sourceMode === 'stems' ? `ZIP (${resolvedFormat.toUpperCase()})` : resolvedFormat.toUpperCase()}</span>{' '}
                                <span className="text-gray-600">/</span>{' '}
                                <span className="font-mono text-white">{sampleRate}Hz</span>{' '}
                                <span className="text-gray-600">/</span>{' '}
                                <span className="font-mono text-white">{bitDepth}bit</span>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={onClose}
                                    className="h-9 px-5 rounded-sm border border-white/10 bg-[#15161c] text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:border-white/25"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={processExport}
                                    className="h-9 px-6 rounded-sm border border-daw-ruby/45 bg-gradient-to-r from-daw-violet to-daw-ruby text-white text-[10px] font-black uppercase tracking-[0.13em] flex items-center gap-2 hover:brightness-110"
                                >
                                    <Download size={13} />
                                    {sourceMode === 'stems' ? `Exportar stems ${resolvedFormat}` : `Exportar ${resolvedFormat}`}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ExportModal;
