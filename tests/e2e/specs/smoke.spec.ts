// F0.01 — smoke: a tela de login abre.
import { expect, test } from '@playwright/test'

test('a tela de login abre', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Ditado do Livro' })).toBeVisible()
  await expect(page.getByLabel('E-mail')).toBeVisible()
  await expect(page.getByLabel('Senha')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeEnabled()
})
