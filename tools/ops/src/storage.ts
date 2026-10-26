import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** O mínimo do Storage que o backup usa; implementado pelo Supabase e por um falso nos testes. */
export interface Bucket {
  /** Lista todos os objetos do bucket (recursivo). */
  list(): Promise<RemoteObject[]>
  download(path: string): Promise<Buffer>
  upload(path: string, data: Buffer, contentType: string): Promise<void>
}

export interface RemoteObject {
  path: string
  size: number
  /** Muda quando o conteúdo muda. */
  etag: string
  contentType: string
}

export interface SnapshotObject {
  path: string
  size: number
  sha256: string
  contentType: string
}

interface IndexEntry {
  etag: string
  sha256: string
}

/**
 * Espelho versionado do Storage. Cada conteúdo distinto vira um arquivo
 * imutável em blobs/<sha256>; o snapshot guarda caminho → sha256. Assim,
 * sobrescrever um áudio no Storage nunca apaga a versão anterior do backup, e
 * cada snapshot continua restaurável. O índice evita baixar de novo o que não mudou.
 */
export async function mirrorBucket(bucket: Bucket, storageDir: string): Promise<SnapshotObject[]> {
  const blobsDir = join(storageDir, 'blobs')
  const indexFile = join(storageDir, 'index.json')
  mkdirSync(blobsDir, { recursive: true })
  const index: Record<string, IndexEntry> = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {}

  const snapshot: SnapshotObject[] = []
  for (const obj of await bucket.list()) {
    const known = index[obj.path]
    let sha256 = known?.etag === obj.etag && existsSync(join(blobsDir, known.sha256)) ? known.sha256 : null
    if (!sha256) {
      const data = await bucket.download(obj.path)
      sha256 = sha(data)
      const blob = join(blobsDir, sha256)
      if (!existsSync(blob)) writeAtomic(blob, data)
      index[obj.path] = { etag: obj.etag, sha256 }
    }
    snapshot.push({ path: obj.path, size: obj.size, sha256, contentType: obj.contentType })
  }
  writeAtomic(indexFile, Buffer.from(JSON.stringify(index, null, 2)))
  return snapshot
}

/** Sobe os objetos de um snapshot para o bucket de destino, conferindo o conteúdo. */
export async function restoreBucket(bucket: Bucket, storageDir: string, objects: SnapshotObject[]) {
  for (const obj of objects) {
    const data = readFileSync(join(storageDir, 'blobs', obj.sha256))
    if (sha(data) !== obj.sha256) throw new Error(`backup corrompido: ${obj.path} (${obj.sha256})`)
    await bucket.upload(obj.path, data, obj.contentType)
  }
}

/** Baixa cada objeto do destino e compara com o snapshot. Devolve as diferenças. */
export async function verifyBucket(bucket: Bucket, objects: SnapshotObject[]): Promise<string[]> {
  const problems: string[] = []
  for (const obj of objects) {
    try {
      const got = sha(await bucket.download(obj.path))
      if (got !== obj.sha256) problems.push(`${obj.path}: conteúdo diferente`)
    } catch (err) {
      problems.push(`${obj.path}: ${(err as Error).message}`)
    }
  }
  return problems
}

export function sha(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function writeAtomic(file: string, data: Buffer) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}
