const path = require('node:path');

const BENCHMARK_FLAG = '--benchmark-live-48x8';
const BENCHMARK_MODE = 'live-48x8';

const DEFAULT_LIVE_CAPTURE_CONFIG = Object.freeze({
    tracks: 48,
    scenes: 8,
    quantizeBars: 1,
    durationMinutes: 90,
    recordingCycles: 1000,
    timeoutMs: 12 * 60 * 1000,
    seed: 4242
});

const BENCHMARK_ARTIFACT_PATHS = Object.freeze({
    'transport-runtime': path.join('benchmarks', 'transport', 'latest-runtime.json'),
    'session-launch': path.join('benchmarks', 'session-launch', 'latest-report.json'),
    'stress-48x8': path.join('benchmarks', 'stress-48x8', 'latest-report.json'),
    'audio-priority-transitions': path.join('benchmarks', 'audio-priority', 'latest-transitions.json'),
    'recording-reliability': path.join('benchmarks', 'recording-reliability', 'latest-report.json'),
    'monitoring-runtime': path.join('benchmarks', 'monitoring-runtime', 'latest-report.json')
});

const parsePositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
};

const parseFlagValue = (argv, flag) => {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const next = argv[index + 1];
    if (typeof next !== 'string') return null;
    if (next.startsWith('--')) return null;
    return next;
};

const parseLiveCaptureConfig = (argv = process.argv, env = process.env) => {
    const modeFromEnv = String(env.HOLLOW_BENCHMARK_MODE || '').trim();
    const hasFlag = argv.includes(BENCHMARK_FLAG);
    const enabled = hasFlag || modeFromEnv === BENCHMARK_MODE;
    if (!enabled) return null;

    const tracks = Math.max(1, Math.floor(parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-tracks') || env.HOLLOW_BENCHMARK_TRACKS,
        DEFAULT_LIVE_CAPTURE_CONFIG.tracks
    )));
    const scenes = Math.max(1, Math.floor(parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-scenes') || env.HOLLOW_BENCHMARK_SCENES,
        DEFAULT_LIVE_CAPTURE_CONFIG.scenes
    )));
    const quantizeBars = Math.max(0.25, parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-quantize-bars') || env.HOLLOW_BENCHMARK_QUANTIZE_BARS,
        DEFAULT_LIVE_CAPTURE_CONFIG.quantizeBars
    ));
    const durationMinutes = Math.max(1, parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-duration-minutes') || env.HOLLOW_BENCHMARK_DURATION_MINUTES,
        DEFAULT_LIVE_CAPTURE_CONFIG.durationMinutes
    ));
    const recordingCycles = Math.max(1, Math.floor(parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-recording-cycles') || env.HOLLOW_BENCHMARK_RECORDING_CYCLES,
        DEFAULT_LIVE_CAPTURE_CONFIG.recordingCycles
    )));
    const timeoutMs = Math.max(60_000, Math.floor(parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-timeout-ms') || env.HOLLOW_BENCHMARK_TIMEOUT_MS,
        DEFAULT_LIVE_CAPTURE_CONFIG.timeoutMs
    )));
    const seed = Math.max(1, Math.floor(parsePositiveNumber(
        parseFlagValue(argv, '--benchmark-seed') || env.HOLLOW_BENCHMARK_SEED,
        DEFAULT_LIVE_CAPTURE_CONFIG.seed
    )));

    return {
        mode: BENCHMARK_MODE,
        tracks,
        scenes,
        quantizeBars,
        durationMinutes,
        recordingCycles,
        timeoutMs,
        seed
    };
};

const resolveBenchmarkArtifactPath = (name, cwd = process.cwd()) => {
    const relativePath = BENCHMARK_ARTIFACT_PATHS[name];
    if (!relativePath) {
        return null;
    }

    const root = path.resolve(cwd, 'benchmarks');
    const absolutePath = path.resolve(cwd, relativePath);
    const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (absolutePath !== root && !absolutePath.startsWith(normalizedRoot)) {
        return null;
    }

    return {
        root,
        absolutePath,
        relativePath
    };
};

const sanitizeBenchmarkStatus = (input) => {
    const status = typeof input?.status === 'string' ? input.status : '';
    if (status !== 'running' && status !== 'success' && status !== 'fail') {
        return null;
    }

    const details = (
        input
        && typeof input.details === 'object'
        && !Array.isArray(input.details)
        && input.details !== null
    )
        ? input.details
        : {};

    return {
        status,
        details
    };
};

module.exports = {
    BENCHMARK_FLAG,
    BENCHMARK_MODE,
    BENCHMARK_ARTIFACT_PATHS,
    DEFAULT_LIVE_CAPTURE_CONFIG,
    parseLiveCaptureConfig,
    resolveBenchmarkArtifactPath,
    sanitizeBenchmarkStatus
};
