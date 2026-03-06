# BLOCK 3.1 - Punch Panel + Comp Overlay + Crossfade Handles

## Objetivo
- Reducir friccion de edicion en vivo durante comping/punch sin sacrificar estabilidad.
- Exponer controles punch directamente desde transport.
- Hacer visible el estado de comp lane sobre timeline.
- Ajustar crossfades de clips solapados con un gesto unico.

## Entregado en codigo
### 1) Punch Panel avanzado (Transport)
- Panel `Punch Pro` anclado al boton `P` del bloque de transporte.
- Soporta edicion de:
  - `Punch In`
  - `Punch Out`
  - `Pre-roll`
  - `Count-in`
- Estado contextual por pista seleccionada (audio):
  - si no hay pista audio seleccionada, el panel queda en modo informativo/disabled.
- Reglas de consistencia:
  - `outBar >= inBar + 0.25`
  - `inBar >= 1`
  - `preRollBars >= 0`
  - `countInBars >= 0`
- Hotkeys expuestas en panel:
  - `Alt+P`, `Alt+I`, `Alt+O`

### 2) Overlay visual de Comp Lane (Timeline)
- Se renderizan segmentos de `compSegments` en pista activa de comp lane.
- Overlay no bloquea interaccion de clips (`pointer-events: none`).
- Cada segmento muestra:
  - delimitacion temporal real en barras
  - etiqueta de origen de toma (`takeAlias`)
- Los clips derivados de comp (`comp-seg-*` / `[COMP]`) reciben estilo diferenciado.

### 3) Crossfade handles interactivos
- En cada zona de overlap se mantiene el overlay de curva y se agrega un handle draggable.
- Drag del handle ajusta simultaneamente:
  - `fadeOut` del clip izquierdo
  - `fadeIn` del clip derecho
- Preview en tiempo real con `noHistory`.
- Commit final agrupado logico (`timeline-crossfade-adjust`).

## Validacion tecnica ejecutada
- `npm run typecheck`: OK
- `npm run test:unit`: OK
- `npm run build`: OK

## Riesgos/observaciones conocidas
- El warning de chunks grandes en build persiste (no es bloqueo de funcionalidad).
- El panel `Punch Pro` es popover (no inline permanente) para preservar ancho del transport en layouts compactos.

## Siguiente endurecimiento recomendado
- Test de integracion UI para drag de crossfade con validacion de `fadeIn/fadeOut`.
- Medicion de tiempo de respuesta del panel punch bajo carga de 48 tracks.
- Modo de snapshot visual para detectar regresiones en overlay de comp lane.
