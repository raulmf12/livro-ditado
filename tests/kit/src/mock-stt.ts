import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { loadScenario, type SttScenario, type SttScenarioEvent } from './scenarios.ts'

/** 16 kHz × 2 bytes por amostra = 32 bytes por milissegundo de áudio. */
const BYTES_PER_MS = 32

export type MockFormat = 'neutral' | 'deepgram' | 'assemblyai' | 'elevenlabs'

export interface MockSttRequest {
  format: MockFormat
  /** Só o formato neutro recebe a obra; os provedores reais nunca sabem qual é. */
  bookId: string | null
  sessionId: string | null
  language: string | null
  keywords: string[]
  /** A credencial chegou em cabeçalho (nunca na URL). */
  authenticated: boolean
  scenario: string
  audioMs: number
}

/**
 * Simulador do provedor de transcrição. Para cada conexão, reproduz a
 * sequência gravada de provisórios e finais do cenário, liberando cada evento
 * quando a quantidade de áudio recebida alcança o seu `atMs`. Assim o
 * resultado não depende de rede nem de uma API externa.
 *
 * Fala quatro formatos, pelo caminho da conexão:
 *   /stt                                  formato neutro (config JSON + áudio binário)
 *   /deepgram/v1/listen                   como o Deepgram
 *   /assemblyai/v3/ws                     como o AssemblyAI (Universal Streaming v3)
 *   /elevenlabs/v1/speech-to-text/realtime como o ElevenLabs (Scribe v2 Realtime)
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

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const format = formatFor(url.pathname)
    if (!format) return socket.end('HTTP/1.1 404 Not Found\r\n\r\n')
    wss.handleUpgrade(req, socket, head, (ws) => handleStream(ws, format, url, req))
  })

  function pickScenario(bookId: string | null): string {
    return (bookId && scenarioByBook.get(bookId)) ?? scenarioByBook.get('*') ?? defaultScenario
  }

  function handleStream(ws: WebSocket, format: MockFormat, url: URL, req: IncomingMessage) {
    const authenticated = !!(req.headers.authorization || req.headers['xi-api-key'])
    let scenario: SttScenario | null = null
    let request: MockSttRequest | null = null
    let bytes = 0
    let next = 0
    let failed = false
    const codec = codecs[format]

    const begin = (r: Omit<MockSttRequest, 'scenario' | 'audioMs' | 'authenticated' | 'format'>) => {
      const name = pickScenario(r.bookId)
      scenario = loadScenario(name)
      request = { ...r, format, authenticated, scenario: name, audioMs: 0 }
      requests.push(request)
    }

    const emitUntil = (ms: number) => {
      if (!scenario) return
      while (next < scenario.events.length && scenario.events[next]!.atMs <= ms) {
        const e = scenario.events[next]!
        const prevAt = next > 0 ? scenario.events[next - 1]!.atMs : 0
        for (const m of codec.event(e, e.startMs ?? prevAt)) ws.send(m)
        next++
      }
    }

    const finish = () => {
      emitUntil(Number.POSITIVE_INFINITY)
      for (const m of codec.done()) ws.send(m)
      if (format !== 'neutral') ws.close(1000)
    }

    const receiveAudio = (n: number) => {
      bytes += n
      const ms = Math.floor(bytes / BYTES_PER_MS)
      if (request) request.audioMs = ms
      if (scenario?.failAtMs !== undefined && ms >= scenario.failAtMs) {
        emitUntil(scenario.failAtMs)
        failed = true
        for (const m of codec.error('falha simulada do provedor')) ws.send(m)
        ws.close(1011, 'falha simulada')
        return
      }
      emitUntil(ms)
    }

    if (format !== 'neutral') {
      const keywords = [...url.searchParams.getAll('keyterm'), ...url.searchParams.getAll('keyterms')]
      const prompt = url.searchParams.get('keyterms_prompt')
      if (prompt) keywords.push(...(JSON.parse(prompt) as string[]))
      const language = url.searchParams.get('language') ?? url.searchParams.get('language_code') ?? url.searchParams.get('language_codes')
      begin({ bookId: null, sessionId: null, language, keywords })
      for (const m of codec.opened()) ws.send(m)
    }

    ws.on('message', (data, isBinary) => {
      if (failed) return
      if (isBinary) return receiveAudio((data as Buffer).length)
      const msg = JSON.parse(data.toString()) as Record<string, unknown>
      if (format === 'neutral' && msg.type === 'config') {
        begin({
          bookId: msg.bookId as string,
          sessionId: msg.sessionId as string,
          language: msg.language as string,
          keywords: msg.keywords as string[],
        })
      } else if (format === 'elevenlabs' && msg.message_type === 'input_audio_chunk') {
        const audio = Buffer.from(String(msg.audio_base_64 ?? ''), 'base64')
        if (audio.length) receiveAudio(audio.length)
        // simplificação: um commit sem áudio é tratado como fim do áudio
        else if (msg.commit) finish()
      } else if (msg.type === 'finish' || msg.type === 'CloseStream' || msg.type === 'Terminate') {
        finish()
      }
      // flush, Finalize, ForceEndpoint e KeepAlive: os eventos do cenário já saem pelo tempo do áudio
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

function formatFor(path: string): MockFormat | null {
  if (path === '/stt') return 'neutral'
  if (path === '/deepgram/v1/listen') return 'deepgram'
  if (path === '/assemblyai/v3/ws') return 'assemblyai'
  if (path === '/elevenlabs/v1/speech-to-text/realtime') return 'elevenlabs'
  return null
}

interface Codec {
  opened(): string[]
  event(e: SttScenarioEvent, startMs: number): string[]
  done(): string[]
  error(message: string): string[]
}

const codecs: Record<MockFormat, Codec> = {
  neutral: {
    opened: () => [],
    event: (e, startMs) => [JSON.stringify({ type: 'transcript', kind: e.kind, text: e.text, startMs, endMs: e.atMs })],
    done: () => [JSON.stringify({ type: 'done' })],
    error: (message) => [JSON.stringify({ type: 'error', message })],
  },
  deepgram: {
    opened: () => [],
    event: (e, startMs) => [
      JSON.stringify({
        type: 'Results',
        is_final: e.kind === 'final',
        speech_final: e.kind === 'final',
        from_finalize: false,
        start: startMs / 1000,
        duration: (e.atMs - startMs) / 1000,
        channel: { alternatives: [{ transcript: e.text, confidence: 0.98, words: [] }] },
      }),
    ],
    done: () => [JSON.stringify({ type: 'Metadata', request_id: 'simulado', duration: 0, channels: 1 })],
    error: (message) => [JSON.stringify({ type: 'Error', variant: 'simulated', description: message })],
  },
  assemblyai: {
    opened: () => [JSON.stringify({ type: 'Begin', id: 'simulado', expires_at: 0 })],
    event: (e, startMs) => [
      JSON.stringify({
        type: 'Turn',
        turn_order: 0,
        turn_is_formatted: e.kind === 'final',
        end_of_turn: e.kind === 'final',
        transcript: e.text,
        words: [
          { text: e.text.split(' ')[0], start: startMs, end: startMs + 1, confidence: 0.98, word_is_final: true },
          { text: e.text.split(' ').at(-1), start: e.atMs - 1, end: e.atMs, confidence: 0.98, word_is_final: true },
        ],
      }),
    ],
    done: () => [JSON.stringify({ type: 'Termination', audio_duration_seconds: 0, session_duration_seconds: 0 })],
    error: (message) => [JSON.stringify({ error: message })],
  },
  elevenlabs: {
    opened: () => [JSON.stringify({ message_type: 'session_started', session_id: 'simulado', config: {} })],
    event: (e, startMs) =>
      e.kind === 'interim'
        ? [JSON.stringify({ message_type: 'partial_transcript', text: e.text })]
        : [
            JSON.stringify({ message_type: 'committed_transcript', text: e.text }),
            JSON.stringify({
              message_type: 'committed_transcript_with_timestamps',
              text: e.text,
              language_code: 'pt',
              words: [
                { text: e.text, start: startMs / 1000, end: e.atMs / 1000, type: 'word', logprob: 0 },
              ],
            }),
          ],
    done: () => [],
    error: (message) => [JSON.stringify({ message_type: 'transcriber_error', error: message })],
  },
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
