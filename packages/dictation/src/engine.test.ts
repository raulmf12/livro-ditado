import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, DictationEngine, type FinalSegment } from './engine.ts'
import { Manuscript } from './manuscript.ts'

/** Manuscrito em texto, uma linha por bloco: "# Capítulo", "## Seção", "p", "q", e notas indentadas. */
function outline(m: Manuscript): string[] {
  const lines: string[] = []
  for (const b of m.ordered()) {
    const num = typeof b.attrs.number === 'number' ? `${b.attrs.number} ` : ''
    const prefix = { chapter: '# ', section: '## ', subsection: '### ', paragraph: 'p: ', quote: 'q: ', note: 'n: ' }[b.type]
    lines.push(`${prefix}${num}${b.content}`)
    for (const n of m.notesOf(b.id)) lines.push(`  n@${n.attrs.anchor}: ${n.content}`)
  }
  return lines
}

function setup(settings = {}) {
  let n = 0
  const m = new Manuscript()
  const engine = new DictationEngine(m, { ...DEFAULT_SETTINGS, ...settings }, undefined, () => `b${++n}`)
  let t = 0
  /** Um final de 1 s, logo depois do anterior (sem pausa). */
  const say = (text: string, opts: { gapMs?: number; viaKey?: boolean } = {}) => {
    const startMs = t + (opts.gapMs ?? 0)
    const seg: FinalSegment = { text, startMs, endMs: startMs + 1000, viaKey: opts.viaKey ?? false }
    t = seg.endMs
    return engine.handleFinal(seg)
  }
  const pause = (ms: number) => {
    t += ms
    return engine.tick(t)
  }
  return { m, engine, say, pause }
}

describe('ditado corrido', () => {
  it('finais seguidos formam um parágrafo', () => {
    const { m, say } = setup()
    say('A função social da propriedade rural é princípio constitucional.')
    say('O imóvel deve ser explorado.')
    expect(outline(m)).toEqual(['p: A função social da propriedade rural é princípio constitucional. O imóvel deve ser explorado.'])
  })

  it('palavra do domínio não dispara comando (F1.15)', () => {
    const { m, say } = setup()
    const tx = say('O comando normativo do artigo 186 define a função social.')
    say('A coruja de Atena simboliza a sabedoria.')
    expect(tx[0]?.command).toBeUndefined()
    expect(outline(m)).toEqual(['p: O comando normativo do artigo 186 define a função social. A coruja de Atena simboliza a sabedoria.'])
  })
})

describe('estrutura (F1.12, F1.14)', () => {
  it('"Capítulo três, Da posse agrária. Fim." cria o título; o resto vira parágrafo do capítulo', () => {
    const { m, say } = setup()
    const tx = say('Atena, capítulo três, Da posse agrária. Fim. A posse agrária exige exploração efetiva.')
    expect(tx[0]?.feedback).toEqual({ status: 'executed', label: 'Capítulo 3: Da posse agrária' })
    expect(outline(m)).toEqual(['# 3 Da posse agrária', 'p: A posse agrária exige exploração efetiva.'])
    const [chapter, para] = m.ordered()
    expect(para!.parent_id).toBe(chapter!.id)
  })

  it('sem "fim", o título fecha depois de 2 s de pausa', () => {
    const { m, say, pause } = setup()
    expect(say('Atena, capítulo três, Da posse agrária')[0]?.feedback?.status).toBe('pending')
    expect(outline(m)).toEqual([])
    expect(pause(1500)).toEqual([])
    expect(pause(600)[0]?.feedback).toMatchObject({ status: 'executed', label: 'Capítulo 3: Da posse agrária' })
    say('A posse agrária exige exploração.', { gapMs: 0 })
    expect(outline(m)).toEqual(['# 3 Da posse agrária', 'p: A posse agrária exige exploração.'])
  })

  it('título continua no trecho seguinte se não houve pausa', () => {
    const { m, say, pause } = setup()
    say('Atena, capítulo três, Da posse')
    say('agrária e da propriedade. Fim.', { gapMs: 300 })
    pause(3000)
    expect(outline(m)).toEqual(['# 3 Da posse agrária e da propriedade'])
  })

  it('fala depois de uma pausa longa encerra o título e entra como texto', () => {
    const { m, say } = setup()
    say('Atena, capítulo um, Introdução')
    say('Este livro trata da posse.', { gapMs: 2500 })
    expect(outline(m)).toEqual(['# 1 Introdução', 'p: Este livro trata da posse.'])
  })

  it('seção e subseção ficam dentro do capítulo, na ordem ditada', () => {
    const { m, say } = setup()
    say('Atena, capítulo um, Da posse. Fim.')
    say('Texto de abertura.')
    say('Atena, seção um, Conceito. Fim.')
    say('Texto da seção.')
    say('Atena, subseção um, Requisitos. Fim.')
    say('Texto da subseção.')
    expect(outline(m)).toEqual([
      '# 1 Da posse',
      'p: Texto de abertura.',
      '## 1 Conceito',
      'p: Texto da seção.',
      '### 1 Requisitos',
      'p: Texto da subseção.',
    ])
    const chapter = m.ordered()[0]!
    expect(m.children(chapter.id)).toHaveLength(5)
  })

  it('novo parágrafo', () => {
    const { m, say } = setup()
    say('Primeiro parágrafo.')
    say('Atena, novo parágrafo.')
    say('Segundo parágrafo.')
    expect(outline(m)).toEqual(['p: Primeiro parágrafo.', 'p: Segundo parágrafo.'])
  })

  it('comando e texto no mesmo trecho', () => {
    const { m, say } = setup()
    say('Primeiro.')
    say('Atena, novo parágrafo. Segundo.')
    expect(outline(m)).toEqual(['p: Primeiro.', 'p: Segundo.'])
  })

  it('comando falado sem nenhum comando conhecido: o texto fica', () => {
    const { m, say } = setup()
    const tx = say('Atena era a deusa da sabedoria.')
    expect(tx[0]?.feedback?.status).toBe('ignored')
    expect(outline(m)).toEqual(['p: Atena era a deusa da sabedoria.'])
  })
})

describe('tecla de comando (F1.11)', () => {
  it('com a tecla segurada, o trecho é comando sem a palavra de ativação', () => {
    const viaWord = setup()
    viaWord.say('Atena, capítulo dois, Da propriedade. Fim.')
    const viaKey = setup()
    const tx = viaKey.say('capítulo dois, Da propriedade', { viaKey: true })
    expect(tx[0]?.command?.activation).toBe('key')
    expect(outline(viaKey.m)).toEqual(outline(viaWord.m))
    expect(outline(viaKey.m)).toEqual(['# 2 Da propriedade'])
  })

  it('tecla com fala que não é comando não vira texto', () => {
    const { m, say } = setup()
    expect(say('bom dia', { viaKey: true })[0]?.feedback?.label).toBe('Não entendi o comando')
    expect(outline(m)).toEqual([])
  })
})

describe('citação e nota', () => {
  it('citação longa: dentro dela só "fecha citação" é comando', () => {
    const { m, say } = setup()
    say('Diz o Código Civil:')
    say('Atena, abre citação.')
    say('O proprietário tem a faculdade de usar, gozar e dispor da coisa.')
    say('Atena, novo parágrafo.')
    say('Atena, fecha citação.')
    say('Como se vê, o direito é amplo.')
    expect(outline(m)).toEqual([
      'p: Diz o Código Civil:',
      'q: O proprietário tem a faculdade de usar, gozar e dispor da coisa. Atena, novo parágrafo.',
      'p: Como se vê, o direito é amplo.',
    ])
  })

  it('nota de rodapé presa ao ponto onde foi ditada', () => {
    const { m, say } = setup()
    say('A posse é exteriorização da propriedade.')
    say('Atena, nota.')
    say('Ver Ihering, Teoria simplificada da posse.')
    say('Atena, fim da nota.')
    say('Ela merece proteção.')
    const p = 'A posse é exteriorização da propriedade.'
    expect(outline(m)).toEqual([`p: ${p} Ela merece proteção.`, `  n@${p.length}: Ver Ihering, Teoria simplificada da posse.`])
  })
})

describe('edição por voz (F1.13)', () => {
  it('apaga a última frase, desfaz e refaz', () => {
    const { m, say } = setup()
    say('Primeira frase. Segunda frase.')
    say('Atena, apaga a última frase.')
    expect(outline(m)).toEqual(['p: Primeira frase.'])
    say('Atena, desfaz.')
    expect(outline(m)).toEqual(['p: Primeira frase. Segunda frase.'])
    say('Atena, refaz.')
    expect(outline(m)).toEqual(['p: Primeira frase.'])
  })

  it('desfazer também desfaz comando de estrutura', () => {
    const { m, say } = setup()
    say('Texto inicial.')
    say('Atena, capítulo um, Da posse. Fim.')
    expect(outline(m)).toEqual(['p: Texto inicial.', '# 1 Da posse'])
    say('Atena, desfaz.')
    expect(outline(m)).toEqual(['p: Texto inicial.'])
    say('Continua o texto.')
    expect(outline(m)).toEqual(['p: Texto inicial. Continua o texto.'])
  })

  it('desfazer o ditado tira o texto inteiro do trecho', () => {
    const { m, say } = setup()
    say('Fica.')
    say('Sai.')
    say('Atena, desfaz.')
    expect(outline(m)).toEqual(['p: Fica.'])
  })

  it('nada para desfazer', () => {
    const { say } = setup()
    expect(say('Atena, desfaz.')[0]?.feedback).toEqual({ status: 'ignored', label: 'Nada para desfazer' })
  })
})

describe('cursor de ditado (F1.17)', () => {
  it('o texto entra onde está o cursor de ditado', () => {
    const { m, engine, say } = setup()
    say('Início do parágrafo. Fim do parágrafo.')
    const p = m.ordered()[0]!
    engine.setCursor({ blockId: p.id, offset: 'Início do parágrafo.'.length })
    say('Meio do parágrafo.')
    expect(outline(m)).toEqual(['p: Início do parágrafo. Meio do parágrafo. Fim do parágrafo.'])
  })

  it('cursor num capítulo do meio: o novo parágrafo fica naquele capítulo', () => {
    const { m, engine, say } = setup()
    say('Atena, capítulo um, Primeiro. Fim.')
    say('Texto do um.')
    say('Atena, capítulo dois, Segundo. Fim.')
    say('Texto do dois.')
    const um = m.ordered()[0]!
    engine.setCursor({ blockId: um.id, offset: null })
    say('Abertura do um.')
    expect(outline(m)).toEqual(['# 1 Primeiro', 'p: Abertura do um.', 'p: Texto do um.', '# 2 Segundo', 'p: Texto do dois.'])
  })
})

describe('regras de texto no ditado', () => {
  it('grafia aprovada é aplicada e registrada (F1.08)', () => {
    const { m, say } = setup({ spellingRules: [{ id: 'r1', spoken: 'rex', written: 'REsp' }] })
    say('Primeiro.')
    const [tx] = say('No rex o tribunal decidiu.')
    expect(outline(m)).toEqual(['p: Primeiro. No REsp o tribunal decidiu.'])
    expect(tx!.insertion).toMatchObject({ spoken: 'No rex o tribunal decidiu.', written: 'No REsp o tribunal decidiu.' })
    expect(tx!.insertion!.changes).toEqual([{ kind: 'spelling', ruleId: 'r1', before: 'rex', after: 'REsp', offset: 'Primeiro. No '.length }])
  })

  it('hesitações só saem com a opção ligada (F1.09)', () => {
    const off = setup()
    off.say('A posse, hã, exige uso.')
    expect(outline(off.m)).toEqual(['p: A posse, hã, exige uso.'])
    const on = setup({ removeHesitations: true })
    on.say('A posse, hã, exige uso.')
    expect(outline(on.m)).toEqual(['p: A posse, exige uso.'])
  })

  it('guarda de fidelidade: o texto é exatamente os finais (sem os comandos)', () => {
    const { m, say } = setup()
    const finals = ['A posse agrária exige exploração.', 'Ela é qualificada pelo trabalho.', 'Atena, novo parágrafo.', 'O Estatuto da Terra trata do tema.']
    for (const f of finals) say(f)
    const text = m.ordered().map((b) => b.content).join(' ')
    expect(text).toBe(finals.filter((f) => !f.startsWith('Atena')).join(' '))
  })
})
