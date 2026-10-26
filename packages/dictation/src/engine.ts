import { describeCommand, parseCommand, stripWakeWord, type Command } from './commands.ts'
import { TEXT_TYPES, invertAll, type MBlock, type Manuscript, type Op } from './manuscript.ts'
import { applySpellingRules, joinText, lastSentenceStart, removeHesitations, type SpellingRule, type TextChange } from './text.ts'

export interface EngineSettings {
  /** Palavra que ativa um comando no começo do trecho (padrão "Atena"). */
  wakeWord: string
  /** Remove "hã", "é…" etc. (F1.09). Desligado por padrão. */
  removeHesitations: boolean
  /** Regras de grafia aprovadas pelo autor (F1.08). */
  spellingRules: SpellingRule[]
  /** Pausa que encerra um título sem "fim" (F1.14). */
  commandPauseMs: number
}

export const DEFAULT_SETTINGS: EngineSettings = {
  wakeWord: 'Atena',
  removeHesitations: false,
  spellingRules: [],
  commandPauseMs: 2_000,
}

/** Onde o próximo trecho ditado entra (F1.17). offset null = fim do bloco. */
export interface DictationCursor {
  blockId: string | null
  offset: number | null
}

export type EngineMode = 'text' | 'quote' | 'note'

/** Um resultado final do STT, com o tempo dentro do áudio da sessão. */
export interface FinalSegment {
  text: string
  startMs: number
  endMs: number
  /** Dito com a tecla (ou o pedal) de comando segurada (F1.11). */
  viaKey: boolean
}

export type Activation = 'wake_word' | 'key'

export interface CommandRecord {
  raw: string
  activation: Activation
  parsed: Command | null
  status: 'executed' | 'ignored' | 'failed'
}

export interface Feedback {
  status: 'executed' | 'pending' | 'ignored'
  label: string
}

/** Texto que entrou no manuscrito, com as trocas feitas (registro, desfazer e guarda de fidelidade). */
export interface TextInsertion {
  blockId: string
  start: number
  end: number
  /** Como veio do STT. */
  spoken: string
  /** Como foi gravado (depois de hesitações e grafia). */
  written: string
  changes: TextChange[]
}

/** Uma ação do autor: as operações a gravar numa transação e o que mostrar na tela. */
export interface Transaction {
  ops: Op[]
  feedback?: Feedback
  insertion?: TextInsertion
  command?: CommandRecord
}

interface EngineState {
  cursor: DictationCursor
  mode: EngineMode
  quoteId: string | null
  noteId: string | null
  /** Nota aberta que ainda não recebeu texto: onde ela vai ser criada. */
  noteTarget: { parentId: string; anchor: number; returnOffset: number | null } | null
  forceNewParagraph: boolean
}

interface Step {
  ops: Op[]
  before: EngineState
  after: EngineState
}

interface Pending {
  text: string
  endMs: number
  activation: Activation
}

export class DictationEngine {
  private state: EngineState
  private pending: Pending | null = null
  private undoStack: Step[] = []
  private redoStack: Step[] = []

  constructor(
    readonly manuscript: Manuscript,
    private settings: EngineSettings = DEFAULT_SETTINGS,
    cursor: DictationCursor = { blockId: null, offset: null },
    private newId: () => string = () => crypto.randomUUID(),
  ) {
    this.state = { cursor, mode: 'text', quoteId: null, noteId: null, noteTarget: null, forceNewParagraph: false }
  }

  get cursor(): DictationCursor {
    return { ...this.state.cursor }
  }

  get mode(): EngineMode {
    return this.state.mode
  }

  get hasPendingCommand(): boolean {
    return this.pending !== null
  }

  updateSettings(settings: Partial<EngineSettings>) {
    this.settings = { ...this.settings, ...settings }
  }

  /** O autor moveu o cursor de ditado (clique ou atalho). Fecha citação ou nota abertas. */
  setCursor(cursor: DictationCursor) {
    this.state = { ...this.state, cursor, mode: 'text', quoteId: null, noteId: null, noteTarget: null, forceNewParagraph: false }
  }

  handleFinal(seg: FinalSegment): Transaction[] {
    const out: Transaction[] = []
    let text = seg.text

    if (this.pending) {
      const continues = !seg.viaKey && seg.startMs - this.pending.endMs < this.settings.commandPauseMs
      if (continues && stripWakeWord(text, this.settings.wakeWord) === null) {
        const combined = `${this.pending.text} ${text}`
        const parsed = parseCommand(combined)
        if (parsed && parsed.open) {
          this.pending = { ...this.pending, text: combined, endMs: seg.endMs }
          return [{ ops: [], feedback: { status: 'pending', label: describeCommand(parsed.command) } }]
        }
        if (parsed) {
          const activation = this.pending.activation
          this.pending = null
          out.push(this.execute(parsed.command, combined.slice(0, parsed.end), activation))
          text = remainder(combined, parsed.end)
          if (!text) return out
          out.push(...this.insertText(text))
          return out
        }
      }
      out.push(...this.flush())
    }

    const activation: Activation | null = seg.viaKey ? 'key' : null
    const commandText = seg.viaKey ? (stripWakeWord(text, this.settings.wakeWord) ?? text) : stripWakeWord(text, this.settings.wakeWord)

    if (commandText === null) {
      out.push(...this.insertText(text))
      return out
    }

    const parsed = parseCommand(commandText)
    const allowed = parsed && (seg.viaKey || this.allowedInMode(parsed.command))
    if (!parsed || !allowed) {
      if (seg.viaKey) {
        out.push({
          ops: [],
          feedback: { status: 'ignored', label: 'Não entendi o comando' },
          command: { raw: text, activation: 'key', parsed: null, status: 'ignored' },
        })
        return out
      }
      // palavra de ativação sem comando reconhecido: o texto fica, nada se perde (F1.15)
      const inserted = this.insertText(text)
      if (inserted[0]) {
        inserted[0].feedback = { status: 'ignored', label: 'Comando não reconhecido; o texto foi mantido' }
        inserted[0].command = { raw: text, activation: 'wake_word', parsed: null, status: 'ignored' }
      }
      out.push(...inserted)
      return out
    }

    if (parsed.command.kind === 'heading' && parsed.open && !seg.viaKey) {
      this.pending = { text: commandText, endMs: seg.endMs, activation: activation ?? 'wake_word' }
      out.push({ ops: [], feedback: { status: 'pending', label: describeCommand(parsed.command) } })
      return out
    }

    out.push(this.execute(parsed.command, commandText.slice(0, parsed.end), activation ?? 'wake_word'))
    const rest = remainder(commandText, parsed.end)
    if (rest) out.push(...this.insertText(rest))
    return out
  }

  /** O áudio seguiu sem fala: um título pendente fecha depois da pausa (F1.14). */
  tick(audioMs: number): Transaction[] {
    if (this.pending && audioMs - this.pending.endMs >= this.settings.commandPauseMs) return this.flush()
    return []
  }

  /** Executa o comando pendente (fim da sessão ou pausa). */
  flush(): Transaction[] {
    if (!this.pending) return []
    const { text, activation } = this.pending
    this.pending = null
    const parsed = parseCommand(text)
    if (!parsed) return []
    return [this.execute(parsed.command, text, activation)]
  }

  // ------------------------------------------------------------------ comandos

  private allowedInMode(c: Command): boolean {
    // Dentro de citação ou nota, só o comando que fecha vale: o resto é texto citado (F1.15).
    if (this.state.mode === 'quote') return c.kind === 'close_quote'
    if (this.state.mode === 'note') return c.kind === 'close_note'
    return c.kind !== 'close_quote' && c.kind !== 'close_note'
  }

  private execute(command: Command, raw: string, activation: Activation): Transaction {
    const record = (status: CommandRecord['status']): CommandRecord => ({ raw, activation, parsed: command, status })

    if (command.kind === 'undo' || command.kind === 'redo') {
      const result = command.kind === 'undo' ? this.undo() : this.redo()
      if (!result.ok) return { ops: [], feedback: { status: 'ignored', label: result.reason }, command: record('ignored') }
      return { ops: result.ops, feedback: { status: 'executed', label: describeCommand(command) }, command: record('executed') }
    }

    const before = this.snapshot()
    let ops: Op[] = []
    let label = describeCommand(command)

    switch (command.kind) {
      case 'heading':
        ops = this.createHeading(command.level, command.number, command.title)
        break
      case 'new_paragraph':
        this.state.forceNewParagraph = true
        break
      case 'open_quote':
        this.state = { ...this.state, mode: 'quote', quoteId: null }
        break
      case 'close_quote':
        this.state = {
          ...this.state,
          mode: 'text',
          cursor: { blockId: this.state.quoteId ?? this.state.cursor.blockId, offset: null },
          quoteId: null,
          forceNewParagraph: true,
        }
        break
      case 'open_note': {
        const target = this.manuscript.get(this.state.cursor.blockId)
        if (!target || (target.type !== 'paragraph' && target.type !== 'quote')) {
          return { ops: [], feedback: { status: 'ignored', label: 'A nota precisa de um parágrafo antes' }, command: record('ignored') }
        }
        const anchor = this.state.cursor.offset ?? target.content.length
        this.state = {
          ...this.state,
          mode: 'note',
          noteId: null,
          noteTarget: { parentId: target.id, anchor, returnOffset: this.state.cursor.offset },
        }
        break
      }
      case 'close_note': {
        const target = this.state.noteTarget
        this.state = {
          ...this.state,
          mode: 'text',
          noteId: null,
          noteTarget: null,
          cursor: target ? { blockId: target.parentId, offset: target.returnOffset } : this.state.cursor,
        }
        break
      }
      case 'delete_last_sentence': {
        const r = this.deleteLastSentence()
        if (!r) return { ops: [], feedback: { status: 'ignored', label: 'Não há frase para apagar' }, command: record('ignored') }
        ops = r
        break
      }
    }

    this.manuscript.applyAll(ops)
    this.pushStep({ ops, before, after: this.snapshot() })
    if (command.kind === 'heading' && !command.title && command.number === null) label = 'Título vazio'
    return { ops, feedback: { status: 'executed', label }, command: record('executed') }
  }

  private createHeading(level: 'chapter' | 'section' | 'subsection', number: number | null, title: string): Op[] {
    const m = this.manuscript
    const anchor = m.get(this.state.cursor.blockId)
    const id = this.newId()
    let parentId: string | null
    let position: string

    if (level === 'chapter') {
      const current = m.chapterOf(anchor?.id ?? null) ?? (anchor ? anchor : undefined)
      parentId = null
      const after = current?.parent_id === null ? current.id : null
      position = after ? m.keyAfter(null, after) : m.keyAtEnd(null)
    } else {
      const chapter = anchor ? m.chapterOf(anchor.id) : m.children(null).filter((b) => b.type === 'chapter').at(-1)
      parentId = chapter?.id ?? null
      if (!anchor) position = m.keyAtEnd(parentId)
      else if (anchor.id === chapter?.id) position = m.keyAfter(parentId, null)
      else {
        const sibling = anchor.type === 'note' ? m.get(anchor.parent_id) : anchor
        position = sibling && sibling.parent_id === parentId ? m.keyAfter(parentId, sibling.id) : m.keyAtEnd(parentId)
      }
    }

    const block: MBlock = {
      id,
      parent_id: parentId,
      type: level,
      position,
      content: title,
      attrs: number !== null ? { number } : {},
      origin: 'author',
      status: 'final',
    }
    this.state = { ...this.state, cursor: { blockId: id, offset: null }, mode: 'text', quoteId: null, noteId: null, noteTarget: null, forceNewParagraph: false }
    return [{ op: 'insert', block }]
  }

  private deleteLastSentence(): Op[] | null {
    const m = this.manuscript
    const block = m.get(this.state.cursor.blockId)
    if (!block || !TEXT_TYPES.has(block.type)) return null
    const end = this.state.cursor.offset ?? block.content.length
    const start = lastSentenceStart(block.content, end)
    if (block.content.slice(start, end).trim() === '') return null

    const head = block.content.slice(0, start).replace(/\s+$/, '')
    const tail = block.content.slice(end).replace(/^\s+/, '')
    const content = head && tail ? `${head} ${tail}` : head + tail
    const removed = block.content.length - content.length

    if (!content.trim()) {
      // a frase era o bloco inteiro: o bloco sai (com as notas dele)
      const ops: Op[] = m.notesOf(block.id).map((n) => ({ op: 'delete', block: n }))
      ops.push({ op: 'delete', block })
      const prev = this.previousTextBlock(block)
      this.state = { ...this.state, cursor: { blockId: prev?.id ?? block.parent_id, offset: null } }
      return ops
    }

    const ops: Op[] = [
      { op: 'update', id: block.id, before: { content: block.content, attrs: block.attrs }, after: { content, attrs: block.attrs } },
    ]
    for (const note of m.notesOf(block.id)) {
      const a = note.attrs.anchor as number
      if (a <= start) continue
      const anchor = a >= end ? a - removed : head.length
      ops.push({ op: 'update', id: note.id, before: { content: note.content, attrs: note.attrs }, after: { content: note.content, attrs: { ...note.attrs, anchor } } })
    }
    this.state = { ...this.state, cursor: { blockId: this.state.cursor.blockId, offset: this.state.cursor.offset === null ? null : head.length } }
    return ops
  }

  private previousTextBlock(block: MBlock): MBlock | undefined {
    const ordered = this.manuscript.ordered()
    const i = ordered.findIndex((b) => b.id === block.id)
    return ordered.slice(0, Math.max(0, i)).reverse()[0]
  }

  // ------------------------------------------------------------------ texto

  private insertText(spoken: string): Transaction[] {
    let written = spoken.trim()
    const changes: TextChange[] = []
    if (this.settings.removeHesitations) {
      const r = removeHesitations(written)
      written = r.text
      changes.push(...r.changes)
    }
    if (this.settings.spellingRules.length) {
      // trocas de grafia são registradas relativas ao texto já sem hesitações
      const r = applySpellingRules(written, this.settings.spellingRules)
      written = r.text
      changes.push(...r.changes)
    }
    if (!written.trim()) return []

    const before = this.snapshot()
    const m = this.manuscript
    const ops: Op[] = []
    let target: MBlock | undefined
    let offset: number | null = null

    if (this.state.mode === 'note') {
      target = m.get(this.state.noteId)
      if (!target && this.state.noteTarget) {
        const { parentId, anchor } = this.state.noteTarget
        const note: MBlock = {
          id: this.newId(),
          parent_id: parentId,
          type: 'note',
          position: m.keyAtEnd(parentId),
          content: '',
          attrs: { anchor },
          origin: 'author',
          status: 'final',
        }
        ops.push({ op: 'insert', block: note })
        m.apply(ops[0]!)
        target = m.get(note.id)
        this.state.noteId = note.id
      }
    } else if (this.state.mode === 'quote') {
      target = m.get(this.state.quoteId)
      if (!target) {
        const created = this.newBlockAfterCursor('quote')
        ops.push(created)
        m.apply(created)
        target = m.get(created.block.id)
        this.state.quoteId = target!.id
      }
    } else {
      const cur = m.get(this.state.cursor.blockId)
      if (cur && cur.type === 'paragraph' && !this.state.forceNewParagraph) {
        target = cur
        offset = this.state.cursor.offset
      } else {
        const created = this.newBlockAfterCursor('paragraph')
        ops.push(created)
        m.apply(created)
        target = m.get(created.block.id)
        this.state.forceNewParagraph = false
      }
    }
    if (!target) return []

    const at = offset ?? target.content.length
    const joined = joinText(target.content.slice(0, at), written, target.content.slice(at))
    const update: Op = {
      op: 'update',
      id: target.id,
      before: { content: target.content, attrs: target.attrs },
      after: { content: joined.text, attrs: target.attrs },
    }
    const shift = joined.text.length - target.content.length
    const noteShifts: Op[] = m.notesOf(target.id)
      .filter((n) => (n.attrs.anchor as number) > at || (offset !== null && (n.attrs.anchor as number) === at))
      .map((n) => ({
        op: 'update',
        id: n.id,
        before: { content: n.content, attrs: n.attrs },
        after: { content: n.content, attrs: { ...n.attrs, anchor: (n.attrs.anchor as number) + shift } },
      }))
    m.apply(update)
    m.applyAll(noteShifts)
    ops.push(update, ...noteShifts)

    if (this.state.mode === 'text') {
      this.state.cursor = { blockId: target.id, offset: offset === null ? null : joined.insertEnd }
    }
    this.pushStep({ ops, before, after: this.snapshot() })

    return [
      {
        ops: collapse(ops),
        insertion: {
          blockId: target.id,
          start: joined.insertStart,
          end: joined.insertEnd,
          spoken,
          written,
          changes: changes.map((c) => ({ ...c, offset: c.offset + joined.insertStart })),
        },
      },
    ]
  }

  /** Novo bloco logo depois do cursor, no mesmo capítulo. */
  private newBlockAfterCursor(type: 'paragraph' | 'quote'): Extract<Op, { op: 'insert' }> {
    const m = this.manuscript
    let anchor = m.get(this.state.cursor.blockId)
    if (anchor?.type === 'note') anchor = m.get(anchor.parent_id)
    let parentId: string | null
    let position: string
    if (!anchor) {
      const lastChapter = m.children(null).filter((b) => b.type === 'chapter').at(-1)
      parentId = lastChapter?.id ?? null
      position = m.keyAtEnd(parentId)
    } else if (anchor.type === 'chapter') {
      parentId = anchor.id
      position = m.keyAfter(anchor.id, null)
    } else {
      parentId = anchor.parent_id
      position = m.keyAfter(parentId, anchor.id)
    }
    return {
      op: 'insert',
      block: { id: this.newId(), parent_id: parentId, type, position, content: '', attrs: {}, origin: 'author', status: 'final' },
    }
  }

  // ------------------------------------------------------------------ desfazer / refazer

  private pushStep(step: Step) {
    this.undoStack.push(step)
    if (this.undoStack.length > 500) this.undoStack.shift()
    this.redoStack = []
  }

  private undo(): { ok: true; ops: Op[] } | { ok: false; reason: string } {
    const step = this.undoStack.pop()
    if (!step) return { ok: false, reason: 'Nada para desfazer' }
    const ops = invertAll(step.ops)
    const unsafe = ops.find((op) => op.op === 'delete' && this.manuscript.children(op.block.id).some((c) => !step.ops.some((o) => o.op === 'insert' && o.block.id === c.id)))
    if (unsafe) {
      this.undoStack.push(step)
      return { ok: false, reason: 'Não dá para desfazer: há outro conteúdo dentro deste trecho' }
    }
    this.manuscript.applyAll(ops)
    this.state = clone(step.before)
    this.redoStack.push(step)
    return { ok: true, ops }
  }

  private redo(): { ok: true; ops: Op[] } | { ok: false; reason: string } {
    const step = this.redoStack.pop()
    if (!step) return { ok: false, reason: 'Nada para refazer' }
    this.manuscript.applyAll(step.ops)
    this.state = clone(step.after)
    this.undoStack.push(step)
    return { ok: true, ops: step.ops }
  }

  private snapshot(): EngineState {
    return clone(this.state)
  }
}

function clone<T>(v: T): T {
  return structuredClone(v)
}

/** O que sobra do trecho depois do comando, sem a pontuação que separava. */
function remainder(text: string, end: number): string {
  return text.slice(end).replace(/^[\s.,;:!?—–-]+/, '').trim()
}

/** Junta insert + update do mesmo bloco numa inserção só, para gravar uma linha. */
function collapse(ops: Op[]): Op[] {
  const out: Op[] = []
  for (const op of ops) {
    const prev = out.at(-1)
    if (prev?.op === 'insert' && op.op === 'update' && op.id === prev.block.id) {
      out[out.length - 1] = { op: 'insert', block: { ...prev.block, content: op.after.content, attrs: op.after.attrs } }
    } else {
      out.push(op)
    }
  }
  return out
}

