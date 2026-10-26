import { NextResponse } from 'next/server'
import { z } from 'zod'
import { OpJson } from '@livro/shared'
import { UUID } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'

const Body = z.object({ ops: z.array(OpJson).max(5_000) })

/** Grava o que o autor digitou no editor (também usada no fechamento da aba, com keepalive). */
export async function POST(request: Request, ctx: RouteContext<'/api/books/[id]/ops'>) {
  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'obra inválida' }, { status: 400 })
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'pedido inválido' }, { status: 400 })

  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims) return NextResponse.json({ error: 'sem sessão' }, { status: 401 })

  const { error } = await supabase.rpc('apply_ops', { p_book_id: id, p_ops: parsed.data.ops })
  if (error) return NextResponse.json({ error: 'não foi possível salvar', code: error.code }, { status: 409 })
  return NextResponse.json({ ok: true })
}
