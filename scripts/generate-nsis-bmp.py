#!/usr/bin/env python3
"""
Generate premium NSIS installer/uninstaller BMP images for LumaForge.
Matches the splash screen background: midnight blue gradient + cyan glow.

Usage: python scripts/generate-nsis-bmp.py
Requires: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import os

# Paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
LOGO_PATH = os.path.join(PROJECT_ROOT, "..", "Logo", "LumaForge_1024.png")
NSIS_DIR = os.path.join(PROJECT_ROOT, "src-tauri", "nsis")

# Splash-matching colors
BG_TOP = (15, 21, 37)       # #0f1525
BG_MID = (10, 14, 26)       # #0a0e1a
BG_BOT = (6, 9, 18)         # #060912
CYAN = (0, 183, 255)        # #00b7ff
CYAN_BORDER = (0, 183, 255, 50)  # rgba(0,183,255,0.2)


def create_gradient_bg(width, height):
    """Create a vertical gradient matching the splash background."""
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(height - 1, 1)
        if t < 0.5:
            s = t / 0.5
            r = int(BG_TOP[0] + (BG_MID[0] - BG_TOP[0]) * s)
            g = int(BG_TOP[1] + (BG_MID[1] - BG_TOP[1]) * s)
            b = int(BG_TOP[2] + (BG_MID[2] - BG_TOP[2]) * s)
        else:
            s = (t - 0.5) / 0.5
            r = int(BG_MID[0] + (BG_BOT[0] - BG_MID[0]) * s)
            g = int(BG_MID[1] + (BG_BOT[1] - BG_MID[1]) * s)
            b = int(BG_MID[2] + (BG_BOT[2] - BG_MID[2]) * s)
        draw.line([(0, y), (width - 1, y)], fill=(r, g, b))
    return img


def add_cyan_glow(img, center_x, center_y, radius, intensity=0.08):
    """Add a radial cyan glow (like splash's radial-gradient)."""
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    for i in range(radius, 0, -1):
        alpha = int(255 * intensity * (i / radius))
        color = (*CYAN, alpha)
        glow_draw.ellipse(
            [center_x - i, center_y - i, center_x + i, center_y + i],
            fill=color,
        )
    glow = glow.filter(ImageFilter.GaussianBlur(radius // 3))
    img_rgba = img.convert("RGBA")
    img_rgba = Image.alpha_composite(img_rgba, glow)
    return img_rgba.convert("RGB")


def add_cyan_border(img, width=1, side="bottom"):
    """Add a subtle cyan border."""
    draw = ImageDraw.Draw(img)
    color = CYAN_BORDER[:3]
    if side == "bottom":
        for w in range(width):
            draw.line([(0, img.height - 1 - w), (img.width - 1, img.height - 1 - w)], fill=color)
    elif side == "right":
        for w in range(width):
            draw.line([(img.width - 1 - w, 0), (img.width - 1 - w, img.height - 1)], fill=color)
    return img


def place_logo(img, logo_path, target_size, center_x, center_y):
    """Load wolf logo PNG, resize, and paste centered."""
    logo = Image.open(logo_path).convert("RGBA")
    logo = logo.resize((target_size, target_size), Image.LANCZOS)
    paste_x = center_x - target_size // 2
    paste_y = center_y - target_size // 2
    img_rgba = img.convert("RGBA")
    img_rgba.paste(logo, (paste_x, paste_y), logo)
    return img_rgba.convert("RGB")


def generate_header(output_path, logo_path):
    """header.bmp — 150×57, wolf centered, cyan border bottom."""
    w, h = 150, 57
    img = create_gradient_bg(w, h)
    img = add_cyan_glow(img, w // 2, h // 2, radius=50, intensity=0.06)
    img = place_logo(img, logo_path, target_size=38, center_x=w // 2, center_y=h // 2)
    img = add_cyan_border(img, width=1, side="bottom")
    img.save(output_path, "BMP")
    print(f"  Generated: {output_path} ({w}x{h})")


def generate_sidebar(output_path, logo_path):
    """sidebar.bmp — 164×314, wolf 104px centered upper-third, cyan glow, text, border right."""
    w, h = 164, 314
    img = create_gradient_bg(w, h)
    
    # Logo: 104px, centered in upper-third
    logo_y = 105
    img = add_cyan_glow(img, w // 2, logo_y, radius=120, intensity=0.06)
    img = place_logo(img, logo_path, target_size=104, center_x=w // 2, center_y=logo_y)
    
    # Text: LUMAFORGE + Forge Your Library
    draw = ImageDraw.Draw(img)
    try:
        font_bold = ImageFont.truetype("C:\\Windows\\Fonts\\arialbd.ttf", 11)
        font_regular = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 8)
    except OSError:
        font_bold = ImageFont.load_default()
        font_regular = ImageFont.load_default()
    
    # "LUMAFORGE" — centered, bold, white
    text1 = "LUMAFORGE"
    bbox1 = draw.textbbox((0, 0), text1, font=font_bold)
    tw1 = bbox1[2] - bbox1[0]
    draw.text(((w - tw1) // 2, 230), text1, fill=(232, 234, 240), font=font_bold)
    
    # "Forge Your Library" — centered, regular, muted
    text2 = "Forge Your Library"
    bbox2 = draw.textbbox((0, 0), text2, font=font_regular)
    tw2 = bbox2[2] - bbox2[0]
    draw.text(((w - tw2) // 2, 248), text2, fill=(122, 127, 153), font=font_regular)
    
    img = add_cyan_border(img, width=1, side="right")
    img.save(output_path, "BMP")
    print(f"  Generated: {output_path} ({w}x{h})")


def main():
    os.makedirs(NSIS_DIR, exist_ok=True)

    print("Generating premium NSIS BMPs...")
    print(f"  Logo source: {LOGO_PATH}")
    print(f"  Output dir:  {NSIS_DIR}")

    if not os.path.exists(LOGO_PATH):
        print(f"  ERROR: Logo not found at {LOGO_PATH}")
        return

    generate_header(os.path.join(NSIS_DIR, "header.bmp"), LOGO_PATH)
    generate_sidebar(os.path.join(NSIS_DIR, "sidebar.bmp"), LOGO_PATH)
    generate_header(os.path.join(NSIS_DIR, "uninstaller-header.bmp"), LOGO_PATH)

    print("Done!")


if __name__ == "__main__":
    main()
