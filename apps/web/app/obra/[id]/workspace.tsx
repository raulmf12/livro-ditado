'use client'

import * as Sentry from '@sentry/nextjs'
import { EditorContent, useEditor } from '@tiptap/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Manuscript, moveChapterOps, type MBlock, type Op } from '@livro/dictation'
import type { Cursor, ServerMessage } from '@livro/shared'
import { DictationClient, type DictationStatus } from '@/lib/dictation/client'
import { blocksFromDoc, diffToOps, docFromManuscript, editorPos, patchEditor, textPosition } from '@/lib/editor/convert'
import { bookExtensions, dictationCursorKey } from '@/lib/editor/schema'
import type { BookSettings } from '@/lib/books/load'
import { createClient } from '@/lib/supabase/client'
import { CommandBand, type BandState } from './command-band'
import { ListenButton } from './listen-button'
import { MicSelect } from './mic-select'
import { Preview } from './preview'
import { Toc } from './toc'

const SAVE_DEBOUNCE_MS = 600

interface Props {
  bookId: string
  initialBlocks: MBlock[]
  settings: BookSettings
}

/**
 * Espaço de trabalho do manuscrito: editor (F1.17), ditado (F1.01–F1.02),
 * faixa de comandos (F1.14), sumário (F1.19), prévia (F1.18) e sincronização
 * ao vivo (F1.21). O manuscrito em memória é a fonte da verdade da tela; o
 * editor é atualizado por patches a cada mudança de fora.
 */
export function Workspace({ bookId, initialBlocks, settings }: Props) {
  const manuscript = useMemo(() => new Manuscript(initialBlocks), [initialBlocks])
  const [version, setVersion] = useState(0) // muda quando o manuscrito muda (sumário, prévia)
  const [status, setStatus] = useState<DictationStatus>('parado')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [band, setBand] = useState<BandState | null>(null)
  const [interim, setInterim] = useState('')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState<'salvo' | 'salvando' | 'erro'>('salvo')
  const [commandHeld, setCommandHeld] = useState(false)
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined)
  const [caretBlockId, setCaretBlockId] = useState<string | null>(null)
  const cursorRef = useRef<Cursor>({ blockId: null, offset: null })
  const sessionIdRef = useRef<string | null>(null)
  const clientRef = useRef<DictationClient | null>(null)
  const dirty = useRef(new Set<string>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSave = useRef<Promise<void>>(Promise.resolve())
  const commandKey = settings.command_key || 'F9'

  const editor = useEditor({
    extensions: bookExtensions(),
    content: docFromManuscript(manuscript),
    immediatelyRender: false,
    editorProps: { attributes: { class: 'manuscript-editor', 'aria-label': 'Manuscrito', 'data-testid': 'manuscrito' } },
    onUpdate: ({ transaction }) => {
      if (transaction.getMeta('remote')) return
      // só os blocos que esta edição tocou ficam "sujos" (o patch remoto não mexe neles até salvar)
      const doc = transaction.doc
      for (const map of transaction.mapping.maps) {
        map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
          doc.nodesBetween(Math.max(0, newStart - 1), Math.min(doc.content.size, newEnd + 1), (node) => {
            const id = node.attrs.blockId as string | null
            if (id) dirty.current.add(id)
            return false
          })
        })
      }
      scheduleSave()
    },
    onSelectionUpdate: ({ editor: e }) => {
      setCaretBlockId(textPosition(e.state.doc, e.state.selection.head)?.blockId ?? null)
    },
  })

  // ------------------------------------------------------------------ gravação do que foi digitado

  const save = useCallback(async () => {
    if (!editor) return
    const ops = diffToOps(manuscript, blocksFromDoc(editor.state.doc))
    dirty.current.clear()
    if (!ops.length) return
    manuscript.applyAll(ops)
    setVersion((v) => v + 1)
    setSaving('salvando')
    const res = await fetch(`/api/books/${bookId}/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ops }),
    }).catch(() => null)
    if (res?.ok) {
      setSaving('salvo')
    } else {
      setSaving('erro')
      await reload()
    }
  }, [editor, manuscript, bookId]) // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback(() => {
    setSaving('salvando')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      pendingSave.current = pendingSave.current.then(save)
    }, SAVE_DEBOUNCE_MS)
  }, [save])

  // nada se perde ao fechar a aba (F1.20): o que falta salvar vai com keepalive
  useEffect(() => {
    const flush = () => {
      if (!editor || !saveTimer.current) return
      clearTimeout(saveTimer.current)
      saveTimer.current = null
      const ops = diffToOps(manuscript, blocksFromDoc(editor.state.doc))
      if (!ops.length) return
      manuscript.applyAll(ops)
      void fetch(`/api/books/${bookId}/ops`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ops }),
        keepalive: true,
      })
    }
    window.addEventListener('pagehide', flush)
    return () => window.removeEventListener('pagehide', flush)
  }, [editor, manuscript, bookId])

  // ------------------------------------------------------------------ mudanças de fora

  const refreshEditor = useCallback(() => {
    if (!editor) return
    const tr = patchEditor(editor.state, manuscript, dirty.current)
    if (tr) {
      editor.view.dispatch(tr)
    } else if (JSON.stringify(blocksFromDoc(editor.state.doc).map((b) => b.blockId)) !== JSON.stringify(manuscript.ordered().map((b) => b.id))) {
      // ordem mudou (capítulo movido): refaz o documento, guardando a posição do cursor
      const at = textPosition(editor.state.doc, editor.state.selection.head)
      editor.commands.setContent(docFromManuscript(manuscript), { emitUpdate: false })
      const pos = at ? editorPos(editor.state.doc, at.blockId, at.offset) : null
      if (pos !== null) editor.commands.setTextSelection(pos)
    }
    drawDictationCursor()
    setVersion((v) => v + 1)
  }, [editor, manuscript]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyRemote = useCallback(
    (ops: Op[]) => {
      for (const op of ops) {
        if (op.op === 'insert') manuscript.upsert(op.block)
        else if (op.op === 'delete') manuscript.remove(op.block.id)
        else if (manuscript.get(op.id)) manuscript.apply(op)
      }
      refreshEditor()
    },
    [manuscript, refreshEditor],
  )

  async function reload() {
    const res = await fetch(`/api/books/${bookId}/blocks`)
    if (!res.ok) return
    const { blocks } = (await res.json()) as { blocks: MBlock[] }
    for (const b of manuscript.all()) if (!blocks.some((x) => x.id === b.id)) manuscript.remove(b.id)
    for (const b of blocks) manuscript.upsert(b)
    dirty.current.clear()
    refreshEditor()
  }

  // sincronização ao vivo entre abas e aparelhos (F1.21)
  useEffect(() => {
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null
    let cancelled = false
    void (async () => {
      // o canal precisa entrar já com o token do autor; sem ele, o RLS não deixa ver as mudanças
      const token = (await supabase.auth.getSession()).data.session?.access_token
      if (cancelled) return
      if (token) await supabase.realtime.setAuth(token)
      channel = supabase
      .channel(`blocks:${bookId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks', filter: `book_id=eq.${bookId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string }).id
          if (id) manuscript.remove(id)
        } else {
          const row = payload.new as MBlock
          manuscript.upsert({ id: row.id, parent_id: row.parent_id, type: row.type, position: row.position, content: row.content, attrs: row.attrs, origin: row.origin, status: row.status })
        }
        refreshEditor()
      })
      .subscribe()
    })()
    return () => {
      cancelled = true
      if (channel) void supabase.removeChannel(channel)
    }
  }, [bookId, manuscript, refreshEditor])

  // ------------------------------------------------------------------ cursor de ditado

  function drawDictationCursor() {
    if (!editor) return
    const c = cursorRef.current
    const lastId = manuscript.ordered().at(-1)?.id
    const pos = c.blockId ? editorPos(editor.state.doc, c.blockId, c.offset) : lastId ? editorPos(editor.state.doc, lastId, null) : null
    editor.view.dispatch(editor.state.tr.setMeta(dictationCursorKey, { pos }).setMeta('addToHistory', false))
  }

  const moveDictationCursorToCaret = useCallback(() => {
    if (!editor) return
    // lê a seleção direto do navegador: o estado do editor só acompanha um instante depois
    const dom = window.getSelection()
    let head = editor.state.selection.head
    if (dom?.focusNode && editor.view.dom.contains(dom.focusNode)) {
      try {
        head = editor.view.posAtDOM(dom.focusNode, dom.focusOffset)
      } catch {
        // fica com a seleção do editor
      }
    }
    const at = textPosition(editor.state.doc, head)
    if (!at) return
    cursorRef.current = { blockId: at.blockId, offset: at.offset }
    clientRef.current?.setCursor(cursorRef.current)
    drawDictationCursor()
    setBand({ status: 'executed', label: 'Cursor de ditado movido' })
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editor) drawDictationCursor()
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------ ditado

  const onServerMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case 'ready':
        case 'resumed':
          sessionIdRef.current = msg.sessionId
          Sentry.setTag('sessionId', msg.sessionId)
          break
        case 'transcript':
          setInterim(msg.kind === 'interim' ? msg.text : '')
          break
        case 'ops':
          applyRemote(msg.ops as Op[])
          break
        case 'command':
          setBand({ status: msg.status, label: msg.label })
          break
        case 'cursor':
          cursorRef.current = msg.cursor
          drawDictationCursor()
          break
      }
    },
    [applyRemote], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const startDictation = useCallback(async () => {
    setError(null)
    setNotice(null)
    await pendingSave.current
    const client = new DictationClient({
      url: process.env.NEXT_PUBLIC_SESSION_WS_URL!,
      bookId,
      deviceId,
      getToken: async () => (await createClient().auth.getSession()).data.session?.access_token ?? null,
      getCursor: () => cursorRef.current,
      onMessage: onServerMessage,
      onStatus: setStatus,
      onLevel: (l) => setLevel(Math.min(1, l * 4)),
      onFatal: (message, code) => {
        setError(message)
        Sentry.captureMessage(`aviso ao autor: ${code}`, { level: 'warning', tags: { sessionId: sessionIdRef.current, code } })
      },
      onNotice: (message) => setNotice(message),
    })
    clientRef.current?.dispose()
    clientRef.current = client
    await client.start()
  }, [bookId, deviceId, onServerMessage])

  const stopDictation = useCallback(() => {
    clientRef.current?.stop()
    setInterim('')
  }, [])

  useEffect(() => () => clientRef.current?.dispose(), [])

  const recording = status === 'gravando' || status === 'reconectando'
  const busy = status === 'conectando' || status === 'encerrando'

  // atalhos (T.06) e tecla/pedal de comando (F1.11)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === commandKey && !e.repeat && recording) {
        e.preventDefault()
        setCommandHeld(true)
        clientRef.current?.commandKey(true)
        return
      }
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      const k = e.code
      if (k === 'KeyR') {
        e.preventDefault()
        if (recording) stopDictation()
        else if (status === 'parado') void startDictation()
      } else if (k === 'KeyD') {
        e.preventDefault()
        moveDictationCursorToCaret()
      } else if (k === 'KeyP') {
        e.preventDefault()
        setPreview((p) => !p)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === commandKey && commandHeld) {
        e.preventDefault()
        setCommandHeld(false)
        clientRef.current?.commandKey(false)
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [commandKey, recording, status, commandHeld, startDictation, stopDictation, moveDictationCursorToCaret])

  // ------------------------------------------------------------------ sumário

  const moveChapter = useCallback(
    async (chapterId: string, beforeId: string | null) => {
      await pendingSave.current
      const ops = moveChapterOps(manuscript, chapterId, beforeId)
      manuscript.applyAll(ops)
      refreshEditor()
      setSaving('salvando')
      const res = await fetch(`/api/books/${bookId}/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops }) }).catch(() => null)
      setSaving(res?.ok ? 'salvo' : 'erro')
      if (!res?.ok) await reload()
    },
    [manuscript, bookId, refreshEditor], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div className="workspace">
      <aside className="toc-panel">
        <Toc manuscript={manuscript} version={version} onMove={moveChapter} />
      </aside>

      <section className="work-area">
        <div className="dictation-bar" role="toolbar" aria-label="Ditado">
          <button
            type="button"
            className={`button ${recording ? 'danger' : 'primary'}`}
            onClick={recording ? stopDictation : () => void startDictation()}
            disabled={busy}
            aria-pressed={recording}
            aria-keyshortcuts="Alt+R"
          >
            {recording ? 'Pausar' : status === 'conectando' ? 'Conectando…' : status === 'encerrando' ? 'Encerrando…' : 'Gravar'}
          </button>
          <div className="level" role="meter" aria-label="Nível do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} data-testid="medidor">
            <div className="level-bar" style={{ transform: `scaleX(${level})` }} />
          </div>
          <span className="muted status" data-testid="status">
            {status}
          </span>
          <MicSelect value={deviceId} onChange={setDeviceId} disabled={status !== 'parado'} />
          <button type="button" className="button ghost" onClick={moveDictationCursorToCaret} aria-keyshortcuts="Alt+D">
            Ditar aqui
          </button>
          <ListenButton blockId={caretBlockId} />
          <button type="button" className="button ghost" onClick={() => setPreview((p) => !p)} aria-pressed={preview} aria-keyshortcuts="Alt+P">
            {preview ? 'Voltar ao editor' : 'Prévia'}
          </button>
          <span className="muted save-state" data-testid="salvamento">
            {saving === 'salvo' ? 'Salvo' : saving === 'salvando' ? 'Salvando…' : 'Erro ao salvar'}
          </span>
        </div>

        {status === 'reconectando' && (
          <p role="status" className="alert warning" data-testid="reconectando">
            Reconectando… o áudio continua sendo gravado e nada se perde.
          </p>
        )}
        {error && (
          <p role="alert" className="alert" data-testid="aviso">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="alert warning">
            {notice}
          </p>
        )}

        <CommandBand band={band} interim={interim} commandHeld={commandHeld} commandKey={commandKey} onExpire={() => setBand(null)} />

        <div hidden={preview}>
          <EditorContent editor={editor} />
        </div>
        {preview && <Preview manuscript={manuscript} version={version} />}
      </section>
    </div>
  )
}
