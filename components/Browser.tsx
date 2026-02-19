import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioWaveform, FileAudio, FolderOpen, Info, Library, Play, Plus, RefreshCcw } from 'lucide-react';
import { ScannedFileEntry, Track, TrackType } from '../types';
import { audioEngine } from '../services/audioEngine';
import { loadStudioSettings } from '../services/studioSettingsService';
import { platformService } from '../services/platformService';
import {
    BrowserDragPayload,
    BROWSER_DRAG_MIME,
    serializeBrowserDragPayload
} from '../services/browserDragService';

interface BrowserProps {
    onImport: () => void;
    onImportFromLibrary: (entry: ScannedFileEntry) => void;
    onCreateGeneratorTrack: (type: 'noise' | 'sine') => void;
    tracks: Track[];
}

type BrowserTab = 'project' | 'library';

const Browser: React.FC<BrowserProps> = ({ onImport, onImportFromLibrary, onCreateGeneratorTrack, tracks }) => {
    const [activeTab, setActiveTab] = useState<BrowserTab>('project');
    const [filter, setFilter] = useState('');
    const [libraryIndex, setLibraryIndex] = useState<ScannedFileEntry[]>(() => loadStudioSettings().libraryIndex);
    const [isRefreshingLibrary, setIsRefreshingLibrary] = useState(false);
    const [previewLoadingPath, setPreviewLoadingPath] = useState<string | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const libraryPreviewCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

    const refreshLibraryIndex = useCallback(() => {
        setIsRefreshingLibrary(true);
        const settings = loadStudioSettings();
        const sorted = [...settings.libraryIndex].sort((a, b) => a.name.localeCompare(b.name));
        setLibraryIndex(sorted);
        setStatusMessage(`Indice actualizado: ${sorted.length} archivos detectados.`);
        window.setTimeout(() => setStatusMessage(null), 1600);
        setIsRefreshingLibrary(false);
    }, []);

    useEffect(() => {
        refreshLibraryIndex();
    }, [refreshLibraryIndex]);

    useEffect(() => {
        const onStorage = (event: StorageEvent) => {
            if (event.key !== 'ethereal.studio-settings.v1') return;
            refreshLibraryIndex();
        };

        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, [refreshLibraryIndex]);

    const projectFiles = useMemo(() => {
        const files: Array<{
            id: string;
            sourceTrackId: string;
            name: string;
            buffer: AudioBuffer;
            trackColor: string;
            sourceKey: string;
        }> = [];
        const seen = new Set<string>();

        tracks.forEach((track) => {
            if (track.type !== TrackType.AUDIO) return;

            track.clips.forEach((clip) => {
                if (!clip.buffer) return;
                const sourceKey = clip.sourceId || `${clip.name}:${clip.buffer.length}:${clip.buffer.sampleRate}`;
                if (seen.has(sourceKey)) return;

                files.push({
                    id: clip.id,
                    sourceTrackId: track.id,
                    name: clip.name,
                    buffer: clip.buffer,
                    trackColor: track.color,
                    sourceKey
                });
                seen.add(sourceKey);
            });
        });

        return files;
    }, [tracks]);

    const filteredProjectFiles = useMemo(() => {
        const query = filter.trim().toLowerCase();
        if (!query) return projectFiles;
        return projectFiles.filter((file) => file.name.toLowerCase().includes(query));
    }, [filter, projectFiles]);

    const filteredLibraryFiles = useMemo(() => {
        const query = filter.trim().toLowerCase();
        if (!query) return libraryIndex;
        return libraryIndex.filter((entry) => {
            return entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query);
        });
    }, [filter, libraryIndex]);

    const previewGenerator = useCallback((type: 'noise' | 'sine') => {
        const buffer = type === 'noise'
            ? audioEngine.createNoiseBuffer(4)
            : audioEngine.createSineBuffer(440, 4);

        audioEngine.previewBuffer(buffer);
    }, []);

    const resolveLibraryBuffer = useCallback(async (entry: ScannedFileEntry): Promise<AudioBuffer | null> => {
        const cached = libraryPreviewCacheRef.current.get(entry.path);
        if (cached) return cached;

        const fileData = await platformService.readFileFromPath(entry.path);
        if (!fileData) return null;

        const decoded = await audioEngine.decodeAudioData(fileData.data.slice(0));
        libraryPreviewCacheRef.current.set(entry.path, decoded);
        return decoded;
    }, []);

    const previewLibraryEntry = useCallback(async (entry: ScannedFileEntry) => {
        if (!platformService.isDesktop) {
            setStatusMessage('Preview de libreria requiere la version desktop.');
            return;
        }

        setPreviewLoadingPath(entry.path);
        try {
            const buffer = await resolveLibraryBuffer(entry);
            if (!buffer) {
                setStatusMessage('No se pudo abrir el archivo para preescucha.');
                return;
            }

            audioEngine.previewBuffer(buffer);
            setStatusMessage(`Preview: ${entry.name}`);
        } catch (error) {
            console.error('Preview library file failed', error);
            setStatusMessage('Fallo la preescucha del archivo.');
        } finally {
            setPreviewLoadingPath(null);
            window.setTimeout(() => setStatusMessage(null), 1200);
        }
    }, [resolveLibraryBuffer]);

    const handleDragStart = useCallback((event: React.DragEvent, payload: BrowserDragPayload, label: string) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(BROWSER_DRAG_MIME, serializeBrowserDragPayload(payload));
        event.dataTransfer.setData('text/plain', label);
    }, []);

    return (
        <div className="h-full flex flex-col bg-[#0a0a0c] text-white overflow-hidden font-sans">
            <div className="p-4 border-b border-daw-border bg-[#121215]">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <h2 className="text-xs font-black tracking-widest text-gray-400 uppercase">Navegador del Proyecto</h2>
                    <button
                        onClick={refreshLibraryIndex}
                        className="h-7 px-2 rounded-sm border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-[10px] uppercase tracking-wider text-gray-300 flex items-center gap-1"
                        title="Refrescar indice de libreria"
                        disabled={isRefreshingLibrary}
                    >
                        <RefreshCcw size={11} className={isRefreshingLibrary ? 'animate-spin' : ''} />
                        Sync
                    </button>
                </div>

                <div className="grid grid-cols-2 gap-1 mb-2 p-0.5 rounded-sm border border-white/10 bg-black/20">
                    <button
                        onClick={() => setActiveTab('project')}
                        className={`h-7 rounded-[3px] text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            activeTab === 'project' ? 'bg-[#242838] text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        Proyecto
                    </button>
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`h-7 rounded-[3px] text-[10px] font-bold uppercase tracking-wider transition-colors ${
                            activeTab === 'library' ? 'bg-[#242838] text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                        Libreria
                    </button>
                </div>

                <input
                    type="text"
                    placeholder={activeTab === 'project' ? 'Filtrar clips del proyecto...' : 'Filtrar libreria...'}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="w-full bg-[#050505] border border-daw-border rounded-sm px-2 py-1.5 text-xs text-white focus:outline-none focus:border-daw-cyan placeholder-gray-700"
                />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {activeTab === 'project' ? (
                    <>
                        <div className="mb-6">
                            <div className="flex items-center justify-between px-2 mb-2">
                                <h3 className="text-[10px] font-bold text-gray-500 uppercase">Archivos del Proyecto</h3>
                                <span className="text-[9px] text-gray-600 bg-[#1a1a1a] px-1 rounded-sm">{projectFiles.length}</span>
                            </div>

                            {filteredProjectFiles.length === 0 ? (
                                <div className="p-4 text-center border border-dashed border-gray-800 rounded-sm">
                                    <span className="text-[10px] text-gray-600 italic">No hay clips de audio en la sesion.</span>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    {filteredProjectFiles.map((file) => (
                                        <div
                                            key={file.sourceKey}
                                            draggable
                                            onDragStart={(event) => handleDragStart(event, {
                                                kind: 'project-clip',
                                                sourceTrackId: file.sourceTrackId,
                                                clipId: file.id
                                            }, file.name)}
                                            className="group flex items-center justify-between p-2 rounded-sm hover:bg-[#1a1a1a] border border-transparent hover:border-daw-border transition-all cursor-grab active:cursor-grabbing"
                                        >
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: file.trackColor }}></span>
                                                <FileAudio size={12} className="text-gray-500 shrink-0" />
                                                <span className="text-xs text-gray-300 truncate group-hover:text-white" title={file.name}>{file.name}</span>
                                            </div>
                                            <button
                                                onClick={(event) => { event.stopPropagation(); audioEngine.previewBuffer(file.buffer); }}
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-daw-cyan transition-opacity"
                                                title="Previsualizar"
                                            >
                                                <Play size={10} fill="currentColor" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mb-6">
                            <h3 className="text-[10px] font-bold text-gray-500 uppercase mb-2 px-2">Importacion</h3>
                            <button
                                onClick={onImport}
                                className="w-full flex items-center gap-3 p-3 rounded-sm bg-[#121215] hover:bg-[#18181b] border border-daw-border hover:border-daw-cyan transition-all"
                            >
                                <div className="w-8 h-8 rounded-full bg-[#0a0a0c] flex items-center justify-center border border-gray-800">
                                    <Plus size={14} className="text-gray-400" />
                                </div>
                                <div className="text-left">
                                    <div className="text-xs font-bold text-gray-200">Importar audio</div>
                                    <div className="text-[9px] text-gray-600">WAV, MP3, AIF, FLAC, OGG</div>
                                </div>
                            </button>
                        </div>

                        <div>
                            <h3 className="text-[10px] font-bold text-gray-500 uppercase mb-2 px-2">Generadores</h3>
                            <div className="space-y-1.5">
                                <GeneratorRow
                                    title="Rafaga de ruido blanco"
                                    icon={<AudioWaveform size={12} className="text-daw-ruby" />}
                                    onPreview={() => previewGenerator('noise')}
                                    onCreateTrack={() => onCreateGeneratorTrack('noise')}
                                    onDragStart={(event) => handleDragStart(event, { kind: 'generator', generatorType: 'noise' }, 'Noise Generator')}
                                />
                                <GeneratorRow
                                    title="Tono senoidal 440 Hz"
                                    icon={<AudioWaveform size={12} className="text-daw-cyan" />}
                                    onPreview={() => previewGenerator('sine')}
                                    onCreateTrack={() => onCreateGeneratorTrack('sine')}
                                    onDragStart={(event) => handleDragStart(event, { kind: 'generator', generatorType: 'sine' }, 'Sine Generator')}
                                />
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div className="mb-3 px-2 flex items-center justify-between">
                            <div className="text-[10px] font-bold uppercase text-gray-500">Indice de libreria</div>
                            <span className="text-[9px] text-gray-600 bg-[#1a1a1a] px-1 rounded-sm">{libraryIndex.length}</span>
                        </div>

                        {!platformService.isDesktop && (
                            <div className="mx-2 mb-3 px-2.5 py-2 rounded-sm border border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-200">
                                El modo web permite ver el indice, pero importar/preescuchar por ruta requiere desktop.
                            </div>
                        )}

                        {filteredLibraryFiles.length === 0 ? (
                            <div className="p-4 text-center border border-dashed border-gray-800 rounded-sm mx-2">
                                <div className="text-[10px] text-gray-500">No hay archivos en el indice.</div>
                                <div className="text-[9px] text-gray-600 mt-1">Configuralo en Configuracion -&gt; Contenido.</div>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {filteredLibraryFiles.map((entry) => (
                                    <div
                                        key={entry.path}
                                        draggable
                                        onDragStart={(event) => handleDragStart(event, {
                                            kind: 'library-entry',
                                            entry: {
                                                name: entry.name,
                                                path: entry.path,
                                                size: entry.size
                                            }
                                        }, entry.name)}
                                        className="group p-2 rounded-sm hover:bg-[#1a1a1a] border border-transparent hover:border-daw-border transition-all cursor-grab active:cursor-grabbing"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="min-w-0 flex items-center gap-2">
                                                <Library size={12} className="text-gray-600 shrink-0" />
                                                <div className="min-w-0">
                                                    <div className="text-xs text-gray-300 truncate" title={entry.name}>{entry.name}</div>
                                                    <div className="text-[9px] text-gray-600 truncate" title={entry.path}>{entry.path}</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => previewLibraryEntry(entry)}
                                                    disabled={previewLoadingPath === entry.path}
                                                    className="h-6 w-6 rounded-sm border border-white/10 bg-white/[0.03] hover:bg-white/[0.1] disabled:opacity-40 flex items-center justify-center"
                                                    title="Preescuchar"
                                                >
                                                    <Play size={10} fill="currentColor" className="text-gray-300" />
                                                </button>
                                                <button
                                                    onClick={() => onImportFromLibrary(entry)}
                                                    className="h-6 px-2 rounded-sm border border-daw-violet/30 bg-daw-violet/10 hover:bg-daw-violet/20 text-[9px] uppercase tracking-wider text-daw-violet"
                                                    title="Importar a proyecto"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                <div className="mt-6 px-2">
                    <div className="flex items-start gap-2 text-[10px] text-gray-600 bg-black/20 p-2 rounded-sm">
                        <Info size={12} className="shrink-0 mt-0.5" />
                        <p>
                            {statusMessage || 'El Browser opera con indice real de libreria y acciones directas de importacion/preescucha.'}
                        </p>
                    </div>
                </div>

                <div className="mt-2 px-2 text-[9px] text-gray-600 flex items-center gap-1">
                    <FolderOpen size={10} />
                    Tip: Arrastra clips o archivos a Timeline/Session para insercion directa.
                </div>
            </div>
        </div>
    );
};

const GeneratorRow: React.FC<{
    title: string;
    icon: React.ReactNode;
    onPreview: () => void;
    onCreateTrack: () => void;
    onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
}> = ({ title, icon, onPreview, onCreateTrack, onDragStart }) => {
    return (
        <div
            draggable
            onDragStart={onDragStart}
            className="flex items-center gap-2 p-2 rounded-sm hover:bg-[#1a1a1a] border border-transparent hover:border-daw-border cursor-grab active:cursor-grabbing"
        >
            {icon}
            <span className="text-xs text-gray-300 flex-1">{title}</span>
            <button
                onClick={onPreview}
                className="h-6 px-2 rounded-sm border border-white/10 bg-white/[0.03] hover:bg-white/[0.1] text-[9px] uppercase tracking-wider text-gray-300"
            >
                Preview
            </button>
            <button
                onClick={onCreateTrack}
                className="h-6 px-2 rounded-sm border border-daw-cyan/30 bg-daw-cyan/10 hover:bg-daw-cyan/20 text-[9px] uppercase tracking-wider text-daw-cyan"
            >
                Create
            </button>
        </div>
    );
};

export default Browser;
