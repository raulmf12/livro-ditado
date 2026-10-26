import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // no CI as variáveis vêm dos segredos
}

const CI = !!process.env.CI
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const sentryPort = process.env.MOCK_SENTRY_PORT ?? '4040'

/** Os servidores de teste mandam erros para o simulador do Sentry, nunca para o Sentry real. */
const serverEnv: Record<string, string> = {
  ...(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)) as Record<string, string>),
  SENTRY_DSN: `http://public@localhost:${sentryPort}/1`,
  NEXT_PUBLIC_SENTRY_DSN: `http://public@localhost:${sentryPort}/1`,
  SENTRY_ENVIRONMENT: 'e2e',
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: 'e2e',
  // o navegador fala com o servidor de sessão pelo cortador de rede (F1.02, E2E-09)
  NEXT_PUBLIC_SESSION_WS_URL: 'ws://localhost:4002/ws',
  EXPORT_URL: 'http://localhost:4030',
}

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    // staging de teste no CI usa a CA local do Caddy (*.localhost)
    ignoreHTTPSErrors: !!process.env.E2E_IGNORE_HTTPS_ERRORS,
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Contra staging (E2E_BASE_URL definido) nada sobe localmente e os testes
  // marcados @local (que controlam os simuladores pela porta local) ficam de fora.
  grepInvert: process.env.E2E_BASE_URL ? /@local/ : undefined,
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          name: 'simuladores',
          command: 'pnpm --filter @livro/test-kit dev',
          url: `http://localhost:${sentryPort}/health`,
          reuseExistingServer: !CI,
        },
        {
          name: 'sessão',
          command: 'pnpm --filter @livro/session start',
          url: 'http://localhost:4001/health',
          env: serverEnv,
          reuseExistingServer: !CI,
        },
        {
          name: 'exportação',
          command: 'pnpm --filter @livro/export start',
          url: 'http://localhost:4030/health',
          env: serverEnv,
          reuseExistingServer: !CI,
        },
        {
          name: 'web',
          command: 'pnpm --filter @livro/web build && pnpm --filter @livro/web start',
          url: `${BASE_URL}/login`,
          env: serverEnv,
          timeout: 240_000,
          reuseExistingServer: !CI,
        },
      ],
})
