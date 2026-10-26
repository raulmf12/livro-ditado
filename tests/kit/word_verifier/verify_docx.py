"""Verificador de Word: lê um .docx exportado e descreve o que importa para os testes.

Uso: python verify_docx.py arquivo.docx  ->  JSON na saída padrão.

Para cada parágrafo: estilo, texto, recuo esquerdo efetivo (cm), tamanho de
fonte efetivo (pt), espaçamento entre linhas, notas de rodapé referenciadas e
se há trecho marcado como "Inserido IA". Também lista as notas de rodapé e os
comentários do documento.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass, field

from docx import Document
from docx.oxml.ns import qn
from docx.shared import Length

AI_STYLE_NAMES = {"Inserido IA"}


@dataclass
class Paragraph:
    index: int
    style: str
    text: str
    left_indent_cm: float | None
    font_size_pt: float | None
    line_spacing: float | None
    footnote_ids: list[int] = field(default_factory=list)
    ai_marked_text: list[str] = field(default_factory=list)


def _inherited(style, getter):
    """Sobe pela cadeia de estilos-base até achar um valor definido."""
    while style is not None:
        value = getter(style)
        if value is not None:
            return value
        style = style.base_style
    return None


def _cm(length: Length | None) -> float | None:
    return None if length is None else round(length.cm, 2)


def _part_blob_root(document, partname: str):
    from lxml import etree

    for rel in document.part.rels.values():
        if not rel.is_external and str(rel.target_part.partname) == partname:
            part = rel.target_part
            if hasattr(part, "element"):
                return part.element
            return etree.fromstring(part.blob)
    return None


def _text_of(el) -> str:
    return "".join(t.text or "" for t in el.iter(qn("w:t")))


def footnotes(document) -> list[dict]:
    root = _part_blob_root(document, "/word/footnotes.xml")
    if root is None:
        return []
    notes = []
    for fn in root.iter(qn("w:footnote")):
        if fn.get(qn("w:type")) in ("separator", "continuationSeparator", "continuationNotice"):
            continue
        notes.append({"id": int(fn.get(qn("w:id"))), "text": _text_of(fn).strip()})
    return notes


def comments(document) -> list[dict]:
    root = _part_blob_root(document, "/word/comments.xml")
    if root is None:
        return []
    return [
        {"id": int(c.get(qn("w:id"))), "author": c.get(qn("w:author")), "text": _text_of(c).strip()}
        for c in root.iter(qn("w:comment"))
    ]


def paragraphs(document) -> list[Paragraph]:
    out = []
    for i, p in enumerate(document.paragraphs):
        style = p.style
        pf = p.paragraph_format
        left = pf.left_indent if pf.left_indent is not None else _inherited(
            style, lambda s: s.paragraph_format.left_indent
        )
        spacing = pf.line_spacing if pf.line_spacing is not None else _inherited(
            style, lambda s: s.paragraph_format.line_spacing
        )
        size = _inherited(style, lambda s: s.font.size)
        run_sizes = {r.font.size for r in p.runs if r.font.size is not None}
        if len(run_sizes) == 1:
            size = run_sizes.pop()

        ai_text = []
        paragraph_is_ai = style is not None and style.name in AI_STYLE_NAMES
        for r in p.runs:
            if paragraph_is_ai or (r.style is not None and r.style.name in AI_STYLE_NAMES):
                ai_text.append(r.text)

        out.append(
            Paragraph(
                index=i,
                style=style.name if style is not None else "",
                text=p.text,
                left_indent_cm=_cm(left),
                font_size_pt=None if size is None else size.pt,
                line_spacing=None if spacing is None or isinstance(spacing, Length) else float(spacing),
                footnote_ids=[int(ref.get(qn("w:id"))) for ref in p._p.iter(qn("w:footnoteReference"))],
                ai_marked_text=[t for t in ai_text if t],
            )
        )
    return out


def inspect(path: str) -> dict:
    document = Document(path)
    paras = paragraphs(document)
    return {
        "paragraphs": [asdict(p) for p in paras],
        "footnotes": footnotes(document),
        "comments": comments(document),
        "ai_marked_count": sum(len(p.ai_marked_text) for p in paras),
    }


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("uso: python verify_docx.py arquivo.docx", file=sys.stderr)
        sys.exit(2)
    json.dump(inspect(sys.argv[1]), sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
