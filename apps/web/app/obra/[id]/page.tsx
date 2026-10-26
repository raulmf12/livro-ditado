import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Dictation } from './dictation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadBook(id: string) {
  if (!UUID.test(id)) return null
  const supabase = await createClient()
  // RLS: a obra de outro autor simplesmente não volta.
  const { data } = await supabase.from('books').select('id, title').eq('id', id).maybeSingle()
  return data
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const book = await loadBook((await params).id)
  return { title: book ? `${book.title} · Ditado do Livro` : 'Obra não encontrada' }
}

export default async function ObraPage({ params }: { params: Promise<{ id: string }> }) {
  const book = await loadBook((await params).id)
  if (!book) notFound()

  return (
    <main className="page">
      <h1>{book.title}</h1>
      <Dictation bookId={book.id} />
    </main>
  )
}
