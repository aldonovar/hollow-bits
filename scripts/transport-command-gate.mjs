#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUT = 'benchmarks/transport/latest-gate.json';
const DEFAULT_RUNTIME_REPORT = 'benchmarks/transport/latest-runtime.json';
const TEST_FILES = [
  'tests/unit/audioEngineTransportAuthority.test.ts',
  'tests/unit/transportStateService.test.ts',
  'tests/unit/transportClockStore.test.ts',
];

const parseArgs = (argv) => {
  const args = { out: DEFAULT_OUT, report: DEFAULT_RUNTIME_REPORT };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--out' && typeof next === 'string') {
      args.out = next;
      index += 1;
      continue;
    }

    if (token === '--report' && typeof next === 'string') {
      args.report = next;
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
  const runtimeReportPath = path.resolve(process.cwd(), args.report);
  const vitestEntry = path.resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  const commandArgs = [vitestEntry, 'run', ...TEST_FILES];

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const endedAt = Date.now();
  const runtimeReport = readJsonOrNull(runtimeReportPath);
  const runtimeSummary = runtimeReport?.summary || {};
  const runtimePass = Boolean(runtimeSummary.pass);
  const runtimeCheckpointCount = Number(runtimeSummary.checkpointCount || 0);
  const runtimeFailedCheckpointCount = Number(runtimeSummary.failedCheckpointCount || 0);
  const runtimePresent = Boolean(runtimeReport);
  const unitPass = result.status === 0;

  const gate = {
    generatedAt: endedAt,
    durationMs: endedAt - startedAt,
    testedFiles: TEST_FILES,
    command: [process.execPath, ...commandArgs].join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    pass: unitPass && runtimePresent && runtimePass,
    runtimeReportPath,
    unitPass,
    runtime: {
      present: runtimePresent,
      pass: runtimePass,
      checkpointCount: runtimeCheckpointCount,
      failedCheckpointCount: runtimeFailedCheckpointCount,
    },
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2), 'utf8');

  console.log('Transport Command Gate');
  console.log(`- tested files: ${TEST_FILES.length}`);
  console.log(`- runtime checkpoints: ${runtimeCheckpointCount}`);
  console.log(`- duration: ${gate.durationMs} ms`);
  console.log(`- status: ${gate.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- output: ${outPath}`);

  if (!gate.pass) {
    if (!runtimePresent) {
      console.error(`Missing transport runtime report: ${runtimeReportPath}`);
    } else if (!runtimePass) {
      console.error(`Transport runtime smoke failed: ${runtimeFailedCheckpointCount}/${runtimeCheckpointCount} checkpoints failing.`);
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
