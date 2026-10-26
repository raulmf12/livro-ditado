/**
 * Relógio do áudio enviado: para cada pedaço, guarda até que milissegundo do
 * áudio ele vai e quando saiu do navegador. Com isso, quando chega um final
 * que termina em `endMs`, a latência fala → tela é "agora" menos o momento em
 * que aquele trecho de áudio saiu.
 */
export class AudioClock {
  private entries: { audioMs: number; at: number }[] = []
  private audioMs = 0

  constructor(private readonly maxEntries = 3_000) {}

  /** Registra um pedaço enviado com `durationMs` de áudio, no instante `at` (performance.now()). */
  record(durationMs: number, at: number) {
    this.audioMs += durationMs
    this.entries.push({ audioMs: this.audioMs, at })
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)
  }

  /** Instante em que o áudio até `endMs` terminou de sair, ou null se ainda não saiu ou já foi descartado. */
  sentAt(endMs: number): number | null {
    const first = this.entries[0]
    if (!first || endMs > this.audioMs || endMs < first.audioMs - 1_000) return null
    let lo = 0
    let hi = this.entries.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.entries[mid]!.audioMs >= endMs) hi = mid
      else lo = mid + 1
    }
    return this.entries[lo]!.at
  }
}
