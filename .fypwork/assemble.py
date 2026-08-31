"""Complete the FYP report: repair the numbering, then write 4.5 to Chapter 6.

Run order matters. The repairs come first because the new material is numbered
by the same SEQ sequence they belong to, and a caption that is invisible to the
sequence would shift every figure after it.
"""
from __future__ import annotations

import os
import re
import shutil
import sys

import docx
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls, qn
from docx.text.paragraph import Paragraph

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docxkit import Builder, TNR, TEXT_WIDTH, _esc                      # noqa: E402
import content_45_ad as A, content_45_eh as E, content_45_il as I   # noqa: E402
import content_46 as C46                                    # noqa: E402
import content_ch5 as C5                                    # noqa: E402
import content_ch5_uat as UAT                                # noqa: E402
import content_ch6 as C6                                    # noqa: E402

# The pristine chapters 1 to 4.4 document, kept beside this script. Deliberately
# NOT the delivery path: reading back a delivered file appends everything twice.
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pristine.docx")
SHOTS = r"C:\Users\natsu\Desktop\Osama\ui png\Implementation"
CODES = r"C:\Users\natsu\Desktop\Osama\ui png\Sample Codes"

BM_ID = [6000]          # bookmark ids, kept clear of the document's own


# --- repairs ----------------------------------------------------------------
def caption_xml(kind: str, text: str, bookmark: str | None) -> str:
    """Caption runs with a live SEQ field. The bookmark spans only the label and
    the number, which is what lets a cross-reference render as "Figure 12"
    rather than repeating the whole caption."""
    rpr = f'<w:rPr>{TNR}<w:b/><w:bCs/></w:rPr>'
    bid = BM_ID[0]
    BM_ID[0] += 1
    start = f'<w:bookmarkStart w:id="{bid}" w:name="{bookmark}"/>' if bookmark else ''
    end = f'<w:bookmarkEnd w:id="{bid}"/>' if bookmark else ''
    return (
        f'{start}'
        f'<w:r>{rpr}<w:t xml:space="preserve">{kind} </w:t></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="begin"/></w:r>'
        f'<w:r>{rpr}<w:instrText xml:space="preserve"> SEQ {kind} \\* ARABIC </w:instrText></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="separate"/></w:r>'
        f'<w:r><w:rPr>{TNR}<w:b/><w:bCs/><w:noProof/></w:rPr><w:t>1</w:t></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="end"/></w:r>'
        f'{end}'
        f'<w:r>{rpr}<w:t xml:space="preserve">: {_esc(text)}</w:t></w:r>'
    )


def make_caption_paragraph(kind: str, text: str, bookmark: str | None = None):
    rpr = f'<w:rPr>{TNR}<w:b/><w:bCs/></w:rPr>'
    ppr = (f'<w:pPr><w:pStyle w:val="Caption"/>'
           f'<w:spacing w:line="360" w:lineRule="auto"/>'
           f'<w:jc w:val="center"/>{rpr}</w:pPr>')
    return parse_xml(f'<w:p {nsdecls("w")}>{ppr}{caption_xml(kind, text, bookmark)}</w:p>')


def ref_field_xml(bookmark: str, cached: str) -> str:
    """A cross-reference that follows the figure rather than naming a number."""
    rpr = f'<w:rPr>{TNR}</w:rPr>'
    return (
        f'<w:r>{rpr}<w:fldChar w:fldCharType="begin"/></w:r>'
        f'<w:r>{rpr}<w:instrText xml:space="preserve"> REF {bookmark} \\h </w:instrText></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="separate"/></w:r>'
        f'<w:r><w:rPr>{TNR}<w:noProof/></w:rPr><w:t>{cached}</w:t></w:r>'
        f'<w:r>{rpr}<w:fldChar w:fldCharType="end"/></w:r>'
    )


def repair_orphan_captions(doc):
    """Three Chapter 2 captions were typed as ordinary text in Normal style.

    They are the reason the report's own figure numbers disagree with its List
    of Figures: the list is built from Caption paragraphs, so a caption that is
    not one is invisible to it and every figure after it is counted short.
    """
    wanted = {
        "Figure 5:": "Visual Studio Code logo WebCatalog (n.d.).",
        "Figure 6:": "Angular logo Angular Press Kit (n.d.).",
        "Figure 8:": "PostgreSQL data access through Supabase",
    }
    fixed = 0
    for ch in list(doc.element.body):
        if ch.tag != qn('w:p'):
            continue
        par = Paragraph(ch, doc)
        if par.style.name != 'Normal':      # 'table of figures' is the LoF itself
            continue
        text = par.text.strip()
        for prefix, caption in wanted.items():
            if text.startswith(prefix):
                ch.addprevious(make_caption_paragraph("Figure", caption))
                ch.getparent().remove(ch)
                fixed += 1
                break
    return fixed


def repair_broken_table_caption(doc):
    """Table 4's caption carries a stray line break and a bare SEQ field, so it
    renders as "Table" on one line and its title on the next."""
    for ch in list(doc.element.body):
        if ch.tag != qn('w:p'):
            continue
        par = Paragraph(ch, doc)
        if par.style.name != 'Caption':
            continue
        text = par.text.strip()
        if text.startswith("Table") and "Comparative Analysis" in text:
            ch.addprevious(make_caption_paragraph(
                "Table", "Comparative Analysis of Software Development Methodologies."))
            ch.getparent().remove(ch)
            return True
    return False


def retire_outdated_stack(doc):
    """Chapter 4 documents PostgreSQL and Supabase in detail. Two earlier lines
    still name MySQL and AWS and contradict it on the same read-through."""
    swaps = [
        ("(Angular, Flask, MySQL, AWS)", "(Angular, Flask, PostgreSQL on Supabase)"),
        ("complex backend components such as Flask and MySQL",
         "complex backend components such as Flask and PostgreSQL"),
    ]
    done = []
    for ch in doc.element.body.iter(qn('w:p')):
        nodes = [n for n in ch.iter(qn('w:t')) if n.text]
        if not nodes:
            continue
        joined = "".join(n.text for n in nodes)
        for old, new in swaps:
            if old not in joined:
                continue
            joined = joined.replace(old, new)
            nodes[0].text = joined
            nodes[0].set(qn('xml:space'), 'preserve')
            for extra in nodes[1:]:
                extra.text = ''
            done.append(old)
            break
    return done


def bookmark_existing_captions(doc):
    """Give every Chapter 4 figure caption a bookmark over its label and number,
    so the prose can point at the figure instead of quoting a number that will
    be wrong the moment anything is inserted before it."""
    marks = {}
    seq = 0
    for ch in doc.element.body.iter(qn('w:p')):
        par = Paragraph(ch, doc)
        if par.style.name != 'Caption':
            continue
        if not par.text.strip().startswith("Figure"):
            continue
        if not any('SEQ Figure' in (n.text or '') for n in ch.iter(qn('w:instrText'))):
            continue
        seq += 1
        number = seq
        # Only Chapter 4's own diagrams, which the prose cross-references.
        if not (29 <= number <= 54):
            continue
        name = f"_Ref_fig_{number}"
        runs = list(ch)
        # wrap label + SEQ field: from the first run to the field end
        first = None
        end_run = None
        for node in runs:
            if node.tag != qn('w:r'):
                continue
            if first is None:
                first = node
            fld = node.find(qn('w:fldChar'))
            if fld is not None and fld.get(qn('w:fldCharType')) == 'end':
                end_run = node
                break
        if first is None or end_run is None:
            continue
        bid = BM_ID[0]
        BM_ID[0] += 1
        first.addprevious(parse_xml(
            f'<w:bookmarkStart {nsdecls("w")} w:id="{bid}" w:name="{name}"/>'))
        end_run.addnext(parse_xml(f'<w:bookmarkEnd {nsdecls("w")} w:id="{bid}"/>'))
        marks[number] = name
    return marks


def normalise_image_rows(doc):
    """Make every side-by-side figure sit level and inside the text column.

    Two figures predate this pass: a pair of logos placed at different heights,
    and the screen-anatomy figure, which was 6.78 in wide in a 6.27 in column and
    so ran into the right margin. Both are corrected here by scaling to a shared
    height, which keeps each image's own aspect ratio.
    """
    A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
    changed = 0
    for tbl in doc.element.body.iter(qn('w:tbl')):
        rows = tbl.findall(qn('w:tr'))
        extents = tbl.findall(f'.//{{{WP}}}extent')
        if len(rows) != 1 or len(extents) != 2:
            continue
        sizes = [(int(e.get('cx')), int(e.get('cy'))) for e in extents]
        height = min(cy for _, cy in sizes)
        widths = [round(cx * height / cy) for cx, cy in sizes]
        if sum(widths) > TEXT_WIDTH:
            scale = TEXT_WIDTH / sum(widths)
            height = round(height * scale)
            widths = [round(w * scale) for w in widths]
        if all(sizes[i] == (widths[i], height) for i in range(2)):
            continue                     # already level and inside the column
        for extent, width in zip(extents, widths):
            extent.set('cx', str(width))
            extent.set('cy', str(height))
            drawing = extent.getparent()
            for ext in drawing.findall(f'.//{{{A}}}ext'):
                ext.set('cx', str(width))
                ext.set('cy', str(height))
        cells = tbl.findall(f'.//{qn("w:tc")}')
        for cell, width in zip(cells, widths):
            tc_pr = cell.find(qn('w:tcPr'))
            if tc_pr is None:
                tc_pr = parse_xml(f'<w:tcPr {nsdecls("w")}/>')
                cell.insert(0, tc_pr)
            for old in tc_pr.findall(qn('w:vAlign')):
                tc_pr.remove(old)
            tc_pr.append(parse_xml(f'<w:vAlign {nsdecls("w")} w:val="center"/>'))
            for para in cell.findall(qn('w:p')):
                p_pr = para.find(qn('w:pPr'))
                if p_pr is None:
                    p_pr = parse_xml(f'<w:pPr {nsdecls("w")}/>')
                    para.insert(0, p_pr)
                for old in p_pr.findall(qn('w:jc')):
                    p_pr.remove(old)
                p_pr.append(parse_xml(f'<w:jc {nsdecls("w")} w:val="center"/>'))
        tbl_pr = tbl.find(qn('w:tblPr'))
        if tbl_pr is not None:
            for old in tbl_pr.findall(qn('w:jc')):
                tbl_pr.remove(old)
            tbl_pr.append(parse_xml(f'<w:jc {nsdecls("w")} w:val="center"/>'))
        changed += 1
    return changed


def link_demographic_table(doc):
    """The appendix note points at "Table 3"; that table is now much later in
    the sequence. Point it at the caption instead of at a number."""
    target = None
    seq = 0
    for ch in list(doc.element.body):
        if ch.tag != qn('w:p'):
            continue
        par = Paragraph(ch, doc)
        if par.style.name == 'Caption' and par.text.strip().startswith("Table"):
            seq += 1
            if "Respondent Demographic Profile" in par.text:
                target = ch
    if target is None:
        return False
    name = "_Ref_tbl_demographic"
    first = end_run = None
    for node in list(target):
        if node.tag != qn('w:r'):
            continue
        if first is None:
            first = node
        fld = node.find(qn('w:fldChar'))
        if fld is not None and fld.get(qn('w:fldCharType')) == 'end':
            end_run = node
            break
    if first is None or end_run is None:
        return False
    bid = BM_ID[0]
    BM_ID[0] += 1
    first.addprevious(parse_xml(
        f'<w:bookmarkStart {nsdecls("w")} w:id="{bid}" w:name="{name}"/>'))
    end_run.addnext(parse_xml(f'<w:bookmarkEnd {nsdecls("w")} w:id="{bid}"/>'))

    for ch in list(doc.element.body):
        if ch.tag != qn('w:p'):
            continue
        for run in list(ch.findall(qn('w:r'))):
            t = run.find(qn('w:t'))
            if t is None or not t.text or "presents the demographic profile" not in t.text:
                continue
            m = re.search(r'\bTable\s+\d+\b', t.text)
            if not m:
                continue
            before, after = t.text[:m.start()], t.text[m.end():]
            rpr = run.find(qn('w:rPr'))
            rpr_xml = (re.sub(r'\sxmlns:\w+="[^"]*"', '', rpr.xml)
                       if rpr is not None else f'<w:rPr>{TNR}</w:rPr>')
            frag = ''
            if before:
                frag += f'<w:r>{rpr_xml}<w:t xml:space="preserve">{_esc(before)}</w:t></w:r>'
            frag += ref_field_xml(name, "Table 52")
            if after:
                frag += f'<w:r>{rpr_xml}<w:t xml:space="preserve">{_esc(after)}</w:t></w:r>'
            holder = parse_xml(f'<w:p {nsdecls("w")}>{frag}</w:p>')
            for node in list(holder):
                run.addprevious(node)
            run.getparent().remove(run)
            return True
    return False


def linkify_prose(doc, marks):
    """Replace a typed "Figure 41" in the prose with a live cross-reference."""
    pattern = re.compile(r'\bFigure\s+(\d+)\b')
    changed = 0
    for ch in list(doc.element.body.iter(qn('w:p'))):
        par = Paragraph(ch, doc)
        if par.style.name in ('Caption', 'table of figures'):
            continue
        for run in list(ch.findall(qn('w:r'))):
            t = run.find(qn('w:t'))
            if t is None or not t.text:
                continue
            m = pattern.search(t.text)
            if not m or int(m.group(1)) not in marks:
                continue
            number = int(m.group(1))
            before, after = t.text[:m.start()], t.text[m.end():]
            rpr = run.find(qn('w:rPr'))
            rpr_xml = re.sub(r'\sxmlns:\w+="[^"]*"', '', rpr.xml) if rpr is not None else f'<w:rPr>{TNR}</w:rPr>'
            frag = ''
            if before:
                frag += (f'<w:r>{rpr_xml}<w:t xml:space="preserve">{_esc(before)}</w:t></w:r>')
            frag += ref_field_xml(marks[number], f"Figure {number}")
            if after:
                frag += (f'<w:r>{rpr_xml}<w:t xml:space="preserve">{_esc(after)}</w:t></w:r>')
            holder = parse_xml(f'<w:p {nsdecls("w")}>{frag}</w:p>')
            for node in list(holder):
                run.addprevious(node)
            run.getparent().remove(run)
            changed += 1
    return changed


# --- new material -----------------------------------------------------------
def shot(group_folder: str, figure_folder: str) -> tuple[str, str]:
    base = os.path.join(SHOTS, group_folder, figure_folder)
    return os.path.join(base, "desktop.png"), os.path.join(base, "mobile.png")


def write_group(b: Builder, group: dict):
    b.heading(f"{group['number']} {group['title']}", 3)
    for para in group["intro"]:
        b.body_text(para)
    for idx, (folder, title, caption, paragraphs) in enumerate(group["figures"], 1):
        desktop, mobile = shot(group["folder"], folder)
        if not (os.path.exists(desktop) and os.path.exists(mobile)):
            raise SystemExit(f"missing capture: {desktop}")
        b.heading(f"{group['number']}.{idx} {title}", 4)
        b.figure_pair(desktop, mobile)
        b.caption("Figure", caption)
        for para in paragraphs:
            b.body_text(para)


def write_section_45(b: Builder):
    b.page_break()
    b.heading("4.5 Implementation", 2)
    for para in [
        "This section presents the delivered system. It contains sixty-four "
        "figures, each captured from the running application rather than from a "
        "prototype, and each showing a screen that the preceding sections have "
        "described in the abstract. Together they cover the whole functional "
        "surface of the platform: the public tier, attendance, the application "
        "shell, proposal submission, tracking and review, departmental task "
        "handling, the cafeteria and clubs modules, the role dashboards, event "
        "registrations, system administration and the AI assistant.",
        "Every figure is a pair. The left pane is the screen at a desktop "
        "viewport of 1440 by 900 pixels captured at twice that resolution, and "
        "the right pane is the same screen on a mobile device at 390 by 844 "
        "pixels captured at three times that resolution. Both are viewport "
        "captures rather than full-page ones, so each is a single screen as a "
        "user would actually see it, with the sticky top bar at the top and the "
        "assistant launcher in the lower right where they belong. Presenting "
        "both in every figure rather than in a separate responsiveness section "
        "is deliberate: responsive behaviour is a property of each screen, and "
        "showing it once for a representative page would say nothing about the "
        "rest.",
        "Where a screen carries a strip of tabs that are the same component "
        "pointed at different data, one tab is captured and the caption and text "
        "name the others rather than repeating a near-identical figure for each. "
        "This is stated explicitly wherever it applies, so that the coverage of "
        "the section can be checked against the application without the reader "
        "having to assume anything.",
        "The figures are grouped by subsystem in the order a user meets them. "
        "The account each screen was captured as is stated in the text, because "
        "the same page renders differently for different roles and a figure "
        "without that context would be ambiguous.",
    ]:
        b.body_text(para)
    for group in (A.GROUP_A, A.GROUP_B, A.GROUP_C, A.GROUP_D,
                  E.GROUP_E, E.GROUP_F, E.GROUP_G, E.GROUP_H,
                  I.GROUP_I, I.GROUP_J, I.GROUP_K, I.GROUP_L):
        write_group(b, group)


def write_section_46(b: Builder):
    b.page_break()
    b.heading("4.6 Sample Codes", 2)
    for para in C46.INTRO:
        b.body_text(para)
    for idx, (filename, program, location, caption, paragraphs) in enumerate(C46.FIGURES, 1):
        path = os.path.join(CODES, filename)
        if not os.path.exists(path):
            raise SystemExit(f"missing listing: {path}")
        b.heading(f"4.6.{idx} Name of program: {program}", 3)
        b.body_text(f"Source: {location}.", indent_first=False, keep_next=True)
        b.figure_single(path)
        b.caption("Figure", caption)
        for para in paragraphs:
            b.body_text(para)
    b.page_break()
    b.heading("4.7 Summary", 2)
    for para in C46.SUMMARY:
        b.body_text(para)


def uat_block(b: Builder, tester: dict, index: int):
    b.plain("User Acceptance Testing")
    b.data_table([["Tester demographic profile", ""],
                  ["Name", tester["name"]],
                  ["Age", tester["age"]],
                  ["Role in the system", tester["role"]]],
                 widths=[3000, 6026], size=18)
    b.caption("Table", f"User Acceptance Testing — {tester['label']}")
    for line in UAT.UAT_SCALE:
        b.plain(line, compact=True)
    rows = [["", "User interface criteria", "1", "2", "3", "4", "5"]]
    for roman, criterion, rating in zip(UAT.ROMAN, UAT.UI_CRITERIA, tester["ui"]):
        marks = ["/" if n == rating else "" for n in range(1, 6)]
        rows.append([roman, criterion] + marks)
    b.data_table(rows, widths=[600, 5426, 600, 600, 600, 600, 600], size=18)
    b.caption("Table", f"Interface Criteria Ratings — {tester['label']}")
    rows = [["", "Functionality criteria", "Yes", "No"]]
    for roman, criterion, ok in zip(UAT.ROMAN, UAT.FUNC_CRITERIA, tester["func"]):
        rows.append([roman, criterion, "/" if ok else "", "" if ok else "/"])
    b.data_table(rows, widths=[600, 6426, 1000, 1000], size=18)
    b.caption("Table", f"Functionality Criteria Responses — {tester['label']}")
    b.data_table([["Tester comment:"], [tester["comment"]]],
                 widths=[9026], header=False, size=18)
    b.caption("Table", f"Tester Comment — {tester['label']}")
    b.plain()


def write_chapter_5(b: Builder):
    b.page_break()
    b.heading("CHAPTER 5: RESULTS AND DISCUSSIONS", 1)
    b.heading("5.1 Introduction", 2)
    for para in C5.INTRO:
        b.body_text(para)

    b.heading("5.2 Test Plan", 2)
    for para in C5.PLAN_INTRO:
        b.body_text(para)

    b.heading("5.2.1 Unit Testing", 3)
    for para in C5.UNIT_PLAN:
        b.body_text(para)
    b.data_table(C5.MODULE_COVERAGE, widths=[2700, 6326], size=16)
    b.caption("Table", "Unit testing coverage by feature area")

    b.heading("5.2.2 User Acceptance Testing (UAT)", 3)
    for para in UAT.UAT_PLAN:
        b.body_text(para)
    b.plain("User Acceptance Testing")
    b.data_table([["Tester demographic profile", ""], ["Name", ""],
                  ["Age", ""], ["Role in the system", ""]],
                 widths=[3000, 6026], size=18)
    b.caption("Table", "User acceptance testing instrument — tester profile")
    for line in UAT.UAT_SCALE:
        b.plain(line, compact=True)
    rows = [["", "User interface criteria", "1", "2", "3", "4", "5"]]
    for roman, criterion in zip(UAT.ROMAN, UAT.UI_CRITERIA):
        rows.append([roman, criterion, "", "", "", "", ""])
    b.data_table(rows, widths=[600, 5426, 600, 600, 600, 600, 600], size=18)
    b.caption("Table", "User acceptance testing instrument — interface criteria")
    rows = [["", "Functionality criteria", "Yes", "No"]]
    for roman, criterion in zip(UAT.ROMAN, UAT.FUNC_CRITERIA):
        rows.append([roman, criterion, "", ""])
    b.data_table(rows, widths=[600, 6426, 1000, 1000], size=18)
    b.caption("Table", "User acceptance testing instrument — functionality criteria")
    b.data_table([["Tester comment:"], [""]], widths=[9026], header=False)
    b.caption("Table", "User acceptance testing instrument — tester comment")
    b.plain()

    b.page_break()
    b.heading("5.3 Testing Results and Discussion", 2)
    b.heading("5.3.1 Unit Testing", 3)
    for para in C5.RESULTS_INTRO:
        b.body_text(para)
    b.data_table(C5.RESULTS_TOTALS,
                 widths=[3626, 1300, 1300, 1300, 1500], size=18)
    b.caption("Table", "Unit testing results by feature area")
    for heading, short, rows, discussion in C5.PARTS:
        b.body_text(heading, indent_first=False)
        b.data_table([C5.TC_HEADER] + rows,
                     widths=[1050, 1150, 1650, 1300, 1500, 1476, 900], size=15)
        b.caption("Table", f"Unit Test Cases — {short}")
        b.body_text(discussion)

    for para in C5.UNIT_DISCUSSION:
        b.body_text(para)

    b.page_break()
    b.heading("5.3.2 User Acceptance Testing", 3)
    for para in UAT.UAT_RESULTS_INTRO:
        b.body_text(para)
    for idx, tester in enumerate(UAT.TESTERS, 1):
        uat_block(b, tester, idx)
    for para in UAT.UAT_DISCUSSION:
        b.body_text(para)

    b.heading("5.4 Summary", 2)
    for para in C5.SUMMARY:
        b.body_text(para)


def write_chapter_6(b: Builder):
    b.page_break()
    b.heading("CHAPTER 6: CONCLUSION", 1)
    for para in C6.INTRO:
        b.body_text(para)

    b.heading("6.1 Critical Evaluation", 2)
    for para in C6.EVAL_INTRO:
        b.body_text(para)
    for title, paragraphs in C6.OBJECTIVES:
        b.body_text(title, indent_first=False)
        for para in paragraphs:
            b.body_text(para)
    b.body_text("Contribution", indent_first=False)
    for para in C6.CONTRIBUTION:
        b.body_text(para)
    b.body_text("Strengths of the project", indent_first=False)
    for para in C6.STRENGTHS:
        b.body_text(para)

    b.heading("6.2 Limitation", 2)
    b.body_text(
        "The following limitations are stated as they are rather than as they "
        "would ideally read. Each is either a consequence of a decision taken "
        "with reasons, or a finding the testing in Chapter 5 produced.")
    for title, para in C6.LIMITATIONS:
        b.body_text(title, indent_first=False)
        b.body_text(para)

    b.heading("6.3 Recommendation", 2)
    b.body_text(
        "The recommendations below are ordered by the value they would add "
        "relative to the effort they would take, beginning with the two that "
        "follow directly from the limitations above.")
    for title, para in C6.RECOMMENDATIONS:
        b.body_text(title, indent_first=False)
        b.body_text(para)
    for para in C6.CLOSING:
        b.body_text(para)


def force_field_update(doc):
    """Ask Word to recalculate every field when the document is opened, which is
    what rebuilds the contents, the List of Figures and the List of Tables with
    correct numbers and working links."""
    settings = doc.settings.element
    for existing in settings.findall(qn('w:updateFields')):
        settings.remove(existing)
    settings.append(parse_xml(f'<w:updateFields {nsdecls("w")} w:val="true"/>'))


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "built.docx"
    shutil.copyfile(SRC, out)
    doc = docx.Document(out)
    if any(p.text.strip() == "4.5 Implementation" for p in doc.paragraphs):
        raise SystemExit("source already contains 4.5 - refusing to append twice")

    print("repairing numbering")
    print("  orphan captions restored :", repair_orphan_captions(doc))
    print("  broken table caption     :", repair_broken_table_caption(doc))
    print("  outdated stack references:", retire_outdated_stack(doc))
    marks = bookmark_existing_captions(doc)
    print("  captions bookmarked      :", len(marks))
    print("  prose cross-references   :", linkify_prose(doc, marks))
    print("  demographic table linked :", link_demographic_table(doc))

    # Top-level children only. The table of contents is a content control that
    # holds its own "REFERENCE:" entry, and anchoring on that would file the
    # whole of Chapters 5 and 6 inside the table of contents.
    anchor = None
    for ch in list(doc.element.body):
        if ch.tag != qn('w:p'):
            continue
        par = Paragraph(ch, doc)
        if par.style.name == 'Heading 1' and par.text.strip().startswith("REFERENCE"):
            anchor = ch
            break
    if anchor is None:
        raise SystemExit("could not find the REFERENCE heading")
    assert anchor.getparent() is doc.element.body, "anchor is not a top-level block"

    print("writing new material")
    b = Builder(doc)
    write_section_45(b)
    write_section_46(b)
    write_chapter_5(b)
    write_chapter_6(b)
    print("  blocks added             :", len(b.added))
    b.move_before(anchor)

    print("  figure rows levelled     :", normalise_image_rows(doc))

    force_field_update(doc)
    doc.save(out)
    print("saved", out)


if __name__ == "__main__":
    main()
