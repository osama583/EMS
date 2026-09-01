# -*- coding: utf-8 -*-
"""Apply the comparative justification edits to the finished report in place.

Anchors are matched on paragraph text rather than on index, so an insertion
earlier in the document does not invalidate a later anchor. New paragraphs
inherit the anchor's own paragraph properties and run properties, including the
leading tab where the surrounding body text uses one, so nothing has to be
restyled by hand afterwards.

Every other paragraph, table, figure and field in the document is untouched.

Run order, if the report is ever rebuilt from pristine.docx:

    python assemble.py                          # chapters 4.5 to 6
    python patch_document.py built.docx         # UAT section, acknowledgement
    python patch_discussion.py built.docx       # this file
    pwsh -File update_fields.ps1 -Path built.docx
    python shrink.py built.docx built-compact.docx
"""
from __future__ import annotations

import copy
import sys

import docx
from docx.oxml.ns import qn

sys.path.insert(0, ".")
import content_discussion as D      # noqa: E402


def has_leading_tab(p) -> bool:
    """True when the paragraph's first run opens with a tab, which is how the
    body text in this document expresses a first-line indent."""
    for run in p._p.findall(qn("w:r")):
        for child in run:
            if child.tag == qn("w:tab"):
                return True
            if child.tag == qn("w:t"):
                return False
    return False


def build_paragraph(model_p, text: str, lead_tab: bool):
    """A new paragraph carrying the model's pPr and the run properties recorded
    on its paragraph mark, which is what the model's own runs use."""
    new = copy.deepcopy(model_p)
    for attr in (qn("w14:paraId"), qn("w14:textId")):
        if attr in new.attrib:
            del new.attrib[attr]

    ppr = new.find(qn("w:pPr"))
    for child in list(new):
        if child.tag != qn("w:pPr"):
            new.remove(child)

    run = new.makeelement(qn("w:r"), {})
    rpr = ppr.find(qn("w:rPr")) if ppr is not None else None
    if rpr is not None:
        clone = copy.deepcopy(rpr)
        for unwanted in clone.findall(qn("w:b")) + clone.findall(qn("w:bCs")):
            clone.remove(unwanted)
        run.append(clone)
    if lead_tab:
        run.append(new.makeelement(qn("w:tab"), {}))
    t = new.makeelement(qn("w:t"), {})
    t.text = text
    t.set(qn("xml:space"), "preserve")
    run.append(t)
    new.append(run)
    return new


def replace_text(p, text: str) -> bool:
    """Put the whole replacement into the first run and empty the rest, keeping
    the run formatting and any leading tab already present."""
    runs = p._p.findall(qn("w:r"))
    target = None
    for run in runs:
        if run.find(qn("w:t")) is not None:
            target = run
            break
    if target is None:
        return False
    first = target.find(qn("w:t"))
    first.text = text
    first.set(qn("xml:space"), "preserve")
    for run in runs:
        for t in run.findall(qn("w:t")):
            if t is not first:
                t.text = ""
    return True


def find(doc, needle: str):
    hits = [p for p in doc.paragraphs if needle in p.text]
    if len(hits) != 1:
        raise SystemExit(f"anchor matched {len(hits)} paragraphs: {needle!r}")
    return hits[0]


def main() -> int:
    path = sys.argv[1]
    doc = docx.Document(path)

    inserted = replaced = 0
    for needle, mode, paragraphs in D.OPERATIONS:
        anchor = find(doc, needle)

        if mode == "replace":
            if not replace_text(anchor, paragraphs[0]):
                raise SystemExit(f"nothing to replace at: {needle!r}")
            replaced += 1
            print(f"  replaced  {needle[:58]}")
            continue

        lead_tab = has_leading_tab(anchor)
        built = [build_paragraph(anchor._p, text, lead_tab) for text in paragraphs]
        if mode == "after":
            cursor = anchor._p
            for new in built:
                cursor.addnext(new)
                cursor = new
        elif mode == "before":
            for new in built:
                anchor._p.addprevious(new)
        else:
            raise SystemExit(f"unknown mode {mode!r}")
        inserted += len(built)
        print(f"  +{len(built):d} {mode:7s} {needle[:52]}")

    doc.save(path)
    words = sum(len(t.split()) for _, _, ps in D.OPERATIONS for t in ps)
    print(f"\n  paragraphs inserted : {inserted}")
    print(f"  paragraphs replaced : {replaced}")
    print(f"  words written       : {words}")
    return 0


sys.exit(main())
