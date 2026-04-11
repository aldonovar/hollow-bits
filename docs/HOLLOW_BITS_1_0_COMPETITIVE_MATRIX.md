# HOLLOW BITS 1.0 - COMPETITIVE MATRIX

## Method
- This matrix is a legal product benchmark, not a code or UI clone exercise.
- We compare:
  - user-facing behavior
  - workflow speed
  - failure handling
  - live reliability
  - recovery quality
- We do not copy proprietary assets, code or interface layouts.

## Classification
- `Parity Required` = must be credible in Public 1.0
- `Differentiator` = must be strong enough to justify choosing Hollow Bits
- `Post-1.0` = valuable, but not allowed to break the release

| Subsystem | Ableton / Logic baseline | Hollow Bits 1.0 target | Class | Repo anchors |
| --- | --- | --- | --- | --- |
| Transport | Stable play, pause, stop, seek, loop, end rules | Single playback session, deterministic authority, no duplicate audio, exact resume, explicit transport gate plus live runtime smoke in CI | Parity Required | `services/audioEngine.ts`, `services/engineAdapter.ts`, `services/transportStateService.ts` |
| Audio health / UX signaling | Technical audio issues are mostly internal, not user-facing alarms | Hidden-by-default diagnostics, recent-truth incident windows, one global health decision for shell and Session | Differentiator | `services/sessionPerformanceService.ts`, `services/diagnosticsVisibilityService.ts`, `App.tsx` |
| Arrange timeline | Smooth playhead, editable clips, zoom, playback continuity | 60fps-feel hot path, cached waveforms, legible playback visuals, clean scrolling, plus a real live-capture `visualFps` gate instead of synthetic UI telemetry | Parity Required | `components/Timeline.tsx`, `services/transportClockStore.ts`, `services/liveCaptureHarnessService.ts` |
| Session / launch | Ableton-grade launch workflow, scenes, quantization | 48x8 reliable launch, persisted quantize workflow, deterministic replay/replay-last, scene recording, stage-safe behavior plus dedicated block gate | Differentiator | `components/SessionView.tsx`, `services/sessionSceneRecordingService.ts`, `services/liveCaptureHarnessService.ts`, `scripts/block6-session-gate.mjs` |
| Recording | Robust take capture, safe stop/finalize, monitoring | Transactional recording, journaled recovery, no silent take loss | Differentiator | `services/recordingJournalService.ts`, `services/recordingReliabilityService.ts`, `services/audioEngine.ts` |
| Monitoring | Low-latency input, channel handling, punch behavior | `mono/stereo/left/right`, immediate stop, per-track latency compensation | Parity Required | `services/audioEngine.ts`, `types.ts` |
| Take lanes / comping | Logic-level take handling, comp edits, comp lane rebuild | Non-destructive take lanes, comp lane integrity, reopen/recover-safe comp rebuild | Differentiator | `services/takeCompingService.ts`, `services/takeLaneControlService.ts`, `components/TakeLanesPanel.tsx` |
| Punch / edit audio | Split, trim, reverse, consolidate, crossfade | Sample-accurate punch/edit flow on renderable audio clips plus dedicated regression gating for takes/comp/punch | Parity Required | `services/timelineCrossfadeService.ts`, `tests/unit/block5EditingRegression.test.ts`, `components/Editor.tsx` |
| Mixer / routing | Groups, returns, sends, cueing, automation | Stable routing with groups, returns, sends pre/post, cue monitor, no cycles, plus live mixer audit visibility for routing state | Parity Required | `components/Mixer.tsx`, `services/audioEngine.ts`, `services/mixerAuditService.ts`, `types.ts` |
| Automation | Read/write/touch/latch, visible lanes, parameter control | Runtime automation applied outside React hot path, core params stable in large sessions, mixer automation contract covered by dedicated regression gate | Parity Required | `services/automationService.ts`, `services/mixerAuditService.ts`, `types.ts`, `App.tsx`, `scripts/block7-mixer-gate.mjs` |
| Export | Master/stems, multiple formats, delivery-ready output | WAV/AIFF/FLAC/MP3, parity-minded export, reportable output metadata | Parity Required | `services/stemExporter.ts`, `components/ExportModal.tsx`, `services/audioTranscodeService.ts` |
| Recovery / integrity | Autosave and reopen reliability vary by host | Superior project integrity, autosave, crash recovery and repair summary | Differentiator | `services/projectIntegrityService.ts`, `services/projectRecoveryService.ts` |
| Browser / import | Mature browsing, import, drag/drop | Fast import flow, directory scan, drag/drop reliability, enough browser depth for 1.0 | Parity Required | `components/Browser.tsx`, `services/browserDragService.ts`, `types.ts` |
| MIDI / instrument flow | Deep MIDI and instrument ecosystem | Solid MIDI core for 1.0: input, record, piano roll, quantize, scale helpers | Parity Required | `services/MidiService.ts`, `services/proPianoEngine.ts`, `components/Editor.tsx` |
| Plugin ecosystem | Logic AU, Ableton VST3-heavy host behavior | Open modern host with `VST3 + CLAP`, scan manager, quarantine, watchdog, freeze/bounce | Differentiator | `components/PluginWrapper.tsx`, `components/VSTDeviceView.tsx` |
| Platform quality | Mature desktop release quality | Windows GA polish plus Linux Preview discipline, especially Wayland/Hyprland | Differentiator | `electron/main.cjs`, `.github/workflows/quality-gates.yml`, `package.json` |
| AI / collab | Limited or separate ecosystem workflows | Useful only if safe; not allowed to endanger core 1.0 | Post-1.0 unless cost is near zero | `components/AISidebar.tsx`, `components/CollabPanel.tsx`, `services/collabSessionService.ts`, `services/geminiService.ts` |

## What "better than" means for 1.0
- Not more features at any cost.
- Better means:
  - fewer ambiguous states
  - stronger recovery
  - safer live behavior
  - less visible technical noise
  - faster workflow between Arrange and Session

## 1.0 hard focus
- Win publicly on:
  - `Live reliability`
  - `Recording + Recovery`
  - `Arrange + Session` workflow speed
- Reach credibility on:
  - transport
  - editing
  - routing
  - automation
  - export
  - plugins
- Delay anything that threatens release confidence.
