import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // no CI as variáveis vêm dos segredos
}

const CI = !!process.env.CI
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const sttControl = process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010'

export default defineConfig({
  testDir: './specs',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'pt-BR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Contra staging (E2E_BASE_URL definido) nada sobe localmente.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          name: 'simuladores',
          command: 'pnpm --filter @livro/test-kit dev',
          url: `${sttControl}/health`,
          reuseExistingServer: !CI,
        },
        {
          name: 'sessão',
          command: 'pnpm --filter @livro/session start',
          url: 'http://localhost:4001/health',
          reuseExistingServer: !CI,
        },
        {
          name: 'web',
          command: 'pnpm --filter @livro/web build && pnpm --filter @livro/web start',
          url: `${BASE_URL}/login`,
          timeout: 240_000,
          reuseExistingServer: !CI,
        },
      ],
})
