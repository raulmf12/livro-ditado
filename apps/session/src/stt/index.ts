import { mockSttFactory } from './mock.ts'
import type { SttFactory } from './types.ts'

export type { SttFactory, SttStream, SttStreamOptions, SttTranscript } from './types.ts'

/** Escolhe o provedor pela configuração. Deepgram, AssemblyAI e ElevenLabs entram em F1.03. */
export function sttFromEnv(env: NodeJS.ProcessEnv): { provider: string; create: SttFactory } {
  const provider = env.STT_PROVIDER ?? 'mock'
  switch (provider) {
    case 'mock':
      return { provider, create: mockSttFactory(required(env, 'MOCK_STT_URL')) }
    default:
      throw new Error(`STT_PROVIDER desconhecido: ${provider}`)
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name]
  if (!v) throw new Error(`variável de ambiente ${name} não definida`)
  return v
}
