// Serviço de exportação (F1.23–F1.25): manuscrito → documento do Pandoc → .docx com o modelo do livro.
// Só é acessível de dentro da rede da pilha (o Caddy não o publica); sem CORS (T.02).
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { exportBook, type ExportRequest } from './export.ts'
import { findPandoc } from './pandoc.ts'

const port = Number(process.env.EXPORT_PORT ?? 4030)
const env = { url: required('SUPABASE_URL'), publishableKey: required('SUPABASE_PUBLISHABLE_KEY') }
const auth = createClient(env.url, env.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })

createServer((req, res) => {
  void handle(req, res).catch((err: Error & { status?: number }) => {
    log('error', 'falha na exportação', { error: err.message })
    json(res, err.status ?? 500, { error: err.status ? err.message : 'falha ao exportar' })
  })
}).listen(port, () => log('info', 'serviço de exportação no ar', { port }))

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'GET' && req.url === '/health') {
    const pandoc = await findPandoc().then(
      () => true,
      () => false,
    )
    return json(res, 200, { ok: true, pandoc })
  }
  if (req.method === 'POST' && req.url === '/exports') {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')
    if (!token) return json(res, 401, { error: 'sem sessão' })
    const { data, error } = await auth.auth.getClaims(token)
    if (error || !data || data.claims.role !== 'authenticated') return json(res, 401, { error: 'sessão inválida' })

    const body = JSON.parse(await readBody(req)) as Partial<ExportRequest>
    if (!body.bookId || (body.scope !== 'book' && body.scope !== 'chapter')) return json(res, 400, { error: 'pedido inválido' })
    const result = await exportBook(env, token, {
      bookId: body.bookId,
      scope: body.scope,
      chapterId: body.chapterId,
      trigger: body.trigger === 'session_end' ? 'session_end' : 'manual',
      omitAiMarks: !!body.omitAiMarks,
    })
    log('info', 'exportação concluída', { bookId: body.bookId, scope: body.scope, ms: result.durationMs, bytes: result.sizeBytes })
    return json(res, 201, result)
  }
  json(res, 404, { error: 'não encontrado' })
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`variável de ambiente ${name} não definida`)
  return v
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c: Buffer) => {
      data += c.toString()
      if (data.length > 64 * 1024) req.destroy(new Error('pedido grande demais'))
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function log(level: string, msg: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), level, msg, service: 'export', ...fields }) + '\n')
}
