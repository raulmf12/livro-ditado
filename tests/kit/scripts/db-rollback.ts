// Reverte a última migração no projeto vinculado (supabase link).
// Esvazia o bucket de áudio pela API do Storage (o Supabase não deixa apagar
// objetos por SQL), roda o .down.sql e marca a migração como revertida.
// Uso: pnpm db:rollback --yes
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { adminClient } from '../src/supabase.ts'

if (!process.argv.includes('--yes')) {
  console.error('Isto apaga as tabelas e o áudio do projeto vinculado. Rode com --yes para confirmar.')
  process.exit(2)
}

const root = fileURLToPath(new URL('../../../', import.meta.url))
const migrations = readdirSync(`${root}supabase/migrations`).filter((f) => f.endsWith('.sql')).sort()
const last = migrations.at(-1)
if (!last) throw new Error('nenhuma migração encontrada')
const version = last.split('_')[0]!
const down = `${root}supabase/rollbacks/${last.replace(/\.sql$/, '.down.sql')}`

const admin = adminClient()
await emptyBucket('audio')
const { error } = await admin.storage.deleteBucket('audio')
if (error && !/not found/i.test(error.message)) throw new Error(`falha ao remover bucket: ${error.message}`)

execFileSync('supabase', ['db', 'query', '--linked', '-f', down], { cwd: root, stdio: 'inherit' })
execFileSync('supabase', ['migration', 'repair', '--linked', '--status', 'reverted', version], {
  cwd: root,
  stdio: 'inherit',
})
console.log(`migração ${last} revertida`)

async function emptyBucket(bucket: string, prefix = ''): Promise<void> {
  const { data, error: listError } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (listError) {
    if (/not found/i.test(listError.message)) return
    throw new Error(`falha ao listar ${bucket}/${prefix}: ${listError.message}`)
  }
  const files = data.filter((o) => o.id).map((o) => `${prefix}${o.name}`)
  const folders = data.filter((o) => !o.id).map((o) => `${prefix}${o.name}/`)
  for (const folder of folders) await emptyBucket(bucket, folder)
  if (files.length) {
    const { error: rmError } = await admin.storage.from(bucket).remove(files)
    if (rmError) throw new Error(`falha ao apagar áudio: ${rmError.message}`)
  }
}
