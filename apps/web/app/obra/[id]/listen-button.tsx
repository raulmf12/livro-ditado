'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * "Ouvir trecho" (F1.05): toca, em ordem, o áudio que gerou o parágrafo onde
 * está o cursor de digitação.
 */
export function ListenButton({ blockId }: { blockId: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [paths, setPaths] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)

  async function play() {
    setMessage(null)
    if (!blockId) return setMessage('Clique num parágrafo primeiro.')
    const supabase = createClient()
    const { data } = await supabase
      .from('audio_segments')
      .select('storage_path, created_at, seq')
      .eq('block_id', blockId)
      .order('created_at')
      .order('seq')
    if (!data?.length) return setMessage('Este trecho não tem áudio gravado.')
    const urls: string[] = []
    for (const s of data) {
      const { data: blob } = await supabase.storage.from('audio').download(s.storage_path as string)
      if (blob) urls.push(URL.createObjectURL(blob))
    }
    setPaths(data.map((s) => s.storage_path as string))
    const audio = audioRef.current!
    let i = 0
    audio.onended = () => {
      i++
      if (i < urls.length) {
        audio.src = urls[i]!
        void audio.play()
      }
    }
    audio.src = urls[0]!
    void audio.play().catch(() => {})
  }

  return (
    <>
      <button type="button" className="button ghost" onClick={() => void play()} disabled={!blockId}>
        Ouvir trecho
      </button>
      <audio ref={audioRef} data-testid="audio-trecho" data-paths={paths.join(',')} hidden />
      {message && <span className="muted">{message}</span>}
    </>
  )
}
