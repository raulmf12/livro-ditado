import { z } from 'zod'

/**
 * Protocolo entre o navegador e o servidor de sessão (apps/session).
 *
 * Autenticação: o token do Supabase vai no handshake como subprotocolo
 * `auth.<jwt>`, ao lado de PROTOCOL_VERSION. Sem token válido o servidor
 * responde 401 e o WebSocket nem abre.
 *
 * Áudio: frames binários com PCM 16 bits little-endian, mono, 16 kHz,
 * em pedaços de AUDIO_CHUNK_MS.
 */
export const PROTOCOL_VERSION = 'livro.v1'
export const AUTH_PROTOCOL_PREFIX = 'auth.'
export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_CHUNK_MS = 100
export const AUDIO_CHUNK_SAMPLES = (AUDIO_SAMPLE_RATE * AUDIO_CHUNK_MS) / 1000

/** Códigos de fechamento próprios (faixa 4000–4999 reservada para aplicações). */
export const CloseCode = {
  BookNotFound: 4404,
  BadMessage: 4400,
  SttUnavailable: 4503,
} as const

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    bookId: z.uuid(),
    device: z.string().max(200).optional(),
  }),
  z.object({ type: z.literal('stop') }),
])
export type ClientMessage = z.infer<typeof ClientMessage>

export const TranscriptKind = z.enum(['interim', 'final'])
export type TranscriptKind = z.infer<typeof TranscriptKind>

export const ErrorCode = z.enum(['book_not_found', 'bad_message', 'stt_unavailable', 'internal'])
export type ErrorCode = z.infer<typeof ErrorCode>

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sessionId: z.uuid() }),
  z.object({
    type: z.literal('transcript'),
    kind: TranscriptKind,
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('error'), code: ErrorCode, message: z.string() }),
  z.object({ type: z.literal('ended') }),
])
export type ServerMessage = z.infer<typeof ServerMessage>

/** Mensagens para o autor: curtas, sem detalhe técnico. */
export const friendlyError: Record<ErrorCode, string> = {
  book_not_found: 'Não encontrei esta obra na sua conta.',
  bad_message: 'O aplicativo enviou um pedido inválido. Recarregue a página.',
  stt_unavailable:
    'A transcrição está fora do ar no momento. Seu áudio não foi perdido; tente gravar de novo em instantes.',
  internal: 'Algo deu errado no servidor. Tente de novo em instantes.',
}

export function authProtocol(token: string): string {
  return `${AUTH_PROTOCOL_PREFIX}${token}`
}

/** Extrai o token do cabeçalho Sec-WebSocket-Protocol ("livro.v1, auth.<jwt>"). */
export function tokenFromProtocols(header: string | undefined): string | null {
  if (!header) return null
  for (const raw of header.split(',')) {
    const p = raw.trim()
    if (p.startsWith(AUTH_PROTOCOL_PREFIX) && p.length > AUTH_PROTOCOL_PREFIX.length) {
      return p.slice(AUTH_PROTOCOL_PREFIX.length)
    }
  }
  return null
}
