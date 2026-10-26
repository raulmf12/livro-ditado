import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import type { MBlock } from '@livro/dictation'
import { loadBook } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from '../book-nav'

const LABEL: Record<string, string> = { insert: 'Criado', update: 'Alterado', delete: 'Apagado' }

/** Histórico de versões (F1.20): cada mudança de bloco, com volta para a versão anterior. */
export default async function HistoricoPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const { data: versions } = await supabase
    .from('block_versions')
    .select('id, block_id, action, old_row, new_row, changed_at')
    .eq('book_id', book.id)
    .order('id', { ascending: false })
    .limit(200)

  async function restore(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { data: v } = await supabase.from('block_versions').select('block_id, action, old_row').eq('id', Number(formData.get('id'))).eq('book_id', book!.id).maybeSingle()
    if (!v?.old_row) return
    const old = v.old_row as MBlock & { book_id: string }
    const { data: current } = await supabase.from('blocks').select('id, content, attrs').eq('id', v.block_id).maybeSingle()
    const block: MBlock = { id: old.id, parent_id: old.parent_id, type: old.type, position: old.position, content: old.content, attrs: old.attrs, origin: old.origin, status: old.status }
    const op = current
      ? { op: 'update', id: block.id, before: { content: current.content, attrs: current.attrs }, after: { content: block.content, attrs: block.attrs } }
      : { op: 'insert', block }
    await supabase.rpc('apply_ops', { p_book_id: book!.id, p_ops: [op] })
    revalidatePath(`/obra/${book!.id}/historico`)
  }

  const excerpt = (row: unknown) => {
    const text = (row as { content?: string } | null)?.content ?? ''
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  }

  return (
    <main className="page wide">
      <BookNav bookId={book.id} title={book.title} active="historico" />
      <p className="muted">As últimas 200 mudanças do manuscrito. Restaurar volta o bloco ao que era antes daquela mudança.</p>
      <table className="table" data-testid="historico">
        <thead>
          <tr>
            <th>Quando</th>
            <th>Mudança</th>
            <th>Antes</th>
            <th>Depois</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {versions?.map((v) => (
            <tr key={v.id}>
              <td>{new Date(v.changed_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })}</td>
              <td>{LABEL[v.action]}</td>
              <td>{excerpt(v.old_row)}</td>
              <td>{excerpt(v.new_row)}</td>
              <td>
                {v.old_row && (
                  <form action={restore}>
                    <input type="hidden" name="id" value={v.id} />
                    <button type="submit" className="button ghost small">
                      Restaurar
                    </button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!versions?.length && <p className="muted">Nenhuma mudança ainda.</p>}
    </main>
  )
}
