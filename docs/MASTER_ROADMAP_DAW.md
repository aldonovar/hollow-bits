# HOLLOW BITS 1.0 - MASTER ROADMAP

## 1) North Star
- Release target: `2026-09-18`
- Product target: `Public 1.0`
- Positioning:
  - win first on `live reliability`
  - win second on `recording + recovery`
  - differentiate with a faster `Arrange + Session` hybrid workflow
- Platforms:
  - `Windows 11 x64 GA`
  - `Linux Preview` focused on `Wayland / Hyprland` with `PipeWire / JACK / ALSA`
- Plugin ecosystem in 1.0:
  - `VST3`
  - `CLAP`

## 2) Product Rules
- Engine is the single source of truth for transport, runtime audio health and automation playback.
- Renderer must never become the authority for time or playback state.
- No visible technical alarms in normal UX.
- No feature enters 1.0 if it compromises transport, recording, renderer fluency or release gates.
- "Superiority" means fewer ambiguous states, stronger recovery and safer live operation, not more unchecked features.

## 3) Release Blocks

### Block 0 - Competitive benchmark and architecture freeze
- Build a capability matrix against Ableton Live and Logic Pro across:
  - transport
  - Arrange
  - Session / launch
  - recording
  - comping / takes
  - automation
  - mixer / routing
  - browser
  - export
  - plugin hosting
  - recovery
  - performance / UI
- Classify every capability as:
  - `Parity Required for 1.0`
  - `Differentiator for 1.0`
  - `Post-1.0`
- Freeze architecture and require strict gates on merge.
- Current status: closed. The competitive matrix, architecture freeze, release governance, priority backlog and readiness report are now the formal execution contract for Public 1.0.

### Block 1 - Impeccable transport and single playback session
- Close `Play / Pause / Stop / Seek / Loop / Song End`.
- Guarantee only one active playback session.
- Invalidate scheduling, sources, timers and pending launches deterministically.
- Harden `ctx.resume()`, `init()` and async resume paths.
- Keep an explicit `transport:gate` artifact in CI for the command contract and its live Electron runtime smoke.

### Block 2 - Truthful audio health and clean UX
- Keep audio incidents in diagnostics and gates, not in intrusive user-facing alarms.
- Maintain `AudioIncidentWindow` as recent-truth only.
- Remove duplicate health derivations from shell and Session.
- Keep diagnostics hidden by default and available only in explicit debug mode.

### Block 3 - 60fps renderer with maximum detail
- Move the playhead to an imperative layer.
- Split Arrange into playhead, grid, waveform and interaction layers.
- Cache waveforms as bitmap/canvas by clip and zoom bucket.
- Keep waveforms visible and legible in playback.
- Freeze or isolate non-critical visuals from the hot path.
- Current status: closed. The playhead imperative path, canvas/bitmap waveform cache, shell hot-path trimming and real live-capture `visualFps` validation are now in place and green for this phase.

### Block 4 - Pro recording core
- Harden `arm -> start -> stop -> finalize -> commit`.
- Use `RecordingJournalEntry` as the authoritative recovery path.
- Finish monitor router v2:
  - `mono/stereo/left/right`
  - immediate stop
  - latency compensation per track
  - cleanup on REC exit
- Current status: closed. Transactional recording, visible recovery UX, monitor router operational controls, per-track monitoring summaries and the dedicated `monitoring-runtime` gate are now in place and green for this phase.

### Block 5 - Pro editing: takes, comping and punch
- Complete:
  - take lanes
  - comp lane
  - split
  - trim
  - crossfade
  - reverse
  - consolidate
  - promote to comp
- Close `punch in/out`, `pre-roll` and `count-in`.
- Guarantee save/open/recovery roundtrip for comped projects.
- Current status: closed. The hybrid editing model is now in place with take-aware clip mutation routing, contextual audio editing in the lower panel, visible punch state in the take rail, comp rebuild safety on reopen/recover and a dedicated `block5-editing-regression` gate in PASS.

### Block 6 - Session flagship and live workflow
- Make Session a real differentiator:
  - quantized launch
  - scene replay
  - scene recording
  - undo / replay
  - 48x8 stress as baseline
- Deliver `Stage-Safe Profile` as an actual runtime behavior, not a UI label.
- Current status: closed. Quantized launch, persisted Session live-workflow state, deterministic scene replay, replay-last, per-scene recording coverage, stage-safe Session UX and the dedicated `block6-session-flagship` gate are now in place and green for this phase.

### Block 7 - Mixer, routing and automation for 1.0
- Finish:
  - groups
  - returns
  - sends pre/post
  - cue monitor (`PFL/AFL`)
  - cycle prevention
- Complete automation runtime:
  - `read`
  - `touch`
  - `latch`
  - `write`
- Keep automation playback out of React hot paths.
- Current status: closed. Groups, returns, sends pre/post, cue monitor, VCA, solo-safe, mixer snapshot recall, runtime automation modes, mixer audit visibility and the dedicated `block7-mixer-routing-automation` gate are now in place and green for this phase.

### Block 8 - Open plugin ecosystem (`VST3 + CLAP`)
- Build serious plugin hosting:
  - scan manager
  - cache
  - quarantine / blacklist
  - watchdog
  - crash containment
  - fault reporting
- Include:
  - freeze track
  - bounce in place
  - commit device chain
- Promise:
  - `Windows GA` support
  - `Linux Preview` under an explicit matrix

### Block 9 - Export, interchange and delivery
- Harden:
  - master export
  - stem export
  - WAV / AIFF / FLAC / MP3
- Add export report:
  - format
  - sample rate
  - duration
  - peak
  - loudness basics
  - parity notes
- Validate render parity between realtime and offline.

### Block 10 - Browser, MIDI and production tools
- Browser:
  - files
  - library
  - robust drag/drop
  - directory scan
  - favorites / collections
- MIDI:
  - input monitoring
  - record / capture
  - usable piano roll
  - quantize
  - scale helpers
- AI and collab stay outside the critical path unless they do not endanger the core.

### Block 11 - Platform and release discipline
- `Windows GA`
  - stable installer
  - smoke matrix
  - target audio-device matrix
- `Linux Preview`
  - package strategy
  - Wayland / Hyprland matrix
  - documented limits from day 1
- Final phase is feature freeze plus P0/P1 burn-down only.

## 4) Hard KPIs for 1.0
- `launch error p95 <= 2ms`
- `transport drift p99 <= 5ms`
- `monitor latency p95 <= 12ms` at `48k / 128`
- `1000` recording cycles with `0` take loss
- `90 min live` without critical failure
- `p95 >= 58fps` in the baseline playback scenario
- `0` visible technical error banners in normal UX

## 5) Governance
- Every major block needs:
  - clear acceptance criteria
  - test coverage
  - rollback notes
  - updated program status in `docs/data/hollow-bits-1.0-program-status.json`
- No release candidate if any required gate is red.
- Competitive benchmarking must track behavior and workflow, never copy proprietary UI, assets or code.
