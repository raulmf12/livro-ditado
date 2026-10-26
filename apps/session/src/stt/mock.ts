import { WebSocket } from 'ws'
import type { SttFactory, SttStream, SttTranscript } from './types.ts'

const CONNECT_TIMEOUT_MS = 5_000
const FINISH_TIMEOUT_MS = 5_000

/**
 * Adaptador do simulador de transcrição (tests/kit/src/mock-stt.ts).
 * Fala um formato neutro: config JSON, áudio binário, "finish" e resultados JSON.
 */
export function mockSttFactory(url: string): SttFactory {
  return (opts) =>
    new Promise<SttStream>((resolve, reject) => {
      const ws = new WebSocket(url)
      const transcriptListeners: ((t: SttTranscript) => void)[] = []
      const errorListeners: ((err: Error) => void)[] = []
      let opened = false
      let closedByUs = false
      let onDone: (() => void) | null = null

      const timer = setTimeout(() => {
        ws.terminate()
        reject(new Error(`simulador de STT não respondeu em ${CONNECT_TIMEOUT_MS} ms`))
      }, CONNECT_TIMEOUT_MS)

      const emitError = (err: Error) => {
        for (const l of errorListeners) l(err)
      }

      ws.on('open', () => {
        opened = true
        clearTimeout(timer)
        ws.send(JSON.stringify({ type: 'config', ...opts }))
        resolve(stream)
      })

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as
          | ({ type: 'transcript' } & SttTranscript)
          | { type: 'error'; message: string }
          | { type: 'done' }
        if (msg.type === 'transcript') {
          const t: SttTranscript = {
            kind: msg.kind,
            text: msg.text,
            startMs: msg.startMs,
            endMs: msg.endMs,
            payload: msg,
          }
          for (const l of transcriptListeners) l(t)
        } else if (msg.type === 'error') {
          emitError(new Error(`simulador de STT: ${msg.message}`))
        } else if (msg.type === 'done') {
          onDone?.()
        }
      })

      ws.on('error', (err) => {
        if (!opened) {
          clearTimeout(timer)
          reject(err)
        } else {
          emitError(err)
        }
      })

      ws.on('close', () => {
        onDone?.()
        if (opened && !closedByUs) emitError(new Error('simulador de STT fechou a conexão'))
      })

      const stream: SttStream = {
        send(chunk) {
          if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
        },
        finish() {
          return new Promise<void>((done) => {
            if (ws.readyState !== WebSocket.OPEN) return done()
            const t = setTimeout(done, FINISH_TIMEOUT_MS)
            onDone = () => {
              clearTimeout(t)
              onDone = null
              done()
            }
            ws.send(JSON.stringify({ type: 'finish' }))
          })
        },
        close() {
          closedByUs = true
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
