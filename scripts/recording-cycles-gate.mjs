#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join('benchmarks', 'recording-reliability', 'latest-report.json');

const parseArgs = (argv) => {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    outputPath: '',
    requiredCycles: 1000,
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
      options.outputPath = argv[index + 1] || options.outputPath;
      index += 1;
      continue;
    }
    if (arg === '--cycles') {
      const nextValue = Number(argv[index + 1] || options.requiredCycles);
      if (Number.isFinite(nextValue) && nextValue > 0) {
        options.requiredCycles = Math.floor(nextValue);
      }
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

const readJson = (absolutePath) => JSON.parse(fs.readFileSync(absolutePath, 'utf8'));

const evaluateGate = (report, options) => {
  const failures = [];
  const scenario = report?.scenario || {};
  const summary = report?.summary || {};
  const gateResults = report?.gates?.results || {};

  if ((scenario.cycles || 0) < options.requiredCycles) {
    failures.push(`Se requieren ${options.requiredCycles} ciclos; actual ${(scenario.cycles || 0)}.`);
  }

  if ((summary.committedCycles || 0) !== (summary.attemptedCycles || 0)) {
    failures.push(`Committed cycles ${(summary.committedCycles || 0)} != attempted ${(summary.attemptedCycles || 0)}.`);
  }

  if ((summary.takeLossCount || 0) !== 0) {
    failures.push(`Take loss detectado: ${(summary.takeLossCount || 0)}.`);
  }

  if ((summary.failedCycles || 0) !== 0) {
    failures.push(`Failed cycles detectados: ${(summary.failedCycles || 0)}.`);
  }

  if ((summary.journalMismatchCount || 0) !== 0) {
    failures.push(`Journal mismatch detectado: ${(summary.journalMismatchCount || 0)}.`);
  }

  if (gateResults.cycles?.pass !== true) {
    failures.push('Gate interno cycles fallido.');
  }

  if (gateResults.committedCycles?.pass !== true) {
    failures.push('Gate interno committedCycles fallido.');
  }

  if (gateResults.takeLoss?.pass !== true) {
    failures.push('Gate interno takeLoss fallido.');
  }

  if (gateResults.failedCycles?.pass !== true) {
    failures.push('Gate interno failedCycles fallido.');
  }

  if (gateResults.journalConsistency?.pass !== true) {
    failures.push('Gate interno journalConsistency fallido.');
  }

  return {
    status: failures.length > 0 ? 'fail' : 'pass',
    summary: {
      attemptedCycles: summary.attemptedCycles || 0,
      committedCycles: summary.committedCycles || 0,
      takeLossCount: summary.takeLossCount || 0,
      failedCycles: summary.failedCycles || 0,
      p95CommitMs: summary.p95CommitMs || 0
    },
    failures
  };
};

const printResult = (reportPath, result) => {
  console.log('Recording Cycles Gate');
  console.log(`- report: ${reportPath}`);
  console.log(`- status: ${result.status.toUpperCase()}`);
  console.log(`- attempted cycles: ${result.summary.attemptedCycles}`);
  console.log(`- committed cycles: ${result.summary.committedCycles}`);
  console.log(`- take loss: ${result.summary.takeLossCount}`);
  console.log(`- failed cycles: ${result.summary.failedCycles}`);
  console.log(`- p95 commit: ${result.summary.p95CommitMs} ms`);

  if (result.failures.length > 0) {
    console.log('Failures:');
    result.failures.forEach((entry) => console.log(`  - ${entry}`));
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const absoluteReportPath = path.resolve(process.cwd(), options.reportPath);

  if (!fs.existsSync(absoluteReportPath)) {
    if (options.allowMissing) {
      console.log(`Recording cycles gate skipped: report not found at ${absoluteReportPath}`);
      process.exit(0);
    }
    console.error(`Recording cycles gate failed: report not found at ${absoluteReportPath}`);
    process.exit(2);
  }

  let report;
  try {
    report = readJson(absoluteReportPath);
  } catch (error) {
    console.error(`Recording cycles gate failed: invalid JSON at ${absoluteReportPath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

  const result = evaluateGate(report, options);
  printResult(absoluteReportPath, result);

  if (options.outputPath) {
    const absoluteOutputPath = path.resolve(process.cwd(), options.outputPath);
    fs.mkdirSync(path.dirname(absoluteOutputPath), { recursive: true });
    fs.writeFileSync(absoluteOutputPath, JSON.stringify(result, null, 2), 'utf8');
    console.log(`- gate output: ${absoluteOutputPath}`);
  }

  if (result.status === 'fail') {
    process.exit(1);
  }
};

main();
