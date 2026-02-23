from __future__ import annotations

import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


FRAME_COUNT = 144
FPS = 48
FRAME_SIZE = 384

PROJECT_ROOT = Path(__file__).resolve().parent.parent
INPUT_PATH = PROJECT_ROOT / "public" / "performer" / "performer.png"
OUTPUT_DIR = PROJECT_ROOT / "public" / "performer" / "frames"
MANIFEST_PATH = OUTPUT_DIR / "manifest.json"


def wrap_distance(a: float, b: float) -> float:
    d = abs(a - b)
    return min(d, 1.0 - d)


def smooth_pulse(t: float, center: float, width: float) -> float:
    if width <= 0:
        return 0.0
    d = wrap_distance(t, center)
    if d >= width:
        return 0.0
    x = 1.0 - (d / width)
    return x * x * (3.0 - (2.0 * x))


def wave(t: float, freq: float, phase: float = 0.0) -> float:
    return math.sin(2.0 * math.pi * ((t * freq) + phase))


def build_soft_ellipse_mask(size: tuple[int, int], cx: int, cy: int, rx: int, ry: int, blur: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255)
    if blur > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(blur))
    return mask


def transform_patch(
    source: Image.Image,
    box: tuple[int, int, int, int],
    *,
    scale_x: float = 1.0,
    scale_y: float = 1.0,
    shift_x: float = 0.0,
    shift_y: float = 0.0,
    shear_x: float = 0.0,
    shear_y: float = 0.0,
) -> Image.Image:
    patch = source.crop(box)
    width, height = patch.size

    a = scale_x
    b = shear_x
    c = -((scale_x - 1.0) * width * 0.5 + shear_x * height * 0.5) + shift_x
    d = shear_y
    e = scale_y
    f = -((scale_y - 1.0) * height * 0.5 + shear_y * width * 0.5) + shift_y

    return patch.transform(
        (width, height),
        Image.Transform.AFFINE,
        (a, b, c, d, e, f),
        resample=Image.Resampling.NEAREST,
    )


def alpha_composite_with_mask(base: Image.Image, layer: Image.Image, mask: Image.Image) -> Image.Image:
    composed = layer.copy()
    layer_alpha = composed.getchannel("A")
    composed.putalpha(ImageChops.multiply(layer_alpha, mask))
    return Image.alpha_composite(base, composed)


def create_animation_frame(base: Image.Image, frame_index: int, masks: dict[str, Image.Image]) -> Image.Image:
    width, height = base.size
    t = frame_index / FRAME_COUNT

    breath = wave(t, 1.0, -0.08)
    body_energy = 0.5 + (0.5 * wave(t, 1.0, 0.18))
    vocal_main = 0.5 + (0.5 * wave(t, 2.0, 0.13))
    vocal_fast = 0.5 + (0.5 * wave(t, 5.0, 0.51))
    mouth_open = min(1.0, (vocal_main * 0.58) + (vocal_fast * 0.42))

    blink = max(
        smooth_pulse(t, 0.18, 0.033),
        smooth_pulse(t, 0.53, 0.021),
        smooth_pulse(t, 0.83, 0.027),
    )
    blink_strength = min(1.0, blink * 1.08)

    head_sway = (wave(t, 1.0, 0.04) * 2.8) + (wave(t, 2.0, 0.33) * 0.95)
    head_bob = (wave(t, 1.0, -0.26) * 1.65) + (wave(t, 3.0, 0.44) * 0.52)
    bangs_sway = (head_sway * 1.35) + (wave(t, 4.0, 0.17) * 0.85)
    pony_sway = (head_sway * 1.78) + (wave(t, 3.0, -0.12) * 2.3) + (wave(t, 5.0, 0.31) * 0.95)

    frame = base.copy()

    head_box = (162, 96, 346, 292)
    head = transform_patch(
        base,
        head_box,
        shift_x=head_sway * 0.42,
        shift_y=head_bob * 0.55,
        shear_x=head_sway * 0.0035,
    )
    head_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    head_layer.paste(head, (head_box[0], head_box[1]))
    frame = alpha_composite_with_mask(frame, head_layer, masks["head"])

    bangs_box = (146, 76, 306, 304)
    bangs = transform_patch(
        frame,
        bangs_box,
        shift_x=bangs_sway * 0.95,
        shift_y=abs(bangs_sway) * 0.24,
        shear_x=bangs_sway * 0.011,
    )
    bangs_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    bangs_layer.paste(bangs, (bangs_box[0], bangs_box[1]))
    frame = alpha_composite_with_mask(frame, bangs_layer, masks["bangs"])

    pony_box = (0, 146, 196, 384)
    pony = transform_patch(
        frame,
        pony_box,
        shift_x=pony_sway,
        shift_y=wave(t, 1.6, 0.2) * 1.25,
        shear_y=pony_sway * 0.007,
    )
    pony_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pony_layer.paste(pony, (pony_box[0], pony_box[1]))
    frame = alpha_composite_with_mask(frame, pony_layer, masks["pony"])

    eye_box = (248, 174, 286, 201)
    eye = transform_patch(
        frame,
        eye_box,
        scale_y=max(0.24, 1.0 - (blink_strength * 0.78)),
        shift_y=blink_strength * 1.7,
    )
    eye_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    eye_layer.paste(eye, (eye_box[0], eye_box[1]))
    frame = alpha_composite_with_mask(frame, eye_layer, masks["eye"])

    eyelid_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    eyelid_draw = ImageDraw.Draw(eyelid_layer)
    lid_alpha = int(14 + (blink_strength * 188))
    lash_alpha = int(18 + (blink_strength * 212))
    lid_thickness = int(1 + (blink_strength * 4.2))
    eye_mid_y = int((eye_box[1] + eye_box[3]) * 0.5)
    eyelid_draw.rectangle(
        (
            eye_box[0] + 2,
            eye_mid_y - (lid_thickness // 2),
            eye_box[2] - 2,
            eye_mid_y + (lid_thickness // 2),
        ),
        fill=(223, 123, 224, lid_alpha),
    )
    eyelid_draw.rectangle((eye_box[0] + 3, eye_mid_y, eye_box[2] - 4, eye_mid_y), fill=(58, 39, 108, lash_alpha))
    frame = alpha_composite_with_mask(frame, eyelid_layer, masks["eye"])

    mouth_box = (252, 218, 340, 264)
    mouth = transform_patch(
        frame,
        mouth_box,
        scale_x=1.0 - (mouth_open * 0.11),
        scale_y=1.0 + (mouth_open * 0.34),
        shift_y=mouth_open * 2.0,
    )
    mouth_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mouth_layer.paste(mouth, (mouth_box[0], mouth_box[1]))
    frame = alpha_composite_with_mask(frame, mouth_layer, masks["mouth"])

    mouth_detail_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mouth_draw = ImageDraw.Draw(mouth_detail_layer)
    mouth_alpha = int(12 + (mouth_open * 154))
    mouth_y = int((mouth_box[1] + mouth_box[3]) * 0.58)
    mouth_draw.rectangle((mouth_box[0] + 9, mouth_y, mouth_box[2] - 8, mouth_y + 1), fill=(48, 27, 92, mouth_alpha))
    frame = alpha_composite_with_mask(frame, mouth_detail_layer, masks["mouth"])

    torso_box = (160, 246, 384, 384)
    inhale = max(0.0, breath)
    torso = transform_patch(
        frame,
        torso_box,
        scale_x=1.0 + (inhale * 0.011),
        scale_y=1.0 + (inhale * 0.03),
        shift_y=inhale * 1.7,
    )
    torso_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    torso_layer.paste(torso, (torso_box[0], torso_box[1]))
    frame = alpha_composite_with_mask(frame, torso_layer, masks["torso"])

    shoulder_box = (182, 262, 356, 384)
    shoulder = transform_patch(
        frame,
        shoulder_box,
        shift_x=head_sway * 0.22,
        shift_y=(inhale * 1.1) + (body_energy * 0.38),
        shear_x=head_sway * 0.0022,
    )
    shoulder_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    shoulder_layer.paste(shoulder, (shoulder_box[0], shoulder_box[1]))
    frame = alpha_composite_with_mask(frame, shoulder_layer, masks["shoulders"])

    aura_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    aura_draw = ImageDraw.Draw(aura_layer)
    aura_alpha = int(10 + ((wave(t, 2.0, 0.42) + 1.0) * 18))
    aura_draw.ellipse((236, 160, 308, 220), fill=(255, 193, 255, aura_alpha))
    frame = Image.alpha_composite(frame, aura_layer)

    tint_alpha = int(6 + ((wave(t, 2.0, 0.25) + 1.0) * 5))
    tint = Image.new("RGBA", (width, height), (238, 142, 255, tint_alpha))
    frame = Image.alpha_composite(frame, tint)

    return frame


def write_manifest(frame_files: list[str]) -> None:
    manifest = {
        "version": 3,
        "fps": FPS,
        "frameCount": len(frame_files),
        "frameWidth": FRAME_SIZE,
        "frameHeight": FRAME_SIZE,
        "style": "visuographic-lifelike-rig-v3-live",
        "frames": [f"/performer/frames/{file_name}" for file_name in frame_files],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Missing performer image at: {INPUT_PATH}")

    if OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    base = Image.open(INPUT_PATH).convert("RGBA")
    base = base.resize((FRAME_SIZE, FRAME_SIZE), Image.Resampling.NEAREST)

    masks = {
        "head": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 258, 194, 106, 118, 6),
        "bangs": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 230, 174, 94, 124, 7),
        "pony": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 92, 284, 108, 136, 8),
        "eye": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 266, 187, 18, 10, 2),
        "mouth": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 296, 240, 60, 34, 3),
        "torso": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 288, 334, 116, 80, 8),
        "shoulders": build_soft_ellipse_mask((FRAME_SIZE, FRAME_SIZE), 270, 320, 96, 58, 6),
    }

    frame_files: list[str] = []
    for frame_index in range(FRAME_COUNT):
        frame = create_animation_frame(base, frame_index, masks)
        file_name = f"performer_{frame_index:03d}.png"
        frame.save(OUTPUT_DIR / file_name, optimize=True, compress_level=6)
        frame_files.append(file_name)

    write_manifest(frame_files)
    print(f"Generated {len(frame_files)} performer frames in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
