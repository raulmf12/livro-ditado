import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createBook } from './actions'

export const metadata: Metadata = { title: 'Obras · Ditado do Livro' }

export default async function ObrasPage() {
  const supabase = await createClient()
  const { data: books } = await supabase
    .from('books')
    .select('id, title, updated_at')
    .order('updated_at', { ascending: false })

  return (
    <main className="page">
      <h1>Suas obras</h1>

      {books && books.length > 0 ? (
        <ul className="book-list" data-testid="lista-obras">
          {books.map((b) => (
            <li key={b.id}>
              <Link href={`/obra/${b.id}`}>{b.title}</Link>
              <span className="muted">
                {new Date(b.updated_at).toLocaleDateString('pt-BR', { dateStyle: 'medium' })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhuma obra ainda.</p>
      )}

      <form action={createBook} className="inline-form">
        <label className="field grow">
          <span>Nova obra</span>
          <input name="title" placeholder="Título da obra" required maxLength={300} />
        </label>
        <button type="submit" className="button primary">
          Criar obra
        </button>
      </form>
    </main>
  )
}
