import { openProviderStream, query, type ProviderProtocol } from './base.ts'
import type { SttFactory, SttTranscript } from './types.ts'

/**
 * Adaptadores dos provedores de transcrição (F1.03). Todos pedem retenção zero
 * quando o provedor oferece a opção na conexão (T.03); veja docs/sigilo.md.
 *
 * As URLs base podem ser trocadas por variável de ambiente para apontar para o
 * simulador, que imita o formato de cada um.
 */

// ------------------------------------------------------------------ Deepgram

export interface DeepgramConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export function deepgramUrl(cfg: DeepgramConfig, keywords: string[], language: string, sampleRate: number): string {
  const base = cfg.baseUrl ?? 'wss://api.deepgram.com'
  return `${base}/v1/listen?${query({
    model: cfg.model ?? 'nova-3',
    language: language,
    encoding: 'linear16',
    sample_rate: sampleRate,
    channels: 1,
    interim_results: true,
    punctuate: true,
    smart_format: true,
    endpointing: 300,
    utterance_end_ms: 1000,
    // não participar do programa de melhoria de modelo: o áudio não fica com o provedor (T.03)
    mip_opt_out: true,
    keyterm: keywords.slice(0, 100),
  })}`
}

export function deepgram(cfg: DeepgramConfig): SttFactory {
  return (opts) => {
    // Deepgram manda vários is_final por fala; juntamos até speech_final (ou UtteranceEnd) num final só.
    let pending: { text: string[]; startMs: number; endMs: number } | null = null
    const flushPending = (emit: (t: SttTranscript) => void) => {
      if (!pending || !pending.text.length) return (pending = null)
      emit({ kind: 'final', text: pending.text.join(' '), startMs: pending.startMs, endMs: pending.endMs })
      pending = null
    }
    const protocol: ProviderProtocol = {
      audio: (chunk) => chunk,
      message(data, emit, fail, done) {
        const msg = JSON.parse(data) as {
          type: string
          is_final?: boolean
          speech_final?: boolean
          from_finalize?: boolean
          start?: number
          duration?: number
          channel?: { alternatives?: { transcript?: string }[] }
          description?: string
        }
        if (msg.type === 'Results') {
          const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
          const startMs = (msg.start ?? 0) * 1000
          const endMs = startMs + (msg.duration ?? 0) * 1000
          if (!msg.is_final) {
            if (text) emit({ kind: 'interim', text: [...(pending?.text ?? []), text].join(' '), startMs: pending?.startMs ?? startMs, endMs, payload: msg })
            return
          }
          if (text) {
            pending ??= { text: [], startMs, endMs }
            pending.text.push(text)
            pending.endMs = endMs
          }
          if (msg.speech_final || msg.from_finalize) flushPending(emit)
        } else if (msg.type === 'UtteranceEnd') {
          flushPending(emit)
        } else if (msg.type === 'Metadata') {
          flushPending(emit)
          done()
        } else if (msg.type === 'Error') {
          fail(new Error(`Deepgram: ${msg.description ?? 'erro'}`))
        }
      },
      flushMessages: () => [JSON.stringify({ type: 'Finalize' })],
      finishMessages: () => [JSON.stringify({ type: 'Finalize' }), JSON.stringify({ type: 'CloseStream' })],
      closed: (emit) => flushPending(emit),
      // sem áudio por 10 s o Deepgram fecha a conexão
      keepAlive: { message: JSON.stringify({ type: 'KeepAlive' }), idleMs: 4_000 },
    }
    return openProviderStream(deepgramUrl(cfg, opts.keywords, opts.language, opts.sampleRate), { Authorization: `Token ${cfg.apiKey}` }, protocol)
  }
}

// ------------------------------------------------------------------ AssemblyAI

export interface AssemblyAIConfig {
  apiKey: string
  baseUrl?: string
  model?: string
}

export function assemblyaiUrl(cfg: AssemblyAIConfig, keywords: string[], sampleRate: number): string {
  const base = cfg.baseUrl ?? 'wss://streaming.assemblyai.com'
  const terms = keywords.filter((k) => k.length <= 50).slice(0, 100)
  return `${base}/v3/ws?${query({
    sample_rate: sampleRate,
    encoding: 'pcm_s16le',
    speech_model: cfg.model ?? 'universal-3-6-pro',
    language_codes: JSON.stringify(['pt']),
    keyterms_prompt: terms.length ? JSON.stringify(terms) : undefined,
  })}`
}

export function assemblyai(cfg: AssemblyAIConfig): SttFactory {
  return (opts) => {
    const protocol: ProviderProtocol = {
      audio: (chunk) => chunk,
      message(data, emit, fail, done) {
        const msg = JSON.parse(data) as {
          type?: string
          transcript?: string
          end_of_turn?: boolean
          words?: { start: number; end: number }[]
          error?: string
        }
        if (msg.type === 'Turn') {
          const text = msg.transcript?.trim() ?? ''
          if (!text) return
          const startMs = msg.words?.[0]?.start ?? 0
          const endMs = msg.words?.at(-1)?.end ?? startMs
          emit({ kind: msg.end_of_turn ? 'final' : 'interim', text, startMs, endMs, payload: msg })
        } else if (msg.type === 'Termination') {
          done()
        } else if (msg.error) {
          fail(new Error(`AssemblyAI: ${msg.error}`))
        }
      },
      flushMessages: () => [JSON.stringify({ type: 'ForceEndpoint' })],
      finishMessages: () => [JSON.stringify({ type: 'ForceEndpoint' }), JSON.stringify({ type: 'Terminate' })],
    }
    return openProviderStream(assemblyaiUrl(cfg, opts.keywords, opts.sampleRate), { Authorization: cfg.apiKey }, protocol)
  }
}

// ------------------------------------------------------------------ ElevenLabs

export interface ElevenLabsConfig {
  apiKey: string
  baseUrl?: string
  /** enable_logging=false (retenção zero) exige plano enterprise na ElevenLabs. */
  zeroRetention?: boolean
}

export function elevenlabsUrl(cfg: ElevenLabsConfig, keywords: string[]): string {
  const base = cfg.baseUrl ?? 'wss://api.elevenlabs.io'
  return `${base}/v1/speech-to-text/realtime?${query({
    model_id: 'scribe_v2_realtime',
    language_code: 'pt',
    audio_format: 'pcm_16000',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: 0.8,
    include_timestamps: true,
    enable_logging: !(cfg.zeroRetention ?? true),
    keyterms: keywords.slice(0, 100),
  })}`
}

export function elevenlabs(cfg: ElevenLabsConfig): SttFactory {
  return (opts) => {
    const errorTypes = new Set([
      'error', 'auth_error', 'quota_exceeded', 'commit_throttled', 'unaccepted_terms', 'rate_limited',
      'queue_overflow', 'resource_exhausted', 'session_time_limit_exceeded', 'input_error',
      'invalid_request', 'chunk_size_exceeded', 'insufficient_audio_activity', 'transcriber_error',
    ])
    let finishing = false
    const protocol: ProviderProtocol = {
      audio: (chunk) =>
        JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: chunk.toString('base64'), commit: false, sample_rate: opts.sampleRate }),
      message(data, emit, fail, done) {
        const msg = JSON.parse(data) as {
          message_type: string
          text?: string
          words?: { start: number; end: number; type?: string }[] | null
          error?: string
        }
        if (msg.message_type === 'partial_transcript') {
          const text = msg.text?.trim()
          if (text) emit({ kind: 'interim', text, startMs: 0, endMs: 0, payload: msg })
        } else if (msg.message_type === 'committed_transcript_with_timestamps') {
          const text = msg.text?.trim() ?? ''
          const words = (msg.words ?? []).filter((w) => w.type !== 'spacing')
          if (text) emit({ kind: 'final', text, startMs: (words[0]?.start ?? 0) * 1000, endMs: (words.at(-1)?.end ?? 0) * 1000, payload: msg })
          if (finishing) done()
        } else if (errorTypes.has(msg.message_type)) {
          fail(new Error(`ElevenLabs ${msg.message_type}: ${msg.error ?? ''}`))
        }
      },
      flushMessages: () => [commitMessage(opts.sampleRate)],
      finishMessages: () => {
        finishing = true
        return [commitMessage(opts.sampleRate)]
      },
    }
    return openProviderStream(elevenlabsUrl(cfg, opts.keywords), { 'xi-api-key': cfg.apiKey }, protocol)
  }
}

function commitMessage(sampleRate: number) {
  return JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', commit: true, sample_rate: sampleRate })
}

// ------------------------------------------------------------------ simulador (formato neutro)

export function mock(url: string): SttFactory {
  return (opts) => {
    const protocol: ProviderProtocol = {
      audio: (chunk) => chunk,
      initialMessages: () => [JSON.stringify({ type: 'config', ...opts })],
      message(data, emit, fail, done) {
        const msg = JSON.parse(data) as ({ type: 'transcript' } & SttTranscript) | { type: 'error'; message: string } | { type: 'done' }
        if (msg.type === 'transcript') emit({ kind: msg.kind, text: msg.text, startMs: msg.startMs, endMs: msg.endMs, payload: msg })
        else if (msg.type === 'error') fail(new Error(`simulador de STT: ${msg.message}`))
        else if (msg.type === 'done') done()
      },
      flushMessages: () => [JSON.stringify({ type: 'flush' })],
      finishMessages: () => [JSON.stringify({ type: 'finish' })],
    }
    return openProviderStream(url, {}, protocol)
  }
}
