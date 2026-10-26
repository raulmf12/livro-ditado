import { NextResponse } from 'next/server'
import { UUID, loadBlocks } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/server'

/** Manuscrito inteiro, para o editor se realinhar depois de um erro de gravação. */
export async function GET(_request: Request, ctx: RouteContext<'/api/books/[id]/blocks'>) {
  const { id } = await ctx.params
  if (!UUID.test(id)) return NextResponse.json({ error: 'obra inválida' }, { status: 400 })
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims) return NextResponse.json({ error: 'sem sessão' }, { status: 401 })
  return NextResponse.json({ blocks: await loadBlocks(supabase, id) })
}
