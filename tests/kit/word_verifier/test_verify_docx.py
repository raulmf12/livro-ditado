"""Autoteste do verificador: monta um .docx de amostra com o Pandoc e confere a leitura.

A amostra usa o mesmo caminho que o serviço de exportação vai usar (F1.23):
Markdown do Pandoc + documento de referência com os estilos do livro.
"""

from pathlib import Path

import pypandoc
import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE
from docx.shared import Cm, Pt

from verify_docx import inspect

MARKDOWN = """\
# Da posse agrária

A posse agrária exige exploração efetiva.[^1]

::: {custom-style="Citação longa"}
O proprietário tem a faculdade de usar, gozar e dispor da coisa.
:::

Segundo o Código Civil, [o direito de reaver a coisa]{custom-style="Inserido IA"} é do proprietário.

[^1]: Ver art. 1.196 do Código Civil.
"""


@pytest.fixture(scope="module")
def sample_docx(tmp_path_factory) -> Path:
    tmp = tmp_path_factory.mktemp("docx")
    reference = tmp / "referencia.docx"
    doc = Document()
    quote = doc.styles.add_style("Citação longa", WD_STYLE_TYPE.PARAGRAPH)
    quote.base_style = doc.styles["Normal"]
    quote.paragraph_format.left_indent = Cm(4)
    quote.paragraph_format.line_spacing = 1.0
    quote.font.size = Pt(10)
    ai = doc.styles.add_style("Inserido IA", WD_STYLE_TYPE.CHARACTER)
    ai.font.highlight_color = 7  # amarelo
    doc.save(reference)

    out = tmp / "amostra.docx"
    pypandoc.convert_text(
        MARKDOWN,
        "docx",
        format="markdown",
        outputfile=str(out),
        extra_args=[f"--reference-doc={reference}"],
    )
    return out


def test_titulo_e_corpo(sample_docx):
    paras = inspect(str(sample_docx))["paragraphs"]
    assert paras[0]["style"] == "Heading 1"
    assert paras[0]["text"] == "Da posse agrária"
    assert paras[1]["text"].startswith("A posse agrária exige exploração efetiva.")


def test_citacao_longa_com_recuo_e_fonte_menor(sample_docx):
    paras = inspect(str(sample_docx))["paragraphs"]
    quote = next(p for p in paras if p["style"] == "Citação longa")
    assert quote["left_indent_cm"] == 4.0
    assert quote["font_size_pt"] == 10.0
    assert quote["line_spacing"] == 1.0


def test_nota_de_rodape_real(sample_docx):
    report = inspect(str(sample_docx))
    assert [n["text"] for n in report["footnotes"]] == ["Ver art. 1.196 do Código Civil."]
    assert report["paragraphs"][1]["footnote_ids"] == [report["footnotes"][0]["id"]]


def test_marcacao_inserido_ia(sample_docx):
    report = inspect(str(sample_docx))
    assert report["ai_marked_count"] == 1
    marked = [t for p in report["paragraphs"] for t in p["ai_marked_text"]]
    assert marked == ["o direito de reaver a coisa"]
