#!/usr/bin/env python3
"""Generate Quartet's app icon (1024x1024 PNG).

Run: python3 generate-icon.py
Produces: icon.png in the same directory.
Requires: Pillow (pip install Pillow)
"""
from PIL import Image, ImageDraw
from pathlib import Path

SIZE = 1024
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

corner = int(SIZE * 0.225)
bg_color = (26, 26, 31, 255)
draw.rounded_rectangle([(0, 0), (SIZE, SIZE)], radius=corner, fill=bg_color)

margin = int(SIZE * 0.15)
gap = int(SIZE * 0.025)
outer_x1 = margin
outer_x2 = SIZE - margin
outer_y1 = margin
outer_y2 = SIZE - margin
mid_x = SIZE // 2
mid_y = SIZE // 2

panes = [
    (outer_x1, outer_y1, mid_x - gap // 2, mid_y - gap // 2, (59, 130, 246, 255), True),
    (mid_x + gap // 2, outer_y1, outer_x2, mid_y - gap // 2, (248, 248, 248, 255), False),
    (outer_x1, mid_y + gap // 2, mid_x - gap // 2, outer_y2, (248, 248, 248, 255), False),
    (mid_x + gap // 2, mid_y + gap // 2, outer_x2, outer_y2, (139, 92, 246, 255), True),
]

pane_radius = int(SIZE * 0.04)
for x1, y1, x2, y2, color, is_dark in panes:
    draw.rounded_rectangle([(x1, y1), (x2, y2)], radius=pane_radius, fill=color)
    toolbar_h = int(SIZE * 0.05)
    if is_dark:
        toolbar_color = (43, 99, 200, 255) if color[0] == 59 else (109, 70, 216, 255)
    else:
        toolbar_color = (230, 230, 230, 255)
    draw.rounded_rectangle([(x1, y1), (x2, y1 + toolbar_h)], radius=pane_radius, fill=toolbar_color)
    draw.rectangle([(x1, y1 + toolbar_h - pane_radius), (x2, y1 + toolbar_h)], fill=toolbar_color)

    line_color = (255, 255, 255, 130) if is_dark else (200, 205, 215, 255)
    line_h = int(SIZE * 0.012)
    line_gap = int(SIZE * 0.027)
    content_top = y1 + toolbar_h + int(SIZE * 0.025)
    content_left = x1 + int(SIZE * 0.02)
    content_right_max = x2 - int(SIZE * 0.02)
    max_lines = int((y2 - content_top - int(SIZE * 0.02)) / line_gap)
    widths = [1.0, 0.85, 0.95, 0.7, 0.9, 0.55, 0.8, 0.65][:max_lines]
    for i, w in enumerate(widths):
        ly = content_top + i * line_gap
        lx2 = content_left + int((content_right_max - content_left) * w)
        draw.rounded_rectangle([(content_left, ly), (lx2, ly + line_h)], radius=line_h // 2, fill=line_color)

out = Path(__file__).parent / 'icon.png'
img.save(out)
print(f"Wrote {out}")
