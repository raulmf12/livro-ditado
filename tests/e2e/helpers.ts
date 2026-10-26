import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { audioPath, fakeMicArgs, loadScenario } from '@livro/test-kit/scenarios'
import type { SeedResult } from '@livro/test-kit/seed'
import { adminClient } from '@livro/test-kit'
import { verifyDocx, type DocxReport } from '@livro/test-kit/word'

export const SEED_FILE = new URL('./.auth/seed.json', import.meta.url)

export function readSeed(): SeedResult {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedResult
}

export const SESSION_WS_URL = process.env.NEXT_PUBLIC_SESSION_WS_URL ?? 'ws://localhost:4001/ws'
export const STT_CONTROL_URL = process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010'
export const SENTRY_CONTROL_URL = `http://localhost:${process.env.MOCK_SENTRY_PORT ?? '4040'}`
export const NET_CUTTER_URL = `http://localhost:${process.env.NET_CUTTER_CONTROL_PORT ?? '4012'}`

/**
 * Como o microfone falso entra no navegador:
 * - "flags": as flags do Chromium (--use-file-for-fake-audio-capture). É o modo do CI (Linux).
 * - "script": troca navigator.mediaDevices.getUserMedia por um stream que toca o .wav.
 *   No macOS o Chromium consulta a permissão de microfone do sistema mesmo com
 *   dispositivo falso e a captura trava; o WebKit (fase 3) não tem as flags.
 */
const MIC_MODE = process.env.E2E_FAKE_MIC ?? (process.platform === 'darwin' ? 'script' : 'flags')
const FAKE_MIC_URL = '/__microfone-falso.wav'

/** Liga o microfone falso com o .wav do cenário para todos os testes do arquivo. */
export function useFakeMic(scenarioName: string) {
  const scenario = loadScenario(scenarioName)
  if (MIC_MODE === 'flags') {
    test.use({ launchOptions: { args: fakeMicArgs(scenario) } })
    return
  }
  test.beforeEach(async ({ context }) => {
    await context.route(`**${FAKE_MIC_URL}`, (route) =>
      route.fulfill({ path: audioPath(scenario), contentType: 'audio/wav' }),
    )
    await context.addInitScript((url) => {
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (!constraints?.audio) return original(constraints)
        const ctx = new AudioContext()
        const data = await (await fetch(url)).arrayBuffer()
        const source = ctx.createBufferSource()
        source.buffer = await ctx.decodeAudioData(data)
        source.loop = true // como o Chromium faz com o arquivo de captura falsa
        const dest = ctx.createMediaStreamDestination()
        source.connect(dest)
        source.start()
        return dest.stream
      }
    }, FAKE_MIC_URL)
  })
}

export async function login(page: Page, who: 'a' | 'b') {
  const s = readSeed()
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(s.users[who].email)
  await page.getByLabel('Senha').fill(s.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/obra$/)
}

/** Cria uma obra pela tela e devolve o id. A obra é apagada por `deleteBooks`. */
export async function createBookViaUi(page: Page, title: string): Promise<string> {
  await page.getByLabel('Nova obra').fill(title)
  await page.getByRole('button', { name: 'Criar obra' }).click()
  await expect(page).toHaveURL(/\/obra\/[0-9a-f-]{36}$/)
  return page.url().split('/').at(-1)!
}

export async function deleteBooks(ids: string[]) {
  if (ids.length) await adminClient().from('books').delete().in('id', ids)
}

/** Texto do manuscrito no editor, bloco a bloco (sem as chamadas de nota). */
export async function editorBlocks(page: Page): Promise<{ type: string; text: string }[]> {
  return page.getByTestId('manuscrito').evaluate((root) =>
    [...root.children].map((el) => ({
      type: (el as HTMLElement).dataset.type ?? el.tagName.toLowerCase(),
      text: [...el.childNodes]
        .filter((n) => !(n instanceof HTMLElement && (n.dataset.type === 'footnote' || n.classList.contains('dictation-cursor'))))
        .map((n) => n.textContent ?? '')
        .join(''),
    })),
  )
}

/** Espera o ditado começar de fato (microfone aberto e sessão pronta). */
export async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Gravar' }).click()
  await expect(page.getByTestId('status')).toHaveText('gravando')
}

export async function stopRecording(page: Page) {
  await page.getByRole('button', { name: 'Pausar' }).click()
  await expect(page.getByTestId('status')).toHaveText('parado', { timeout: 20_000 })
}

/** Aplica operações no manuscrito pela API (para preparar uma obra com conteúdo). */
export async function seedBlocks(bookId: string, blocks: { id: string; parent_id: string | null; type: string; position: string; content: string; attrs?: Record<string, unknown> }[]) {
  const { error } = await adminClient().from('blocks').insert(blocks.map((b) => ({ ...b, book_id: bookId, attrs: b.attrs ?? {} })))
  if (error) throw new Error(`falha ao preparar blocos: ${error.message}`)
}

/** Exporta pela tela de exportações, baixa o .docx e devolve o que o verificador leu nele. */
export async function exportWord(page: Page, bookId: string, opts: { chapter?: string; final?: boolean } = {}): Promise<DocxReport> {
  await page.goto(`/obra/${bookId}/exportacoes`)
  if (opts.chapter) await page.getByLabel('Exportar').selectOption({ label: `Capítulo: ${opts.chapter}` })
  if (opts.final) await page.getByLabel(/Versão final/).check()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar Word' }).click()
  const download = await downloading
  const file = join(mkdtempSync(join(tmpdir(), 'e2e-word-')), 'livro.docx')
  await download.saveAs(file)
  return verifyDocx(file)
}

/** Parágrafos com texto do Word (as quebras de seção são parágrafos vazios). */
export function wordParagraphs(r: DocxReport) {
  return r.paragraphs.filter((p) => p.text.trim())
}

/** Abre uma obra nova com o cenário de áudio escolhido no simulador. */
export async function newBookWithScenario(page: Page, scenario: string, created: string[], who: 'a' | 'b' | null = 'a') {
  if (who) await login(page, who)
  else await page.goto('/obra')
  const bookId = await createBookViaUi(page, `${scenario} ${Date.now()}`)
  created.push(bookId)
  const { mockSttControl } = await import('@livro/test-kit')
  await mockSttControl(STT_CONTROL_URL).useScenario(scenario, bookId)
  return bookId
}
