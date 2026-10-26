import { describe, expect, it } from 'vitest'
import { Block } from './manuscript.ts'

const base = {
  id: crypto.randomUUID(),
  book_id: crypto.randomUUID(),
  parent_id: null,
  type: 'paragraph' as const,
  position: 'a0',
  content: 'O direito agrário.',
  attrs: {},
  audio_segment_id: null,
}

describe('Block', () => {
  it('texto do autor é final', () => {
    expect(Block.safeParse({ ...base, origin: 'author', status: 'final' }).success).toBe(true)
    expect(Block.safeParse({ ...base, origin: 'author', status: 'pending' }).success).toBe(false)
  })

  it('texto da IA nunca é final', () => {
    expect(Block.safeParse({ ...base, origin: 'ai', status: 'pending' }).success).toBe(true)
    expect(Block.safeParse({ ...base, origin: 'ai', status: 'final' }).success).toBe(false)
  })
})
