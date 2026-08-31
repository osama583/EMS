"""Produce a submission-sized copy by matching image resolution to print size.

The screenshots are 2880 px wide but are placed about 4.7 in wide, which is
roughly 610 DPI - four times more detail than any printer or PDF reader will
use. Each image is resampled to the pixels its own placement actually needs, so
nothing is cropped, rescaled on the page, or visibly softened.
"""
from __future__ import annotations

import io
import os
import re
import shutil
import sys
import zipfile

from PIL import Image

TARGET_DPI = 300          # comfortably above print need, well below what is there
EMU_PER_IN = 914400
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def placement_widths(document_xml: str) -> dict[str, int]:
    """Widest on-page width, in EMU, that each relationship id is drawn at."""
    widest: dict[str, int] = {}
    for block in re.findall(r'<(?:wp:inline|wp:anchor).*?</(?:wp:inline|wp:anchor)>',
                            document_xml, re.S):
        extent = re.search(r'<wp:extent[^>]*cx="(\d+)"', block)
        embed = re.search(r'<a:blip[^>]*r:embed="([^"]+)"', block)
        if extent and embed:
            rid = embed.group(1)
            widest[rid] = max(widest.get(rid, 0), int(extent.group(1)))
    return widest


def main() -> int:
    src, out = sys.argv[1], sys.argv[2]
    shutil.copyfile(src, out)

    with zipfile.ZipFile(src) as zf:
        names = zf.namelist()
        document = zf.read("word/document.xml").decode("utf-8")
        rels = zf.read("word/_rels/document.xml.rels").decode("utf-8")
        payload = {n: zf.read(n) for n in names}

    rid_to_part = {
        m.group(1): "word/" + m.group(2)
        for m in re.finditer(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels)
    }
    widths = placement_widths(document)

    needed: dict[str, int] = {}
    for rid, cx in widths.items():
        part = rid_to_part.get(rid)
        if part and part in payload:
            px = max(1, round(cx / EMU_PER_IN * TARGET_DPI))
            needed[part] = max(needed.get(part, 0), px)

    saved = shrunk = 0
    for part, target_px in needed.items():
        raw = payload[part]
        try:
            image = Image.open(io.BytesIO(raw))
        except Exception:
            continue
        if image.width <= target_px:
            continue
        height = round(image.height * target_px / image.width)
        resized = image.convert("RGB" if image.mode in ("P", "RGBA", "LA") else image.mode)
        resized = resized.resize((target_px, height), Image.LANCZOS)
        buffer = io.BytesIO()
        resized.save(buffer, format="PNG", optimize=True)
        if buffer.tell() < len(raw):
            saved += len(raw) - buffer.tell()
            payload[part] = buffer.getvalue()
            shrunk += 1

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for name in names:
            zf.writestr(name, payload[name])

    print(f"images resampled : {shrunk}")
    print(f"bytes saved      : {saved / 1e6:.1f} MB")
    print(f"{os.path.getsize(src)/1e6:.1f} MB -> {os.path.getsize(out)/1e6:.1f} MB")
    return 0


sys.exit(main())
