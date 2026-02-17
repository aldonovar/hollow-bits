// path: components/VSTDeviceView.tsx
import React, { useState } from 'react';
import { HardDrive, Monitor, Settings2 } from 'lucide-react';
import { Device } from '../types';

interface VSTDeviceViewProps {
    device: Device;
    color: string;
}

export const VSTDeviceView: React.FC<VSTDeviceViewProps> = ({ device, color }) => {
    // Determine strict state from the device name/id for now
    // In a real implementation this would come from the node state
    const [isLoaded, setIsLoaded] = useState(false);
    const [pluginName, setPluginName] = useState(device.name || "External Plugin");

    const handleLoadPlugin = () => {
        // Simulate loading
        setIsLoaded(true);
        setPluginName("Vital Audio (VST3)");
    };

    return (
        <div className="w-[180px] h-full flex flex-col items-center justify-center gap-2 relative">
            {/* Status Header */}
            <div className="absolute top-0 left-0 right-0 h-6 border-b border-white/5 bg-white/5 flex items-center justify-between px-2">
                <span className="text-[9px] font-bold text-white/50 tracking-wider">VST HOSTER</span>
                <div
                    className={`w-1.5 h-1.5 rounded-full ${isLoaded ? 'shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'opacity-50'}`}
                    style={{ backgroundColor: isLoaded ? '#22c55e' : color }}
                />
            </div>

            {!isLoaded ? (
                <div className="flex flex-col items-center gap-2 mt-4 text-center">
                    <button
                        onClick={handleLoadPlugin}
                        className="w-10 h-10 rounded-sm bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-all group"
                        style={{ borderColor: isLoaded ? 'transparent' : `${color}40`, color: color }}
                    >
                        <HardDrive size={16} className="opacity-50 group-hover:opacity-100 transition-opacity" />
                    </button>
                    <p className="text-[10px] text-white/30 px-2 leading-tight">Click to load plugin</p>
                </div>
            ) : (
                <div className="flex flex-col items-center w-full mt-5 px-2 gap-2">
                    {/* Plugin Info */}
                    <div className="text-center w-full">
                        <div className="text-xs font-bold text-white truncate">{pluginName}</div>
                        <div className="text-[9px] text-white/40">Generic Vendor</div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-1 w-full">
                        <button className="flex items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-sm px-2 py-1.5 transition-colors">
                            <Monitor size={10} className="text-white/60" />
                            <span className="text-[9px] font-semibold text-white/70">GUI</span>
                        </button>
                        <button className="flex items-center justify-center gap-1 bg-white/5 hover:bg-white/10 border border-white/5 rounded-sm px-2 py-1.5 transition-colors">
                            <Settings2 size={10} className="text-white/60" />
                            <span className="text-[9px] font-semibold text-white/70">CFG</span>
                        </button>
                    </div>

                    {/* Quick Params Preview */}
                    <div className="flex items-center gap-1 w-full justify-center mt-1">
                        {[1, 2, 3, 4].map(idx => (
                            <div key={idx} className="w-1 h-3 bg-white/10 rounded-sm overflow-hidden">
                                <div
                                    className="w-full rounded-sm"
                                    style={{
                                        height: `${Math.random() * 100}%`,
                                        marginTop: 'auto',
                                        backgroundColor: color
                                    }}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
