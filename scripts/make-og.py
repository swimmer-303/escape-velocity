# Builds the 1200x630 social share card from the team logo (public/art/logo.png) plus the game's own fonts.
# Written with AI assistance (Claude Code). See README "Use of AI tools".
# Usage: python3 scripts/make-og.py . public/og.png
import sys
from PIL import Image, ImageDraw, ImageFont
root = sys.argv[1]; out = sys.argv[2]
W, H = 1200, 630
card = Image.new('RGBA', (W, H))
d = ImageDraw.Draw(card)
# The logo's own navy background with its 2-pixel scanlines (two rows normal, two rows darker).
for y in range(H):
    d.line([(0, y), (W, y)], fill=(17, 22, 51) if y % 4 < 2 else (14, 18, 41))
logo = Image.open(f'{root}/public/art/logo.png').convert('RGBA')
card.alpha_composite(logo, ((W - logo.width) // 2, 63))
body = ImageFont.truetype(f'{root}/node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff', 36)
small = ImageFont.truetype(f'{root}/node_modules/@fontsource/silkscreen/files/silkscreen-latin-400-normal.woff', 26)
def centered(y, text, font, fill, shadow=None):
    x = (W - d.textlength(text, font=font)) / 2
    if shadow:
        d.text((x + 3, y + 3), text, font=font, fill=shadow)
    d.text((x, y), text, font=font, fill=fill)
centered(516, 'Run a Mars base with real NASA space weather', body, (94, 242, 230), (8, 10, 24))
centered(570, 'playescapevelocity.com', small, (255, 236, 39))
card.convert('RGB').save(out, optimize=True)
print(card.size)
