import { describe, expect, it } from 'vitest';
import { audioEngine } from '../../services/audioEngine';

const createMonoBuffer = (samples: number[], sampleRate = 48000): AudioBuffer => {
    const data = Float32Array.from(samples);
    return {
        numberOfChannels: 1,
        length: data.length,
        sampleRate,
        getChannelData: () => data
    } as unknown as AudioBuffer;
};

const blobToArrayBuffer = async (blob: Blob): Promise<ArrayBuffer> => {
    if (typeof blob.arrayBuffer === 'function') {
        return blob.arrayBuffer();
    }

    return await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(blob);
    });
};

describe('audioEngine export encoding', () => {
    it('preserves >0 dBFS values in 32-bit float wav exports', async () => {
        const buffer = createMonoBuffer([1.25, -1.1, 0.5]);

        const wavBlob = await audioEngine.encodeAudio(buffer, {
            format: 'wav',
            bitDepth: 32,
            float: true,
            normalize: false,
            dither: 'none'
        });

        const view = new DataView(await blobToArrayBuffer(wavBlob));
        expect(view.getUint16(20, true)).toBe(3);
        expect(view.getFloat32(44, true)).toBeCloseTo(1.25, 5);
        expect(view.getFloat32(48, true)).toBeCloseTo(-1.1, 5);
    });

    it('clamps samples for integer PCM exports', async () => {
        const buffer = createMonoBuffer([1.5, -1.5]);

        const wavBlob = await audioEngine.encodeAudio(buffer, {
            format: 'wav',
            bitDepth: 16,
            float: false,
            normalize: false,
            dither: 'none'
        });

        const view = new DataView(await blobToArrayBuffer(wavBlob));
        expect(view.getInt16(44, true)).toBe(0x7FFF);
        expect(view.getInt16(46, true)).toBe(-0x8000);
    });
});
