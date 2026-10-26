'use client'

import { useMemo, useState } from 'react'
import type { Manuscript } from '@livro/dictation'

/**
 * Sumário lateral (F1.19): navega pelos títulos e reordena capítulos
 * arrastando (ou com os botões de subir e descer, pelo teclado).
 */
export function Toc({ manuscript, version, onMove }: { manuscript: Manuscript; version: number; onMove: (chapterId: string, beforeId: string | null) => void }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const items = useMemo(
    () => manuscript.ordered().filter((b) => b.type === 'chapter' || b.type === 'section' || b.type === 'subsection'),
    [manuscript, version], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const chapters = items.filter((b) => b.type === 'chapter')

  const go = (id: string) => {
    const el = document.querySelector(`[data-block-id="${id}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (!items.length) return <p className="muted toc-empty">Os capítulos aparecem aqui.</p>

  return (
    <nav aria-label="Sumário">
      <h2 className="toc-title">Sumário</h2>
      <ol className="toc" data-testid="sumario">
        {items.map((b) => {
          const label = [typeof b.attrs.number === 'number' ? b.attrs.number : null, b.content].filter((x) => x !== null && x !== '').join(' ') || 'Sem título'
          if (b.type !== 'chapter') {
            return (
              <li key={b.id} className={`toc-${b.type}`}>
                <button type="button" className="link" onClick={() => go(b.id)}>
                  {label}
                </button>
              </li>
            )
          }
          const i = chapters.findIndex((c) => c.id === b.id)
          return (
            <li
              key={b.id}
              className={`toc-chapter${dragging === b.id ? ' dragging' : ''}`}
              draggable
              data-chapter-id={b.id}
              onDragStart={(e) => {
                setDragging(b.id)
                e.dataTransfer.setData('text/plain', b.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const moved = e.dataTransfer.getData('text/plain')
                setDragging(null)
                if (moved && moved !== b.id) onMove(moved, b.id)
              }}
            >
              <button type="button" className="link" onClick={() => go(b.id)}>
                {label}
              </button>
              <span className="toc-actions">
                <button type="button" className="icon" aria-label={`Subir ${label}`} disabled={i === 0} onClick={() => onMove(b.id, chapters[i - 1]!.id)}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`Descer ${label}`}
                  disabled={i === chapters.length - 1}
                  onClick={() => onMove(b.id, chapters[i + 2]?.id ?? null)}
                >
                  ↓
                </button>
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
