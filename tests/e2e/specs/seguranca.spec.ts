// E2E-12 — Segurança: sem sessão, obra de outro usuário e WebSocket sem token.
import { expect, test } from '@playwright/test'
import { WebSocket } from 'ws'
import { PROTOCOL_VERSION, authProtocol } from '@livro/shared'
import { signedInClient } from '@livro/test-kit'
import { SESSION_WS_URL, login, readSeed } from '../helpers.ts'

const SUPABASE_URL = process.env.SUPABASE_URL!
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY!

/** Tenta o handshake e devolve o status HTTP (101 = aberto). */
function wsHandshake(protocols: string[]) {
  return new Promise<number>((resolve) => {
    const ws = new WebSocket(SESSION_WS_URL, protocols)
    ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0))
    ws.on('open', () => {
      resolve(101)
      ws.close()
    })
    ws.on('error', () => resolve(0))
  })
}

test.describe('1) sem sessão', () => {
  test('obra e lista de obras redirecionam ao login, sem mostrar conteúdo', async ({ page }) => {
    const s = readSeed()
    for (const path of ['/obra', `/obra/${s.users.a.bookId}`]) {
      const res = await page.goto(path)
      await expect(page).toHaveURL(/\/login\?next=/)
      expect(await res!.text()).not.toContain('Obra semente A')
    }
  })

  test('API do banco recusa leitura das obras', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL}/rest/v1/books?select=*`, { headers: { apikey: PUBLISHABLE } })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(await res.text()).not.toContain('Obra semente')
  })

  test('Storage recusa o áudio', async ({ request }) => {
    const s = readSeed()
    const res = await request.get(`${SUPABASE_URL}/storage/v1/object/audio/${s.audioObject}`, {
      headers: { apikey: PUBLISHABLE },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect((await res.body()).subarray(0, 4).toString()).not.toBe('RIFF')
  })
})

test.describe('2) obra de outro usuário', () => {
  test('B não vê a obra de A na tela', async ({ page }) => {
    const s = readSeed()
    await login(page, 'b')
    await expect(page.getByRole('link', { name: 'Obra semente B' })).toBeVisible()
    await expect(page.getByText('Obra semente A')).toHaveCount(0)

    const res = await page.goto(`/obra/${s.users.a.bookId}`)
    expect(res!.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Obra não encontrada' })).toBeVisible()
    await expect(page.getByText('Obra semente A')).toHaveCount(0)
  })

  test('B não lê a obra nem o áudio de A pela API', async ({ request }) => {
    const s = readSeed()
    const { token } = await signedInClient(s.users.b.email, s.password)
    const headers = { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` }

    const rest = await request.get(`${SUPABASE_URL}/rest/v1/books?id=eq.${s.users.a.bookId}&select=*`, { headers })
    expect(await rest.json()).toEqual([])

    const audio = await request.get(`${SUPABASE_URL}/storage/v1/object/audio/${s.audioObject}`, { headers })
    expect(audio.status()).toBeGreaterThanOrEqual(400)
  })

  test('B não abre sessão de ditado na obra de A', async () => {
    const s = readSeed()
    const { token } = await signedInClient(s.users.b.email, s.password)
    const ws = new WebSocket(SESSION_WS_URL, [PROTOCOL_VERSION, authProtocol(token)])
    const result = await new Promise<{ msg: { type: string; code?: string }; code: number }>((resolve) => {
      let msg: { type: string; code?: string } = { type: '' }
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', bookId: s.users.a.bookId })))
      ws.on('message', (d) => (msg = JSON.parse(d.toString())))
      ws.on('close', (code) => resolve({ msg, code }))
    })
    expect(result.msg).toMatchObject({ type: 'error', code: 'book_not_found' })
    expect(result.code).toBe(4404)
  })
})

test.describe('3) WebSocket sem token', () => {
  test('handshake sem token é recusado com 401', async () => {
    expect(await wsHandshake([PROTOCOL_VERSION])).toBe(401)
    expect(await wsHandshake([])).toBe(401)
  })

  test('token forjado é recusado com 401', async () => {
    const forged = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4Iiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQifQ', 'assinatura'].join('.')
    expect(await wsHandshake([PROTOCOL_VERSION, authProtocol(forged)])).toBe(401)
  })
})
