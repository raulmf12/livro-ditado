/**
 * Métricas do benchmark de transcrição (F1.04).
 *
 * As palavras são comparadas sem pontuação e sem diferença de maiúsculas e
 * acentos, porque a pontuação é formatação do provedor; números escritos em
 * algarismos ou por extenso contam como diferentes (o livro precisa do
 * algarismo certo).
 */
export function normalizeWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1$2') // 1.228 → 1228
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

export interface WerResult {
  wer: number
  substitutions: number
  deletions: number
  insertions: number
  referenceWords: number
}

/** Taxa de erro de palavras: (S + D + I) / N, por distância de edição entre as listas de palavras. */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const r = normalizeWords(reference)
  const h = normalizeWords(hypothesis)
  // d[i][j] = custo para transformar r[0..i) em h[0..j); guarda o tipo da última operação
  let prev = Array.from({ length: h.length + 1 }, (_, j) => ({ cost: j, s: 0, d: 0, i: j }))
  for (let i = 1; i <= r.length; i++) {
    const cur = [{ cost: i, s: 0, d: i, i: 0 }]
    for (let j = 1; j <= h.length; j++) {
      const same = r[i - 1] === h[j - 1]
      const sub = { ...prev[j - 1]!, cost: prev[j - 1]!.cost + (same ? 0 : 1), s: prev[j - 1]!.s + (same ? 0 : 1) }
      const del = { ...prev[j]!, cost: prev[j]!.cost + 1, d: prev[j]!.d + 1 }
      const ins = { ...cur[j - 1]!, cost: cur[j - 1]!.cost + 1, i: cur[j - 1]!.i + 1 }
      cur.push([sub, del, ins].reduce((a, b) => (b.cost < a.cost ? b : a)))
    }
    prev = cur
  }
  const best = prev[h.length]!
  return {
    wer: r.length ? best.cost / r.length : h.length ? 1 : 0,
    substitutions: best.s,
    deletions: best.d,
    insertions: best.i,
    referenceWords: r.length,
  }
}

/**
 * Acerto nos termos jurídicos: das ocorrências de cada termo na referência,
 * quantas aparecem na transcrição. Termos de mais de uma palavra contam inteiros.
 */
export function termRecall(reference: string, hypothesis: string, terms: string[]): { recall: number; found: number; expected: number; missed: string[] } {
  const r = ` ${normalizeWords(reference).join(' ')} `
  const h = ` ${normalizeWords(hypothesis).join(' ')} `
  let found = 0
  let expected = 0
  const missed = new Set<string>()
  for (const term of terms) {
    const t = ` ${normalizeWords(term).join(' ')} `
    if (t.trim() === '') continue
    const inRef = count(r, t)
    if (!inRef) continue
    const inHyp = count(h, t)
    expected += inRef
    found += Math.min(inRef, inHyp)
    if (inHyp < inRef) missed.add(term)
  }
  return { recall: expected ? found / expected : 1, found, expected, missed: [...missed] }
}

function count(haystack: string, needle: string): number {
  let n = 0
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length - 1)) n++
  return n
}
