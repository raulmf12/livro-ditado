import { STT_USD_PER_MINUTE } from '@livro/shared'
import { assemblyai, deepgram, elevenlabs, mock } from './providers.ts'
import type { SttProvider } from './types.ts'

export { SttPipeline } from './pipeline.ts'
export type { SttFactory, SttProvider, SttStream, SttStreamOptions, SttTranscript } from './types.ts'

/**
 * Escolhe o provedor pela configuração (F1.03). Preços por minuto de áudio,
 * usados no painel de custos (T.04); confira na página de cada provedor.
 */
export function sttFromEnv(env: NodeJS.ProcessEnv): SttProvider {
  const name = env.STT_PROVIDER ?? 'mock'
  const price = () => Number(env.STT_USD_PER_MINUTE ?? STT_USD_PER_MINUTE[name] ?? 0)
  switch (name) {
    case 'mock':
      return { name, create: mock(required(env, 'MOCK_STT_URL')), usdPerMinute: price() }
    case 'deepgram':
      return {
        name,
        create: deepgram({ apiKey: required(env, 'DEEPGRAM_API_KEY'), baseUrl: env.DEEPGRAM_URL, model: env.DEEPGRAM_MODEL }),
        usdPerMinute: price(),
      }
    case 'assemblyai':
      return {
        name,
        create: assemblyai({ apiKey: required(env, 'ASSEMBLYAI_API_KEY'), baseUrl: env.ASSEMBLYAI_URL, model: env.ASSEMBLYAI_MODEL }),
        usdPerMinute: price(),
      }
    case 'elevenlabs':
      return {
        name,
        create: elevenlabs({
          apiKey: required(env, 'ELEVENLABS_API_KEY'),
          baseUrl: env.ELEVENLABS_URL,
          zeroRetention: env.ELEVENLABS_ZERO_RETENTION !== 'false',
        }),
        usdPerMinute: price(),
      }
    default:
      throw new Error(`STT_PROVIDER desconhecido: ${name}`)
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name]
  if (!v) throw new Error(`variável de ambiente ${name} não definida`)
  return v
}
