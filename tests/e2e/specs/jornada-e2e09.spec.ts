// E2E-09 — Falso positivo e queda de rede: frases do domínio com "comando
// normativo" e "Atena" no meio não disparam nada, e uma queda de 5 s no meio
// do ditado não perde texto (F1.02, F1.15).
import { expect, test } from '@playwright/test'
import { adminClient, dictatedFinals, loadScenario, netCutterControl } from '@livro/test-kit'
import { NET_CUTTER_URL, deleteBooks, editorBlocks, newBookWithScenario, startRecording, stopRecording, useFakeMic } from '../helpers.ts'

useFakeMic('comando-normativo')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('E2E-09: nenhum comando disparado e texto completo depois de reconectar', { tag: '@local' }, async ({ page }) => {
  const scenario = loadScenario('comando-normativo')
  const finals = dictatedFinals(scenario)
  expect(finals).toHaveLength(3) // nenhuma das frases conta como comando

  const bookId = await newBookWithScenario(page, 'comando-normativo', created)
  await startRecording(page)
  // espera o primeiro final e derruba a rede por 5 s
  await expect.poll(async () => (await editorBlocks(page))[0]?.text ?? '', { timeout: 15_000 }).toContain(finals[0]!)
  await netCutterControl(NET_CUTTER_URL).cut(5_000)
  await expect(page.getByTestId('reconectando')).toBeVisible()
  await expect(page.getByTestId('reconectando')).toHaveCount(0, { timeout: 20_000 })

  await expect.poll(() => editorBlocks(page), { timeout: 30_000 }).toEqual([{ type: 'paragraph', text: finals.join(' ') }])
  await stopRecording(page)

  const db = adminClient()
  const { data: commands } = await db.from('commands').select('id').eq('book_id', bookId)
  expect(commands).toEqual([])
  // a sessão sobreviveu à queda: uma sessão só, encerrada normalmente
  const { data: sessions } = await db.from('dictation_sessions').select('status').eq('book_id', bookId)
  expect(sessions).toEqual([{ status: 'ended' }])
  // e o texto gravado é exatamente o ditado (E2E-11)
  const { data: blocks } = await db.from('blocks').select('content').eq('book_id', bookId)
  expect(blocks).toEqual([{ content: finals.join(' ') }])
})
