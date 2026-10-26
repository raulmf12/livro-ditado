// F1.11 — comando com a palavra de ativação. O par deste teste, com a tecla
// segurada, está em fase1-comando-tecla.spec.ts; os dois têm de dar o mesmo resultado.
import { expect, test } from '@playwright/test'
import { adminClient } from '@livro/test-kit'
import { deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'
import { EXPECTED_AFTER_COMMAND } from './fase1-comando-esperado.ts'

useFakeMic('comando-palavra')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('F1.11: "Atena, capítulo dois…" cria o capítulo e o texto vai para dentro dele', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'comando-palavra', created)
  await startRecording(page)
  await expect(page.getByTestId('faixa-comando')).toContainText('Capítulo 2: Da propriedade', { timeout: 15_000 })
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual(EXPECTED_AFTER_COMMAND)
  await stopRecording(page)
  const { data } = await adminClient().from('commands').select('activation, status').eq('book_id', bookId)
  expect(data).toEqual([{ activation: 'wake_word', status: 'executed' }])
})
