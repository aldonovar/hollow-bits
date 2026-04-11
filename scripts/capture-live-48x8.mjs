#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;
const STATUS_PREFIX = 'BENCHMARK_STATUS:';

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = (argv) => {
  const options = {
    timeoutMs: parseNumber(process.env.HOLLOW_BENCHMARK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    tracks: parseNumber(process.env.HOLLOW_BENCHMARK_TRACKS, 48),
    scenes: parseNumber(process.env.HOLLOW_BENCHMARK_SCENES, 8),
    quantizeBars: parseNumber(process.env.HOLLOW_BENCHMARK_QUANTIZE_BARS, 1),
    durationMinutes: parseNumber(process.env.HOLLOW_BENCHMARK_DURATION_MINUTES, 90),
    recordingCycles: parseNumber(process.env.HOLLOW_BENCHMARK_RECORDING_CYCLES, 1000),
    seed: parseNumber(process.env.HOLLOW_BENCHMARK_SEED, 4242)
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '--timeout-ms' && typeof next === 'string') {
      options.timeoutMs = parseNumber(next, options.timeoutMs);
      index += 1;
      continue;
    }
    if (token === '--tracks' && typeof next === 'string') {
      options.tracks = parseNumber(next, options.tracks);
      index += 1;
      continue;
    }
    if (token === '--scenes' && typeof next === 'string') {
      options.scenes = parseNumber(next, options.scenes);
      index += 1;
      continue;
    }
    if (token === '--quantize-bars' && typeof next === 'string') {
      options.quantizeBars = parseNumber(next, options.quantizeBars);
      index += 1;
      continue;
    }
    if (token === '--duration-minutes' && typeof next === 'string') {
      options.durationMinutes = parseNumber(next, options.durationMinutes);
      index += 1;
      continue;
    }
    if (token === '--recording-cycles' && typeof next === 'string') {
      options.recordingCycles = parseNumber(next, options.recordingCycles);
      index += 1;
      continue;
    }
    if (token === '--seed' && typeof next === 'string') {
      options.seed = parseNumber(next, options.seed);
      index += 1;
    }
  }

  return options;
};

const assertLiveCaptureArtifacts = () => {
  const transportPath = path.resolve('benchmarks/transport/latest-runtime.json');
  const launchPath = path.resolve('benchmarks/session-launch/latest-report.json');
  const stressPath = path.resolve('benchmarks/stress-48x8/latest-report.json');
  const transitionsPath = path.resolve('benchmarks/audio-priority/latest-transitions.json');
  const recordingPath = path.resolve('benchmarks/recording-reliability/latest-report.json');

  const requiredFiles = [transportPath, launchPath, stressPath, transitionsPath, recordingPath];
  requiredFiles.forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing live-capture artifact: ${filePath}`);
    }
  });

  const transport = JSON.parse(fs.readFileSync(transportPath, 'utf8'));
  const launch = JSON.parse(fs.readFileSync(launchPath, 'utf8'));
  const stress = JSON.parse(fs.readFileSync(stressPath, 'utf8'));
  const recording = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
  const transportSource = transport?.scenario?.source;
  const launchSource = launch?.scenario?.source;
  const stressSource = stress?.scenario?.source;
  if (transportSource !== 'live-capture') {
    throw new Error(`Transport runtime report source must be live-capture, got '${transportSource || 'unknown'}'.`);
  }
  if (launchSource !== 'live-capture') {
    throw new Error(`Session launch report source must be live-capture, got '${launchSource || 'unknown'}'.`);
  }
  if (stressSource !== 'live-capture') {
    throw new Error(`Stress report source must be live-capture, got '${stressSource || 'unknown'}'.`);
  }
  if (recording?.summary?.gatePass !== true) {
    throw new Error('Recording reliability report must stay in PASS during live capture validation.');
  }
};

const resolveElectronBin = () => {
  const winPath = path.resolve('node_modules/.bin/electron.cmd');
  const posixPath = path.resolve('node_modules/.bin/electron');
  if (process.platform === 'win32' && fs.existsSync(winPath)) return winPath;
  if (fs.existsSync(posixPath)) return posixPath;
  throw new Error('Electron binary not found in node_modules/.bin');
};

const run = async () => {
  const options = parseArgs(process.argv.slice(2));
  const electronBin = resolveElectronBin();

  const args = [
    'electron/main.cjs',
    '--benchmark-live-48x8',
    '--benchmark-timeout-ms', String(Math.max(60_000, Math.floor(options.timeoutMs))),
    '--benchmark-tracks', String(Math.max(1, Math.floor(options.tracks))),
    '--benchmark-scenes', String(Math.max(1, Math.floor(options.scenes))),
    '--benchmark-quantize-bars', String(Math.max(0.25, options.quantizeBars)),
    '--benchmark-duration-minutes', String(Math.max(1, options.durationMinutes)),
    '--benchmark-recording-cycles', String(Math.max(1, Math.floor(options.recordingCycles))),
    '--benchmark-seed', String(Math.max(1, Math.floor(options.seed)))
  ];

  console.log('Live capture runner');
  console.log(`- electron: ${electronBin}`);
  console.log(`- timeout: ${Math.max(60_000, Math.floor(options.timeoutMs))} ms`);
  console.log(`- scenario: ${Math.max(1, Math.floor(options.tracks))}x${Math.max(1, Math.floor(options.scenes))}`);

  let finished = false;
  let benchmarkResult = null;

  const child = spawn(electronBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOLLOW_BENCHMARK_MODE: 'live-48x8'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const timeout = setTimeout(() => {
    if (finished) return;
    finished = true;
    child.kill('SIGTERM');
    console.error(`Live capture timeout after ${options.timeoutMs} ms`);
  }, Math.max(60_000, Math.floor(options.timeoutMs)));

  const consume = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    const lines = text.split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith(STATUS_PREFIX)) return;
      const payloadRaw = trimmed.slice(STATUS_PREFIX.length);
      try {
        benchmarkResult = JSON.parse(payloadRaw);
      } catch {
        benchmarkResult = {
          status: 'fail',
          details: { error: 'Invalid BENCHMARK_STATUS payload' }
        };
      }
    });
  };

  if (child.stdout) child.stdout.on('data', consume);
  if (child.stderr) child.stderr.on('data', consume);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => {
      resolve(typeof code === 'number' ? code : 1);
    });
  });

  clearTimeout(timeout);
  finished = true;

  if (!benchmarkResult) {
    throw new Error(`Live capture exited without BENCHMARK_STATUS payload (exit=${exitCode}).`);
  }
  if (benchmarkResult.status !== 'success') {
    throw new Error(`Live capture failed: ${JSON.stringify(benchmarkResult.details || {})}`);
  }
  if (exitCode !== 0) {
    throw new Error(`Electron exited with code ${exitCode} after success status.`);
  }

  assertLiveCaptureArtifacts();
  console.log('Live capture completed successfully.');
};

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
