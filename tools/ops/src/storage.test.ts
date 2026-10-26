import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { mirrorBucket, restoreBucket, sha, verifyBucket, type Bucket } from './storage.ts'

function fakeBucket() {
  const files = new Map<string, { data: Buffer; etag: number }>()
  let downloads = 0
  let etag = 0
  const bucket: Bucket = {
    async list() {
      return [...files].map(([path, f]) => ({ path, size: f.data.length, etag: String(f.etag), contentType: 'audio/wav' }))
    },
    async download(path) {
      downloads++
      const f = files.get(path)
      if (!f) throw new Error('not found')
      return f.data
    },
    async upload(path, data) {
      files.set(path, { data, etag: ++etag })
    },
  }
  return { bucket, files, downloads: () => downloads, put: (p: string, s: string) => bucket.upload(p, Buffer.from(s), 'audio/wav') }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ops-'))
})

describe('espelho do Storage', () => {
  it('não baixa de novo o que não mudou', async () => {
    const src = fakeBucket()
    await src.put('obra/1.wav', 'áudio 1')
    await mirrorBucket(src.bucket, dir)
    await mirrorBucket(src.bucket, dir)
    expect(src.downloads()).toBe(1)
  })

  it('guarda a versão anterior quando um áudio é sobrescrito', async () => {
    const src = fakeBucket()
    await src.put('obra/1.wav', 'versão 1')
    const antes = await mirrorBucket(src.bucket, dir)
    await src.put('obra/1.wav', 'versão 2')
    const depois = await mirrorBucket(src.bucket, dir)

    expect(antes[0]!.sha256).toBe(sha(Buffer.from('versão 1')))
    expect(depois[0]!.sha256).toBe(sha(Buffer.from('versão 2')))
    expect(readdirSync(join(dir, 'blobs')).sort()).toEqual([antes[0]!.sha256, depois[0]!.sha256].sort())

    // o snapshot antigo continua restaurável
    const dst = fakeBucket()
    await restoreBucket(dst.bucket, dir, antes)
    expect(dst.files.get('obra/1.wav')!.data.toString()).toBe('versão 1')
  })

  it('verificação aponta áudio ausente ou diferente', async () => {
    const src = fakeBucket()
    await src.put('a.wav', 'a')
    await src.put('b.wav', 'b')
    const snap = await mirrorBucket(src.bucket, dir)
    const dst = fakeBucket()
    await dst.put('a.wav', 'a')
    await dst.put('b.wav', 'outro')
    expect(await verifyBucket(dst.bucket, snap)).toEqual(['b.wav: conteúdo diferente'])
    expect(await verifyBucket(fakeBucket().bucket, snap)).toHaveLength(2)
  })
})
