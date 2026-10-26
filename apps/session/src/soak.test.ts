// T.05 — Sessão longa: horas de ditado (aceleradas) sem quedas nem vazamento de
// memória. Roda no teste noturno com SOAK_MINUTES (ex.: 120) e node --expose-gc;
// fora disso fica de fora da suíte normal.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, authProtocol, encodeAudioFrame } from '@livro/shared'
import { audioPath, createMockStt, loadScenario, mockSttControl } from '@livro/test-kit'
import { silentLogger } from './log.ts'
import { createSessionServer } from './server.ts'
import { mock } from './stt/providers.ts'
import { BOOK_ID, memoryStore } from './testing.ts'

const minutes = Number(process.env.SOAK_MINUTES ?? 0)
const gc = (globalThis as { gc?: () => void }).gc

describe.skipIf(!minutes)(`sessão de ${minutes} min (T.05)`, () => {
  it('memória estável, todo áudio confirmado e o texto entrando até o fim', async () => {
    const stt = createMockStt({ defaultScenario: 'sessao-longa' })
    const sttPort = await stt.listen(0, '127.0.0.1')
    await mockSttControl(`http://127.0.0.1:${sttPort}`).useScenario('sessao-longa')
    const mem = memoryStore()
    const app = createSessionServer({
      verifyToken: async (token) => ({ userId: 'u1', token }),
      storeFor: () => mem.store,
      stt: { name: 'mock', create: mock(`ws://127.0.0.1:${sttPort}/stt`), usdPerMinute: 0 },
      allowedOrigins: [],
      log: silentLogger,
      limits: { audio: { rate: 10_000, burst: 10_000 } },
    })
    const port = await app.listen(0, '127.0.0.1')

    const pcm = readFileSync(audioPath(loadScenario('sessao-longa'))).subarray(44)
    const chunk = (n: number) => {
      const at = (n * 3200) % (pcm.length - 3200)
      return pcm.subarray(at, at + 3200)
    }
    const total = minutes * 600 // pedaços de 100 ms
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [PROTOCOL_VERSION, authProtocol('x')])
    let lastAck = 0
    let ready!: () => void
    const isReady = new Promise<void>((r) => (ready = r))
    ws.on('message', (d) => {
      const msg = JSON.parse(d.toString()) as { type: string; seq?: number }
      if (msg.type === 'ready') ready()
      if (msg.type === 'ack') lastAck = msg.seq!
      if (msg.type === 'error') throw new Error(`sessão caiu: ${d.toString()}`)
    })
    await new Promise((r) => ws.on('open', r))
    ws.send(JSON.stringify({ type: 'start', bookId: BOOK_ID }))
    await isReady

    const heap = () => {
      gc?.()
      return process.memoryUsage().heapUsed
    }
    let baseline = 0
    for (let n = 1; n <= total; n++) {
      ws.send(encodeAudioFrame(n, chunk(n).buffer.slice(chunk(n).byteOffset, chunk(n).byteOffset + 3200) as ArrayBuffer))
      // não deixa a fila de saída crescer: espera o servidor alcançar
      if (n % 200 === 0) while (n - lastAck > 400) await new Promise((r) => setTimeout(r, 5))
      if (n === Math.round(total * 0.1)) {
        await new Promise((r) => setTimeout(r, 200))
        baseline = heap()
      }
    }
    while (lastAck < total - (total % 5)) await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 500))
    const growthMb = (heap() - baseline) / 1024 / 1024
    const textChars = mem.m.all().reduce((a, b) => a + b.content.length, 0)

    ws.send(JSON.stringify({ type: 'stop' }))
    await new Promise((r) => ws.on('close', r))
    await app.close()
    await stt.close()

    console.log(`sessão de ${minutes} min: memória +${growthMb.toFixed(1)} MB; ${textChars} caracteres; ${mem.state.segments.length} trechos de áudio`)
    expect(lastAck).toBeGreaterThanOrEqual(total - 5)
    expect(textChars).toBeGreaterThan(minutes * 500) // o texto continuou entrando
    // o manuscrito em memória cresce com o texto; o resto (áudio, filas) precisa ficar estável
    expect(growthMb).toBeLessThan(60)
  }, Math.max(60_000, minutes * 6_000))
})
