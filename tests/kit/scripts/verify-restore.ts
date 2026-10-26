// F0.08 — Depois de restaurar um backup: o autor entra com a senha de antes,
// abre a obra, encontra o texto e consegue baixar (tocar) o áudio do trecho.
// Uso: tsx scripts/verify-restore.ts   (variáveis do Supabase de destino + E2E_PASSWORD)
import { TEST_USERS } from '../src/seed.ts'
import { signedInClient } from '../src/supabase.ts'

const EXPECTED_TEXT = process.argv[2] ?? 'Texto do teste de restauração.'
const password = process.env.E2E_PASSWORD
if (!password) throw new Error('E2E_PASSWORD não definida')

const { client } = await signedInClient(TEST_USERS.a.email, password)

const { data: book, error } = await client.from('books').select('id, title').eq('title', TEST_USERS.a.book).single()
if (error || !book) throw new Error(`obra não encontrada após restaurar: ${error?.message}`)

const { data: blocks } = await client.from('blocks').select('content').eq('book_id', book.id)
if (!blocks?.some((b) => b.content === EXPECTED_TEXT)) throw new Error('texto da obra não voltou na restauração')

const { data: audio, error: audioError } = await client.storage.from('audio').download(`${book.id}/semente/0.wav`)
if (audioError || !audio) throw new Error(`áudio não voltou: ${audioError?.message}`)
const header = Buffer.from(await audio.slice(0, 4).arrayBuffer()).toString()
if (header !== 'RIFF') throw new Error('o arquivo restaurado não é um WAV')

console.log(`restauração verificada: login, obra "${book.title}", texto e áudio (${audio.size} bytes)`)
