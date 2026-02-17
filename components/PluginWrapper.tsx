// path: components/PluginWrapper.tsx
import React, { useState } from 'react';
import { Power, ChevronDown, ChevronRight, GripVertical, X } from 'lucide-react';
import { Device } from '../types';

interface PluginWrapperProps {
    device: Device;
    children: React.ReactNode;
    isActive?: boolean;
    onBypassToggle?: () => void;
    onRemove?: () => void;
    dragHandleProps?: any;
    color?: string;
}

export const PluginWrapper: React.FC<PluginWrapperProps> = ({
    device,
    children,
    isActive = true,
    onBypassToggle,
    onRemove,
    dragHandleProps,
    color = '#a855f7' // Default violet
}) => {
    const [isExpanded, setIsExpanded] = useState(true);

    // Use color for custom border or accent
    const activeColor = color;

    return (
        <div
            style={{ borderColor: isActive ? activeColor : undefined }}
            className={`
            flex flex-col bg-[#120f16] border rounded-sm shadow-lg overflow-hidden shrink-0 transition-all duration-200
            ${isActive ? '' : 'opacity-60'}
            ${isExpanded ? 'h-[220px] min-w-[180px]' : 'h-[220px] w-[32px]'}
            group relative select-none
        `}>
            {/* Header / Title Bar */}
            <div className={`
                h-7 flex items-center justify-between px-1.5 bg-[#1a171e] border-b border-daw-border
                ${isExpanded ? 'w-full' : 'flex-col h-full py-2 w-full border-b-0 border-r'}
            `}>
                <div className={`flex items-center gap-1.5 ${isExpanded ? '' : 'flex-col gap-3'}`}>
                    {/* Expand/Collapse Toggle */}
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-gray-500 hover:text-white transition-colors"
                    >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>

                    {/* Drag Handle */}
                    {dragHandleProps && (
                        <div {...dragHandleProps} className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-white transition-colors" title="Arrastrar">
                            <GripVertical size={12} />
                        </div>
                    )}

                    {/* Device Name */}
                    <span
                        className={`text-[9px] font-bold uppercase tracking-wider text-gray-200 truncate ${isExpanded ? 'max-w-[100px]' : '[writing-mode:vertical-rl] rotate-180 whitespace-nowrap py-2'}`}
                        title={device.name}
                    >
                        {device.name}
                    </span>
                </div>

                <div className={`flex items-center gap-1.5 ${isExpanded ? '' : 'flex-col-reverse mt-auto'}`}>
                    {/* Bypass Switch */}
                    <button
                        onClick={onBypassToggle}
                        className={`transition-all ${isActive ? 'text-daw-cyan shadow-[0_0_8px_rgba(34,211,238,0.4)]' : 'text-gray-600'}`}
                        title={isActive ? "Desactivar" : "Activar"}
                    >
                        <Power size={12} />
                    </button>

                    {/* Menu / Context */}
                    {isExpanded && (
                        <button onClick={onRemove} className="text-gray-600 hover:text-red-500 transition-colors" title="Eliminar">
                            <X size={12} />
                        </button>
                    )}
                </div>
            </div>

            {/* Content Area */}
            {isExpanded && (
                <div className="flex-1 bg-[#120f16] relative flex flex-col min-w-[200px]">
                    {/* Preset Bar Placeholder */}
                    <div className="h-5 bg-black/20 flex items-center justify-between px-2 cursor-pointer hover:bg-white/5 transition-colors border-b border-white/5">
                        <span className="text-[8px] text-gray-500 italic">Init Preset</span>
                        <ChevronDown size={8} className="text-gray-600" />
                    </div>

                    {/* Device UI Container */}
                    <div className="flex-1 flex items-center justify-center p-2">
                        {children}
                    </div>
                </div>
            )}

            {/* Collapsed State Visual */}
            {!isExpanded && (
                <div className="flex-1 flex flex-col items-center justify-end pb-3 gap-1">
                    {/* Visual indicator for collapsed state */}
                </div>
            )}
        </div>
    );
};
