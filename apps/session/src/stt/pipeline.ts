import type { Logger } from '../log.ts'
import type { SttFactory, SttStream, SttStreamOptions, SttTranscript } from './types.ts'

const BYTES_PER_MS = 32 // 16 kHz × 2 bytes
/** Quanto áudio sem final o pipeline guarda para reenviar se o provedor cair. */
const MAX_REPLAY_MS = 120_000

/**
 * Fica entre a sessão e o provedor (F1.02): numera o tempo do áudio da
 * sessão, guarda o áudio desde o último resultado final e, se o provedor cair,
 * abre outro stream, reenvia esse áudio e corrige os tempos. Só desiste depois
 * de `maxRetries` quedas seguidas sem nenhum final no meio.
 */
export class SttPipeline {
  private stream: SttStream | null = null
  private connecting: Promise<void> | null = null
  private replay: { startMs: number; chunk: Buffer }[] = []
  private sentMs = 0
  private streamOffsetMs = 0
  private failures = 0
  private closed = false
  private transcriptListeners: ((t: SttTranscript) => void)[] = []
  private fatalListeners: ((err: Error) => void)[] = []

  constructor(
    private readonly factory: SttFactory,
    private readonly opts: SttStreamOptions,
    private readonly log: Logger,
    private readonly maxRetries = 3,
  ) {}

  /** Tempo total de áudio recebido na sessão (ms). */
  get audioMs(): number {
    return this.sentMs
  }

  async start() {
    await this.open(0)
  }

  onTranscript(l: (t: SttTranscript) => void) {
    this.transcriptListeners.push(l)
  }

  onFatal(l: (err: Error) => void) {
    this.fatalListeners.push(l)
  }

  send(chunk: Buffer) {
    if (this.closed) return
    this.replay.push({ startMs: this.sentMs, chunk })
    this.sentMs += chunk.length / BYTES_PER_MS
    while (this.replay.length && this.sentMs - this.replay[0]!.startMs > MAX_REPLAY_MS) this.replay.shift()
    if (this.stream && !this.connecting) this.stream.send(chunk)
  }

  flush() {
    if (!this.connecting) this.stream?.flush()
  }

  async finish() {
    if (this.connecting) await this.connecting.catch(() => {})
    await this.stream?.finish()
  }

  close() {
    this.closed = true
    this.stream?.close()
    this.stream = null
  }

  private async open(offsetMs: number) {
    const stream = await this.factory(this.opts)
    this.streamOffsetMs = offsetMs
    stream.onTranscript((t) => {
      if (this.stream !== stream) return
      const shifted = { ...t, startMs: Math.round(t.startMs + this.streamOffsetMs), endMs: Math.round(t.endMs + this.streamOffsetMs) }
      if (t.kind === 'final') {
        this.failures = 0
        // o que já virou final não precisa mais ser reenviado
        while (this.replay.length && this.replay[0]!.startMs + this.replay[0]!.chunk.length / BYTES_PER_MS <= shifted.endMs) this.replay.shift()
      }
      for (const l of this.transcriptListeners) l(shifted)
    })
    stream.onError((err) => {
      if (this.stream === stream) void this.recover(err)
    })
    this.stream = stream
  }

  private async recover(err: Error) {
    if (this.closed || this.connecting) return
    this.failures++
    this.stream?.close()
    this.stream = null
    if (this.failures > this.maxRetries) {
      for (const l of this.fatalListeners) l(err)
      return
    }
    this.log.warn('provedor de transcrição caiu; reconectando', {
      err,
      sessionId: this.opts.sessionId,
      attempt: this.failures,
    })
    const from = this.replay[0]?.startMs ?? this.sentMs
    this.connecting = (async () => {
      try {
        await this.open(from)
        // reenvia o áudio que ainda não virou final, inclusive o que chegou durante a reconexão;
        // "connecting" volta a null no mesmo passo, então nenhum pedaço novo fica de fora
        for (const { chunk } of this.replay) this.stream!.send(chunk)
      } finally {
        this.connecting = null
      }
    })()
    try {
      await this.connecting
    } catch (e) {
      await this.recover(e as Error)
    }
  }
}
