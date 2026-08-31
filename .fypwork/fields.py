import docx, re
from docx.oxml.ns import qn
p = r"C:\Users\natsu\Downloads\Osamah_Ahmed_Moahmmed_Al-Naggar-TP078781-APD3F2601CS-FYP_2 - Copy.docx"
d = docx.Document(p)
print("=== instrText field codes in document ===")
seen={}
for it in d.element.body.iter(qn('w:instrText')):
    t=(it.text or '').strip()
    seen[t]=seen.get(t,0)+1
for k,v in seen.items(): print(f"  x{v}: {k!r}")
print("\n=== fldSimple ===")
for fs in d.element.body.iter(qn('w:fldSimple')):
    print("  ", fs.get(qn('w:instr')))
print("\n=== hyperlinks with anchor ===")
n=0
for h in d.element.body.iter(qn('w:hyperlink')):
    a=h.get(qn('w:anchor'))
    if a: n+=1
print("  anchored hyperlinks:", n)
print("\n=== bookmarks ===")
bms=[b.get(qn('w:name')) for b in d.element.body.iter(qn('w:bookmarkStart'))]
print("  count:", len(bms))
print("  sample:", bms[:40])
