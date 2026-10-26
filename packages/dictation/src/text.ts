import { fold } from './numbers.ts'

export interface SpellingRule {
  id: string
  /** Como o STT escreve o que o autor fala ("rex"). */
  spoken: string
  /** Como deve ficar no livro ("REsp"). */
  written: string
}

/** Uma troca feita no texto final: base do registro e do desfazer (F1.08) e da guarda de fidelidade (F1.10). */
export interface TextChange {
  kind: 'spelling' | 'hesitation'
  ruleId: string | null
  before: string
  after: string
  /** Posição da troca no texto já transformado. */
  offset: number
}

/**
 * Aplica as regras de grafia aprovadas: palavra ou expressão inteira, sem
 * diferenciar maiúsculas nem acentos. Devolve o texto e cada troca feita.
 */
export function applySpellingRules(text: string, rules: SpellingRule[]): { text: string; changes: TextChange[] } {
  // expressões mais longas primeiro ("recurso especial" antes de "recurso")
  const ordered = [...rules].filter((r) => r.spoken.trim()).sort((a, b) => b.spoken.length - a.spoken.length)
  const matches: { start: number; end: number; rule: SpellingRule }[] = []
  const folded = fold(text)

  for (const rule of ordered) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(fold(rule.spoken.trim()))}(?![\\p{L}\\p{N}])`, 'gu')
    for (const m of folded.matchAll(pattern)) {
      const start = m.index!
      const end = start + m[0].length
      if (matches.some((x) => start < x.end && end > x.start)) continue
      matches.push({ start, end, rule })
    }
  }
  matches.sort((a, b) => a.start - b.start)

  let out = ''
  let cursor = 0
  const changes: TextChange[] = []
  for (const m of matches) {
    out += text.slice(cursor, m.start)
    const before = text.slice(m.start, m.end)
    if (before !== m.rule.written) {
      changes.push({ kind: 'spelling', ruleId: m.rule.id, before, after: m.rule.written, offset: out.length })
    }
    out += m.rule.written
    cursor = m.end
  }
  out += text.slice(cursor)
  return { text: out, changes }
}

/**
 * Hesitações isoladas que podem ser removidas (F1.09). Só sai o que está
 * nesta lista; "é" sozinho é verbo e fica, a não ser que venha alongado
 * ("éé") ou com reticências ("é…").
 */
const HESITATION = /^(?:h[aã]+|hu+m+|hm+|ah+n+|[eé]{2,}|[eé](?:\.\.\.|…)|ã+|uh+m*)$/i

export function removeHesitations(text: string): { text: string; changes: TextChange[] } {
  const changes: TextChange[] = []
  let out = ''
  let last = 0
  for (const m of text.matchAll(/\S+/g)) {
    const raw = m[0]
    // "hã," e "hum." contam; reticências fazem parte de "é…"
    const candidate = raw.replace(/[,;:!?]+$/, '').replace(/(?<!\.)\.$/, '')
    if (!HESITATION.test(candidate)) continue
    // tira a palavra e o espaço que a precede (ou o que a segue, no início do texto)
    let start = m.index!
    // o ponto final da frase fica, mesmo quando a hesitação vinha colada nele
    const keep = raw.match(/(?<!\.)[.!?]$/)?.[0] ?? ''
    let end = start + raw.length - keep.length
    if (start > 0 && /\s/.test(text[start - 1]!)) start--
    else if (!keep && /\s/.test(text[end] ?? '')) end++
    out += text.slice(last, start)
    changes.push({ kind: 'hesitation', ruleId: null, before: text.slice(start, end), after: '', offset: out.length })
    last = end
  }
  out += text.slice(last)
  return { text: out, changes }
}

/** Junta um trecho ditado ao texto que já existe, com um espaço quando precisa. */
export function joinText(before: string, insert: string, after = ''): { text: string; insertStart: number; insertEnd: number } {
  const piece = insert.trim()
  const needsLeft = before.length > 0 && !/\s$/.test(before) && piece.length > 0
  const needsRight = after.length > 0 && !/^\s/.test(after) && !/^[.,;:!?)]/.test(after)
  const left = before + (needsLeft ? ' ' : '')
  const text = left + piece + (needsRight ? ' ' : '') + after
  return { text, insertStart: left.length, insertEnd: left.length + piece.length }
}

/**
 * Onde começa a última frase antes de `end`: depois do último ponto final,
 * de exclamação ou de interrogação. Abreviações jurídicas comuns ("art.",
 * "n.", "inc.") não terminam frase.
 */
export function lastSentenceStart(text: string, end = text.length): number {
  const head = text.slice(0, end).replace(/\s+$/, '')
  const body = head.replace(/[.!?…]+$/, '') // ignora o ponto da própria frase
  const re = /[.!?…]+(?=\s)/g
  let start = 0
  for (const m of body.matchAll(re)) {
    const word = body.slice(0, m.index).match(/(\S+)$/)?.[1] ?? ''
    if (ABBREVIATIONS.has(fold(word))) continue
    start = m.index! + m[0].length
  }
  while (start < head.length && /\s/.test(head[start]!)) start++
  return start
}

const ABBREVIATIONS = new Set(['art', 'arts', 'n', 'no', 'inc', 'par', 'al', 'fl', 'fls', 'p', 'pp', 'v', 'cf', 'ex', 'dr', 'dra', 'sr', 'sra', 'min', 'rel', 'j', 'ed'])

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
}
