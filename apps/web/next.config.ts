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
  outputFileTracingRoot: root,
  // A imagem Docker usa a saída "standalone" (só o necessário para rodar).
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
}

export default config
