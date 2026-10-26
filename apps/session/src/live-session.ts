import { DEFAULT_SETTINGS, DictationEngine, Manuscript, type Transaction } from '@livro/dictation'
import {
  AUDIO_SAMPLE_RATE,
  RESUME_GRACE_MS,
  decodeAudioFrame,
  friendlyError,
  type Cursor,
  type ErrorCode,
  type ServerMessage,
} from '@livro/shared'
import { PcmBuffer, wav } from './audio.ts'
import { MAX_LATENCY_SAMPLES, summarizeLatency } from './latency.ts'
import type { Logger } from './log.ts'
import type { AuthUser, BookInfo, BookStore } from './store.ts'
import { SttPipeline, type SttProvider, type SttTranscript } from './stt/index.ts'

export interface SessionDeps {
  storeFor: (user: AuthUser) => BookStore
  stt: SttProvider
  log: Logger
  /** Gera o Word da obra ao fim da sessão (F1.25). */
  exportBook?: (bookId: string, user: AuthUser) => Promise<void>
}

/** Recebe as mensagens para o navegador; troca a cada reconexão. */
export interface ClientChannel {
  send(msg: ServerMessage): void
  close(code: number, reason: string): void
}

const ACK_EVERY = 5
const USAGE_EVERY_MS = 30_000
/** Áudio sem nenhum final por mais que isso vai para o Storage assim mesmo (nada se perde). */
const MAX_UNCUT_MS = 10 * 60_000
const MAX_OUTBOX = 2_000

/**
 * Uma sessão de ditado. Sobrevive a quedas de conexão do navegador por
 * RESUME_GRACE_MS: o STT continua aberto, o que for produzido fica numa fila e
 * sai quando o navegador volta com "resume" (F1.02).
 */
export class LiveSession {
  readonly id: string
  private channel: ClientChannel | null = null
  private outbox: ServerMessage[] = []
  private lastSeq = 0
  private keyWindows: { downMs: number; upMs: number | null }[] = []
  private audio = new PcmBuffer()
  private segmentSeq = 0
  private versionId = 0
  private writes: Promise<void> = Promise.resolve()
  private segments: Promise<void> = Promise.resolve()
  private latencies: number[] = []
  private ended = false
  private detachTimer: NodeJS.Timeout | null = null
  private usageTimer: NodeJS.Timeout
  private onEnd: (() => void)[] = []

  private constructor(
    private readonly deps: SessionDeps,
    readonly user: AuthUser,
    readonly book: BookInfo,
    sessionId: string,
    private readonly store: BookStore,
    private readonly engine: DictationEngine,
    private readonly pipeline: SttPipeline,
  ) {
    this.id = sessionId
    this.usageTimer = setInterval(() => {
      void this.store.updateUsage(this.id, Math.round(this.pipeline.audioMs)).catch(() => {})
    }, USAGE_EVERY_MS)
    this.usageTimer.unref?.()
  }

  /** Abre a sessão: carrega a obra, as regras e o glossário, e conecta ao provedor. */
  static async open(
    deps: SessionDeps,
    user: AuthUser,
    input: { bookId: string; device?: string; cursor?: Cursor },
  ): Promise<LiveSession | ErrorCode> {
    const store = deps.storeFor(user)
    const book = await store.findBook(input.bookId)
    if (!book) return 'book_not_found'

    const [blocks, rules, versionId] = await Promise.all([
      store.loadBlocks(book.id),
      store.loadSpellingRules(book.id),
      store.latestVersionId(book.id),
    ])
    const manuscript = new Manuscript(blocks)
    const cursor = validCursor(manuscript, input.cursor)
    const engine = new DictationEngine(manuscript, {
      ...DEFAULT_SETTINGS,
      wakeWord: book.settings.wake_word?.trim() || DEFAULT_SETTINGS.wakeWord,
      removeHesitations: book.settings.remove_hesitations ?? false,
      spellingRules: rules,
    }, cursor)
    const keywords = await store.loadGlossary(book.id, manuscript.chapterOf(cursor.blockId)?.id ?? null)

    const sessionId = await store.startSession({ bookId: book.id, device: input.device, sttProvider: deps.stt.name })
    const pipeline = new SttPipeline(
      deps.stt.create,
      { bookId: book.id, sessionId, sampleRate: AUDIO_SAMPLE_RATE, language: 'pt-BR', keywords },
      deps.log,
    )
    try {
      await pipeline.start()
    } catch (err) {
      deps.log.error('provedor de transcrição indisponível', { err, sessionId, provider: deps.stt.name })
      await store.endSession(sessionId, 'interrupted', summarizeLatency([]), 0).catch(() => {})
      return 'stt_unavailable'
    }

    const session = new LiveSession(deps, user, book, sessionId, store, engine, pipeline)
    session.versionId = versionId
    pipeline.onTranscript((t) => session.onTranscript(t))
    pipeline.onFatal((err) => {
      deps.log.error('erro do provedor de transcrição', { err, sessionId, provider: deps.stt.name, bookId: book.id })
      session.fail('stt_unavailable')
    })
    deps.log.info('sessão iniciada', { sessionId, userId: user.userId, bookId: book.id, provider: deps.stt.name, keywords: keywords.length })
    return session
  }

  get isEnded() {
    return this.ended
  }

  whenEnded(l: () => void) {
    this.onEnd.push(l)
  }

  attach(channel: ClientChannel, resumed: boolean) {
    if (this.detachTimer) clearTimeout(this.detachTimer)
    this.detachTimer = null
    this.channel = channel
    channel.send(resumed ? { type: 'resumed', sessionId: this.id, ackSeq: this.lastSeq } : { type: 'ready', sessionId: this.id })
    channel.send({ type: 'cursor', cursor: this.engine.cursor, mode: this.engine.mode })
    for (const m of this.outbox.splice(0)) channel.send(m)
  }

  /** O navegador sumiu sem dizer "stop": espera a reconexão por um tempo. */
  detach(channel?: ClientChannel) {
    // o fechamento atrasado de uma conexão antiga não pode soltar a conexão nova
    if (this.ended || (channel && this.channel !== channel)) return
    this.channel = null
    this.deps.log.info('conexão caiu; aguardando retomada', { sessionId: this.id })
    this.detachTimer = setTimeout(() => void this.end('interrupted'), RESUME_GRACE_MS)
    this.detachTimer.unref?.()
  }

  onAudio(frame: Uint8Array) {
    const decoded = decodeAudioFrame(frame)
    if (!decoded || this.ended) return
    if (decoded.seq <= this.lastSeq) return // reenvio de algo que já chegou
    if (decoded.seq !== this.lastSeq + 1) return // fora de ordem: o navegador reenvia a partir do último ack
    this.lastSeq = decoded.seq
    const pcm = Buffer.from(decoded.pcm)
    this.pipeline.send(pcm)
    this.audio.append(pcm)
    if (this.audio.durationMs > MAX_UNCUT_MS) this.cutSegment(this.audio.fromMs + this.audio.durationMs, null)
    if (this.lastSeq % ACK_EVERY === 0) this.send({ type: 'ack', seq: this.lastSeq })
    const audioMs = this.pipeline.audioMs
    this.enqueue(async () => this.handleTransactions(this.engine.tick(audioMs)))
  }

  onCommandKey(down: boolean, audioMs: number) {
    if (down) {
      this.keyWindows.push({ downMs: audioMs, upMs: null })
      if (this.keyWindows.length > 200) this.keyWindows.shift()
    } else {
      const open = this.keyWindows.at(-1)
      if (open && open.upMs === null) open.upMs = audioMs
      // soltou a tecla: o provedor fecha o trecho agora, sem esperar a pausa
      this.pipeline.flush()
    }
  }

  onCursor(cursor: Cursor) {
    this.enqueue(async () => {
      await this.refresh()
      this.engine.setCursor(validCursor(this.engine.manuscript, cursor))
      this.send({ type: 'cursor', cursor: this.engine.cursor, mode: this.engine.mode })
    })
  }

  onMetric(value: number) {
    if (this.latencies.length < MAX_LATENCY_SAMPLES) this.latencies.push(value)
    this.deps.log.info('métrica', { sessionId: this.id, metric: 'speech_to_text_ms', value })
  }

  async stop() {
    await this.pipeline.finish()
    await this.end('ended')
    this.send({ type: 'ended' })
  }

  // ------------------------------------------------------------------ transcrição

  private onTranscript(t: SttTranscript) {
    this.send({ type: 'transcript', kind: t.kind, text: t.text, startMs: t.startMs, endMs: t.endMs })
    if (t.kind !== 'final') return
    const viaKey = this.isInKeyWindow(t.startMs, t.endMs)
    this.enqueue(async () => {
      await this.store
        .saveTranscript({ sessionId: this.id, bookId: this.book.id, ...t })
        .catch((err) => this.deps.log.error('falha ao gravar transcrição final', { err, sessionId: this.id }))
      await this.refresh()
      const txs = this.engine.handleFinal({ text: t.text, startMs: t.startMs, endMs: t.endMs, viaKey })
      await this.handleTransactions(txs)
      const inserted = txs.find((tx) => tx.insertion)?.insertion
      this.cutSegment(t.endMs, inserted ? { blockId: inserted.blockId, start: inserted.start, end: inserted.end } : 'command')
    })
  }

  private isInKeyWindow(startMs: number, endMs: number): boolean {
    const mid = (startMs + endMs) / 2
    return this.keyWindows.some((w) => mid >= w.downMs - 150 && mid <= (w.upMs ?? Number.POSITIVE_INFINITY) + 150)
  }

  private async handleTransactions(txs: Transaction[]) {
    for (const tx of txs) {
      if (tx.ops.length) {
        try {
          await this.store.applyOps(this.book.id, tx.ops)
        } catch (err) {
          this.deps.log.error('falha ao gravar no manuscrito', { err, sessionId: this.id, bookId: this.book.id })
          // o manuscrito em memória pode ter divergido do banco: recarrega
          await this.reload()
          this.send({ type: 'command', status: 'ignored', label: 'Não consegui gravar o último trecho; tente de novo' })
          continue
        }
        this.send({ type: 'ops', ops: tx.ops })
      }
      if (tx.feedback) this.send({ type: 'command', status: tx.feedback.status, label: tx.feedback.label })
      if (tx.command) {
        await this.store
          .saveCommand({ sessionId: this.id, bookId: this.book.id, ...tx.command })
          .catch((err) => this.deps.log.error('falha ao registrar comando', { err, sessionId: this.id }))
      }
      if (tx.insertion?.changes.length) {
        await this.store
          .saveTextChanges({ sessionId: this.id, bookId: this.book.id, blockId: tx.insertion.blockId, changes: tx.insertion.changes })
          .catch((err) => this.deps.log.error('falha ao registrar trocas de texto', { err, sessionId: this.id }))
      }
      if (tx.ops.length || tx.command) this.send({ type: 'cursor', cursor: this.engine.cursor, mode: this.engine.mode })
    }
  }

  /** Corta o áudio até `endMs` e manda para o Storage, ligado ao texto que ele gerou (F1.05). */
  private cutSegment(endMs: number, link: { blockId: string; start: number; end: number } | 'command' | null) {
    if (endMs <= this.audio.fromMs) return
    const { startMs, pcm } = this.audio.cut(endMs)
    if (!pcm.length) return
    const seq = this.segmentSeq++
    const durationMs = Math.round(pcm.length / 32)
    const row = {
      sessionId: this.id,
      bookId: this.book.id,
      seq,
      wav: wav(pcm),
      startMs: Math.round(startMs),
      durationMs,
      blockId: link && link !== 'command' ? link.blockId : null,
      charStart: link && link !== 'command' ? link.start : null,
      charEnd: link && link !== 'command' ? link.end : null,
      isCommand: link === 'command',
    }
    // depois das escritas do manuscrito (o bloco precisa existir), sem segurar a fila do ditado
    const after = this.writes
    this.segments = this.segments.then(async () => {
      await after
      await this.store
        .saveAudioSegment(row)
        .catch((err) => this.deps.log.error('falha ao guardar áudio do trecho', { err, sessionId: this.id, seq }))
    })
  }

  // ------------------------------------------------------------------ manuscrito

  /** Traz para a memória o que mudou por fora (editor, outra aba) desde a última vez. */
  private async refresh() {
    try {
      const { upserts, deletes, lastId } = await this.store.changesSince(this.book.id, this.versionId)
      for (const b of upserts) this.engine.manuscript.upsert(b)
      for (const id of deletes) this.engine.manuscript.remove(id)
      this.versionId = lastId
    } catch (err) {
      this.deps.log.warn('falha ao buscar mudanças do manuscrito', { err, sessionId: this.id })
    }
  }

  private async reload() {
    const blocks = await this.store.loadBlocks(this.book.id)
    const m = this.engine.manuscript
    for (const b of m.all()) if (!blocks.some((x) => x.id === b.id)) m.remove(b.id)
    for (const b of blocks) m.upsert(b)
    this.versionId = await this.store.latestVersionId(this.book.id)
  }

  // ------------------------------------------------------------------ ciclo de vida

  private enqueue(task: () => Promise<void>) {
    this.writes = this.writes.then(task).catch((err) => {
      this.deps.log.error('falha ao processar o ditado', { err, sessionId: this.id })
    })
  }

  private send(msg: ServerMessage) {
    if (this.channel) this.channel.send(msg)
    else if (msg.type !== 'ack' && msg.type !== 'transcript') {
      this.outbox.push(msg)
      if (this.outbox.length > MAX_OUTBOX) this.outbox.shift()
    }
  }

  fail(code: ErrorCode) {
    if (this.ended) return
    this.channel?.send({ type: 'error', code, message: friendlyError[code] })
    this.channel?.close(code === 'stt_unavailable' ? 4503 : 1011, code)
    void this.end('interrupted')
  }

  private async end(status: 'ended' | 'interrupted') {
    if (this.ended) return
    this.ended = true
    clearInterval(this.usageTimer)
    if (this.detachTimer) clearTimeout(this.detachTimer)
    this.enqueue(async () => this.handleTransactions(this.engine.flush()))
    await this.writes
    // o resto do áudio, mesmo sem texto, também vai para o Storage
    this.cutSegment(this.audio.fromMs + this.audio.durationMs, null)
    await this.segments
    this.pipeline.close()
    const latency = summarizeLatency(this.latencies)
    const audioMs = Math.round(this.pipeline.audioMs)
    await this.store
      .endSession(this.id, status, latency, audioMs)
      .catch((err) => this.deps.log.error('falha ao encerrar sessão', { err, sessionId: this.id }))
    this.deps.log.info('sessão encerrada', { sessionId: this.id, status, latency, audioMs })
    for (const l of this.onEnd) l()
    if (status === 'ended' && this.deps.exportBook && this.book.settings.auto_export !== false) {
      void this.deps.exportBook(this.book.id, this.user).catch((err) =>
        this.deps.log.error('falha na exportação automática', { err, sessionId: this.id, bookId: this.book.id }),
      )
    }
  }
}

/** Cursor vindo do navegador só vale se o bloco existe nesta obra. */
function validCursor(m: Manuscript, cursor: Cursor | undefined): Cursor {
  const block = m.get(cursor?.blockId ?? null)
  if (!block) return { blockId: null, offset: null }
  const offset = cursor?.offset ?? null
  return { blockId: block.id, offset: offset !== null && offset <= block.content.length ? offset : null }
}
