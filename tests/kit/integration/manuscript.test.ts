// F1.16 e F1.20 contra o banco: apply_ops grava transações inteiras, a ordem
// fracionária se mantém com collate "C", o histórico registra cada mudança, e
// o RLS vale dentro da função.
import type { SupabaseClient } from '@supabase/supabase-js'
import { generateKeyBetween } from 'fractional-indexing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seed, type SeedResult } from '../src/seed.ts'
import { adminClient, signedInClient } from '../src/supabase.ts'

let s: SeedResult
let a: SupabaseClient
let b: SupabaseClient
let bookId: string

beforeAll(async () => {
  s = await seed()
  a = (await signedInClient(s.users.a.email, s.password)).client
  b = (await signedInClient(s.users.b.email, s.password)).client
  const { data } = await a.from('books').insert({ title: `Integração manuscrito ${Date.now()}` }).select('id').single()
  bookId = data!.id
})

afterAll(async () => {
  await adminClient().from('books').delete().eq('id', bookId)
})

const paragraph = (id: string, position: string, content: string) => ({
  op: 'insert',
  block: { id, parent_id: null, type: 'paragraph', position, content, attrs: {}, origin: 'author', status: 'final' },
})

describe('apply_ops (F1.16)', () => {
  it('1.000 blocos inseridos em posições aleatórias saem do banco na ordem certa', async () => {
    const order: { id: string; position: string }[] = []
    let seedN = 7
    const random = () => ((seedN = (seedN * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const ops: unknown[] = []
    for (let i = 0; i < 1000; i++) {
      const at = Math.floor(random() * (order.length + 1))
      const position = generateKeyBetween(order[at - 1]?.position ?? null, order[at]?.position ?? null)
      const id = crypto.randomUUID()
      order.splice(at, 0, { id, position })
      ops.push(paragraph(id, position, `parágrafo ${i}`))
    }
    for (let i = 0; i < ops.length; i += 250) {
      const { error } = await a.rpc('apply_ops', { p_book_id: bookId, p_ops: ops.slice(i, i + 250) })
      expect(error).toBeNull()
    }
    const rows: { id: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await a.from('blocks').select('id').eq('book_id', bookId).order('position').range(from, from + 999)
      rows.push(...(data ?? []))
      if (!data || data.length < 1000) break
    }
    expect(rows.map((r) => r.id)).toEqual(order.map((o) => o.id))
  })

  it('a transação é atômica: um erro no meio desfaz tudo', async () => {
    const ok = crypto.randomUUID()
    const { error } = await a.rpc('apply_ops', {
      p_book_id: bookId,
      p_ops: [paragraph(ok, 'zz0', 'entraria'), { op: 'update', id: crypto.randomUUID(), before: {}, after: { content: 'x', attrs: {} } }],
    })
    expect(error?.code).toBe('P0002')
    const { data } = await a.from('blocks').select('id').eq('id', ok)
    expect(data).toEqual([])
  })

  it('outro autor não grava na obra pela função (RLS vale lá dentro)', async () => {
    const { error } = await b.rpc('apply_ops', { p_book_id: bookId, p_ops: [paragraph(crypto.randomUUID(), 'zz1', 'intruso')] })
    expect(error?.code).toBe('42501')
  })

  it('visitante sem login não chama a função', async () => {
    const { anonClient } = await import('../src/supabase.ts')
    const { error } = await anonClient().rpc('apply_ops', { p_book_id: bookId, p_ops: [] })
    expect(error).not.toBeNull()
  })
})

describe('histórico de versões (F1.20)', () => {
  it('cada mudança vira uma versão com antes e depois, e o histórico não pode ser apagado', async () => {
    const id = crypto.randomUUID()
    await a.rpc('apply_ops', { p_book_id: bookId, p_ops: [paragraph(id, 'zz2', 'primeira versão')] })
    await a.rpc('apply_ops', {
      p_book_id: bookId,
      p_ops: [{ op: 'update', id, before: { content: 'primeira versão', attrs: {} }, after: { content: 'segunda versão', attrs: {} } }],
    })
    const { data } = await a.from('block_versions').select('id, action, old_row, new_row').eq('block_id', id).order('id')
    expect(data!.map((v) => [v.action, (v.old_row as { content?: string } | null)?.content ?? null, (v.new_row as { content: string }).content])).toEqual([
      ['insert', null, 'primeira versão'],
      ['update', 'primeira versão', 'segunda versão'],
    ])

    const del = await a.from('block_versions').delete().eq('block_id', id).select()
    expect(del.error?.code ?? (del.data?.length === 0 ? 'nada apagado' : 'apagou')).toMatch(/42501|nada apagado/)
    const { data: still } = await a.from('block_versions').select('id').eq('block_id', id)
    expect(still).toHaveLength(2)

    const { data: other } = await b.from('block_versions').select('id').eq('block_id', id)
    expect(other).toEqual([])
  })
})
