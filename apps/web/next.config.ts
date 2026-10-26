import { existsSync } from 'node:fs'
import path from 'node:path'
import type { NextConfig } from 'next'

// O .env fica na raiz do monorepo, compartilhado com o servidor de sessão e os testes.
// Variáveis já definidas no ambiente (CI, Playwright) têm precedência.
const root = path.resolve(process.cwd(), '../..')
const envFile = path.join(root, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@livro/shared'],
  turbopack: { root },
}

export default config
