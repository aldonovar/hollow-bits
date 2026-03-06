#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join('benchmarks', 'stress-48x8', 'latest-report.json');

const parseArgs = (argv) => {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    outputPath: '',
    allowMissing: false,
    strictLiveCapture: false
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
    if (arg === '--allow-missing') {
      options.allowMissing = true;
      continue;
    }
    if (arg === '--strict-live-capture') {
      options.strictLiveCapture = true;
      continue;
    }
  }

  return options;
};

const readJson = (absolutePath) => {
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
};

const evaluateGate = (report, options) => {
  const failures = [];
  const warnings = [];
  const gateResults = report?.gates?.results || {};
  const scenario = report?.scenario || {};
  const mandatoryGateKeys = Array.isArray(report?.gates?.mandatoryGateKeys)
    ? report.gates.mandatoryGateKeys
    : ['grid48x8', 'liveDuration', 'recordingCycles', 'takeLoss', 'launchErrorP95'];

  mandatoryGateKeys.forEach((gateKey) => {
    const gate = gateResults[gateKey];
    if (!gate || gate.pass !== true) {
      failures.push(`Gate obligatorio fallido: ${gateKey}.`);
    }
  });

  if (!gateResults.driftP99 || gateResults.driftP99.pass !== true) {
    warnings.push('Gate driftP99 fuera de objetivo (no bloqueante).');
  }

  const source = typeof scenario.source === 'string' ? scenario.source : 'unknown';
  if (source !== 'live-capture') {
    warnings.push(`Reporte no-live-capture (${source}).`);
    if (options.strictLiveCapture || String(process.env.STRESS_48X8_STRICT_LIVE_CAPTURE || '0') === '1') {
      failures.push('Modo estricto activo: se requiere live-capture.');
    }
  }

  const status = failures.length > 0
    ? 'fail'
    : warnings.length > 0
      ? 'warn'
      : 'pass';

  return {
    status,
    summary: {
      scenario: `${scenario.tracks || 0}x${scenario.scenes || 0}`,
      source,
      durationMinutes: scenario.durationMinutes || 0,
      recordingCycles: scenario.recordingCycles || 0,
      mandatoryGateKeys
    },
    failures,
    warnings,
    issues: [...failures, ...warnings]
  };
};

const printResult = (reportPath, result) => {
  console.log('Stress 48x8 Gate');
  console.log(`- report: ${reportPath}`);
  console.log(`- status: ${result.status.toUpperCase()}`);
  console.log(`- scenario: ${result.summary.scenario}`);
  console.log(`- source: ${result.summary.source}`);
  console.log(`- duration: ${result.summary.durationMinutes} min`);
  console.log(`- recording cycles: ${result.summary.recordingCycles}`);

  if (result.failures.length > 0) {
    console.log('Failures:');
    result.failures.forEach((entry) => console.log(`  - ${entry}`));
  }
  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((entry) => console.log(`  - ${entry}`));
  }
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const absoluteReportPath = path.resolve(process.cwd(), options.reportPath);

  if (!fs.existsSync(absoluteReportPath)) {
    if (options.allowMissing) {
      console.log(`Stress 48x8 gate skipped: report not found at ${absoluteReportPath}`);
      process.exit(0);
    }
    console.error(`Stress 48x8 gate failed: report not found at ${absoluteReportPath}`);
    process.exit(2);
  }

  let report;
  try {
    report = readJson(absoluteReportPath);
  } catch (error) {
    console.error(`Stress 48x8 gate failed: invalid JSON at ${absoluteReportPath}`);
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
