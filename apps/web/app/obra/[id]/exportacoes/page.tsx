import { notFound } from 'next/navigation'
import { loadBook } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from '../book-nav'
import { ExportForm } from './export-form'

/** Exportações (F1.25): gerar o Word do livro ou de um capítulo e baixar os gerados antes. */
export default async function ExportacoesPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const [{ data: exports }, { data: chapters }] = await Promise.all([
    supabase.from('exports').select('id, scope, trigger, status, storage_path, size_bytes, duration_ms, created_at, chapter_id').eq('book_id', book.id).order('created_at', { ascending: false }).limit(50),
    supabase.from('blocks').select('id, content, attrs').eq('book_id', book.id).eq('type', 'chapter').order('position'),
  ])
  const links = await Promise.all(
    (exports ?? []).map(async (e) => {
      if (!e.storage_path) return null
      const { data } = await supabase.storage.from('exports').createSignedUrl(e.storage_path, 600, { download: `${book.title}.docx` })
      return data?.signedUrl ?? null
    }),
  )

  return (
    <main className="page wide">
      <BookNav bookId={book.id} title={book.title} active="exportacoes" />
      <ExportForm bookId={book.id} chapters={(chapters ?? []).map((c) => ({ id: c.id, label: c.content || `Capítulo ${(c.attrs as { number?: number }).number ?? ''}` }))} />
      <h2>Arquivos gerados</h2>
      <table className="table" data-testid="exportacoes">
        <thead>
          <tr>
            <th>Quando</th>
            <th>O quê</th>
            <th>Origem</th>
            <th>Tamanho</th>
            <th aria-label="Baixar" />
          </tr>
        </thead>
        <tbody>
          {exports?.map((e, i) => (
            <tr key={e.id} data-trigger={e.trigger}>
              <td>{new Date(e.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td>{e.scope === 'book' ? 'Livro inteiro' : `Capítulo: ${chapters?.find((c) => c.id === e.chapter_id)?.content ?? '—'}`}</td>
              <td>{e.trigger === 'session_end' ? 'Fim da sessão' : 'Manual'}</td>
              <td>{e.size_bytes ? `${Math.round(e.size_bytes / 1024)} KB` : '—'}</td>
              <td>{links[i] ? <a href={links[i]!}>Baixar</a> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!exports?.length && <p className="muted">Nenhuma exportação ainda.</p>}
    </main>
  )
}
