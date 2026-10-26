import { generateKeyBetween } from 'fractional-indexing'

export type BlockType = 'chapter' | 'section' | 'subsection' | 'paragraph' | 'quote' | 'note'

/**
 * Bloco do manuscrito, igual à linha de public.blocks. A árvore tem dois níveis
 * no fluxo do texto: capítulos (e o que vier antes do primeiro capítulo) ficam
 * na raiz; seções, subseções, parágrafos e citações são filhos do capítulo.
 * Notas de rodapé são filhas do parágrafo e guardam em attrs.anchor a posição
 * da chamada da nota no texto do parágrafo.
 */
export interface MBlock {
  id: string
  parent_id: string | null
  type: BlockType
  position: string
  content: string
  attrs: Record<string, unknown>
  origin: 'author' | 'ai'
  status: 'final' | 'pending' | 'approved' | 'rejected'
}

export type Op =
  | { op: 'insert'; block: MBlock }
  | { op: 'delete'; block: MBlock }
  | { op: 'update'; id: string; before: Pick<MBlock, 'content' | 'attrs'>; after: Pick<MBlock, 'content' | 'attrs'> }
  | { op: 'move'; id: string; from: Pick<MBlock, 'parent_id' | 'position'>; to: Pick<MBlock, 'parent_id' | 'position'> }

export function invert(op: Op): Op {
  switch (op.op) {
    case 'insert':
      return { op: 'delete', block: op.block }
    case 'delete':
      return { op: 'insert', block: op.block }
    case 'update':
      return { op: 'update', id: op.id, before: op.after, after: op.before }
    case 'move':
      return { op: 'move', id: op.id, from: op.to, to: op.from }
  }
}

/** Inverso de uma transação inteira: operações invertidas, na ordem contrária. */
export function invertAll(ops: Op[]): Op[] {
  return ops.map(invert).reverse()
}

export const TEXT_TYPES: ReadonlySet<BlockType> = new Set(['paragraph', 'quote', 'note'])
export const HEADING_TYPES: ReadonlySet<BlockType> = new Set(['chapter', 'section', 'subsection'])

/** Comparação igual à do Postgres com collate "C" (byte a byte; as chaves são ASCII). */
export function comparePositions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export class Manuscript {
  private blocks = new Map<string, MBlock>()

  constructor(blocks: MBlock[] = []) {
    for (const b of blocks) this.blocks.set(b.id, structuredClone(b))
  }

  get(id: string | null | undefined): MBlock | undefined {
    return id ? this.blocks.get(id) : undefined
  }

  all(): MBlock[] {
    return [...this.blocks.values()]
  }

  children(parentId: string | null): MBlock[] {
    return this.all()
      .filter((b) => b.parent_id === parentId)
      .sort((a, b) => comparePositions(a.position, b.position))
  }

  /** Blocos na ordem de leitura (sem as notas, que ficam presas ao parágrafo). */
  ordered(): MBlock[] {
    const out: MBlock[] = []
    for (const top of this.children(null)) {
      if (top.type === 'note') continue
      out.push(top)
      if (top.type === 'chapter') out.push(...this.children(top.id).filter((b) => b.type !== 'note'))
    }
    return out
  }

  notesOf(blockId: string): MBlock[] {
    return this.children(blockId)
      .filter((b) => b.type === 'note')
      .sort((a, b) => noteAnchor(a) - noteAnchor(b) || comparePositions(a.position, b.position))
  }

  /** Capítulo que contém o bloco (ele mesmo, se for capítulo). */
  chapterOf(id: string | null): MBlock | undefined {
    let b = this.get(id)
    while (b) {
      if (b.type === 'chapter') return b
      b = this.get(b.parent_id)
    }
    return undefined
  }

  /** Chave de posição logo depois de `afterId` entre os filhos de `parentId` (null = no começo). */
  keyAfter(parentId: string | null, afterId: string | null): string {
    const siblings = this.children(parentId)
    if (afterId === null) return generateKeyBetween(null, siblings[0]?.position ?? null)
    const i = siblings.findIndex((s) => s.id === afterId)
    if (i === -1) return generateKeyBetween(siblings.at(-1)?.position ?? null, null)
    return generateKeyBetween(siblings[i]!.position, siblings[i + 1]?.position ?? null)
  }

  /** Chave no fim dos filhos de `parentId`. */
  keyAtEnd(parentId: string | null): string {
    return generateKeyBetween(this.children(parentId).at(-1)?.position ?? null, null)
  }

  apply(op: Op) {
    switch (op.op) {
      case 'insert':
        if (this.blocks.has(op.block.id)) throw new Error(`bloco já existe: ${op.block.id}`)
        this.blocks.set(op.block.id, structuredClone(op.block))
        break
      case 'delete':
        this.blocks.delete(op.block.id)
        break
      case 'update': {
        const b = this.must(op.id)
        b.content = op.after.content
        b.attrs = structuredClone(op.after.attrs)
        break
      }
      case 'move': {
        const b = this.must(op.id)
        b.parent_id = op.to.parent_id
        b.position = op.to.position
        break
      }
    }
  }

  applyAll(ops: Op[]) {
    for (const op of ops) this.apply(op)
  }

  /** Substitui um bloco pela versão que veio de fora (outra aba, editor). */
  upsert(block: MBlock) {
    this.blocks.set(block.id, structuredClone(block))
  }

  remove(id: string) {
    for (const child of this.children(id)) this.remove(child.id)
    this.blocks.delete(id)
  }

  private must(id: string): MBlock {
    const b = this.blocks.get(id)
    if (!b) throw new Error(`bloco não encontrado: ${id}`)
    return b
  }
}

export function noteAnchor(b: MBlock): number {
  return typeof b.attrs.anchor === 'number' ? b.attrs.anchor : Number.MAX_SAFE_INTEGER
}

/** Move um capítulo inteiro (o conteúdo vai junto, porque é filho dele) para antes de `beforeId`. */
export function moveChapterOps(m: Manuscript, chapterId: string, beforeId: string | null): Op[] {
  const chapter = m.get(chapterId)
  if (!chapter || chapter.type !== 'chapter') throw new Error('só capítulos podem ser movidos assim')
  const roots = m.children(null).filter((b) => b.id !== chapterId)
  const i = beforeId === null ? roots.length : roots.findIndex((b) => b.id === beforeId)
  if (i === -1) throw new Error(`destino não encontrado: ${beforeId}`)
  const position = generateKeyBetween(roots[i - 1]?.position ?? null, roots[i]?.position ?? null)
  return [
    {
      op: 'move',
      id: chapterId,
      from: { parent_id: chapter.parent_id, position: chapter.position },
      to: { parent_id: null, position },
    },
  ]
}
