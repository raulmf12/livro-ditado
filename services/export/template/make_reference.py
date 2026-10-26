"""Gera o modelo Word do livro (F1.22): services/export/template/reference.docx.

Parte do modelo padrão do Pandoc (que já tem todos os estilos que ele usa) e
ajusta para o padrão do livro, seguindo a ABNT (NBR 14724 e NBR 10520):
  - A4, margens 3 cm (superior e esquerda) e 2 cm (inferior e direita)
  - corpo Times New Roman 12, entrelinha 1,5, recuo de primeira linha 1,25 cm, justificado
  - títulos 1 a 3 em negrito; capítulo começa em página nova
  - citação longa: recuo de 4 cm, fonte 10, espaço simples, sem recuo de primeira linha
  - nota de rodapé: fonte 10, espaço simples
  - "Inserido IA": realce amarelo, para revisar o que veio da pesquisa (fase 2)

Uso: python make_reference.py   (precisa de python-docx e pypandoc_binary)
"""

from pathlib import Path
import subprocess
import tempfile

import pypandoc
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_COLOR_INDEX, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

HERE = Path(__file__).parent
OUT = HERE / "reference.docx"
FONT = "Times New Roman"


def set_font(style, size, bold=None, italic=None):
    style.font.name = FONT
    style.font.size = Pt(size)
    style.font.color.rgb = RGBColor(0, 0, 0)
    if bold is not None:
        style.font.bold = bold
    if italic is not None:
        style.font.italic = italic
    # garante a fonte também para caracteres "east asia" e afins
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.append(fonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(attr), FONT)
    for theme in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
        fonts.attrib.pop(qn(theme), None)


def body(style):
    set_font(style, 12)
    pf = style.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.first_line_indent = Cm(1.25)
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    pf.space_before = Pt(0)
    pf.space_after = Pt(0)


def get_or_add(doc, name, kind):
    try:
        return doc.styles[name]
    except KeyError:
        return doc.styles.add_style(name, kind)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        default = Path(tmp) / "default.docx"
        pandoc = pypandoc.get_pandoc_path()
        subprocess.run([pandoc, "-o", str(default), "--print-default-data-file", "reference.docx"], check=True)
        doc = Document(default)

    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.top_margin, section.left_margin = Cm(3), Cm(3)
    section.bottom_margin, section.right_margin = Cm(2), Cm(2)
    section.header_distance, section.footer_distance = Cm(1.25), Cm(1.25)
    # a numeração das notas (por capítulo ou pelo livro) é decidida na exportação, não no modelo
    for fp in section._sectPr.findall(qn("w:footnotePr")):
        section._sectPr.remove(fp)

    styles = doc.styles
    for name in ("Normal", "Body Text", "First Paragraph", "Compact"):
        body(get_or_add(doc, name, WD_STYLE_TYPE.PARAGRAPH))

    for level, size in ((1, 14), (2, 12), (3, 12)):
        h = styles[f"Heading {level}"]
        set_font(h, size, bold=True, italic=False)
        pf = h.paragraph_format
        pf.alignment = WD_ALIGN_PARAGRAPH.LEFT
        pf.first_line_indent = Cm(0)
        pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
        pf.space_before = Pt(0 if level == 1 else 18)
        pf.space_after = Pt(24 if level == 1 else 12)
        pf.keep_with_next = True
        pf.page_break_before = level == 1

    quote = get_or_add(doc, "Citação longa", WD_STYLE_TYPE.PARAGRAPH)
    quote.base_style = styles["Normal"]
    set_font(quote, 10)
    pf = quote.paragraph_format
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    pf.left_indent = Cm(4)
    pf.first_line_indent = Cm(0)
    pf.line_spacing_rule = WD_LINE_SPACING.SINGLE
    pf.line_spacing = 1.0
    pf.space_before = Pt(12)
    pf.space_after = Pt(12)

    for name in ("Footnote Text",):
        fn = get_or_add(doc, name, WD_STYLE_TYPE.PARAGRAPH)
        set_font(fn, 10)
        pf = fn.paragraph_format
        pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
        pf.first_line_indent = Cm(0)
        pf.line_spacing_rule = WD_LINE_SPACING.SINGLE
        pf.line_spacing = 1.0
        pf.space_after = Pt(0)

    ai = get_or_add(doc, "Inserido IA", WD_STYLE_TYPE.CHARACTER)
    ai.font.highlight_color = WD_COLOR_INDEX.YELLOW

    # tira o texto de exemplo do modelo do Pandoc
    for p in list(doc.paragraphs):
        p._element.getparent().remove(p._element)

    doc.save(OUT)
    print(f"modelo salvo em {OUT}")


if __name__ == "__main__":
    main()
