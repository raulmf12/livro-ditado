import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { loadScenario, type SttScenario } from './scenarios.ts'

/** 16 kHz × 2 bytes por amostra = 32 bytes por milissegundo de áudio. */
const BYTES_PER_MS = 32

export interface MockSttRequest {
  bookId: string
  sessionId: string
  language: string
  keywords: string[]
  scenario: string
  audioMs: number
}

/**
 * Simulador do provedor de transcrição. Para cada conexão, reproduz a
 * sequência gravada de provisórios e finais do cenário, liberando cada evento
 * quando a quantidade de áudio recebida alcança o seu `atMs`. Assim o
 * resultado não depende de rede nem de uma API externa.
 *
 * Controle por HTTP (usado pelos testes):
 *   POST /scenario {"name": "...", "bookId"?: "..."}  escolhe o cenário (por obra ou para todas)
 *   GET  /requests                                     configurações recebidas (glossário, idioma…)
 *   POST /reset                                        limpa cenários e registros
 */
export function createMockStt(options: { defaultScenario?: string } = {}) {
  const defaultScenario = options.defaultScenario ?? 'ditado-simples'
  const scenarioByBook = new Map<string, string>()
  const requests: MockSttRequest[] = []

  const server = createServer((req, res) => {
    void handleHttp(req, res).catch((err) => json(res, 500, { error: String(err) }))
  })

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true })
    if (req.method === 'GET' && req.url === '/requests') return json(res, 200, requests)
    if (req.method === 'POST' && req.url === '/reset') {
      scenarioByBook.clear()
      requests.length = 0
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && req.url === '/scenario') {
      const body = JSON.parse(await readBody(req)) as { name: string; bookId?: string }
      loadScenario(body.name) // falha cedo se o cenário não existir
      scenarioByBook.set(body.bookId ?? '*', body.name)
      return json(res, 200, { ok: true })
    }
    json(res, 404, { error: 'not found' })
  }

  const wss = new WebSocketServer({ server, path: '/stt' })
  wss.on('connection', (ws) => handleStream(ws))

  function handleStream(ws: WebSocket) {
    let scenario: SttScenario | null = null
    let request: MockSttRequest | null = null
    let bytes = 0
    let next = 0
    let failed = false

    const emitUntil = (ms: number) => {
      if (!scenario) return
      while (next < scenario.events.length && scenario.events[next]!.atMs <= ms) {
        const e = scenario.events[next]!
        const prevAt = next > 0 ? scenario.events[next - 1]!.atMs : 0
        ws.send(JSON.stringify({ type: 'transcript', kind: e.kind, text: e.text, startMs: prevAt, endMs: e.atMs }))
        next++
      }
    }

    ws.on('message', (data, isBinary) => {
      if (failed) return
      if (!isBinary) {
        const msg = JSON.parse(data.toString()) as
          | { type: 'config'; bookId: string; sessionId: string; language: string; keywords: string[] }
          | { type: 'finish' }
        if (msg.type === 'config') {
          const name = scenarioByBook.get(msg.bookId) ?? scenarioByBook.get('*') ?? defaultScenario
          scenario = loadScenario(name)
          request = {
            bookId: msg.bookId,
            sessionId: msg.sessionId,
            language: msg.language,
            keywords: msg.keywords,
            scenario: name,
            audioMs: 0,
          }
          requests.push(request)
        } else if (msg.type === 'finish') {
          emitUntil(Number.POSITIVE_INFINITY)
          ws.send(JSON.stringify({ type: 'done' }))
        }
        return
      }
      bytes += (data as Buffer).length
      const ms = Math.floor(bytes / BYTES_PER_MS)
      if (request) request.audioMs = ms
      if (scenario?.failAtMs !== undefined && ms >= scenario.failAtMs) {
        emitUntil(scenario.failAtMs)
        failed = true
        ws.send(JSON.stringify({ type: 'error', message: 'falha simulada do provedor' }))
        ws.close(1011, 'falha simulada')
        return
      }
      emitUntil(ms)
    })
  }

  return {
    listen(port = 0, host?: string) {
      return new Promise<number>((resolve) => {
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port))
      })
    },
    close() {
      for (const c of wss.clients) c.terminate()
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** Cliente do controle HTTP do simulador, para os testes. */
export function mockSttControl(baseUrl: string) {
  const post = async (path: string, body: unknown) => {
    const res = await fetch(new URL(path, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`simulador de STT respondeu ${res.status} em ${path}`)
  }
  return {
    useScenario: (name: string, bookId?: string) => post('/scenario', { name, bookId }),
    reset: () => post('/reset', {}),
    async requests(): Promise<MockSttRequest[]> {
      const res = await fetch(new URL('/requests', baseUrl))
      return (await res.json()) as MockSttRequest[]
    },
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
