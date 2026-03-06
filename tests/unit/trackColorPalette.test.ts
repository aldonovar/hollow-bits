import { describe, expect, it } from 'vitest';
import { getTrackColorByPosition } from '../../constants';

interface RGB {
    r: number;
    g: number;
    b: number;
}

const hexToRgb = (hex: string): RGB => {
    const clean = hex.replace('#', '');
    return {
        r: Number.parseInt(clean.slice(0, 2), 16),
        g: Number.parseInt(clean.slice(2, 4), 16),
        b: Number.parseInt(clean.slice(4, 6), 16)
    };
};

const rgbDistance = (a: RGB, b: RGB): number => {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
};

const rgbToHue = ({ r, g, b }: RGB): number => {
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const delta = max - min;

    if (delta === 0) return 0;

    let hue = 0;
    if (max === rNorm) {
        hue = ((gNorm - bNorm) / delta) % 6;
    } else if (max === gNorm) {
        hue = ((bNorm - rNorm) / delta) + 2;
    } else {
        hue = ((rNorm - gNorm) / delta) + 4;
    }

    const degrees = hue * 60;
    return degrees < 0 ? degrees + 360 : degrees;
};

describe('track color palette', () => {
    it('stays in ruby-lilac hue corridor and avoids yellow/green zones', () => {
        const sampleCount = 96;
        const total = 96;

        for (let index = 0; index < sampleCount; index += 1) {
            const color = getTrackColorByPosition(index, total);
            const hue = rgbToHue(hexToRgb(color));

            const isRubyLilac = hue >= 260 || hue <= 12;
            const isYellowGreenBand = hue > 70 && hue < 200;

            expect(isRubyLilac).toBe(true);
            expect(isYellowGreenBand).toBe(false);
        }
    });

    it('provides visible differentiation between adjacent tracks at 48 tracks', () => {
        const total = 48;
        const colors = Array.from({ length: total }, (_, index) => getTrackColorByPosition(index, total));
        const uniqueCount = new Set(colors).size;

        const distances = colors.slice(0, -1).map((color, index) => {
            return rgbDistance(hexToRgb(color), hexToRgb(colors[index + 1]));
        });

        const averageDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
        const minDistance = Math.min(...distances);

        expect(uniqueCount).toBeGreaterThanOrEqual(44);
        expect(averageDistance).toBeGreaterThan(14);
        expect(minDistance).toBeGreaterThan(5);
    });
});

