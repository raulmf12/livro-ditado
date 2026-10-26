import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { loadBook } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from '../book-nav'

/**
 * Dicionário de grafia (F1.08): regras "como o STT escreve → como fica no
 * livro". Só regras aprovadas são aplicadas; toda troca fica registrada com
 * antes e depois, e pode ser desfeita.
 */
export default async function GrafiaPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const [{ data: rules }, { data: changes }] = await Promise.all([
    supabase.from('spelling_rules').select('id, spoken, written, approved').eq('book_id', book.id).order('spoken'),
    supabase.from('text_changes').select('id, kind, before, after, created_at, undone_at, block_id').eq('book_id', book.id).order('created_at', { ascending: false }).limit(100),
  ])
  const path = `/obra/${book.id}/grafia`

  async function addRule(formData: FormData) {
    'use server'
    const spoken = String(formData.get('spoken') ?? '').trim()
    const written = String(formData.get('written') ?? '').trim()
    if (!spoken || !written) return
    const supabase = await createClient()
    await supabase.from('spelling_rules').upsert({ book_id: book!.id, spoken, written, approved: formData.get('approved') === 'on' }, { onConflict: 'book_id,spoken' })
    revalidatePath(path)
  }

  async function toggle(formData: FormData) {
    'use server'
    const supabase = await createClient()
    await supabase.from('spelling_rules').update({ approved: formData.get('approved') === 'true' }).eq('id', String(formData.get('id'))).eq('book_id', book!.id)
    revalidatePath(path)
  }

  async function removeRule(formData: FormData) {
    'use server'
    const supabase = await createClient()
    await supabase.from('spelling_rules').delete().eq('id', String(formData.get('id'))).eq('book_id', book!.id)
    revalidatePath(path)
  }

  /** Desfaz uma troca: volta o texto ditado no ponto da troca, se ainda estiver lá. */
  async function undo(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: change } = await supabase.from('text_changes').select('id, block_id, before, after, offset_at, undone_at').eq('id', String(formData.get('id'))).eq('book_id', book!.id).maybeSingle()
    if (!change || change.undone_at || !change.block_id) return
    const { data: block } = await supabase.from('blocks').select('id, content, attrs').eq('id', change.block_id).maybeSingle()
    if (!block) return
    const content = block.content as string
    const after = change.after as string
    const before = change.before as string
    let at = content.slice(change.offset_at, change.offset_at + after.length) === after ? change.offset_at : -1
    if (at === -1) {
      // o texto andou (edição depois da troca): procura a ocorrência mais próxima
      let best = -1
      for (let i = content.indexOf(after); i !== -1; i = content.indexOf(after, i + 1)) {
        if (best === -1 || Math.abs(i - change.offset_at) < Math.abs(best - change.offset_at)) best = i
      }
      at = best
    }
    if (at === -1 && after !== '') return
    const updated = after === '' ? content.slice(0, change.offset_at) + before + content.slice(change.offset_at) : content.slice(0, at) + before + content.slice(at + after.length)
    await supabase.rpc('apply_ops', {
      p_book_id: book!.id,
      p_ops: [{ op: 'update', id: block.id, before: { content, attrs: block.attrs }, after: { content: updated, attrs: block.attrs } }],
    })
    await supabase.from('text_changes').update({ undone_at: new Date().toISOString() }).eq('id', change.id)
    revalidatePath(path)
  }

  return (
    <main className="page wide">
      <BookNav bookId={book.id} title={book.title} active="grafia" />
      <h2>Regras de grafia</h2>
      <p className="muted">Só as regras aprovadas são aplicadas ao texto ditado. A troca vale para a palavra ou expressão inteira, sem diferenciar maiúsculas.</p>
      <form action={addRule} className="inline-form">
        <label className="field">
          <span>O reconhecimento escreve</span>
          <input name="spoken" required maxLength={100} placeholder="rex" />
        </label>
        <label className="field">
          <span>No livro fica</span>
          <input name="written" required maxLength={100} placeholder="REsp" />
        </label>
        <label className="checkbox">
          <input type="checkbox" name="approved" defaultChecked /> Aprovada
        </label>
        <button type="submit" className="button primary">
          Salvar regra
        </button>
      </form>
      <table className="table" data-testid="regras">
        <thead>
          <tr>
            <th>Escreve</th>
            <th>Fica</th>
            <th>Situação</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {rules?.map((r) => (
            <tr key={r.id}>
              <td>{r.spoken}</td>
              <td>{r.written}</td>
              <td>{r.approved ? 'Aprovada' : 'Sugerida'}</td>
              <td className="row-actions">
                <form action={toggle}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="approved" value={String(!r.approved)} />
                  <button type="submit" className="button ghost small">
                    {r.approved ? 'Suspender' : 'Aprovar'}
                  </button>
                </form>
                <form action={removeRule}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="button ghost small">
                    Remover
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Trocas feitas</h2>
      <table className="table" data-testid="trocas">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Tipo</th>
            <th>Antes</th>
            <th>Depois</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {changes?.map((c) => (
            <tr key={c.id}>
              <td>{new Date(c.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{c.kind === 'spelling' ? 'Grafia' : 'Hesitação'}</td>
              <td>{c.before.trim()}</td>
              <td>{c.after || '—'}</td>
              <td>
                {c.undone_at ? (
                  <span className="muted">Desfeita</span>
                ) : (
                  <form action={undo}>
                    <input type="hidden" name="id" value={c.id} />
                    <button type="submit" className="button ghost small">
                      Desfazer
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!changes?.length && <p className="muted">Nenhuma troca ainda.</p>}
    </main>
  )
}
