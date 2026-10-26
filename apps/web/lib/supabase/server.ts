import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Cliente do Supabase para Server Components e Server Actions, com a sessão nos cookies. */
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options)
          } catch {
            // Server Component não pode gravar cookies; o proxy renova a sessão.
          }
        },
      },
    },
  )
}

/** Usuário logado (token validado), ou null. */
export async function currentUser() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data) return null
  return { id: data.claims.sub, email: data.claims.email as string | undefined }
}
