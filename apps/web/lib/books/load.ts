import type { MBlock } from '@livro/dictation'
import type { SupabaseClient } from '@supabase/supabase-js'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Preferências da obra (books.settings). */
export interface BookSettings {
  wake_word?: string
  remove_hesitations?: boolean
  command_key?: string
  footnote_numbering?: 'chapter' | 'book'
  auto_export?: boolean
}

export async function loadBook(supabase: SupabaseClient, id: string) {
  if (!UUID.test(id)) return null
  // RLS: a obra de outro autor simplesmente não volta
  const { data } = await supabase.from('books').select('id, title, settings').eq('id', id).maybeSingle()
  return data ? { id: data.id as string, title: data.title as string, settings: (data.settings ?? {}) as BookSettings } : null
}

export async function loadBlocks(supabase: SupabaseClient, bookId: string): Promise<MBlock[]> {
  const out: MBlock[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('blocks')
      .select('id, parent_id, type, position, content, attrs, origin, status')
      .eq('book_id', bookId)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as MBlock[]))
    if (!data || data.length < 1000) return out
  }
}
