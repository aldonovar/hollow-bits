import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT_PATH = path.join('benchmarks', 'monitoring-runtime', 'latest-report.json');
const DEFAULT_OUTPUT_PATH = path.join('benchmarks', 'monitoring-runtime', 'latest-gate.json');
const MONITOR_LATENCY_MAX_MS = 12;

const parseArgValue = (argv, flag, fallback) => {
  const index = argv.indexOf(flag);
  if (index >= 0 && argv[index + 1]) {
    return argv[index + 1];
  }
  return fallback;
};

const ensureDir = (targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

const main = () => {
  const argv = process.argv.slice(2);
  const reportPath = path.resolve(process.cwd(), parseArgValue(argv, '--report', DEFAULT_REPORT_PATH));
  const outPath = path.resolve(process.cwd(), parseArgValue(argv, '--out', DEFAULT_OUTPUT_PATH));
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const summary = report?.summary ?? {};
  const monitorLatencyP95Ms = Number(summary.monitorLatencyP95Ms ?? Number.POSITIVE_INFINITY);
  const gatePass = Boolean(summary.pass) && monitorLatencyP95Ms <= MONITOR_LATENCY_MAX_MS;

  const output = {
    generatedAt: Date.now(),
    reportPath,
    status: gatePass ? 'pass' : 'fail',
    summary: {
      pass: gatePass,
      monitorLatencyP95Ms,
      activeRouteCount: Number(summary.activeRouteCount ?? 0),
      enabledRouteCount: Number(summary.enabledRouteCount ?? 0),
      pendingFinalizeCount: Number(summary.pendingFinalizeCount ?? 0),
      maxEffectiveMonitorLatencyMs: Number(summary.maxEffectiveMonitorLatencyMs ?? 0)
    },
    target: {
      monitorLatencyP95MsMax: MONITOR_LATENCY_MAX_MS
    }
  };

  ensureDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log('Monitoring Runtime Gate');
  console.log(`- report: ${reportPath}`);
  console.log(`- status: ${output.status.toUpperCase()}`);
  console.log(`- monitor latency p95: ${monitorLatencyP95Ms.toFixed(3)} ms`);
  console.log(`- active routes: ${output.summary.activeRouteCount}`);
  console.log(`- pending finalize: ${output.summary.pendingFinalizeCount}`);
  console.log(`- gate output: ${outPath}`);

  if (!gatePass) {
    process.exitCode = 1;
  }
};

main();
