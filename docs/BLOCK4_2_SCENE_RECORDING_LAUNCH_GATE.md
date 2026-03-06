# BLOCK 4.2 - Telemetria de Launch + Scene Recording + Gate

## Scope cerrado
- Telemetria de launch integrada en pipeline de Session View (`requested vs effective` por clip).
- Scene Recording manual por escenas con replay cuantizado.
- Gate tecnico de precision de launch (`p95 <= 2ms`) integrado en runtime + CI report-driven.

## Implementacion
### 1) Telemetria desde motor de audio
- `services/audioEngine.ts`
  - `launchClip(...)` ahora retorna `SessionLaunchTelemetryEvent | null`.
  - Evento incluye:
    - `requestedLaunchTimeSec`
    - `effectiveLaunchTimeSec`
    - `launchErrorMs`
    - `queuedAheadMs`
    - `wasLate`
- `services/engineAdapter.ts`
  - contrato `launchClip` tipado con retorno de telemetria.

### 2) Gate de precision de launch
- `services/sessionPerformanceService.ts`
  - `summarizeSessionLaunchTelemetry(...)`
  - `gatePass` basado en `p95LaunchErrorMs <= gateTargetMs` (default 2ms).
- `components/SessionView.tsx`
  - panel runtime `Launch Gate PASS/FAIL` con p95 y sample count.
  - persistencia local de snapshot en `localStorage` (`hollowbits.session-launch.telemetry.v1`).

### 3) Scene Recording + Replay
- `services/sessionSceneRecordingService.ts`
  - `createSceneRecordingEvent(...)`
  - `appendSceneRecordingEvent(...)`
  - `buildSceneReplayPlan(...)`
- `components/SessionView.tsx`
  - controles:
    - `REC` (toggle)
    - `REPLAY`
    - `CLR SCN`
  - replay cuantizado usando el mismo pipeline de scene launch batch.

### 4) CI gate report-driven
- `scripts/session-launch-gate.mjs`
  - valida reporte JSON en `benchmarks/session-launch/latest-report.json`.
  - falla si `p95 > target`.
- `.github/workflows/quality-gates.yml`
  - step opcional de gate + upload artifacts cuando existe reporte.

## QA agregado
- `tests/unit/sessionPerformanceService.test.ts` (incluye casos de gate PASS/FAIL).
- `tests/unit/sessionSceneRecordingService.test.ts`.

## Comandos clave
- `npm run test:session-hardening`
- `npm run test:unit`
- `npm run launch:report:baseline`
- `npm run launch:gate -- --report benchmarks/session-launch/latest-report.json --out benchmarks/session-launch/latest-gate.json`

## Protocolo de validacion real (48x8)
1. En Session View, cargar set de `48 tracks / 8 scenes`.
2. Activar `REC`, disparar escenas y luego usar `REPLAY` para repetir el flujo.
3. Exportar telemetria con `EXP JSON` (archivo `session-launch-report.json`).
4. En repo local:
   - `npm run launch:report:promote`
   - `npm run launch:gate:strict -- --report benchmarks/session-launch/latest-report.json --out benchmarks/session-launch/latest-gate.json`
5. Gate esperado:
   - `sampleCount >= 384`
   - `scenario tracks >= 48`
   - `scenario scenes >= 8`
   - `source = live-capture`
   - `p95 <= 2ms`
