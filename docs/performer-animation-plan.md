<<<<<<< HEAD
# Performer Animation Plan

## Overview
This document outlines the strategy for animating the performer character in the ETHEREAL STUDIO project, shifting from a smooth vector-like animation to a retro "frame-by-frame" pixel art style.

## Objectives
1.  **Pixel Perfect Aesthetic**: Ensure all movement snaps to the pixel grid to avoid sub-pixel blurring.
2.  **Distinct Frames**: Simulate a low frame rate (12 FPS) to mimic traditional sprite animation.
3.  **Robustness**: Handle missing image assets gracefully by falling back to programmatic animation.

## Technical Implementation

### 1. Stepped Animation Loop
Instead of updating every requestAnimationFrame (typically 60fps), we strictly quantize the time variable to 12fps (approx 83ms steps).

```typescript
const FPS = 12;
const STEP_MS = 1000 / FPS;
const time = Math.floor(realTime / STEP_MS) * STEP_MS;
```

### 2. Pixel Snapping
All translations (breathing, hair sway) use `Math.round()` to ensure the image is drawn at integer coordinates. This prevents anti-aliasing artifacts that would ruin the crisp pixel look.

```typescript
const breathOffset = Math.round(Math.sin(breathCycle) * BREATHING_AMPLITUDE);
```

### 3. Frame Cycling
The system supports an array of image sources.
- If multiple frames are loaded (`performer_frame_1.png`, `performer_frame_2.png`), the draw loop cycles through them based on the stepped time.
- If only the base image (`performer.png`) is available, it uses that static image but applies the stepped breathing/sway transformation.

## Asset Requirements
- **Format**: PNG with transparency.
- **Resolution**: 1024x1024 (or consistent aspect ratio).
- **Naming**: `performer_frame_N.png`.

## Future Work
- If image generation becomes reliable, we can replace the programmed sway with actual drew frames.
- Currently, the programmatic approach provides a high-quality fallback that respects the art style constraints.
=======
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
>>>>>>> codex-branch
