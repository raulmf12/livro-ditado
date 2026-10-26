import { describe, expect, it } from 'vitest'
import { parseCommand, stripWakeWord } from './commands.ts'
import { parseNumber } from './numbers.ts'

describe('números falados', () => {
  it.each([
    ['tres', 3],
    ['3', 3],
    ['vinte e tres', 23],
    ['cento e cinco', 105],
    ['cem', 100],
    ['primeiro', 1],
    ['decimo segundo', 12],
    ['dezesseis', 16],
    ['dois mil e vinte e quatro', 2024],
    ['iv', 4],
    ['1.228', 1228],
    ['3o', 3],
  ])('"%s" = %i', (spoken, value) => {
    expect(parseNumber(spoken.split(' '))?.value).toBe(value)
  })

  it('não lê palavra comum como número', () => {
    expect(parseNumber(['da', 'posse'])).toBeNull()
  })
})

describe('palavra de ativação', () => {
  it.each([
    'Atena, capítulo três',
    'atena capítulo três',
    'Athena, capítulo três',
    'Atena. Capítulo três',
    'ATENA: capítulo três',
  ])('reconhece "%s"', (text) => {
    expect(stripWakeWord(text, 'Atena')).toMatch(/^[Cc]apítulo três$/)
  })

  it('só vale no começo do trecho (F1.15)', () => {
    expect(stripWakeWord('A coruja de Atena simboliza a sabedoria.', 'Atena')).toBeNull()
    expect(stripWakeWord('O comando normativo do artigo 186.', 'Atena')).toBeNull()
  })

  it('aceita outra palavra configurada', () => {
    expect(stripWakeWord('Minerva, novo parágrafo', 'Minerva')).toBe('novo parágrafo')
    expect(stripWakeWord('Atena, novo parágrafo', 'Minerva')).toBeNull()
  })
})

describe('comandos de estrutura (F1.12)', () => {
  it.each([
    ['capítulo três, Da posse agrária', 3, 'Da posse agrária'],
    ['Capítulo 3 — Da posse agrária.', 3, 'Da posse agrária'],
    ['capítulo terceiro: Da posse agrária', 3, 'Da posse agrária'],
    ['capítulo vinte e um Da função social', 21, 'Da função social'],
    ['capítulo três da posse agrária fim', 3, 'da posse agrária'],
  ])('"%s"', (text, number, title) => {
    expect(parseCommand(text)?.command).toEqual({ kind: 'heading', level: 'chapter', number, title })
  })

  it('título sem número', () => {
    expect(parseCommand('capítulo Introdução')?.command).toEqual({
      kind: 'heading',
      level: 'chapter',
      number: null,
      title: 'Introdução',
    })
  })

  it('seção e subseção', () => {
    expect(parseCommand('seção um, Conceito')?.command).toMatchObject({ level: 'section', number: 1, title: 'Conceito' })
    expect(parseCommand('subseção dois Requisitos')?.command).toMatchObject({ level: 'subsection', number: 2, title: 'Requisitos' })
    expect(parseCommand('sub seção dois Requisitos')?.command).toMatchObject({ level: 'subsection' })
  })

  it('título sem "fim" fica aberto; com "fim" fecha e o resto é ditado', () => {
    expect(parseCommand('capítulo três, Da posse')?.open).toBe(true)
    const text = 'capítulo três, Da posse agrária. Fim. A posse agrária exige exploração.'
    const r = parseCommand(text)!
    expect(r.open).toBe(false)
    expect(text.slice(r.end).trim()).toBe('. A posse agrária exige exploração.'.slice(2))
  })

  it.each([
    ['novo parágrafo', 'new_paragraph'],
    ['Novo parágrafo.', 'new_paragraph'],
    ['abre citação', 'open_quote'],
    ['abre aspas', 'open_quote'],
    ['fecha citação', 'close_quote'],
    ['fim da citação', 'close_quote'],
    ['nota', 'open_note'],
    ['nota de rodapé', 'open_note'],
    ['fim da nota', 'close_note'],
    ['apaga a última frase', 'delete_last_sentence'],
    ['desfaz', 'undo'],
    ['Desfazer.', 'undo'],
    ['refaz', 'redo'],
  ])('"%s" → %s', (text, kind) => {
    expect(parseCommand(text)?.command.kind).toBe(kind)
  })

  it('o que vem depois de um comando simples é ditado', () => {
    const text = 'novo parágrafo. A posse agrária'
    const r = parseCommand(text)!
    expect(r.command.kind).toBe('new_paragraph')
    expect(text.slice(r.end).replace(/^[.,\s]+/, '')).toBe('A posse agrária')
  })

  it('"fim" logo depois de comando simples é consumido', () => {
    const text = 'abre citação fim O proprietário'
    expect(text.slice(parseCommand(text)!.end).trim()).toBe('O proprietário')
  })

  it('frase que não é comando', () => {
    expect(parseCommand('era a deusa da sabedoria')).toBeNull()
    expect(parseCommand('capítulo')).toBeNull()
    expect(parseCommand('')).toBeNull()
  })
})
