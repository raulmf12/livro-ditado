import { z } from 'zod'

/**
 * Protocolo entre o navegador e o servidor de sessão (apps/session).
 *
 * Autenticação: o token do Supabase vai no handshake como subprotocolo
 * `auth.<jwt>`, ao lado de PROTOCOL_VERSION. Sem token válido o servidor
 * responde 401 e o WebSocket nem abre.
 *
 * Áudio: frames binários com AUDIO_HEADER_BYTES de cabeçalho (número de
 * sequência uint32 little-endian, começando em 1) seguidos de PCM 16 bits
 * little-endian, mono, 16 kHz, em pedaços de AUDIO_CHUNK_MS. O servidor
 * confirma com "ack"; se a conexão cair, o navegador continua gravando,
 * reconecta com "resume" e reenvia tudo depois do último confirmado (F1.02).
 */
export const PROTOCOL_VERSION = 'livro.v2'
export const AUTH_PROTOCOL_PREFIX = 'auth.'
export const AUDIO_SAMPLE_RATE = 16_000
export const AUDIO_CHUNK_MS = 100
export const AUDIO_CHUNK_SAMPLES = (AUDIO_SAMPLE_RATE * AUDIO_CHUNK_MS) / 1000
export const AUDIO_HEADER_BYTES = 4
/** Por quanto tempo o servidor segura uma sessão sem conexão esperando o "resume". */
export const RESUME_GRACE_MS = 60_000

/** Códigos de fechamento próprios (faixa 4000–4999 reservada para aplicações). */
export const CloseCode = {
  BookNotFound: 4404,
  BadMessage: 4400,
  SessionGone: 4410,
  SttUnavailable: 4503,
} as const

const Cursor = z.object({
  blockId: z.uuid().nullable(),
  offset: z.number().int().nonnegative().nullable(),
})
export type Cursor = z.infer<typeof Cursor>

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    bookId: z.uuid(),
    device: z.string().max(200).optional(),
    cursor: Cursor.optional(),
  }),
  z.object({ type: z.literal('resume'), sessionId: z.uuid() }),
  z.object({ type: z.literal('stop') }),
  /** Tecla (ou pedal) de comando apertada/solta, no tempo do áudio já enviado (F1.11). */
  z.object({ type: z.literal('command_key'), down: z.boolean(), audioMs: z.number().int().nonnegative() }),
  /** O autor moveu o cursor de ditado (F1.17). */
  z.object({ type: z.literal('cursor'), cursor: Cursor }),
  /** Latência medida no navegador: do fim do áudio de um trecho até o texto final na tela. */
  z.object({
    type: z.literal('metric'),
    name: z.literal('speech_to_text_ms'),
    value: z.number().nonnegative().max(120_000),
  }),
])
export type ClientMessage = z.infer<typeof ClientMessage>

export const TranscriptKind = z.enum(['interim', 'final'])
export type TranscriptKind = z.infer<typeof TranscriptKind>

export const ErrorCode = z.enum(['book_not_found', 'bad_message', 'stt_unavailable', 'session_gone', 'rate_limited', 'internal'])
export type ErrorCode = z.infer<typeof ErrorCode>

const BlockJson = z.object({
  id: z.string(),
  parent_id: z.string().nullable(),
  type: z.enum(['chapter', 'section', 'subsection', 'paragraph', 'quote', 'note']),
  position: z.string(),
  content: z.string(),
  attrs: z.record(z.string(), z.unknown()),
  origin: z.enum(['author', 'ai']),
  status: z.enum(['final', 'pending', 'approved', 'rejected']),
})

export const OpJson = z.discriminatedUnion('op', [
  z.object({ op: z.literal('insert'), block: BlockJson }),
  z.object({ op: z.literal('delete'), block: BlockJson }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    before: z.object({ content: z.string(), attrs: z.record(z.string(), z.unknown()) }),
    after: z.object({ content: z.string(), attrs: z.record(z.string(), z.unknown()) }),
  }),
  z.object({
    op: z.literal('move'),
    id: z.string(),
    from: z.object({ parent_id: z.string().nullable(), position: z.string() }),
    to: z.object({ parent_id: z.string().nullable(), position: z.string() }),
  }),
])

export const ServerMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), sessionId: z.uuid() }),
  /** Sessão retomada; reenvie o áudio a partir de ackSeq + 1. */
  z.object({ type: z.literal('resumed'), sessionId: z.uuid(), ackSeq: z.number().int().nonnegative() }),
  z.object({ type: z.literal('ack'), seq: z.number().int().nonnegative() }),
  /** Faltou um pedaço de áudio (descartado por excesso ou perdido): reenvie a partir de fromSeq. */
  z.object({ type: z.literal('resend'), fromSeq: z.number().int().positive() }),
  z.object({
    type: z.literal('transcript'),
    kind: TranscriptKind,
    text: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
  }),
  /** Mudanças que o ditado fez no manuscrito (o editor aplica na hora; o Realtime confirma). */
  z.object({ type: z.literal('ops'), ops: z.array(OpJson) }),
  /** Faixa de confirmação de comando (F1.14). */
  z.object({
    type: z.literal('command'),
    status: z.enum(['executed', 'pending', 'ignored']),
    label: z.string(),
  }),
  z.object({ type: z.literal('cursor'), cursor: Cursor, mode: z.enum(['text', 'quote', 'note']) }),
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
  session_gone: 'A sessão de ditado expirou. Clique em Gravar para começar outra.',
  rate_limited: 'Muitos pedidos em pouco tempo. Alguns foram ignorados; o ditado continua.',
  internal: 'Algo deu errado no servidor. Tente de novo em instantes.',
}

export function authProtocol(token: string): string {
  return `${AUTH_PROTOCOL_PREFIX}${token}`
}

/** Extrai o token do cabeçalho Sec-WebSocket-Protocol ("livro.v2, auth.<jwt>"). */
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

/** Monta um frame de áudio: número de sequência + PCM. */
export function encodeAudioFrame(seq: number, pcm: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(AUDIO_HEADER_BYTES + pcm.byteLength)
  new DataView(out.buffer).setUint32(0, seq, true)
  out.set(new Uint8Array(pcm), AUDIO_HEADER_BYTES)
  return out.buffer
}

export function decodeAudioFrame(frame: Uint8Array): { seq: number; pcm: Uint8Array } | null {
  if (frame.byteLength <= AUDIO_HEADER_BYTES) return null
  const seq = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, true)
  return { seq, pcm: frame.subarray(AUDIO_HEADER_BYTES) }
}
