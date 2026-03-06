# BLOCK 4.1 - Session View Hardening (48 Tracks x 8 Scenes)

## Objetivo
Iniciar Bloque 4 con base solida para live performance extremo:
- Session View estable para 48 tracks / 8 scenes.
- Modo anti-overload con prioridad `audio > UI`.
- Reduccion de costo de render y de bursts de estado en lanzamientos de escena.

## Implementacion
### Servicio de performance de session
- `services/sessionPerformanceService.ts`
- Capacidades:
  - `assessSessionOverload(...)`
    - clasifica `normal | guarded | critical`.
    - define degradacion UI (animaciones, debounce, virtualizacion).
  - `buildSessionTrackWindow(...)`
    - calcula ventana visible de columnas y spacers para virtualizacion horizontal.
  - `computeLaunchTimingErrorMs(...)`
    - utilidad para metrica de precision de launch.

### Session View endurecida
- `components/SessionView.tsx`
- Cambios principales:
  - virtualizacion horizontal de columnas de tracks,
  - batching de scene launch (una mutacion de estado para queued y una para playing),
  - stop-all batch para reducir churn de re-renders,
  - modo anti-overload con banner operativo y degradacion visual controlada.

### Integracion en App
- `App.tsx`
  - Session View recibe `engineStats` para decisiones de degradacion runtime.

## QA agregado
- `tests/unit/sessionPerformanceService.test.ts`
- Script dedicado:
  - `npm run test:session-hardening`

## Gates esperados
- `npm run typecheck`
- `npm run test:session-hardening`
- `npm run test:unit`
- `npm run build`

