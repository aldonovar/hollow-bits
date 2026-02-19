<div align="center">
  <img width="800" alt="ETHEREAL STUDIO" src="public/ethereal-banner.svg" />

  <br/>

  <p>
    <strong>Desktop-first DAW focused on reliability, speed, and pro workflow depth.</strong>
  </p>

  <p>
    <a href="#philosophy">Philosophy</a> •
    <a href="#core-capabilities">Core Capabilities</a> •
    <a href="#getting-started">Getting Started</a> •
    <a href="#quality-and-performance-gates">Quality and Performance Gates</a>
  </p>
</div>

<br/>

## Philosophy

**ETHEREAL STUDIO** is built as a local-first, desktop-first production environment where stability is a product feature, not an afterthought.

The goal is to feel as immediate as top-tier DAWs while exposing deeper engineering diagnostics for faster iteration and stricter release control.

## Core Capabilities

### Audio Engine
- Custom `AudioEngine` on Web Audio + Electron.
- Dual scheduler modes: `worklet-clock` (AudioWorklet-driven) and `interval` fallback.
- Incremental graph patching (routing, sends, mix params) to reduce reconnect churn.
- Granular playback path for warped clips + native path for standard playback.

### Performance and Reliability Tooling
- SR x Buffer reliability matrix in-app (40 cases) with PASS/WARN/FAIL report.
- Extreme A/B performance benchmark in-app (`interval` vs `worklet-clock`).
- Performance gate with explicit budgets (drift p95/p99, loop p99, lag p95, win-rate).
- JSON report export/copy and benchmark history persistence.

### UI and Session Scale
- Timeline horizontal and vertical virtualization for large sessions.
- Centralized metering flow with lower per-track UI overhead.
- Progressive import pipeline with concurrency control and feedback.

## Tech Stack

- **Core**: React 19 + TypeScript + Vite
- **Desktop Runtime**: Electron
- **Audio**: Web Audio API + AudioWorklet
- **Testing**: Vitest + jsdom
- **CI**: GitHub Actions quality gates

## Getting Started

### Prerequisites
- **Node.js LTS** (v20+)
- **Windows x64** (primary target)

### Install and Run

```bash
npm install
npm run dev:electron
```

### Build

```bash
npm run build
```

## Quality and Performance Gates

Run the core engineering gates locally:

```bash
npm run typecheck
npm run test:unit
npm run build
```

or all at once:

```bash
npm run quality:gates
```

Run performance gate against a benchmark report:

```bash
npm run perf:gate -- --report benchmarks/audio-performance/latest-report.json
```

Optional strict mode (treat warnings as failure):

```bash
npm run perf:gate -- --report benchmarks/audio-performance/latest-report.json --strict-warn
```

Detailed release/quality protocols are documented in `docs/QUALITY_AND_RELEASE_GATES.md`.

## License

Proprietary & Confidential.

Developed by [Aldonovar](https://github.com/aldonovar) and [ALLYX](https://allyxorb.com).
