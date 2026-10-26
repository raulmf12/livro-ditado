import type { TranscriptKind } from '@livro/shared'

export interface SttStreamOptions {
  bookId: string
  sessionId: string
  sampleRate: number
  language: string
  /** Termos do glossário enviados ao provedor (F1.07). */
  keywords: string[]
}

export interface SttTranscript {
  kind: TranscriptKind
  text: string
  /** Tempo dentro do áudio enviado a ESTE stream (o pipeline soma o deslocamento). */
  startMs: number
  endMs: number
  /** Resposta original do provedor, guardada para auditoria. */
  payload?: unknown
}

/**
 * Interface única de transcrição (F1.03). Cada provedor (Deepgram,
 * AssemblyAI, ElevenLabs, simulador) implementa esta interface e nada fora
 * do adaptador conhece o formato do provedor.
 */
export interface SttStream {
  send(chunk: Buffer): void
  /** Pede ao provedor que feche o trecho atual agora (fim da tecla de comando). */
  flush(): void
  /** Avisa o fim do áudio e espera os últimos resultados finais. */
  finish(): Promise<void>
  close(): void
  onTranscript(listener: (t: SttTranscript) => void): void
  onError(listener: (err: Error) => void): void
}

export type SttFactory = (opts: SttStreamOptions) => Promise<SttStream>

/** Configuração de um provedor: como abrir o stream e o que ele cobra por minuto (T.04). */
export interface SttProvider {
  name: string
  create: SttFactory
  usdPerMinute: number
}
