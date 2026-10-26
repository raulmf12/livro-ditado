'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function ExportForm({ bookId, chapters }: { bookId: string; chapters: { id: string; label: string }[] }) {
  const router = useRouter()
  const [scope, setScope] = useState('book')
  const [final, setFinal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(scope === 'book' ? { bookId, scope: 'book', omitAiMarks: final } : { bookId, scope: 'chapter', chapterId: scope, omitAiMarks: final }),
    })
    const body = (await res.json()) as { url?: string; error?: string }
    setBusy(false)
    if (!res.ok || !body.url) return setError(body.error ?? 'Falha ao exportar.')
    window.location.assign(body.url)
    router.refresh()
  }

  return (
    <div className="inline-form">
      <label className="field">
        <span>Exportar</span>
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="book">Livro inteiro</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              Capítulo: {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={final} onChange={(e) => setFinal(e.target.checked)} /> Versão final (sem realce do que veio da pesquisa)
      </label>
      <button type="button" className="button primary" onClick={() => void run()} disabled={busy} aria-keyshortcuts="Alt+E">
        {busy ? 'Gerando…' : 'Exportar Word'}
      </button>
      {error && (
        <p role="alert" className="alert" data-testid="aviso">
          {error}
        </p>
      )}
    </div>
  )
}
