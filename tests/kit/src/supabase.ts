import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const noSession = { auth: { persistSession: false, autoRefreshToken: false } } as const

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`variável de ambiente ${name} não definida (veja .env.example)`)
  return v
}

export const supabaseUrl = () => env('SUPABASE_URL')
export const publishableKey = () => env('SUPABASE_PUBLISHABLE_KEY')

/** Cliente com a chave secreta: ignora RLS. Só para preparar dados de teste. */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), env('SUPABASE_SECRET_KEY'), noSession)
}

/** Cliente anônimo (sem login), como um visitante qualquer. */
export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl(), publishableKey(), noSession)
}

/** Faz login com e-mail e senha e devolve o cliente já autenticado e o token. */
export async function signedInClient(email: string, password: string) {
  const client = anonClient()
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`login de ${email} falhou: ${error.message}`)
  return { client, token: data.session.access_token, userId: data.user.id }
}
