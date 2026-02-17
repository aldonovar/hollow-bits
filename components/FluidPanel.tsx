import React, { useState, useEffect } from 'react';

interface FluidPanelProps {
    isOpen: boolean;
    onClose?: () => void;
    children: React.ReactNode;
    className?: string; // For positioning and dimensions
    direction?: 'left' | 'right' | 'up' | 'fade'; // Animation direction
    delayUnmount?: number; // Time to wait before unmounting (should match duration)
    keepMounted?: boolean;
}

export const FluidPanel: React.FC<FluidPanelProps> = ({
    isOpen,
    children,
    className = "",
    direction = 'left',
    delayUnmount = 360,
    keepMounted = false
}) => {
    const [isRendered, setIsRendered] = useState(isOpen || keepMounted);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsRendered(true);
            const timer = setTimeout(() => setIsVisible(true), 16);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
            if (keepMounted) {
                setIsRendered(true);
                return;
            }

            const timer = setTimeout(() => setIsRendered(false), delayUnmount);
            return () => clearTimeout(timer);
        }
    }, [delayUnmount, isOpen, keepMounted]);

    if (!isRendered) return null;

    // Base Transition Classes
    const baseTransition = "transition-[transform,opacity,filter] duration-[420ms] ease-[cubic-bezier(0.22,0.84,0.26,1)] will-change-transform";

    // Transform Logic based on Direction
    const getTransformClass = () => {
        if (!isVisible) {
            switch (direction) {
                case 'left': return '-translate-x-6 opacity-0 blur-[1px] scale-[0.985]';
                case 'right': return 'translate-x-6 opacity-0 blur-[1px] scale-[0.985]';
                case 'up': return 'translate-y-5 opacity-0 blur-[1px] scale-[0.985]';
                case 'fade': return 'opacity-0 scale-[0.985] blur-[1px]';
            }
        }
        return 'translate-x-0 translate-y-0 opacity-100 blur-none scale-100';
    };

    return (
        <div
            className={`
                ${className} 
                ${baseTransition} 
                ${getTransformClass()}
                ${isVisible ? 'pointer-events-auto' : 'pointer-events-none'}
            `}
            // Prevent clicks from passing through if it's an overlay
            onClick={(e) => e.stopPropagation()}
        >
            {children}
        </div>
    );
};
