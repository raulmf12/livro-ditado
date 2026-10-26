import { describe, expect, it } from 'vitest'
import { diffToOps, type EditorBlock } from './editor-diff.ts'
import { Manuscript, comparePositions, moveChapterOps, type MBlock } from './manuscript.ts'

const eb = (blockId: string, type: EditorBlock['type'], content: string, notes: EditorBlock['notes'] = []): EditorBlock => ({
  blockId,
  type,
  content,
  number: null,
  origin: 'author',
  status: 'final',
  notes,
})

/** Lê o manuscrito como o editor (ordem de leitura) para comparar. */
function asEditor(m: Manuscript): EditorBlock[] {
  return m.ordered().map((b) => ({
    ...eb(b.id, b.type as EditorBlock['type'], b.content),
    notes: m.notesOf(b.id).map((n) => ({ blockId: n.id, text: n.content, anchor: n.attrs.anchor as number })),
  }))
}

function roundTrip(m: Manuscript, edited: EditorBlock[]) {
  m.applyAll(diffToOps(m, edited))
  expect(asEditor(m)).toEqual(edited)
}

describe('editor → manuscrito', () => {
  it('digitar num livro vazio cria os blocos, com o parágrafo dentro do capítulo', () => {
    const m = new Manuscript()
    const edited = [eb('c1', 'chapter', 'Da posse'), eb('p1', 'paragraph', 'Texto.')]
    const ops = diffToOps(m, edited)
    expect(ops.map((o) => o.op)).toEqual(['insert', 'insert'])
    m.applyAll(ops)
    expect(m.get('p1')!.parent_id).toBe('c1')
    roundTrip(m, edited)
  })

  it('editar o texto de um parágrafo vira uma atualização só', () => {
    const m = new Manuscript()
    roundTrip(m, [eb('p1', 'paragraph', 'A posse.')])
    const ops = diffToOps(m, [eb('p1', 'paragraph', 'A posse agrária.')])
    expect(ops).toEqual([{ op: 'update', id: 'p1', before: { content: 'A posse.', attrs: {} }, after: { content: 'A posse agrária.', attrs: {} } }])
  })

  it('inserir no meio não renumera o livro (F1.16)', () => {
    const m = new Manuscript()
    roundTrip(m, [eb('p1', 'paragraph', 'um'), eb('p3', 'paragraph', 'três')])
    const before = new Map(m.all().map((b) => [b.id, b.position]))
    const ops = diffToOps(m, [eb('p1', 'paragraph', 'um'), eb('p2', 'paragraph', 'dois'), eb('p3', 'paragraph', 'três')])
    expect(ops.map((o) => o.op)).toEqual(['insert'])
    m.applyAll(ops)
    expect(m.get('p1')!.position).toBe(before.get('p1'))
    expect(m.get('p3')!.position).toBe(before.get('p3'))
  })

  it('apagar um parágrafo apaga as notas dele', () => {
    const m = new Manuscript()
    roundTrip(m, [eb('p1', 'paragraph', 'Fica.'), eb('p2', 'paragraph', 'Sai.', [{ blockId: 'n1', text: 'nota', anchor: 4 }])])
    const ops = diffToOps(m, [eb('p1', 'paragraph', 'Fica.')])
    expect(ops.map((o) => o.op === 'delete' && o.block.id)).toEqual(['n1', 'p2'])
  })

  it('nota nova, editada e removida', () => {
    const m = new Manuscript()
    roundTrip(m, [eb('p1', 'paragraph', 'A posse é um fato.', [{ blockId: 'n1', text: 'Savigny.', anchor: 8 }])])
    roundTrip(m, [eb('p1', 'paragraph', 'A posse é um fato.', [{ blockId: 'n1', text: 'Savigny, 1803.', anchor: 8 }, { blockId: 'n2', text: 'Ihering.', anchor: 18 }])])
    roundTrip(m, [eb('p1', 'paragraph', 'A posse é um fato.', [{ blockId: 'n2', text: 'Ihering.', anchor: 18 }])])
  })

  it('transformar um parágrafo em capítulo leva os seguintes para dentro dele', () => {
    const m = new Manuscript()
    roundTrip(m, [eb('c1', 'chapter', 'Um'), eb('p1', 'paragraph', 'a'), eb('p2', 'paragraph', 'b')])
    roundTrip(m, [eb('c1', 'chapter', 'Um'), eb('p1', 'paragraph', 'a'), eb('c2', 'chapter', 'Dois'), eb('p2', 'paragraph', 'b')])
    expect(m.get('p2')!.parent_id).toBe('c2')
  })

  it('1.000 blocos inseridos em posições aleatórias mantêm a ordem (F1.16)', () => {
    const m = new Manuscript()
    const expected: EditorBlock[] = []
    let seed = 42
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    for (let i = 0; i < 1000; i++) {
      const at = Math.floor(random() * (expected.length + 1))
      expected.splice(at, 0, eb(`p${i}`, 'paragraph', `parágrafo ${i}`))
      m.applyAll(diffToOps(m, expected))
    }
    expect(m.ordered().map((b) => b.id)).toEqual(expected.map((b) => b.blockId))
    // a ordem no banco é por posição com collate "C": a mesma comparação byte a byte
    const positions = m.ordered().map((b) => b.position)
    expect([...positions].sort(comparePositions)).toEqual(positions)
    expect(new Set(positions).size).toBe(1000)
  })
})

describe('mover capítulo (F1.19)', () => {
  it('o capítulo vai com todo o conteúdo e nada mais muda', () => {
    const m = new Manuscript()
    roundTrip(m, [
      eb('c1', 'chapter', 'Um'), eb('p1', 'paragraph', 'a'),
      eb('c2', 'chapter', 'Dois'), eb('p2', 'paragraph', 'b'),
      eb('c3', 'chapter', 'Três'), eb('p3', 'paragraph', 'c'),
    ])
    const ops = moveChapterOps(m, 'c3', 'c2')
    expect(ops).toHaveLength(1)
    m.applyAll(ops)
    expect(m.ordered().map((b: MBlock) => b.content)).toEqual(['Um', 'a', 'Três', 'c', 'Dois', 'b'])
  })
})
