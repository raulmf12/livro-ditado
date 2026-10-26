import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'

export interface SentryEvent {
  event_id?: string
  level?: string
  message?: string | { formatted?: string }
  tags?: Record<string, string>
  exception?: { values?: { type?: string; value?: string }[] }
  [key: string]: unknown
}

/**
 * Simulador do Sentry: recebe os envelopes que os SDKs enviam para o DSN e
 * guarda os eventos, para os testes conferirem que um erro chegou com o ID da
 * sessão. DSN de teste: http://public@localhost:<porta>/1
 *
 *   GET  /events  eventos recebidos
 *   POST /reset   limpa
 */
export function createMockSentry() {
  const events: SentryEvent[] = []

  const server = createServer((req, res) => {
    cors(res)
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    void handle(req, res).catch((err) => json(res, 500, { error: String(err) }))
  })

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true })
    if (req.method === 'GET' && req.url === '/events') return json(res, 200, events)
    if (req.method === 'POST' && req.url === '/reset') {
      events.length = 0
      return json(res, 200, { ok: true })
    }
    if (req.method === 'POST' && /^\/api\/\d+\/envelope\/?/.test(req.url ?? '')) {
      let body = await readBody(req)
      if (req.headers['content-encoding'] === 'gzip') body = gunzipSync(body)
      events.push(...parseEnvelope(body.toString('utf8')))
      return json(res, 200, { id: crypto.randomUUID().replaceAll('-', '') })
    }
    json(res, 404, { error: 'not found' })
  }

  return {
    events,
    listen(port = 0, host?: string) {
      return new Promise<number>((resolve) => {
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port))
      })
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/** Envelope: linha de cabeçalho, depois pares (cabeçalho do item, conteúdo do item). */
export function parseEnvelope(raw: string): SentryEvent[] {
  const lines = raw.split('\n').filter((l) => l.trim())
  const out: SentryEvent[] = []
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const header = JSON.parse(lines[i]!) as { type?: string }
    if (header.type === 'event') out.push(JSON.parse(lines[i + 1]!) as SentryEvent)
  }
  return out
}

export function mockSentryControl(baseUrl: string) {
  return {
    async events(): Promise<SentryEvent[]> {
      return (await (await fetch(new URL('/events', baseUrl))).json()) as SentryEvent[]
    },
    async reset() {
      await fetch(new URL('/reset', baseUrl), { method: 'POST' })
    },
  }
}

function cors(res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
