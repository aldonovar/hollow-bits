# HOLLOW BITS - QUALITY AND RELEASE GATES

## 1) Engineering Gates (Always Required)
- Type safety gate: `npm run typecheck`
- Unit reliability gate: `npm run test:unit`
- Production build gate: `npm run build`
- Desktop smoke gate: app launch + import + play + pause + record + export basic path
- CI workflow gate: `.github/workflows/quality-gates.yml` (blocking on PR)

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
- Audio reliability matrix gate (SR x Buffer): 40 casos ejecutados desde Audio Setup con reporte PASS/WARN/FAIL y restauracion de settings.
- Audio scheduler benchmark gate (A/B interval vs worklet clock): escenarios medium/high/extreme con reporte de drift p95/p99, loop p99, event-loop lag p95 y winner por escenario.
- Performance gate rules (worklet):
  - fail cases == 0
  - drift p95 <= 36ms
  - drift p99 <= 95ms
  - event-loop lag p95 <= 32ms
  - scheduler loop p99 <= 34ms
  - worklet win-rate >= 60% en pares A/B

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

## 7) Matrix Execution Protocol (SR x Buffer)
- Abrir: `Configuracion > Audio > Matriz de confiabilidad SR x Buffer`.
- Ejecutar `Run Matrix` (40 combinaciones).
- Revisar reporte:
  - PASS: contexto activo + render no silencioso + timing dentro de tolerancia.
  - WARN: fallback/mismatch o deriva no critica.
  - FAIL: contexto no running, graph invalido o render silencioso.
- Confirmar que la restauracion final del motor no haya fallado.

## 8) Release Checklist (Desktop)
- All gates green.
- Regression notes reviewed.
- Known issues triaged by severity.
- Rollback plan documented.

## 9) Benchmark Protocol (A/B Scheduler)
- Abrir: `Configuracion > Audio > Benchmark extremo A/B scheduler`.
- Ejecutar `Run Benchmark`.
- Verificar:
  - `Performance Gate` en PASS (o justificar WARN).
  - Comparativas A/B por escenario con winner consistente.
  - Sin `restoreFailed` al finalizar.
- Exportar JSON del benchmark y adjuntarlo en PR/release notes para trazabilidad.
- Ruta recomendada para CI: `benchmarks/audio-performance/latest-report.json`.
- Validar gate localmente: `npm run perf:gate -- --report benchmarks/audio-performance/latest-report.json`.
- En CI, el workflow `Quality Gates` ejecuta el gate automaticamente cuando detecta ese archivo y publica `latest-gate.json` como artifact.
