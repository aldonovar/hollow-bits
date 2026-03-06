#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SOURCE_PATH = path.join('session-launch-report.json');
const DEFAULT_TARGET_PATH = path.join('benchmarks', 'session-launch', 'latest-report.json');

const parseArgs = (argv) => {
  const options = {
    sourcePath: DEFAULT_SOURCE_PATH,
    targetPath: DEFAULT_TARGET_PATH
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--in') {
      options.sourcePath = argv[index + 1] || options.sourcePath;
      index += 1;
      continue;
    }
    if (arg === '--out') {
      options.targetPath = argv[index + 1] || options.targetPath;
      index += 1;
      continue;
    }
  }

  return options;
};

const safeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const validateReport = (report) => {
  const errors = [];

  if (!report || typeof report !== 'object') {
    errors.push('Reporte invalido: no es un objeto JSON.');
    return errors;
  }

  if (!report.summary || typeof report.summary !== 'object') {
    errors.push('Reporte invalido: falta summary.');
  } else {
    const sampleCount = safeNumber(report.summary.sampleCount);
    if (sampleCount <= 0) {
      errors.push('Reporte invalido: sampleCount <= 0.');
    }
  }

  if (!Array.isArray(report.samples) || report.samples.length <= 0) {
    errors.push('Reporte invalido: falta arreglo samples.');
  }

  if (!report.scenario || typeof report.scenario !== 'object') {
    errors.push('Reporte invalido: falta scenario.');
  } else {
    if (safeNumber(report.scenario.tracks) <= 0) {
      errors.push('Reporte invalido: scenario.tracks <= 0.');
    }
    if (safeNumber(report.scenario.scenes) <= 0) {
      errors.push('Reporte invalido: scenario.scenes <= 0.');
    }
  }

  return errors;
};

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  const absoluteSourcePath = path.resolve(process.cwd(), options.sourcePath);
  const absoluteTargetPath = path.resolve(process.cwd(), options.targetPath);

  if (!fs.existsSync(absoluteSourcePath)) {
    console.error(`Source report not found: ${absoluteSourcePath}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(absoluteSourcePath, 'utf8'));
  } catch (error) {
    console.error(`Invalid JSON source report: ${absoluteSourcePath}`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  }

  const errors = validateReport(report);
  if (errors.length > 0) {
    console.error('Source report validation failed:');
    errors.forEach((entry) => console.error(`- ${entry}`));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(absoluteTargetPath), { recursive: true });
  fs.writeFileSync(absoluteTargetPath, JSON.stringify(report, null, 2), 'utf8');

  console.log('Session launch report promoted');
  console.log(`- source: ${absoluteSourcePath}`);
  console.log(`- target: ${absoluteTargetPath}`);
};

main();

