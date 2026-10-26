import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, authProtocol, type ServerMessage } from '@livro/shared'
import { silentLogger } from './log.ts'
import { createSessionServer, summarizeLatency, type BookStore, type LatencySummary } from './server.ts'
import type { SttFactory, SttStream, SttTranscript } from './stt/index.ts'

const BOOK_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_BOOK_ID = '22222222-2222-4222-8222-222222222222'

/** STT falso: a cada pedaço de áudio devolve um provisório; no finish, um final. */
function fakeStt(): { factory: SttFactory; received: number[] } {
  const received: number[] = []
  const factory: SttFactory = async () => {
    let listener: (t: SttTranscript) => void = () => {}
    const stream: SttStream = {
      send(chunk) {
        received.push(chunk.length)
        listener({ kind: 'interim', text: 'o direito', startMs: 0, endMs: 100 })
      },
      async finish() {
        listener({ kind: 'final', text: 'O direito agrário.', startMs: 0, endMs: 900 })
      },
      close() {},
      onTranscript(l) {
        listener = l
      },
      onError() {},
    }
    return stream
  }
  return { factory, received }
}

function memoryStore() {
  const saved: string[] = []
  const sessions = new Map<string, string>()
  const latency = new Map<string, LatencySummary>()
  const store: BookStore = {
    async findBook(bookId) {
      return bookId === BOOK_ID ? { id: bookId } : null
    },
    async startSession() {
      const id = crypto.randomUUID()
      sessions.set(id, 'active')
      return id
    },
    async saveTranscript({ text }) {
      saved.push(text)
    },
    async endSession(id, status, summary) {
      sessions.set(id, status)
      latency.set(id, summary)
    },
  }
  return { store, saved, sessions, latency }
}

let app: ReturnType<typeof createSessionServer>
let url: string
let stt: ReturnType<typeof fakeStt>
let mem: ReturnType<typeof memoryStore>
let sttCreate: SttFactory

beforeEach(async () => {
  stt = fakeStt()
  mem = memoryStore()
  sttCreate = stt.factory
  app = createSessionServer({
    verifyToken: async (token) => (token === 'token-valido' ? { userId: 'u1', token } : null),
    storeFor: () => mem.store,
    stt: { provider: 'fake', create: (o) => sttCreate(o) },
    allowedOrigins: ['http://localhost:3000'],
    log: silentLogger,
  })
  const port = await app.listen(0, '127.0.0.1')
  url = `ws://127.0.0.1:${port}/ws`
})

afterEach(() => app.close())

function handshakeStatus(protocols: string[], headers: Record<string, string> = {}) {
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(url, protocols, { headers })
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('open', () => {
      resolve(101)
      ws.close()
    })
    ws.on('error', () => {})
  })
}

function connect(): Promise<{ ws: WebSocket; messages: ServerMessage[]; next: () => Promise<ServerMessage> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, [PROTOCOL_VERSION, authProtocol('token-valido')])
    const messages: ServerMessage[] = []
    const waiting: ((m: ServerMessage) => void)[] = []
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage
      messages.push(msg)
      waiting.shift()?.(msg)
    })
    let read = 0
    const next = () =>
      new Promise<ServerMessage>((r) => {
        if (read < messages.length) r(messages[read++]!)
        else
          waiting.push((m) => {
            read++
            r(m)
          })
      })
    ws.on('open', () => resolve({ ws, messages, next }))
    ws.on('error', reject)
  })
}

const closed = (ws: WebSocket) => new Promise<number>((r) => ws.on('close', (code) => r(code)))

describe('handshake', () => {
  it('recusa sem token com 401', async () => {
    expect(await handshakeStatus([PROTOCOL_VERSION])).toBe(401)
  })

  it('recusa token inválido com 401', async () => {
    expect(await handshakeStatus([PROTOCOL_VERSION, authProtocol('forjado')])).toBe(401)
  })

  it('recusa origem de outro site com 403', async () => {
    expect(
      await handshakeStatus([PROTOCOL_VERSION, authProtocol('token-valido')], { Origin: 'https://evil.example' }),
    ).toBe(403)
  })

  it('aceita token válido vindo do domínio do app', async () => {
    expect(
      await handshakeStatus([PROTOCOL_VERSION, authProtocol('token-valido')], { Origin: 'http://localhost:3000' }),
    ).toBe(101)
  })
})

describe('sessão de ditado', () => {
  it('repassa o áudio, devolve provisórios e grava só os finais', async () => {
    const { ws, next } = await connect()
    ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    const ready = await next()
    expect(ready.type).toBe('ready')

    ws.send(Buffer.alloc(3200))
    expect(await next()).toMatchObject({ type: 'transcript', kind: 'interim', text: 'o direito' })
    for (const value of [300, 500, 900]) ws.send(JSON.stringify({ type: 'metric', name: 'speech_to_text_ms', value }))

    const closing = closed(ws)
    ws.send(JSON.stringify({ type: 'stop' }))
    expect(await next()).toMatchObject({ type: 'transcript', kind: 'final', text: 'O direito agrário.' })
    expect(await next()).toEqual({ type: 'ended' })
    expect(await closing).toBe(1000)

    expect(stt.received).toEqual([3200])
    expect(mem.saved).toEqual(['O direito agrário.'])
    expect([...mem.sessions.values()]).toEqual(['ended'])
    expect([...mem.latency.values()]).toEqual([{ p50Ms: 500, p95Ms: 900, samples: 3 }])
  })

  it('não abre sessão em obra que o usuário não enxerga', async () => {
    const { ws, next } = await connect()
    const closing = closed(ws)
    ws.send(JSON.stringify({ type: 'start', bookId: OTHER_BOOK_ID }))
    expect(await next()).toMatchObject({ type: 'error', code: 'book_not_found' })
    expect(await closing).toBe(4404)
    expect(mem.sessions.size).toBe(0)
  })

  it('avisa de forma amigável quando o provedor de transcrição cai', async () => {
    sttCreate = async () => {
      throw new Error('ECONNREFUSED')
    }
    const { ws, next } = await connect()
    const closing = closed(ws)
    ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    const msg = await next()
    expect(msg).toMatchObject({ type: 'error', code: 'stt_unavailable' })
    expect(msg.type === 'error' && msg.message).not.toMatch(/ECONNREFUSED/)
    expect(await closing).toBe(4503)
    expect([...mem.sessions.values()]).toEqual(['interrupted'])
  })

  it('fecha a conexão diante de mensagem inválida', async () => {
    const { ws, next } = await connect()
    const closing = closed(ws)
    ws.send('isto não é json')
    expect(await next()).toMatchObject({ type: 'error', code: 'bad_message' })
    expect(await closing).toBe(4400)
  })
})

describe('summarizeLatency', () => {
  it('calcula p50 e p95 pelo método do posto mais próximo', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(summarizeLatency(values)).toEqual({ p50Ms: 50, p95Ms: 95, samples: 100 })
  })

  it('sessão sem amostras fica sem latência', () => {
    expect(summarizeLatency([])).toEqual({ p50Ms: null, p95Ms: null, samples: 0 })
  })
})
