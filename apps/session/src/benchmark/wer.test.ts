import { describe, expect, it } from 'vitest'
import { normalizeWords, termRecall, wordErrorRate } from './wer.ts'

describe('normalização', () => {
  it('ignora pontuação, maiúsculas e acentos; junta milhar', () => {
    expect(normalizeWords('Art. 1.228, do Código Civil!')).toEqual(['art', '1228', 'do', 'codigo', 'civil'])
  })
})

describe('WER', () => {
  it('texto igual: zero', () => {
    expect(wordErrorRate('A posse agrária.', 'a posse agraria').wer).toBe(0)
  })

  it('conta troca, falta e sobra', () => {
    const r = wordErrorRate('a posse agrária exige exploração', 'a pose agrária exploração efetiva')
    // dois alinhamentos empatam (1 troca + 1 falta + 1 sobra, ou 3 trocas): o total é o mesmo
    expect(r.substitutions + r.deletions + r.insertions).toBe(3)
    expect(r.referenceWords).toBe(5)
    expect(r.wer).toBeCloseTo(3 / 5)
  })

  it('transcrição vazia: tudo é falta', () => {
    expect(wordErrorRate('uma duas três', '').wer).toBe(1)
  })
})

describe('acerto nos termos jurídicos', () => {
  it('conta ocorrências inteiras, inclusive de mais de uma palavra', () => {
    const ref = 'A usucapião especial rural e a usucapião urbana. O REsp foi provido.'
    const hyp = 'A usucapião especial rural e a usucapiam urbana. O rex foi provido.'
    expect(termRecall(ref, hyp, ['usucapião', 'REsp', 'usucapião especial rural'])).toEqual({
      recall: 2 / 4,
      found: 2,
      expected: 4,
      missed: ['usucapião', 'REsp'],
    })
  })
})
