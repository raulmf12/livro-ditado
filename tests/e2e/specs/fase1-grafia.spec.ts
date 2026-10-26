// F1.08 — dicionário de grafia: "rex" vira "REsp", a troca fica no registro e pode ser desfeita.
import { expect, test } from '@playwright/test'
import { deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'

useFakeMic('grafia-rex')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('F1.08: regra aprovada troca a grafia, registra antes e depois, e o desfazer restaura', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'grafia-rex', created)
  await page.goto(`/obra/${bookId}/grafia`)
  await page.getByLabel('O reconhecimento escreve').fill('rex')
  await page.getByLabel('No livro fica').fill('REsp')
  await page.getByRole('button', { name: 'Salvar regra' }).click()
  await expect(page.getByTestId('regras')).toContainText('Aprovada')

  await page.goto(`/obra/${bookId}`)
  await startRecording(page)
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual([{ type: 'paragraph', text: 'No REsp 1.234, o tribunal decidiu.' }])
  await stopRecording(page)

  await page.goto(`/obra/${bookId}/grafia`)
  const row = page.getByTestId('trocas').locator('tbody tr').first()
  await expect(row).toContainText('rex')
  await expect(row).toContainText('REsp')
  await row.getByRole('button', { name: 'Desfazer' }).click()
  await expect(page.getByTestId('trocas').locator('tbody tr').first()).toContainText('Desfeita')

  await page.goto(`/obra/${bookId}`)
  await expect.poll(() => editorBlocks(page)).toEqual([{ type: 'paragraph', text: 'No rex 1.234, o tribunal decidiu.' }])
})
