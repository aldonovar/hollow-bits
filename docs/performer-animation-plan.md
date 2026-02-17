# Planificación de aprendizaje profundo del pixel art `performer.png`

## 1) Observación estructural del sprite base
- **Asset fuente:** `public/performer/performer.png`.
- **Objetivo visual:** mantener identidad del personaje con micro-movimiento musical sin romper lectura pixel art.
- **Principio técnico:** todo movimiento se ejecuta en enteros de píxel para evitar blur/subpíxel.

## 2) Modelo de movimiento propuesto (24 poses a 12 FPS)
- Se usa una cadencia fija de 12 FPS para preservar estética retro.
- Se sintetiza un ciclo de 24 poses (offset X/Y) a partir de funciones periódicas discretizadas.
- Esto evita bucles cortos repetitivos sin depender de 24 archivos PNG separados.

## 3) Percepción musical
- Movimiento más “vivo” en reproducción continua.
- Mantiene sensación frame-by-frame porque no hay interpolación ni suavizado.
- Sparkles continúan reforzando sensación de escenario activo.

## 4) Robustez
- Solución basada en un único asset (`performer.png`), reduciendo fricción para PR/merge.
- Canvas dimensionado al tamaño natural del sprite.

## 5) Resultado esperado
- Performer fluido con ciclo largo de 24 poses.
- Menos fricción operativa al no versionar múltiples binarios para animación base.
