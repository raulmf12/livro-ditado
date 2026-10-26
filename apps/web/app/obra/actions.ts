'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function createBook(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return

  const supabase = await createClient()
  const { data, error } = await supabase.from('books').insert({ title }).select('id').single()
  if (error) throw new Error('Não foi possível criar a obra.')
  redirect(`/obra/${data.id}`)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
