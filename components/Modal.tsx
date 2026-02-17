import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  const [isRendered, setIsRendered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      // Small delay to ensure initial "hidden" state is painted
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setIsRendered(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isRendered) return null;

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isVisible ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/0 backdrop-blur-none'
        }`}
      onClick={onClose}
    >
      <div
        className={`w-[500px] max-h-[80vh] relative bg-[#0a0a0c] border border-white/5 rounded-sm shadow-2xl flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${isVisible ? 'opacity-100 translate-y-0 scale-100 blur-none' : 'opacity-0 translate-y-8 scale-95 blur-sm'
          }`}
        style={{
          boxShadow: '0 50px 100px -20px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255,255,255,0.08)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Glass Background */}
        <div className="absolute inset-0 bg-[#0f0e13]/90 backdrop-blur-xl z-0"></div>

        {/* Header */}
        <div className="h-12 border-b border-white/5 bg-white/[0.02] flex items-center justify-between px-6 shrink-0 relative z-10 transition-colors">
          <h2 className="text-[10px] font-black tracking-[0.2em] text-white/50 uppercase">{title}</h2>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-sm bg-white/5 hover:bg-white/10 flex items-center justify-center transition-all duration-200 text-white/40 hover:text-white group"
          >
            <X size={14} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 text-sm text-gray-300 relative z-10 custom-scrollbar">
          {children}
        </div>

        {/* Footer Glow */}
        <div className="h-[1px] w-full bg-gradient-to-r from-transparent via-daw-violet/20 to-transparent relative z-10"></div>
      </div>
    </div>
  );
};

export default Modal;