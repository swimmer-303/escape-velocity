# Written with AI assistance (Claude Code). See README "Use of AI tools".
"""Turn the raw AI-generated crew roster images into small pixel-art sprite sheets.

Usage:
    python3 -I scripts/process-portraits.py <raw_dir> [out_dir]

raw_dir must hold the originals named crew-1.png, crew-2.png and crew-3.png: each one is a
grid of square portrait panels separated by thin dark borders (see ASSETS.md for the prompts).
For each crew this script:
  1. finds the dark border lines of the grid and cuts out each panel it needs, in roster order
  2. crops each panel to a square around the face and downscales it with LANCZOS to 96x96
  3. palette-quantizes all of the crew's portraits together (one shared palette, no dithering)
  4. upscales 2x with NEAREST (192x192 per portrait) and lays them out left to right
  5. bakes a legible "AI" tag (Silkscreen pixel font) into the bottom-right corner of every
     portrait, because a full "AI-generated" label is too small to read at portrait size,
     and a full-width strip reading "AI-generated" along the bottom of the sheet
  6. saves an optimized 8-bit PNG to public/art/crew-<n>.png (kept under 60 KB)

The game shows one cell of the sheet per astronaut with CSS (src/ui/crew.ts), so the "AI" tag is
on screen with every face, and the whole file carries the full "AI-generated" text.
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
FONT_DIR = os.path.join(ROOT, "node_modules", "@fontsource", "silkscreen", "files")

LOW = 96  # portrait size before the 2x pixel upscale
SCALE = 2
CELL = LOW * SCALE
COLORS = 40
MAX_BYTES = 60 * 1024

STRIP_H = 32  # bottom strip that carries the full "AI-generated" text
WM_BG = (0x0B, 0x0A, 0x18)  # same navy as the game UI and process-art.py
WM_FG = (255, 255, 255)

# crew number -> (columns, rows, panels to use in roster order). Panels count left to right,
# top to bottom. Crew 2's sixth panel was a spare and is not shipped.
SHEETS = {
    1: (2, 2, [0, 1, 2, 3]),
    2: (3, 2, [0, 1, 2, 3, 4]),
    3: (3, 2, [0, 1, 2, 3, 4, 5]),
}

ZOOM = 0.9  # keep this much of each square panel: trims the border and frames the face
Y_ANCHOR = 0.3  # where the crop sits vertically inside the panel's leftover space (0 = top)


def load_font(px):
    for name in ("silkscreen-latin-700-normal.woff", "silkscreen-latin-400-normal.woff"):
        try:
            return ImageFont.truetype(os.path.join(FONT_DIR, name), px)
        except OSError:
            continue
    try:  # no node_modules: fall back to Pillow's built-in font
        return ImageFont.load_default(size=px)
    except TypeError:
        return ImageFont.load_default()


def border_lines(img, cols, rows):
    """Positions of the dark grid lines (outer edges included), found near where an even split puts them."""
    grey = img.convert("L")
    w, h = grey.size
    px = grey.load()

    def darkest(along, length, other, expected):
        lo, hi = max(0, expected - length // 12), min(length - 1, expected + length // 12)
        best, best_score = expected, -1
        for p in range(lo, hi + 1):
            dark = 0
            for q in range(0, other, 4):
                v = px[p, q] if along == "x" else px[q, p]
                dark += v < 60
            if dark > best_score:
                best, best_score = p, dark
        return best

    xs = [0] + [darkest("x", w, h, round(w * i / cols)) for i in range(1, cols)] + [w]
    ys = [0] + [darkest("y", h, w, round(h * i / rows)) for i in range(1, rows)] + [h]
    return xs, ys


def panels(img, cols, rows):
    xs, ys = border_lines(img, cols, rows)
    out = []
    for r in range(rows):
        for c in range(cols):
            out.append((xs[c], ys[r], xs[c + 1], ys[r + 1]))
    return out


def portrait(img, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    side = round(min(w, h) * ZOOM)
    cx = x0 + (w - side) // 2
    cy = y0 + round((h - side) * Y_ANCHOR)
    return img.crop((cx, cy, cx + side, cy + side)).resize((LOW, LOW), Image.LANCZOS)


def text_box(draw, font, text):
    l, t, r, b = draw.textbbox((0, 0), text, font=font)
    return l, t, r - l, b - t


def build_sheet(src, cols, rows, use, colors):
    boxes = panels(src, cols, rows)
    faces = [portrait(src, boxes[i]) for i in use]
    n = len(faces)
    strip = Image.new("RGB", (LOW * n, LOW))
    for i, f in enumerate(faces):
        strip.paste(f, (i * LOW, 0))
    poster = strip.quantize(colors=colors, method=Image.MEDIANCUT, kmeans=3, dither=Image.NONE)
    big = poster.convert("RGB").resize((CELL * n, CELL), Image.NEAREST)

    sheet = Image.new("RGB", (CELL * n, CELL + STRIP_H), WM_BG)
    sheet.paste(big, (0, 0))
    draw = ImageDraw.Draw(sheet)

    # "AI" corner tag on every portrait: Silkscreen at 24 px is 3 screen pixels per font pixel.
    tag_font = load_font(24)
    l, t, tw, th = text_box(draw, tag_font, "AI")
    pad = 5
    for i in range(n):
        x1 = (i + 1) * CELL - 4
        y1 = CELL - 4
        x0 = x1 - tw - 2 * pad
        y0 = y1 - th - 2 * pad
        draw.rectangle((x0, y0, x1, y1), fill=WM_BG)
        draw.text((x0 + pad - l, y0 + pad - t), "AI", font=tag_font, fill=WM_FG)

    # Full label along the bottom of the sheet.
    strip_font = load_font(24)
    l, t, tw, th = text_box(draw, strip_font, "AI-generated")
    draw.text((sheet.width - tw - 10 - l, CELL + (STRIP_H - th) // 2 - t), "AI-generated", font=strip_font, fill=WM_FG)

    # Re-palettize onto the posterized colors plus navy, white and a few greys for any
    # anti-aliased text pixels. Art colors stay exact.
    flat = poster.getpalette()[: 3 * colors]
    pal = [tuple(flat[i : i + 3]) for i in range(0, len(flat), 3)]
    pal += [WM_BG, WM_FG] + [tuple(round(WM_BG[j] + (255 - WM_BG[j]) * k / 6) for j in range(3)) for k in range(1, 6)]
    pal_img = Image.new("P", (1, 1))
    pal_img.putpalette([v for c in pal for v in c] + [0] * (768 - 3 * len(pal)))
    return sheet.quantize(palette=pal_img, dither=Image.NONE), n


def process(n, path, out_dir):
    cols, rows, use = SHEETS[n]
    with Image.open(path) as im:
        src = im.convert("RGB")
    out = os.path.join(out_dir, f"crew-{n}.png")
    colors = COLORS
    while True:
        sheet, count = build_sheet(src, cols, rows, use, colors)
        sheet.save(out, optimize=True)
        nbytes = os.path.getsize(out)
        if nbytes <= MAX_BYTES or colors <= 16:
            break
        colors -= 8
    print(f"{out}  {sheet.width}x{sheet.height}  {count} portraits  {colors} colors  {nbytes // 1024} KB")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    raw_dir = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_OUT
    os.makedirs(out_dir, exist_ok=True)
    for n in sorted(SHEETS):
        path = os.path.join(raw_dir, f"crew-{n}.png")
        if not os.path.exists(path):
            sys.exit(f"missing {path}")
        process(n, path, out_dir)


if __name__ == "__main__":
    main()
