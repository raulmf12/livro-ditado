// Peças de teste do servidor de sessão (não entram em produção).
import { Manuscript, type MBlock, type Op } from '@livro/dictation'
import type { BookStore } from './store.ts'

export const BOOK_ID = '11111111-1111-4111-8111-111111111111'

/** Banco em memória com o mesmo contrato do Supabase. */
export function memoryStore() {
  const m = new Manuscript()
  const versions: { id: number; action: string; row: MBlock }[] = []
  const state = {
    sessions: new Map<string, { status: string; audioMs: number; latency: unknown }>(),
    transcripts: [] as string[],
    commands: [] as { raw: string; status: string; activation: string }[],
    segments: [] as { blockId: string | null; isCommand: boolean; bytes: number; seq: number }[],
    textChanges: [] as unknown[],
    glossary: ['usucapião'],
  }
  const store: BookStore = {
    async findBook(bookId) {
      return bookId === BOOK_ID ? { id: bookId, settings: {} } : null
    },
    async loadBlocks() {
      return m.all()
    },
    async changesSince(_b, afterId) {
      const later = versions.filter((v) => v.id > afterId)
      return {
        upserts: later.filter((v) => v.action !== 'delete').map((v) => v.row),
        deletes: later.filter((v) => v.action === 'delete').map((v) => v.row.id),
        lastId: later.at(-1)?.id ?? afterId,
      }
    },
    async latestVersionId() {
      return versions.at(-1)?.id ?? 0
    },
    async loadSpellingRules() {
      return [{ id: 'r1', spoken: 'rex', written: 'REsp' }]
    },
    async loadGlossary() {
      return state.glossary
    },
    async startSession() {
      const id = crypto.randomUUID()
      state.sessions.set(id, { status: 'active', audioMs: 0, latency: null })
      return id
    },
    async applyOps(_b, ops: Op[]) {
      m.applyAll(ops)
      for (const op of ops) {
        const row = op.op === 'insert' || op.op === 'delete' ? op.block : m.get(op.id)!
        versions.push({ id: versions.length + 1, action: op.op, row: structuredClone(row) })
      }
    },
    async saveTranscript({ text }) {
      state.transcripts.push(text)
    },
    async saveCommand(c) {
      state.commands.push(c)
    },
    async saveTextChanges(c) {
      state.textChanges.push(c)
    },
    async saveAudioSegment(s) {
      state.segments.push({ blockId: s.blockId, isCommand: s.isCommand, bytes: s.wav.length, seq: s.seq })
    },
    async updateUsage(id, audioMs) {
      state.sessions.get(id)!.audioMs = audioMs
    },
    async endSession(id, status, latency, audioMs) {
      state.sessions.set(id, { status, latency, audioMs })
    },
  }
  return { store, m, state }
}

