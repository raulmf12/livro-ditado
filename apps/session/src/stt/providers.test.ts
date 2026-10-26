// F1.03 — o mesmo cenário passa pelos três provedores, com o simulador
// imitando o formato de cada um. Nada fora do adaptador muda.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { audioPath, createMockStt, loadScenario, mockSttControl, referenceTranscript } from '@livro/test-kit'
import { silentLogger } from '../log.ts'
import { SttPipeline } from './pipeline.ts'
import { assemblyai, assemblyaiUrl, deepgram, deepgramUrl, elevenlabs, elevenlabsUrl, mock } from './providers.ts'
import type { SttFactory, SttTranscript } from './types.ts'

let server: ReturnType<typeof createMockStt>
let base: string

beforeAll(async () => {
  server = createMockStt()
  const port = await server.listen(0, '127.0.0.1')
  base = `127.0.0.1:${port}`
})
afterAll(() => server.close())

const scenario = loadScenario('ditado-simples')
const pcm = readFileSync(audioPath(scenario)).subarray(44) // sem o cabeçalho WAV

async function transcribe(factory: SttFactory) {
  const pipeline = new SttPipeline(factory, {
    bookId: 'obra-teste',
    sessionId: 'sessao-teste',
    sampleRate: 16_000,
    language: 'pt-BR',
    keywords: ['usucapião', 'enfiteuse'],
  }, silentLogger)
  const results: SttTranscript[] = []
  pipeline.onTranscript((t) => results.push(t))
  await pipeline.start()
  for (let i = 0; i < pcm.length; i += 3200) pipeline.send(pcm.subarray(i, i + 3200))
  await new Promise((r) => setTimeout(r, 100))
  await pipeline.finish()
  pipeline.close()
  return results
}

const providers: [string, () => SttFactory][] = [
  ['simulador neutro', () => mock(`ws://${base}/stt`)],
  ['Deepgram', () => deepgram({ apiKey: 'chave-teste', baseUrl: `ws://${base}/deepgram` })],
  ['AssemblyAI', () => assemblyai({ apiKey: 'chave-teste', baseUrl: `ws://${base}/assemblyai` })],
  ['ElevenLabs', () => elevenlabs({ apiKey: 'chave-teste', baseUrl: `ws://${base}/elevenlabs` })],
]

describe.each(providers)('%s', (_name, make) => {
  it('entrega os mesmos finais da transcrição de referência, com tempos crescentes', async () => {
    await mockSttControl(`http://${base}`).reset()
    const results = await transcribe(make())
    const finals = results.filter((r) => r.kind === 'final')
    expect(finals.map((f) => f.text)).toEqual(referenceTranscript(scenario))
    expect(finals.every((f, i) => i === 0 || f.endMs >= finals[i - 1]!.endMs)).toBe(true)
    expect(results.some((r) => r.kind === 'interim')).toBe(true)

    const [req] = await mockSttControl(`http://${base}`).requests()
    expect(req!.keywords).toEqual(['usucapião', 'enfiteuse']) // glossário vai na abertura (F1.07)
  })
})

describe('credenciais e sigilo (T.03)', () => {
  it('a chave vai em cabeçalho, nunca na URL', async () => {
    await mockSttControl(`http://${base}`).reset()
    await transcribe(deepgram({ apiKey: 'chave-teste', baseUrl: `ws://${base}/deepgram` }))
    await transcribe(assemblyai({ apiKey: 'chave-teste', baseUrl: `ws://${base}/assemblyai` }))
    await transcribe(elevenlabs({ apiKey: 'chave-teste', baseUrl: `ws://${base}/elevenlabs` }))
    const reqs = await mockSttControl(`http://${base}`).requests()
    expect(reqs.map((r) => r.authenticated)).toEqual([true, true, true])
    for (const url of [deepgramUrl({ apiKey: 'chave-teste' }, [], 'pt-BR', 16000), assemblyaiUrl({ apiKey: 'chave-teste' }, [], 16000), elevenlabsUrl({ apiKey: 'chave-teste' }, [])]) {
      expect(url).not.toContain('chave-teste')
    }
  })

  it('retenção zero ligada onde o provedor oferece na conexão', () => {
    expect(deepgramUrl({ apiKey: 'x' }, [], 'pt-BR', 16000)).toContain('mip_opt_out=true')
    expect(elevenlabsUrl({ apiKey: 'x' }, [])).toContain('enable_logging=false')
  })

  it('português do Brasil em todos', () => {
    expect(deepgramUrl({ apiKey: 'x' }, [], 'pt-BR', 16000)).toContain('language=pt-BR')
    expect(decodeURIComponent(assemblyaiUrl({ apiKey: 'x' }, [], 16000))).toContain('language_codes=["pt"]')
    expect(elevenlabsUrl({ apiKey: 'x' }, [])).toContain('language_code=pt')
  })
})
