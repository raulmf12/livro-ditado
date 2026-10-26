// E2E-01 — Capítulo completo no computador: login, nova obra, áudio com
// capítulo, seção, três parágrafos, citação e notas, exportação Word.
// Cobre também F1.12, F1.14 (comando não entra no texto), F1.22–F1.24 e
// E2E-11 (fidelidade). A segunda versão repete tudo só pelo teclado (T.06).
import { expect, test, type Page } from '@playwright/test'
import { adminClient, loadScenario } from '@livro/test-kit'
import { deleteBooks, editorBlocks, exportWord, newBookWithScenario, useFakeMic, wordParagraphs } from '../helpers.ts'

useFakeMic('capitulo-completo')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

const scenario = loadScenario('capitulo-completo')
const lastFinal = scenario.events.filter((e) => e.kind === 'final').at(-1)!

const P1 = 'A função social da propriedade rural é princípio constitucional.'
const P2 = 'Diz o Estatuto da Terra:'
const QUOTE = 'A propriedade da terra desempenha integralmente a sua função social quando favorece o bem-estar dos proprietários.'
const P3 = 'Como se vê, o legislador foi explícito.'
const NOTES = ['Conforme o artigo 186 da Constituição.', 'Ver o Estatuto da Terra, art. 2º.']

/** Espera o ditado inteiro chegar e confere a estrutura no editor. */
async function dictateChapter(page: Page) {
  await expect
    .poll(() => editorBlocks(page), { timeout: lastFinal.atMs + 30_000, intervals: [1000] })
    .toEqual([
      { type: 'chapter', text: 'Da função social da propriedade' },
      { type: 'section', text: 'Conceito' },
      { type: 'paragraph', text: P1 },
      { type: 'paragraph', text: P2 },
      { type: 'quote', text: QUOTE },
      { type: 'paragraph', text: P3 },
    ])
  // as duas notas estão no editor, presas aos parágrafos onde foram ditadas
  await expect(page.locator('[data-type="footnote"]')).toHaveCount(2)
}

async function checkWord(page: Page, bookId: string) {
  const r = await exportWord(page, bookId)
  const paras = wordParagraphs(r)
  expect(paras.map((p) => [p.style, p.text])).toEqual([
    ['Heading 1', 'Capítulo 1 — Da função social da propriedade'],
    ['Heading 2', '1.1 Conceito'],
    [expect.stringMatching(/First Paragraph|Body Text/), P1],
    [expect.stringMatching(/First Paragraph|Body Text/), P2],
    ['Citação longa', QUOTE],
    [expect.stringMatching(/First Paragraph|Body Text/), P3],
  ])
  const quote = paras.find((p) => p.style === 'Citação longa')!
  expect(quote.left_indent_cm).toBe(4)
  expect(quote.font_size_pt).toBe(10)

  // notas reais do Word, na ordem, no parágrafo certo (F1.24)
  expect(r.footnotes.map((f) => f.text)).toEqual(NOTES)
  expect(paras.find((p) => p.text === P1)!.footnote_ids).toHaveLength(1)
  expect(paras.find((p) => p.text === P3)!.footnote_ids).toHaveLength(1)

  // nenhuma palavra de comando no Word (F1.14) e o texto é o ditado, sem tirar nem pôr (E2E-11)
  const all = [...paras.map((p) => p.text), ...r.footnotes.map((f) => f.text)].join('\n')
  expect(all).not.toMatch(/Atena|fim da nota|abre citação|fecha citação|novo parágrafo/i)
  expect(r.ai_marked_count).toBe(0)
}

async function checkDatabase(bookId: string) {
  const db = adminClient()
  const { data: commands } = await db.from('commands').select('status, activation').eq('book_id', bookId)
  // 9 comandos ditados, todos executados por palavra de ativação
  expect(commands).toHaveLength(9)
  expect(commands!.every((c) => c.status === 'executed' && c.activation === 'wake_word')).toBe(true)
}

test('E2E-01: capítulo completo ditado no computador até o Word', { tag: '@local' }, async ({ page }) => {
  test.setTimeout(lastFinal.atMs + 90_000)
  const bookId = await newBookWithScenario(page, 'capitulo-completo', created)

  await page.getByRole('button', { name: 'Gravar' }).click()
  await expect(page.getByTestId('status')).toHaveText('gravando')
  // a faixa confirma o primeiro comando entendido
  await expect(page.getByTestId('faixa-comando')).toContainText('Capítulo 1: Da função social da propriedade', { timeout: 15_000 })
  await dictateChapter(page)
  await page.getByRole('button', { name: 'Pausar' }).click()
  await expect(page.getByTestId('status')).toHaveText('parado', { timeout: 20_000 })

  // o sumário mostra o capítulo e a seção
  await expect(page.getByTestId('sumario')).toContainText('1 Da função social da propriedade')
  await expect(page.getByTestId('sumario')).toContainText('1 Conceito')

  await checkWord(page, bookId)
  await checkDatabase(bookId)
})

test('E2E-01 só com o teclado (T.06)', { tag: '@local' }, async ({ page }) => {
  test.setTimeout(lastFinal.atMs + 90_000)
  const bookId = await newBookWithScenario(page, 'capitulo-completo', created)

  await page.keyboard.press('Alt+KeyR') // gravar
  await expect(page.getByTestId('status')).toHaveText('gravando')
  await dictateChapter(page)
  await page.keyboard.press('Alt+KeyR') // pausar
  await expect(page.getByTestId('status')).toHaveText('parado', { timeout: 20_000 })

  // exportar usando só Tab e Enter
  await page.goto(`/obra/${bookId}/exportacoes`)
  const button = page.getByRole('button', { name: 'Exportar Word' })
  for (let i = 0; i < 40 && !(await button.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(button).toBeFocused()
  const downloading = page.waitForEvent('download')
  await page.keyboard.press('Enter')
  expect((await downloading).suggestedFilename()).toMatch(/\.docx$/)
})
