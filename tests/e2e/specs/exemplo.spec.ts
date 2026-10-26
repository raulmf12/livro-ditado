// F0.07 / F1.01 / F1.06 — Microfone falso (.wav do cenário) → navegador →
// servidor de sessão → simulador de STT → manuscrito na tela e no banco.
import { expect, test } from '@playwright/test'
import { adminClient, loadScenario, mockSttControl, referenceTranscript } from '@livro/test-kit'
import { STT_CONTROL_URL, createBookViaUi, deleteBooks, editorBlocks, login, startRecording, stopRecording, useFakeMic } from '../helpers.ts'

useFakeMic('ditado-simples')

const created: string[] = []
test.afterAll(() => deleteBooks(created))

test('ditado simples: provisório em cinza, finais no manuscrito e no banco', { tag: '@local' }, async ({ page }) => {
  const scenario = loadScenario('ditado-simples')
  const reference = referenceTranscript(scenario)
  const stt = mockSttControl(STT_CONTROL_URL)

  await login(page, 'a')
  const bookId = await createBookViaUi(page, `Exemplo E2E ${Date.now()}`)
  created.push(bookId)
  await stt.useScenario(scenario.name, bookId)

  await startRecording(page)
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible()

  // o medidor reage ao áudio do microfone falso (F1.01)
  await expect.poll(async () => Number(await page.getByTestId('medidor').getAttribute('aria-valuenow'))).toBeGreaterThan(0)

  // provisório em cinza, fora do manuscrito (F1.06)
  await expect(page.getByTestId('provisorio')).toHaveCSS('color', 'rgb(143, 138, 128)')
  await expect.poll(() => editorBlocks(page), { timeout: 15_000 }).toEqual([{ type: 'paragraph', text: reference.join(' ') }])

  await stopRecording(page)
  await expect(page.getByTestId('aviso')).toHaveCount(0)

  // depois de recarregar, só o texto final está no manuscrito
  await page.reload()
  await expect.poll(() => editorBlocks(page)).toEqual([{ type: 'paragraph', text: reference.join(' ') }])

  // banco: só os finais foram gravados, idênticos à transcrição de referência
  const db = adminClient()
  const { data: events } = await db.from('transcript_events').select('kind, text').eq('book_id', bookId).order('id')
  expect(events).toEqual(reference.map((text) => ({ kind: 'final', text })))

  const { data: sessions } = await db
    .from('dictation_sessions')
    .select('status, stt_provider, latency_samples, latency_p50_ms, latency_p95_ms, stt_audio_ms')
    .eq('book_id', bookId)
  expect(sessions).toMatchObject([{ status: 'ended', stt_provider: 'mock', latency_samples: reference.length }])
  const [session] = sessions!
  expect(session!.latency_p95_ms).toBeLessThan(1500)
  expect(session!.stt_audio_ms).toBeGreaterThan(4000)

  const req = (await stt.requests()).find((r) => r.bookId === bookId)
  expect(req?.language).toBe('pt-BR')
})
