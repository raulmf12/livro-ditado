import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

const Body = z.object({
  bookId: z.uuid(),
  scope: z.enum(['book', 'chapter']),
  chapterId: z.uuid().optional(),
  omitAiMarks: z.boolean().optional(),
})

/**
 * Pede o Word ao serviço de exportação em nome do autor (o token dele vale
 * para RLS lá dentro) e devolve um link de download de 2 minutos.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'pedido inválido' }, { status: 400 })
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims) return NextResponse.json({ error: 'sem sessão' }, { status: 401 })
  const { data: session } = await supabase.auth.getSession()
  const token = session.session?.access_token
  if (!token) return NextResponse.json({ error: 'sem sessão' }, { status: 401 })

  const exportUrl = process.env.EXPORT_URL ?? 'http://localhost:4030'
  const res = await fetch(new URL('/exports', exportUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...parsed.data, trigger: 'manual' }),
  }).catch(() => null)
  if (!res) return NextResponse.json({ error: 'O serviço de exportação está fora do ar.' }, { status: 503 })
  const body = (await res.json()) as { storagePath?: string; fileName?: string; error?: string; durationMs?: number }
  if (!res.ok || !body.storagePath) return NextResponse.json({ error: body.error ?? 'Falha ao exportar.' }, { status: res.status })

  const { data: signed, error } = await supabase.storage.from('exports').createSignedUrl(body.storagePath, 120, { download: body.fileName })
  if (error || !signed) return NextResponse.json({ error: 'Arquivo gerado, mas não consegui o link.' }, { status: 500 })
  return NextResponse.json({ url: signed.signedUrl, fileName: body.fileName, durationMs: body.durationMs })
}
