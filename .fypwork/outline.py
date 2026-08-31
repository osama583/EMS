import docx
p = r"C:\Users\natsu\Downloads\Osamah_Ahmed_Moahmmed_Al-Naggar-TP078781-APD3F2601CS-FYP_2 - Copy.docx"
d = docx.Document(p)
for i, par in enumerate(d.paragraphs):
    s = par.style.name
    t = par.text.strip()
    if s.startswith("Heading") or s == "Caption" or s == "table of figures":
        print(f"{i:4d} [{s:16s}] {t[:150]}")
