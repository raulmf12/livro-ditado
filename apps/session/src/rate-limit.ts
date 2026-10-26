/** Balde de fichas: `rate` por segundo, até `burst` acumuladas (T.02). */
export class TokenBucket {
  private tokens: number
  private last: number

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = burst
    this.last = now()
  }

  take(n = 1): boolean {
    const t = this.now()
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.rate)
    this.last = t
    if (this.tokens < n) return false
    this.tokens -= n
    return true
  }
}

/** Limites por conexão. O áudio normal é 10 pedaços por segundo; o reenvio depois de uma queda vem em rajada. */
export const LIMITS = {
  /** Mensagens de controle (cursor, tecla, métrica). */
  control: { rate: 20, burst: 40 },
  /** Pedaços de áudio: folga para reenviar até 2 min de uma vez. */
  audio: { rate: 30, burst: 1_200 },
  /** Conexões abertas ao mesmo tempo por usuário. */
  connectionsPerUser: 4,
}
