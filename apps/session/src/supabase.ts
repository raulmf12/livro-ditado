import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AuthUser, BookStore, VerifyToken } from './server.ts'

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } } as const

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

    return {
      async findBook(bookId) {
        const { data, error } = await db.from('books').select('id').eq('id', bookId).maybeSingle()
        if (error) throw error
        return data
      },

      async startSession({ bookId, device, sttProvider }) {
        const { data, error } = await db
          .from('dictation_sessions')
          .insert({ book_id: bookId, user_id: user.userId, device, stt_provider: sttProvider })
          .select('id')
          .single()
        if (error) throw error
        return data.id as string
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
        if (error) throw error
      },

      async endSession(sessionId, status) {
        const { error } = await db
          .from('dictation_sessions')
          .update({ status, ended_at: new Date().toISOString() })
          .eq('id', sessionId)
        if (error) throw error
      },
    }
  }
}
