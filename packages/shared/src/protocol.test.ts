import { describe, expect, it } from 'vitest'
import { AUDIO_CHUNK_SAMPLES, ClientMessage, authProtocol, tokenFromProtocols } from './protocol.ts'

describe('tokenFromProtocols', () => {
  it('extrai o token ao lado da versão do protocolo', () => {
    expect(tokenFromProtocols(`livro.v1, ${authProtocol('abc.def.ghi')}`)).toBe('abc.def.ghi')
  })

  it('devolve null sem token', () => {
    expect(tokenFromProtocols(undefined)).toBeNull()
    expect(tokenFromProtocols('livro.v1')).toBeNull()
    expect(tokenFromProtocols('livro.v1, auth.')).toBeNull()
  })
})

describe('ClientMessage', () => {
  it('aceita start com uuid e recusa sem', () => {
    expect(ClientMessage.safeParse({ type: 'start', bookId: crypto.randomUUID() }).success).toBe(true)
    expect(ClientMessage.safeParse({ type: 'start', bookId: 'obra-1' }).success).toBe(false)
    expect(ClientMessage.safeParse({ type: 'apaga-tudo' }).success).toBe(false)
  })
})

it('pedaço de áudio tem 100 ms a 16 kHz', () => {
  expect(AUDIO_CHUNK_SAMPLES).toBe(1600)
})
