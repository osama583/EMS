"""Force every page and table in built.docx onto A4 portrait.

Only geometry is touched: page size of the one landscape section, and the
width/columns/padding of the three tables that overrun the A4 text area.
No text, no styles, no images are modified.
"""
from docx import Document
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

DOC = r"c:\Users\natsu\Desktop\Osama\.fypwork\built.docx"

A4_W, A4_H = 11906, 16838
MARGIN = 1440
TEXTW = A4_W - 2 * MARGIN            # 9026 twips

doc = Document(DOC)
body = doc.element.body
changes = []

# ---- 1. every section becomes A4 portrait -------------------------------
for i, sectPr in enumerate(body.iter(qn('w:sectPr'))):
    pgSz = sectPr.find(qn('w:pgSz'))
    if pgSz is None:
        continue
    was = (pgSz.get(qn('w:w')), pgSz.get(qn('w:h')), pgSz.get(qn('w:orient')))
    pgSz.set(qn('w:w'), str(A4_W))
    pgSz.set(qn('w:h'), str(A4_H))
    if pgSz.get(qn('w:orient')) is not None:
        del pgSz.attrib[qn('w:orient')]
    now = (pgSz.get(qn('w:w')), pgSz.get(qn('w:h')), pgSz.get(qn('w:orient')))
    if was != now:
        changes.append(f"section {i}: pgSz {was} -> {now}")

# ---- 2. refit the over-wide tables --------------------------------------
def set_cell_margins(tblPr, twips):
    mar = tblPr.find(qn('w:tblCellMar'))
    if mar is None:
        mar = OxmlElement('w:tblCellMar')
        tblPr.append(mar)
    for side in ('w:left', 'w:right'):
        el = mar.find(qn(side))
        if el is None:
            el = OxmlElement(side)
            mar.append(el)
        el.set(qn('w:w'), str(twips))
        el.set(qn('w:type'), 'dxa')


def refit(tbl, widths, cell_margin=None, repeat_header=False):
    assert sum(widths) == TEXTW, sum(widths)
    tblPr = tbl.tblPr

    tblW = tblPr.find(qn('w:tblW'))
    if tblW is None:
        tblW = OxmlElement('w:tblW'); tblPr.append(tblW)
    tblW.set(qn('w:w'), str(TEXTW)); tblW.set(qn('w:type'), 'dxa')

    ind = tblPr.find(qn('w:tblInd'))
    if ind is not None:
        ind.set(qn('w:w'), '0'); ind.set(qn('w:type'), 'dxa')

    grid = tbl.find(qn('w:tblGrid'))
    for col, w in zip(grid.findall(qn('w:gridCol')), widths):
        col.set(qn('w:w'), str(w))

    for tr in tbl.findall(qn('w:tr')):
        for tc, w in zip(tr.findall(qn('w:tc')), widths):
            tcPr = tc.find(qn('w:tcPr'))
            tcW = tcPr.find(qn('w:tcW')) if tcPr is not None else None
            if tcW is not None:
                tcW.set(qn('w:w'), str(w)); tcW.set(qn('w:type'), 'dxa')

    if cell_margin is not None:
        set_cell_margins(tblPr, cell_margin)

    if repeat_header:
        tr = tbl.findall(qn('w:tr'))[0]
        trPr = tr.find(qn('w:trPr'))
        if trPr is None:
            trPr = OxmlElement('w:trPr'); tr.insert(0, trPr)
        if trPr.find(qn('w:tblHeader')) is None:
            trPr.append(OxmlElement('w:tblHeader'))


tables = doc.tables

# cover page layout table (2 equal cells, holds the logos)
refit(tables[0]._tbl, [4513, 4513])
changes.append("table 0 (cover): 9200 -> 9026")

# declaration signature table
refit(tables[1]._tbl, [2860, 6166])
changes.append("table 1 (declaration): 9287 -> 9026")

# Table 2: SIMILAR SYSTEM - the landscape one.
# Columns reallocated by content volume rather than scaled proportionally:
# Research Name/Author | Description | Methods | Gaps | Improvements
refit(tables[4]._tbl, [1700, 2050, 1150, 2050, 2076],
      cell_margin=57, repeat_header=True)
changes.append("table 4 (Table 2 SIMILAR SYSTEM): 14743 -> 9026, "
               "cell padding 10 -> 57, header row set to repeat")

doc.save(DOC)
print("\n".join(changes))
