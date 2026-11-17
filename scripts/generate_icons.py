"""Generate FACTOR PRO PWA icons (192, 512, maskable 512, apple touch).

Run with: backend\\.venv\\Scripts\\python.exe scripts\\generate_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

DARK = "#101F1B"
GREEN_DARK = "#123D32"
GREEN = "#16845B"
GREEN_LIGHT = "#E4F0E7"
MINT = "#7FD3AC"
BRASS = "#A9813C"


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def gradient_background(size: int) -> Image.Image:
    image = Image.new("RGB", (size, size), GREEN_DARK)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(size - 1, 1)
        r = int(0x10 + (0x12 - 0x10) * ratio)
        g = int(0x2F + (0x3D - 0x2F) * ratio)
        b = int(0x27 + (0x32 - 0x27) * ratio)
        draw.line([(0, y), (size, y)], fill=(r, g, b))
    # soft glow on the top-right corner
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.ellipse(
        [int(size * 0.42), int(-size * 0.35), int(size * 1.25), int(size * 0.55)],
        fill=(0x16, 0x84, 0x5B, 70),
    )
    image = Image.alpha_composite(image.convert("RGBA"), glow)
    return image


def draw_mark(image: Image.Image, scale: float = 1.0) -> Image.Image:
    size = image.size[0]
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    def s(value: float) -> int:
        return int(size * value)

    # Monogram F
    left = s(0.17)
    top = s(0.24)
    stem_w = s(0.10)
    stem_h = s(0.50)
    draw.rounded_rectangle(
        [left, top, left + stem_w, top + stem_h], radius=int(stem_w * 0.22), fill=(255, 255, 255, 255)
    )
    draw.rounded_rectangle(
        [left, top, left + s(0.26), top + s(0.095)], radius=int(s(0.02)), fill=(255, 255, 255, 255)
    )
    draw.rounded_rectangle(
        [left, top + s(0.145), left + s(0.205), top + s(0.235)],
        radius=int(s(0.02)),
        fill=(0xE4, 0xF0, 0xE7, 255),
    )

    # Ascending bars
    bar_w = s(0.058)
    gap = s(0.026)
    base_y = top + stem_h
    bars = [
        (0.605, 0.16, MINT),
        (0.695, 0.27, BRASS),
        (0.785, 0.38, GREEN),
    ]
    for left_ratio, height_ratio, color in bars:
        x0 = s(left_ratio)
        y0 = base_y - s(height_ratio)
        draw.rounded_rectangle(
            [x0, y0, x0 + bar_w, base_y], radius=int(bar_w * 0.35), fill=color
        )

    # baseline
    draw.rounded_rectangle(
        [left, base_y + s(0.045), s(0.845), base_y + s(0.058)],
        radius=int(s(0.01)),
        fill=(0xE4, 0xF0, 0xE7, 180),
    )

    if scale != 1.0:
        scaled = layer.resize((int(size * scale), int(size * scale)), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset = ((size - scaled.size[0]) // 2, (size - scaled.size[1]) // 2)
        canvas.alpha_composite(scaled, offset)
        layer = canvas

    return Image.alpha_composite(image, layer)


def save(icon: Image.Image, name: str, size: int) -> None:
    resized = icon.resize((size, size), Image.LANCZOS)
    resized.save(OUT / name, format="PNG", optimize=True)
    print(f"created {OUT / name}")


def main() -> None:
    size = 1024
    base = draw_mark(gradient_background(size))
    save(base, "icon-192.png", 192)
    save(base, "icon-512.png", 512)

    maskable_bg = Image.new("RGBA", (size, size), GREEN_DARK)
    maskable = draw_mark(maskable_bg, scale=0.72)
    save(maskable, "icon-maskable-512.png", 512)

    apple = draw_mark(gradient_background(size))
    save(apple, "apple-touch-icon.png", 180)


if __name__ == "__main__":
    main()
