import { AUDIO_CHUNK_SAMPLES, AUDIO_SAMPLE_RATE } from '@livro/shared'

export interface Recorder {
  stop(): void
}

export interface RecorderOptions {
  /** Pedaço de PCM 16 bits, 16 kHz, mono, com AUDIO_CHUNK_MS de duração. */
  onChunk(pcm: ArrayBuffer): void
  /** Nível RMS do pedaço, de 0 a 1. */
  onLevel(level: number): void
  deviceId?: string
}

/**
 * Captura do microfone (F1.01): o AudioContext roda a 16 kHz, então o
 * navegador já reamostra a entrada; o AudioWorklet só converte para Int16 e
 * fatia em pedaços de 100 ms.
 */
export async function startRecorder({ onChunk, onLevel, deviceId }: RecorderOptions): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    },
  })
  const ctx = new AudioContext({ sampleRate: AUDIO_SAMPLE_RATE })
  try {
    await ctx.audioWorklet.addModule('/worklets/pcm-capture.js')
    // Alguns navegadores criam o contexto suspenso fora do clique do usuário.
    if (ctx.state === 'suspended') await ctx.resume()
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    throw err
  }
  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-capture', {
    processorOptions: { chunkSamples: AUDIO_CHUNK_SAMPLES },
  })
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    onChunk(e.data.pcm)
    onLevel(e.data.level)
  }
  source.connect(node)
  // O nó precisa estar ligado ao destino para o navegador processá-lo; a saída é silêncio.
  node.connect(ctx.destination)

  return {
    stop() {
      node.port.onmessage = null
      source.disconnect()
      node.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    },
  }
}
