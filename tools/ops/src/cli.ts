// Backup e restauração (F0.08).
//
//   ops backup                       dump dos dados + espelho versionado do áudio
//   ops restore [--snapshot <nome>]  carrega um snapshot num projeto vazio já migrado
//   ops verify  [--snapshot <nome>]  confere contagens e o conteúdo de cada áudio
//
// Variáveis: DB_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, BACKUP_DIR (padrão /backups),
// RETENTION_DAYS (padrão 30). Na restauração elas apontam para o DESTINO.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dumpData, loadData, rowCounts } from './pg.ts'
import { mirrorBucket, restoreBucket, verifyBucket, type SnapshotObject } from './storage.ts'
import { supabaseBucket } from './supabase-bucket.ts'

const AUDIO_BUCKET = 'audio'

interface Manifest {
  createdAt: string
  source: string
  db: { file: string; sha256: string; rowCounts: Record<string, number> }
  storage: { bucket: string; objects: SnapshotObject[] }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`variável de ambiente ${name} não definida`)
  return v
}

const backupDir = () => env('BACKUP_DIR', '/backups')
const snapshotsDir = () => join(backupDir(), 'db')
const storageDir = () => join(backupDir(), 'storage')
const bucket = () => supabaseBucket(env('SUPABASE_URL'), env('SUPABASE_SECRET_KEY'), AUDIO_BUCKET)

async function backup() {
  const name = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(snapshotsDir(), name)
  mkdirSync(dir, { recursive: true })

  const dbUrl = env('DB_URL')
  // contagens antes do dump: se algo for gravado no meio, o dump terá pelo menos isso
  const counts = await rowCounts(dbUrl)
  await dumpData(dbUrl, join(dir, 'data.sql'))
  const objects = await mirrorBucket(bucket(), storageDir())

  const manifest: Manifest = {
    createdAt: new Date().toISOString(),
    source: new URL(env('SUPABASE_URL')).host,
    db: { file: 'data.sql', sha256: fileSha(join(dir, 'data.sql')), rowCounts: counts },
    storage: { bucket: AUDIO_BUCKET, objects },
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  prune(Number(env('RETENTION_DAYS', '30')))
  console.log(`backup ${name}: ${Object.values(counts).reduce((a, b) => a + b, 0)} linhas, ${objects.length} áudios`)
}

async function restore(snapshot: string) {
  const { dir, manifest } = loadSnapshot(snapshot)
  const dbUrl = env('DB_URL')
  if (fileSha(join(dir, manifest.db.file)) !== manifest.db.sha256) throw new Error('dump corrompido (sha256 não confere)')

  const current = await rowCounts(dbUrl)
  const occupied = Object.entries(current).filter(([, n]) => n > 0)
  if (occupied.length && !process.argv.includes('--force')) {
    throw new Error(`o destino não está vazio (${occupied.map(([t, n]) => `${t}=${n}`).join(', ')}); use --force para carregar mesmo assim`)
  }
  await loadData(dbUrl, join(dir, manifest.db.file))
  await restoreBucket(bucket(), storageDir(), manifest.storage.objects)
  console.log(`restaurado ${snapshot}: ${manifest.storage.objects.length} áudios`)
  await verify(snapshot)
}

async function verify(snapshot: string) {
  const { manifest } = loadSnapshot(snapshot)
  const counts = await rowCounts(env('DB_URL'))
  const problems = Object.entries(manifest.db.rowCounts)
    .filter(([t, n]) => counts[t] !== n)
    .map(([t, n]) => `${t}: esperado ${n}, encontrado ${counts[t] ?? 'tabela ausente'}`)
  problems.push(...(await verifyBucket(bucket(), manifest.storage.objects)))
  if (problems.length) {
    console.error(`restauração NÃO confere:\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`restauração confere: ${Object.keys(manifest.db.rowCounts).length} tabelas e ${manifest.storage.objects.length} áudios`)
}

function loadSnapshot(name: string) {
  const resolved = name === 'latest' ? listSnapshots().at(-1) : name
  if (!resolved) throw new Error(`nenhum snapshot em ${snapshotsDir()}`)
  const dir = join(snapshotsDir(), resolved)
  return { dir, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest }
}

function listSnapshots(): string[] {
  if (!existsSync(snapshotsDir())) return []
  return readdirSync(snapshotsDir())
    .filter((d) => existsSync(join(snapshotsDir(), d, 'manifest.json')))
    .sort()
}

/** Apaga dumps antigos. Os áudios (blobs) ficam para sempre. */
function prune(days: number) {
  const limit = Date.now() - days * 86_400_000
  const all = listSnapshots()
  for (const name of all.slice(0, -1)) {
    const { manifest } = loadSnapshot(name)
    if (Date.parse(manifest.createdAt) < limit) rmSync(join(snapshotsDir(), name), { recursive: true })
  }
}

function fileSha(file: string) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const [command] = process.argv.slice(2)
const snapshotArg = process.argv.indexOf('--snapshot')
const snapshot = snapshotArg > 0 ? process.argv[snapshotArg + 1]! : 'latest'

switch (command) {
  case 'backup':
    await backup()
    break
  case 'restore':
    await restore(snapshot)
    break
  case 'verify':
    await verify(snapshot)
    break
  default:
    console.error('uso: ops backup | restore [--snapshot <nome>] [--force] | verify [--snapshot <nome>]')
    process.exit(2)
}
