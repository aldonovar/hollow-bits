
import { Track, TrackType, Device } from './types';

// --- TRACK COLOR SYSTEM (RUBY -> LILAC, SOFT GRADIENT) ---
const TRACK_RUBY_HUE = 352;
const TRACK_LILAC_HUE = 272;
const TRACK_HUE_MIN = 268;
const TRACK_HUE_MAX = 354;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const toHex = (value: number): string => {
  const bounded = Math.min(255, Math.max(0, Math.round(value)));
  return bounded.toString(16).padStart(2, '0');
};

const hslToHex = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const light = Math.min(100, Math.max(0, l)) / 100;

  const chroma = (1 - Math.abs((2 * light) - 1)) * sat;
  const hueSection = hue / 60;
  const x = chroma * (1 - Math.abs((hueSection % 2) - 1));

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (hueSection >= 0 && hueSection < 1) {
    rPrime = chroma;
    gPrime = x;
  } else if (hueSection < 2) {
    rPrime = x;
    gPrime = chroma;
  } else if (hueSection < 3) {
    gPrime = chroma;
    bPrime = x;
  } else if (hueSection < 4) {
    gPrime = x;
    bPrime = chroma;
  } else if (hueSection < 5) {
    rPrime = x;
    bPrime = chroma;
  } else {
    rPrime = chroma;
    bPrime = x;
  }

  const match = light - (chroma / 2);
  const r = (rPrime + match) * 255;
  const g = (gPrime + match) * 255;
  const b = (bPrime + match) * 255;

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
};

const easeInOutSine = (t: number): number => {
  return 0.5 - (Math.cos(Math.PI * t) / 2);
};

const getGradientT = (index: number, total: number): number => {
  if (total <= 1) return 0;
  const clampedIndex = Math.min(Math.max(index, 0), total - 1);
  return clampedIndex / (total - 1);
};

export const getTrackColorByPosition = (index: number, total: number, offset = 0): string => {
  const t = getGradientT(index, Math.max(1, total));
  const eased = easeInOutSine(t);

  // Ordered progressive gradient (no jumps) in the ruby-lilac corridor.
  const baseHue = TRACK_RUBY_HUE + ((TRACK_LILAC_HUE - TRACK_RUBY_HUE) * t);
  const offsetHue = offset === 0 ? 0 : (((offset % 7) - 3) * 0.35);
  const hue = clamp(baseHue + offsetHue, TRACK_HUE_MIN, TRACK_HUE_MAX);

  const saturationBase = 88 - (16 * eased);
  const saturationOffset = offset === 0 ? 0 : (((offset % 5) - 2) * 0.4);
  const saturation = clamp(saturationBase + saturationOffset, 64, 92);

  const lightnessBase = 43 + (17 * eased);
  const lightnessOffset = offset === 0 ? 0 : (((offset % 3) - 1) * 0.6);
  const lightness = clamp(lightnessBase + lightnessOffset, 36, 72);

  return hslToHex(hue, saturation, lightness);
};

export const getTrackColor = (index: number, total = Math.max(2, index + 2)): string => {
  return getTrackColorByPosition(index, total);
};

export const getNextTrackColor = (
  existingTracks: Array<Pick<Track, 'color'>>,
  preferredIndex: number = existingTracks.length
): string => {
  const used = new Set(existingTracks.map((track) => track.color.trim().toLowerCase()));
  const total = Math.max(existingTracks.length + 1, preferredIndex + 1, 2);

  for (let offset = 0; offset < 48; offset++) {
    const candidate = getTrackColorByPosition(preferredIndex, total, offset);
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return getTrackColorByPosition(preferredIndex, total, 49);
};

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
};

export const INITIAL_DEVICES: Device[] = [
  {
    id: 'dev-1',
    name: 'Sintetizador Nebula',
    type: 'instrument',
    params: [
      { name: 'Onda Osc 1', value: 0, min: 0, max: 3, unit: '' },
      { name: 'Corte (Cutoff)', value: 2000, min: 20, max: 20000, unit: 'Hz' },
      { name: 'Resonancia', value: 0.5, min: 0, max: 1, unit: '' },
      { name: 'Decaimiento Env', value: 300, min: 10, max: 5000, unit: 'ms' },
    ]
  },
  {
    id: 'dev-eq-1',
    name: 'Ecualizador Prisma',
    type: 'eq', // Special type for visual rendering
    params: [
      { name: 'Ganancia Baja', value: 0, min: -12, max: 12, unit: 'dB' },
      { name: 'Frec Media', value: 1000, min: 200, max: 5000, unit: 'Hz' },
      { name: 'Ganancia Media', value: 0, min: -12, max: 12, unit: 'dB' },
      { name: 'Ganancia Alta', value: 0, min: -12, max: 12, unit: 'dB' },
    ]
  },
  {
    id: 'dev-2',
    name: 'Reverberación Sala',
    type: 'effect',
    params: [
      { name: 'Seco/Húmedo', value: 30, min: 0, max: 100, unit: '%' },
      { name: 'Tiempo Dec', value: 1.5, min: 0.1, max: 10, unit: 's' },
      { name: 'Tamaño', value: 50, min: 0, max: 100, unit: '' },
    ]
  }
];

export const INITIAL_TRACKS: Track[] = [
  {
    id: 't-1',
    name: 'BOMBO 909',
    type: TrackType.AUDIO,
    color: getTrackColorByPosition(0, 4),
    volume: -2,
    pan: 0,
    reverb: 10,
    transpose: 0,
    monitor: 'auto',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips: [],
    sessionClips: [],
    sends: {},
    sendModes: {},
    soloSafe: false,
    automationMode: 'read',
    devices: [INITIAL_DEVICES[1]]
  },
  {
    id: 't-2',
    name: 'SUB BAJO',
    type: TrackType.MIDI,
    color: getTrackColorByPosition(1, 4),
    volume: -6,
    pan: 0,
    reverb: 0,
    transpose: 0,
    monitor: 'auto',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips: [],
    sessionClips: [],
    sends: {},
    sendModes: {},
    soloSafe: false,
    automationMode: 'read',
    devices: [INITIAL_DEVICES[0]]
  },
  {
    id: 't-3',
    name: 'ATMÓSFERA',
    type: TrackType.AUDIO,
    color: getTrackColorByPosition(2, 4),
    volume: -12,
    pan: 15,
    reverb: 45,
    transpose: 0,
    monitor: 'auto',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips: [],
    sessionClips: [],
    sends: {},
    sendModes: {},
    soloSafe: false,
    automationMode: 'read',
    devices: [INITIAL_DEVICES[2]]
  },
  {
    id: 't-4',
    name: 'LÍDER HIPER',
    type: TrackType.MIDI,
    color: getTrackColorByPosition(3, 4),
    volume: -8,
    pan: -15,
    reverb: 25,
    transpose: 12,
    monitor: 'auto',
    isMuted: false,
    isSoloed: false,
    isArmed: false,
    clips: [],
    sessionClips: [],
    sends: {},
    sendModes: {},
    soloSafe: false,
    automationMode: 'read',
    devices: []
  }
];
