import { Extension, Node, mergeAttributes } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Text from '@tiptap/extension-text'
import { Placeholder, UndoRedo } from '@tiptap/extensions'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

/**
 * Esquema do livro no editor: a mesma lista de blocos do manuscrito. Cada nó
 * guarda o id do bloco (blockId); notas de rodapé são nós dentro do texto do
 * parágrafo, no ponto onde foram ditadas.
 */

const blockAttrs = {
  blockId: { default: null, rendered: false },
  origin: { default: 'author', rendered: false },
  status: { default: 'final', rendered: false },
}

const dataAttrs = (node: PMNode, type: string) => ({
  'data-type': type,
  'data-block-id': node.attrs.blockId ?? undefined,
  'data-origin': node.attrs.origin === 'ai' ? 'ai' : undefined,
  'data-status': node.attrs.origin === 'ai' ? node.attrs.status : undefined,
})

export const BookDocument = Document.extend({ content: 'block+' })

export const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  priority: 1000,
  addAttributes: () => blockAttrs,
  parseHTML: () => [{ tag: 'p' }],
  renderHTML: ({ node, HTMLAttributes }) => ['p', mergeAttributes(HTMLAttributes, dataAttrs(node, 'paragraph')), 0],
})

export const Quote = Node.create({
  name: 'quote',
  group: 'block',
  content: 'inline*',
  defining: true,
  addAttributes: () => blockAttrs,
  parseHTML: () => [{ tag: 'p[data-type="quote"]', priority: 60 }],
  renderHTML: ({ node, HTMLAttributes }) => ['p', mergeAttributes(HTMLAttributes, dataAttrs(node, 'quote'), { class: 'quote' }), 0],
})

function heading(name: 'chapter' | 'section' | 'subsection', tag: 'h1' | 'h2' | 'h3') {
  return Node.create({
    name,
    group: 'block',
    content: 'text*',
    defining: true,
    addAttributes: () => ({ ...blockAttrs, number: { default: null, rendered: false } }),
    parseHTML: () => [{ tag }],
    renderHTML: ({ node, HTMLAttributes }) => [
      tag,
      mergeAttributes(HTMLAttributes, dataAttrs(node, name), {
        'data-number': node.attrs.number ?? undefined,
      }),
      0,
    ],
  })
}

export const Chapter = heading('chapter', 'h1')
export const Section = heading('section', 'h2')
export const Subsection = heading('subsection', 'h3')

/** Chamada de nota: um nó atômico com o texto da nota nos atributos. */
export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    blockId: { default: null, rendered: false },
    text: { default: '', rendered: false },
  }),
  parseHTML: () => [{ tag: 'sup[data-type="footnote"]' }],
  renderHTML: ({ node }) => [
    'sup',
    { 'data-type': 'footnote', 'data-block-id': node.attrs.blockId ?? undefined, title: node.attrs.text, class: 'footnote-ref' },
    '*',
  ],
})

/** Cursor de ditado (F1.17): separado do cursor de digitação, desenhado como uma marca. */
export const dictationCursorKey = new PluginKey<{ pos: number | null }>('dictation-cursor')

export const DictationCursor = Extension.create({
  name: 'dictationCursor',
  addProseMirrorPlugins() {
    return [
      new Plugin<{ pos: number | null }>({
        key: dictationCursorKey,
        state: {
          init: () => ({ pos: null }),
          apply(tr, value) {
            const meta = tr.getMeta(dictationCursorKey) as { pos: number | null } | undefined
            if (meta) return meta
            return value.pos === null ? value : { pos: tr.mapping.map(value.pos) }
          },
        },
        props: {
          decorations(state) {
            const { pos } = dictationCursorKey.getState(state) ?? { pos: null }
            if (pos === null || pos > state.doc.content.size) return null
            const widget = document.createElement('span')
            widget.className = 'dictation-cursor'
            widget.setAttribute('data-testid', 'cursor-ditado')
            widget.setAttribute('aria-label', 'Cursor de ditado')
            return DecorationSet.create(state.doc, [Decoration.widget(pos, widget, { side: 1, key: 'dictation-cursor' })])
          },
        },
      }),
    ]
  },
})

/** Ids de bloco únicos: ao quebrar um parágrafo com Enter, o pedaço novo ganha id novo. */
export const UniqueBlockIds = Extension.create({
  name: 'uniqueBlockIds',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((t) => t.docChanged)) return null
          const seen = new Set<string>()
          const tr = state.tr
          let changed = false
          state.doc.descendants((node, pos) => {
            if (!('blockId' in node.attrs)) return true
            const id = node.attrs.blockId as string | null
            if (id && !seen.has(id)) {
              seen.add(id)
            } else {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: crypto.randomUUID(), origin: 'author', status: 'final' })
              changed = true
            }
            return node.type.name !== 'footnote'
          })
          if (!changed) return null
          tr.setMeta('addToHistory', false)
          return tr
        },
      }),
    ]
  },
})

/**
 * Atalhos do livro dentro do editor. No Mac, o TipTap usa Option+D como
 * "apagar para a frente" (herança do Emacs); aqui ele é tomado antes, para
 * "Ditar aqui" (Alt+D) nunca apagar texto.
 */
export const BookShortcuts = Extension.create({
  name: 'bookShortcuts',
  priority: 1000,
  addKeyboardShortcuts() {
    const emit = (name: string) => () => {
      this.editor.view.dom.dispatchEvent(new CustomEvent(name, { bubbles: true }))
      return true
    }
    return {
      'Alt-d': emit('livro:ditar-aqui'),
      'Alt-r': emit('livro:gravar'),
      'Alt-p': emit('livro:previa'),
    }
  },
})

export function bookExtensions() {
  return [
    BookDocument,
    Paragraph,
    Quote,
    Chapter,
    Section,
    Subsection,
    Text,
    Footnote,
    UndoRedo,
    DictationCursor,
    UniqueBlockIds,
    BookShortcuts,
    Placeholder.configure({ placeholder: 'Clique em Gravar e comece a falar, ou digite aqui.' }),
  ]
}
