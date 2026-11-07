"""Turn raw frames from `sim` into LED-panel-looking GIF/PNG previews.

usage: python3 render_gif.py <in.rgb> <out.gif|out.png> [fps]
"""
import sys
from PIL import Image, ImageDraw

W, H, CELL, LED = 64, 32, 10, 8   # each LED drawn as an 8px dot on a 10px pitch


def frames(path):
    data = open(path, "rb").read()
    size = W * H * 3
    for i in range(0, len(data) - size + 1, size):
        yield data[i:i + size]


def render(raw):
    img = Image.new("RGB", (W * CELL + CELL, H * CELL + CELL), (12, 10, 9))
    d = ImageDraw.Draw(img)
    off = CELL // 2 + (CELL - LED) // 2
    for y in range(H):
        for x in range(W):
            i = (y * W + x) * 3
            r, g, b = raw[i], raw[i + 1], raw[i + 2]
            if r == g == b == 0:
                r, g, b = 26, 22, 20          # unlit LED
            x0, y0 = off + x * CELL, off + y * CELL
            d.ellipse([x0, y0, x0 + LED - 1, y0 + LED - 1], fill=(r, g, b))
    return img


def main():
    src, dst = sys.argv[1], sys.argv[2]
    fps = int(sys.argv[3]) if len(sys.argv) > 3 else 25
    imgs = [render(f) for f in frames(src)]
    if dst.endswith(".png") or len(imgs) == 1:
        imgs[0].save(dst)
    else:
        imgs[0].save(dst, save_all=True, append_images=imgs[1:], duration=int(1000 / fps), loop=0, optimize=True)
    print(f"{dst}: {len(imgs)} frame(s)")


if __name__ == "__main__":
    main()
