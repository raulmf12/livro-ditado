import type { CommandRecord, MBlock, Op, SpellingRule, TextChange } from '@livro/dictation'
import type { TranscriptKind } from '@livro/shared'
import type { LatencySummary } from './latency.ts'

export interface AuthUser {
  userId: string
  token: string
}

export interface BookInfo {
  id: string
  settings: BookSettings
}

/** Preferências da obra guardadas em books.settings. */
export interface BookSettings {
  wake_word?: string
  remove_hesitations?: boolean
  auto_export?: boolean
}

/** Acesso ao banco em nome de um usuário (sujeito às políticas RLS). */
export interface BookStore {
  findBook(bookId: string): Promise<BookInfo | null>
  loadBlocks(bookId: string): Promise<MBlock[]>
  /** Mudanças feitas por outros (editor, outra aba) desde a versão `afterId` do histórico. */
  changesSince(bookId: string, afterId: number): Promise<{ upserts: MBlock[]; deletes: string[]; lastId: number }>
  latestVersionId(bookId: string): Promise<number>
  loadSpellingRules(bookId: string): Promise<SpellingRule[]>
  loadGlossary(bookId: string, chapterId: string | null): Promise<string[]>
  startSession(input: { bookId: string; device?: string; sttProvider: string }): Promise<string>
  applyOps(bookId: string, ops: Op[]): Promise<void>
  saveTranscript(input: {
    sessionId: string
    bookId: string
    kind: TranscriptKind
    text: string
    startMs: number
    endMs: number
    payload?: unknown
  }): Promise<void>
  saveCommand(input: { sessionId: string; bookId: string } & CommandRecord): Promise<void>
  saveTextChanges(input: { sessionId: string; bookId: string; blockId: string; changes: TextChange[] }): Promise<void>
  saveAudioSegment(input: {
    sessionId: string
    bookId: string
    seq: number
    wav: Buffer
    startMs: number
    durationMs: number
    blockId: string | null
    charStart: number | null
    charEnd: number | null
    isCommand: boolean
  }): Promise<void>
  updateUsage(sessionId: string, audioMs: number): Promise<void>
  endSession(sessionId: string, status: 'ended' | 'interrupted', latency: LatencySummary, audioMs: number): Promise<void>
}
