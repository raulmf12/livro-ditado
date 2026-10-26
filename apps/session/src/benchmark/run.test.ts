// O benchmark roda de ponta a ponta contra o simulador imitando os três provedores.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { audioPath, createMockStt, loadScenario, referenceTranscript } from '@livro/test-kit'
import { silentLogger } from '../log.ts'
import { assemblyai, deepgram, elevenlabs } from '../stt/providers.ts'
import { benchmarkProvider, recommend, reportMarkdown } from './run.ts'

let server: ReturnType<typeof createMockStt>
let base: string
beforeAll(async () => {
  server = createMockStt()
  base = `ws://127.0.0.1:${await server.listen(0, '127.0.0.1')}`
})
afterAll(() => server.close())

it('mede, compara e recomenda (simulador nos três formatos)', async () => {
  const scenario = loadScenario('ditado-simples')
  const sample = { name: 'amostra', pcm: readFileSync(audioPath(scenario)).subarray(44), reference: referenceTranscript(scenario).join(' ') }
  const terms = ['função social', 'propriedade rural']
  const results = [
    await benchmarkProvider('deepgram', deepgram({ apiKey: 'x', baseUrl: `${base}/deepgram` }), [sample], terms, silentLogger, 50),
    await benchmarkProvider('assemblyai', assemblyai({ apiKey: 'x', baseUrl: `${base}/assemblyai` }), [sample], terms, silentLogger, 50),
    await benchmarkProvider('elevenlabs', elevenlabs({ apiKey: 'x', baseUrl: `${base}/elevenlabs` }), [sample], terms, silentLogger, 50),
  ]
  for (const r of results) {
    expect(r.failures).toEqual([])
    expect(r.wer).toBe(0)
    expect(r.termRecall).toBe(1)
  }
  // empate em erro e termos: decide o custo
  expect(recommend(results)?.provider).toBe('assemblyai')
  expect(reportMarkdown(results, [sample])).toContain('**Recomendação:** assemblyai')
}, 60_000)
