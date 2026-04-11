#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUT = 'benchmarks/block6-session/latest-gate.json';
const DEFAULT_LAUNCH_GATE = 'benchmarks/session-launch/latest-gate.json';
const DEFAULT_STRESS_REPORT = 'benchmarks/stress-48x8/latest-report.json';
const TEST_FILES = [
  'tests/unit/block6SessionRegression.test.ts',
  'tests/unit/sessionSceneRecordingService.test.ts',
  'tests/unit/sessionPerformanceService.test.ts',
  'tests/unit/liveCaptureHarnessService.test.ts',
];

const parseArgs = (argv) => {
  const args = {
    out: DEFAULT_OUT,
    launchGate: DEFAULT_LAUNCH_GATE,
    stressReport: DEFAULT_STRESS_REPORT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--out' && typeof next === 'string') {
      args.out = next;
      index += 1;
      continue;
    }

    if (token === '--launch-gate' && typeof next === 'string') {
      args.launchGate = next;
      index += 1;
      continue;
    }

    if (token === '--stress-report' && typeof next === 'string') {
      args.stressReport = next;
      index += 1;
    }
  }

  return args;
};

const ensureParentDir = (targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

const readJsonOrNull = (targetPath) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
};

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(process.cwd(), args.out);
  const launchGatePath = path.resolve(process.cwd(), args.launchGate);
  const stressReportPath = path.resolve(process.cwd(), args.stressReport);
  const vitestEntry = path.resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  const commandArgs = [vitestEntry, 'run', ...TEST_FILES];

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const endedAt = Date.now();

  const launchGate = readJsonOrNull(launchGatePath);
  const stressReport = readJsonOrNull(stressReportPath);

  const unitPass = result.status === 0;
  const launchPass = launchGate?.status === 'pass'
    && Number(launchGate?.summary?.p95LaunchErrorMs ?? Number.POSITIVE_INFINITY) <= 2
    && Number(launchGate?.summary?.scenarioTracks ?? 0) >= 48
    && Number(launchGate?.summary?.scenarioScenes ?? 0) >= 8;
  const stressPass = Boolean(stressReport?.gates?.pass)
    && Number(stressReport?.scenario?.tracks ?? 0) >= 48
    && Number(stressReport?.scenario?.scenes ?? 0) >= 8
    && Number(stressReport?.scenario?.durationMinutes ?? 0) >= 90
    && Number(stressReport?.telemetry?.ui?.fpsP95 ?? Number.NEGATIVE_INFINITY) >= 58;

  const gate = {
    generatedAt: endedAt,
    durationMs: endedAt - startedAt,
    testedFiles: TEST_FILES,
    command: [process.execPath, ...commandArgs].join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    pass: unitPass && launchPass && stressPass,
    launchGatePath,
    stressReportPath,
    summary: {
      unitPass,
      launchGatePass: launchPass,
      stressGatePass: stressPass,
      scenarioTracks: Number(stressReport?.scenario?.tracks ?? 0),
      scenarioScenes: Number(stressReport?.scenario?.scenes ?? 0),
      durationMinutes: Number(stressReport?.scenario?.durationMinutes ?? 0),
      launchP95Ms: Number(launchGate?.summary?.p95LaunchErrorMs ?? Number.POSITIVE_INFINITY),
      visualFpsP95: Number(stressReport?.telemetry?.ui?.fpsP95 ?? Number.NEGATIVE_INFINITY),
    },
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2), 'utf8');

  console.log('Block 6 Session Flagship Gate');
  console.log(`- tested files: ${TEST_FILES.length}`);
  console.log(`- scenario: ${gate.summary.scenarioTracks}x${gate.summary.scenarioScenes}`);
  console.log(`- launch p95: ${gate.summary.launchP95Ms} ms`);
  console.log(`- visual fps p95: ${gate.summary.visualFpsP95}`);
  console.log(`- duration: ${gate.durationMs} ms`);
  console.log(`- status: ${gate.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- output: ${outPath}`);

  if (!gate.pass) {
    if (!launchPass) {
      console.error(`Launch gate missing or failing: ${launchGatePath}`);
    }
    if (!stressPass) {
      console.error(`Stress report missing or failing: ${stressReportPath}`);
    }
    if (gate.stdout.trim()) {
      console.log(gate.stdout.trim());
    }
    if (gate.stderr.trim()) {
      console.error(gate.stderr.trim());
    }
    process.exitCode = gate.exitCode || 1;
  }
};

main();
