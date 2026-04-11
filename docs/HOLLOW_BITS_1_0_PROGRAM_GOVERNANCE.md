# HOLLOW BITS 1.0 - PROGRAM GOVERNANCE

## Purpose
Block 0 closes when Hollow Bits has a stable engineering program, not just isolated features.
This document defines the release governance that turns the 1.0 roadmap into an executable contract.

## 1) What "superiority" means for Public 1.0
Hollow Bits 1.0 is not trying to beat Ableton Live or Logic Pro by raw feature count.
For 1.0, "better than" means:

- fewer ambiguous transport states
- stronger recording safety and recovery
- safer live operation under stress
- less visible technical noise in normal UX
- faster hybrid workflow between Arrange and Session
- a more modern plugin posture on Windows GA plus Linux Preview discipline

If a feature does not advance one of those outcomes, it is not a 1.0 priority.

## 2) Architecture freeze
The following decisions are frozen for 1.0:

- stack remains `React + Electron + TypeScript`
- the engine is the single source of truth for:
  - transport
  - runtime audio health
  - playback automation application
  - monitoring state
- the renderer only consumes snapshots and commands; it never becomes a parallel authority
- diagnostics remain hidden by default in end-user UX
- no new subsystem can merge if it weakens:
  - transport
  - renderer fluency
  - recording safety
  - release gates

## 3) Priority model
The 1.0 backlog is governed by `P0/P1/P2/P3`.

- `P0`: can break release trust immediately
- `P1`: must land for a credible public 1.0
- `P2`: should land if it does not threaten P0/P1 closure
- `P3`: polish or post-core work that must never block the release

Source of truth:
- `docs/data/hollow-bits-1.0-priority-backlog.json`

## 4) Release discipline
Every release-blocking subsystem must have:

- acceptance criteria
- test or gate coverage
- rollback notes
- updated status in `docs/data/hollow-bits-1.0-program-status.json`

No release candidate can be cut if any required gate is red.

## 5) Platform policy
- `Windows 11 x64 GA` is the primary supported release platform.
- `Linux Preview` is intentionally narrower:
  - Wayland / Hyprland focus
  - PipeWire / JACK / ALSA documented
  - explicit support matrix
- `macOS` is out of scope for 1.0 unless it does not threaten the release plan.

## 6) Plugin policy
- Official 1.0 plugin formats:
  - `VST3`
  - `CLAP`
- No compatibility promise beyond those formats in 1.0.
- Plugin openness is valuable only if it preserves session safety and fault containment.

## 7) Competitive benchmarking policy
Benchmarking against Ableton Live and Logic Pro is allowed only as:

- workflow comparison
- behavior comparison
- performance comparison
- failure handling comparison

It is never:

- UI cloning
- asset copying
- code copying
- proprietary implementation imitation

## 8) Exit criteria for Block 0
Block 0 is closed only when all of the following exist:

- roadmap 1.0 documented
- competitive matrix documented
- release gates documented
- priority backlog documented
- superiority definition documented
- live program status documented
- readiness report automated

Those deliverables now exist in:

- `docs/MASTER_ROADMAP_DAW.md`
- `docs/HOLLOW_BITS_1_0_COMPETITIVE_MATRIX.md`
- `docs/QUALITY_AND_RELEASE_GATES.md`
- `docs/HOLLOW_BITS_1_0_PROGRAM_GOVERNANCE.md`
- `docs/data/hollow-bits-1.0-priority-backlog.json`
- `docs/data/hollow-bits-1.0-program-status.json`
- `benchmarks/release-readiness/latest-report.json`
