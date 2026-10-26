import { seed } from './seed.ts'

const result = await seed()
console.log('banco semente pronto:')
for (const [key, u] of Object.entries(result.users)) console.log(`  autor ${key}: ${u.email}  obra ${u.bookId}`)
console.log(`  áudio: audio/${result.audioObject}`)
