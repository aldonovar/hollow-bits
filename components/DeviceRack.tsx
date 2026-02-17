// path: components/DeviceRack.tsx
import React, { useRef, useEffect, useState } from 'react';
import { Track, Device } from '../types';
import Knob from './Knob';
import { Sliders, Activity, Plus, GripVertical, Box } from 'lucide-react';
import { audioEngine } from '../services/audioEngine';
import { VSTDeviceView } from './VSTDeviceView';

// DND Kit Imports
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DeviceRackProps {
    selectedTrack: Track | null;
    onTrackUpdate: (trackId: string, update: Partial<Track>) => void;
}

// --- Sortable Device Item Component ---
interface SortableDeviceProps {
    device: Device;
    trackColor: string;
    onParamChange: (deviceId: string, paramName: string, newValue: number) => void;
    onRemove: (deviceId: string) => void;
}

// path: components/DeviceRack.tsx
import { PluginWrapper } from './PluginWrapper';

const SortableDevice: React.FC<SortableDeviceProps> = ({ device, trackColor, onParamChange, onRemove }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: device.id });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 100 : undefined,
    };

    return (
        <div ref={setNodeRef} style={style} className="h-full py-1">
            <PluginWrapper
                device={device}
                isActive={true}
                onRemove={() => onRemove(device.id)}
                dragHandleProps={{ ...attributes, ...listeners }}
                color={trackColor}
            >
                {device.type === 'vst-loader' ? (
                    <VSTDeviceView device={device} color={trackColor} />
                ) : device.type === 'eq' ? (
                    <div className="w-full flex flex-col h-full items-center justify-center gap-2">
                        <VisualEQ params={device.params} color={trackColor} />
                        <div className="flex justify-between w-full gap-1 px-1">
                            {device.params.map((param, pIdx) => (
                                <Knob
                                    key={pIdx}
                                    value={param.value}
                                    min={param.min}
                                    max={param.max}
                                    unit={param.unit}
                                    label={param.name.replace('Ganancia ', '').replace('Frec ', 'Frec')}
                                    onChange={(v) => onParamChange(device.id, param.name, v)}
                                    color={trackColor}
                                    size={28}
                                    bipolar={param.min < 0}
                                />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-center gap-3 h-full w-full">
                        {device.params.map((param, pIdx) => (
                            <Knob
                                key={pIdx}
                                value={param.value}
                                min={param.min}
                                max={param.max}
                                unit={param.unit}
                                label={param.name}
                                onChange={(v) => onParamChange(device.id, param.name, v)}
                                color={trackColor}
                                size={38}
                                bipolar={param.min < 0}
                            />
                        ))}
                    </div>
                )}
            </PluginWrapper>
        </div>
    );
};

// --- Visual EQ Canvas ---
const VisualEQ: React.FC<{ params: { name: string; value: number }[], color: string }> = ({ params, color }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // Draw Grid
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < width; i += width / 4) { ctx.moveTo(i, 0); ctx.lineTo(i, height); }
        for (let i = 0; i < height; i += height / 4) { ctx.moveTo(0, i); ctx.lineTo(width, i); }
        ctx.stroke();

        // Get Params
        const lowGain = params.find(p => p.name.includes('Baja'))?.value || 0;
        const midFreq = params.find(p => p.name.includes('Frec'))?.value || 1000;
        const midGain = params.find(p => p.name.includes('Media'))?.value || 0;
        const highGain = params.find(p => p.name.includes('Alta'))?.value || 0;

        // Simulate Curve
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;

        const centerY = height / 2;
        ctx.moveTo(0, centerY - (lowGain * 3));

        const minLog = Math.log10(20);
        const maxLog = Math.log10(20000);
        const valLog = Math.log10(Math.max(20, Math.min(20000, midFreq)));
        const midX = ((valLog - minLog) / (maxLog - minLog)) * width;
        const midY = centerY - (midGain * 3);

        ctx.bezierCurveTo(width * 0.2, centerY - (lowGain * 3), midX - 20, midY, midX, midY);
        ctx.bezierCurveTo(midX + 20, midY, width * 0.8, centerY - (highGain * 3), width, centerY - (highGain * 3));

        ctx.stroke();

        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.fillStyle = `${color}20`;
        ctx.shadowBlur = 0;
        ctx.fill();

    }, [params, color]);

    return <canvas ref={canvasRef} width={200} height={100} className="w-full h-[100px] bg-[#000] rounded-sm mb-2 border border-white/10" />;
};

// --- Main Component ---
const DeviceRackComponent: React.FC<DeviceRackProps> = ({ selectedTrack, onTrackUpdate }) => {
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8, // 8px movement before drag starts
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    if (!selectedTrack) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-daw-muted font-sans gap-3 bg-[#08060a]">
                <Activity size={40} className="opacity-10" />
                <span className="text-xs tracking-[0.2em] opacity-40 uppercase font-bold">Selecciona una Pista</span>
            </div>
        );
    }

    const handleParamChange = (deviceId: string, paramName: string, newValue: number) => {
        audioEngine.setDeviceParam(selectedTrack.id, deviceId, paramName, newValue);
        const newDevices = selectedTrack.devices.map(d => {
            if (d.id === deviceId) {
                return {
                    ...d,
                    params: d.params.map(p => p.name === paramName ? { ...p, value: newValue } : p)
                };
            }
            return d;
        });
        onTrackUpdate(selectedTrack.id, { devices: newDevices });
    };

    const handleAddDevice = (type: 'eq' | 'delay' | 'reverb' | 'vst-loader') => {
        const id = `fx-${Date.now()}`;
        let newDevice: Device;

        if (type === 'vst-loader') {
            newDevice = {
                id, name: 'External Plugin', type: 'vst-loader',
                params: []
            };
        } else if (type === 'eq') {
            newDevice = {
                id, name: 'EQ Three', type: 'eq',
                params: [
                    { name: 'Ganancia Baja', value: 0, min: -12, max: 12, unit: 'dB' },
                    { name: 'Ganancia Media', value: 0, min: -12, max: 12, unit: 'dB' },
                    { name: 'Ganancia Alta', value: 0, min: -12, max: 12, unit: 'dB' },
                    { name: 'Frec Media', value: 1000, min: 200, max: 5000, unit: 'Hz' }
                ]
            };
        } else if (type === 'delay') {
            newDevice = {
                id, name: 'Delay', type: 'effect',
                params: [
                    { name: 'Time', value: 0.3, min: 0.01, max: 2.0, unit: 's' },
                    { name: 'Feedback', value: 0.4, min: 0, max: 0.95, unit: '' }
                ]
            };
        } else {
            newDevice = {
                id, name: 'Reverb', type: 'effect',
                params: [
                    { name: 'Mix', value: 0.3, min: 0, max: 1, unit: '' }
                ]
            };
        }

        const newDevices = [...selectedTrack.devices, newDevice];
        audioEngine.updateTrackEffects(selectedTrack.id, newDevices);
        onTrackUpdate(selectedTrack.id, { devices: newDevices });
        setShowAddMenu(false);
    };

    const removeDevice = (deviceId: string) => {
        const newDevices = selectedTrack.devices.filter(d => d.id !== deviceId);
        audioEngine.updateTrackEffects(selectedTrack.id, newDevices);
        onTrackUpdate(selectedTrack.id, { devices: newDevices });
    };

    // --- Drag Handlers ---
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id as string);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (over && active.id !== over.id) {
            const oldIndex = selectedTrack.devices.findIndex(d => d.id === active.id);
            const newIndex = selectedTrack.devices.findIndex(d => d.id === over.id);

            const reorderedDevices = arrayMove(selectedTrack.devices, oldIndex, newIndex);

            // Update Audio Engine with new order
            audioEngine.reorderEffects(selectedTrack.id, reorderedDevices);
            onTrackUpdate(selectedTrack.id, { devices: reorderedDevices });
        }
    };

    const activeDevice = activeId ? selectedTrack.devices.find(d => d.id === activeId) : null;

    return (
        <div className="h-full w-full overflow-x-auto flex items-center px-4 gap-4 bg-[#08060a] border-t border-daw-border shadow-inner">

            {/* Track Info Side Panel */}
            <div className="flex flex-col justify-center items-start text-xs text-daw-muted font-bold uppercase mr-2 border-r border-daw-border pr-6 h-3/4 min-w-[140px]">
                <span className="text-[9px] text-gray-600 mb-1 tracking-wider">Cadena de Dispositivos</span>
                <span className="text-xl tracking-tighter font-bold text-white truncate max-w-full">{selectedTrack.name}</span>
                <div className="flex items-center gap-2 mt-2 text-gray-500">
                    <Sliders size={12} />
                    <span className="text-[10px]">{selectedTrack.devices.length} DISPOSITIVOS</span>
                </div>
            </div>

            {/* Sortable Device List */}
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <SortableContext items={selectedTrack.devices.map(d => d.id)} strategy={horizontalListSortingStrategy}>
                    {selectedTrack.devices.map((device) => (
                        <SortableDevice
                            key={device.id}
                            device={device}
                            trackColor={selectedTrack.color}
                            onParamChange={handleParamChange}
                            onRemove={removeDevice}
                        />
                    ))}
                </SortableContext>

                {/* Drag Overlay for visual feedback during drag */}
                <DragOverlay>
                    {activeDevice ? (
                        <div className="bg-[#120f16] border-2 border-daw-violet rounded-sm min-w-[240px] h-[200px] flex flex-col shadow-2xl opacity-90 ring-4 ring-daw-violet/20">
                            <div className="h-10 bg-[#1a171e] border-b border-daw-border flex items-center justify-between px-3">
                                <div className="flex items-center gap-2">
                                    <GripVertical size={14} className="text-daw-violet" />
                                    <span className="text-[10px] font-bold text-gray-200 tracking-wider uppercase">{activeDevice.name}</span>
                                </div>
                            </div>
                            <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
                                Arrastrando...
                            </div>
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Add Device Button */}
            <div className="relative">
                <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="h-[200px] w-[60px] border border-dashed border-daw-border rounded-sm flex flex-col gap-2 items-center justify-center text-gray-700 hover:border-daw-ruby hover:text-daw-ruby cursor-pointer transition-all opacity-50 hover:opacity-100 bg-[#0e0c10]"
                >
                    <Plus size={24} strokeWidth={1} />
                </button>

                {showAddMenu && (
                    <div className="absolute top-0 left-full ml-2 w-48 bg-[#1a1a1a] border border-daw-border shadow-xl rounded-sm z-50 flex flex-col py-1">
                        <div className="px-3 py-2 text-[10px] text-gray-500 font-bold uppercase border-b border-white/5">Añadir Efecto</div>
                        <button onClick={() => handleAddDevice('eq')} className="px-4 py-2 text-xs text-left text-gray-300 hover:bg-daw-violet hover:text-white transition-colors">EQ Three</button>
                        <button onClick={() => handleAddDevice('delay')} className="px-4 py-2 text-xs text-left text-gray-300 hover:bg-daw-violet hover:text-white transition-colors">Delay</button>
                        <button onClick={() => handleAddDevice('reverb')} className="px-4 py-2 text-xs text-left text-gray-300 hover:bg-daw-violet hover:text-white transition-colors">Reverb</button>
                        <div className="my-1 border-t border-white/5" />
                        <button onClick={() => handleAddDevice('vst-loader')} className="px-4 py-2 text-xs text-left text-gray-300 hover:bg-daw-ruby hover:text-white transition-colors flex items-center gap-2">
                            <Box size={12} />
                            External Plugin (VST)
                        </button>
                    </div>
                )}
            </div>

            {/* Spacer */}
            <div className="w-8 shrink-0"></div>
        </div>
    );
};

const DeviceRack = React.memo(DeviceRackComponent);
export default DeviceRack;
