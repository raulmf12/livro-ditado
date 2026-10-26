import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/supabase/server'
import { signOut } from './actions'

export default async function ObraLayout({ children }: { children: React.ReactNode }) {
  // O proxy já redireciona; esta checagem garante o mesmo no servidor.
  const user = await currentUser()
  if (!user) redirect('/login')

  return (
    <>
      <header className="topbar">
        <Link href="/obra" className="brand">
          Ditado do Livro
        </Link>
        <div className="topbar-right">
          <span className="muted" data-testid="usuario">
            {user.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="button ghost">
              Sair
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  )
}
