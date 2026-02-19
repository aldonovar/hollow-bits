import { AudioSettings } from '../types';

const SUPPORTED_SAMPLE_RATES: ReadonlyArray<AudioSettings['sampleRate']> = [44100, 48000, 88200, 96000, 192000];
const SUPPORTED_BUFFER_SIZES: ReadonlyArray<AudioSettings['bufferSize']> = ['auto', 128, 256, 512, 1024, 2048];
const SUPPORTED_LATENCY_HINTS = new Set(['interactive', 'balanced', 'playback']);

const SAMPLE_RATE_ALIAS_MAP: Record<number, AudioSettings['sampleRate']> = {
    44: 44100,
    48: 48000,
    88: 88200,
    92: 96000,
    96: 96000,
    192: 192000,
    196: 192000,
    44000: 44100,
    44100: 44100,
    48000: 48000,
    88000: 88200,
    88200: 88200,
    92000: 96000,
    96000: 96000,
    192000: 192000,
    196000: 192000
};

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

export const normalizeSampleRate = (
    value: unknown,
    fallback: AudioSettings['sampleRate'] = 48000
): AudioSettings['sampleRate'] => {
    const numeric = toFiniteNumber(value);
    if (numeric === null) return fallback;

    const rounded = Math.round(numeric);
    const alias = SAMPLE_RATE_ALIAS_MAP[rounded];
    if (alias) return alias;

    if (SUPPORTED_SAMPLE_RATES.includes(rounded as AudioSettings['sampleRate'])) {
        return rounded as AudioSettings['sampleRate'];
    }

    return fallback;
};

export const normalizeBufferSize = (
    value: unknown,
    fallback: AudioSettings['bufferSize'] = 'auto'
): AudioSettings['bufferSize'] => {
    if (value === 'auto') return 'auto';

    const numeric = toFiniteNumber(value);
    if (numeric === null) return fallback;

    const rounded = Math.round(numeric);
    if (SUPPORTED_BUFFER_SIZES.includes(rounded as AudioSettings['bufferSize'])) {
        return rounded as AudioSettings['bufferSize'];
    }

    return fallback;
};

export const normalizeLatencyHint = (
    value: unknown,
    fallback: AudioSettings['latencyHint'] = 'interactive'
): AudioSettings['latencyHint'] => {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (SUPPORTED_LATENCY_HINTS.has(normalized)) {
        return normalized as AudioSettings['latencyHint'];
    }
    return fallback;
};

export const sanitizeAudioSettingsCandidate = (
    candidate: Partial<AudioSettings> | null | undefined,
    defaults: AudioSettings
): AudioSettings => {
    if (!candidate) return { ...defaults };

    return {
        sampleRate: normalizeSampleRate(candidate.sampleRate, defaults.sampleRate),
        bufferSize: normalizeBufferSize(candidate.bufferSize, defaults.bufferSize),
        latencyHint: normalizeLatencyHint(candidate.latencyHint, defaults.latencyHint),
        inputDeviceId: typeof candidate.inputDeviceId === 'string' ? candidate.inputDeviceId : undefined,
        outputDeviceId: typeof candidate.outputDeviceId === 'string' ? candidate.outputDeviceId : undefined,
        lastFailedOutputDeviceId: typeof candidate.lastFailedOutputDeviceId === 'string' ? candidate.lastFailedOutputDeviceId : undefined
    };
};
