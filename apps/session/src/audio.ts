import { AUDIO_SAMPLE_RATE } from '@livro/shared'

const BYTES_PER_MS = (AUDIO_SAMPLE_RATE * 2) / 1000

/**
 * PCM recebido desde o último corte. A cada resultado final o trecho
 * correspondente sai daqui como um .wav para o Storage (F1.05).
 */
export class PcmBuffer {
  private chunks: Buffer[] = []
  private startMs = 0
  private bytes = 0

  /** Começo (no tempo do áudio da sessão) do que ainda está guardado. */
  get fromMs(): number {
    return this.startMs
  }

  get durationMs(): number {
    return this.bytes / BYTES_PER_MS
  }

  append(pcm: Buffer) {
    this.chunks.push(pcm)
    this.bytes += pcm.length
  }

  /** Tira do começo do buffer o áudio até `endMs` (tempo da sessão) e devolve como PCM. */
  cut(endMs: number): { startMs: number; pcm: Buffer } {
    const wanted = Math.max(0, Math.min(this.bytes, Math.round((endMs - this.startMs) * BYTES_PER_MS)))
    const aligned = wanted - (wanted % 2)
    const all = Buffer.concat(this.chunks)
    const pcm = all.subarray(0, aligned)
    const rest = all.subarray(aligned)
    const startMs = this.startMs
    this.chunks = rest.length ? [Buffer.from(rest)] : []
    this.bytes = rest.length
    this.startMs += aligned / BYTES_PER_MS
    return { startMs, pcm: Buffer.from(pcm) }
  }
}

/** Cabeçalho WAV (PCM 16 bits, mono) + dados. */
export function wav(pcm: Buffer, sampleRate = AUDIO_SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}
