// F0.04 — RLS bloqueia acesso cruzado entre autores, e visitante sem login não lê nada.
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seed, type SeedResult } from '../src/seed.ts'
import { adminClient, anonClient, signedInClient } from '../src/supabase.ts'

let s: SeedResult
let a: SupabaseClient
let b: SupabaseClient
const cleanup: string[] = []

beforeAll(async () => {
  s = await seed()
  a = (await signedInClient(s.users.a.email, s.password)).client
  b = (await signedInClient(s.users.b.email, s.password)).client
})

afterAll(async () => {
  if (cleanup.length) await adminClient().from('books').delete().in('id', cleanup)
})

describe('obras', () => {
  it('cada autor enxerga só as próprias obras', async () => {
    const { data: deA } = await a.from('books').select('id')
    const { data: deB } = await b.from('books').select('id')
    expect(deA?.map((r) => r.id)).toContain(s.users.a.bookId)
    expect(deA?.map((r) => r.id)).not.toContain(s.users.b.bookId)
    expect(deB?.map((r) => r.id)).not.toContain(s.users.a.bookId)
  })

  it('B não lê, não altera e não apaga a obra de A', async () => {
    const read = await b.from('books').select('*').eq('id', s.users.a.bookId)
    expect(read.data).toEqual([])

    const upd = await b.from('books').update({ title: 'invadido' }).eq('id', s.users.a.bookId).select()
    expect(upd.data).toEqual([])

    const del = await b.from('books').delete().eq('id', s.users.a.bookId).select()
    expect(del.data).toEqual([])

    const { data } = await adminClient().from('books').select('title').eq('id', s.users.a.bookId).single()
    expect(data?.title).toBe('Obra semente A')
  })

  it('B não cria obra em nome de A', async () => {
    const { error } = await b.from('books').insert({ owner_id: s.users.a.id, title: 'falsa' })
    expect(error?.code).toBe('42501')
  })

  it('visitante sem login não lê obras', async () => {
    const { data, error } = await anonClient().from('books').select('id')
    expect(data ?? []).toEqual([])
    expect(error?.code).toBe('42501')
  })
})

describe('dados da obra', () => {
  it('B não escreve blocos nem abre sessão na obra de A', async () => {
    const block = await b
      .from('blocks')
      .insert({ book_id: s.users.a.bookId, type: 'paragraph', position: 'z9', content: 'intruso' })
    expect(block.error?.code).toBe('42501')

    const session = await b.from('dictation_sessions').insert({ book_id: s.users.a.bookId, stt_provider: 'mock' })
    expect(session.error?.code).toBe('42501')
  })

  it('A não abre sessão em nome de B', async () => {
    const { error } = await a
      .from('dictation_sessions')
      .insert({ book_id: s.users.a.bookId, user_id: s.users.b.id, stt_provider: 'mock' })
    expect(error?.code).toBe('42501')
  })

  it('texto da IA não entra como final', async () => {
    const { error } = await a.from('blocks').insert({
      book_id: s.users.a.bookId,
      type: 'quote',
      position: 'a0',
      content: 'Art. 1.228. O proprietário…',
      origin: 'ai',
      status: 'final',
    })
    expect(error?.code).toBe('23514')
  })

  it('bloco não pode ter pai em outra obra', async () => {
    const { data: other } = await a.from('books').insert({ title: 'Obra temporária' }).select('id').single()
    cleanup.push(other!.id)
    const { data: chapter } = await a
      .from('blocks')
      .insert({ book_id: other!.id, type: 'chapter', position: 'a0', content: 'Capítulo' })
      .select('id')
      .single()
    const { error } = await a.from('blocks').insert({
      book_id: s.users.a.bookId,
      parent_id: chapter!.id,
      type: 'paragraph',
      position: 'a0',
      content: 'fora do lugar',
    })
    expect(error?.code).toBe('23503')
  })
})

describe('perfil', () => {
  it('autor não se promove a admin', async () => {
    const { error } = await b.from('profiles').update({ role: 'admin' }).eq('id', s.users.b.id)
    expect(error?.code).toBe('42501')
    const { data } = await b.from('profiles').select('role').eq('id', s.users.b.id).single()
    expect(data?.role).toBe('autor')
  })
})

describe('áudio no Storage', () => {
  it('o dono baixa o áudio da própria obra', async () => {
    const { data, error } = await a.storage.from('audio').download(s.audioObject)
    expect(error).toBeNull()
    expect(data!.size).toBeGreaterThan(1000)
  })

  it('outro autor e visitante não baixam', async () => {
    expect((await b.storage.from('audio').download(s.audioObject)).data).toBeNull()
    expect((await anonClient().storage.from('audio').download(s.audioObject)).data).toBeNull()
  })

  it('outro autor não grava na pasta da obra de A', async () => {
    const { error } = await b.storage
      .from('audio')
      .upload(`${s.users.a.bookId}/intruso.wav`, new Blob(['x']), { contentType: 'audio/wav' })
    expect(error).not.toBeNull()
  })
})
