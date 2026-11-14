# Builds the 1200x630 social share card from the title art (pixel-doubled) plus the game's own fonts.
# Written with AI assistance (Claude Code). See README "Use of AI tools".
# Usage: python3 scripts/make-og.py . public/og.png
import sys
from PIL import Image, ImageDraw, ImageFont
root = sys.argv[1]; out = sys.argv[2]
art = Image.open(f'{root}/public/art/title.png').convert('RGB')
big = art.resize((1280, 720), Image.NEAREST)
card = big.crop((40, 60, 1240, 690))  # keep the base and rocket, trim a little sky
d = ImageDraw.Draw(card)
title = ImageFont.truetype(f'{root}/node_modules/@fontsource/silkscreen/files/silkscreen-latin-700-normal.woff', 84)
body = ImageFont.truetype(f'{root}/node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff', 34)
def shadowed(xy, text, font, fill):
    x, y = xy
    for dx, dy in ((4, 4), (3, 3)):
        d.text((x + dx, y + dy), text, font=font, fill=(21, 18, 43))
    d.text((x, y), text, font=font, fill=fill)
tw = d.textlength('ESCAPE VELOCITY', font=title)
shadowed(((1200 - tw) / 2, 34), 'ESCAPE VELOCITY', title, (255, 241, 214))
sub = 'Run a Mars base with real NASA space weather'
sw = d.textlength(sub, font=body)
shadowed(((1200 - sw) / 2, 140), sub, body, (94, 242, 230))
card.save(out, optimize=True)
print(card.size)
