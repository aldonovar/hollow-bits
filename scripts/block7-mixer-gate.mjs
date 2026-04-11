#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OUT = 'benchmarks/block7-mixer/latest-gate.json';
const DEFAULT_MONITORING_GATE = 'benchmarks/monitoring-runtime/latest-gate.json';
const TEST_FILES = [
  'tests/unit/block7MixerRoutingRegression.test.ts',
  'tests/unit/mixerAuditService.test.ts',
  'tests/unit/automationService.test.ts',
  'tests/unit/projectIntegrityService.test.ts',
];

const parseArgs = (argv) => {
  const args = { out: DEFAULT_OUT, monitoringGate: DEFAULT_MONITORING_GATE };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === '--out' && typeof next === 'string') {
      args.out = next;
      index += 1;
      continue;
    }

    if (token === '--monitoring-gate' && typeof next === 'string') {
      args.monitoringGate = next;
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
  const monitoringGatePath = path.resolve(process.cwd(), args.monitoringGate);
  const vitestEntry = path.resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  const commandArgs = [vitestEntry, 'run', ...TEST_FILES];

  const startedAt = Date.now();
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const endedAt = Date.now();

  const monitoringGate = readJsonOrNull(monitoringGatePath);
  const monitoringPass = monitoringGate?.status === 'pass';
  const unitPass = result.status === 0;

  const gate = {
    generatedAt: endedAt,
    durationMs: endedAt - startedAt,
    testedFiles: TEST_FILES,
    command: [process.execPath, ...commandArgs].join(' '),
    exitCode: typeof result.status === 'number' ? result.status : 1,
    pass: unitPass && monitoringPass,
    monitoringGatePath,
    summary: {
      unitPass,
      monitoringGatePass: monitoringPass,
      testedFiles: TEST_FILES.length,
      activeRouteCount: Number(monitoringGate?.summary?.activeRouteCount ?? 0),
      pendingFinalizeCount: Number(monitoringGate?.summary?.pendingFinalizeCount ?? 0),
      monitorLatencyP95Ms: Number(monitoringGate?.summary?.monitorLatencyP95Ms ?? Number.POSITIVE_INFINITY),
    },
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(gate, null, 2), 'utf8');

  console.log('Block 7 Mixer/Routing/Automation Gate');
  console.log(`- tested files: ${TEST_FILES.length}`);
  console.log(`- monitoring latency p95: ${gate.summary.monitorLatencyP95Ms}`);
  console.log(`- active monitoring routes: ${gate.summary.activeRouteCount}`);
  console.log(`- duration: ${gate.durationMs} ms`);
  console.log(`- status: ${gate.pass ? 'PASS' : 'FAIL'}`);
  console.log(`- output: ${outPath}`);

  if (!gate.pass) {
    if (!monitoringPass) {
      console.error(`Monitoring gate missing or failing: ${monitoringGatePath}`);
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
