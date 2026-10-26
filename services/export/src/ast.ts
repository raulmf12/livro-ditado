import { Manuscript, noteAnchor, type MBlock } from '@livro/dictation'

/**
 * Manuscrito → documento do Pandoc (JSON). Montar a árvore direto, em vez de
 * escrever Markdown, garante que nenhum caractere do texto do autor seja lido
 * como formatação: o que está no manuscrito é o que sai no Word (E2E-11).
 */

type Inline = { t: string; c?: unknown }
type Block = { t: string; c?: unknown }

export interface ExportOptions {
  /** Numeração das notas: recomeça a cada capítulo ou corre pelo livro (F1.24). */
  footnoteNumbering: 'chapter' | 'book'
  /** Versão final: tira o realce de "Inserido IA" (F2.16). */
  omitAiMarks: boolean
}

export const STYLE_QUOTE = 'Citação longa'
export const STYLE_AI = 'Inserido IA'

const Str = (text: string): Inline => ({ t: 'Str', c: text })
const Space: Inline = { t: 'Space' }

export function inlines(text: string): Inline[] {
  const out: Inline[] = []
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue
    out.push(/^\s+$/.test(part) ? Space : Str(part))
  }
  return out
}

const attr = (style?: string) => ['', [], style ? [['custom-style', style]] : []]
const Para = (c: Inline[]): Block => ({ t: 'Para', c })
const Header = (level: number, c: Inline[]): Block => ({ t: 'Header', c: [level, attr(), c] })
const Div = (style: string, blocks: Block[]): Block => ({ t: 'Div', c: [attr(style), blocks] })
const Span = (style: string, c: Inline[]): Inline => ({ t: 'Span', c: [attr(style), c] })
const Note = (blocks: Block[]): Inline => ({ t: 'Note', c: blocks })
const RawOpenXml = (xml: string): Block => ({ t: 'RawBlock', c: ['openxml', xml] })

/** Quebra de seção contínua: as notas recomeçam em 1 no capítulo seguinte. Página A4, margens ABNT. */
const SECTION_BREAK =
  '<w:p><w:pPr><w:sectPr>' +
  '<w:footnotePr><w:numRestart w:val="eachSect"/></w:footnotePr>' +
  '<w:type w:val="continuous"/>' +
  '<w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/>' +
  '</w:sectPr></w:pPr></w:p>'

/** Texto do título como aparece no livro: "Capítulo 3 — Da posse agrária", "3.1 Conceito". */
export function headingText(b: MBlock, chapterNumber: number | null, sectionNumber: number | null): string {
  const n = typeof b.attrs.number === 'number' ? b.attrs.number : null
  if (b.type === 'chapter') {
    if (n === null) return b.content
    return b.content ? `Capítulo ${n} — ${b.content}` : `Capítulo ${n}`
  }
  const prefix =
    n === null
      ? ''
      : b.type === 'section'
        ? chapterNumber !== null ? `${chapterNumber}.${n}` : `${n}`
        : chapterNumber !== null && sectionNumber !== null ? `${chapterNumber}.${sectionNumber}.${n}` : `${n}`
  return [prefix, b.content].filter(Boolean).join(' ')
}

export function buildDocument(m: Manuscript, opts: ExportOptions, apiVersion: number[], onlyChapterId?: string) {
  const blocks: Block[] = []
  let chapterNumber: number | null = null
  let sectionNumber: number | null = null
  let chapters = 0

  const visible = (b: MBlock) => !(b.origin === 'ai' && b.status === 'rejected')
  const textOf = (b: MBlock, text: string) => {
    const content = inlines(text)
    return b.origin === 'ai' && !opts.omitAiMarks ? [Span(STYLE_AI, content)] : content
  }

  /** Texto do parágrafo com as chamadas de nota nos pontos onde foram ditadas. */
  const withNotes = (b: MBlock): Inline[] => {
    const notes = m.notesOf(b.id).filter(visible)
    const out: Inline[] = []
    let at = 0
    for (const note of notes) {
      const anchor = Math.min(Math.max(at, noteAnchor(note)), b.content.length)
      out.push(...textOf(b, b.content.slice(at, anchor)))
      out.push(Note([Para(textOf(note, note.content))]))
      at = anchor
    }
    out.push(...textOf(b, b.content.slice(at)))
    return out
  }

  for (const b of m.ordered()) {
    if (onlyChapterId) {
      const chapter = m.chapterOf(b.id)
      if (chapter?.id !== onlyChapterId) continue
    }
    if (!visible(b)) continue
    switch (b.type) {
      case 'chapter':
        if (chapters > 0 && opts.footnoteNumbering === 'chapter') blocks.push(RawOpenXml(SECTION_BREAK))
        chapters++
        chapterNumber = typeof b.attrs.number === 'number' ? b.attrs.number : null
        sectionNumber = null
        blocks.push(Header(1, inlines(headingText(b, chapterNumber, null))))
        break
      case 'section':
        sectionNumber = typeof b.attrs.number === 'number' ? b.attrs.number : null
        blocks.push(Header(2, inlines(headingText(b, chapterNumber, null))))
        break
      case 'subsection':
        blocks.push(Header(3, inlines(headingText(b, chapterNumber, sectionNumber))))
        break
      case 'paragraph':
        if (b.content.trim() || m.notesOf(b.id).length) blocks.push(Para(withNotes(b)))
        break
      case 'quote':
        if (b.content.trim()) blocks.push(Div(STYLE_QUOTE, [Para(withNotes(b))]))
        break
      case 'note':
        break // as notas entram dentro do parágrafo
    }
  }
  return { 'pandoc-api-version': apiVersion, meta: {}, blocks }
}
