
import React from 'react';
import { Minus, Square, X } from 'lucide-react';
import { platformService } from '../services/platformService';
import AppLogo from './AppLogo';

type AppRegionStyle = React.CSSProperties & {
  WebkitAppRegion: 'drag' | 'no-drag';
};

const TitleBar: React.FC = () => {
  // If we are on the web, we don't need a custom title bar
  if (!platformService.isDesktop) return null;

  return (
    <div className="h-8 bg-[#0a0a0a] flex items-center justify-between select-none border-b border-daw-border w-full z-[100]">
      {/* Draggable Region */}
      <div
        className="flex-1 h-full flex items-center px-4 gap-2"
        style={{ WebkitAppRegion: 'drag' } as AppRegionStyle}
      >
        <AppLogo size={16} />
        <span className="text-[10px] font-bold tracking-[0.2em] text-gray-400 uppercase flex items-center gap-1">
          <span>HOLLOW</span>
          <span
            className="normal-case text-[12px] tracking-[0.01em] text-daw-violet"
            style={{
              fontFamily: "'Brittany', 'Brittany Signature', 'Great Vibes', 'Segoe Script', cursive",
              transform: 'scaleX(1.15)',
              transformOrigin: 'center center'
            }}
          >
            bits
          </span>
          <span className="text-gray-600">| Desktop</span>
        </span>
      </div>

      {/* Window Controls (No Drag) */}
      <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as AppRegionStyle}>
        <button
          onClick={() => platformService.minimize()}
          className="w-10 h-full flex items-center justify-center hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => platformService.maximize()}
          className="w-10 h-full flex items-center justify-center hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
          <Square size={12} />
        </button>
        <button
          onClick={() => platformService.close()}
          className="w-10 h-full flex items-center justify-center hover:bg-red-600 text-gray-400 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
