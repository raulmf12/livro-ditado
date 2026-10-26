import { fold, parseNumber } from './numbers.ts'

export type HeadingType = 'chapter' | 'section' | 'subsection'

export type Command =
  | { kind: 'heading'; level: HeadingType; number: number | null; title: string }
  | { kind: 'new_paragraph' }
  | { kind: 'open_quote' }
  | { kind: 'close_quote' }
  | { kind: 'open_note' }
  | { kind: 'close_note' }
  | { kind: 'delete_last_sentence' }
  | { kind: 'undo' }
  | { kind: 'redo' }

export interface Token {
  /** Texto como veio do STT. */
  raw: string
  /** Sem pontuação nas pontas, sem acento, minúsculo. */
  norm: string
  start: number
  end: number
}

export function tokenize(text: string): Token[] {
  const out: Token[] = []
  for (const m of text.matchAll(/\S+/g)) {
    const norm = fold(m[0]).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}º°ª]+$/gu, '')
    if (norm) out.push({ raw: m[0], norm, start: m.index!, end: m.index! + m[0].length })
  }
  return out
}

/** Frases fixas de cada comando sem argumento (já sem acento). */
const FIXED: [string[], Command][] = [
  [['novo', 'paragrafo'], { kind: 'new_paragraph' }],
  [['nova', 'linha'], { kind: 'new_paragraph' }],
  [['paragrafo'], { kind: 'new_paragraph' }],
  [['abre', 'citacao'], { kind: 'open_quote' }],
  [['abre', 'aspas'], { kind: 'open_quote' }],
  [['abrir', 'citacao'], { kind: 'open_quote' }],
  [['inicio', 'da', 'citacao'], { kind: 'open_quote' }],
  [['citacao'], { kind: 'open_quote' }],
  [['fecha', 'citacao'], { kind: 'close_quote' }],
  [['fecha', 'aspas'], { kind: 'close_quote' }],
  [['fechar', 'citacao'], { kind: 'close_quote' }],
  [['fim', 'da', 'citacao'], { kind: 'close_quote' }],
  [['fim', 'da', 'nota'], { kind: 'close_note' }],
  [['fecha', 'nota'], { kind: 'close_note' }],
  [['fecha', 'a', 'nota'], { kind: 'close_note' }],
  [['nota', 'de', 'rodape'], { kind: 'open_note' }],
  [['abre', 'nota'], { kind: 'open_note' }],
  [['nota'], { kind: 'open_note' }],
  [['apaga', 'a', 'ultima', 'frase'], { kind: 'delete_last_sentence' }],
  [['apaga', 'ultima', 'frase'], { kind: 'delete_last_sentence' }],
  [['apagar', 'a', 'ultima', 'frase'], { kind: 'delete_last_sentence' }],
  [['apague', 'a', 'ultima', 'frase'], { kind: 'delete_last_sentence' }],
  [['desfaz'], { kind: 'undo' }],
  [['desfazer'], { kind: 'undo' }],
  [['desfaca'], { kind: 'undo' }],
  [['refaz'], { kind: 'redo' }],
  [['refazer'], { kind: 'redo' }],
  [['refaca'], { kind: 'redo' }],
]

const HEADINGS: [string[], HeadingType][] = [
  [['subsecao'], 'subsection'],
  [['sub', 'secao'], 'subsection'],
  [['secao'], 'section'],
  [['capitulo'], 'chapter'],
]

export interface ParseResult {
  command: Command
  /** Onde o comando termina no texto do comando (índice em caracteres). */
  end: number
  /** O título ainda pode continuar no próximo trecho (sem "fim"). */
  open: boolean
}

/**
 * Interpreta o texto de um comando (já sem a palavra de ativação). Depois de um
 * comando sem argumento, o resto do texto é ditado comum. Títulos vão até
 * "fim" ou até o fim do trecho; sem "fim", o título fica aberto (pode
 * continuar se o autor seguir falando logo em seguida).
 */
export function parseCommand(text: string): ParseResult | null {
  const tokens = tokenize(text)
  if (tokens.length === 0) return null
  const norms = tokens.map((t) => t.norm)

  for (const [words, level] of HEADINGS) {
    if (!startsWith(norms, words)) continue
    let i = words.length
    const num = parseNumber(norms.slice(i))
    let number: number | null = null
    if (num) {
      number = num.value
      i += num.length
    }
    const fimAt = norms.indexOf('fim', i)
    const titleTokens = tokens.slice(i, fimAt === -1 ? undefined : fimAt)
    const title = titleTokens.length
      ? cleanTitle(text.slice(titleTokens[0]!.start, titleTokens.at(-1)!.end))
      : ''
    if (number === null && !title) return null
    const end = fimAt === -1 ? text.length : tokens[fimAt]!.end
    return { command: { kind: 'heading', level, number, title }, end, open: fimAt === -1 }
  }

  // o mais longo primeiro: "nota de rodapé" antes de "nota"
  const fixed = [...FIXED].sort((a, b) => b[0].length - a[0].length)
  for (const [words, command] of fixed) {
    if (!startsWith(norms, words)) continue
    let last = words.length - 1
    if (norms[last + 1] === 'fim') last++
    return { command, end: tokens[last]!.end, open: false }
  }
  return null
}

/** Separa a palavra de ativação do início do texto. Só vale no começo do trecho (F1.15). */
export function stripWakeWord(text: string, wakeWord: string): string | null {
  const tokens = tokenize(text)
  const wake = fold(wakeWord)
  const first = tokens[0]
  if (!first || !wakeVariants(wake).includes(first.norm)) return null
  return text.slice(first.end).replace(/^[\s,.:;!?—–-]+/, '')
}

function wakeVariants(wake: string): string[] {
  // grafias que o STT costuma devolver para a mesma palavra
  const variants = new Set([wake, wake.replace(/t/g, 'th'), wake.replace(/th/g, 't'), `${wake}s`])
  return [...variants]
}

function startsWith(norms: string[], words: string[]) {
  return words.every((w, i) => norms[i] === w)
}

/** Tira a pontuação das pontas do título ("Da posse agrária." → "Da posse agrária"). */
function cleanTitle(s: string): string {
  return s.replace(/^[\s,.:;—–-]+|[\s,.:;—–-]+$/g, '')
}

/** Descrição curta para a faixa de confirmação na tela (F1.14). */
export function describeCommand(c: Command): string {
  switch (c.kind) {
    case 'heading': {
      const name = { chapter: 'Capítulo', section: 'Seção', subsection: 'Subseção' }[c.level]
      const num = c.number !== null ? ` ${c.number}` : ''
      return c.title ? `${name}${num}: ${c.title}` : `${name}${num}`
    }
    case 'new_paragraph':
      return 'Novo parágrafo'
    case 'open_quote':
      return 'Citação aberta'
    case 'close_quote':
      return 'Citação fechada'
    case 'open_note':
      return 'Nota de rodapé'
    case 'close_note':
      return 'Fim da nota'
    case 'delete_last_sentence':
      return 'Última frase apagada'
    case 'undo':
      return 'Desfeito'
    case 'redo':
      return 'Refeito'
  }
}
