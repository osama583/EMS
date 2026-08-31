"""Check every implementation figure is present and correctly framed.

Reads PNG dimensions straight from the IHDR chunk, so it needs no image library.

What it enforces:
  - both profiles exist for every figure in shots.json, and nothing extra is
    left behind from a previous, larger shot list;
  - desktop is 2880 wide (1440 CSS px at 2x) and mobile 1170 (390 at 3x), which
    is what keeps every figure at 100% zoom rather than a shrunk-to-fit page;
  - height is a whole viewport, not a full-page strip.
"""
from __future__ import annotations

import json
import pathlib
import struct
import sys

ROOT = pathlib.Path("C:/Users/natsu/Desktop/Osama/ui png")
IMPL = ROOT / "Implementation"

# width, (min height, max height). The desktop max covers the `tall: 1200`
# shots (1200 CSS px at 2x); anything beyond that is a full-page capture.
EXPECTED = {
    "desktop.png": (2880, 1800, 2400),
    "mobile.png": (1170, 2532, 3300),
}


def png_size(path: pathlib.Path) -> tuple[int, int]:
    with path.open("rb") as fh:
        head = fh.read(24)
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")
    width, height = struct.unpack(">II", head[16:24])
    return width, height


def main() -> int:
    shots = json.loads((ROOT / "_capture" / "shots.json").read_text(encoding="utf-8"))
    safe = str.maketrans({c: "-" for c in '<>:"/\\|?*'})
    expected_dirs = {
        IMPL / s["group"] / f"{s['id']} {s['title'].translate(safe).strip()}"
        for s in shots
    }

    problems: list[str] = []

    for directory in sorted(expected_dirs):
        if not directory.is_dir():
            problems.append(f"MISSING FOLDER  {directory.relative_to(ROOT)}")
            continue
        for name, (width, min_h, max_h) in EXPECTED.items():
            f = directory / name
            if not f.exists():
                problems.append(f"MISSING FILE    {f.relative_to(ROOT)}")
                continue
            w, h = png_size(f)
            if w != width:
                problems.append(f"WIDTH {w} (want {width})  {f.relative_to(ROOT)}")
            elif not (min_h <= h <= max_h):
                problems.append(f"HEIGHT {h} (want {min_h}-{max_h})  {f.relative_to(ROOT)}")

    found = {d for d in IMPL.glob("*/*") if d.is_dir()}
    for stray in sorted(found - expected_dirs):
        problems.append(f"STRAY FOLDER    {stray.relative_to(ROOT)}")

    empty_groups = [g for g in IMPL.iterdir() if g.is_dir() and not any(g.iterdir())]
    for g in empty_groups:
        problems.append(f"EMPTY GROUP     {g.relative_to(ROOT)}")

    print(f"figures expected : {len(expected_dirs)}")
    print(f"images expected  : {len(expected_dirs) * 2}")
    print(f"images on disk   : {len(list(IMPL.glob('*/*/*.png')))}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for line in problems:
            print("  " + line)
        return 1
    print("\nAll figures present, both profiles, correct dimensions.")
    return 0


sys.exit(main())
