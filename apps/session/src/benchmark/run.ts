import { STT_USD_PER_MINUTE } from '@livro/shared'
import type { Logger } from '../log.ts'
import { SttPipeline } from '../stt/pipeline.ts'
import type { SttFactory } from '../stt/types.ts'
import { termRecall, wordErrorRate } from './wer.ts'

export interface BenchmarkSample {
  name: string
  /** PCM 16 bits, 16 kHz, mono. */
  pcm: Buffer
  reference: string
}

export interface ProviderResult {
  provider: string
  wer: number
  termRecall: number
  missedTerms: string[]
  latencyP50Ms: number | null
  latencyP95Ms: number | null
  reconnections: number
  audioMinutes: number
  costUsd: number
  failures: string[]
}

const CHUNK = 3200 // 100 ms

/**
 * Roda as amostras num provedor, no ritmo do áudio (speed=1 é tempo real), e
 * mede erro geral, acerto nos termos jurídicos e a latência de cada final
 * (do fim do áudio do trecho até o final chegar).
 */
export async function benchmarkProvider(
  provider: string,
  factory: SttFactory,
  samples: BenchmarkSample[],
  terms: string[],
  log: Logger,
  speed = 1,
): Promise<ProviderResult> {
  const hyps: string[] = []
  const latencies: number[] = []
  const failures: string[] = []
  let reconnections = 0
  let audioMs = 0
  const countingLog: Logger = { ...log, warn: (msg, f) => (reconnections++, log.warn(msg, f)) }

  for (const sample of samples) {
    const finals: string[] = []
    const sentAt: number[] = [] // instante em que cada pedaço de 100 ms saiu
    const pipeline = new SttPipeline(factory, { bookId: 'benchmark', sessionId: sample.name, sampleRate: 16_000, language: 'pt-BR', keywords: terms.slice(0, 100) }, countingLog)
    pipeline.onTranscript((t) => {
      if (t.kind !== 'final') return
      finals.push(t.text)
      const chunk = Math.min(sentAt.length - 1, Math.max(0, Math.ceil(t.endMs / 100) - 1))
      if (sentAt[chunk] !== undefined) latencies.push(Date.now() - sentAt[chunk]!)
    })
    let fatal: Error | null = null
    pipeline.onFatal((err) => (fatal = err))
    try {
      await pipeline.start()
      const started = Date.now()
      for (let i = 0, n = 0; i < sample.pcm.length; i += CHUNK, n++) {
        const due = started + (n * 100) / speed
        const wait = due - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        pipeline.send(sample.pcm.subarray(i, i + CHUNK))
        sentAt.push(Date.now())
        if (fatal) break
      }
      await pipeline.finish()
    } catch (err) {
      fatal = err as Error
    } finally {
      pipeline.close()
    }
    if (fatal) failures.push(`${sample.name}: ${(fatal as Error).message}`)
    audioMs += sample.pcm.length / 32
    hyps.push(finals.join(' '))
  }

  const reference = samples.map((s) => s.reference).join(' ')
  const hypothesis = hyps.join(' ')
  const sorted = [...latencies].sort((a, b) => a - b)
  const pct = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]! : null)
  const terms_ = termRecall(reference, hypothesis, terms)
  return {
    provider,
    wer: wordErrorRate(reference, hypothesis).wer,
    termRecall: terms_.recall,
    missedTerms: terms_.missed,
    latencyP50Ms: pct(0.5),
    latencyP95Ms: pct(0.95),
    reconnections,
    audioMinutes: audioMs / 60_000,
    costUsd: (audioMs / 60_000) * (STT_USD_PER_MINUTE[provider] ?? 0),
    failures,
  }
}

/**
 * Escolhe o provedor: o que erra menos nos termos jurídicos, desde que o
 * erro geral fique a até 1 ponto do melhor; empate decide pelo custo.
 */
export function recommend(results: ProviderResult[]): ProviderResult | null {
  const ok = results.filter((r) => !r.failures.length)
  if (!ok.length) return null
  const bestWer = Math.min(...ok.map((r) => r.wer))
  return ok
    .filter((r) => r.wer <= bestWer + 0.01)
    .sort((a, b) => b.termRecall - a.termRecall || a.costUsd - b.costUsd)[0]!
}

export function reportMarkdown(results: ProviderResult[], samples: BenchmarkSample[]): string {
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`
  const ms = (v: number | null) => (v === null ? '—' : `${v} ms`)
  const choice = recommend(results)
  const minutes = samples.reduce((a, s) => a + s.pcm.length / 32 / 60_000, 0)
  return [
    '# Benchmark de transcrição (F1.04)',
    '',
    `${samples.length} amostras, ${minutes.toFixed(1)} min de áudio. WER: erro de palavras (menor é melhor). Termos: acerto nos termos jurídicos (maior é melhor).`,
    '',
    '| Provedor | WER | Termos | Latência p50 | Latência p95 | Reconexões | Custo estimado | Falhas |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${r.provider} | ${pct(r.wer)} | ${pct(r.termRecall)} | ${ms(r.latencyP50Ms)} | ${ms(r.latencyP95Ms)} | ${r.reconnections} | US$ ${r.costUsd.toFixed(2)} | ${r.failures.length ? r.failures.join('; ') : '—'} |`,
    ),
    '',
    choice
      ? `**Recomendação:** ${choice.provider} (menor erro nos termos entre os que ficam a até 1 ponto do melhor WER).`
      : '**Nenhum provedor terminou sem falha.**',
    '',
    ...results
      .filter((r) => r.missedTerms.length)
      .map((r) => `- ${r.provider} errou: ${r.missedTerms.slice(0, 20).join(', ')}${r.missedTerms.length > 20 ? '…' : ''}`),
    '',
  ].join('\n')
}
