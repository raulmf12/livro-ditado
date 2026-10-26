import { existsSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createMockStt, mockSttControl } from './mock-stt.ts'
import { audioPath, listScenarios, loadScenario, referenceTranscript } from './scenarios.ts'

let stt: ReturnType<typeof createMockStt>
let port: number

beforeEach(async () => {
  stt = createMockStt()
  port = await stt.listen(0, '127.0.0.1')
})
afterEach(() => stt.close())

type Msg = { type: string; kind?: string; text?: string; message?: string }

function open(bookId: string, keywords: string[] = []) {
  return new Promise<{ ws: WebSocket; msgs: Msg[] }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/stt`)
    const msgs: Msg[] = []
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString()) as Msg))
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'config', bookId, sessionId: 's1', language: 'pt-BR', keywords }))
      resolve({ ws, msgs })
    })
  })
}

const audio = (ms: number) => Buffer.alloc(ms * 32)
const tick = () => new Promise((r) => setTimeout(r, 30))

describe('simulador de STT', () => {
  it('libera provisórios e finais conforme o áudio chega', async () => {
    const { ws, msgs } = await open('obra-1')
    ws.send(audio(800))
    await tick()
    expect(msgs.map((m) => m.text)).toEqual(['A função social'])

    ws.send(audio(2000))
    await tick()
    expect(msgs.filter((m) => m.kind === 'final').map((m) => m.text)).toEqual([
      'A função social da propriedade rural é princípio constitucional.',
    ])
    ws.close()
  })

  it('no fim do áudio entrega o que falta e avisa "done"', async () => {
    const { ws, msgs } = await open('obra-1')
    ws.send(JSON.stringify({ type: 'finish' }))
    await tick()
    const finals = msgs.filter((m) => m.kind === 'final').map((m) => m.text)
    expect(finals).toEqual(referenceTranscript(loadScenario('ditado-simples')))
    expect(msgs.at(-1)).toEqual({ type: 'done' })
    ws.close()
  })

  it('escolhe o cenário por obra e registra o glossário recebido', async () => {
    const control = mockSttControl(`http://127.0.0.1:${port}`)
    await control.useScenario('pesquisa-artigo', 'obra-2')
    const { ws, msgs } = await open('obra-2', ['usucapião'])
    ws.send(JSON.stringify({ type: 'finish' }))
    await tick()
    expect(msgs.find((m) => m.kind === 'final')?.text).toBe('Atena, busca o artigo 1.228 do Código Civil.')
    expect(await control.requests()).toMatchObject([{ bookId: 'obra-2', keywords: ['usucapião'], scenario: 'pesquisa-artigo' }])
    ws.close()
  })

  it('simula a queda do provedor', async () => {
    const control = mockSttControl(`http://127.0.0.1:${port}`)
    await control.useScenario('falha-stt')
    const { ws, msgs } = await open('obra-3')
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)))
    ws.send(audio(1500))
    expect(await closed).toBe(1011)
    expect(msgs.map((m) => m.type)).toEqual(['transcript', 'error'])
  })
})

describe('cenários', () => {
  it.each(listScenarios().map((s) => [s.name, s] as const))('%s tem áudio e eventos em ordem', (_name, s) => {
    expect(existsSync(audioPath(s))).toBe(true)
    const times = s.events.map((e) => e.atMs)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
