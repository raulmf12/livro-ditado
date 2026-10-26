'use client'

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'livro:microfone'

/** Escolha do microfone (F1.01). A escolha fica guardada neste navegador. */
export function MicSelect({ value, onChange, disabled }: { value?: string; onChange: (id: string | undefined) => void; disabled: boolean }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    let saved: string | null = null
    try {
      saved = localStorage.getItem(STORAGE_KEY)
    } catch {
      // armazenamento bloqueado: segue com o padrão
    }
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((all) => {
          const mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId)
          setDevices(mics)
          if (saved && mics.some((d) => d.deviceId === saved)) onChange(saved)
        })
        .catch(() => {})
    void load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', load)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (devices.length < 2) return null
  return (
    <label className="mic-select">
      <span className="sr-only">Microfone</span>
      <select
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const id = e.target.value || undefined
          onChange(id)
          try {
            if (id) localStorage.setItem(STORAGE_KEY, id)
            else localStorage.removeItem(STORAGE_KEY)
          } catch {
            // ignora
          }
        }}
      >
        <option value="">Microfone padrão</option>
        {devices.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Microfone ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  )
}
