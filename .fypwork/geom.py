import docx
from docx.shared import Emu
p = r"C:\Users\natsu\Downloads\Osamah_Ahmed_Moahmmed_Al-Naggar-TP078781-APD3F2601CS-FYP_2 - Copy.docx"
d = docx.Document(p)
for i,s in enumerate(d.sections):
    tw = s.page_width - s.left_margin - s.right_margin
    print(f"section {i}: page {s.page_width/914400:.2f}x{s.page_height/914400:.2f}in  "
          f"margins L{s.left_margin/914400:.2f} R{s.right_margin/914400:.2f} T{s.top_margin/914400:.2f} B{s.bottom_margin/914400:.2f}  "
          f"=> text width {tw/914400:.3f}in ({tw} EMU, {tw/635:.0f} dxa)  orient={s.orientation}")
print()
print("Normal style font:", d.styles['Normal'].font.name, d.styles['Normal'].font.size)
for sn in ['Heading 1','Heading 2','Heading 3','Heading 4','Caption']:
    st=d.styles[sn]; print(f"{sn}: font={st.font.name} size={st.font.size} bold={st.font.bold}")
