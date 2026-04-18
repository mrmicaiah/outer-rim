#!/usr/bin/env python3
"""Generate Parallel's app icon (1024x1024 PNG).

Run: python3 generate-icon.py
Produces: icon.png in the same directory.

Requires: Pillow (pip install Pillow)
"""
from PIL import Image, ImageDraw
from pathlib import Path

SIZE = 1024
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded-square background — matches macOS app icon convention.
corner = int(SIZE * 0.225)
bg_color = (26, 26, 31, 255)  # matches --dark-bg from styles.css
draw.rounded_rectangle([(0, 0), (SIZE, SIZE)], radius=corner, fill=bg_color)

# Pane placement
margin_x = int(SIZE * 0.11)
margin_y = int(SIZE * 0.20)
gap = int(SIZE * 0.03)

left_x1 = margin_x
left_x2 = SIZE // 2 - gap // 2
right_x1 = SIZE // 2 + gap // 2
right_x2 = SIZE - margin_x
y1 = margin_y
y2 = SIZE - margin_y

pane_radius = int(SIZE * 0.05)

# Left pane — solid blue (the "research" side)
left_color = (59, 130, 246, 255)  # matches --accent-blue
draw.rounded_rectangle([(left_x1, y1), (left_x2, y2)], radius=pane_radius, fill=left_color)

# Right pane — off-white (the "Claude / content" side)
right_color = (248, 248, 248, 255)
draw.rounded_rectangle([(right_x1, y1), (right_x2, y2)], radius=pane_radius, fill=right_color)

# Browser toolbar strip on each pane
toolbar_h = int(SIZE * 0.08)
toolbar_left = (43, 99, 200, 255)
toolbar_right = (230, 230, 230, 255)

draw.rounded_rectangle([(left_x1, y1), (left_x2, y1 + toolbar_h)], radius=pane_radius, fill=toolbar_left)
draw.rectangle([(left_x1, y1 + toolbar_h - pane_radius), (left_x2, y1 + toolbar_h)], fill=toolbar_left)

draw.rounded_rectangle([(right_x1, y1), (right_x2, y1 + toolbar_h)], radius=pane_radius, fill=toolbar_right)
draw.rectangle([(right_x1, y1 + toolbar_h - pane_radius), (right_x2, y1 + toolbar_h)], fill=toolbar_right)

# Tabs on each toolbar
tab_h = int(SIZE * 0.035)
tab_w = int((left_x2 - left_x1) * 0.17)
tab_y = y1 + int(SIZE * 0.022)
tab_spacing = int(SIZE * 0.01)
tab_start = int(SIZE * 0.025)

for i in range(3):
    tx1 = left_x1 + tab_start + i * (tab_w + tab_spacing)
    fill = (255, 255, 255, 235) if i == 0 else (255, 255, 255, 130)
    draw.rounded_rectangle([(tx1, tab_y), (tx1 + tab_w, tab_y + tab_h)], radius=int(SIZE * 0.008), fill=fill)

for i in range(3):
    tx1 = right_x1 + tab_start + i * (tab_w + tab_spacing)
    fill = (59, 130, 246, 255) if i == 0 else (180, 200, 230, 255)
    draw.rounded_rectangle([(tx1, tab_y), (tx1 + tab_w, tab_y + tab_h)], radius=int(SIZE * 0.008), fill=fill)

# Content lines on the right (white) pane to hint at text
line_color = (200, 205, 215, 255)
line_h = int(SIZE * 0.015)
line_gap = int(SIZE * 0.035)
content_top = y1 + toolbar_h + int(SIZE * 0.06)
content_left = right_x1 + int(SIZE * 0.04)
content_right_max = right_x2 - int(SIZE * 0.04)

widths = [1.0, 0.85, 0.95, 0.7, 0.9, 0.55]
for i, w in enumerate(widths):
    ly = content_top + i * line_gap
    lx2 = content_left + int((content_right_max - content_left) * w)
    draw.rounded_rectangle([(content_left, ly), (lx2, ly + line_h)], radius=line_h // 2, fill=line_color)

out = Path(__file__).parent / 'icon.png'
img.save(out)
print(f"Wrote {out}")
