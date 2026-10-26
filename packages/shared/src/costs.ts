/**
 * Preço por minuto de áudio de cada provedor de transcrição (T.04).
 * Estimativas de tabela pública: confira na página de cada provedor e
 * sobrescreva com STT_USD_PER_MINUTE quando houver contrato.
 */
export const STT_USD_PER_MINUTE: Record<string, number> = {
  mock: 0,
  deepgram: 0.0077,
  assemblyai: 0.0025,
  elevenlabs: 0.0067,
}

/** Teto mensal padrão de gastos com APIs (STT + Claude), em dólares. */
export const DEFAULT_MONTHLY_CAP_USD = 50

export function sttCostUsd(provider: string, audioMs: number, override?: number): number {
  const perMinute = override ?? STT_USD_PER_MINUTE[provider] ?? 0
  return (audioMs / 60_000) * perMinute
}
