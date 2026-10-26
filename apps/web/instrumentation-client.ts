// Sentry no navegador (F0.06). Sem NEXT_PUBLIC_SENTRY_DSN, nada é enviado.
import * as Sentry from '@sentry/nextjs'
import { sentryDataCollection } from '@livro/shared'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
    // Só erros e avisos; o conteúdo do ditado nunca vai para o Sentry (sigilo do livro, T.03).
    dataCollection: sentryDataCollection(),
    tracesSampleRate: 0,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
