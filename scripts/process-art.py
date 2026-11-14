# Written with AI assistance (Claude Code). See README "Use of AI tools".
"""Turn raw AI-generated images into small retro game art with a baked-in watermark.

Usage:
    python3 -I scripts/process-art.py <raw_dir> [out_dir]

For every <name>.png / .jpg / .webp in raw_dir (originals are kept outside the repo):
  1. center-crop to 16:9
  2. downscale with LANCZOS to 240x135 (title: 320x180)
  3. quantize to ~40 colors (title: 64) for a posterized PS1-era look
  4. upscale 2x with NEAREST (480x270; title 640x360)
  5. bake a visible "AI-generated" watermark in the bottom-right corner
  6. save an optimized PNG to public/art/<name>.png, reducing colors if > 200 KB
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # isolated mode (-I) skips user site-packages, where PIL lives here
    import site

    sys.path.append(site.getusersitepackages())
    from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "public", "art")

MAX_BYTES = 200 * 1024
WATERMARK = "AI-generated"
WM_BG = (0x0B, 0x0A, 0x18, 191)  # #0b0a18 at ~75% alpha
WM_FG = (255, 255, 255, 255)
WM_PAD = 4

# name -> (low-res size, colors)
SPECIAL = {"title": ((320, 180), 64)}
DEFAULT = ((240, 135), 40)


def center_crop_16x9(img):
    w, h = img.size
    target = 16 / 9
    if w / h > target:
        nw = round(h * target)
        x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = round(w / target)
    y = (h - nh) // 2
    return img.crop((0, y, w, y + nh))


def load_font(px):
    try:
        return ImageFont.load_default(size=px)
    except TypeError:  # very old Pillow without size support
        return ImageFont.load_default()


def bake_watermark(img):
    """Draw white 'AI-generated' on a semi-opaque dark box in the bottom-right."""
    w, h = img.size
    font = load_font(12 if w <= 480 else 14)
    base = img.convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    l, t, r, b = draw.textbbox((0, 0), WATERMARK, font=font)
    tw, th = r - l, b - t
    margin = 4
    x1 = w - margin
    y1 = h - margin
    x0 = x1 - tw - 2 * WM_PAD
    y0 = y1 - th - 2 * WM_PAD
    draw.rectangle((x0, y0, x1, y1), fill=WM_BG)
    draw.text((x0 + WM_PAD - l, y0 + WM_PAD - t), WATERMARK, font=font, fill=WM_FG)
    return Image.alpha_composite(base, overlay).convert("RGB")


def blend(c, bg, a):
    return tuple(round(c[i] * (1 - a) + bg[i] * a) for i in range(3))


def render(src, size, colors):
    small = center_crop_16x9(src).resize(size, Image.LANCZOS)
    # Median cut + k-means refinement keeps small accent colors (greenhouse green,
    # cyan fuel stripe) that plain median cut tends to merge into the browns.
    poster = small.quantize(colors=colors, method=Image.MEDIANCUT, kmeans=3, dither=Image.NONE)
    big = poster.convert("RGB").resize((size[0] * 2, size[1] * 2), Image.NEAREST)
    marked = bake_watermark(big)
    # Re-palettize onto: the posterized colors, the same colors under the watermark
    # box, and a few greys for the anti-aliased label. Art colors stay exact.
    flat = poster.getpalette()[: 3 * colors]
    pal = [tuple(flat[i : i + 3]) for i in range(0, len(flat), 3)]
    alpha = WM_BG[3] / 255
    pal += [blend(c, WM_BG[:3], alpha) for c in pal]
    dark = blend((128, 128, 128), WM_BG[:3], alpha)
    pal += [blend(dark, (255, 255, 255), k / 7) for k in range(8)]
    pal = pal[:256]
    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette([v for c in pal for v in c] + [0] * (768 - 3 * len(pal)))
    return marked.quantize(palette=pal_img, dither=Image.NONE)


def process(path, out_dir):
    name = os.path.splitext(os.path.basename(path))[0]
    size, colors = SPECIAL.get(name, DEFAULT)
    with Image.open(path) as im:
        src = im.convert("RGB")
    out = os.path.join(out_dir, name + ".png")
    while True:
        render(src, size, colors).save(out, optimize=True)
        nbytes = os.path.getsize(out)
        if nbytes <= MAX_BYTES or colors <= 16:
            break
        colors -= 8
    print(f"{out}  {size[0] * 2}x{size[1] * 2}  {colors} colors  {nbytes // 1024} KB")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw_dir = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    files = sorted(
        f for f in os.listdir(raw_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))
    )
    if not files:
        sys.exit(f"no images found in {raw_dir}")
    for f in files:
        process(os.path.join(raw_dir, f), out_dir)


if __name__ == "__main__":
    main()
