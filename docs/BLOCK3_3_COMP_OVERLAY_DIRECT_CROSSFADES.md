# BLOCK 3.3 - Comp Overlay Boundaries + Direct Comp Crossfades

## Scope cerrado
- Overlay visual de Comp Lane reforzado con estado operativo (`ACTIVE` / `STAGED`), limites de segmento y tags de take.
- Nuevo gesto directo de blend/crossfade entre fronteras de segmentos comp (sin depender de overlap de clips normales).
- Logica de overlays y frontera extraida a servicio puro para trazabilidad y test unitario.

## Entregables implementados
### 1) Modelo de overlay desacoplado y testeable
- Nuevo servicio: `services/compLaneOverlayService.ts`
- Contrato principal:
  - `buildCompLaneOverlayModel({ track, zoom, viewportLeftPx, viewportWidthPx, viewportPaddingPx })`
- Salidas:
  - `visibleSegments`: geometria de segmentos visibles para render eficiente.
  - `boundaryHandles`: puntos de blend entre segmentos consecutivos con:
    - clip ids derivados (izq/der),
    - fade maximo permitido por longitud de segmentos,
    - fade actual y metrica de overlay.

### 2) Timeline con UX de comp lane avanzada
- `components/Timeline.tsx` integra `buildCompLaneOverlayModel`.
- Overlay Comp Lane ahora muestra:
  - badge de estado de lane,
  - boundaries verticales por segmento,
  - estado de take mute.
- Se agrega capa dedicada de handles `comp-boundary-crossfade`:
  - preview en tiempo real (`noHistory`) para izquierda/derecha,
  - finalize atomico con `historyGroupId` para Undo limpio de un gesto.

### 3) Matematica de fades para frontera comp
- `services/timelineCrossfadeService.ts` agrega:
  - `resolveCompBoundaryFadePreviewBars`
  - `resolveCompBoundaryFadeCommitBars`
- Garantias:
  - clamp estricto `0..maxFadeBars`,
  - sin sobrepasar longitud util de segmentos adyacentes.

### 4) Evitar duplicidad visual
- Overlay de crossfade automatico general ahora omite pares donde ambos clips son `comp-derived`.
- Resultado: UI sin doble handle para el mismo punto de transicion comp.

## QA agregado
- Nuevo test: `tests/unit/compLaneOverlayService.test.ts`
  - construccion de overlays visibles + alias de take.
  - clamp de fade boundary y links a comp clips.
  - exclusion de boundary handles si faltan clips derivados.
- `tests/unit/timelineCrossfadeService.test.ts` ampliado con casos de comp boundary.

## Validacion esperada
- `npm run typecheck`
- `npm run test:unit`
- `npm run build`

