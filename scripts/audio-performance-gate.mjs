#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join('benchmarks', 'audio-performance', 'latest-report.json');

const DEFAULT_THRESHOLDS = {
  maxFailedCases: 0,
  maxWarnedCases: 2,
  maxWorkletP95TickDriftMs: 36,
  maxWorkletP99TickDriftMs: 95,
  maxWorkletP95LagMs: 32,
  maxWorkletP99LoopMs: 34,
  maxWorkletOverrunRatio: 0.2,
  minWorkletWinRate: 0.6
};

const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const thresholds = {
  maxFailedCases: envNumber('AUDIO_PERF_MAX_FAILED_CASES', DEFAULT_THRESHOLDS.maxFailedCases),
  maxWarnedCases: envNumber('AUDIO_PERF_MAX_WARNED_CASES', DEFAULT_THRESHOLDS.maxWarnedCases),
  maxWorkletP95TickDriftMs: envNumber('AUDIO_PERF_MAX_WORKLET_P95_DRIFT_MS', DEFAULT_THRESHOLDS.maxWorkletP95TickDriftMs),
  maxWorkletP99TickDriftMs: envNumber('AUDIO_PERF_MAX_WORKLET_P99_DRIFT_MS', DEFAULT_THRESHOLDS.maxWorkletP99TickDriftMs),
  maxWorkletP95LagMs: envNumber('AUDIO_PERF_MAX_WORKLET_P95_LAG_MS', DEFAULT_THRESHOLDS.maxWorkletP95LagMs),
  maxWorkletP99LoopMs: envNumber('AUDIO_PERF_MAX_WORKLET_P99_LOOP_MS', DEFAULT_THRESHOLDS.maxWorkletP99LoopMs),
  maxWorkletOverrunRatio: envNumber('AUDIO_PERF_MAX_WORKLET_OVERRUN_RATIO', DEFAULT_THRESHOLDS.maxWorkletOverrunRatio),
  minWorkletWinRate: envNumber('AUDIO_PERF_MIN_WORKLET_WIN_RATE', DEFAULT_THRESHOLDS.minWorkletWinRate)
};

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseArgs = (argv) => {
  const options = {
    reportPath: process.env.AUDIO_PERFORMANCE_REPORT || DEFAULT_REPORT_PATH,
    outputPath: '',
    allowMissing: false,
    strictWarn: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--report') {
      options.reportPath = argv[index + 1] || options.reportPath;
      index += 1;
      continue;
    }

    if (arg === '--out') {
      options.outputPath = argv[index + 1] || '';
      index += 1;
      continue;
    }

    if (arg === '--allow-missing') {
      options.allowMissing = true;
      continue;
    }

    if (arg === '--strict-warn') {
      options.strictWarn = true;
      continue;
    }
  }

  return options;
};

const readJson = (absolutePath) => {
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
};

const buildSummary = (report) => {
  const results = Array.isArray(report?.results) ? report.results : [];
  const comparisons = Array.isArray(report?.comparisons) ? report.comparisons : [];

  const workletResults = results.filter((result) => result?.caseConfig?.schedulerMode === 'worklet-clock');
  const workletCaseCount = workletResults.length;

  const maxWorkletP95TickDriftMs = workletResults.reduce((max, result) => {
    return Math.max(max, safeNumber(result?.metrics?.scheduler?.p95TickDriftMs));
  }, 0);

  const maxWorkletP99TickDriftMs = workletResults.reduce((max, result) => {
    return Math.max(max, safeNumber(result?.metrics?.scheduler?.p99TickDriftMs));
  }, 0);

  const maxWorkletP95LagMs = workletResults.reduce((max, result) => {
    return Math.max(max, safeNumber(result?.metrics?.eventLoop?.p95LagMs));
  }, 0);

  const maxWorkletP99LoopMs = workletResults.reduce((max, result) => {
    return Math.max(max, safeNumber(result?.metrics?.scheduler?.p99LoopMs));
  }, 0);

  const maxWorkletOverrunRatio = workletResults.reduce((max, result) => {
    const tickCount = safeNumber(result?.metrics?.scheduler?.tickCount);
    const overrunCount = safeNumber(result?.metrics?.scheduler?.overrunCount);
    const ratio = tickCount > 0 ? overrunCount / tickCount : 0;
    return Math.max(max, ratio);
  }, 0);

  const completedComparisons = comparisons.filter((comparison) => {
    return comparison?.winner === 'interval' || comparison?.winner === 'worklet-clock';
  });
  const workletWins = completedComparisons.filter((comparison) => comparison?.winner === 'worklet-clock').length;
  const workletWinRate = completedComparisons.length > 0 ? workletWins / completedComparisons.length : 0;

  return {
    totalCases: safeNumber(report?.totalCases),
    workletCaseCount,
    failedCases: safeNumber(report?.failedCases),
    warnedCases: safeNumber(report?.warnedCases),
    maxWorkletP95TickDriftMs,
    maxWorkletP99TickDriftMs,
    maxWorkletP95LagMs,
    maxWorkletP99LoopMs,
    maxWorkletOverrunRatio,
    workletWinRate
  };
};

const evaluateGate = (report, strictWarn) => {
  const summary = buildSummary(report);
  const failures = [];
  const warnings = [];

  if (summary.totalCases <= 0 || summary.workletCaseCount <= 0) {
    failures.push('Benchmark invalido: faltan casos o escenarios worklet.');
  }

  if (summary.failedCases > thresholds.maxFailedCases) {
    failures.push(`Casos FAIL excedidos (${summary.failedCases}/${thresholds.maxFailedCases}).`);
  }

  if (summary.warnedCases > thresholds.maxWarnedCases) {
    warnings.push(`Casos WARN por encima del objetivo (${summary.warnedCases}/${thresholds.maxWarnedCases}).`);
  }

  if (summary.maxWorkletP95TickDriftMs > thresholds.maxWorkletP95TickDriftMs) {
    failures.push(`Worklet drift p95 fuera de presupuesto (${summary.maxWorkletP95TickDriftMs.toFixed(1)}ms > ${thresholds.maxWorkletP95TickDriftMs.toFixed(1)}ms).`);
  }

  if (summary.maxWorkletP99TickDriftMs > thresholds.maxWorkletP99TickDriftMs) {
    failures.push(`Worklet drift p99 fuera de presupuesto (${summary.maxWorkletP99TickDriftMs.toFixed(1)}ms > ${thresholds.maxWorkletP99TickDriftMs.toFixed(1)}ms).`);
  }

  if (summary.maxWorkletP95LagMs > thresholds.maxWorkletP95LagMs) {
    warnings.push(`Worklet lag p95 elevado (${summary.maxWorkletP95LagMs.toFixed(1)}ms > ${thresholds.maxWorkletP95LagMs.toFixed(1)}ms).`);
  }

  if (summary.maxWorkletP99LoopMs > thresholds.maxWorkletP99LoopMs) {
    warnings.push(`Worklet loop p99 elevado (${summary.maxWorkletP99LoopMs.toFixed(1)}ms > ${thresholds.maxWorkletP99LoopMs.toFixed(1)}ms).`);
  }

  if (summary.maxWorkletOverrunRatio > thresholds.maxWorkletOverrunRatio) {
    warnings.push(`Worklet overrun ratio elevado (${(summary.maxWorkletOverrunRatio * 100).toFixed(1)}% > ${(thresholds.maxWorkletOverrunRatio * 100).toFixed(1)}%).`);
  }

  if (Array.isArray(report?.comparisons) && report.comparisons.length === 0) {
    warnings.push('Benchmark sin pares A/B completos; no se pudo estimar win-rate de worklet.');
  } else if (summary.workletWinRate < thresholds.minWorkletWinRate) {
    failures.push(`Worklet win-rate insuficiente (${(summary.workletWinRate * 100).toFixed(1)}% < ${(thresholds.minWorkletWinRate * 100).toFixed(1)}%).`);
  }

  if (strictWarn && warnings.length > 0 && failures.length === 0) {
    failures.push('Modo --strict-warn activo: warnings tratados como fail.');
  }

  const status = failures.length > 0
    ? 'fail'
    : warnings.length > 0
      ? 'warn'
      : 'pass';

  return {
    status,
    thresholds,
    summary,
    failures,
    warnings,
    issues: [...failures, ...warnings]
  };
};

const printGateResult = (reportPath, gateResult) => {
  console.log('Audio Performance Gate');
  console.log(`- report: ${reportPath}`);
  console.log(`- status: ${gateResult.status.toUpperCase()}`);
  console.log(`- cases: ${gateResult.summary.totalCases} (worklet: ${gateResult.summary.workletCaseCount})`);
  console.log(`- failed/warned: ${gateResult.summary.failedCases}/${gateResult.summary.warnedCases}`);
  console.log(`- worklet drift p95/p99: ${gateResult.summary.maxWorkletP95TickDriftMs.toFixed(1)}ms / ${gateResult.summary.maxWorkletP99TickDriftMs.toFixed(1)}ms`);
  console.log(`- worklet lag p95: ${gateResult.summary.maxWorkletP95LagMs.toFixed(1)}ms`);
  console.log(`- worklet loop p99: ${gateResult.summary.maxWorkletP99LoopMs.toFixed(1)}ms`);
  console.log(`- worklet overrun ratio: ${(gateResult.summary.maxWorkletOverrunRatio * 100).toFixed(1)}%`);
  console.log(`- worklet win-rate: ${(gateResult.summary.workletWinRate * 100).toFixed(1)}%`);

  if (gateResult.failures.length > 0) {
    console.log('Failures:');
    gateResult.failures.forEach((issue) => console.log(`  - ${issue}`));
  }

  if (gateResult.warnings.length > 0) {
    console.log('Warnings:');
    gateResult.warnings.forEach((issue) => console.log(`  - ${issue}`));
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const absoluteReportPath = path.resolve(process.cwd(), options.reportPath);

  if (!fs.existsSync(absoluteReportPath)) {
    if (options.allowMissing) {
      console.log(`Audio Performance Gate skipped: report not found at ${absoluteReportPath}`);
      process.exit(0);
    }

    console.error(`Audio Performance Gate failed: report not found at ${absoluteReportPath}`);
    process.exit(2);
  }

  let report;
  try {
    report = readJson(absoluteReportPath);
  } catch (error) {
    console.error(`Audio Performance Gate failed: invalid JSON at ${absoluteReportPath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

  const gateResult = evaluateGate(report, options.strictWarn);
  printGateResult(absoluteReportPath, gateResult);

  if (options.outputPath) {
    const absoluteOutputPath = path.resolve(process.cwd(), options.outputPath);
    const directory = path.dirname(absoluteOutputPath);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(absoluteOutputPath, JSON.stringify(gateResult, null, 2), 'utf8');
    console.log(`- gate output: ${absoluteOutputPath}`);
  }

  if (gateResult.status === 'fail') {
    process.exit(1);
  }
};

main();
