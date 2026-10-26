import Anthropic from '@anthropic-ai/sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMockClaude } from './mock-claude.ts'

let mock: ReturnType<typeof createMockClaude>
let client: Anthropic

beforeAll(async () => {
  mock = createMockClaude()
  const port = await mock.listen(0, '127.0.0.1')
  // O SDK oficial apontado para o simulador prova que o formato da resposta é compatível.
  client = new Anthropic({ apiKey: 'chave-de-teste', baseURL: `http://127.0.0.1:${port}` })
})
afterAll(() => mock.close())

const ask = (text: string, headers?: Record<string, string>) =>
  client.messages.create(
    { model: 'claude-sonnet-5-5', max_tokens: 512, messages: [{ role: 'user', content: text }] },
    { headers },
  )

describe('simulador do Claude', () => {
  it('interpreta o pedido do artigo 1.228 com tool use', async () => {
    const msg = await ask('Atena, busca o artigo 1.228 do Código Civil.')
    expect(msg.stop_reason).toBe('tool_use')
    expect(msg.content[0]).toMatchObject({
      type: 'tool_use',
      name: 'buscar_dispositivo',
      input: { norma: 'Código Civil', artigo: '1.228' },
    })
  })

  it('tem uma resposta maliciosa com trecho alterado', async () => {
    const msg = await ask('qualquer pedido', { 'x-mock-scenario': 'trecho-alterado' })
    const block = msg.content[0]
    expect(block?.type).toBe('tool_use')
    const trecho = (block as { input: { trecho: string } }).input.trecho
    expect(trecho).toContain('o dever de reavê-la')
    expect(trecho).not.toContain('o direito de reavê-la')
  })

  it('responde texto neutro quando nenhum cenário casa', async () => {
    const msg = await ask('bom dia')
    expect(msg.content[0]).toMatchObject({ type: 'text' })
    expect(mock.requests.at(-1)?.scenario).toBeNull()
  })
})
