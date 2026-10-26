import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { audioPath, fakeMicArgs, loadScenario } from '@livro/test-kit/scenarios'
import type { SeedResult } from '@livro/test-kit/seed'
import { adminClient } from '@livro/test-kit'

export const SEED_FILE = new URL('./.auth/seed.json', import.meta.url)

export function readSeed(): SeedResult {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as SeedResult
}

export const SESSION_WS_URL = process.env.NEXT_PUBLIC_SESSION_WS_URL ?? 'ws://localhost:4001/ws'
export const STT_CONTROL_URL = process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010'
export const SENTRY_CONTROL_URL = `http://localhost:${process.env.MOCK_SENTRY_PORT ?? '4040'}`

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
