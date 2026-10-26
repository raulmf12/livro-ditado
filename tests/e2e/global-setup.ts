import { mkdirSync, writeFileSync } from 'node:fs'
import { seed } from '@livro/test-kit/seed'
import { SEED_FILE } from './helpers.ts'

export default async function globalSetup() {
  // Em produção o E2E roda só o smoke, sem criar usuários de teste.
  if (process.env.E2E_SKIP_SEED) return
  const result = await seed()
  mkdirSync(new URL('./.auth/', import.meta.url), { recursive: true })
  writeFileSync(SEED_FILE, JSON.stringify(result, null, 2))
}
