// Baixa o áudio do autor (e as transcrições de referência) do bucket privado
// "benchmark" para uma pasta local. Usa a chave secreta: só para CI e operação.
//   tsx scripts/fetch-benchmark.ts <prefixo-no-bucket> <pasta-destino>
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const [prefix, dest] = process.argv.slice(2)
if (!prefix || !dest) {
  console.error('uso: fetch-benchmark <prefixo-no-bucket> <pasta-destino>')
  process.exit(2)
}
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('SUPABASE_URL e SUPABASE_SECRET_KEY são necessárias')

const bucket = createClient(url, key, { auth: { persistSession: false } }).storage.from('benchmark')
const { data, error } = await bucket.list(prefix, { limit: 1000 })
if (error) throw error
mkdirSync(dest, { recursive: true })
let n = 0
for (const item of data ?? []) {
  if (!item.id) continue
  const { data: file, error: e } = await bucket.download(`${prefix}/${item.name}`)
  if (e || !file) throw e ?? new Error(`falha ao baixar ${item.name}`)
  writeFileSync(join(dest, item.name), Buffer.from(await file.arrayBuffer()))
  n++
}
console.log(`${n} arquivos baixados para ${dest}`)
