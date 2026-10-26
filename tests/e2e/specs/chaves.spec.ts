// T.01 — Nenhuma chave de API no código servido ao navegador.
import { expect, test } from '@playwright/test'
import { login, readSeed } from '../helpers.ts'

const PATTERNS: [string, RegExp][] = [
  ['chave secreta do Supabase', /sb_secret_[A-Za-z0-9_-]{8,}/],
  ['chave da Anthropic', /sk-ant-[A-Za-z0-9_-]{8,}/],
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

/** JWTs com papel service_role (chave legada do Supabase). */
function serviceRoleJwts(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1]!, 'base64url').toString())
      if (payload.role === 'service_role') found.push(m[0])
    } catch {
      // não era JWT
    }
  }
  return found
}

test('o JavaScript servido não contém chaves', async ({ page }) => {
  const scripts = new Map<string, string>()
  page.on('response', async (res) => {
    const type = res.headers()['content-type'] ?? ''
    if (type.includes('javascript')) scripts.set(res.url(), await res.text().catch(() => ''))
  })

  const s = readSeed()
  await page.goto('/login')
  await login(page, 'a')
  await page.goto(`/obra/${s.users.a.bookId}`)
  await page.waitForLoadState('networkidle')

  expect(scripts.size).toBeGreaterThan(3)
  const secret = process.env.SUPABASE_SECRET_KEY
  for (const [url, body] of scripts) {
    if (secret) expect(body.includes(secret), `chave secreta em ${url}`).toBe(false)
    for (const [name, re] of PATTERNS) expect(re.test(body), `${name} em ${url}`).toBe(false)
    expect(serviceRoleJwts(body), `JWT service_role em ${url}`).toEqual([])
  }
})
