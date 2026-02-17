import React, { useId } from 'react';

interface AppLogoProps {
    size?: number;
    className?: string;
    withGlow?: boolean;
}

const AppLogo: React.FC<AppLogoProps> = ({ size = 24, className = "", withGlow = false }) => {
    const uid = useId().replace(/:/g, '');
    const gradientId = `logoGradient-${uid}`;
    const glowId = `logoGlow-${uid}`;

    return (
        <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
            <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full"
            >
                <defs>
                    <linearGradient id={gradientId} x1="50" y1="0" x2="50" y2="100" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#9333ea" />
                        <stop offset="100%" stopColor="#e11d48" />
                    </linearGradient>
                    <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="4" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>

                <g filter={withGlow ? `url(#${glowId})` : undefined}>
                    <circle cx="50" cy="50" r="45" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" opacity="0.9" />

                    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" transform="rotate(0 50 50)" opacity="0.8" />
                    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" transform="rotate(60 50 50)" opacity="0.8" />
                    <ellipse cx="50" cy="50" rx="40" ry="14" stroke={`url(#${gradientId})`} strokeWidth="3" strokeLinecap="round" transform="rotate(120 50 50)" opacity="0.8" />
                </g>
            </svg>
        </div>
    );
};

export default AppLogo;
