'use client'

import { useEffect } from 'react'

export interface BandState {
  status: 'executed' | 'pending' | 'ignored'
  label: string
}

const SHOW_MS = 4_000

/**
 * Faixa de confirmação (F1.14): mostra o comando entendido, o que ainda está
 * esperando "fim" ou a pausa, e o texto provisório que está sendo ouvido.
 */
export function CommandBand({
  band,
  interim,
  commandHeld,
  commandKey,
  onExpire,
}: {
  band: BandState | null
  interim: string
  commandHeld: boolean
  commandKey: string
  onExpire: () => void
}) {
  useEffect(() => {
    if (!band || band.status === 'pending') return
    const t = setTimeout(onExpire, SHOW_MS)
    return () => clearTimeout(t)
  }, [band, onExpire])

  return (
    <div className="command-band" aria-live="polite">
      {commandHeld && (
        <span className="chip command" data-testid="modo-comando">
          Modo comando ({commandKey})
        </span>
      )}
      {band && (
        <span className={`chip ${band.status}`} data-testid="faixa-comando" data-status={band.status}>
          {band.status === 'executed' ? '✓ ' : band.status === 'pending' ? 'Comando: ' : '⚠ '}
          {band.label}
          {band.status === 'pending' ? '… (diga "fim" ou faça uma pausa)' : ''}
        </span>
      )}
      {interim && (
        <span className="interim" data-testid="provisorio">
          {interim}
        </span>
      )}
    </div>
  )
}
