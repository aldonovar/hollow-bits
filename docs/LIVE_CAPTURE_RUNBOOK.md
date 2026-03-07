# Live Capture 48x8 Runbook

## Objetivo
Generar evidencia `live-capture` real para gates estrictos:
- `benchmarks/session-launch/latest-report.json`
- `benchmarks/stress-48x8/latest-report.json`
- `benchmarks/audio-priority/latest-transitions.json`

## Ejecucion local (Windows)
1. Instalar dependencias:
```bash
npm ci
```
2. Ejecutar paquete completo:
```bash
npm run quality:live-strict
```
3. Ejecutar solo captura:
```bash
npm run capture:live:48x8
```

## Flujo tecnico
- `capture:live:48x8` levanta Electron con flag `--benchmark-live-48x8`.
- Main envia config al renderer por IPC (`benchmark-start`).
- Renderer ejecuta `LiveCaptureHarness` y publica artefactos por IPC:
  - `session-launch`
  - `stress-48x8`
  - `audio-priority-transitions`
- Main valida whitelist de rutas bajo `benchmarks/` y escribe JSON.
- Renderer publica estado `running/success/fail`.
- Main emite `BENCHMARK_STATUS:<json>` y cierra Electron.

## Troubleshooting
- **Timeout de captura**
  - Reintentar con timeout mayor:
  ```bash
  npm run capture:live:48x8 -- --timeout-ms 900000
  ```
- **No se generan artefactos**
  - Verificar que Electron arrancó con `--benchmark-live-48x8`.
  - Revisar logs `BENCHMARK_STATUS` en consola.
- **Gate strict falla por `source=simulated`**
  - Confirmar que los reportes fueron reescritos por captura live actual.
  - Validar `scenario.source` en ambos reportes (`session-launch` y `stress-48x8`).
