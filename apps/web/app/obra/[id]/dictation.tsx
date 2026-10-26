'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { PROTOCOL_VERSION, ServerMessage, authProtocol } from '@livro/shared'
import { startRecorder, type Recorder } from '@/lib/audio/recorder'
import { createClient } from '@/lib/supabase/client'

type Status = 'parado' | 'conectando' | 'gravando' | 'encerrando'

const LOST_CONNECTION = 'A conexão com o servidor caiu. Tente gravar de novo.'
const MIC_DENIED = 'Não consegui acessar o microfone. Verifique a permissão do navegador.'

/**
 * Esqueleto do ditado (fase 0): grava, envia o áudio ao servidor de sessão e
 * mostra o provisório em cinza e os finais no manuscrito. Pausar encerra a
 * sessão; reconexão com buffer de reenvio entra em F1.02.
 */
export function Dictation({ bookId }: { bookId: string }) {
  const [status, setStatus] = useState<Status>('parado')
  const [finals, setFinals] = useState<string[]>([])
  const [interim, setInterim] = useState('')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<Recorder | null>(null)
  const router = useRouter()

  const stopRecorder = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setLevel(0)
  }

  useEffect(
    () => () => {
      recorderRef.current?.stop()
      wsRef.current?.close()
    },
    [],
  )

  async function start() {
    setError(null)
    setStatus('conectando')
    const { data } = await createClient().auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      router.push(`/login?next=/obra/${bookId}`)
      return
    }

    const ws = new WebSocket(process.env.NEXT_PUBLIC_SESSION_WS_URL!, [PROTOCOL_VERSION, authProtocol(token)])
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws
    let serverError = false

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', bookId, device: navigator.userAgent.slice(0, 200) }))
    }

    ws.onmessage = async (event: MessageEvent<string>) => {
      const parsed = ServerMessage.safeParse(JSON.parse(event.data))
      if (!parsed.success) return
      const msg = parsed.data
      switch (msg.type) {
        case 'ready':
          try {
            recorderRef.current = await startRecorder({
              onChunk: (pcm) => {
                if (ws.readyState === WebSocket.OPEN) ws.send(pcm)
              },
              onLevel: (l) => setLevel(Math.min(1, l * 4)),
            })
            setStatus('gravando')
          } catch {
            setError(MIC_DENIED)
            ws.close()
          }
          break
        case 'transcript':
          if (msg.kind === 'final') {
            setFinals((f) => [...f, msg.text])
            setInterim('')
          } else {
            setInterim(msg.text)
          }
          break
        case 'error':
          serverError = true
          setError(msg.message)
          break
        case 'ended':
          break
      }
    }

    ws.onclose = (event) => {
      stopRecorder()
      setInterim('')
      setStatus('parado')
      if (wsRef.current === ws) wsRef.current = null
      if (event.code !== 1000 && !serverError) setError(LOST_CONNECTION)
    }
  }

  function pause() {
    stopRecorder()
    setStatus('encerrando')
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
    else setStatus('parado')
  }

  const recording = status === 'gravando'
  const busy = status === 'conectando' || status === 'encerrando'

  return (
    <section className="dictation">
      <div className="controls">
        <button
          type="button"
          className={`button ${recording ? 'danger' : 'primary'}`}
          onClick={recording ? pause : start}
          disabled={busy}
          aria-pressed={recording}
        >
          {recording ? 'Pausar' : status === 'conectando' ? 'Conectando…' : status === 'encerrando' ? 'Encerrando…' : 'Gravar'}
        </button>
        <div
          className="level"
          role="meter"
          aria-label="Nível do microfone"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          data-testid="medidor"
        >
          <div className="level-bar" style={{ transform: `scaleX(${level})` }} />
        </div>
        <span className="muted status" data-testid="status">
          {status}
        </span>
      </div>

      {error && (
        <p role="alert" className="alert" data-testid="aviso">
          {error}
        </p>
      )}

      <article className="manuscript" data-testid="manuscrito" aria-live="polite">
        {finals.map((text, i) => (
          <p key={i} data-kind="final">
            {text}
          </p>
        ))}
        {interim && (
          <p className="interim" data-kind="interim">
            {interim}
          </p>
        )}
        {finals.length === 0 && !interim && <p className="muted placeholder">Clique em Gravar e comece a falar.</p>}
      </article>
    </section>
  )
}
