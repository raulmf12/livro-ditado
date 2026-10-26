// Manuscrito sem ditado: reordenar capítulos (F1.19), prévia diagramada (F1.18),
// digitação salva e histórico de versões (F1.20).
import { expect, test, type Page } from '@playwright/test'
import { createBookViaUi, deleteBooks, editorBlocks, exportWord, login, seedBlocks, wordParagraphs } from '../helpers.ts'

const created: string[] = []
test.afterAll(() => deleteBooks(created))

async function bookWith(page: Page, title: string, chapters: [string, string][]) {
  await login(page, 'a')
  const bookId = await createBookViaUi(page, `${title} ${Date.now()}`)
  created.push(bookId)
  const ids = chapters.map(() => [crypto.randomUUID(), crypto.randomUUID()] as const)
  await seedBlocks(bookId, chapters.map(([t], i) => ({ id: ids[i]![0], parent_id: null, type: 'chapter', position: `a${i}`, content: t, attrs: { number: i + 1 } })))
  await seedBlocks(bookId, chapters.map(([, p], i) => ({ id: ids[i]![1], parent_id: ids[i]![0], type: 'paragraph', position: 'a0', content: p })))
  await page.reload()
  return { bookId, ids }
}

test('F1.19: arrastar o capítulo 3 para antes do 2 leva o conteúdo junto, até no Word', async ({ page }) => {
  const { bookId, ids } = await bookWith(page, 'Reordenar', [
    ['Um', 'Texto do um.'],
    ['Dois', 'Texto do dois.'],
    ['Três', 'Texto do três.'],
  ])
  const toc = page.getByTestId('sumario')
  await toc.locator(`[data-chapter-id="${ids[2]![0]}"]`).dragTo(toc.locator(`[data-chapter-id="${ids[1]![0]}"]`))
  await expect(page.getByTestId('salvamento')).toHaveText('Salvo')
  const order = [
    { type: 'chapter', text: 'Um' },
    { type: 'paragraph', text: 'Texto do um.' },
    { type: 'chapter', text: 'Três' },
    { type: 'paragraph', text: 'Texto do três.' },
    { type: 'chapter', text: 'Dois' },
    { type: 'paragraph', text: 'Texto do dois.' },
  ]
  await expect.poll(() => editorBlocks(page)).toEqual(order)
  await page.reload()
  await expect.poll(() => editorBlocks(page)).toEqual(order)

  const r = await exportWord(page, bookId)
  expect(wordParagraphs(r).map((p) => p.text)).toEqual([
    'Capítulo 1 — Um',
    'Texto do um.',
    'Capítulo 3 — Três',
    'Texto do três.',
    'Capítulo 2 — Dois',
    'Texto do dois.',
  ])
})

test('F1.19: os botões de subir e descer fazem o mesmo, pelo teclado', async ({ page }) => {
  await bookWith(page, 'Reordenar teclado', [
    ['Um', 'a'],
    ['Dois', 'b'],
  ])
  await page.getByRole('button', { name: 'Descer 1 Um' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await editorBlocks(page)).filter((b) => b.type === 'chapter').map((b) => b.text)).toEqual(['Dois', 'Um'])
})

test('F1.18: a prévia diagramada bate com a página de referência aprovada', async ({ page }) => {
  await login(page, 'a')
  const bookId = await createBookViaUi(page, 'Amostra da prévia')
  created.push(bookId)
  const [c, s, p1, q, p2, n] = Array.from({ length: 6 }, () => crypto.randomUUID())
  await seedBlocks(bookId, [{ id: c!, parent_id: null, type: 'chapter', position: 'a0', content: 'Da posse agrária', attrs: { number: 3 } }])
  await seedBlocks(bookId, [
    { id: s!, parent_id: c!, type: 'section', position: 'a0', content: 'Conceito', attrs: { number: 1 } },
    { id: p1!, parent_id: c!, type: 'paragraph', position: 'a1', content: 'A posse agrária exige a exploração efetiva da terra, com trabalho e investimento, e não se confunde com a mera detenção do imóvel rural.' },
    { id: q!, parent_id: c!, type: 'quote', position: 'a2', content: 'O proprietário tem a faculdade de usar, gozar e dispor da coisa, e o direito de reavê-la do poder de quem quer que injustamente a possua ou detenha.' },
    { id: p2!, parent_id: c!, type: 'paragraph', position: 'a3', content: 'Como se vê, a proteção possessória tem fundamento próprio.' },
  ])
  // chamada da nota logo depois de "da terra,"
  await seedBlocks(bookId, [{ id: n!, parent_id: p1!, type: 'note', position: 'a0', content: 'Ver art. 1.196 do Código Civil.', attrs: { anchor: 'A posse agrária exige a exploração efetiva da terra'.length } }])
  await page.reload()
  await page.getByRole('button', { name: 'Prévia' }).click()
  const sheet = page.getByTestId('previa').locator('.sheet').first()
  await expect(sheet).toBeVisible()
  // a barra de ditado fica parada no topo e não cobre a folha na captura
  await page.addStyleTag({ content: '.dictation-bar { position: static !important; }' })
  await expect(sheet).toHaveScreenshot('previa-amostra.png', { maxDiffPixelRatio: 0.01 })
})

test('F1.20: o que se digita é salvo, aparece no histórico e pode ser restaurado', async ({ page }) => {
  const { bookId, ids } = await bookWith(page, 'Histórico', [['Capítulo', 'Texto original.']])
  await page.locator(`[data-block-id="${ids[0]![1]}"]`).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' Acrescentado.')
  await expect(page.getByTestId('salvamento')).toHaveText('Salvo')
  await page.reload()
  await expect.poll(async () => (await editorBlocks(page))[1]?.text).toBe('Texto original. Acrescentado.')

  await page.goto(`/obra/${bookId}/historico`)
  // a digitação pode ter sido salva em mais de um passo: restaura a versão de antes de tudo
  const row = page
    .getByTestId('historico')
    .locator('tbody tr')
    .filter({ hasText: 'Alterado' })
    .filter({ has: page.locator('td:nth-child(3)', { hasText: /^Texto original\.$/ }) })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: 'Restaurar' }).click()
  // a restauração vira uma mudança nova no topo do histórico; só então sai da página
  await expect(page.getByTestId('historico').locator('tbody tr').first().locator('td:nth-child(4)')).toHaveText('Texto original.')
  await page.goto(`/obra/${bookId}`)
  await expect.poll(async () => (await editorBlocks(page))[1]?.text).toBe('Texto original.')
})
