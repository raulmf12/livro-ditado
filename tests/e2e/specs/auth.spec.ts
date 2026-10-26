// F0.05 — login, logout e redirecionamento sem sessão.
import { expect, test } from '@playwright/test'
import { login, readSeed } from '../helpers.ts'

test('abrir /obra sem sessão leva ao login', async ({ page }) => {
  await page.goto('/obra')
  await expect(page).toHaveURL(/\/login\?next=%2Fobra$/)
})

test('senha errada mostra aviso e não entra', async ({ page }) => {
  const s = readSeed()
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(s.users.a.email)
  await page.getByLabel('Senha').fill('senha-errada')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByTestId('aviso')).toHaveText('E-mail ou senha incorretos.')
  await expect(page).toHaveURL(/\/login/)
})

test('login e logout', async ({ page }) => {
  const s = readSeed()
  await login(page, 'a')
  await expect(page.getByTestId('usuario')).toHaveText(s.users.a.email)
  await expect(page.getByRole('link', { name: 'Obra semente A' })).toBeVisible()

  await page.getByRole('button', { name: 'Sair' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goto('/obra')
  await expect(page).toHaveURL(/\/login\?next=/)
})

test('depois do login volta à página pedida', async ({ page }) => {
  const s = readSeed()
  await page.goto(`/obra/${s.users.a.bookId}`)
  await expect(page).toHaveURL(/\/login\?next=/)
  await page.getByLabel('E-mail').fill(s.users.a.email)
  await page.getByLabel('Senha').fill(s.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(new RegExp(`/obra/${s.users.a.bookId}$`))
  await expect(page.getByRole('heading', { name: 'Obra semente A' })).toBeVisible()
})
