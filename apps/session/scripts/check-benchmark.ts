// E2E-13: confere o resultado do teste noturno com o provedor escolhido.
//   tsx scripts/check-benchmark.ts <resultado.json> [--max-wer 0.08] [--max-p95 1500]
import { readFileSync } from 'node:fs'
import type { ProviderResult } from '../src/benchmark/run.ts'

const args = process.argv.slice(2)
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : fallback
}
const { results } = JSON.parse(readFileSync(args[0]!, 'utf8')) as { results: ProviderResult[] }
const maxWer = opt('max-wer', 0.08)
const maxP95 = opt('max-p95', 1500)
let ok = true
for (const r of results) {
  const problems = [
    ...r.failures.map((f) => `queda: ${f}`),
    r.wer > maxWer ? `erro ${(r.wer * 100).toFixed(1)}% acima do limite de ${(maxWer * 100).toFixed(1)}%` : null,
    r.latencyP95Ms === null || r.latencyP95Ms > maxP95 ? `latência p95 ${r.latencyP95Ms} ms acima de ${maxP95} ms` : null,
  ].filter(Boolean)
  console.log(`${r.provider}: erro ${(r.wer * 100).toFixed(1)}%, termos ${(r.termRecall * 100).toFixed(1)}%, p95 ${r.latencyP95Ms} ms, reconexões ${r.reconnections}`)
  for (const p of problems) console.error(`  ✗ ${p}`)
  if (problems.length) ok = false
}
process.exit(ok ? 0 : 1)
