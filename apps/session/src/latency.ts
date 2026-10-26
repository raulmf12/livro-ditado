export interface LatencySummary {
  p50Ms: number | null
  p95Ms: number | null
  samples: number
}

export const MAX_LATENCY_SAMPLES = 10_000

/** p50 e p95 pelo método do posto mais próximo. */
export function summarizeLatency(values: number[]): LatencySummary {
  if (values.length === 0) return { p50Ms: null, p95Ms: null, samples: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!)
  return { p50Ms: at(0.5), p95Ms: at(0.95), samples: sorted.length }
}
