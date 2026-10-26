import {
  AUDIO_CHUNK_MS,
  AudioClock,
  PROTOCOL_VERSION,
  RESUME_GRACE_MS,
  ServerMessage,
  authProtocol,
  encodeAudioFrame,
  type ClientMessage,
  type Cursor,
} from '@livro/shared'
import { startRecorder, type Recorder } from '@/lib/audio/recorder'

export type DictationStatus = 'parado' | 'conectando' | 'gravando' | 'reconectando' | 'encerrando'

export interface DictationClientOptions {
  url: string
  bookId: string
  getToken: () => Promise<string | null>
  getCursor: () => Cursor
  deviceId?: string
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: DictationStatus) => void
  onLevel: (level: number) => void
  /** Erro que encerra o ditado (mensagem já pronta para o autor). */
  onFatal: (message: string, code: string) => void
  /** Aviso que não encerra (ex.: excesso de pedidos). */
  onNotice: (message: string) => void
}

const RECONNECT_DELAYS = [300, 700, 1500, 3000, 5000]
const MIC_DENIED = 'Não consegui acessar o microfone. Verifique a permissão do navegador.'

/**
 * Ditado no navegador (F1.01, F1.02): grava o microfone, numera cada pedaço de
 * áudio e guarda tudo o que o servidor ainda não confirmou. Se a conexão cair,
 * continua gravando, reconecta sozinho e reenvia o que faltou.
 */
export class DictationClient {
  private ws: WebSocket | null = null
  private sessionId: string | null = null
  private recorder: Recorder | null = null
  private seq = 0
  private unacked: { seq: number; frame: ArrayBuffer }[] = []
  private control: ClientMessage[] = []
  private clock = new AudioClock()
  private status: DictationStatus = 'parado'
  private ready = false
  private stopping = false
  private disconnectedAt = 0
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: DictationClientOptions) {}

  get audioMs(): number {
    return this.seq * AUDIO_CHUNK_MS
  }

  async start() {
    if (this.status !== 'parado') return
    this.stopping = false
    this.seq = 0
    this.unacked = []
    this.sessionId = null
    this.setStatus('conectando')
    await this.connect()
  }

  /** Pausar: manda o que falta, pede o fim da sessão e espera o servidor confirmar. */
  stop() {
    if (this.status === 'parado' || this.stopping) return
    this.stopping = true
    this.stopRecorder()
    this.setStatus('encerrando')
    this.queue({ type: 'stop' })
  }

  commandKey(down: boolean) {
    this.queue({ type: 'command_key', down, audioMs: this.audioMs })
  }

  setCursor(cursor: Cursor) {
    if (this.sessionId) this.queue({ type: 'cursor', cursor })
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer)
    this.stopRecorder()
    this.ws?.close()
    this.ws = null
  }

  // ------------------------------------------------------------------ conexão

  private async connect() {
    const token = await this.opts.getToken()
    if (!token) return this.fatal('Sua sessão expirou. Entre de novo.', 'auth')
    const ws = new WebSocket(this.opts.url, [PROTOCOL_VERSION, authProtocol(token)])
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    this.ready = false

    ws.onopen = () => {
      if (this.sessionId) ws.send(JSON.stringify({ type: 'resume', sessionId: this.sessionId }))
      else ws.send(JSON.stringify({ type: 'start', bookId: this.opts.bookId, device: navigator.userAgent.slice(0, 200), cursor: this.opts.getCursor() }))
    }
    ws.onmessage = (event: MessageEvent<string>) => void this.onServerMessage(event.data)
    ws.onclose = (event) => {
      if (this.ws !== ws) return
      this.ws = null
      this.ready = false
      if (this.status === 'parado') return
      if (event.code === 1000 && this.stopping) return this.finished()
      if (event.code >= 4400 && event.code < 4600) return // erro já tratado pela mensagem "error"
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (!this.disconnectedAt) this.disconnectedAt = Date.now()
    if (Date.now() - this.disconnectedAt > RESUME_GRACE_MS) {
      return this.fatal('Não consegui reconectar ao servidor. O texto até a queda está salvo.', 'connection')
    }
    this.setStatus('reconectando')
    const delay = RECONNECT_DELAYS[Math.min(this.attempt++, RECONNECT_DELAYS.length - 1)]!
    this.timer = setTimeout(() => void this.connect().catch(() => this.scheduleReconnect()), delay)
  }

  private async onServerMessage(raw: string) {
    const parsed = ServerMessage.safeParse(JSON.parse(raw))
    if (!parsed.success) return
    const msg = parsed.data
    switch (msg.type) {
      case 'ready':
        this.sessionId = msg.sessionId
        this.connected()
        if (!this.recorder && !this.stopping) await this.startRecorder()
        break
      case 'resumed':
        this.ack(msg.ackSeq)
        this.connected()
        // reenvia em ordem tudo o que o servidor ainda não tinha
        for (const { frame } of this.unacked) this.ws?.send(frame)
        break
      case 'ack':
        this.ack(msg.seq)
        break
      case 'transcript':
        if (msg.kind === 'final') this.reportLatency(msg.endMs)
        break
      case 'ended':
        this.finished()
        return
      case 'error':
        if (msg.code === 'rate_limited') this.opts.onNotice(msg.message)
        else return this.fatal(msg.message, msg.code)
        break
    }
    this.opts.onMessage(msg)
  }

  private connected() {
    this.ready = true
    this.attempt = 0
    this.disconnectedAt = 0
    this.setStatus(this.stopping ? 'encerrando' : 'gravando')
    for (const m of this.control.splice(0)) this.ws?.send(JSON.stringify(m))
  }

  private ack(seq: number) {
    while (this.unacked.length && this.unacked[0]!.seq <= seq) this.unacked.shift()
  }

  private queue(msg: ClientMessage) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.control.push(msg)
    }
  }

  // ------------------------------------------------------------------ áudio

  private async startRecorder() {
    try {
      this.recorder = await startRecorder({
        deviceId: this.opts.deviceId,
        onLevel: this.opts.onLevel,
        onChunk: (pcm) => {
          const seq = ++this.seq
          const frame = encodeAudioFrame(seq, pcm)
          this.unacked.push({ seq, frame })
          this.clock.record(AUDIO_CHUNK_MS, performance.now())
          if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame)
        },
      })
    } catch {
      this.fatal(MIC_DENIED, 'mic')
    }
  }

  private stopRecorder() {
    this.recorder?.stop()
    this.recorder = null
    this.opts.onLevel(0)
  }

  /** Latência fala → tela: do fim do áudio do trecho até o final ser pintado. */
  private reportLatency(endMs: number) {
    requestAnimationFrame(() => {
      const sentAt = this.clock.sentAt(endMs)
      if (sentAt === null) return
      this.queue({ type: 'metric', name: 'speech_to_text_ms', value: Math.round(performance.now() - sentAt) })
    })
  }

  // ------------------------------------------------------------------ fim

  private finished() {
    this.stopRecorder()
    this.sessionId = null
    this.stopping = false
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('parado')
  }

  private fatal(message: string, code: string) {
    this.stopRecorder()
    if (this.timer) clearTimeout(this.timer)
    this.sessionId = null
    this.stopping = false
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('parado')
    this.opts.onFatal(message, code)
  }

  private setStatus(s: DictationStatus) {
    this.status = s
    this.opts.onStatus(s)
  }
}
