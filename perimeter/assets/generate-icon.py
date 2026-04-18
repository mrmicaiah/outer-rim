#!/usr/bin/env python3
"""Generate Perimeter's app icon (1024x1024 PNG).

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
bg_color = (15, 16, 20, 255)
draw.rounded_rectangle([(0, 0), (SIZE, SIZE)], radius=corner, fill=bg_color)

margin_x = int(SIZE * 0.12)
margin_y = int(SIZE * 0.20)
gap = int(SIZE * 0.03)
left_x1 = margin_x
left_x2 = SIZE // 2 - gap // 2
right_x1 = SIZE // 2 + gap // 2
right_x2 = SIZE - margin_x
y1 = margin_y
y2 = SIZE - margin_y
pane_radius = int(SIZE * 0.05)

# LEFT: terminal
terminal_bg = (24, 26, 32, 255)
draw.rounded_rectangle([(left_x1, y1), (left_x2, y2)], radius=pane_radius, fill=terminal_bg)

# Traffic lights
light_y = y1 + int(SIZE * 0.035)
light_r = int(SIZE * 0.012)
light_colors = [(239, 68, 68, 255), (245, 158, 11, 255), (34, 197, 94, 255)]
lx = left_x1 + int(SIZE * 0.025)
for col in light_colors:
    draw.ellipse([(lx, light_y - light_r), (lx + light_r * 2, light_y + light_r)], fill=col)
    lx += light_r * 2 + int(SIZE * 0.013)

prompt_y = y1 + int(SIZE * 0.10)
line_h = int(SIZE * 0.018)
dim_color = (150, 160, 180, 255)
prompt_color = (34, 197, 94, 255)
cursor_color = (255, 255, 255, 255)

px = left_x1 + int(SIZE * 0.04)
draw.rounded_rectangle([(px, prompt_y), (px + int(SIZE * 0.012), prompt_y + line_h)], radius=2, fill=prompt_color)
px2 = px + int(SIZE * 0.025)
draw.rounded_rectangle([(px2, prompt_y), (px2 + int(SIZE * 0.10), prompt_y + line_h)], radius=line_h//2, fill=(180, 200, 230, 255))

for i, w in enumerate([0.55, 0.75, 0.40]):
    y = prompt_y + (i + 1) * int(SIZE * 0.035)
    draw.rounded_rectangle(
        [(left_x1 + int(SIZE * 0.04), y), (left_x1 + int(SIZE * 0.04) + int((left_x2 - left_x1) * w), y + line_h)],
        radius=line_h // 2, fill=dim_color
    )

cur_y = prompt_y + 4 * int(SIZE * 0.035)
cur_x = left_x1 + int(SIZE * 0.04)
draw.rounded_rectangle([(cur_x, cur_y), (cur_x + int(SIZE * 0.012), cur_y + line_h)], radius=2, fill=prompt_color)
cx = cur_x + int(SIZE * 0.025)
draw.rectangle([(cx, cur_y), (cx + int(SIZE * 0.022), cur_y + line_h)], fill=cursor_color)

# RIGHT: browser
right_color = (248, 248, 248, 255)
draw.rounded_rectangle([(right_x1, y1), (right_x2, y2)], radius=pane_radius, fill=right_color)

toolbar_h = int(SIZE * 0.08)
toolbar_right = (230, 230, 230, 255)
draw.rounded_rectangle([(right_x1, y1), (right_x2, y1 + toolbar_h)], radius=pane_radius, fill=toolbar_right)
draw.rectangle([(right_x1, y1 + toolbar_h - pane_radius), (right_x2, y1 + toolbar_h)], fill=toolbar_right)

tab_h = int(SIZE * 0.035)
tab_w = int((right_x2 - right_x1) * 0.17)
tab_y = y1 + int(SIZE * 0.022)
tab_start = int(SIZE * 0.025)
tab_spacing = int(SIZE * 0.01)
for i in range(3):
    tx1 = right_x1 + tab_start + i * (tab_w + tab_spacing)
    fill = (59, 130, 246, 255) if i == 0 else (180, 200, 230, 255)
    draw.rounded_rectangle([(tx1, tab_y), (tx1 + tab_w, tab_y + tab_h)], radius=int(SIZE * 0.008), fill=fill)

line_color = (200, 205, 215, 255)
content_top = y1 + toolbar_h + int(SIZE * 0.06)
content_left = right_x1 + int(SIZE * 0.04)
content_right_max = right_x2 - int(SIZE * 0.04)
widths = [1.0, 0.85, 0.95, 0.7, 0.9, 0.55]
line_gap = int(SIZE * 0.035)
for i, w in enumerate(widths):
    ly = content_top + i * line_gap
    lx2 = content_left + int((content_right_max - content_left) * w)
    draw.rounded_rectangle([(content_left, ly), (lx2, ly + line_h)], radius=line_h // 2, fill=line_color)

out = Path(__file__).parent / 'icon.png'
img.save(out)
print(f"Wrote {out}")
