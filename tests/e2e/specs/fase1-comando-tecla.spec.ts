// F1.11 — o mesmo comando, dito com a tecla de comando segurada (o pedal USB
// envia esta tecla) e sem a palavra de ativação.
import { expect, test } from '@playwright/test'
import { adminClient } from '@livro/test-kit'
import { deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'
import { EXPECTED_AFTER_COMMAND } from './fase1-comando-esperado.ts'

useFakeMic('comando-tecla')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('F1.11: segurando a tecla de comando, "capítulo dois…" executa igual', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'comando-tecla', created)
  await startRecording(page)
  await page.keyboard.down('F9')
  await expect(page.getByTestId('modo-comando')).toBeVisible()
  await expect(page.getByTestId('faixa-comando')).toContainText('Capítulo 2: Da propriedade', { timeout: 15_000 })
  await page.keyboard.up('F9')
  await expect(page.getByTestId('modo-comando')).toHaveCount(0)
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual(EXPECTED_AFTER_COMMAND)
  await stopRecording(page)
  const { data } = await adminClient().from('commands').select('activation, status').eq('book_id', bookId)
  expect(data).toEqual([{ activation: 'key', status: 'executed' }])
})
