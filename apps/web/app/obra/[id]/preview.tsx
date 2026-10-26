'use client'

import { useMemo } from 'react'
import type { MBlock, Manuscript } from '@livro/dictation'

/** Mesmo texto de título que a exportação usa ("Capítulo 3 — Da posse agrária", "3.1 Conceito"). */
function headingText(b: MBlock, chapter: number | null, section: number | null) {
  const n = typeof b.attrs.number === 'number' ? b.attrs.number : null
  if (b.type === 'chapter') return n === null ? b.content : b.content ? `Capítulo ${n} — ${b.content}` : `Capítulo ${n}`
  const prefix = n === null ? '' : b.type === 'section' ? (chapter !== null ? `${chapter}.${n}` : `${n}`) : chapter !== null && section !== null ? `${chapter}.${section}.${n}` : `${n}`
  return [prefix, b.content].filter(Boolean).join(' ')
}

/** Texto com as chamadas de nota no ponto onde foram ditadas, como no Word. */
function withNoteMarks(text: string, notes: { n: number; anchor: number }[]) {
  const out: React.ReactNode[] = []
  let at = 0
  for (const note of notes) {
    const anchor = Math.min(Math.max(at, note.anchor), text.length)
    out.push(text.slice(at, anchor), <sup key={note.n}>{note.n}</sup>)
    at = anchor
  }
  out.push(text.slice(at))
  return out
}

/**
 * Prévia diagramada (F1.18): o CSS espelha o modelo Word (A4, margens ABNT,
 * Times 12 com entrelinha 1,5, citação longa com recuo de 4 cm). Cada
 * capítulo começa numa folha; as notas ficam no pé da folha do capítulo.
 */
export function Preview({ manuscript, version }: { manuscript: Manuscript; version: number }) {
  const sheets = useMemo(() => {
    const out: { key: string; items: { b: MBlock; text: string; notes: { n: number; text: string; anchor: number }[] }[]; notes: { n: number; text: string }[] }[] = []
    let chapter: number | null = null
    let section: number | null = null
    let noteNumber = 0
    for (const b of manuscript.ordered()) {
      if (b.origin === 'ai' && b.status === 'rejected') continue
      if (b.type === 'chapter' || out.length === 0) {
        out.push({ key: b.id, items: [], notes: [] })
        noteNumber = 0
      }
      const sheet = out.at(-1)!
      if (b.type === 'chapter') {
        chapter = typeof b.attrs.number === 'number' ? b.attrs.number : null
        section = null
      }
      if (b.type === 'section') section = typeof b.attrs.number === 'number' ? b.attrs.number : null
      const notes = manuscript
        .notesOf(b.id)
        .map((n) => ({ n: ++noteNumber, text: n.content, anchor: typeof n.attrs.anchor === 'number' ? n.attrs.anchor : b.content.length }))
      sheet.notes.push(...notes)
      const text = b.type === 'paragraph' || b.type === 'quote' ? b.content : headingText(b, chapter, section)
      sheet.items.push({ b, text, notes })
    }
    return out
  }, [manuscript, version]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="preview" data-testid="previa">
      {sheets.map((sheet) => (
        <article className="sheet" key={sheet.key}>
          {sheet.items.map(({ b, text, notes }) => {
            const ai = b.origin === 'ai' ? ' ai' : ''
            if (b.type === 'chapter') return <h1 key={b.id}>{text}</h1>
            if (b.type === 'section') return <h2 key={b.id}>{text}</h2>
            if (b.type === 'subsection') return <h3 key={b.id}>{text}</h3>
            const body = withNoteMarks(text, notes)
            if (b.type === 'quote') return <p key={b.id} className={`quote${ai}`}>{body}</p>
            return <p key={b.id} className={ai.trim() || undefined}>{body}</p>
          })}
          {sheet.notes.length > 0 && (
            <footer className="sheet-notes">
              {sheet.notes.map((n) => (
                <p key={n.n}>
                  <sup>{n.n}</sup> {n.text}
                </p>
              ))}
            </footer>
          )}
        </article>
      ))}
    </div>
  )
}
