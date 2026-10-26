import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  ClientMessage,
  CloseCode,
  PROTOCOL_VERSION,
  friendlyError,
  tokenFromProtocols,
  type ErrorCode,
  type ServerMessage,
} from '@livro/shared'
import { LiveSession, type SessionDeps } from './live-session.ts'
import type { Logger } from './log.ts'
import { LIMITS, TokenBucket } from './rate-limit.ts'
import type { AuthUser } from './store.ts'

export type { AuthUser, BookStore } from './store.ts'
export { summarizeLatency, type LatencySummary } from './latency.ts'

export type VerifyToken = (token: string) => Promise<AuthUser | null>

export interface SessionServerOptions extends SessionDeps {
  verifyToken: VerifyToken
  /** Origens de navegador aceitas. Clientes sem cabeçalho Origin (não navegador) passam pela autenticação normal. */
  allowedOrigins: string[]
  log: Logger
}

const MAX_MESSAGE_BYTES = 64 * 1024

export function createSessionServer(opts: SessionServerOptions) {
  const { log } = opts
  const sessions = new Map<string, LiveSession>()
  const connectionsByUser = new Map<string, number>()

  const server: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, sessions: sessions.size }))
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
        wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, result.user))
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
    if ((connectionsByUser.get(user.userId) ?? 0) >= LIMITS.connectionsPerUser) {
      log.warn('conexões demais para o usuário', { userId: user.userId })
      return { status: 429 }
    }
    return { user }
  }

  function handleConnection(ws: WebSocket, user: AuthUser) {
    connectionsByUser.set(user.userId, (connectionsByUser.get(user.userId) ?? 0) + 1)
    const control = new TokenBucket(LIMITS.control.rate, LIMITS.control.burst)
    const audio = new TokenBucket(LIMITS.audio.rate, LIMITS.audio.burst)
    let lastLimitWarning = 0
    let session: LiveSession | null = null
    let opening = false
    let stopped = false

    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }
    const channel = { send, close: (code: number, reason: string) => ws.close(code, reason) }
    const fail = (code: ErrorCode, closeCode: number) => {
      send({ type: 'error', code, message: friendlyError[code] })
      ws.close(closeCode, code)
    }
    const limited = () => {
      // excesso recebe aviso claro, sem derrubar a sessão (T.02)
      const now = Date.now()
      if (now - lastLimitWarning > 1000) {
        lastLimitWarning = now
        send({ type: 'error', code: 'rate_limited', message: friendlyError.rate_limited })
      }
    }

    const onMessage = async (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        if (!audio.take()) return limited()
        session?.onAudio(toBuffer(data))
        return
      }
      if (!control.take()) return limited()
      let msg: ClientMessage
      try {
        msg = ClientMessage.parse(JSON.parse(data.toString()))
      } catch {
        return fail('bad_message', CloseCode.BadMessage)
      }

      if (msg.type === 'start' || msg.type === 'resume') {
        if (session || opening) return fail('bad_message', CloseCode.BadMessage)
        opening = true
        if (msg.type === 'resume') {
          const existing = sessions.get(msg.sessionId)
          if (!existing || existing.isEnded || existing.user.userId !== user.userId) {
            return fail('session_gone', CloseCode.SessionGone)
          }
          session = existing
          session.attach(channel, true)
          log.info('sessão retomada', { sessionId: session.id, userId: user.userId })
          return
        }
        const opened = await LiveSession.open(opts, user, msg)
        if (typeof opened === 'string') {
          return fail(opened, opened === 'book_not_found' ? CloseCode.BookNotFound : CloseCode.SttUnavailable)
        }
        sessions.set(opened.id, opened)
        opened.whenEnded(() => sessions.delete(opened.id))
        session = opened
        opened.attach(channel, false)
        if (ws.readyState !== ws.OPEN) opened.detach(channel)
        return
      }
      if (!session) return
      switch (msg.type) {
        case 'stop':
          stopped = true
          await session.stop()
          ws.close(1000, 'ended')
          break
        case 'command_key':
          session.onCommandKey(msg.down, msg.audioMs)
          break
        case 'cursor':
          session.onCursor(msg.cursor)
          break
        case 'metric':
          session.onMetric(msg.value)
          break
      }
    }

    ws.on('message', (data, isBinary) => {
      onMessage(data, isBinary).catch((err) => {
        log.error('falha ao tratar mensagem', { err, userId: user.userId, sessionId: session?.id })
        fail('internal', 1011)
      })
    })
    ws.on('close', () => {
      connectionsByUser.set(user.userId, Math.max(0, (connectionsByUser.get(user.userId) ?? 1) - 1))
      if (session && !stopped && !session.isEnded) session.detach(channel)
    })
  }

  return {
    server,
    sessions,
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
    429: 'Too Many Requests',
    500: 'Internal Server Error',
  }
  socket.end(`HTTP/1.1 ${status} ${text[status] ?? 'Error'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}
