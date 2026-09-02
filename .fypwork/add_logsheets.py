# -*- coding: utf-8 -*-
"""Append meetings 4 to 6 to Appendix C, after the three already there.

Figures 137 to 139 are untouched. The new figures use the same caption wording
and the same placement width, so the six read as one sequence.
"""
from __future__ import annotations

import os
import sys

import docx
from docx.shared import Emu

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from add_gantt2_and_plan import caption_paragraph, picture_paragraph   # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(os.path.dirname(HERE), "ui png", "meeting logs")
WIDTH = Emu(5731510)                      # 6.27 in, the full text width

NEW = [("4.png", "Log Sheets – meeting 4."),
       ("5.png", "Log Sheets – meeting 5."),
       ("6.png", "Log Sheets – meeting 6.")]


def main() -> int:
    path = sys.argv[1]
    doc = docx.Document(path)

    # anchor on the real caption in Appendix C, not its List of Figures entry
    paras = doc.paragraphs
    appendix = next(i for i, p in enumerate(paras)
                    if p.style.name.startswith("Heading") and p.text.strip().startswith("Appendix C"))
    anchor = next(p for p in paras[appendix:]
                  if p.style.name == "Caption" and "Log Sheets – meeting 3" in p.text)

    cursor = anchor._p
    for name, caption in NEW:
        image = os.path.join(SHOTS, name)
        if not os.path.exists(image):
            raise SystemExit(f"missing screenshot: {image}")
        for block in (picture_paragraph(doc, image, width=WIDTH), caption_paragraph(doc, caption)):
            cursor.addnext(block)
            cursor = block
        print(f"  added  {name}  ->  {caption}")

    doc.save(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
