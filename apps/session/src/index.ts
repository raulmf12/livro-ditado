import { jsonLogger } from './log.ts'
import { flushSentry, sentryReporter } from './observability.ts'
import { createSessionServer } from './server.ts'
import { sttFromEnv } from './stt/index.ts'
import { exportClient, supabaseStoreFactory, supabaseVerifier } from './supabase.ts'

const env = process.env
const log = jsonLogger({ service: 'session' }, sentryReporter(env))

function required(name: string): string {
  const v = env[name]
  if (!v) throw new Error(`variável de ambiente ${name} não definida`)
  return v
}

const supabaseUrl = required('SUPABASE_URL')
const publishableKey = required('SUPABASE_PUBLISHABLE_KEY')

const app = createSessionServer({
  verifyToken: supabaseVerifier(supabaseUrl, publishableKey),
  storeFor: supabaseStoreFactory(supabaseUrl, publishableKey),
  stt: sttFromEnv(env),
  exportBook: env.EXPORT_URL ? exportClient(env.EXPORT_URL) : undefined,
  allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  log,
})

const port = await app.listen(Number(env.SESSION_PORT ?? 4001))
log.info('servidor de sessão no ar', { port, provider: env.STT_PROVIDER ?? 'mock' })

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(flushSentry)
      .then(() => process.exit(0))
  })
}
