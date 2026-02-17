# ETHEREAL STUDIO - QUALITY AND RELEASE GATES

## 1) Engineering Gates (Always Required)
- Type safety gate: `npm exec tsc --noEmit`
- Production build gate: `npm run build`
- Desktop smoke gate: app launch + import + play + pause + record + export basic path

No release candidate if any gate fails.

## 2) Test Strategy

### Unit tests
- Transport and timeline math.
- Loop state machine transitions.
- BPM/pitch conversion invariants.
- Project migration and schema validation.

### Integration tests
- Playback command sequence: play/pause/resume/seek/stop.
- Recording lifecycle: arm/start/stop/finalize clip.
- Clip edit actions: consolidate/reverse/quantize/split/duplicate.

### Golden audio regression
- Fixture projects rendered offline.
- Compare deterministic metrics:
  - duration
  - peak level
  - rms level
  - timing alignment

## 3) Performance Gates
- Long-run playback stress (target session) without critical audio failure.
- UI stress while playback active (edits + scrolling + panel toggles) without transport desync.
- Export stress with multi-track project in acceptable time budget.

## 4) Windows Desktop Compatibility Matrix
- Windows 11 (target), standard user account, normal audio device stack.
- Test matrix per release:
  - cold start
  - open existing project
  - import wav/aiff/mp3/flac
  - playback/loop/pause-resume correctness
  - recording arm and finalize
  - save/open roundtrip
  - export master + stems

## 5) Reliability and Recovery Gates
- Autosave checkpoint created on schedule and key mutations.
- Crash restore available after abnormal termination.
- Project integrity check on open (missing assets, schema mismatch).

## 6) Security and Hardening Gates
- No API secrets in renderer bundle.
- IPC bridge exposes minimum required commands only.
- Input validation for file operations and project parsing.

## 7) Release Checklist (Desktop)
- All gates green.
- Regression notes reviewed.
- Known issues triaged by severity.
- Rollback plan documented.
