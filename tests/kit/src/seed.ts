import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { audioPath, loadScenario } from './scenarios.ts'
import { adminClient } from './supabase.ts'

/**
 * Banco semente dos testes. Idempotente: pode rodar a cada execução da suíte.
 *
 * Fase 0: dois autores (A e B), uma obra para cada e um trecho de áudio na
 * obra de A. A base jurídica (CF, Código Civil, Estatuto da Terra, súmulas e
 * acórdãos) entra junto com as tabelas dela, nas fases 2 e 3.
 */
export const TEST_USERS = {
  a: { email: 'autor-a@example.com', name: 'Autor A (teste)', book: 'Obra semente A' },
  b: { email: 'autor-b@example.com', name: 'Autor B (teste)', book: 'Obra semente B' },
} as const

export interface SeedResult {
  password: string
  users: Record<keyof typeof TEST_USERS, { id: string; email: string; bookId: string }>
  /** Objeto no bucket "audio" pertencente à obra de A. */
  audioObject: string
}

export async function seed(password = process.env.E2E_PASSWORD): Promise<SeedResult> {
  if (!password) throw new Error('E2E_PASSWORD não definida')
  const admin = adminClient()

  const users = {} as SeedResult['users']
  for (const [key, u] of Object.entries(TEST_USERS) as [keyof typeof TEST_USERS, (typeof TEST_USERS)['a']][]) {
    const id = await ensureUser(admin, u.email, password, u.name)
    const bookId = await ensureBook(admin, id, u.book)
    users[key] = { id, email: u.email, bookId }
  }

  const audioObject = `${users.a.bookId}/semente/0.wav`
  const wav = readFileSync(audioPath(loadScenario('ditado-simples')))
  const { error } = await admin.storage
    .from('audio')
    .upload(audioObject, wav, { contentType: 'audio/wav', upsert: true })
  if (error) throw new Error(`falha ao enviar áudio semente: ${error.message}`)

  return { password, users, audioObject }
}

async function ensureUser(admin: SupabaseClient, email: string, password: string, name: string) {
  const existing = await findUserByEmail(admin, email)
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing, { password })
    if (error) throw new Error(`falha ao atualizar ${email}: ${error.message}`)
    return existing
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: name },
  })
  if (error) throw new Error(`falha ao criar ${email}: ${error.message}`)
  return data.user.id
}

export async function findUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`falha ao listar usuários: ${error.message}`)
    const found = data.users.find((u) => u.email === email)
    if (found) return found.id
    if (data.users.length < 200) return null
  }
}

async function ensureBook(admin: SupabaseClient, ownerId: string, title: string) {
  const { data: found, error: findError } = await admin
    .from('books')
    .select('id')
    .eq('owner_id', ownerId)
    .eq('title', title)
    .limit(1)
    .maybeSingle()
  if (findError) throw new Error(`falha ao buscar obra: ${findError.message}`)
  if (found) return found.id as string
  const { data, error } = await admin.from('books').insert({ owner_id: ownerId, title }).select('id').single()
  if (error) throw new Error(`falha ao criar obra: ${error.message}`)
  return data.id as string
}
