// Fase 1 com o cenário de ditado simples: cursor de ditado (F1.17), fechar a
// aba (F1.20), duas abas (F1.21), ouvir trecho (F1.05), glossário (F1.07),
// exportação automática (F1.25) e painel de custos (T.04).
import { expect, test } from '@playwright/test'
import { adminClient, loadScenario, mockSttControl, referenceTranscript } from '@livro/test-kit'
import {
  STT_CONTROL_URL,
  deleteBooks,
  editorBlocks,
  newBookWithScenario,
  seedBlocks,
  startRecording,
  stopRecording,
  useFakeMic,
} from '../helpers.ts'

useFakeMic('ditado-simples')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

const reference = referenceTranscript(loadScenario('ditado-simples'))
const firstFinal = reference[0]!
const fullText = reference.join(' ')

test('F1.17: o ditado entra onde está o cursor de ditado, no meio do capítulo', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'ditado-simples', created)
  const [c1, p1, c2, p2] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
  await seedBlocks(bookId, [
    { id: c1, parent_id: null, type: 'chapter', position: 'a0', content: 'Primeiro' },
    { id: c2, parent_id: null, type: 'chapter', position: 'a1', content: 'Segundo' },
  ])
  await seedBlocks(bookId, [
    { id: p1, parent_id: c1, type: 'paragraph', position: 'a0', content: 'Abertura do capítulo.' },
    { id: p2, parent_id: c2, type: 'paragraph', position: 'a0', content: 'Texto do segundo.' },
  ])
  await page.reload()

  // cursor de digitação no fim do primeiro parágrafo; Alt+D leva o cursor de ditado para lá
  await page.locator(`[data-block-id="${p1}"]`).click()
  await page.keyboard.press('End')
  await page.keyboard.press('Alt+KeyD')
  await expect(page.getByTestId('faixa-comando')).toContainText('Cursor de ditado movido')

  await startRecording(page)
  await expect
    .poll(() => editorBlocks(page), { timeout: 20_000 })
    .toEqual([
      { type: 'chapter', text: 'Primeiro' },
      { type: 'paragraph', text: `Abertura do capítulo. ${fullText}` },
      { type: 'chapter', text: 'Segundo' },
      { type: 'paragraph', text: 'Texto do segundo.' },
    ])
  await stopRecording(page)
})

test('F1.20: fechar a aba no meio do ditado não perde o que já virou final', { tag: '@local' }, async ({ page, context }) => {
  const bookId = await newBookWithScenario(page, 'ditado-simples', created)
  await startRecording(page)
  await expect.poll(async () => (await editorBlocks(page))[0]?.text ?? '', { timeout: 15_000 }).toContain(firstFinal)
  await page.close() // sem pausar

  const again = await context.newPage()
  await again.goto(`/obra/${bookId}`)
  await expect.poll(async () => (await editorBlocks(again))[0]?.text ?? '').toContain(firstFinal)
})

test('F1.21: o ditado numa aba aparece na outra em menos de 2 s', { tag: '@local' }, async ({ page, context }) => {
  const bookId = await newBookWithScenario(page, 'ditado-simples', created)
  const other = await context.newPage()
  await other.goto(`/obra/${bookId}`)
  await expect(other.getByTestId('manuscrito')).toBeVisible()
  await other.waitForTimeout(1500) // tempo de assinar o canal do Realtime

  await startRecording(page)
  await expect.poll(async () => (await editorBlocks(page))[0]?.text ?? '', { timeout: 15_000, intervals: [100] }).toContain(firstFinal)
  await expect.poll(async () => (await editorBlocks(other))[0]?.text ?? '', { timeout: 2_000, intervals: [100] }).toContain(firstFinal)
  await stopRecording(page)
})

test('F1.05, F1.25 e T.04: áudio do trecho, Word automático e custos depois da sessão', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'ditado-simples', created)
  await startRecording(page)
  await expect.poll(() => editorBlocks(page), { timeout: 20_000 }).toEqual([{ type: 'paragraph', text: fullText }])
  await stopRecording(page)

  // "Ouvir trecho" toca o áudio que gerou o parágrafo
  const db = adminClient()
  const { data: block } = await db.from('blocks').select('id').eq('book_id', bookId).eq('type', 'paragraph').single()
  await expect
    .poll(async () => (await db.from('audio_segments').select('storage_path').eq('block_id', block!.id)).data?.length ?? 0)
    .toBe(reference.length)
  const { data: segments } = await db.from('audio_segments').select('storage_path, seq').eq('block_id', block!.id).order('seq')
  await page.locator(`[data-block-id="${block!.id}"]`).click()
  await page.getByRole('button', { name: 'Ouvir trecho' }).click()
  await expect(page.getByTestId('audio-trecho')).toHaveAttribute('data-paths', segments!.map((s) => s.storage_path).join(','))

  // o Word sai sozinho ao fim da sessão
  await expect
    .poll(async () => {
      await page.goto(`/obra/${bookId}/exportacoes`)
      return page.locator('[data-trigger="session_end"]').count()
    }, { timeout: 20_000 })
    .toBe(1)

  // o painel registra os minutos da sessão
  await page.goto('/custos')
  await expect(page.getByTestId('minutos')).not.toHaveText('0 min')
  await expect(page.getByTestId('sessoes')).toContainText('mock')
})

test('F1.07: o termo do glossário vai para o provedor ao abrir a sessão', { tag: '@local' }, async ({ page }) => {
  const bookId = await newBookWithScenario(page, 'ditado-simples', created)
  await page.goto(`/obra/${bookId}/glossario`)
  await page.getByLabel('Termo').fill('usucapião')
  await page.getByRole('button', { name: 'Adicionar' }).click()
  await expect(page.getByTestId('glossario')).toContainText('usucapião')

  await page.goto(`/obra/${bookId}`)
  await startRecording(page)
  await expect
    .poll(async () => (await mockSttControl(STT_CONTROL_URL).requests()).find((r) => r.bookId === bookId)?.keywords ?? [])
    .toContain('usucapião')
  await stopRecording(page)
})
