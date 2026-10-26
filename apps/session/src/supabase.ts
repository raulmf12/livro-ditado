import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { MBlock } from '@livro/dictation'
import type { VerifyToken } from './server.ts'
import type { AuthUser, BookSettings, BookStore } from './store.ts'

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const
const BLOCK_COLUMNS = 'id, parent_id, type, position, content, attrs, origin, status'
const PAGE = 1000

/** Valida o JWT do Supabase (assinatura e validade) e exige um usuário logado. */
export function supabaseVerifier(url: string, publishableKey: string): VerifyToken {
  const client = createClient(url, publishableKey, clientOptions)
  return async (token) => {
    const { data, error } = await client.auth.getClaims(token)
    if (error || !data) return null
    const { sub, role, exp } = data.claims
    if (role !== 'authenticated' || typeof sub !== 'string') return null
    if (typeof exp !== 'number' || exp * 1000 <= Date.now()) return null
    return { userId: sub, token }
  }
}

/**
 * Acesso ao banco em nome do usuário: as consultas levam o token dele, então
 * as políticas RLS valem aqui do mesmo jeito que no navegador. O servidor de
 * sessão não usa a chave secreta.
 */
export function supabaseStoreFactory(url: string, publishableKey: string) {
  return (user: AuthUser): BookStore => {
    const db: SupabaseClient = createClient(url, publishableKey, {
      ...clientOptions,
      global: { headers: { Authorization: `Bearer ${user.token}` } },
    })
    const check = (error: unknown) => {
      if (error) throw error
    }

    return {
      async findBook(bookId) {
        const { data, error } = await db.from('books').select('id, settings').eq('id', bookId).maybeSingle()
        check(error)
        return data ? { id: data.id as string, settings: (data.settings ?? {}) as BookSettings } : null
      },

      async loadBlocks(bookId) {
        const out: MBlock[] = []
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db.from('blocks').select(BLOCK_COLUMNS).eq('book_id', bookId).order('id').range(from, from + PAGE - 1)
          check(error)
          out.push(...((data ?? []) as MBlock[]))
          if (!data || data.length < PAGE) return out
        }
      },

      async changesSince(bookId, afterId) {
        const { data, error } = await db
          .from('block_versions')
          .select('id, block_id, action, new_row')
          .eq('book_id', bookId)
          .gt('id', afterId)
          .order('id')
          .limit(PAGE)
        check(error)
        const upserts = new Map<string, MBlock>()
        const deletes = new Set<string>()
        let lastId = afterId
        for (const v of data ?? []) {
          lastId = v.id as number
          if (v.action === 'delete') {
            upserts.delete(v.block_id as string)
            deletes.add(v.block_id as string)
          } else {
            const row = v.new_row as MBlock
            deletes.delete(row.id)
            upserts.set(row.id, pick(row))
          }
        }
        return { upserts: [...upserts.values()], deletes: [...deletes], lastId }
      },

      async latestVersionId(bookId) {
        const { data, error } = await db.from('block_versions').select('id').eq('book_id', bookId).order('id', { ascending: false }).limit(1)
        check(error)
        return (data?.[0]?.id as number | undefined) ?? 0
      },

      async loadSpellingRules(bookId) {
        const { data, error } = await db.from('spelling_rules').select('id, spoken, written').eq('book_id', bookId).eq('approved', true)
        check(error)
        return (data ?? []) as { id: string; spoken: string; written: string }[]
      },

      async loadGlossary(bookId, chapterId) {
        let q = db.from('glossary_terms').select('term').eq('book_id', bookId)
        q = chapterId ? q.or(`chapter_id.is.null,chapter_id.eq.${chapterId}`) : q.is('chapter_id', null)
        const { data, error } = await q
        check(error)
        return [...new Set((data ?? []).map((r) => r.term as string))]
      },

      async startSession({ bookId, device, sttProvider }) {
        const { data, error } = await db
          .from('dictation_sessions')
          .insert({ book_id: bookId, user_id: user.userId, device, stt_provider: sttProvider })
          .select('id')
          .single()
        check(error)
        return data!.id as string
      },

      async applyOps(bookId, ops) {
        const { error } = await db.rpc('apply_ops', { p_book_id: bookId, p_ops: ops })
        check(error)
      },

      async saveTranscript({ sessionId, bookId, kind, text, startMs, endMs, payload }) {
        const { error } = await db.from('transcript_events').insert({
          session_id: sessionId,
          book_id: bookId,
          kind,
          text,
          start_ms: startMs,
          end_ms: endMs,
          provider_payload: payload ?? null,
        })
        check(error)
      },

      async saveCommand({ sessionId, bookId, raw, activation, parsed, status }) {
        const { error } = await db.from('commands').insert({
          session_id: sessionId,
          book_id: bookId,
          raw_text: raw,
          activation,
          parsed,
          status,
        })
        check(error)
      },

      async saveTextChanges({ sessionId, bookId, blockId, changes }) {
        const { error } = await db.from('text_changes').insert(
          changes.map((c) => ({
            session_id: sessionId,
            book_id: bookId,
            block_id: blockId,
            rule_id: c.ruleId,
            kind: c.kind,
            before: c.before,
            after: c.after,
            offset_at: c.offset,
          })),
        )
        check(error)
      },

      async saveAudioSegment({ sessionId, bookId, seq, wav, startMs, durationMs, blockId, charStart, charEnd, isCommand }) {
        const path = `${bookId}/${sessionId}/${String(seq).padStart(5, '0')}.wav`
        // áudio nunca é sobrescrito: cada trecho tem caminho próprio
        const { error: uploadError } = await db.storage.from('audio').upload(path, wav, { contentType: 'audio/wav', upsert: false })
        check(uploadError)
        const { error } = await db.from('audio_segments').insert({
          session_id: sessionId,
          book_id: bookId,
          seq,
          storage_path: path,
          start_ms: startMs,
          duration_ms: durationMs,
          block_id: blockId,
          char_start: charStart,
          char_end: charEnd,
          is_command: isCommand,
        })
        check(error)
      },

      async updateUsage(sessionId, audioMs) {
        const { error } = await db.from('dictation_sessions').update({ stt_audio_ms: audioMs }).eq('id', sessionId)
        check(error)
      },

      async endSession(sessionId, status, latency, audioMs) {
        const { error } = await db
          .from('dictation_sessions')
          .update({
            status,
            ended_at: new Date().toISOString(),
            latency_p50_ms: latency.p50Ms,
            latency_p95_ms: latency.p95Ms,
            latency_samples: latency.samples,
            stt_audio_ms: audioMs,
          })
          .eq('id', sessionId)
        check(error)
      },
    }
  }
}

function pick(row: MBlock): MBlock {
  const { id, parent_id, type, position, content, attrs, origin, status } = row
  return { id, parent_id, type, position, content, attrs, origin, status }
}

/** Pede ao serviço de exportação o Word da obra inteira, em nome do usuário (F1.25). */
export function exportClient(exportUrl: string) {
  return async (bookId: string, user: AuthUser) => {
    const res = await fetch(new URL('/exports', exportUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
      body: JSON.stringify({ bookId, scope: 'book', trigger: 'session_end' }),
    })
    if (!res.ok) throw new Error(`exportação respondeu ${res.status}`)
  }
}
