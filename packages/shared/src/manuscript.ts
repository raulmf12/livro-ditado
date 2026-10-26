import { z } from 'zod'

/** Tipos de bloco do manuscrito, iguais ao enum public.block_type do banco. */
export const BlockType = z.enum(['chapter', 'section', 'subsection', 'paragraph', 'quote', 'note'])
export type BlockType = z.infer<typeof BlockType>

/** Quem escreveu o bloco: o autor (ditado/digitado) ou a IA (pesquisa). */
export const BlockOrigin = z.enum(['author', 'ai'])
export type BlockOrigin = z.infer<typeof BlockOrigin>

/** Texto do autor é sempre "final"; texto da IA nasce "pending" e só sai daí por aprovação. */
export const BlockStatus = z.enum(['final', 'pending', 'approved', 'rejected'])
export type BlockStatus = z.infer<typeof BlockStatus>

export const Block = z
  .object({
    id: z.uuid(),
    book_id: z.uuid(),
    parent_id: z.uuid().nullable(),
    type: BlockType,
    position: z.string().min(1),
    content: z.string(),
    attrs: z.record(z.string(), z.unknown()),
    origin: BlockOrigin,
    status: BlockStatus,
    audio_segment_id: z.uuid().nullable(),
  })
  .refine((b) => (b.origin === 'author' ? b.status === 'final' : b.status !== 'final'), {
    message: 'texto do autor é final; texto da IA começa pendente',
    path: ['status'],
  })
export type Block = z.infer<typeof Block>

export const Book = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  title: z.string().trim().min(1),
  settings: z.record(z.string(), z.unknown()),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Book = z.infer<typeof Book>

export const AppRole = z.enum(['autor', 'admin'])
export type AppRole = z.infer<typeof AppRole>
