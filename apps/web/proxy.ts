import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED = ['/obra']

/** Renova a sessão do Supabase a cada requisição e manda ao login quem não tem sessão. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value)
          response = NextResponse.next({ request })
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options)
        },
      },
    },
  )

  const { data } = await supabase.auth.getClaims()
  const path = request.nextUrl.pathname
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))

  if (!data && isProtected) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = `?next=${encodeURIComponent(path)}`
    return NextResponse.redirect(url)
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|worklets/).*)'],
}
