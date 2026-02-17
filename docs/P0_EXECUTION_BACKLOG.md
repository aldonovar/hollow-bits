# ETHEREAL STUDIO - P0 EXECUTION BACKLOG (FOUNDATION)

## Scope
P0 = bloquear inestabilidad del core y convertir funciones visibles en funcionalidades realmente confiables.

## Epic P0-1: Deterministic Transport Core

### P0-1.1 Transport authority in engine
- Goal: engine define el estado real de tiempo/reproduccion; UI solo refleja snapshots.
- Deliverables:
  - transport snapshot contract (time, bar, beat, sixteenth, play state)
  - single source-of-truth update pipeline
- Acceptance:
  - no desync visible between playhead and transport numbers in 30 min run

### P0-1.2 Pause/Resume/Seek hardening
- Goal: pausa y despausa exacta en edge cases (rapid clicks, loop boundaries, end-of-song).
- Deliverables:
  - guard rails for duplicate commands
  - deterministic seek/stop transitions
- Acceptance:
  - 100 repeated pause/resume cycles without restart bug

### P0-1.3 Loop state machine finalization
- Goal: off/once/infinite como state machine formal, sin estados intermedios invalidos.
- Deliverables:
  - loop state transition tests
  - automatic deactivation rules for once mode
- Acceptance:
  - loop once executes one repeat and turns off consistently

## Epic P0-2: Functional Completeness for Exposed UI Actions

### P0-2.1 Clip context actions (currently surfaced)
- Goal: eliminar no-op en consolidate/reverse/quantize/split/duplicate.
- Deliverables:
  - functional handlers wired from Timeline to App and engine utils
  - undo/redo integration for each action
- Acceptance:
  - every visible menu action mutates project correctly and is undoable

### P0-2.2 Editor correctness baseline
- Goal: editing operations no longer tied only to first clip edge case.
- Deliverables:
  - selected clip routing contract
  - robust note and clip mutation path
- Acceptance:
  - edits affect selected clip deterministically across tracks

## Epic P0-3: Recording and Data Integrity

### P0-3.1 Recording finalize robustness
- Goal: no lost takes on transport transitions.
- Deliverables:
  - finalize-on-stop/start/end-safe path
  - partial-failure handling per track
- Acceptance:
  - no silent data loss in multi-track arm scenarios

### P0-3.2 Project safety and recovery
- Goal: autosave and crash restore for production trust.
- Deliverables:
  - rolling autosave snapshots
  - restore prompt on relaunch after abnormal close
- Acceptance:
  - project can be restored after forced app kill

## Epic P0-4: Testing and Quality Gates

### P0-4.1 Test harness bootstrap
- Goal: establish baseline unit/integration tests.
- Deliverables:
  - transport math unit tests
  - command/state transition tests
  - critical flow integration tests
- Acceptance:
  - tests run in CI and block merges on failure

### P0-4.2 Golden audio regression v1
- Goal: verify render output consistency for known fixtures.
- Deliverables:
  - fixture projects
  - waveform metrics (peak/rms/length/timing)
- Acceptance:
  - regressions detected automatically on PR

## Suggested Iteration Plan (6 Weeks)

### Week 1
- P0-1.1 + P0-1.2 design and implementation draft
- test scaffolding skeleton

### Week 2
- P0-1.2 completion + P0-1.3 full state machine
- transport regression tests

### Week 3
- P0-2.1 clip actions implementation
- undo/redo compatibility

### Week 4
- P0-2.2 editor correctness + P0-3.1 recording finalize hardening

### Week 5
- P0-3.2 autosave/recovery implementation
- manual desktop verification matrix

### Week 6
- P0-4.1 + P0-4.2 quality gates
- release candidate hardening and bug burn-down

## Definition of Done for P0
- All P0 epics completed.
- Zero known critical transport/recording defects.
- Mandatory tests and desktop smoke checks green.
- P1 work allowed only after P0 gates pass.
