# HOLLOW BITS - MASTER ROADMAP (PRO EXECUTION)

## 1) North Star
- Objetivo: construir un DAW desktop-first (Windows) con flujo ultra rapido, audio estable y herramientas inteligentes que compitan y superen casos de uso clave de Ableton Live y Logic Pro.
- Estrategia: no copiar todo al mismo tiempo; ganar primero en estabilidad + velocidad de trabajo + funciones diferenciales AI/colaboracion.

## 2) Product Pillars
- Pillar A - Engine Reliability: transporte determinista, playback/export coherente, cero sorpresas en sesiones largas.
- Pillar B - Pro Workflow: menos clicks para tareas diarias (edicion, mezcla, export, buses, shortcuts).
- Pillar C - Creative Power: session workflow, modulation, macro control, automation avanzada.
- Pillar D - Intelligence: AI accionable (aplica cambios reales, no solo recomendaciones de texto).
- Pillar E - Windows Native Quality: rendimiento estable, recuperacion de fallos, release robusto.

## 3) Competitive Target Model
- Phase 1 (Parity Core): transporte, timeline, grabacion, mezcla y export 100% confiables.
- Phase 2 (Parity Pro): automation completa, buses/sends avanzados, session launching profesional.
- Phase 3 (Differentiation): AI co-producer, colaboracion en tiempo real, workflows asistidos contextuales.

## 4) Capability Matrix (Current -> Target)
- Transporte: parcial -> determinista completo (loop modes, seek, resume exacto, end rules).
- Audio editing: parcial -> consolidar/reverse/split/duplicate/quantize funcional real.
- MIDI pipeline: basico UI -> scheduler, record, playback, internal instruments, quantize avanzado.
- Mixer/routing: parcial -> buses/grupos/sidechain/sends pre-post + PDC.
- Devices/plugins: UI parcial -> chain real + host estable + sandbox.
- Automation: UI parcial -> read/write/latch/touch + parity offline render.
- Session view: demo -> launch quantization/scenes/follow actions/record.
- Export: wav robusto -> multiformato real + loudness + report tecnico.
- Project safety: parcial -> autosave, crash recovery, migration, integrity check.
- QA/CI: minimo -> quality gates obligatorios + golden audio regression.

## 5) 12-Month Roadmap

### Q1 - Foundation and Determinism (P0)
- Audio engine hardening: scheduler deterministic, transport truth in engine, drift guards.
- Clip operations fully wired: consolidate, reverse, quantize, split, duplicate.
- Recording hardening: reliable arm workflow, stop/finalize resilience, clip integrity.
- Project reliability: autosave + crash recovery + project integrity checks.
- Testing baseline: unit + integration + first golden-audio fixtures.

Exit criteria:
- No transport regressions in stress scenarios.
- Playback/pause/resume/seek deterministic under heavy UI interaction.
- 0 critical failures in open/import/play/record/export smoke matrix.

### Q2 - Pro Production Depth (P1)
- MIDI audible engine (note scheduler + internal synth path + instrument rack v1).
- Automation runtime (volume/pan/device params) + write modes.
- Routing v1: buses, returns, sends pre/post, track groups.
- Export parity: realtime vs offline match within tolerance.

Exit criteria:
- Full song production possible with native tools only.
- Automation and routing stable in 50+ track stress project.

### Q3 - Performance and Session Workflow (P1/P2)
- Session View v2: quantized launch, scenes, follow actions, scene recording.
- Freeze / Bounce In Place, CPU budget panel, overload fallback strategy.
- Advanced editor tooling: multi-select transforms, groove pool, humanize.

Exit criteria:
- Live-performance workflow stable and low-friction.
- CPU stays controlled in heavy set playback and scene switching.

### Q4 - Differentiation Layer (P2)
- Collaboration MVP: shared projects, presence, conflict-safe edits.
- AI Action Engine: mix fix, arrangement suggestions, one-click corrective operations.
- Desktop release hardening: signed builds, staged rollout, telemetry + rollback path.

Exit criteria:
- Clear differentiated workflows not available as integrated end-to-end flow in competitor defaults.

## 6) Non-Functional Targets (Hard KPIs)
- Transport determinism: no audible jump on pause/resume cycles.
- Export parity: realtime vs offline null test residual within defined tolerance.
- Stability: 60 min stress run without critical engine fault.
- Startup: desktop cold launch under target budget.
- Recovery: autosave restore under target time after forced close.

## 7) Governance
- Every feature must include: acceptance criteria + tests + rollback notes.
- No new major feature if core reliability gates are red.
- All desktop releases pass Windows smoke matrix before tagging.
