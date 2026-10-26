// Números falados em português: "três", "vinte e três", "cento e cinco",
// "primeiro", "décimo segundo", "3", "III". Usado pelos comandos de estrutura.

const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
  oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
  quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
}
const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
}
const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600,
  seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
}
const ORDINALS: Record<string, number> = {
  primeiro: 1, primeira: 1, segundo: 2, segunda: 2, terceiro: 3, terceira: 3, quarto: 4, quarta: 4,
  quinto: 5, quinta: 5, sexto: 6, sexta: 6, setimo: 7, setima: 7, oitavo: 8, oitava: 8,
  nono: 9, nona: 9, decimo: 10, decima: 10, vigesimo: 20, vigesima: 20, trigesimo: 30, trigesima: 30,
  quadragesimo: 40, quadragesima: 40, quinquagesimo: 50, quinquagesima: 50,
  centesimo: 100, centesima: 100,
}
const ROMAN = /^(?=[ivxlc]+$)c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/

/** Tira acentos e deixa em minúsculas, para comparar palavras faladas. */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export interface ParsedNumber {
  value: number
  /** Quantas palavras (tokens) o número ocupou. */
  length: number
}

/**
 * Lê um número no início de `tokens` (já sem acento e em minúsculas).
 * Devolve null se o primeiro token não começa um número.
 */
export function parseNumber(tokens: string[]): ParsedNumber | null {
  const first = tokens[0]
  if (!first) return null
  if (/^\d+$/.test(first)) return { value: Number(first), length: 1 }
  if (/^\d{1,3}(\.\d{3})+$/.test(first)) return { value: Number(first.replaceAll('.', '')), length: 1 }
  if (/^\d+[oaº°ª]$/.test(first)) return { value: Number(first.slice(0, -1)), length: 1 }
  if (ROMAN.test(first) && first.length > 0 && first !== 'v' && first !== 'c' && first !== 'l') {
    return { value: roman(first), length: 1 }
  }
  if (first in ORDINALS) {
    // "décimo segundo", "vigésimo terceiro"
    let value = ORDINALS[first]!
    let length = 1
    const next = tokens[1]
    if (value >= 10 && next && next in ORDINALS && ORDINALS[next]! < 10) {
      value += ORDINALS[next]!
      length = 2
    }
    return { value, length }
  }
  return parseCardinal(tokens)
}

function parseCardinal(tokens: string[]): ParsedNumber | null {
  let value = 0
  let i = 0
  let lastMagnitude = Infinity
  let any = false
  while (i < tokens.length) {
    const t = tokens[i]!
    let n: number | undefined
    let magnitude: number
    if (t in HUNDREDS) {
      n = HUNDREDS[t]
      magnitude = 100
    } else if (t in TENS) {
      n = TENS[t]
      magnitude = 10
    } else if (t in UNITS) {
      n = UNITS[t]
      magnitude = 1
    } else if (t === 'mil') {
      value = (value || 1) * 1000
      lastMagnitude = 1000
      any = true
      i++
      if (tokens[i] === 'e' && tokens[i + 1] && isNumberWord(tokens[i + 1]!)) i++
      continue
    } else {
      break
    }
    if (magnitude >= lastMagnitude || (any && lastMagnitude === 1)) break
    value += n!
    lastMagnitude = magnitude
    any = true
    i++
    // "vinte e três": o "e" só conta se vier outra palavra numérica depois
    if (tokens[i] === 'e' && tokens[i + 1] && isNumberWord(tokens[i + 1]!)) i++
  }
  return any ? { value, length: i } : null
}

function isNumberWord(t: string) {
  return t in UNITS || t in TENS || t in HUNDREDS || t === 'mil'
}

function roman(s: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const cur = v[s[i]!]!
    const next = v[s[i + 1]!] ?? 0
    total += cur < next ? -cur : cur
  }
  return total
}
