"""Draws the toolbar icons: a red disc with a white H. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
out = os.path.join(os.path.dirname(__file__), "..", "public", "icon")
os.makedirs(out, exist_ok=True)
for size in (16, 32, 48, 96, 128):
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = round(s * 0.04)
    d.ellipse((pad, pad, s - pad, s - pad), fill=(230, 0, 35, 255))
    font = ImageFont.truetype(FONT, round(s * 0.56))
    box = d.textbbox((0, 0), "H", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), "H", font=font, fill=(255, 255, 255, 255))
    img.resize((size, size), Image.LANCZOS).save(os.path.join(out, f"{size}.png"))
print("icons written to", os.path.abspath(out))
