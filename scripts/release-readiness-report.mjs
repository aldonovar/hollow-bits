import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_CONTRACT = {
  name: 'Hollow Bits 1.0 Public',
  targetDate: '2026-09-18',
  positioning: {
    primary: 'live-reliability',
    secondary: 'recording-recovery',
  },
  platforms: {
    windows: 'ga',
    linux: 'preview',
  },
  linuxPreviewFocus: ['wayland', 'hyprland', 'pipewire', 'jack', 'alsa'],
  pluginFormats: ['vst3', 'clap'],
  technicalTargets: {
    launchErrorP95MsMax: 2,
    transportDriftP99MsMax: 5,
    monitorLatencyP95MsMax: 12,
    visualFpsP95Min: 58,
    recordingCyclesMin: 1000,
    recordingTakeLossMax: 0,
    liveStressMinutesMin: 90,
    audioPriorityIdleTransitionsMax: 1,
  },
};

export const PROGRAM_STATUS_PATH = path.resolve(
  process.cwd(),
  'docs',
  'data',
  'hollow-bits-1.0-program-status.json'
);

const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  'benchmarks',
  'release-readiness',
  'latest-report.json'
);

const readJsonIfExists = (targetPath) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch {
    return null;
  }
};

const toGateStatus = (pass) => (pass ? 'pass' : 'fail');

const summarizeProgramBlocks = (programStatus) => {
  const blocks = Array.isArray(programStatus?.blocks) ? programStatus.blocks : [];
  const counts = blocks.reduce((acc, block) => {
    const key = typeof block.status === 'string' ? block.status : 'planned';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const blockingBlocks = blocks.filter((block) => block.releaseBlocking);
  const unresolvedBlockingBlocks = blockingBlocks.filter((block) => block.status !== 'done');

  return {
    counts,
    total: blocks.length,
    blockingTotal: blockingBlocks.length,
    unresolvedBlocking: unresolvedBlockingBlocks.length,
    blockingReady: unresolvedBlockingBlocks.length === 0,
    blocks,
  };
};

export function evaluateReleaseReadiness({
  launchGate,
  stressReport,
  recordingGate,
  monitoringGate,
  monitoringReport,
  block5Gate,
  block6Gate,
  block7Gate,
  audioPriorityGate,
  transportGate,
  transportRuntimeReport,
  programStatus,
}) {
  const targets = RELEASE_CONTRACT.technicalTargets;

  const launchP95 = Number(launchGate?.summary?.p95LaunchErrorMs ?? Number.POSITIVE_INFINITY);
  const launchScenarioTracks = Number(launchGate?.summary?.scenarioTracks ?? 0);
  const launchScenarioScenes = Number(launchGate?.summary?.scenarioScenes ?? 0);
  const launchStrictPass = launchGate?.status === 'pass'
    && launchP95 <= targets.launchErrorP95MsMax
    && launchScenarioTracks >= 48
    && launchScenarioScenes >= 8;

  const stressPass = Boolean(stressReport?.gates?.pass);
  const driftP99 = Number(
    stressReport?.gates?.results?.driftP99?.actualMs
      ?? stressReport?.telemetry?.audio?.driftP99Ms
      ?? transportRuntimeReport?.summary?.driftP99Ms
      ?? transportRuntimeReport?.telemetry?.audio?.driftP99Ms
      ?? Number.POSITIVE_INFINITY
  );
  const monitorLatency = Number(
    monitoringReport?.summary?.monitorLatencyP95Ms
      ?? stressReport?.telemetry?.audio?.monitorLatencyP95Ms
      ?? Number.POSITIVE_INFINITY
  );
  const visualFpsP95 = Number(
    stressReport?.telemetry?.ui?.fpsP95
      ?? Number.NEGATIVE_INFINITY
  );
  const liveDurationMinutes = Number(stressReport?.scenario?.durationMinutes ?? 0);
  const stressTracks = Number(stressReport?.scenario?.tracks ?? 0);
  const stressScenes = Number(stressReport?.scenario?.scenes ?? 0);

  const recordingCycles = Number(recordingGate?.summary?.attemptedCycles ?? 0);
  const recordingTakeLoss = Number(recordingGate?.summary?.takeLossCount ?? Number.POSITIVE_INFINITY);
  const recordingPass = recordingGate?.status === 'pass'
    && recordingCycles >= targets.recordingCyclesMin
    && recordingTakeLoss <= targets.recordingTakeLossMax;

  const monitoringRuntimePass = monitoringGate?.status === 'pass';
  const block5EditingPass = Boolean(block5Gate?.pass);
  const block6SessionPass = Boolean(block6Gate?.pass);
  const block7MixerPass = Boolean(block7Gate?.pass);
  const audioPriorityPass = Boolean(audioPriorityGate?.pass)
    && Number(audioPriorityGate?.maxTransitionsInWindow ?? Number.POSITIVE_INFINITY) <= targets.audioPriorityIdleTransitionsMax;

  const transportCommandPass = Boolean(transportGate?.pass);
  const transportRuntimePass = Boolean(transportGate?.runtime?.pass);
  const transportRuntimeCheckpointCount = Number(transportGate?.runtime?.checkpointCount ?? 0);

  const gates = [
    {
      id: 'transport-command-contract',
      label: 'Transport command contract gate',
      status: toGateStatus(transportCommandPass),
      actual: {
        pass: transportCommandPass,
        testedFiles: Array.isArray(transportGate?.testedFiles) ? transportGate.testedFiles.length : 0,
        runtimePass: transportRuntimePass,
        runtimeCheckpointCount: transportRuntimeCheckpointCount,
      },
      target: {
        pass: true,
        runtimePass: true,
      },
      source: 'benchmarks/transport/latest-gate.json',
    },
    {
      id: 'launch-strict',
      label: 'Launch strict gate',
      status: toGateStatus(launchStrictPass),
      actual: {
        p95LaunchErrorMs: launchP95,
        tracks: launchScenarioTracks,
        scenes: launchScenarioScenes,
      },
      target: {
        p95LaunchErrorMsMax: targets.launchErrorP95MsMax,
        tracksMin: 48,
        scenesMin: 8,
      },
      source: 'benchmarks/session-launch/latest-gate.json',
    },
    {
      id: 'stress-48x8',
      label: 'Stress 48x8 live gate',
      status: toGateStatus(
        stressPass
          && stressTracks >= 48
          && stressScenes >= 8
          && liveDurationMinutes >= targets.liveStressMinutesMin
      ),
      actual: {
        tracks: stressTracks,
        scenes: stressScenes,
        durationMinutes: liveDurationMinutes,
      },
      target: {
        tracksMin: 48,
        scenesMin: 8,
        durationMinutesMin: targets.liveStressMinutesMin,
      },
      source: 'benchmarks/stress-48x8/latest-report.json',
    },
    {
      id: 'recording-cycles',
      label: 'Recording reliability gate',
      status: toGateStatus(recordingPass),
      actual: {
        attemptedCycles: recordingCycles,
        takeLossCount: recordingTakeLoss,
      },
      target: {
        attemptedCyclesMin: targets.recordingCyclesMin,
        takeLossCountMax: targets.recordingTakeLossMax,
      },
      source: 'benchmarks/recording-reliability/latest-gate.json',
    },
    {
      id: 'monitoring-runtime-contract',
      label: 'Monitoring runtime gate',
      status: toGateStatus(monitoringRuntimePass),
      actual: {
        pass: monitoringRuntimePass,
        monitorLatencyP95Ms: monitorLatency,
        activeRouteCount: Number(monitoringReport?.summary?.activeRouteCount ?? 0),
        pendingFinalizeCount: Number(monitoringReport?.summary?.pendingFinalizeCount ?? 0),
      },
      target: {
        pass: true,
        monitorLatencyP95MsMax: targets.monitorLatencyP95MsMax,
      },
      source: 'benchmarks/monitoring-runtime/latest-gate.json',
    },
    {
      id: 'block5-editing-regression',
      label: 'Block 5 editing regression gate',
      status: toGateStatus(block5EditingPass),
      actual: {
        pass: block5EditingPass,
        attemptedCycles: Number(block5Gate?.summary?.attemptedCycles ?? 0),
        takeLossCount: Number(block5Gate?.summary?.takeLossCount ?? Number.POSITIVE_INFINITY),
        testedFiles: Array.isArray(block5Gate?.testedFiles) ? block5Gate.testedFiles.length : 0,
      },
      target: {
        pass: true,
        attemptedCyclesMin: targets.recordingCyclesMin,
        takeLossCountMax: targets.recordingTakeLossMax,
      },
      source: 'benchmarks/block5-editing/latest-gate.json',
    },
    {
      id: 'block6-session-flagship',
      label: 'Block 6 Session flagship gate',
      status: toGateStatus(block6SessionPass),
      actual: {
        pass: block6SessionPass,
        launchGatePass: Boolean(block6Gate?.summary?.launchGatePass),
        stressGatePass: Boolean(block6Gate?.summary?.stressGatePass),
        scenarioTracks: Number(block6Gate?.summary?.scenarioTracks ?? 0),
        scenarioScenes: Number(block6Gate?.summary?.scenarioScenes ?? 0),
        durationMinutes: Number(block6Gate?.summary?.durationMinutes ?? 0),
        visualFpsP95: Number(block6Gate?.summary?.visualFpsP95 ?? Number.NEGATIVE_INFINITY),
        testedFiles: Array.isArray(block6Gate?.testedFiles) ? block6Gate.testedFiles.length : 0,
      },
      target: {
        pass: true,
        tracksMin: 48,
        scenesMin: 8,
        durationMinutesMin: targets.liveStressMinutesMin,
        visualFpsP95Min: targets.visualFpsP95Min,
      },
      source: 'benchmarks/block6-session/latest-gate.json',
    },
    {
      id: 'block7-mixer-routing-automation',
      label: 'Block 7 mixer/routing/automation gate',
      status: toGateStatus(block7MixerPass),
      actual: {
        pass: block7MixerPass,
        monitoringGatePass: Boolean(block7Gate?.summary?.monitoringGatePass),
        testedFiles: Number(block7Gate?.summary?.testedFiles ?? 0),
        activeRouteCount: Number(block7Gate?.summary?.activeRouteCount ?? 0),
        pendingFinalizeCount: Number(block7Gate?.summary?.pendingFinalizeCount ?? 0),
        monitorLatencyP95Ms: Number(block7Gate?.summary?.monitorLatencyP95Ms ?? Number.POSITIVE_INFINITY),
      },
      target: {
        pass: true,
        monitoringGatePass: true,
        monitorLatencyP95MsMax: targets.monitorLatencyP95MsMax,
      },
      source: 'benchmarks/block7-mixer/latest-gate.json',
    },
    {
      id: 'audio-priority-flapping',
      label: 'Audio priority stability gate',
      status: toGateStatus(audioPriorityPass),
      actual: {
        maxTransitionsInWindow: Number(audioPriorityGate?.maxTransitionsInWindow ?? Number.POSITIVE_INFINITY),
      },
      target: {
        maxTransitionsInWindowMax: targets.audioPriorityIdleTransitionsMax,
      },
      source: 'benchmarks/audio-priority/latest-gate.json',
    },
    {
      id: 'transport-drift',
      label: 'Transport drift gate',
      status: toGateStatus(driftP99 <= targets.transportDriftP99MsMax),
      actual: { driftP99Ms: driftP99 },
      target: { driftP99MsMax: targets.transportDriftP99MsMax },
      source: stressReport
        ? 'benchmarks/stress-48x8/latest-report.json'
        : 'benchmarks/transport/latest-runtime.json',
    },
    {
      id: 'monitor-latency',
      label: 'Monitor latency gate',
      status: toGateStatus(monitorLatency <= targets.monitorLatencyP95MsMax),
      actual: { monitorLatencyP95Ms: monitorLatency },
      target: { monitorLatencyP95MsMax: targets.monitorLatencyP95MsMax },
      source: monitoringReport
        ? 'benchmarks/monitoring-runtime/latest-report.json'
        : 'benchmarks/stress-48x8/latest-report.json',
    },
    {
      id: 'visual-fps',
      label: 'Playback visual FPS gate',
      status: toGateStatus(visualFpsP95 >= targets.visualFpsP95Min),
      actual: { fpsP95: visualFpsP95 },
      target: { fpsP95Min: targets.visualFpsP95Min },
      source: 'benchmarks/stress-48x8/latest-report.json',
    },
  ];

  const failedGates = gates.filter((gate) => gate.status !== 'pass');
  const programSummary = summarizeProgramBlocks(programStatus);
  const readyForPublicRelease = failedGates.length === 0 && programSummary.blockingReady;

  return {
    generatedAt: new Date().toISOString(),
    release: RELEASE_CONTRACT,
    gates,
    summary: {
      failedGateCount: failedGates.length,
      passedGateCount: gates.length - failedGates.length,
      blockingProgramBlocksRemaining: programSummary.unresolvedBlocking,
      readyForPublicRelease,
      overallStatus: readyForPublicRelease
        ? 'ready'
        : failedGates.length > 0
          ? 'blocked'
          : 'in-progress',
    },
    program: programSummary,
  };
}

const ensureParentDir = (targetPath) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
};

const parseOutPath = (argv) => {
  const outIndex = argv.indexOf('--out');
  if (outIndex >= 0 && argv[outIndex + 1]) {
    return path.resolve(process.cwd(), argv[outIndex + 1]);
  }
  return DEFAULT_OUTPUT_PATH;
};

const main = () => {
  const outPath = parseOutPath(process.argv.slice(2));
  const report = evaluateReleaseReadiness({
    transportGate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'transport', 'latest-gate.json')),
    transportRuntimeReport: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'transport', 'latest-runtime.json')),
    launchGate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'session-launch', 'latest-gate.json')),
    stressReport: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'stress-48x8', 'latest-report.json')),
    recordingGate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'recording-reliability', 'latest-gate.json')),
    monitoringGate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'monitoring-runtime', 'latest-gate.json')),
    monitoringReport: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'monitoring-runtime', 'latest-report.json')),
    block5Gate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'block5-editing', 'latest-gate.json')),
    block6Gate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'block6-session', 'latest-gate.json')),
    block7Gate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'block7-mixer', 'latest-gate.json')),
    audioPriorityGate: readJsonIfExists(path.resolve(process.cwd(), 'benchmarks', 'audio-priority', 'latest-gate.json')),
    programStatus: readJsonIfExists(PROGRAM_STATUS_PATH),
  });

  ensureParentDir(outPath);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('Release Readiness Report');
  console.log(`- out: ${outPath}`);
  console.log(`- overall: ${report.summary.overallStatus}`);
  console.log(`- ready for public release: ${report.summary.readyForPublicRelease ? 'yes' : 'no'}`);
  console.log(`- passed gates: ${report.summary.passedGateCount}/${report.gates.length}`);
  console.log(`- blocking program blocks remaining: ${report.summary.blockingProgramBlocksRemaining}`);
};

const isDirectRun = (() => {
  const entryHref = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
  return entryHref === import.meta.url;
})();

if (isDirectRun) {
  main();
}
