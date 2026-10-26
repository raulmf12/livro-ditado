import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { MBlock } from '@livro/dictation'
import { verifyDocx } from '@livro/test-kit/word'
import type { ExportOptions } from './ast.ts'
import { renderDocx } from './export.ts'

let n = 0
const block = (b: Partial<MBlock> & Pick<MBlock, 'type' | 'content'>): MBlock => ({
  id: `b${++n}`,
  parent_id: null,
  position: `a${n.toString().padStart(4, '0')}`,
  attrs: {},
  origin: 'author',
  status: 'final',
  ...b,
})

/** Capítulo com seção, três parágrafos, citação longa, nota, e um segundo capítulo com nota. */
function sampleBook(): MBlock[] {
  const ch1 = block({ type: 'chapter', content: 'Da posse agrária', attrs: { number: 3 } })
  const s1 = block({ type: 'section', content: 'Conceito', attrs: { number: 1 }, parent_id: ch1.id })
  const p1 = block({ type: 'paragraph', content: 'A posse agrária exige exploração efetiva da terra.', parent_id: ch1.id })
  const p2 = block({ type: 'paragraph', content: 'Diz o Código Civil:', parent_id: ch1.id })
  const q1 = block({ type: 'quote', content: 'O proprietário tem a faculdade de usar, gozar e dispor da coisa.', parent_id: ch1.id })
  const p3 = block({ type: 'paragraph', content: 'Como se vê, o direito é amplo *e* tem [limites] # sociais.', parent_id: ch1.id })
  const n1 = block({ type: 'note', content: 'Ver art. 1.228 do Código Civil.', parent_id: p1.id, attrs: { anchor: 'A posse agrária'.length } })
  const ch2 = block({ type: 'chapter', content: 'Da função social', attrs: { number: 4 } })
  const p4 = block({ type: 'paragraph', content: 'A função social qualifica a propriedade.', parent_id: ch2.id })
  const n2 = block({ type: 'note', content: 'Constituição, art. 186.', parent_id: p4.id, attrs: { anchor: 'A função social qualifica a propriedade.'.length } })
  return [ch1, s1, p1, p2, q1, p3, n1, ch2, p4, n2]
}

async function report(blocks: MBlock[], opts: ExportOptions = { footnoteNumbering: 'chapter', omitAiMarks: false }, chapterId?: string) {
  const docx = await renderDocx(blocks, opts, chapterId)
  const file = join(mkdtempSync(join(tmpdir(), 'export-')), 'livro.docx')
  writeFileSync(file, docx)
  return verifyDocx(file)
}

describe('exportação Word (F1.23)', () => {
  it('cada tipo de bloco sai com o estilo do modelo', async () => {
    const r = await report(sampleBook())
    const byText = (t: string) => r.paragraphs.find((p) => p.text.startsWith(t))!
    expect(byText('Capítulo 3 — Da posse agrária').style).toBe('Heading 1')
    expect(byText('3.1 Conceito').style).toBe('Heading 2')
    expect(['First Paragraph', 'Body Text']).toContain(byText('A posse agrária').style)

    const quote = byText('O proprietário')
    expect(quote.style).toBe('Citação longa')
    expect(quote.left_indent_cm).toBe(4)
    expect(quote.font_size_pt).toBe(10)
    expect(quote.line_spacing).toBe(1)
  })

  it('o texto sai igual ao manuscrito, sem virar formatação (E2E-11)', async () => {
    const r = await report(sampleBook())
    expect(r.paragraphs.map((p) => p.text)).toContain('Como se vê, o direito é amplo *e* tem [limites] # sociais.')
  })

  it('notas de rodapé reais, na posição ditada (F1.24)', async () => {
    const r = await report(sampleBook())
    expect(r.footnotes.map((f) => f.text)).toEqual(['Ver art. 1.228 do Código Civil.', 'Constituição, art. 186.'])
    const p1 = r.paragraphs.find((p) => p.text.startsWith('A posse agrária'))!
    expect(p1.footnote_ids).toHaveLength(1)
  })

  it('numeração das notas recomeça a cada capítulo ou corre pelo livro', async () => {
    const porCapitulo = await report(sampleBook())
    expect(porCapitulo.sections).toHaveLength(2)
    expect(porCapitulo.sections.every((s) => s.footnote_restart === 'eachSect')).toBe(true)

    const corrida = await report(sampleBook(), { footnoteNumbering: 'book', omitAiMarks: false })
    expect(corrida.sections).toHaveLength(1)
    expect(corrida.sections[0]!.footnote_restart).toBeNull()
  })

  it('página A4 com margens ABNT em todas as seções (F1.22)', async () => {
    const r = await report(sampleBook())
    for (const s of r.sections) {
      expect(s.page_cm).toEqual([21, 29.7])
      expect(s.margins_cm).toEqual({ top: 3, right: 2, bottom: 2, left: 3 })
    }
  })

  it('exporta só um capítulo', async () => {
    const book = sampleBook()
    const r = await report(book, undefined, book.find((b) => b.content === 'Da função social')!.id)
    expect(r.paragraphs.map((p) => p.text)).toEqual(['Capítulo 4 — Da função social', 'A função social qualifica a propriedade.'])
  })

  it('texto da IA sai marcado, e some na versão final; rejeitado não sai', async () => {
    const ch = block({ type: 'chapter', content: 'Teste' })
    const ai = block({ type: 'quote', content: 'Art. 1.228. O proprietário…', parent_id: ch.id, origin: 'ai', status: 'approved' })
    const rejected = block({ type: 'paragraph', content: 'Trecho rejeitado', parent_id: ch.id, origin: 'ai', status: 'rejected' })
    const marked = await report([ch, ai, rejected])
    expect(marked.ai_marked_count).toBe(1)
    expect(marked.paragraphs.map((p) => p.text)).not.toContain('Trecho rejeitado')
    const final = await report([ch, ai, rejected], { footnoteNumbering: 'chapter', omitAiMarks: true })
    expect(final.ai_marked_count).toBe(0)
  })
})

describe('desempenho (F1.25)', () => {
  it('livro de 300 páginas em menos de 30 s', async () => {
    const blocks: MBlock[] = []
    const sentence = 'A função social da propriedade rural é cumprida quando atende, simultaneamente, aos requisitos de aproveitamento racional e adequado.'
    // ~300 páginas ABNT: 30 capítulos × 40 parágrafos de ~120 palavras, com notas
    for (let c = 1; c <= 30; c++) {
      const ch = block({ type: 'chapter', content: `Capítulo de teste ${c}`, attrs: { number: c } })
      blocks.push(ch)
      for (let p = 0; p < 40; p++) {
        const para = block({ type: 'paragraph', content: Array(6).fill(sentence).join(' '), parent_id: ch.id })
        blocks.push(para)
        if (p % 4 === 0) blocks.push(block({ type: 'note', content: 'Nota de teste.', parent_id: para.id, attrs: { anchor: 20 } }))
      }
    }
    const started = Date.now()
    const docx = await renderDocx(blocks, { footnoteNumbering: 'chapter', omitAiMarks: false })
    const ms = Date.now() - started
    expect(ms).toBeLessThan(30_000)
    const file = join(mkdtempSync(join(tmpdir(), 'export-')), 'grande.docx')
    writeFileSync(file, docx)
    const r = await verifyDocx(file)
    expect(r.paragraphs.filter((p) => p.text)).toHaveLength(30 * 41) // as quebras de seção são parágrafos vazios
    expect(r.footnotes).toHaveLength(30 * 10)
  }, 60_000)
})
