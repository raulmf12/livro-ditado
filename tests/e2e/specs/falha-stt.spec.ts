// F0.06 — Falha simulada do STT mostra aviso amigável na tela.
import { expect, test } from '@playwright/test'
import { adminClient, mockSttControl } from '@livro/test-kit'
import { STT_CONTROL_URL, createBookViaUi, deleteBooks, login, useFakeMic } from '../helpers.ts'

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

  const { data } = await adminClient().from('dictation_sessions').select('status').eq('book_id', bookId)
  expect(data).toEqual([{ status: 'interrupted' }])
})
