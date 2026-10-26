import * as Sentry from '@sentry/node'
import { sentryDataCollection } from '@livro/shared'
import type { ErrorReporter } from './log.ts'

/** Campos do log que viram tags pesquisáveis no Sentry. */
const TAG_FIELDS = ['sessionId', 'userId', 'bookId', 'provider'] as const

/**
 * Liga o Sentry quando SENTRY_DSN está definido e devolve o repasse de erros
 * para o logger. Sem DSN, nada é enviado.
 */
export function sentryReporter(env: NodeJS.ProcessEnv): ErrorReporter | undefined {
  if (!env.SENTRY_DSN) return undefined
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? 'development',
    release: env.SENTRY_RELEASE,
    // Só erros e avisos; o conteúdo do ditado nunca vai para o Sentry (sigilo do livro, T.03).
    dataCollection: sentryDataCollection(),
    tracesSampleRate: 0,
  })
  return (msg, fields) => {
    Sentry.withScope((scope) => {
      scope.setTag('service', 'session')
      for (const key of TAG_FIELDS) {
        const value = fields[key]
        if (typeof value === 'string') scope.setTag(key, value)
      }
      scope.setExtra('log_message', msg)
      const err = fields.err
      if (err instanceof Error) Sentry.captureException(err)
      else Sentry.captureMessage(msg, 'error')
    })
  }
}

export function flushSentry() {
  return Sentry.flush(2000)
}
