import { describe, expect, it } from 'vitest'
import { applySpellingRules, joinText, lastSentenceStart, removeHesitations } from './text.ts'

const rules = [
  { id: 'r1', spoken: 'rex', written: 'REsp' },
  { id: 'r2', spoken: 'recurso especial', written: 'REsp' },
  { id: 'r3', spoken: 'stj', written: 'STJ' },
]

describe('dicionário de grafia (F1.08)', () => {
  it('troca a palavra inteira e registra antes e depois', () => {
    const r = applySpellingRules('No Rex 1.234, o STJ decidiu.', rules)
    expect(r.text).toBe('No REsp 1.234, o STJ decidiu.')
    expect(r.changes).toEqual([{ kind: 'spelling', ruleId: 'r1', before: 'Rex', after: 'REsp', offset: 3 }])
  })

  it('não mexe em pedaço de palavra', () => {
    expect(applySpellingRules('O rexame do caso', rules).text).toBe('O rexame do caso')
  })

  it('expressão mais longa vence', () => {
    const r = applySpellingRules('No recurso especial e no rex', rules)
    expect(r.text).toBe('No REsp e no REsp')
    expect(r.changes.map((c) => c.ruleId)).toEqual(['r2', 'r1'])
  })

  it('sem regra, nada muda', () => {
    expect(applySpellingRules('texto qualquer', [])).toEqual({ text: 'texto qualquer', changes: [] })
  })
})

describe('hesitações (F1.09)', () => {
  it('tira só as da lista', () => {
    const r = removeHesitations('A posse, hã, é… exige é éé exploração hum.')
    expect(r.text).toBe('A posse, exige é exploração.')
    expect(r.changes.map((c) => c.before.trim())).toEqual(['hã,', 'é…', 'éé', 'hum'])
  })

  it('"é" verbo fica', () => {
    expect(removeHesitations('A posse é direito real.').text).toBe('A posse é direito real.')
  })

  it('no começo do trecho', () => {
    expect(removeHesitations('Hã, a posse').text).toBe('a posse')
  })
})

describe('junção e última frase', () => {
  it('junta com espaço', () => {
    expect(joinText('A posse.', 'O domínio.').text).toBe('A posse. O domínio.')
    expect(joinText('', 'O domínio.').text).toBe('O domínio.')
    expect(joinText('A posse ', 'agrária', 'exige.').text).toBe('A posse agrária exige.')
    expect(joinText('A posse', 'agrária', '.').text).toBe('A posse agrária.')
  })

  it('acha o começo da última frase sem cair em abreviação', () => {
    const t = 'A posse é direito. Conforme o art. 1.196, possuidor é quem exerce poder.'
    expect(t.slice(lastSentenceStart(t))).toBe('Conforme o art. 1.196, possuidor é quem exerce poder.')
    expect(lastSentenceStart('Uma frase só.')).toBe(0)
  })
})
