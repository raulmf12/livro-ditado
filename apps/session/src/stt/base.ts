import { WebSocket } from 'ws'
import type { SttStream, SttTranscript } from './types.ts'

const CONNECT_TIMEOUT_MS = 8_000
const FINISH_TIMEOUT_MS = 5_000

/** O que cada provedor precisa definir; o resto (conexão, erros, fim) é comum. */
export interface ProviderProtocol {
  /** Converte um pedaço de PCM no que o provedor espera receber. */
  audio(chunk: Buffer): Buffer | string
  /** Trata uma mensagem do provedor; chama emit para cada resultado. */
  message(data: string, emit: (t: SttTranscript) => void, fail: (err: Error) => void, done: () => void): void
  /** Mensagens para fechar o trecho atual (fim da tecla de comando). */
  flushMessages(): string[]
  /** Mensagens para encerrar o áudio; o provedor responde com os últimos finais e "done". */
  finishMessages(): string[]
  /** Chamado quando a conexão fecha (para soltar finais que estavam guardados). */
  closed?(emit: (t: SttTranscript) => void): void
  /** Mensagens enviadas logo depois de conectar, antes do áudio. */
  initialMessages?(): string[]
  /** Mensagem de manutenção enviada quando não há áudio por um tempo (ou null). */
  keepAlive?: { message: string; idleMs: number }
}

/**
 * Abre o WebSocket do provedor e devolve um SttStream. As credenciais vão em
 * cabeçalho, nunca na URL (para não aparecerem em logs de proxy).
 */
export function openProviderStream(url: string, headers: Record<string, string>, protocol: ProviderProtocol): Promise<SttStream> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers })
    const transcriptListeners: ((t: SttTranscript) => void)[] = []
    const errorListeners: ((err: Error) => void)[] = []
    let opened = false
    let closedByUs = false
    let failed = false
    let finishing = false
    let onDone: (() => void) | null = null
    let lastSend = Date.now()
    let keepAliveTimer: NodeJS.Timeout | null = null

    const emit = (t: SttTranscript) => {
      for (const l of transcriptListeners) l(t)
    }
    const fail = (err: Error) => {
      if (failed || closedByUs) return
      failed = true
      for (const l of errorListeners) l(err)
    }
    const done = () => onDone?.()

    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error(`provedor de transcrição não respondeu em ${CONNECT_TIMEOUT_MS} ms`))
    }, CONNECT_TIMEOUT_MS)

    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer)
      reject(new Error(`provedor de transcrição recusou a conexão (HTTP ${res.statusCode})`))
      ws.terminate()
    })

    ws.on('open', () => {
      opened = true
      clearTimeout(timer)
      for (const m of protocol.initialMessages?.() ?? []) ws.send(m)
      if (protocol.keepAlive) {
        const { message, idleMs } = protocol.keepAlive
        keepAliveTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN && Date.now() - lastSend >= idleMs) {
            ws.send(message)
            lastSend = Date.now()
          }
        }, Math.max(500, idleMs / 2))
      }
      resolve(stream)
    })

    ws.on('message', (data) => {
      try {
        protocol.message(data.toString(), emit, fail, done)
      } catch (err) {
        fail(err as Error)
      }
    })

    ws.on('error', (err) => {
      if (!opened) {
        clearTimeout(timer)
        reject(err)
      } else {
        fail(err)
      }
    })

    ws.on('close', (code, reason) => {
      if (keepAliveTimer) clearInterval(keepAliveTimer)
      protocol.closed?.(emit)
      onDone?.()
      if (opened && !closedByUs && !finishing) fail(new Error(`provedor fechou a conexão (${code} ${reason.toString()})`))
    })

    const sendRaw = (payload: Buffer | string) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(payload)
      lastSend = Date.now()
    }

    const stream: SttStream = {
      send(chunk) {
        sendRaw(protocol.audio(chunk))
      },
      flush() {
        for (const m of protocol.flushMessages()) sendRaw(m)
      },
      finish() {
        return new Promise<void>((resolveFinish) => {
          if (ws.readyState !== WebSocket.OPEN) return resolveFinish()
          finishing = true
          const t = setTimeout(finishNow, FINISH_TIMEOUT_MS)
          function finishNow() {
            clearTimeout(t)
            onDone = null
            resolveFinish()
          }
          onDone = finishNow
          for (const m of protocol.finishMessages()) sendRaw(m)
        })
      },
      close() {
        closedByUs = true
        if (keepAliveTimer) clearInterval(keepAliveTimer)
        ws.close()
      },
      onTranscript(l) {
        transcriptListeners.push(l)
      },
      onError(l) {
        errorListeners.push(l)
      },
    }
  })
}

export function query(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    if (Array.isArray(v)) for (const item of v) q.append(k, item)
    else q.append(k, String(v))
  }
  return q.toString()
}
