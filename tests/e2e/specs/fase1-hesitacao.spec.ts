// F1.09 — remoção de hesitações: desligada por padrão; ligada, só sai o que está na lista.
import { expect, test } from '@playwright/test'
import { deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'

useFakeMic('hesitacao')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('F1.09: o mesmo áudio com a opção desligada e ligada', { tag: '@local' }, async ({ page }) => {
  // padrão: desligada, o texto fica como veio
  const off = await newBookWithScenario(page, 'hesitacao', created)
  await startRecording(page)
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual([{ type: 'paragraph', text: 'A posse, hã, exige exploração efetiva.' }])
  await stopRecording(page)

  const on = await newBookWithScenario(page, 'hesitacao', created, null)
  await page.goto(`/obra/${on}/configuracoes`)
  await page.getByLabel(/Remover hesitações/).check()
  await page.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('status')).toContainText('Configurações salvas')
  await page.goto(`/obra/${on}`)
  await startRecording(page)
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual([{ type: 'paragraph', text: 'A posse, exige exploração efetiva.' }])
  await stopRecording(page)
  expect(off).not.toBe(on)
})
