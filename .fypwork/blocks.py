import docx
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
p = r"C:\Users\natsu\Downloads\Osamah_Ahmed_Moahmmed_Al-Naggar-TP078781-APD3F2601CS-FYP_2 - Copy.docx"
d = docx.Document(p)
body = d.element.body
for i, ch in enumerate(body):
    if ch.tag == qn('w:p'):
        par = Paragraph(ch, d)
        if i < 700: continue
        img = len(ch.findall('.//'+qn('a:blip')))
        print(f"{i:4d} P  [{par.style.name[:14]:14s}] img={img} {par.text.strip()[:110]}")
    elif ch.tag == qn('w:tbl'):
        t = Table(ch, d)
        if i < 700: continue
        img = len(ch.findall('.//'+qn('a:blip')))
        print(f"{i:4d} TBL rows={len(t.rows)} cols={len(t.columns)} img={img} :: {t.rows[0].cells[0].text.strip()[:60]!r}")
