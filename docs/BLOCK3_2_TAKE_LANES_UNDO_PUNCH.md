# BLOCK 3.2 - Take Lanes UI + Undo Grouping + Punch Markers

## Scope cerrado
- Take Lanes panel operativo para pista de audio seleccionada.
- Gestos de edicion agrupados por `historyGroupId` para Undo/Redo.
- Marcadores Punch In/Out visibles en timeline con ventana sombreada.
- QA unitario extendido para crossfade, auto-stop punch multitrack y metadata de takes.

## Entregables implementados
### 1) Take Lanes panel
- Nuevo panel lateral en Arrange con:
  - seleccion activa de take
  - `A` (audition), `S` (solo take), `M` (mute take)
  - estado de Comp Lane siempre visible y activable cuando existe
- Seleccion de take sincroniza `selectedClipId` y editor.
- Audition usa `audioEngine.previewBuffer`; si el buffer no esta en memoria, se rehidrata desde `assetDb` y se cachea en el clip runtime.

### 2) Undo/Redo agrupado por gesto
- `useUndoRedo` ahora acepta `groupKey`.
- `App.applyTrackMutation` propaga `historyGroupId` a `setTracks`.
- Timeline emite `historyGroupId` por gesto (trim/fade/stretch/crossfade/drag clip), evitando fragmentacion de historial.

### 3) Punch UX final en timeline
- Timeline renderiza:
  - linea `IN`
  - linea `OUT`
  - region punch sombreada entre ambos puntos
- Rango punch normalizado en tiempo real con `normalizePunchRange` y clamps en panel/atajos.

### 4) QA de Bloque 3.2
- Nuevos tests:
  - `tests/unit/takeLaneControlService.test.ts`
  - `tests/unit/timelineCrossfadeService.test.ts`
- `tests/unit/takeCompingService.test.ts` ampliado con:
  - auto-stop punch multitrack (`shouldFinalizePunchRecording`)
  - escenario de integridad de metadata tras split+sync.

## Validacion ejecutada
- `npm run typecheck`: OK
- `npm run test:unit`: OK (62 tests)
- `npm run build`: OK
