// Sentry no servidor do Next (F0.06). Sem SENTRY_DSN, nada é enviado.
import * as Sentry from '@sentry/nextjs'
import { sentryDataCollection } from '@livro/shared'

export async function register() {
  if (!process.env.SENTRY_DSN) return
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? 'development',
    dataCollection: sentryDataCollection(),
    tracesSampleRate: 0,
  })
}

export const onRequestError = Sentry.captureRequestError
