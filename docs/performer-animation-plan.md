# Planificación del performer (estado estable)

## Objetivo actual
- Mantener el performer con la imagen original `public/performer/performer.png`.
- Preservar únicamente los efectos ligeros ya validados: iluminación/aurora visual, respiración y sparkles.
- Priorizar estabilidad de reproducción de audio y fluidez general de la interfaz.

## Implementación vigente
- Render sobre canvas con un único sprite base.
- Cuantización a 12 FPS para conservar estética pixel art.
- `imageSmoothingEnabled = false` para evitar blur.
- Micro-desplazamientos de respiración y sway durante `isPlaying`.

## Decisión operativa
- Se descartan por ahora secuencias multi-frame para evitar sobrecarga visual y fricción operativa.
- El foco queda en performance del DAW y audio confiable al reproducir.
