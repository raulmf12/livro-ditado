export { diffToOps, type EditorBlock } from '@livro/dictation'
import type { EditorBlock, MBlock, Manuscript } from '@livro/dictation'
import type { JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

// ------------------------------------------------------------------ manuscrito → editor

export function nodeFromBlock(m: Manuscript, b: MBlock): JSONContent {
  const attrs: Record<string, unknown> = { blockId: b.id, origin: b.origin, status: b.status }
  if (b.type === 'chapter' || b.type === 'section' || b.type === 'subsection') {
    attrs.number = typeof b.attrs.number === 'number' ? b.attrs.number : null
    return { type: b.type, attrs, content: b.content ? [{ type: 'text', text: b.content }] : undefined }
  }
  const content: JSONContent[] = []
  let at = 0
  for (const note of m.notesOf(b.id)) {
    const anchor = Math.min(Math.max(at, typeof note.attrs.anchor === 'number' ? note.attrs.anchor : b.content.length), b.content.length)
    if (anchor > at) content.push({ type: 'text', text: b.content.slice(at, anchor) })
    content.push({ type: 'footnote', attrs: { blockId: note.id, text: note.content } })
    at = anchor
  }
  if (b.content.length > at) content.push({ type: 'text', text: b.content.slice(at) })
  return { type: b.type, attrs, content: content.length ? content : undefined }
}

export function docFromManuscript(m: Manuscript): JSONContent {
  const content = m.ordered().map((b) => nodeFromBlock(m, b))
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { blockId: crypto.randomUUID() } }] }
}

// ------------------------------------------------------------------ editor → manuscrito

export function editorBlock(node: PMNode): EditorBlock {
  let content = ''
  const notes: EditorBlock['notes'] = []
  node.forEach((child) => {
    if (child.type.name === 'footnote') {
      notes.push({ blockId: child.attrs.blockId as string, text: child.attrs.text as string, anchor: content.length })
    } else if (child.isText) {
      content += child.text
    }
  })
  return {
    blockId: node.attrs.blockId as string,
    type: node.type.name as EditorBlock['type'],
    content,
    number: (node.attrs.number as number | null | undefined) ?? null,
    origin: node.attrs.origin as EditorBlock['origin'],
    status: node.attrs.status as EditorBlock['status'],
    notes,
  }
}

export function blocksFromDoc(doc: PMNode): EditorBlock[] {
  const out: EditorBlock[] = []
  doc.forEach((node) => out.push(editorBlock(node)))
  return out
}

// ------------------------------------------------------------------ manuscrito → editor (mudanças de fora)

/**
 * Leva para o editor o que mudou no manuscrito (ditado, outra aba), mexendo só
 * nos nós afetados, para não perder a seleção nem o que o autor está digitando.
 * Blocos em `skip` (com digitação ainda não salva) não são tocados.
 */
export function patchEditor(state: EditorState, m: Manuscript, skip: Set<string>): Transaction | null {
  const desired = m.ordered()
  const tr = state.tr
  let changed = false

  // 1. remove o que não existe mais
  const remove: { from: number; to: number }[] = []
  tr.doc.forEach((node, offset) => {
    const id = node.attrs.blockId as string | null
    if (id && !m.get(id) && !skip.has(id)) remove.push({ from: offset, to: offset + node.nodeSize })
  })
  for (const r of remove.reverse()) {
    tr.delete(r.from, r.to)
    changed = true
  }

  // 2. atualiza e insere na ordem do manuscrito
  let prevEnd = 0
  for (const b of desired) {
    const found = findTopLevel(tr.doc, b.id)
    const node = state.schema.nodeFromJSON(nodeFromBlock(m, b))
    if (found) {
      if (found.offset < prevEnd) return null // fora de ordem: quem chama refaz o documento inteiro
      if (!skip.has(b.id) && !found.node.eq(node)) {
        tr.replaceWith(found.offset, found.offset + found.node.nodeSize, node)
        changed = true
      }
      const after = findTopLevel(tr.doc, b.id)!
      prevEnd = after.offset + after.node.nodeSize
    } else {
      tr.insert(prevEnd, node)
      prevEnd += node.nodeSize
      changed = true
    }
  }
  if (!changed) return null
  // o documento precisa de pelo menos um bloco
  if (tr.doc.childCount === 0) tr.insert(0, state.schema.nodes.paragraph!.create({ blockId: crypto.randomUUID() }))
  tr.setMeta('addToHistory', false)
  tr.setMeta('remote', true)
  return tr
}

export function findTopLevel(doc: PMNode, blockId: string): { node: PMNode; offset: number } | null {
  let found: { node: PMNode; offset: number } | null = null
  doc.forEach((node, offset) => {
    if (!found && node.attrs.blockId === blockId) found = { node, offset }
  })
  return found
}

/** Posição no editor para (bloco, deslocamento no texto). Notas contam 1 no editor e 0 no texto. */
export function editorPos(doc: PMNode, blockId: string, offset: number | null): number | null {
  const found = findTopLevel(doc, blockId)
  if (!found) return null
  const start = found.offset + 1
  if (offset === null) return found.offset + found.node.nodeSize - 1
  let textSeen = 0
  let pmOffset = 0
  let result: number | null = null
  found.node.forEach((child) => {
    if (result !== null) return
    if (child.isText) {
      const len = child.text!.length
      if (textSeen + len >= offset) result = start + pmOffset + (offset - textSeen)
      textSeen += len
    }
    pmOffset += child.nodeSize
  })
  return result ?? start + pmOffset
}

/** O contrário: de uma posição no editor para (bloco, deslocamento no texto). */
export function textPosition(doc: PMNode, pos: number): { blockId: string; offset: number } | null {
  const $pos = doc.resolve(pos)
  if ($pos.depth < 1) return null
  const node = $pos.node(1)
  const blockId = node.attrs.blockId as string | null
  if (!blockId) return null
  const inside = pos - $pos.start(1)
  let textSeen = 0
  let pmOffset = 0
  node.forEach((child) => {
    if (pmOffset >= inside) return
    if (child.isText) textSeen += Math.min(child.text!.length, inside - pmOffset)
    pmOffset += child.nodeSize
  })
  return { blockId, offset: textSeen }
}
