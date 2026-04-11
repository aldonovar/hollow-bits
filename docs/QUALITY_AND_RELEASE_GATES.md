# HOLLOW BITS - QUALITY AND RELEASE GATES

## 1) Always-required engineering gates
- `npm run typecheck`
- `npm run test:unit`
- `npm run transport:gate`
- `npm run build`
- `npm run quality:live-strict`
- `npm run release:readiness`

No release candidate if any mandatory gate fails.

## 2) Public 1.0 release contract
- Release target: `2026-09-18`
- Product type: `Public 1.0`
- Platforms:
  - `Windows 11 x64 GA`
  - `Linux Preview` focused on `Wayland / Hyprland` with `PipeWire / JACK / ALSA`
- Plugin formats:
  - `VST3`
  - `CLAP`
- Differentiators:
  - `Live reliability`
  - `Recording + Recovery`

## 3) Technical release gates
- Session launch:
  - `launch error p95 <= 2ms`
  - source must be `live-capture`
  - target session must be at least `48 tracks / 8 scenes`
- Transport:
  - `drift p99 <= 5ms`
  - no duplicate playback sessions
  - no residual audio after `pause / stop / seek`
  - `transport:gate` in PASS
  - `transport runtime smoke` in PASS via `benchmarks/transport/latest-runtime.json`
- Recording:
  - `1000` cycles
  - `0` take loss
  - finalize path survives partial failure
- Editing:
  - `block5:gate` in PASS
  - take/comp/punch regression matrix green
  - comped project roundtrip survives `save / open / recover`
- Session flagship:
  - `block6:gate` in PASS
  - launch gate must remain `live-capture` with `48x8`
  - scene replay / recording regression matrix green
  - stage-safe Session workflow remains operational under the strict live scenario
- Mixer / routing / automation:
  - `block7:gate` in PASS
  - groups / returns / sends pre-post / cue `PFL/AFL` stay stable
  - routing cycles stay repaired on project open
  - automation read / touch / latch / write remain outside the React hot path
- Monitoring:
  - `monitor latency p95 <= 12ms` at `48k / 128`
- Live stress:
  - `90 min` without critical failure
  - session switching stable
- Renderer:
  - `p95 >= 58fps` in the baseline playback scenario
  - waveform remains visible during playback
- Audio health:
  - `audio-priority:gate` must remain green
  - technical incidents remain audit-ready, but never surface as intrusive UX in normal mode
  - diagnostics are hidden by default and only exposed through explicit debug visibility

## 4) Test strategy by subsystem

### Unit tests
- Transport state transitions and authority snapshots
- Recording journal and finalize path
- Session launch / scene recording logic
- Project integrity and recovery
- Performance reducers and runtime gates
- Release readiness report logic

### Integration tests
- `Play / Pause / Stop / Seek / Loop`
- `transport command contract`
- `Record / Stop / Finalize / Recover`
- `Take / Comp / Punch / Reopen`
- `Session launch / replay / stress 48x8`
- `Mixer / routing / automation / cue monitor`
- `Session replay / replay-last / stage-safe visibility`
- `Save / Open / Autosave / Recover`
- `Export master / stems`

### Competitive benchmark protocol
- Measure Ableton Live and Logic Pro by behavior, not implementation:
  - launch timing
  - transport correctness
  - recovery after interruption
  - plugin isolation expectations
  - workflow latency for common tasks

## 5) Desktop smoke matrix

### Windows GA
- cold start
- open project
- import wav / aiff / mp3 / flac
- play / pause / stop / seek / loop
- record / finalize
- save / open roundtrip
- export master + stems
- plugin scan / load / fault handling

### Linux Preview
- launch on supported distro/windowing stack
- open project
- playback and seek
- audio device detection
- import / export baseline
- plugin scan baseline under supported preview matrix

Linux Preview is functional but explicitly narrower than Windows GA.

## 6) Release readiness report
- Script:
  - `npm run release:readiness`
- Output:
  - `benchmarks/release-readiness/latest-report.json`
- Inputs:
  - `benchmarks/transport/latest-gate.json`
  - `benchmarks/session-launch/latest-gate.json`
  - `benchmarks/stress-48x8/latest-report.json`
  - `benchmarks/recording-reliability/latest-gate.json`
  - `benchmarks/block5-editing/latest-gate.json`
  - `benchmarks/block6-session/latest-gate.json`
  - `benchmarks/block7-mixer/latest-gate.json`
  - `benchmarks/audio-priority/latest-gate.json`
  - `docs/data/hollow-bits-1.0-program-status.json`
- Purpose:
  - aggregate hard technical gates
  - expose remaining blocking program blocks
  - make "Public 1.0 readiness" explicit and auditable

## 6.1) Program governance inputs
- Roadmap source:
  - `docs/MASTER_ROADMAP_DAW.md`
- Competitive benchmark source:
  - `docs/HOLLOW_BITS_1_0_COMPETITIVE_MATRIX.md`
- Governance source:
  - `docs/HOLLOW_BITS_1_0_PROGRAM_GOVERNANCE.md`
- Priority backlog source:
  - `docs/data/hollow-bits-1.0-priority-backlog.json`
- Program status source:
  - `docs/data/hollow-bits-1.0-program-status.json`

## 7) Release checklist
- all mandatory gates green
- release readiness report generated
- no visible technical error banners in normal UX
- known issues triaged
- rollback plan documented
- Windows GA matrix complete
- Linux Preview matrix and limitations published
