// F0.06 — Falha simulada do STT mostra aviso amigável na tela, e o erro chega
// ao Sentry (simulado) com o ID da sessão.
import { expect, test } from '@playwright/test'
import { adminClient, mockSentryControl, mockSttControl } from '@livro/test-kit'
import { SENTRY_CONTROL_URL, STT_CONTROL_URL, createBookViaUi, deleteBooks, login, useFakeMic } from '../helpers.ts'

useFakeMic('ditado-simples')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('queda do provedor de transcrição gera aviso amigável', async ({ page }) => {
  await login(page, 'a')
  const bookId = await createBookViaUi(page, `Falha STT E2E ${Date.now()}`)
  created.push(bookId)
  await mockSttControl(STT_CONTROL_URL).useScenario('falha-stt', bookId)

  await page.getByRole('button', { name: 'Gravar' }).click()
  const alert = page.getByTestId('aviso')
  await expect(alert).toContainText('A transcrição está fora do ar no momento')
  await expect(alert).not.toContainText(/simulad|error|1011|ECONN/i)
  await expect(page.getByTestId('status')).toHaveText('parado')
  await expect(page.getByRole('button', { name: 'Gravar' })).toBeEnabled()

  const { data } = await adminClient().from('dictation_sessions').select('id, status').eq('book_id', bookId)
  expect(data).toMatchObject([{ status: 'interrupted' }])
  const sessionId = data![0]!.id as string

  // servidor: exceção com o ID da sessão; navegador: aviso mostrado ao autor, com o mesmo ID
  const sentry = mockSentryControl(SENTRY_CONTROL_URL)
  await expect
    .poll(async () => (await sentry.events()).filter((e) => e.tags?.sessionId === sessionId).length)
    .toBeGreaterThanOrEqual(2)
  const events = (await sentry.events()).filter((e) => e.tags?.sessionId === sessionId)
  expect(events).toContainEqual(
    expect.objectContaining({
      tags: expect.objectContaining({ service: 'session', provider: 'mock' }),
      exception: expect.objectContaining({
        values: [expect.objectContaining({ value: 'simulador de STT: falha simulada do provedor' })],
      }),
    }),
  )
  expect(events).toContainEqual(
    expect.objectContaining({ level: 'warning', tags: expect.objectContaining({ code: 'stt_unavailable' }) }),
  )
  // nada do texto ditado vai junto
  expect(JSON.stringify(events)).not.toContain('A função')
})
