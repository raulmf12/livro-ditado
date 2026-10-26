import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, authProtocol, encodeAudioFrame, type ServerMessage } from '@livro/shared'
import { silentLogger } from './log.ts'
import { createSessionServer, summarizeLatency } from './server.ts'
import { BOOK_ID, memoryStore } from './testing.ts'
import type { SttFactory, SttStream, SttTranscript } from './stt/index.ts'

const OTHER_BOOK_ID = '22222222-2222-4222-8222-222222222222'

/** STT falso: o teste decide quando sai cada resultado. */
function fakeStt() {
  const streams: { received: number; emit: (t: SttTranscript) => void; fail: (e: Error) => void; flushes: number }[] = []
  let failOpen = false
  const factory: SttFactory = async () => {
    if (failOpen) throw new Error('ECONNREFUSED')
    let listener: (t: SttTranscript) => void = () => {}
    let onError: (e: Error) => void = () => {}
    const handle = { received: 0, emit: (t: SttTranscript) => listener(t), fail: (e: Error) => onError(e), flushes: 0 }
    streams.push(handle)
    const stream: SttStream = {
      send(chunk) {
        handle.received += chunk.length
      },
      flush() {
        handle.flushes++
      },
      async finish() {},
      close() {},
      onTranscript(l) {
        listener = l
      },
      onError(l) {
        onError = l
      },
    }
    return stream
  }
  return {
    factory,
    streams,
    failOpen: (v: boolean) => (failOpen = v),
    final: (text: string, startMs = 0, endMs = 1000) => streams.at(-1)!.emit({ kind: 'final', text, startMs, endMs }),
  }
}

let app: ReturnType<typeof createSessionServer>
let url: string
let stt: ReturnType<typeof fakeStt>
let mem: ReturnType<typeof memoryStore>
let exported: string[]

beforeEach(async () => {
  stt = fakeStt()
  mem = memoryStore()
  exported = []
  app = createSessionServer({
    verifyToken: async (token) => (token === 'token-valido' ? { userId: 'u1', token } : null),
    storeFor: () => mem.store,
    stt: { name: 'fake', create: (o) => stt.factory(o), usdPerMinute: 0 },
    exportBook: async (bookId) => {
      exported.push(bookId)
    },
    allowedOrigins: ['http://localhost:3000'],
    log: silentLogger,
  })
  const port = await app.listen(0, '127.0.0.1')
  url = `ws://127.0.0.1:${port}/ws`
})

afterEach(() => app.close())

function handshakeStatus(protocols: string[], headers: Record<string, string> = {}) {
  return new Promise<{ status: number; ws: WebSocket }>((resolve) => {
    const ws = new WebSocket(url, protocols, { headers })
    ws.on('unexpected-response', (_req, res) => resolve({ status: res.statusCode ?? 0, ws }))
    ws.on('open', () => resolve({ status: 101, ws }))
    ws.on('error', () => {})
  })
}

/** Cliente de teste: guarda as mensagens e espera por tipo. */
function connect() {
  return new Promise<{
    ws: WebSocket
    messages: ServerMessage[]
    waitFor: <T extends ServerMessage['type']>(type: T, pred?: (m: Extract<ServerMessage, { type: T }>) => boolean) => Promise<Extract<ServerMessage, { type: T }>>
    closed: Promise<number>
    audio: (from: number, to: number) => void
  }>((resolve, reject) => {
    const ws = new WebSocket(url, [PROTOCOL_VERSION, authProtocol('token-valido')])
    const messages: ServerMessage[] = []
    const waiters: (() => void)[] = []
    ws.on('message', (data) => {
      messages.push(JSON.parse(data.toString()) as ServerMessage)
      for (const w of waiters.splice(0)) w()
    })
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
    const waitFor = <T extends ServerMessage['type']>(type: T, pred: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true) =>
      new Promise<Extract<ServerMessage, { type: T }>>((r, rej) => {
        const timer = setTimeout(() => rej(new Error(`não chegou "${type}"; recebidas: ${messages.map((m) => m.type).join(', ')}`)), 2000)
        const check = () => {
          const found = messages.find((m) => m.type === type && pred(m as Extract<ServerMessage, { type: T }>))
          if (found) {
            clearTimeout(timer)
            r(found as Extract<ServerMessage, { type: T }>)
          } else waiters.push(check)
        }
        check()
      })
    const audio = (from: number, to: number) => {
      for (let seq = from; seq <= to; seq++) ws.send(encodeAudioFrame(seq, new ArrayBuffer(3200)))
    }
    ws.on('open', () => resolve({ ws, messages, waitFor, closed, audio }))
    ws.on('error', reject)
  })
}

const settle = () => new Promise((r) => setTimeout(r, 50))
/** Espera a condição valer: as gravações no banco são assíncronas (e o CI é mais lento). */
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!pred() && Date.now() < end) await settle()
  expect(pred()).toBe(true)
}
const texts = () => mem.m.ordered().map((b) => `${b.type}: ${b.content}`)

describe('handshake', () => {
  it('recusa sem token, com token inválido e de outro site', async () => {
    expect((await handshakeStatus([PROTOCOL_VERSION])).status).toBe(401)
    expect((await handshakeStatus([PROTOCOL_VERSION, authProtocol('forjado')])).status).toBe(401)
    expect((await handshakeStatus([PROTOCOL_VERSION, authProtocol('token-valido')], { Origin: 'https://evil.example' })).status).toBe(403)
  })

  it('aceita o app e limita conexões simultâneas por usuário (T.02)', async () => {
    const open: WebSocket[] = []
    for (let i = 0; i < 4; i++) {
      const r = await handshakeStatus([PROTOCOL_VERSION, authProtocol('token-valido')], { Origin: 'http://localhost:3000' })
      expect(r.status).toBe(101)
      open.push(r.ws)
    }
    expect((await handshakeStatus([PROTOCOL_VERSION, authProtocol('token-valido')])).status).toBe(429)
    for (const ws of open) ws.close()
  })
})

describe('sessão de ditado', () => {
  it('ditado entra no manuscrito, com áudio do trecho ligado ao parágrafo', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await c.waitFor('ready')
    c.audio(1, 10)
    await c.waitFor('ack', (m) => m.seq === 10)
    stt.final('No rex, a posse agrária exige exploração.', 0, 1000)
    const ops = await c.waitFor('ops')
    expect(ops.ops[0]).toMatchObject({ op: 'insert', block: { type: 'paragraph' } })
    await until(() => mem.state.textChanges.length === 1 && mem.state.transcripts.length === 1)

    expect(texts()).toEqual(['paragraph: No REsp, a posse agrária exige exploração.'])
    expect(mem.state.textChanges).toHaveLength(1) // a troca de grafia ficou registrada
    expect(mem.state.transcripts).toEqual(['No rex, a posse agrária exige exploração.'])

    c.ws.send(JSON.stringify({ type: 'stop' }))
    await c.waitFor('ended')
    expect(await c.closed).toBe(1000)
    const [paragraph] = mem.m.ordered()
    expect(mem.state.segments[0]).toMatchObject({ blockId: paragraph!.id, isCommand: false, seq: 0 })
    expect([...mem.state.sessions.values()][0]).toMatchObject({ status: 'ended', audioMs: 1000 })
    expect(exported).toEqual([BOOK_ID]) // exportação automática ao fim da sessão (F1.25)
  })

  it('comando por palavra de ativação: faixa de confirmação e capítulo criado', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await c.waitFor('ready')
    stt.final('Atena, capítulo três, Da posse agrária. Fim.')
    expect(await c.waitFor('command')).toEqual({ type: 'command', status: 'executed', label: 'Capítulo 3: Da posse agrária' })
    await until(() => mem.state.commands.length === 1)
    expect(texts()).toEqual(['chapter: Da posse agrária'])
    expect(mem.state.commands).toMatchObject([{ status: 'executed', activation: 'wake_word' }])
  })

  it('tecla de comando segurada: o trecho vira comando sem a palavra (F1.11)', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await c.waitFor('ready')
    c.audio(1, 12)
    c.ws.send(JSON.stringify({ type: 'command_key', down: true, audioMs: 0 }))
    c.ws.send(JSON.stringify({ type: 'command_key', down: false, audioMs: 1200 }))
    await until(() => stt.streams[0]!.flushes === 1) // soltar a tecla fecha o trecho no provedor
    stt.final('capítulo dois, Da propriedade', 100, 1100)
    await c.waitFor('command')
    await until(() => mem.state.commands.length === 1)
    expect(texts()).toEqual(['chapter: Da propriedade'])
    expect(mem.state.commands).toMatchObject([{ activation: 'key' }])
  })

  it('queda de conexão: o navegador retoma e nada se perde (F1.02)', async () => {
    const first = await connect()
    first.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    const { sessionId } = await first.waitFor('ready')
    first.audio(1, 10)
    await first.waitFor('ack', (m) => m.seq === 10)
    first.ws.terminate() // rede caiu
    await new Promise((r) => setTimeout(r, 200))

    // enquanto o navegador está fora, o provedor ainda devolve um final
    stt.final('Texto ditado durante a queda.')
    await until(() => mem.state.transcripts.length === 1)

    const second = await connect()
    second.ws.send(JSON.stringify({ type: 'resume', sessionId }))
    expect(await second.waitFor('resumed')).toMatchObject({ ackSeq: 10 })
    await second.waitFor('ops') // o que aconteceu durante a queda chega depois da volta
    second.audio(8, 15) // reenvio a partir de um ponto anterior: duplicados são ignorados
    await second.waitFor('ack', (m) => m.seq === 15)
    expect(stt.streams[0]!.received).toBe(15 * 3200)

    second.ws.send(JSON.stringify({ type: 'stop' }))
    await second.waitFor('ended')
    expect(texts()).toEqual(['paragraph: Texto ditado durante a queda.'])
  })

  it('retomar sessão que não existe', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'resume', sessionId: crypto.randomUUID() }))
    expect(await c.waitFor('error')).toMatchObject({ code: 'session_gone' })
    expect(await c.closed).toBe(4410)
  })

  it('provedor cai: reconecta, reenvia o áudio sem final e segue', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await c.waitFor('ready')
    c.audio(1, 10)
    await c.waitFor('ack', (m) => m.seq === 10)
    stt.streams[0]!.fail(new Error('provedor caiu'))
    await until(() => stt.streams.length === 2 && stt.streams[1]!.received === 10 * 3200)
    expect(stt.streams[1]!.received).toBe(10 * 3200) // o segundo stream recebeu o áudio de novo
    stt.final('Depois da queda do provedor.')
    await c.waitFor('ops')
  })

  it('provedor indisponível na abertura: aviso amigável', async () => {
    stt.failOpen(true)
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    const msg = await c.waitFor('error')
    expect(msg).toMatchObject({ code: 'stt_unavailable' })
    expect(msg.message).not.toMatch(/ECONNREFUSED/)
    expect(await c.closed).toBe(4503)
    expect([...mem.state.sessions.values()][0]).toMatchObject({ status: 'interrupted' })
  })

  it('obra de outro usuário', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: OTHER_BOOK_ID }))
    expect(await c.waitFor('error')).toMatchObject({ code: 'book_not_found' })
    expect(await c.closed).toBe(4404)
  })

  it('excesso de mensagens recebe aviso e o ditado continua (T.02)', async () => {
    const c = await connect()
    c.ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await c.waitFor('ready')
    for (let i = 0; i < 100; i++) c.ws.send(JSON.stringify({ type: 'metric', name: 'speech_to_text_ms', value: 100 }))
    expect(await c.waitFor('error')).toMatchObject({ code: 'rate_limited' })
    c.audio(1, 5)
    await c.waitFor('ack', (m) => m.seq === 5)
    expect(c.ws.readyState).toBe(WebSocket.OPEN)
  })

  it('mensagem inválida fecha a conexão', async () => {
    const c = await connect()
    c.ws.send('isto não é json')
    expect(await c.waitFor('error')).toMatchObject({ code: 'bad_message' })
    expect(await c.closed).toBe(4400)
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
