import { createClient } from '@supabase/supabase-js'
import type { Bucket, RemoteObject } from './storage.ts'

/** Bucket do Supabase Storage acessado com a chave secreta (ignora RLS). */
export function supabaseBucket(url: string, secretKey: string, name: string): Bucket {
  const storage = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
    .storage.from(name)

  async function listDir(prefix: string): Promise<RemoteObject[]> {
    const out: RemoteObject[] = []
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await storage.list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`falha ao listar ${name}/${prefix}: ${error.message}`)
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name
        if (item.id === null) {
          out.push(...(await listDir(path))) // pasta
        } else {
          const meta = (item.metadata ?? {}) as { size?: number; eTag?: string; mimetype?: string }
          out.push({
            path,
            size: meta.size ?? 0,
            etag: meta.eTag ?? `${item.updated_at}:${meta.size}`,
            contentType: meta.mimetype ?? 'application/octet-stream',
          })
        }
      }
      if (data.length < 1000) return out
    }
  }

  return {
    list: () => listDir(''),
    async download(path) {
      const { data, error } = await storage.download(path)
      if (error) throw new Error(`falha ao baixar ${path}: ${error.message}`)
      return Buffer.from(await data.arrayBuffer())
    },
    async upload(path, data, contentType) {
      const { error } = await storage.upload(path, data, { contentType, upsert: true })
      if (error) throw new Error(`falha ao enviar ${path}: ${error.message}`)
    },
  }
}
