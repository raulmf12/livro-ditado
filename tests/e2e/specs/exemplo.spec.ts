// F0.07 — Cenário de exemplo da base de testes: microfone falso (.wav do
// cenário) → navegador → servidor de sessão → simulador de STT → tela e banco.
import { expect, test } from '@playwright/test'
import { adminClient, loadScenario, mockSttControl, referenceTranscript } from '@livro/test-kit'
import { STT_CONTROL_URL, createBookViaUi, deleteBooks, login, useFakeMic } from '../helpers.ts'

useFakeMic('ditado-simples')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('ditado simples: provisório em cinza, finais no manuscrito e no banco', async ({ page }) => {
  const scenario = loadScenario('ditado-simples')
  const reference = referenceTranscript(scenario)
  const stt = mockSttControl(STT_CONTROL_URL)

  await login(page, 'a')
  const bookId = await createBookViaUi(page, `Exemplo E2E ${Date.now()}`)
  created.push(bookId)
  await stt.useScenario(scenario.name, bookId)

  await page.getByRole('button', { name: 'Gravar' }).click()
  await expect(page.getByTestId('status')).toHaveText('gravando')
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible()

  // o medidor reage ao áudio do microfone falso
  await expect
    .poll(async () => Number(await page.getByTestId('medidor').getAttribute('aria-valuenow')))
    .toBeGreaterThan(0)

  const manuscript = page.getByTestId('manuscrito')
  await expect(manuscript.locator('[data-kind="interim"]')).toHaveCSS('color', 'rgb(143, 138, 128)')
  await expect(manuscript.locator('[data-kind="final"]')).toHaveText(reference, { timeout: 15_000 })

  await page.getByRole('button', { name: 'Pausar' }).click()
  await expect(page.getByTestId('status')).toHaveText('parado')
  await expect(page.getByTestId('aviso')).toHaveCount(0)

  // banco: só os finais foram gravados, idênticos à transcrição de referência
  const db = adminClient()
  const { data: events } = await db
    .from('transcript_events')
    .select('kind, text')
    .eq('book_id', bookId)
    .order('id')
  expect(events).toEqual(reference.map((text) => ({ kind: 'final', text })))

  const { data: sessions } = await db
    .from('dictation_sessions')
    .select('status, stt_provider, latency_samples, latency_p50_ms, latency_p95_ms')
    .eq('book_id', bookId)
  expect(sessions).toMatchObject([{ status: 'ended', stt_provider: 'mock', latency_samples: reference.length }])

  // métrica de latência fala → tela (F0.06); o alvo de 1,5 s (T.05) vale aqui com folga
  const [session] = sessions!
  expect(session!.latency_p50_ms).toBeGreaterThanOrEqual(0)
  expect(session!.latency_p95_ms).toBeLessThan(1500)

  // o simulador recebeu a sessão desta obra, com áudio
  const req = (await stt.requests()).find((r) => r.bookId === bookId)
  expect(req?.language).toBe('pt-BR')
  expect(req?.audioMs).toBeGreaterThan(4000)
})
