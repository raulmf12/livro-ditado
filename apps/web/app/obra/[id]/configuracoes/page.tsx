import { notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { loadBook, type BookSettings } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'
import { BookNav } from '../book-nav'

const KEYS = ['F9', 'F8', 'F10', 'F12', 'Pause', 'ScrollLock', 'Insert']

/** Preferências da obra: ativação dos comandos (F1.11), hesitações (F1.09), notas (F1.24) e exportação (F1.25). */
export default async function ConfiguracoesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ salvo?: string }> }) {
  const supabase = await createClient()
  const book = await loadBook(supabase, (await params).id)
  if (!book) notFound()
  const { salvo } = await searchParams
  const s = book.settings

  async function save(formData: FormData) {
    'use server'
    const wake = String(formData.get('wake_word') ?? '').trim()
    const settings: BookSettings = {
      ...book!.settings,
      wake_word: wake && /^[\p{L}]{3,20}$/u.test(wake) ? wake : 'Atena',
      command_key: KEYS.includes(String(formData.get('command_key'))) ? String(formData.get('command_key')) : 'F9',
      remove_hesitations: formData.get('remove_hesitations') === 'on',
      footnote_numbering: formData.get('footnote_numbering') === 'book' ? 'book' : 'chapter',
      auto_export: formData.get('auto_export') === 'on',
    }
    const supabase = await createClient()
    await supabase.from('books').update({ settings }).eq('id', book!.id)
    revalidatePath(`/obra/${book!.id}`, 'layout')
    const { redirect } = await import('next/navigation')
    redirect(`/obra/${book!.id}/configuracoes?salvo=1`)
  }

  return (
    <main className="page wide">
      <BookNav bookId={book.id} title={book.title} active="configuracoes" />
      {salvo && (
        <p role="status" className="alert success">
          Configurações salvas.
        </p>
      )}
      <form action={save} className="stack settings">
        <fieldset>
          <legend>Comandos de voz</legend>
          <label className="field">
            <span>Palavra de ativação</span>
            <input name="wake_word" defaultValue={s.wake_word ?? 'Atena'} pattern="[A-Za-zÀ-ÿ]{3,20}" required />
            <small className="muted">Diga no começo da frase: “Atena, capítulo três, Da posse agrária. Fim.”</small>
          </label>
          <label className="field">
            <span>Tecla de comando (segure enquanto fala; o pedal USB pode enviar esta tecla)</span>
            <select name="command_key" defaultValue={s.command_key ?? 'F9'}>
              {KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <fieldset>
          <legend>Texto ditado</legend>
          <label className="checkbox">
            <input type="checkbox" name="remove_hesitations" defaultChecked={s.remove_hesitations ?? false} /> Remover hesitações isoladas (“hã”, “hum”, “é…”)
          </label>
        </fieldset>
        <fieldset>
          <legend>Word</legend>
          <label className="field">
            <span>Numeração das notas de rodapé</span>
            <select name="footnote_numbering" defaultValue={s.footnote_numbering ?? 'chapter'}>
              <option value="chapter">Recomeça em cada capítulo</option>
              <option value="book">Contínua no livro</option>
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" name="auto_export" defaultChecked={s.auto_export ?? true} /> Gerar o Word automaticamente ao fim de cada sessão de ditado
          </label>
        </fieldset>
        <button type="submit" className="button primary">
          Salvar
        </button>
      </form>
    </main>
  )
}
