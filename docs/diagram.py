#!/usr/bin/env python3
"""Render docs/before-after.png — the README's before/after illustration.

Run from the repository root:

    python3 docs/diagram.py

Nothing here reads a real `.env`; the sample values are invented.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Scale factor: draw at 2x and downsample, which gives smoother glyph edges.
S = 2

WIDTH, HEIGHT = 1100, 580
MARGIN = 56
PANEL_W = WIDTH - MARGIN * 2
PANEL_H = 176
PANEL_A_Y = 92
PANEL_B_Y = 316

BG = (8, 13, 26)
PANEL = (17, 26, 46)
BORDER = (34, 48, 77)
WHITE = (226, 232, 240)
MUTED = (100, 116, 139)
LABEL = (148, 163, 184)
KEY = (125, 211, 252)
SECRET = (252, 165, 165)
MARKER = (251, 191, 36)
ARROW = (71, 85, 105)

MONO = Path.home() / ".local/share/fonts/JetBrainsMono/JetBrainsMonoNLNerdFont-Regular.ttf"
MONO_BOLD = Path.home() / ".local/share/fonts/JetBrainsMono/JetBrainsMonoNLNerdFont-Bold.ttf"

MARKER_TEXT = "deleted by plugin: remove-credential"

BEFORE_LINES = [
    [("DATABASE_URL", KEY), ("=", MUTED), ("postgres://app:s3cret@db.internal:5432/app", SECRET)],
    [("API_KEY", KEY), ("=", MUTED), ("sk-live-9f2c7a1d4b8e", SECRET)],
    [("# rotate quarterly", MUTED)],
]
AFTER_LINES = [
    [("DATABASE_URL", KEY), ("=", MUTED), (MARKER_TEXT, MARKER)],
    [("API_KEY", KEY), ("=", MUTED), (MARKER_TEXT, MARKER)],
    [(f"# {MARKER_TEXT}", MUTED)],
]


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size * S)


def draw_segments(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    segments: list[tuple[str, tuple[int, int, int]]],
    fnt: ImageFont.FreeTypeFont,
) -> None:
    for text, color in segments:
        draw.text((x, y), text, font=fnt, fill=color, anchor="lt")
        x += int(draw.textlength(text, font=fnt))


def draw_panel(
    draw: ImageDraw.ImageDraw,
    top: int,
    label: str,
    lines: list[list[tuple[str, tuple[int, int, int]]]],
    label_color: tuple[int, int, int],
) -> None:
    draw.rounded_rectangle(
        (MARGIN * S, top * S, (MARGIN + PANEL_W) * S, (top + PANEL_H) * S),
        radius=16 * S,
        fill=PANEL,
        outline=BORDER,
        width=S,
    )
    draw.text(
        ((MARGIN + 24) * S, (top + 16) * S),
        label,
        font=font(MONO_BOLD, 13),
        fill=label_color,
        anchor="lt",
    )
    code_font = font(MONO, 20)
    for index, line in enumerate(lines):
        draw_segments(draw, (MARGIN + 24) * S, (top + 44 + index * 34) * S, line, code_font)


def main() -> None:
    image = Image.new("RGB", (WIDTH * S, HEIGHT * S), BG)
    draw = ImageDraw.Draw(image)

    title_font = font(MONO_BOLD, 17)
    draw.text((MARGIN * S, 34 * S), "remove-credential", font=title_font, fill=WHITE, anchor="lt")
    title_width = draw.textlength("remove-credential", font=title_font)
    draw.text(
        ((MARGIN * S) + int(title_width) + 16 * S, 38 * S),
        ".env values never reach the model",
        font=font(MONO, 14),
        fill=MUTED,
        anchor="lt",
    )

    draw_panel(draw, PANEL_A_Y, "BEFORE  —  .env on disk", BEFORE_LINES, SECRET)
    draw_panel(draw, PANEL_B_Y, "AFTER  —  what the model reads", AFTER_LINES, MARKER)

    center = WIDTH * S // 2
    draw.line((center, (PANEL_A_Y + PANEL_H + 8) * S, center, (PANEL_B_Y - 16) * S), fill=ARROW, width=2 * S)
    draw.polygon(
        [
            (center - 7 * S, (PANEL_B_Y - 18) * S),
            (center + 7 * S, (PANEL_B_Y - 18) * S),
            (center, (PANEL_B_Y - 6) * S),
        ],
        fill=ARROW,
    )
    draw.text(
        (center + 16 * S, (PANEL_A_Y + PANEL_H + 18) * S),
        "read / grep",
        font=font(MONO, 13),
        fill=LABEL,
        anchor="lt",
    )

    draw.text(
        (MARGIN * S, 524 * S),
        "The file on disk is never modified. Only the text handed to the model changes.",
        font=font(MONO, 14),
        fill=MUTED,
        anchor="lt",
    )

    out = Path(__file__).with_name("before-after.png")
    image.resize((WIDTH, HEIGHT), Image.LANCZOS).save(out, optimize=True)
    print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
