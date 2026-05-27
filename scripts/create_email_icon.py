"""Create a transparent-background email icon: purple ring, sprocket dots, purple play button."""
from PIL import Image, ImageDraw
import math

SIZE = 512
CENTER = SIZE // 2
RING_RADIUS = int(SIZE * 0.44)
RING_WIDTH = int(SIZE * 0.065)
DOT_RADIUS = int(SIZE * 0.042)
PURPLE = (168, 85, 247)

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

outer = RING_RADIUS + RING_WIDTH // 2
inner = RING_RADIUS - RING_WIDTH // 2
draw.ellipse([CENTER - outer, CENTER - outer, CENTER + outer, CENTER + outer], fill=PURPLE)
draw.ellipse([CENTER - inner, CENTER - inner, CENTER + inner, CENTER + inner], fill=(0, 0, 0, 0))

for angle in [0, 90, 180, 270]:
    rad = math.radians(angle)
    dx = int(RING_RADIUS * math.cos(rad))
    dy = int(RING_RADIUS * math.sin(rad))
    cx, cy = CENTER + dx, CENTER - dy
    draw.ellipse([cx - DOT_RADIUS, cy - DOT_RADIUS, cx + DOT_RADIUS, cy + DOT_RADIUS], fill=PURPLE)

tri_left = int(SIZE * 0.39)
tri_right = int(SIZE * 0.67)
tri_top = int(SIZE * 0.30)
tri_bottom = int(SIZE * 0.70)
draw.polygon([(tri_left, tri_top), (tri_left, tri_bottom), (tri_right, CENTER)], fill=PURPLE)

img = img.resize((128, 128), Image.LANCZOS)
from pathlib import Path
out = Path(__file__).parent.parent / "src" / "frontend" / "public" / "icon-email.png"
img.save(out)
print(f"Created {out} (128x128, transparent bg, purple play button)")
