import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  AUDIO_SAMPLE_RATE,
  ClientMessage,
  CloseCode,
  PROTOCOL_VERSION,
  friendlyError,
  tokenFromProtocols,
  type ErrorCode,
  type ServerMessage,
  type TranscriptKind,
} from '@livro/shared'
import type { Logger } from './log.ts'
import type { SttFactory, SttStream } from './stt/index.ts'

export interface AuthUser {
  userId: string
  token: string
}

export type VerifyToken = (token: string) => Promise<AuthUser | null>

/** Acesso ao banco em nome de um usuário (sujeito às políticas RLS). */
export interface BookStore {
  findBook(bookId: string): Promise<{ id: string } | null>
  startSession(input: { bookId: string; device?: string; sttProvider: string }): Promise<string>
  saveTranscript(input: {
    sessionId: string
    bookId: string
    kind: TranscriptKind
    text: string
    startMs: number
    endMs: number
    payload?: unknown
  }): Promise<void>
  endSession(sessionId: string, status: 'ended' | 'interrupted'): Promise<void>
}

export interface SessionServerOptions {
  verifyToken: VerifyToken
  storeFor: (user: AuthUser) => BookStore
  stt: { provider: string; create: SttFactory }
  /** Origens de navegador aceitas. Clientes sem cabeçalho Origin (não navegador) passam pela autenticação normal. */
  allowedOrigins: string[]
  log: Logger
}

const MAX_MESSAGE_BYTES = 64 * 1024

export function createSessionServer(opts: SessionServerOptions) {
  const { log } = opts

  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      return
    }
    res.writeHead(404).end()
  })

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    handleProtocols: (protocols) => (protocols.has(PROTOCOL_VERSION) ? PROTOCOL_VERSION : false),
  })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', () => socket.destroy())
    void authorizeUpgrade(req).then(
      (result) => {
        if ('status' in result) return rejectUpgrade(socket, result.status)
        wss.handleUpgrade(req, socket, head, (ws) => {
          void handleConnection(ws, result.user).catch((err) => log.error('falha na sessão', { err }))
        })
      },
      (err) => {
        log.error('falha ao autorizar WebSocket', { err })
        rejectUpgrade(socket, 500)
      },
    )
  })

  async function authorizeUpgrade(req: IncomingMessage): Promise<{ user: AuthUser } | { status: number }> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    if (path !== '/ws') return { status: 404 }
    const origin = req.headers.origin
    if (origin && !opts.allowedOrigins.includes(origin)) {
      log.warn('origem recusada', { origin })
      return { status: 403 }
    }
    const token = tokenFromProtocols(req.headers['sec-websocket-protocol'])
    if (!token) return { status: 401 }
    const user = await opts.verifyToken(token).catch(() => null)
    if (!user) return { status: 401 }
    return { user }
  }

  async function handleConnection(ws: WebSocket, user: AuthUser) {
    const store = opts.storeFor(user)
    let session: { id: string; bookId: string } | null = null
    let stt: SttStream | null = null
    let started = false
    let finished = false
    const sessionLog = (msg: string, fields: Record<string, unknown> = {}) =>
      log.info(msg, { userId: user.userId, sessionId: session?.id, ...fields })

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    const fail = (code: ErrorCode, closeCode: number) => {
      send({ type: 'error', code, message: friendlyError[code] })
      ws.close(closeCode, code)
    }

    const finish = async (status: 'ended' | 'interrupted') => {
      if (finished || !session) return
      finished = true
      stt?.close()
      await store
        .endSession(session.id, status)
        .catch((err) => log.error('falha ao encerrar sessão', { err, sessionId: session?.id }))
      sessionLog('sessão encerrada', { status })
    }

    const start = async (msg: Extract<ClientMessage, { type: 'start' }>) => {
      const book = await store.findBook(msg.bookId)
      if (!book) return fail('book_not_found', CloseCode.BookNotFound)

      const sessionId = await store.startSession({
        bookId: book.id,
        device: msg.device,
        sttProvider: opts.stt.provider,
      })
      session = { id: sessionId, bookId: book.id }

      try {
        stt = await opts.stt.create({
          bookId: book.id,
          sessionId,
          sampleRate: AUDIO_SAMPLE_RATE,
          language: 'pt-BR',
          keywords: [],
        })
      } catch (err) {
        log.error('provedor de transcrição indisponível', { err, sessionId, provider: opts.stt.provider })
        await finish('interrupted')
        return fail('stt_unavailable', CloseCode.SttUnavailable)
      }

      const current = session
      stt.onTranscript((t) => {
        send({ type: 'transcript', kind: t.kind, text: t.text, startMs: t.startMs, endMs: t.endMs })
        if (t.kind === 'final') {
          void store
            .saveTranscript({ sessionId: current.id, bookId: current.bookId, ...t })
            .catch((err) => log.error('falha ao gravar transcrição final', { err, sessionId: current.id }))
        }
      })
      stt.onError((err) => {
        log.error('erro do provedor de transcrição', { err, sessionId: current.id, provider: opts.stt.provider })
        fail('stt_unavailable', CloseCode.SttUnavailable)
      })

      send({ type: 'ready', sessionId })
      sessionLog('sessão iniciada', { bookId: book.id, provider: opts.stt.provider })
    }

    const onMessage = async (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        // Áudio antes de "ready" é descartado: o cliente só envia depois do aceite.
        stt?.send(toBuffer(data))
        return
      }
      let msg: ClientMessage
      try {
        msg = ClientMessage.parse(JSON.parse(data.toString()))
      } catch {
        return fail('bad_message', CloseCode.BadMessage)
      }
      if (msg.type === 'start') {
        if (started) return fail('bad_message', CloseCode.BadMessage)
        started = true
        return start(msg)
      }
      if (msg.type === 'stop') {
        await stt?.finish()
        await finish('ended')
        send({ type: 'ended' })
        ws.close(1000, 'ended')
      }
    }

    ws.on('message', (data, isBinary) => {
      onMessage(data, isBinary).catch((err) => {
        log.error('falha ao tratar mensagem', { err, userId: user.userId, sessionId: session?.id })
        fail('internal', 1011)
      })
    })
    ws.on('close', () => void finish('interrupted'))
  }

  return {
    server,
    listen(port: number, host?: string) {
      return new Promise<number>((resolve) => {
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port))
      })
    },
    close() {
      for (const client of wss.clients) client.terminate()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function rejectUpgrade(socket: Duplex, status: number) {
  const text: Record<number, string> = {
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
  }
  socket.end(`HTTP/1.1 ${status} ${text[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}
