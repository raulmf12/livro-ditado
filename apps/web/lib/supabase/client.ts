import { createBrowserClient } from '@supabase/ssr'

/** Cliente do Supabase no navegador. Usa só a chave publicável; o resto vale pelas políticas RLS. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
