// Cria um usuário real (o autor, ou um admin). Não há cadastro público pela tela.
// Uso: pnpm user:create <email> [--admin]   (a senha é pedida no terminal)
import { createInterface } from 'node:readline/promises'
import { adminClient } from '../src/supabase.ts'

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith('--'))
const isAdmin = args.includes('--admin')
if (!email) {
  console.error('uso: pnpm user:create <email> [--admin]')
  process.exit(2)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })
const password = await rl.question('Senha (mínimo 8 caracteres): ')
rl.close()
if (password.length < 8) {
  console.error('senha curta demais')
  process.exit(2)
}

const admin = adminClient()
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (error) {
  console.error(`falha ao criar usuário: ${error.message}`)
  process.exit(1)
}
if (isAdmin) {
  const { error: roleError } = await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id)
  if (roleError) {
    console.error(`usuário criado, mas falhou ao marcar como admin: ${roleError.message}`)
    process.exit(1)
  }
}
console.log(`usuário criado: ${email} (${isAdmin ? 'admin' : 'autor'})`)
