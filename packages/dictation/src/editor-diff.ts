import { generateKeyBetween } from 'fractional-indexing'
import { comparePositions, type MBlock, type Manuscript, type Op } from './manuscript.ts'

type FlowType = 'chapter' | 'section' | 'subsection' | 'paragraph' | 'quote'

/** O que o editor mostra de um bloco: tipo, texto e notas com a posição no texto. */
export interface EditorBlock {
  blockId: string
  type: FlowType
  content: string
  number: number | null
  origin: 'author' | 'ai'
  status: MBlock['status']
  notes: { blockId: string; text: string; anchor: number }[]
}

/**
 * Compara o que está no editor com o manuscrito e devolve as operações que
 * levam o manuscrito ao estado do editor (o que o autor digitou). Capítulos
 * ficam na raiz; o resto é filho do capítulo anterior.
 */
export function diffToOps(m: Manuscript, edited: EditorBlock[]): Op[] {
  const inserts: Op[] = []
  const updates: Op[] = []
  const moves: Op[] = []
  const deletes: Op[] = []
  const seen = new Set<string>()

  // pai desejado de cada bloco
  let chapterId: string | null = null
  const parentOf = new Map<string, string | null>()
  for (const b of edited) {
    if (b.type === 'chapter') chapterId = b.blockId
    parentOf.set(b.blockId, b.type === 'chapter' ? null : chapterId)
  }

  // posições: mantém a de quem continua em ordem; gera chave para o resto
  const groups = new Map<string | null, EditorBlock[]>()
  for (const b of edited) {
    const p = parentOf.get(b.blockId) ?? null
    if (!groups.has(p)) groups.set(p, [])
    groups.get(p)!.push(b)
  }
  const position = new Map<string, string>()
  for (const [parent, list] of groups) {
    let last: string | null = null
    for (let i = 0; i < list.length; i++) {
      const cur = m.get(list[i]!.blockId)
      const keep = cur && cur.parent_id === parent && cur.type !== 'note' && (last === null || comparePositions(cur.position, last) > 0)
      if (keep && cur) {
        position.set(cur.id, cur.position)
        last = cur.position
        continue
      }
      let upper: string | null = null
      for (let j = i + 1; j < list.length; j++) {
        const next = m.get(list[j]!.blockId)
        if (next && next.parent_id === parent && (last === null || comparePositions(next.position, last) > 0)) {
          upper = next.position
          break
        }
      }
      const key: string = generateKeyBetween(last, upper)
      position.set(list[i]!.blockId, key)
      last = key
    }
  }

  for (const b of edited) {
    seen.add(b.blockId)
    const parent = parentOf.get(b.blockId) ?? null
    const pos = position.get(b.blockId)!
    const attrs = b.number !== null ? { number: b.number } : {}
    const cur = m.get(b.blockId)
    if (!cur) {
      inserts.push({
        op: 'insert',
        block: { id: b.blockId, parent_id: parent, type: b.type, position: pos, content: b.content, attrs, origin: b.origin ?? 'author', status: b.status ?? 'final' },
      })
    } else {
      if (cur.parent_id !== parent || cur.position !== pos) {
        moves.push({ op: 'move', id: cur.id, from: { parent_id: cur.parent_id, position: cur.position }, to: { parent_id: parent, position: pos } })
      }
      const nextAttrs = cur.type === 'chapter' || cur.type === 'section' || cur.type === 'subsection' ? { ...cur.attrs, ...attrs } : cur.attrs
      if (cur.content !== b.content || JSON.stringify(nextAttrs) !== JSON.stringify(cur.attrs)) {
        updates.push({ op: 'update', id: cur.id, before: { content: cur.content, attrs: cur.attrs }, after: { content: b.content, attrs: nextAttrs } })
      }
    }

    // notas do bloco (a ordem de leitura vem da âncora; a posição só precisa ser única)
    const existing = cur ? m.notesOf(cur.id) : []
    let lastNoteKey = existing.map((e) => e.position).sort(comparePositions).at(-1) ?? null
    for (const n of b.notes) {
      seen.add(n.blockId)
      const old = existing.find((e) => e.id === n.blockId)
      if (!old) {
        lastNoteKey = generateKeyBetween(lastNoteKey, null)
        inserts.push({
          op: 'insert',
          block: { id: n.blockId, parent_id: b.blockId, type: 'note', position: lastNoteKey, content: n.text, attrs: { anchor: n.anchor }, origin: 'author', status: 'final' },
        })
      } else if (old.content !== n.text || old.attrs.anchor !== n.anchor) {
        updates.push({ op: 'update', id: old.id, before: { content: old.content, attrs: old.attrs }, after: { content: n.text, attrs: { ...old.attrs, anchor: n.anchor } } })
      }
    }
    for (const e of existing) if (!b.notes.some((n) => n.blockId === e.id)) deletes.push({ op: 'delete', block: e })
  }

  // o que sumiu do editor sai do manuscrito (filhos antes dos pais)
  const gone = m.ordered().filter((b) => !seen.has(b.id))
  for (const b of gone.filter((g) => g.type !== 'chapter')) {
    for (const n of m.notesOf(b.id)) if (!seen.has(n.id)) deletes.push({ op: 'delete', block: n })
    deletes.push({ op: 'delete', block: b })
  }
  for (const b of gone.filter((g) => g.type === 'chapter')) deletes.push({ op: 'delete', block: b })

  // capítulos novos antes dos filhos deles; deletes por último
  inserts.sort((a, b) => rank(a) - rank(b))
  return [...inserts, ...moves, ...updates, ...deletes]
}

function rank(op: Op) {
  if (op.op !== 'insert') return 1
  return op.block.type === 'chapter' ? 0 : op.block.type === 'note' ? 2 : 1
}

