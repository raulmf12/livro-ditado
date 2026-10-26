// Benchmark de transcrição (F1.04): roda o áudio do autor nos provedores e escolhe um.
//
//   pnpm --filter @livro/session benchmark <pasta> [--providers deepgram,assemblyai,elevenlabs] [--speed 1] [--out relatorio.md]
//
// A pasta tem pares <nome>.wav (16 kHz, mono, 16 bits) + <nome>.txt (transcrição revisada)
// e, opcional, termos.txt (um termo jurídico por linha). As chaves vêm do ambiente:
// DEEPGRAM_API_KEY, ASSEMBLYAI_API_KEY, ELEVENLABS_API_KEY. O áudio do autor é sigiloso:
// não vai para o repositório.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { benchmarkProvider, recommend, reportMarkdown, type BenchmarkSample } from '../src/benchmark/run.ts'
import { jsonLogger } from '../src/log.ts'
import { assemblyai, deepgram, elevenlabs } from '../src/stt/providers.ts'
import type { SttFactory } from '../src/stt/types.ts'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
if (!dir) {
  console.error('uso: benchmark <pasta> [--providers deepgram,assemblyai,elevenlabs] [--speed 1] [--out relatorio.md]')
  process.exit(2)
}

const samples: BenchmarkSample[] = readdirSync(dir)
  .filter((f) => f.endsWith('.wav'))
  .map((f) => {
    const name = basename(f, '.wav')
    const txt = join(dir, `${name}.txt`)
    if (!existsSync(txt)) throw new Error(`falta a transcrição de referência: ${txt}`)
    return { name, pcm: pcmOf(readFileSync(join(dir, f))), reference: readFileSync(txt, 'utf8') }
  })
const termsFile = join(dir, 'termos.txt')
const terms = existsSync(termsFile) ? readFileSync(termsFile, 'utf8').split('\n').map((t) => t.trim()).filter(Boolean) : []

const env = process.env
const factories: Record<string, () => SttFactory> = {
  deepgram: () => deepgram({ apiKey: env.DEEPGRAM_API_KEY!, baseUrl: env.DEEPGRAM_URL, model: env.DEEPGRAM_MODEL }),
  assemblyai: () => assemblyai({ apiKey: env.ASSEMBLYAI_API_KEY!, baseUrl: env.ASSEMBLYAI_URL, model: env.ASSEMBLYAI_MODEL }),
  elevenlabs: () => elevenlabs({ apiKey: env.ELEVENLABS_API_KEY!, baseUrl: env.ELEVENLABS_URL, zeroRetention: env.ELEVENLABS_ZERO_RETENTION !== 'false' }),
}
const keyOf: Record<string, string> = { deepgram: 'DEEPGRAM_API_KEY', assemblyai: 'ASSEMBLYAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY' }
const providers = (opt('providers') ?? 'deepgram,assemblyai,elevenlabs').split(',').filter((p) => {
  if (!factories[p]) throw new Error(`provedor desconhecido: ${p}`)
  if (!env[keyOf[p]!]) {
    console.warn(`pulando ${p}: ${keyOf[p]} não definida`)
    return false
  }
  return true
})

const log = jsonLogger({ service: 'benchmark' })
const results = []
for (const p of providers) {
  console.log(`rodando ${p}…`)
  results.push(await benchmarkProvider(p, factories[p]!(), samples, terms, log, Number(opt('speed') ?? 1)))
}
const report = reportMarkdown(results, samples)
writeFileSync(opt('out') ?? 'benchmark-stt.md', report)
writeFileSync((opt('out') ?? 'benchmark-stt.md').replace(/\.md$/, '.json'), JSON.stringify({ results, recommendation: recommend(results)?.provider ?? null }, null, 2))
console.log(report)

function pcmOf(wav: Buffer): Buffer {
  let at = 12
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    if (id === 'fmt ') {
      const channels = wav.readUInt16LE(at + 10)
      const rate = wav.readUInt32LE(at + 12)
      const bits = wav.readUInt16LE(at + 22)
      if (channels !== 1 || rate !== 16_000 || bits !== 16) throw new Error('o áudio precisa ser WAV 16 kHz, mono, 16 bits (ffmpeg -i in -ac 1 -ar 16000 -sample_fmt s16 out.wav)')
    }
    if (id === 'data') return wav.subarray(at + 8, at + 8 + size)
    at += 8 + size + (size % 2)
  }
  throw new Error('WAV sem dados')
}
