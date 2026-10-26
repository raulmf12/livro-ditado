import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { loadBook } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from '../book-nav'

/** Glossário (F1.07): termos da obra e de cada capítulo, enviados ao provedor ao abrir a sessão. */
export default async function GlossarioPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const [{ data: terms }, { data: chapters }] = await Promise.all([
    supabase.from('glossary_terms').select('id, term, chapter_id').eq('book_id', book.id).order('term'),
    supabase.from('blocks').select('id, content, attrs').eq('book_id', book.id).eq('type', 'chapter').order('position'),
  ])
  const chapterName = (id: string | null) => {
    const c = chapters?.find((x) => x.id === id)
    return c ? c.content || `Capítulo ${(c.attrs as { number?: number }).number ?? ''}` : 'Obra inteira'
  }

  async function add(formData: FormData) {
    'use server'
    const term = String(formData.get('term') ?? '').trim()
    const chapterId = String(formData.get('chapter') ?? '') || null
    if (!term) return
    const supabase = await createClient()
    await supabase.from('glossary_terms').upsert({ book_id: book!.id, chapter_id: chapterId, term }, { onConflict: 'book_id,chapter_id,term', ignoreDuplicates: true })
    revalidatePath(`/obra/${book!.id}/glossario`)
  }

  async function remove(formData: FormData) {
    'use server'
    const supabase = await createClient()
    await supabase.from('glossary_terms').delete().eq('id', String(formData.get('id'))).eq('book_id', book!.id)
    revalidatePath(`/obra/${book!.id}/glossario`)
  }

  return (
    <main className="page wide">
      <BookNav bookId={book.id} title={book.title} active="glossario" />
      <p className="muted">
        Palavras que o reconhecimento de voz deve priorizar (nomes, institutos, latim). Os termos da obra e os do capítulo onde está o cursor de ditado vão para o
        provedor quando a gravação começa.
      </p>
      <form action={add} className="inline-form">
        <label className="field grow">
          <span>Termo</span>
          <input name="term" required maxLength={50} placeholder="usucapião" />
        </label>
        <label className="field">
          <span>Vale para</span>
          <select name="chapter" defaultValue="">
            <option value="">Obra inteira</option>
            {chapters?.map((c) => (
              <option key={c.id} value={c.id}>
                {chapterName(c.id)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button primary">
          Adicionar
        </button>
      </form>
      <table className="table" data-testid="glossario">
        <thead>
          <tr>
            <th>Termo</th>
            <th>Vale para</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {terms?.map((t) => (
            <tr key={t.id}>
              <td>{t.term}</td>
              <td>{chapterName(t.chapter_id)}</td>
              <td>
                <form action={remove}>
                  <input type="hidden" name="id" value={t.id} />
                  <button type="submit" className="button ghost small" aria-label={`Remover ${t.term}`}>
                    Remover
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!terms?.length && <p className="muted">Nenhum termo ainda.</p>}
    </main>
  )
}
