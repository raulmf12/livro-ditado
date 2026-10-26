import { createClient } from '@supabase/supabase-js'
import { Manuscript, type MBlock } from '@livro/dictation'
import { buildDocument, type ExportOptions } from './ast.ts'
import { findPandoc, pandocApiVersion, postProcess, toDocx } from './pandoc.ts'

export interface ExportRequest {
  bookId: string
  scope: 'book' | 'chapter'
  chapterId?: string
  trigger: 'manual' | 'session_end'
  omitAiMarks?: boolean
}

export interface ExportResult {
  id: string
  storagePath: string
  fileName: string
  sizeBytes: number
  durationMs: number
}

let pandoc: { path: string; api: number[] } | null = null
async function pandocInfo() {
  if (!pandoc) {
    const path = await findPandoc()
    pandoc = { path, api: await pandocApiVersion(path) }
  }
  return pandoc
}

/** Só a montagem do Word, sem banco (usada pelos testes e pela medida de desempenho). */
export async function renderDocx(blocks: MBlock[], opts: ExportOptions, chapterId?: string): Promise<Buffer> {
  const { path, api } = await pandocInfo()
  const doc = buildDocument(new Manuscript(blocks), opts, api, chapterId)
  return postProcess(await toDocx(path, doc), opts)
}

/**
 * Exporta em nome do usuário (o token dele vale para RLS): lê a obra, gera o
 * .docx, guarda no Storage e registra em public.exports.
 */
export async function exportBook(env: { url: string; publishableKey: string }, token: string, req: ExportRequest): Promise<ExportResult> {
  const started = Date.now()
  const db = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })

  const { data: book, error: bookError } = await db.from('books').select('id, title, settings').eq('id', req.bookId).maybeSingle()
  if (bookError) throw bookError
  if (!book) throw Object.assign(new Error('obra não encontrada'), { status: 404 })

  const blocks: MBlock[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('blocks')
      .select('id, parent_id, type, position, content, attrs, origin, status')
      .eq('book_id', req.bookId)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    blocks.push(...((data ?? []) as MBlock[]))
    if (!data || data.length < 1000) break
  }

  const settings = (book.settings ?? {}) as { footnote_numbering?: 'chapter' | 'book' }
  const opts: ExportOptions = {
    footnoteNumbering: settings.footnote_numbering === 'book' ? 'book' : 'chapter',
    omitAiMarks: req.omitAiMarks ?? false,
  }
  if (req.scope === 'chapter' && !blocks.some((b) => b.id === req.chapterId && b.type === 'chapter')) {
    throw Object.assign(new Error('capítulo não encontrado'), { status: 404 })
  }
  const docx = await renderDocx(blocks, opts, req.scope === 'chapter' ? req.chapterId : undefined)

  const id = crypto.randomUUID()
  const storagePath = `${req.bookId}/${id}.docx`
  const { error: uploadError } = await db.storage.from('exports').upload(storagePath, docx, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: false,
  })
  if (uploadError) throw uploadError

  const durationMs = Date.now() - started
  const { error } = await db.from('exports').insert({
    id,
    book_id: req.bookId,
    chapter_id: req.scope === 'chapter' ? req.chapterId : null,
    scope: req.scope,
    trigger: req.trigger,
    status: 'done',
    storage_path: storagePath,
    size_bytes: docx.length,
    duration_ms: durationMs,
  })
  if (error) throw error

  const chapterTitle = req.scope === 'chapter' ? blocks.find((b) => b.id === req.chapterId)?.content : null
  const fileName = `${slug(book.title as string)}${chapterTitle ? ` - ${slug(chapterTitle)}` : ''}.docx`
  return { id, storagePath, fileName, sizeBytes: docx.length, durationMs }
}

function slug(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'livro'
}
