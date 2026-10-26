'use client'

import { useActionState } from 'react'
import { signIn, type LoginState } from './actions'

const initial: LoginState = { error: null }

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initial)

  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>E-mail</span>
        <input name="email" type="email" autoComplete="email" required autoFocus />
      </label>
      <label className="field">
        <span>Senha</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="alert" data-testid="aviso">
          {state.error}
        </p>
      )}
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
