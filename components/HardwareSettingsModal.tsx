import React, { useEffect, useMemo, useState } from 'react';
import {
    Activity,
    AlertCircle,
    AudioLines,
    CheckCircle2,
    ChevronDown,
    Clock3,
    Cpu,
    FolderOpen,
    Gauge,
    HardDrive,
    Piano,
    Plug,
    RefreshCcw,
    Search,
    SlidersHorizontal,
    X
} from 'lucide-react';
import { AudioSettings, ScannedFileEntry } from '../types';
import { audioEngine } from '../services/audioEngine';
import { midiService, MidiDevice } from '../services/MidiService';
import { platformService } from '../services/platformService';
import { loadStudioSettings, saveStudioSettings } from '../services/studioSettingsService';

interface HardwareSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    audioSettings: AudioSettings;
    onAudioSettingsChange: (settings: AudioSettings) => void;
    engineStats: {
        sampleRate: number;
        latency: number;
        state: string;
        configuredBufferSize?: AudioSettings['bufferSize'];
        effectiveBufferSize?: number;
        bufferStrategy?: string;
        lookaheadMs?: number;
        scheduleAheadTime?: number;
    };
}

type TabId = 'audio' | 'midi' | 'plugins' | 'library';

const SAMPLE_RATE_OPTIONS: Array<AudioSettings['sampleRate']> = [44100, 48000, 88200, 96000, 192000];
const BUFFER_OPTIONS: Array<AudioSettings['bufferSize']> = ['auto', 128, 256, 512, 1024, 2048];
const LATENCY_HINT_OPTIONS: Array<AudioSettings['latencyHint']> = ['interactive', 'balanced', 'playback'];

const AUDIO_LIBRARY_EXTENSIONS = ['wav', 'aif', 'aiff', 'flac', 'mp3', 'ogg'];
const PLUGIN_EXTENSIONS = ['vst3', 'dll'];

const entryClass = 'h-10 rounded-sm border border-white/10 bg-[#12141b] px-3 text-xs text-gray-200 outline-none focus:border-daw-violet/60';

const normalizePath = (value: string): string => value.trim().toLowerCase();

const dedupeByPath = (files: ScannedFileEntry[]): ScannedFileEntry[] => {
    const seen = new Set<string>();

    return files.filter((file) => {
        const key = normalizePath(file.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

const prettyBytes = (bytes: number): string => {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
};

const formatLatencyMs = (seconds: number): string => `${(seconds * 1000).toFixed(1)} ms`;

const HardwareSettingsModal: React.FC<HardwareSettingsModalProps> = ({
    isOpen,
    onClose,
    audioSettings,
    onAudioSettingsChange,
    engineStats
}) => {
    const [activeTab, setActiveTab] = useState<TabId>('audio');

    const [isRendered, setIsRendered] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    const [draftAudio, setDraftAudio] = useState<AudioSettings>(audioSettings);
    const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
    const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
    const [isRefreshingAudioDevices, setIsRefreshingAudioDevices] = useState(false);
    const [isRestartingAudio, setIsRestartingAudio] = useState(false);

    const [midiDevices, setMidiDevices] = useState<MidiDevice[]>([]);
    const [midiActivity, setMidiActivity] = useState<Record<string, number>>({});

    const [pluginFolders, setPluginFolders] = useState<string[]>([]);
    const [libraryFolders, setLibraryFolders] = useState<string[]>([]);
    const [pluginIndex, setPluginIndex] = useState<ScannedFileEntry[]>([]);
    const [libraryIndex, setLibraryIndex] = useState<ScannedFileEntry[]>([]);
    const [isScanningPlugins, setIsScanningPlugins] = useState(false);
    const [isScanningLibrary, setIsScanningLibrary] = useState(false);

    const [statusTone, setStatusTone] = useState<'ok' | 'warn' | 'error' | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);

    const isDesktop = platformService.isDesktop;

    const pluginSize = useMemo(
        () => pluginIndex.reduce((acc, entry) => acc + (entry.size || 0), 0),
        [pluginIndex]
    );

    const librarySize = useMemo(
        () => libraryIndex.reduce((acc, entry) => acc + (entry.size || 0), 0),
        [libraryIndex]
    );

    const hasUnsavedAudioChanges = useMemo(() => {
        return draftAudio.sampleRate !== audioSettings.sampleRate ||
            draftAudio.bufferSize !== audioSettings.bufferSize ||
            draftAudio.latencyHint !== audioSettings.latencyHint ||
            (draftAudio.inputDeviceId || '') !== (audioSettings.inputDeviceId || '') ||
            (draftAudio.outputDeviceId || '') !== (audioSettings.outputDeviceId || '');
    }, [audioSettings, draftAudio]);

    useEffect(() => {
        if (!isOpen) {
            setIsVisible(false);
            const hideTimer = window.setTimeout(() => setIsRendered(false), 280);
            return () => clearTimeout(hideTimer);
        }

        setIsRendered(true);
        setDraftAudio(audioSettings);
        setActiveTab('audio');
        setStatusTone(null);
        setStatusMessage(null);

        const studioSettings = loadStudioSettings();
        setPluginFolders(studioSettings.pluginFolders);
        setLibraryFolders(studioSettings.libraryFolders);
        setPluginIndex(studioSettings.pluginIndex);
        setLibraryIndex(studioSettings.libraryIndex);

        const showTimer = window.setTimeout(() => setIsVisible(true), 24);
        return () => clearTimeout(showTimer);
    }, [audioSettings, isOpen]);

    useEffect(() => {
        if (!isRendered) return;
        saveStudioSettings({
            pluginFolders,
            libraryFolders,
            pluginIndex,
            libraryIndex,
            updatedAt: Date.now()
        });
    }, [isRendered, libraryFolders, libraryIndex, pluginFolders, pluginIndex]);

    const refreshAudioDevices = async () => {
        setIsRefreshingAudioDevices(true);
        try {
            const devices = await audioEngine.getAvailableDevices();
            setInputDevices(devices.inputs);
            setOutputDevices(devices.outputs);
            setStatusTone('ok');
            setStatusMessage('Dispositivos de audio actualizados.');
        } catch (error) {
            console.error('No se pudieron listar dispositivos de audio.', error);
            setStatusTone('error');
            setStatusMessage('No se pudo refrescar la lista de dispositivos de audio.');
        } finally {
            setIsRefreshingAudioDevices(false);
        }
    };

    useEffect(() => {
        if (!isOpen || activeTab !== 'audio') return;
        void refreshAudioDevices();
    }, [activeTab, isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        void midiService.init();
        const unsubscribeDevices = midiService.subscribeDevices((devices) => {
            setMidiDevices(devices.filter((device) => device.type === 'input'));
        });

        const unsubscribeMidiMessages = midiService.onMessage((message) => {
            setMidiActivity((prev) => ({
                ...prev,
                [message.deviceId]: Date.now()
            }));
        });

        return () => {
            unsubscribeDevices();
            unsubscribeMidiMessages();
        };
    }, [isOpen]);

    const updateAudioField = <K extends keyof AudioSettings>(key: K, value: AudioSettings[K]) => {
        setDraftAudio((prev) => ({ ...prev, [key]: value }));
    };

    const applyAudioProfile = (profile: 'recording' | 'balanced' | 'mastering') => {
        if (profile === 'recording') {
            setDraftAudio((prev) => ({ ...prev, latencyHint: 'interactive', bufferSize: 128 }));
            return;
        }

        if (profile === 'balanced') {
            setDraftAudio((prev) => ({ ...prev, latencyHint: 'balanced', bufferSize: 256 }));
            return;
        }

        setDraftAudio((prev) => ({ ...prev, latencyHint: 'playback', bufferSize: 1024 }));
    };

    const applyAudioChanges = () => {
        onAudioSettingsChange(draftAudio);
        setStatusTone('ok');
        setStatusMessage('Configuracion de audio aplicada.');
    };

    const restartAudioEngine = async () => {
        setIsRestartingAudio(true);
        try {
            onAudioSettingsChange(draftAudio);
            await audioEngine.restartEngine(draftAudio);
            setStatusTone('ok');
            setStatusMessage('Motor de audio reiniciado con la configuracion actual.');
        } catch (error) {
            console.error('No se pudo reiniciar el motor de audio.', error);
            setStatusTone('error');
            setStatusMessage('No se pudo reiniciar el motor de audio.');
        } finally {
            setIsRestartingAudio(false);
        }
    };

    const addFolder = async (target: 'plugins' | 'library') => {
        const folder = await platformService.selectDirectory();
        if (!folder) return;

        if (target === 'plugins') {
            setPluginFolders((prev) => {
                if (prev.some((entry) => normalizePath(entry) === normalizePath(folder))) return prev;
                return [...prev, folder];
            });
            return;
        }

        setLibraryFolders((prev) => {
            if (prev.some((entry) => normalizePath(entry) === normalizePath(folder))) return prev;
            return [...prev, folder];
        });
    };

    const removeFolder = (target: 'plugins' | 'library', folder: string) => {
        if (target === 'plugins') {
            setPluginFolders((prev) => prev.filter((entry) => normalizePath(entry) !== normalizePath(folder)));
            return;
        }

        setLibraryFolders((prev) => prev.filter((entry) => normalizePath(entry) !== normalizePath(folder)));
    };

    const scanFolders = async (target: 'plugins' | 'library') => {
        const folders = target === 'plugins' ? pluginFolders : libraryFolders;
        if (!isDesktop) {
            setStatusTone('warn');
            setStatusMessage('El escaneo de carpetas solo esta disponible en la version desktop.');
            return;
        }

        if (folders.length === 0) {
            setStatusTone('warn');
            setStatusMessage(`Agrega al menos una carpeta de ${target === 'plugins' ? 'plugins' : 'libreria'} antes de escanear.`);
            return;
        }

        const extensions = target === 'plugins' ? PLUGIN_EXTENSIONS : AUDIO_LIBRARY_EXTENSIONS;

        if (target === 'plugins') {
            setIsScanningPlugins(true);
        } else {
            setIsScanningLibrary(true);
        }

        try {
            const scannedPerFolder = await Promise.all(
                folders.map((folder) => platformService.scanDirectoryFiles(folder, extensions))
            );
            const merged = dedupeByPath(scannedPerFolder.flat()).sort((a, b) => a.name.localeCompare(b.name));

            if (target === 'plugins') {
                setPluginIndex(merged);
                setStatusTone('ok');
                setStatusMessage(`Escaneo de plugins finalizado: ${merged.length} archivos detectados.`);
            } else {
                setLibraryIndex(merged);
                setStatusTone('ok');
                setStatusMessage(`Escaneo de libreria finalizado: ${merged.length} archivos detectados.`);
            }
        } catch (error) {
            console.error('Fallo el escaneo de carpetas.', error);
            setStatusTone('error');
            setStatusMessage('No se pudo completar el escaneo de carpetas.');
        } finally {
            if (target === 'plugins') {
                setIsScanningPlugins(false);
            } else {
                setIsScanningLibrary(false);
            }
        }
    };

    const toggleMidiDevice = (deviceId: string) => {
        const enabled = midiService.isEnabled(deviceId);
        midiService.setEnabled(deviceId, !enabled);
        setMidiDevices((prev) => [...prev]);
    };

    const toggleAllMidi = (enabled: boolean) => {
        midiService.setAllEnabled(midiDevices.map((device) => device.id), enabled);
        setMidiDevices((prev) => [...prev]);
    };

    const isMidiDeviceHot = (deviceId: string): boolean => {
        const lastEvent = midiActivity[deviceId] || 0;
        return Date.now() - lastEvent < 1400;
    };

    const closeModal = () => {
        if (isScanningLibrary || isScanningPlugins || isRestartingAudio) return;
        onClose();
    };

    if (!isRendered) return null;

    return (
        <div
            className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-300 ${isVisible ? 'bg-black/70 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'}`}
            onClick={closeModal}
        >
            <div
                className={`w-[980px] max-h-[92vh] rounded-sm border border-white/10 bg-[#0b0c11] overflow-hidden flex transition-all duration-300 ${isVisible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-[0.98]'}`}
                onClick={(event) => event.stopPropagation()}
            >
                <aside className="w-[250px] border-r border-white/10 bg-[#0f1017] flex flex-col">
                    <div className="h-14 px-5 border-b border-white/10 flex items-center justify-between">
                        <div>
                            <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Studio Core</div>
                            <div className="text-sm font-bold text-white">Configuracion</div>
                        </div>
                    </div>

                    <div className="p-3 space-y-1.5">
                        <TabButton id="audio" label="Audio Engine" subLabel="I/O · Latencia · Calidad" icon={Cpu} active={activeTab === 'audio'} onClick={setActiveTab} />
                        <TabButton id="midi" label="MIDI" subLabel="Controladores y actividad" icon={Piano} active={activeTab === 'midi'} onClick={setActiveTab} />
                        <TabButton id="plugins" label="Plugins" subLabel="Rutas y escaneo" icon={Plug} active={activeTab === 'plugins'} onClick={setActiveTab} />
                        <TabButton id="library" label="Library" subLabel="Rutas y catalogo" icon={HardDrive} active={activeTab === 'library'} onClick={setActiveTab} />
                    </div>

                    <div className="mt-auto p-4 border-t border-white/10 bg-white/[0.01]">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider">Estado motor</div>
                        <div className="mt-2 flex items-center justify-between text-xs text-gray-300">
                            <span>{engineStats.state.toUpperCase()}</span>
                            <span className="font-mono">{Math.round(engineStats.sampleRate)} Hz</span>
                        </div>
                    </div>
                </aside>

                <section className="flex-1 flex flex-col min-h-0">
                    <header className="h-14 px-5 border-b border-white/10 flex items-center justify-between bg-[#10121b]">
                        <div>
                            <h2 className="text-sm font-semibold text-white">
                                {activeTab === 'audio' && 'Audio Engine'}
                                {activeTab === 'midi' && 'MIDI Controller Hub'}
                                {activeTab === 'plugins' && 'Plugin Manager'}
                                {activeTab === 'library' && 'Library Manager'}
                            </h2>
                            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Flujo directo, sin pasos ocultos</p>
                        </div>
                        <button
                            onClick={closeModal}
                            className="w-8 h-8 rounded-sm border border-white/10 bg-white/5 text-gray-400 hover:text-white hover:border-white/30 flex items-center justify-center"
                            title="Cerrar"
                        >
                            <X size={14} />
                        </button>
                    </header>

                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-5">
                        {activeTab === 'audio' && (
                            <div className="space-y-5">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <ProfileButton
                                        title="Recording"
                                        description="Minima latencia para grabacion"
                                        active={draftAudio.latencyHint === 'interactive'}
                                        onClick={() => applyAudioProfile('recording')}
                                    />
                                    <ProfileButton
                                        title="Balanced"
                                        description="Uso general estable"
                                        active={draftAudio.latencyHint === 'balanced'}
                                        onClick={() => applyAudioProfile('balanced')}
                                    />
                                    <ProfileButton
                                        title="Mastering"
                                        description="Maxima estabilidad de reproduccion"
                                        active={draftAudio.latencyHint === 'playback'}
                                        onClick={() => applyAudioProfile('mastering')}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <SelectField
                                        label="Input Device"
                                        value={draftAudio.inputDeviceId || ''}
                                        onChange={(value) => updateAudioField('inputDeviceId', value || undefined)}
                                        options={[
                                            { value: '', label: 'Sistema (default input)' },
                                            ...inputDevices.map((device) => ({ value: device.deviceId, label: device.label || `Input ${device.deviceId.slice(0, 8)}` }))
                                        ]}
                                    />
                                    <SelectField
                                        label="Output Device"
                                        value={draftAudio.outputDeviceId || ''}
                                        onChange={(value) => updateAudioField('outputDeviceId', value || undefined)}
                                        options={[
                                            { value: '', label: 'Sistema (default output)' },
                                            ...outputDevices.map((device) => ({ value: device.deviceId, label: device.label || `Output ${device.deviceId.slice(0, 8)}` }))
                                        ]}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <SelectField
                                        label="Sample Rate"
                                        value={String(draftAudio.sampleRate)}
                                        onChange={(value) => updateAudioField('sampleRate', Number(value) as AudioSettings['sampleRate'])}
                                        options={SAMPLE_RATE_OPTIONS.map((sampleRate) => ({
                                            value: String(sampleRate),
                                            label: `${sampleRate} Hz`
                                        }))}
                                    />

                                    <SelectField
                                        label="Buffer Size"
                                        value={String(draftAudio.bufferSize)}
                                        onChange={(value) => updateAudioField('bufferSize', value === 'auto' ? 'auto' : Number(value) as AudioSettings['bufferSize'])}
                                        options={BUFFER_OPTIONS.map((bufferSize) => ({
                                            value: String(bufferSize),
                                            label: bufferSize === 'auto' ? 'Auto' : `${bufferSize} samples`
                                        }))}
                                    />

                                    <SelectField
                                        label="Latency Hint"
                                        value={draftAudio.latencyHint}
                                        onChange={(value) => updateAudioField('latencyHint', value)}
                                        options={LATENCY_HINT_OPTIONS.map((latencyHint) => ({
                                            value: latencyHint,
                                            label: latencyHint.toUpperCase()
                                        }))}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                    <MetricCard label="Engine Rate" value={`${Math.round(engineStats.sampleRate)} Hz`} icon={AudioLines} />
                                    <MetricCard label="Current Latency" value={formatLatencyMs(engineStats.latency)} icon={Clock3} />
                                    <MetricCard label="Engine State" value={engineStats.state.toUpperCase()} icon={Gauge} />
                                    <MetricCard
                                        label="Buffer (Req→Eff)"
                                        value={`${String(engineStats.configuredBufferSize ?? 'auto')} → ${Math.round(engineStats.effectiveBufferSize || 0)} smp`}
                                        icon={Cpu}
                                    />
                                    <MetricCard
                                        label="Buffer Strategy"
                                        value={(engineStats.bufferStrategy || 'n/a').toUpperCase()}
                                        icon={Activity}
                                    />
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        onClick={refreshAudioDevices}
                                        disabled={isRefreshingAudioDevices}
                                        className="h-9 px-4 rounded-sm border border-white/15 bg-[#151824] text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:text-white hover:border-daw-violet/60 disabled:opacity-40 flex items-center gap-2"
                                    >
                                        <RefreshCcw size={12} className={isRefreshingAudioDevices ? 'animate-spin' : ''} />
                                        Refrescar I/O
                                    </button>
                                    <button
                                        onClick={restartAudioEngine}
                                        disabled={isRestartingAudio}
                                        className="h-9 px-4 rounded-sm border border-daw-ruby/45 bg-daw-ruby/10 text-[10px] font-bold uppercase tracking-wider text-daw-ruby hover:bg-daw-ruby/20 disabled:opacity-40 flex items-center gap-2"
                                    >
                                        <SlidersHorizontal size={12} className={isRestartingAudio ? 'animate-spin' : ''} />
                                        Reiniciar Motor
                                    </button>
                                </div>
                            </div>
                        )}

                        {activeTab === 'midi' && (
                            <div className="space-y-4">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => toggleAllMidi(true)}
                                        className="h-8 px-3 rounded-sm border border-white/15 bg-[#151824] text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:text-white hover:border-daw-violet/60"
                                    >
                                        Enable All
                                    </button>
                                    <button
                                        onClick={() => toggleAllMidi(false)}
                                        className="h-8 px-3 rounded-sm border border-white/15 bg-[#151824] text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:text-white hover:border-daw-violet/60"
                                    >
                                        Disable All
                                    </button>
                                    <button
                                        onClick={() => void midiService.init()}
                                        className="h-8 px-3 rounded-sm border border-white/15 bg-[#151824] text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:text-white hover:border-daw-violet/60 flex items-center gap-2"
                                    >
                                        <RefreshCcw size={11} />
                                        Re-scan
                                    </button>
                                </div>

                                {midiDevices.length === 0 ? (
                                    <div className="h-44 rounded-sm border border-dashed border-white/15 bg-[#12141b] flex flex-col items-center justify-center gap-3 text-gray-500">
                                        <Piano size={24} />
                                        <p className="text-xs uppercase tracking-wider">No se detectaron controladores MIDI</p>
                                    </div>
                                ) : (
                                    <div className="space-y-2">
                                        {midiDevices.map((device) => {
                                            const enabled = midiService.isEnabled(device.id);
                                            const active = isMidiDeviceHot(device.id);

                                            return (
                                                <div key={device.id} className="rounded-sm border border-white/10 bg-[#12141b] px-4 py-3 flex items-center justify-between gap-4">
                                                    <div className="min-w-0">
                                                        <div className="text-sm font-semibold text-white truncate">{device.name}</div>
                                                        <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">
                                                            {device.manufacturer || 'Generic MIDI'} · {device.state}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[9px] font-bold uppercase tracking-wider ${active ? 'border-green-500/35 bg-green-500/10 text-green-400' : 'border-white/15 bg-[#1a1e2a] text-gray-500'}`}>
                                                            <Activity size={10} /> {active ? 'Signal' : 'Idle'}
                                                        </span>
                                                        <button
                                                            onClick={() => toggleMidiDevice(device.id)}
                                                            className={`h-7 px-3 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${enabled ? 'border-daw-violet/45 bg-daw-violet/15 text-daw-violet' : 'border-white/15 bg-[#1a1e2a] text-gray-400 hover:text-white hover:border-white/30'}`}
                                                        >
                                                            {enabled ? 'Enabled' : 'Disabled'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'plugins' && (
                            <ScanManagerSection
                                title="Plugin Folders"
                                hint="Escanea VST3 y DLL para construir un indice navegable."
                                folders={pluginFolders}
                                entries={pluginIndex}
                                isDesktop={isDesktop}
                                isScanning={isScanningPlugins}
                                totalSize={pluginSize}
                                onAddFolder={() => void addFolder('plugins')}
                                onRemoveFolder={(folder) => removeFolder('plugins', folder)}
                                onScan={() => void scanFolders('plugins')}
                            />
                        )}

                        {activeTab === 'library' && (
                            <ScanManagerSection
                                title="Library Folders"
                                hint="Indexa audio (WAV, AIFF, FLAC, MP3, OGG) para flujo rapido de importacion."
                                folders={libraryFolders}
                                entries={libraryIndex}
                                isDesktop={isDesktop}
                                isScanning={isScanningLibrary}
                                totalSize={librarySize}
                                onAddFolder={() => void addFolder('library')}
                                onRemoveFolder={(folder) => removeFolder('library', folder)}
                                onScan={() => void scanFolders('library')}
                            />
                        )}

                        {statusMessage && (
                            <div className={`rounded-sm border px-3 py-2 text-[11px] flex items-start gap-2 ${statusTone === 'ok'
                                ? 'border-green-500/35 bg-green-500/10 text-green-200'
                                : statusTone === 'error'
                                    ? 'border-red-500/35 bg-red-500/10 text-red-200'
                                    : 'border-amber-500/35 bg-amber-500/10 text-amber-200'}`}>
                                {statusTone === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                                <span>{statusMessage}</span>
                            </div>
                        )}
                    </div>

                    <footer className="h-14 px-5 border-t border-white/10 bg-[#10121b] flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">
                            {hasUnsavedAudioChanges
                                ? 'Hay cambios de audio pendientes de aplicar.'
                                : 'Configuracion sincronizada.'}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setDraftAudio(audioSettings)}
                                disabled={!hasUnsavedAudioChanges}
                                className="h-9 px-4 rounded-sm border border-white/10 bg-[#151824] text-[10px] font-bold uppercase tracking-wider text-gray-300 hover:text-white disabled:opacity-40"
                            >
                                Revertir
                            </button>
                            <button
                                onClick={applyAudioChanges}
                                disabled={!hasUnsavedAudioChanges}
                                className="h-9 px-5 rounded-sm border border-daw-ruby/45 bg-gradient-to-r from-daw-violet to-daw-ruby text-white text-[10px] font-black uppercase tracking-[0.13em] disabled:opacity-40"
                            >
                                Aplicar Audio
                            </button>
                        </div>
                    </footer>
                </section>
            </div>
        </div>
    );
};

interface TabButtonProps {
    id: TabId;
    icon: React.ElementType;
    label: string;
    subLabel: string;
    active: boolean;
    onClick: (id: TabId) => void;
}

const TabButton: React.FC<TabButtonProps> = ({ id, icon: Icon, label, subLabel, active, onClick }) => (
    <button
        onClick={() => onClick(id)}
        className={`w-full rounded-sm border px-3 py-2.5 text-left transition-all ${active
            ? 'border-daw-violet/40 bg-daw-violet/10'
            : 'border-white/5 bg-white/[0.01] hover:border-white/20 hover:bg-white/[0.03]'}`}
    >
        <div className="flex items-center gap-2">
            <Icon size={14} className={active ? 'text-daw-violet' : 'text-gray-500'} />
            <div className={`text-[11px] font-bold uppercase tracking-wider ${active ? 'text-white' : 'text-gray-300'}`}>{label}</div>
        </div>
        <div className={`text-[9px] mt-1 uppercase tracking-wide ${active ? 'text-daw-violet/60' : 'text-gray-500'}`}>{subLabel}</div>
    </button>
);

interface SelectFieldProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options }) => (
    <div className="space-y-1.5">
        <label className="text-[10px] uppercase tracking-wider text-gray-500">{label}</label>
        <div className="relative">
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className={`${entryClass} w-full pr-8`}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#11131a] text-white">
                        {option.label}
                    </option>
                ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>
    </div>
);

interface ProfileButtonProps {
    title: string;
    description: string;
    active: boolean;
    onClick: () => void;
}

const ProfileButton: React.FC<ProfileButtonProps> = ({ title, description, active, onClick }) => (
    <button
        onClick={onClick}
        className={`rounded-sm border px-4 py-3 text-left transition-all ${active
            ? 'border-daw-violet/45 bg-daw-violet/12 text-white'
            : 'border-white/10 bg-[#131620] text-gray-300 hover:text-white hover:border-white/25'}`}
    >
        <div className="text-[11px] font-black uppercase tracking-wider">{title}</div>
        <div className="text-[10px] mt-1 text-gray-500">{description}</div>
    </button>
);

interface MetricCardProps {
    label: string;
    value: string;
    icon: React.ElementType;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, icon: Icon }) => (
    <div className="rounded-sm border border-white/10 bg-[#131620] px-3 py-2.5">
        <div className="flex items-center gap-2 text-gray-500 text-[10px] uppercase tracking-wider">
            <Icon size={12} /> {label}
        </div>
        <div className="mt-1 text-sm font-mono text-white">{value}</div>
    </div>
);

interface ScanManagerSectionProps {
    title: string;
    hint: string;
    folders: string[];
    entries: ScannedFileEntry[];
    totalSize: number;
    isDesktop: boolean;
    isScanning: boolean;
    onAddFolder: () => void;
    onRemoveFolder: (folder: string) => void;
    onScan: () => void;
}

const ScanManagerSection: React.FC<ScanManagerSectionProps> = ({
    title,
    hint,
    folders,
    entries,
    totalSize,
    isDesktop,
    isScanning,
    onAddFolder,
    onRemoveFolder,
    onScan
}) => (
    <div className="space-y-4">
        <div className="rounded-sm border border-white/10 bg-[#131620] p-4">
            <div className="flex items-center justify-between gap-3">
                <div>
                    <h3 className="text-sm font-semibold text-white">{title}</h3>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">{hint}</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={onAddFolder}
                        disabled={!isDesktop}
                        className="h-8 px-3 rounded-sm border border-white/15 bg-[#171a26] text-[10px] font-bold uppercase tracking-wider text-gray-200 hover:text-white disabled:opacity-40 flex items-center gap-1.5"
                    >
                        <FolderOpen size={11} /> Agregar carpeta
                    </button>
                    <button
                        onClick={onScan}
                        disabled={!isDesktop || isScanning}
                        className="h-8 px-3 rounded-sm border border-daw-violet/35 bg-daw-violet/12 text-[10px] font-bold uppercase tracking-wider text-daw-violet hover:bg-daw-violet/20 disabled:opacity-40 flex items-center gap-1.5"
                    >
                        {isScanning ? <RefreshCcw size={11} className="animate-spin" /> : <Search size={11} />}
                        Escanear
                    </button>
                </div>
            </div>

            {!isDesktop && (
                <div className="mt-3 rounded-sm border border-amber-400/30 bg-amber-400/10 text-amber-200 text-[10px] px-3 py-2">
                    Esta funcion requiere la app desktop para acceder al sistema de archivos.
                </div>
            )}

            <div className="mt-3 space-y-2">
                {folders.length === 0 ? (
                    <div className="h-12 rounded-sm border border-dashed border-white/15 bg-[#11131a] px-3 flex items-center text-[11px] text-gray-500">
                        No hay carpetas agregadas.
                    </div>
                ) : (
                    folders.map((folder) => (
                        <div key={folder} className="h-10 rounded-sm border border-white/10 bg-[#11131a] px-3 flex items-center justify-between gap-3">
                            <span className="text-xs text-gray-300 truncate">{folder}</span>
                            <button
                                onClick={() => onRemoveFolder(folder)}
                                className="text-[10px] uppercase tracking-wider text-gray-500 hover:text-daw-ruby"
                            >
                                quitar
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
            <MetricCard label="Archivos" value={String(entries.length)} icon={HardDrive} />
            <MetricCard label="Tamano indexado" value={prettyBytes(totalSize)} icon={Activity} />
        </div>

        <div className="rounded-sm border border-white/10 bg-[#131620] overflow-hidden">
            <div className="h-9 px-3 border-b border-white/10 flex items-center text-[10px] uppercase tracking-wider text-gray-500">
                Ultimos archivos indexados
            </div>
            <div className="max-h-[240px] overflow-y-auto custom-scrollbar">
                {entries.length === 0 ? (
                    <div className="h-16 px-3 flex items-center text-xs text-gray-500">Todavia no hay resultados de escaneo.</div>
                ) : (
                    entries.slice(0, 300).map((entry) => (
                        <div key={entry.path} className="h-9 px-3 border-b border-white/5 flex items-center justify-between gap-3">
                            <span className="text-xs text-gray-300 truncate">{entry.name}</span>
                            <span className="text-[10px] font-mono text-gray-500 shrink-0">{prettyBytes(entry.size)}</span>
                        </div>
                    ))
                )}
            </div>
        </div>
    </div>
);

export { HardwareSettingsModal };
