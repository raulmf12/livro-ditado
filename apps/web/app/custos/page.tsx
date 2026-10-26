import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DEFAULT_MONTHLY_CAP_USD, sttCostUsd } from '@livro/shared'
import { createClient, currentUser } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Custos · Ditado do Livro' }

const usd = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/** Custos do mês (T.04): minutos de transcrição e tokens do Claude, com alerta perto do teto. */
export default async function CustosPage() {
  if (!(await currentUser())) redirect('/login')
  const supabase = await createClient()
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const { data: sessions } = await supabase
    .from('dictation_sessions')
    .select('id, stt_provider, stt_audio_ms, claude_input_tokens, claude_output_tokens, started_at, books(title)')
    .gte('started_at', start.toISOString())
    .order('started_at', { ascending: false })

  const override = process.env.STT_USD_PER_MINUTE ? Number(process.env.STT_USD_PER_MINUTE) : undefined
  const cap = Number(process.env.COST_MONTHLY_CAP_USD ?? DEFAULT_MONTHLY_CAP_USD)
  const rows = (sessions ?? []).map((s) => ({
    ...s,
    minutes: s.stt_audio_ms / 60_000,
    cost: sttCostUsd(s.stt_provider, s.stt_audio_ms, override),
  }))
  const minutes = rows.reduce((a, r) => a + r.minutes, 0)
  const total = rows.reduce((a, r) => a + r.cost, 0)
  const tokens = rows.reduce((a, r) => a + r.claude_input_tokens + r.claude_output_tokens, 0)
  const ratio = cap > 0 ? total / cap : 0

  return (
    <main className="page">
      <p>
        <Link href="/obra">← Obras</Link>
      </p>
      <h1>Custos do mês</h1>
      {ratio >= 1 ? (
        <p role="alert" className="alert">
          O teto mensal de {usd(cap)} foi atingido.
        </p>
      ) : ratio >= 0.8 ? (
        <p role="status" className="alert warning">
          Já foram {Math.round(ratio * 100)}% do teto mensal de {usd(cap)}.
        </p>
      ) : null}
      <dl className="stats" data-testid="custos">
        <div>
          <dt>Transcrição</dt>
          <dd data-testid="minutos">{minutes.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} min</dd>
        </div>
        <div>
          <dt>Tokens do Claude</dt>
          <dd data-testid="tokens">{tokens.toLocaleString('pt-BR')}</dd>
        </div>
        <div>
          <dt>Estimativa do mês</dt>
          <dd data-testid="total">{usd(total)}</dd>
        </div>
        <div>
          <dt>Teto</dt>
          <dd>{usd(cap)}</dd>
        </div>
      </dl>
      <h2>Sessões</h2>
      <table className="table" data-testid="sessoes">
        <thead>
          <tr>
            <th>Início</th>
            <th>Obra</th>
            <th>Provedor</th>
            <th>Minutos</th>
            <th>Custo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.started_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{(r.books as unknown as { title?: string } | null)?.title ?? '—'}</td>
              <td>{r.stt_provider}</td>
              <td>{r.minutes.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</td>
              <td>{usd(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
