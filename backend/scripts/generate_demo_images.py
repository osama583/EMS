"""Give every event and club a real image, for demo purposes.

Presentation dressing, not application logic. Three cases get replaced:

  * missing   - event_image / image_url is NULL, so the UI falls back to the
                grey camera placeholder tile
  * placeholder - a https://placehold.co/... URL, which is a grey box AND needs
                internet to render at all
  * broken    - an /api/v1/uploads/{key} pointer whose bytes no longer exist
                anywhere (see migration 045)

Rows already pointing at a real picture - the /assets/events/*.jpg the frontend
ships - are left alone.

The images are drawn here with Pillow rather than fetched: no network at
presentation time, no cost, and the result is on-palette instead of a stock
photo that looks nothing like the rest of the app. Each card is seeded by the
name, so the same event always gets the same picture.

    .venv/Scripts/python -m scripts.generate_demo_images --dry-run
    .venv/Scripts/python -m scripts.generate_demo_images
"""
from __future__ import annotations

import argparse
import hashlib
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app import create_app  # noqa: E402
from app.api.uploads import URL_PREFIX, _store  # noqa: E402
from app.db import fetch_all, fetch_one, transaction  # noqa: E402

SIZE = (1200, 675)

# The app's own dark surfaces and accents (styles/_design-system.scss), so a
# generated card sits next to a real photo without looking pasted on.
BASE = (3, 19, 39)
ACCENTS = [
    ((23, 105, 214), (42, 131, 255)),    # blue
    ((22, 132, 91), (56, 180, 130)),     # green
    ((201, 54, 79), (233, 96, 120)),     # red
    ((201, 152, 40), (255, 198, 74)),    # amber
    ((84, 62, 173), (129, 108, 220)),    # violet
]

_FONT_CANDIDATES = [
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
]


def _font(size: int) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def _seed(name: str) -> int:
    return int(hashlib.sha256(name.encode("utf-8")).hexdigest()[:8], 16)


def _wrap(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> list[str]:
    lines, current = [], ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if draw.textlength(candidate, font=font) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines[:3]


def render(name: str, kind: str) -> bytes:
    """One 16:9 card: gradient ground, two soft accent blooms, the name."""
    seed = _seed(name)
    dark, light = ACCENTS[seed % len(ACCENTS)]
    width, height = SIZE

    image = Image.new("RGB", SIZE, BASE)
    draw = ImageDraw.Draw(image)
    # Vertical wash from the app's darkest surface into the accent's shadow.
    for y in range(height):
        t = y / height
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(BASE[i] + (dark[i] - BASE[i]) * t * 0.55) for i in range(3)),
        )

    # Three blooms, placed off the name's hash so no two cards match, then blurred
    # into light rather than left as the flat discs a plain ellipse draws.
    glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    for index, (colour, alpha) in enumerate(((light, 150), (dark, 190), (light, 90))):
        radius = 200 + (seed >> (index * 5) & 0x7F)
        cx = 120 + (seed >> (index * 7) & 0x3FF) % (width - 240)
        cy = 60 + (seed >> (index * 11) & 0x1FF) % (height - 120)
        gdraw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=(*colour, alpha))
    glow = glow.filter(ImageFilter.GaussianBlur(130))
    image = Image.alpha_composite(image.convert("RGBA"), glow)

    # Darken the lower-left so the title keeps its contrast whatever the blooms did.
    shade = Image.new("RGBA", SIZE, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shade)
    for y in range(height // 2, height):
        t = (y - height // 2) / (height / 2)
        sdraw.line([(0, y), (width, y)], fill=(*BASE, round(215 * t * t)))
    image = Image.alpha_composite(image, shade).convert("RGB")
    draw = ImageDraw.Draw(image)

    # Accent rule + eyebrow, then the name. The block is bottom-aligned so a title
    # that wraps to two or three lines grows upwards instead of off the card.
    title_font = _font(72)
    lines = _wrap(draw, name, title_font, width - 176)
    line_height = 86
    title_top = height - 96 - line_height * len(lines)

    draw.text((88, title_top - 78), kind.upper(), font=_font(26), fill=light)
    draw.rectangle([88, title_top - 36, 88 + 96, title_top - 28], fill=light)
    for index, line in enumerate(lines):
        draw.text((88, title_top + index * line_height), line, font=title_font, fill=(255, 255, 255))

    from io import BytesIO

    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _needs_image(cur, value: str | None) -> bool:
    """Missing, a placehold.co box, or a pointer whose bytes are gone."""
    if not value:
        return True
    if "placehold.co" in value:
        return True
    if value.startswith(URL_PREFIX):
        key = value.rsplit("/", 1)[-1]
        return fetch_one(cur, "SELECT 1 AS found FROM upload_file WHERE storage_key = %s", (key,)) is None
    return False


def run(*, dry_run: bool) -> int:
    targets: list[tuple[str, str, int, str]] = []
    with transaction() as cur:
        for row in fetch_all(cur, "SELECT request_id, event_title, event_image FROM request ORDER BY request_id"):
            if _needs_image(cur, row["event_image"]):
                targets.append(("request", "Event", row["request_id"], row["event_title"] or "Untitled event"))
        for row in fetch_all(cur, "SELECT club_id, club_name, image_url FROM clubs ORDER BY club_id"):
            if _needs_image(cur, row["image_url"]):
                targets.append(("clubs", "Club", row["club_id"], row["club_name"] or "Untitled club"))

    print(f"{len(targets)} row(s) need an image "
          f"({sum(1 for t in targets if t[0] == 'request')} events, "
          f"{sum(1 for t in targets if t[0] == 'clubs')} clubs)")
    if dry_run:
        for table, kind, row_id, name in targets:
            print(f"  {kind:5} {row_id:>6}  {name}")
        return 0

    for table, kind, row_id, name in targets:
        key = _store(render(name, kind), "image/png", ".png")
        column, pk = ("event_image", "request_id") if table == "request" else ("image_url", "club_id")
        with transaction() as cur:
            cur.execute(f"UPDATE {table} SET {column} = %s WHERE {pk} = %s", (f"{URL_PREFIX}{key}", row_id))
        print(f"  {kind:5} {row_id:>6}  {name}")

    print()
    print(f"{len(targets)} image(s) generated and stored.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="list what would be generated, write nothing")
    args = parser.parse_args()
    with create_app().app_context():
        raise SystemExit(run(dry_run=args.dry_run))
