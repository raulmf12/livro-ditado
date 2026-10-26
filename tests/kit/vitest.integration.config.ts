import { defineConfig } from 'vitest/config'

// Integração roda contra o Supabase do .env (projeto de desenvolvimento).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // no CI as variáveis vêm dos segredos do GitHub
}

export default defineConfig({
  test: {
    include: ['integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
