import docx, sys, re
from docx.oxml.ns import qn
p = r"C:\Users\natsu\Downloads\Osamah_Ahmed_Moahmmed_Al-Naggar-TP078781-APD3F2601CS-FYP_2 - Copy.docx"
d = docx.Document(p)
body = d.element.body
idx = int(sys.argv[1])
x = body[idx].xml
x = re.sub(r'>\s*<', '>\n<', x)
print(x[:int(sys.argv[2]) if len(sys.argv)>2 else 6000])
