#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUT = 'benchmarks/block5-editing/latest-gate.json';
const DEFAULT_RECORDING_GATE = 'benchmarks/recording-reliability/latest-gate.json';
const TEST_FILES = [
  'tests/unit/block5EditingRegression.test.ts',
  'tests/unit/takeCompingService.test.ts',
  'tests/unit/recordingTakeService.test.ts',
  'tests/unit/projectIntegrityService.test.ts',
  'tests/unit/projectRecoveryService.test.ts',
];

const parseArgs = (argv) => {
  const args = { out: DEFAULT_OUT, recordingGate: DEFAULT_RECORDING_GATE };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--out' && typeof next === 'string') {
      args.out = next;
      index += 1;
      continue;
    }

    if (token === '--recording-gate' && typeof next === 'string') {
      args.recordingGate = next;
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
  const recordingGatePath = path.resolve(process.cwd(), args.recordingGate);
  const vitestEntry = path.resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  const commandArgs = [vitestEntry, 'run', ...TEST_FILES];

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const endedAt = Date.now();

  const recordingGate = readJsonOrNull(recordingGatePath);
  const recordingPass = recordingGate?.status === 'pass';
  const unitPass = result.status === 0;

  const gate = {
    generatedAt: endedAt,
    durationMs: endedAt - startedAt,
    testedFiles: TEST_FILES,
    command: [process.execPath, ...commandArgs].join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    pass: unitPass && recordingPass,
    recordingGatePath,
    summary: {
      unitPass,
      recordingGatePass: recordingPass,
      attemptedCycles: Number(recordingGate?.summary?.attemptedCycles ?? 0),
      takeLossCount: Number(recordingGate?.summary?.takeLossCount ?? Number.POSITIVE_INFINITY),
    },
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2), 'utf8');

  console.log('Block 5 Editing Regression Gate');
  console.log(`- tested files: ${TEST_FILES.length}`);
  console.log(`- recording cycles: ${gate.summary.attemptedCycles}`);
  console.log(`- take loss count: ${gate.summary.takeLossCount}`);
  console.log(`- duration: ${gate.durationMs} ms`);
  console.log(`- status: ${gate.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- output: ${outPath}`);

  if (!gate.pass) {
    if (!recordingPass) {
      console.error(`Recording gate missing or failing: ${recordingGatePath}`);
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
