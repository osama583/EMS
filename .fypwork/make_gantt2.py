# -*- coding: utf-8 -*-
"""Build the FYP Part 2 Gantt chart, in the same design as the Part 1 chart.

The palette, the row shapes, the phase bands, the dotted active cells, the
legend and the closing note are all taken from the existing Appendix D figures
so the two charts read as one series. The Part 1 chart is not touched; this
adds a second pair of figures covering the work from system design through to
final submission.

Emits two HTML files and renders each with headless Chrome.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# ── palette sampled from the Part 1 figures ──────────────────────────────
GRID = "#575757"
CELL = "#2b2d31"
PAGE = "#262626"
TEXT = "#f6f6f6"
HEAD = "#a7c6f1"

PHASE = {                       # band colour, active-cell colour
    1: ("#a7c6f1", "#75abed"),
    2: ("#b1c9a6", "#53950f"),
    3: ("#edb59c", "#d76600"),
    4: ("#e8c8fa", "#cc8ee9"),
    5: ("#ffb7b3", "#ff695d"),
    6: ("#a3c6ea", "#74b9a6"),
}

WEEKS = ["W1 Apr 27", "W3 May 11", "W5 May 25", "W7 Jun 8", "W9 Jun 22",
         "W11 Jul 6", "W13 Jul 20", "W15 Aug 3", "W17 Aug 17", "W19 Aug 31"]

# (phase number, band label, [(task, [column indexes, 0-based])])
PART_1 = [
    (1, "Phase 1 — System and Database Design", [
        ("4.2.1 Design Overview & Rationale", [0]),
        ("4.2.2 System Architecture & Layering", [0]),
        ("4.2.3 Security and Identity Design (RBAC)", [0]),
        ("4.2.4–4.2.6 Use Case, Activity & Sequence Diagrams", [0, 1]),
        ("4.3.1 ERD & 4.3.2 Data Dictionary", [0, 1]),
    ]),
    (2, "Phase 2 — Backend Development (Flask REST API)", [
        ("Database Schema Implementation (PostgreSQL)", [1]),
        ("Authentication, JWT & Password Hashing", [1]),
        ("Role-within-Unit Authorisation Model", [1, 2]),
        ("Event Proposal & Workflow State Machine", [1, 2]),
        ("Departmental Task Generation & Assignment", [2]),
        ("Approval Escalation & Notification Jobs", [2]),
    ]),
    (3, "Phase 3 — Frontend Development (Angular)", [
        ("4.4 Design Tokens & Shared Component Library", [3]),
        ("4.5.1 Public Access & Authentication Screens", [3]),
        ("4.5.2–4.5.3 Attendee Screens & Application Shell", [3]),
        ("4.5.4 Event Proposal Submission Form", [3, 4]),
        ("4.5.5–4.5.6 Proposal Tracking & Task Handling", [4]),
        ("4.5.7–4.5.8 Cafeteria and Clubs Modules", [4]),
    ]),
]

PART_2 = [
    (4, "Phase 4 — AI Assistant and Role Dashboards", [
        ("4.5.9 Role Dashboards (HOD, CFO, Cafeteria)", [5]),
        ("4.5.10–4.5.11 Registrations & System Administration", [5]),
        ("4.5.12 AI Assistant, Query Guard & Access Log", [5]),
    ]),
    (5, "Phase 5 — Testing and Evaluation", [
        ("5.2.1 Unit Test Scenarios (Eight Feature Areas)", [6]),
        ("5.2.2 UAT Instrument Preparation", [6]),
        ("5.3.1 Unit Testing Results & Defect Correction", [6, 7]),
        ("5.3.2 UAT Sessions with Five Role-Based Testers", [7]),
    ]),
    (6, "Phase 6 — Chapter 4 to 6 Documentation", [
        ("Chapter 4 — Design and Implementation Write-up", [7, 8]),
        ("4.6 Sample Code Listings & Annotation", [8]),
        ("Chapter 5 — Results and Discussion Write-up", [8]),
        ("Chapter 6 — Evaluation, Limitations & Recommendation", [8, 9]),
        ("Appendices Update & Gantt Chart (Appendix D)", [9]),
        ("Full Report Proofreading & Turnitin Check", [9]),
    ]),
    (6, "Phase 7 — Final Submission", [
        ("Final FYP Submission (Deadline: Sep 11, 2026)", [9]),
    ]),
]

LEGEND = [(1, "Phase 1: Design"), (2, "Phase 2: Backend"), (3, "Phase 3: Frontend"),
          (4, "Phase 4: AI & Dashboards"), (5, "Phase 5: Testing"), (6, "Phase 6: Documentation")]

NOTE = ("Note: Shaded cells (\u00b7) indicate active weeks for each task. Each column spans two "
        "weeks. This chart covers FYP Part 2, continuing from the Part 1 timeline in Figures 140 "
        "and 141.")

CSS = f"""
  html,body{{margin:0;padding:0;background:{PAGE};}}
  body{{font-family:"Times New Roman",Georgia,serif;color:{TEXT};}}
  table{{border-collapse:collapse;width:1036px;table-layout:fixed;}}
  col.task{{width:255px;}}
  th{{background:{HEAD};color:#161616;font-weight:400;font-size:15px;
     border:1px solid {GRID};padding:9px 6px;text-align:center;}}
  th.task{{text-align:left;padding-left:10px;}}
  td{{background:{CELL};border:1px solid {GRID};height:38px;font-size:14px;}}
  td.task{{padding:4px 8px 4px 10px;line-height:1.22;}}
  td.dot{{text-align:center;color:#ffffff;font-size:13px;}}
  tr.band td{{padding:3px 0 3px 8px;color:#161616;font-size:14.5px;
              border:1px solid {GRID};height:auto;}}
  .lg{{margin:7px 0 3px 2px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:{TEXT};}}
  .sw{{display:inline-block;width:11px;height:11px;margin:0 4px 0 12px;vertical-align:-1px;}}
  .nt{{margin:1px 0 6px 2px;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:{TEXT};}}
"""


def build(blocks, header: bool, tail: bool) -> str:
    rows = []
    if header:
        rows.append("<tr><th class='task'>Task / Activity</th>"
                    + "".join(f"<th>{w}</th>" for w in WEEKS) + "</tr>")
    for phase, label, tasks in blocks:
        band, active = PHASE[phase]
        rows.append(f"<tr class='band'><td colspan='{len(WEEKS)+1}' "
                    f"style='background:{band}'>{label}</td></tr>")
        for name, cols in tasks:
            cells = "".join(
                f"<td class='dot' style='background:{active}'>&middot;</td>" if i in cols
                else "<td></td>" for i in range(len(WEEKS)))
            rows.append(f"<tr><td class='task'>{name}</td>{cells}</tr>")

    extra = ""
    if tail:
        keys = "".join(f"<span class='sw' style='background:{PHASE[p][1]}'></span>{t}"
                       for p, t in LEGEND)
        extra = f"<div class='lg'>Legend:{keys}</div><div class='nt'>{NOTE}</div>"

    cols = "<col class='task'>" + "<col>" * len(WEEKS)
    return (f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head>"
            f"<body><table>{cols}{''.join(rows)}</table>{extra}</body></html>")


def render(html_path: pathlib.Path, png_path: pathlib.Path) -> None:
    """Shoot tall, then trim the empty page colour back to the content."""
    from PIL import Image

    uri = "file:///" + str(html_path).replace("\\", "/")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--user-data-dir={pathlib.Path.home()}/.gantt-chrome",
                    "--force-device-scale-factor=2",
                    "--window-size=1100,1400",
                    f"--screenshot={png_path}", uri],
                   check=True, capture_output=True)

    im = Image.open(png_path).convert("RGB")
    page = tuple(int(PAGE[i:i + 2], 16) for i in (1, 3, 5))
    px = im.load()
    w, h = im.size

    def row_blank(y):
        return all(px[x, y] == page for x in range(0, w, 3))

    def col_blank(x):
        return all(px[x, y] == page for y in range(0, h, 3))

    bottom = h
    while bottom > 1 and row_blank(bottom - 1):
        bottom -= 1
    right = w
    while right > 1 and col_blank(right - 1):
        right -= 1
    im.crop((0, 0, right + 2, bottom + 2)).save(png_path)


def main() -> int:
    for n, (blocks, header, tail) in enumerate(
            [(PART_1, True, False), (PART_2, False, True)], start=1):
        html = HERE / f"gantt2_part{n}.html"
        png = HERE / f"gantt2_part{n}.png"
        html.write_text(build(blocks, header, tail), encoding="utf-8")
        render(html, png)
        from PIL import Image
        print(f"  gantt2_part{n}.png  {png.stat().st_size:,} bytes  {Image.open(png).size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
