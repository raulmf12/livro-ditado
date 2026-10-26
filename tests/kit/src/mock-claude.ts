import { readFileSync, readdirSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { CLAUDE_DIR } from './scenarios.ts'

export interface ClaudeFixture {
  name: string
  description: string
  /** Expressão regular aplicada ao texto da última mensagem do usuário. */
  match: string
  response: { stop_reason: string; content: unknown[] }
}

interface MessagesRequest {
  model: string
  messages: { role: string; content: string | { type: string; text?: string }[] }[]
}

export function loadClaudeFixtures(): ClaudeFixture[] {
  return readdirSync(CLAUDE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ name: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(CLAUDE_DIR, f), 'utf8')) }))
}

/**
 * Simulador da API de mensagens da Anthropic (POST /v1/messages). Devolve uma
 * resposta fixa por cenário: o cabeçalho `x-mock-scenario` escolhe o cenário;
 * sem ele, vale o primeiro cujo `match` casar com a última fala do usuário.
 * Inclui um cenário malicioso (trecho-alterado) para provar que a checagem de
 * literalidade bloqueia citações modificadas.
 *
 * Os clientes apontam para cá com ANTHROPIC_BASE_URL=http://localhost:<porta>.
 */
export function createMockClaude() {
  const fixtures = loadClaudeFixtures()
  const requests: { scenario: string | null; body: MessagesRequest }[] = []

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => json(res, 500, apiError('api_error', String(err))))
  })

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true })
    if (req.method === 'GET' && req.url === '/requests') return json(res, 200, requests)
    if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
      return json(res, 404, apiError('not_found_error', 'rota não simulada'))
    }

    const body = JSON.parse(await readBody(req)) as MessagesRequest
    const header = req.headers['x-mock-scenario']
    const lastUser = lastUserText(body)
    const fixture =
      typeof header === 'string'
        ? fixtures.find((f) => f.name === header)
        : fixtures.find((f) => new RegExp(f.match).test(lastUser))
    requests.push({ scenario: fixture?.name ?? null, body })

    if (!fixture) {
      return json(res, 200, message(body.model, 'end_turn', [{ type: 'text', text: 'Sem cenário para este pedido.' }]))
    }
    json(res, 200, message(body.model, fixture.response.stop_reason, fixture.response.content))
  }

  return {
    listen(port = 0, host?: string) {
      return new Promise<number>((resolve) => {
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port))
      })
    },
    requests,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

function lastUserText(body: MessagesRequest): string {
  const last = [...body.messages].reverse().find((m) => m.role === 'user')
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return last.content.map((c) => c.text ?? '').join('\n')
}

function message(model: string, stopReason: string, content: unknown[]) {
  return {
    id: `msg_mock_${crypto.randomUUID().replaceAll('-', '')}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20 },
  }
}

function apiError(type: string, msg: string) {
  return { type: 'error', error: { type, message: msg } }
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
