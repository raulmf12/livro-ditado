// Gera os .wav dos cenários com a voz sintética do macOS (Luciana, pt-BR).
// Os arquivos ficam versionados; rode de novo só quando mudar a fala de um cenário.
// O áudio real do autor (cenário noturno, F1.04) não passa por aqui.
//
// Dois formatos de cenário:
//  - "speech": um texto só; os eventos são escritos à mão no JSON.
//  - "segments": um trecho por resultado final. Cada trecho é sintetizado à
//    parte e emendado com uma pausa curta; os eventos (provisório no meio,
//    final no fim de cada trecho) são calculados da duração real e gravados no JSON.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUDIO_DIR, SCENARIOS_DIR, listScenarios, type SttScenarioEvent } from '../src/scenarios.ts'

const force = process.argv.includes('--force')
const only = process.argv.slice(2).find((a) => !a.startsWith('--'))
const SAMPLE_RATE = 16_000
const GAP_MS = 400

interface Segment {
  speech: string
  /** Texto final como o STT devolveria (números em algarismos etc.). Padrão: a própria fala. */
  text?: string
}

function say(text: string): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'say-'))
  const out = join(dir, 'fala.wav')
  execFileSync('say', ['-v', 'Luciana', '-r', '165', '--file-format=WAVE', `--data-format=LEI16@${SAMPLE_RATE}`, '-o', out, text], { timeout: 60_000 })
  return pcmOf(readFileSync(out))
}

/** PCM do WAV (pula os blocos que não são "data"). */
function pcmOf(wav: Buffer): Buffer {
  let at = 12
  while (at + 8 <= wav.length) {
    const id = wav.toString('ascii', at, at + 4)
    const size = wav.readUInt32LE(at + 4)
    if (id === 'data') return wav.subarray(at + 8, at + 8 + size)
    at += 8 + size + (size % 2)
  }
  throw new Error('WAV sem bloco de dados')
}

function wav(pcm: Buffer): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVEfmt ', 8)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(SAMPLE_RATE, 24)
  h.writeUInt32LE(SAMPLE_RATE * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

const ms = (bytes: number) => Math.round((bytes / 2 / SAMPLE_RATE) * 1000)

for (const scenario of listScenarios()) {
  if (only && scenario.name !== only) continue
  const raw = JSON.parse(readFileSync(join(SCENARIOS_DIR, `${scenario.name}.json`), 'utf8')) as {
    speech?: string
    segments?: Segment[]
    audio: string
    events?: SttScenarioEvent[]
  }
  const out = join(AUDIO_DIR, scenario.audio)
  if (existsSync(out) && !force) {
    console.log(`já existe: ${scenario.audio}`)
    continue
  }

  if (raw.segments) {
    const silence = Buffer.alloc(Math.round((GAP_MS / 1000) * SAMPLE_RATE) * 2)
    const parts: Buffer[] = []
    const events: SttScenarioEvent[] = []
    let bytes = 0
    for (const seg of raw.segments) {
      const pcm = say(seg.speech)
      const startMs = ms(bytes)
      const endMs = ms(bytes + pcm.length)
      const text = seg.text ?? seg.speech
      const words = text.split(' ')
      if (words.length > 3) {
        events.push({ atMs: Math.round((startMs + endMs) / 2), startMs, kind: 'interim', text: words.slice(0, Math.ceil(words.length / 2)).join(' ') })
      }
      events.push({ atMs: endMs, startMs, kind: 'final', text })
      parts.push(pcm, silence)
      bytes += pcm.length + silence.length
    }
    writeFileSync(out, wav(Buffer.concat(parts)))
    raw.events = events
    writeFileSync(join(SCENARIOS_DIR, `${scenario.name}.json`), JSON.stringify(raw, null, 2) + '\n')
    console.log(`gerado: ${scenario.audio} (${raw.segments.length} trechos, ${(ms(bytes) / 1000).toFixed(1)} s)`)
  } else if (raw.speech) {
    writeFileSync(out, wav(say(raw.speech)))
    console.log(`gerado: ${scenario.audio}`)
  }
}
