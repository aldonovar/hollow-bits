import { describe, expect, it } from 'vitest';
import { AudioSettings } from '../../types';
import {
    normalizeBufferSize,
    normalizeLatencyHint,
    normalizeSampleRate,
    sanitizeAudioSettingsCandidate
} from '../../services/audioSettingsNormalizer';

describe('audioSettingsNormalizer', () => {
    it('normalizes sample-rate aliases to supported values', () => {
        expect(normalizeSampleRate(44)).toBe(44100);
        expect(normalizeSampleRate('92')).toBe(96000);
        expect(normalizeSampleRate(196000)).toBe(192000);
        expect(normalizeSampleRate(12345, 44100)).toBe(44100);
    });

    it('normalizes buffer sizes and rejects unsupported values', () => {
        expect(normalizeBufferSize('auto')).toBe('auto');
        expect(normalizeBufferSize('512')).toBe(512);
        expect(normalizeBufferSize(96, 256)).toBe(256);
    });

    it('normalizes latency hint case and falls back safely', () => {
        expect(normalizeLatencyHint(' PLAYBACK ')).toBe('playback');
        expect(normalizeLatencyHint('balanced')).toBe('balanced');
        expect(normalizeLatencyHint('ultra-fast', 'interactive')).toBe('interactive');
    });

    it('sanitizes candidate settings into a fully valid payload', () => {
        const defaults: AudioSettings = {
            sampleRate: 48000,
            bufferSize: 'auto',
            latencyHint: 'interactive',
            inputDeviceId: 'in-default',
            outputDeviceId: 'out-default'
        };

        const candidate = {
            sampleRate: '196',
            bufferSize: '1024',
            latencyHint: ' BALANCED ',
            inputDeviceId: 42,
            outputDeviceId: 'usb-out',
            lastFailedOutputDeviceId: null
        } as unknown as Partial<AudioSettings>;

        expect(sanitizeAudioSettingsCandidate(null, defaults)).toEqual(defaults);

        const sanitized = sanitizeAudioSettingsCandidate(candidate, defaults);
        expect(sanitized).toEqual({
            sampleRate: 192000,
            bufferSize: 1024,
            latencyHint: 'balanced',
            inputDeviceId: undefined,
            outputDeviceId: 'usb-out',
            lastFailedOutputDeviceId: undefined
        });
    });
});
