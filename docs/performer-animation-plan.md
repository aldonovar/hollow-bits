# Planificacion del performer (estado estable)

## Objetivo actual
- Mantener el performer con la imagen base `public/performer/performer.png`.
- Preservar los efectos ligeros ya validados: respiracion, aura visual y sparkles.
- Priorizar estabilidad de audio y fluidez general de interfaz en HOLLOW BITS.

## Implementacion vigente
- Render sobre canvas con un unico sprite base.
- Cuantizacion a 12 FPS para conservar estetica pixel art.
- `imageSmoothingEnabled = false` para evitar blur.
- Micro-desplazamientos de respiracion y sway durante `isPlaying`.

## Decision operativa
- Se descartan por ahora secuencias multi-frame para evitar sobrecarga visual.
- El foco se mantiene en performance del DAW y reproduccion confiable.
