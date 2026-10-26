import { createServer as createHttpServer } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'

/**
 * Proxy TCP que os testes usam para "derrubar a rede" entre o navegador e o
 * servidor de sessão (F1.02, E2E-09): corta as conexões abertas e recusa
 * novas por um tempo.
 *
 *   POST /cut {"ms": 5000}   derruba tudo e recusa conexões por 5 s
 */
export function createNetCutter(opts: { listenPort: number; targetPort: number; targetHost?: string; controlPort: number }) {
  const sockets = new Set<Socket>()
  let blockedUntil = 0

  const proxy = createServer((client) => {
    if (Date.now() < blockedUntil) return client.destroy()
    const upstream = connect(opts.targetPort, opts.targetHost ?? '127.0.0.1')
    sockets.add(client)
    sockets.add(upstream)
    const drop = () => {
      client.destroy()
      upstream.destroy()
      sockets.delete(client)
      sockets.delete(upstream)
    }
    client.on('error', drop).on('close', drop)
    upstream.on('error', drop).on('close', drop)
    client.pipe(upstream)
    upstream.pipe(client)
  })

  const control = createHttpServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') return void res.writeHead(200).end('{"ok":true}')
    if (req.method === 'POST' && req.url === '/cut') {
      let body = ''
      req.on('data', (c: Buffer) => (body += c.toString()))
      req.on('end', () => {
        const { ms } = JSON.parse(body || '{}') as { ms?: number }
        blockedUntil = Date.now() + (ms ?? 5000)
        for (const s of sockets) s.destroy()
        sockets.clear()
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, until: blockedUntil }))
      })
      return
    }
    res.writeHead(404).end()
  })

  return {
    listen() {
      return Promise.all([
        new Promise<void>((r) => proxy.listen(opts.listenPort, r)),
        new Promise<void>((r) => control.listen(opts.controlPort, r)),
      ])
    },
    close() {
      for (const s of sockets) s.destroy()
      return Promise.all([new Promise((r) => proxy.close(r)), new Promise((r) => control.close(r))])
    },
  }
}

export function netCutterControl(baseUrl: string) {
  return {
    async cut(ms: number) {
      const res = await fetch(new URL('/cut', baseUrl), { method: 'POST', body: JSON.stringify({ ms }) })
      if (!res.ok) throw new Error(`cortador de rede respondeu ${res.status}`)
    },
  }
}
