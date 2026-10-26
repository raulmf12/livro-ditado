import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/supabase/server'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Entrar · Ditado do Livro' }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await currentUser()) redirect('/obra')
  const { next } = await searchParams

  return (
    <main className="login">
      <div className="card">
        <h1>Ditado do Livro</h1>
        <p className="muted">Entre com a conta criada para você.</p>
        <LoginForm next={next ?? '/obra'} />
      </div>
    </main>
  )
}
