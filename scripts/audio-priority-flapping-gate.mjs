#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPORT = 'benchmarks/audio-priority/latest-transitions.json';
const DEFAULT_OUT = 'benchmarks/audio-priority/latest-gate.json';
const DEFAULT_WINDOW_SEC = 20;
const DEFAULT_MAX_TRANSITIONS = 1;

const parseArgs = (argv) => {
    const args = {
        report: DEFAULT_REPORT,
        out: DEFAULT_OUT,
        windowSec: DEFAULT_WINDOW_SEC,
        maxTransitions: DEFAULT_MAX_TRANSITIONS
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        const next = argv[index + 1];

        if ((token === '--report' || token === '--in') && typeof next === 'string') {
            args.report = next;
            index += 1;
            continue;
        }

        if (token === '--out' && typeof next === 'string') {
            args.out = next;
            index += 1;
            continue;
        }

        if (token === '--window-sec' && typeof next === 'string') {
            args.windowSec = Math.max(1, Math.floor(Number(next) || DEFAULT_WINDOW_SEC));
            index += 1;
            continue;
        }

        if (token === '--max-transitions' && typeof next === 'string') {
            args.maxTransitions = Math.max(1, Math.floor(Number(next) || DEFAULT_MAX_TRANSITIONS));
            index += 1;
        }
    }

    return args;
};

const safeNumber = (value, fallback = 0) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
};

const normalizeTransition = (entry, index) => {
    if (!entry || typeof entry !== 'object') return null;
    const atMs = safeNumber(entry.atMs, NaN);
    if (!Number.isFinite(atMs)) return null;

    const snapshot = entry.snapshot && typeof entry.snapshot === 'object'
        ? entry.snapshot
        : {};

    return {
        sequence: safeNumber(entry.sequence, index + 1),
        atMs,
        fromMode: typeof entry.fromMode === 'string' ? entry.fromMode : 'normal',
        toMode: typeof entry.toMode === 'string' ? entry.toMode : 'normal',
        reasonCode: typeof entry.reasonCode === 'string' ? entry.reasonCode : 'steady',
        hasRealtimeAudio: Boolean(snapshot.hasRealtimeAudio)
    };
};

const computeIdleFlapping = (transitions, windowSec) => {
    const idleOnly = transitions
        .filter((transition) => !transition.hasRealtimeAudio)
        .sort((left, right) => left.atMs - right.atMs);

    if (idleOnly.length === 0) {
        return {
            transitionCount: 0,
            maxTransitionsInWindow: 0
        };
    }

    const windowMs = windowSec * 1000;
    let start = 0;
    let maxTransitionsInWindow = 0;

    for (let end = 0; end < idleOnly.length; end += 1) {
        while (start <= end && (idleOnly[end].atMs - idleOnly[start].atMs) > windowMs) {
            start += 1;
        }

        const count = (end - start) + 1;
        if (count > maxTransitionsInWindow) {
            maxTransitionsInWindow = count;
        }
    }

    return {
        transitionCount: idleOnly.length,
        maxTransitionsInWindow
    };
};

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    const reportPath = path.resolve(args.report);
    const outPath = path.resolve(args.out);

    if (!fs.existsSync(reportPath)) {
        console.error(`Audio Priority Gate FAIL: report not found at ${reportPath}`);
        process.exitCode = 1;
        return;
    }

    const raw = fs.readFileSync(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    const transitionsRaw = Array.isArray(parsed?.transitions) ? parsed.transitions : [];
    const transitions = transitionsRaw
        .map((entry, index) => normalizeTransition(entry, index))
        .filter((entry) => entry !== null);

    const idleStats = computeIdleFlapping(transitions, args.windowSec);
    const pass = idleStats.maxTransitionsInWindow <= args.maxTransitions;

    const result = {
        generatedAt: Date.now(),
        report: reportPath,
        windowSec: args.windowSec,
        maxTransitionsAllowed: args.maxTransitions,
        idleTransitionCount: idleStats.transitionCount,
        maxTransitionsInWindow: idleStats.maxTransitionsInWindow,
        pass
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

    console.log('Audio Priority Flapping Gate');
    console.log(`- report: ${reportPath}`);
    console.log(`- idle transitions: ${idleStats.transitionCount}`);
    console.log(`- max transitions in ${args.windowSec}s: ${idleStats.maxTransitionsInWindow}`);
    console.log(`- limit: ${args.maxTransitions}`);
    console.log(`- status: ${pass ? 'PASS' : 'FAIL'}`);
    console.log(`- gate output: ${outPath}`);

    if (!pass) {
        process.exitCode = 1;
    }
};

main();
