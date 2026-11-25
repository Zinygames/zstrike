#!/usr/bin/env python3
"""Generate ZStrike PWA icons.

Usage:
  python3 tools/make-icons.py                 # original generated logo (default)
  python3 tools/make-icons.py cover.png [cx cy] # square crop of a cover image, centred on (cx, cy)
                                                # (pixel coords of the 'ZStrike' title; default = image centre)
Writes icons/icon-192.png, icons/icon-512.png, icons/icon-maskable-512.png, icons/apple-touch-icon.png (180).
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
BG, CYAN, VIOLET = (12, 6, 28), (63, 227, 255), (153, 69, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

def generated(size=1024):
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    # diagonal purple gradient + pixel grid floor
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=(int(12 + 40 * t), int(6 + 8 * t), int(28 + 70 * t)))
    for i in range(0, size, size // 16):
        d.line([(i, int(size * .72)), (size // 2 + (i - size // 2) * 3, size)], fill=(40, 90, 120), width=3)
    d.line([(0, int(size * .72)), (size, int(size * .72))], fill=CYAN, width=4)
    # glowing Z
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    fz = ImageFont.truetype(FONT, int(size * .62))
    box = g.textbbox((0, 0), 'Z', font=fz); w, h = box[2] - box[0], box[3] - box[1]
    pos = ((size - w) // 2 - box[0], int(size * .40) - h // 2 - box[1])
    g.text(pos, 'Z', font=fz, fill=CYAN + (255,))
    halo = glow.filter(ImageFilter.GaussianBlur(size // 40))
    im.paste(Image.new('RGB', (size, size), VIOLET), (0, 0), halo.split()[3].point(lambda a: int(a * .9)))
    im.paste(glow, (0, 0), glow)
    fs = ImageFont.truetype(FONT, int(size * .13))
    t = 'STRIKE'; b = d.textbbox((0, 0), t, font=fs)
    d.text(((size - (b[2] - b[0])) // 2 - b[0], int(size * .76)), t, font=fs, fill=(255, 255, 255))
    return im

def cover(path, cx=None, cy=None):
    src = Image.open(path).convert('RGB'); W, H = src.size
    s = min(W, H); cx = W // 2 if cx is None else int(cx); cy = H // 2 if cy is None else int(cy)
    x0 = max(0, min(W - s, cx - s // 2)); y0 = max(0, min(H - s, cy - s // 2))
    return src.crop((x0, y0, x0 + s, y0 + s))

def main():
    base = cover(sys.argv[1], *(sys.argv[2:4] or [None, None])) if len(sys.argv) > 1 else generated()
    os.makedirs(OUT, exist_ok=True)
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        base.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    # maskable: content inside the 80% safe zone on a solid background
    m = Image.new('RGB', (512, 512), BG); m.paste(base.resize((410, 410), Image.LANCZOS), (51, 51))
    m.save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    print('icons written to', os.path.abspath(OUT))

if __name__ == '__main__':
    main()
