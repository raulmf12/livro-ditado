import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { loadBlocks, loadBook } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from './book-nav'
import { Workspace } from './workspace'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const book = await loadBook(await createClient(), (await params).id)
  return { title: book ? `${book.title} · Ditado do Livro` : 'Obra não encontrada' }
}

export default async function ObraPage({ params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const blocks = await loadBlocks(supabase, book.id)

  return (
    <main className="workspace-page">
      <BookNav bookId={book.id} title={book.title} active="manuscrito" />
      <Workspace bookId={book.id} initialBlocks={blocks} settings={book.settings} />
    </main>
  )
}
