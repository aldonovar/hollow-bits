#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join('benchmarks', 'session-launch', 'latest-report.json');
const DEFAULT_GATE_TARGET_MS = 2;
const DEFAULT_MIN_SAMPLES = 16;

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseArgs = (argv) => {
  const options = {
    reportPath: process.env.SESSION_LAUNCH_REPORT || DEFAULT_REPORT_PATH,
    outPath: '',
    allowMissing: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--report') {
      options.reportPath = argv[index + 1] || options.reportPath;
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.outPath = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (arg === '--allow-missing') {
      options.allowMissing = true;
      continue;
    }
  }

  return options;
};

const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const evaluateGate = (report) => {
  const summary = report?.summary || {};
  const gateTargetMs = safeNumber(summary.gateTargetMs, envNumber('SESSION_LAUNCH_GATE_TARGET_MS', DEFAULT_GATE_TARGET_MS));
  const minSamples = envNumber('SESSION_LAUNCH_MIN_SAMPLES', DEFAULT_MIN_SAMPLES);
  const sampleCount = safeNumber(summary.sampleCount, 0);
  const p95LaunchErrorMs = safeNumber(summary.p95LaunchErrorMs, 0);
  const p99LaunchErrorMs = safeNumber(summary.p99LaunchErrorMs, 0);
  const maxLaunchErrorMs = safeNumber(summary.maxLaunchErrorMs, 0);

  const failures = [];
  const warnings = [];

  if (sampleCount <= 0) {
    failures.push('Reporte sin muestras de launch.');
  }
  if (sampleCount < minSamples) {
    warnings.push(`Muestras insuficientes para confianza alta (${sampleCount}/${minSamples}).`);
  }
  if (p95LaunchErrorMs > gateTargetMs) {
    failures.push(`Launch p95 fuera de gate (${p95LaunchErrorMs.toFixed(3)}ms > ${gateTargetMs.toFixed(3)}ms).`);
  }
  if (p99LaunchErrorMs > (gateTargetMs * 1.8)) {
    warnings.push(`Launch p99 alto (${p99LaunchErrorMs.toFixed(3)}ms).`);
  }
  if (maxLaunchErrorMs > (gateTargetMs * 3.5)) {
    warnings.push(`Launch max alto (${maxLaunchErrorMs.toFixed(3)}ms).`);
  }

  const status = failures.length > 0
    ? 'fail'
    : warnings.length > 0
      ? 'warn'
      : 'pass';

  return {
    status,
    summary: {
      sampleCount,
      gateTargetMs,
      p95LaunchErrorMs,
      p99LaunchErrorMs,
      maxLaunchErrorMs
    },
    failures,
    warnings,
    issues: [...failures, ...warnings]
  };
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const absoluteReportPath = path.resolve(process.cwd(), options.reportPath);

  if (!fs.existsSync(absoluteReportPath)) {
    if (options.allowMissing) {
      console.log(`Session Launch Gate skipped: report not found at ${absoluteReportPath}`);
      process.exit(0);
    }

    console.error(`Session Launch Gate failed: report not found at ${absoluteReportPath}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(absoluteReportPath, 'utf8'));
  } catch (error) {
    console.error(`Session Launch Gate failed: invalid JSON at ${absoluteReportPath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

  const gate = evaluateGate(report);
  console.log('Session Launch Gate');
  console.log(`- report: ${absoluteReportPath}`);
  console.log(`- status: ${gate.status.toUpperCase()}`);
  console.log(`- sampleCount: ${gate.summary.sampleCount}`);
  console.log(`- p95/p99/max: ${gate.summary.p95LaunchErrorMs.toFixed(3)} / ${gate.summary.p99LaunchErrorMs.toFixed(3)} / ${gate.summary.maxLaunchErrorMs.toFixed(3)} ms`);
  console.log(`- target: ${gate.summary.gateTargetMs.toFixed(3)} ms`);

  if (gate.failures.length > 0) {
    console.log('Failures:');
    gate.failures.forEach((entry) => console.log(`  - ${entry}`));
  }
  if (gate.warnings.length > 0) {
    console.log('Warnings:');
    gate.warnings.forEach((entry) => console.log(`  - ${entry}`));
  }

  if (options.outPath) {
    const absoluteOutPath = path.resolve(process.cwd(), options.outPath);
    fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
    fs.writeFileSync(absoluteOutPath, JSON.stringify(gate, null, 2), 'utf8');
    console.log(`- gate output: ${absoluteOutPath}`);
  }

  if (gate.status === 'fail') {
    process.exit(1);
  }
};

main();

