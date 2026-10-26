// F1.13 — edição por voz: "apaga a última frase" e "desfaz" voltam o texto ao estado anterior.
import { expect, test } from '@playwright/test'
import { adminClient } from '@livro/test-kit'
import { deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'

useFakeMic('edicao-voz')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('F1.13: ditar, apagar a última frase e desfazer', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'edicao-voz', created)
  await startRecording(page)
  const full = [{ type: 'paragraph', text: 'A posse é um fato. A propriedade é um direito.' }]
  await expect.poll(() => editorBlocks(page), { timeout: 15_000, intervals: [100] }).toEqual(full)
  await expect.poll(() => editorBlocks(page), { timeout: 15_000, intervals: [100] }).toEqual([{ type: 'paragraph', text: 'A posse é um fato.' }])
  await expect(page.getByTestId('faixa-comando')).toContainText('Última frase apagada')
  await expect.poll(() => editorBlocks(page), { timeout: 15_000, intervals: [100] }).toEqual(full)
  await expect(page.getByTestId('faixa-comando')).toContainText('Desfeito')
  await stopRecording(page)

  const { data } = await adminClient().from('commands').select('parsed, status').eq('book_id', bookId).order('created_at')
  expect(data!.map((c) => [(c.parsed as { kind: string }).kind, c.status])).toEqual([
    ['delete_last_sentence', 'executed'],
    ['undo', 'executed'],
  ])
})
