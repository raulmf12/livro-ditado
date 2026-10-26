import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url))
export const SCENARIOS_DIR = join(FIXTURES_DIR, 'scenarios')
export const AUDIO_DIR = join(FIXTURES_DIR, 'audio')
export const CLAUDE_DIR = join(FIXTURES_DIR, 'claude')

export interface SttScenarioEvent {
  /** Quanto áudio (em ms) o simulador precisa ter recebido para emitir o evento. Também é o fim do trecho. */
  atMs: number
  /** Começo do trecho falado; sem ele, o trecho começa onde o anterior terminou (sem pausa). */
  startMs?: number
  kind: 'interim' | 'final'
  text: string
}

export interface SttScenario {
  name: string
  description: string
  audio: string
  /** Texto falado para gerar o áudio sintético (pnpm audio:gerar). */
  speech?: string
  events: SttScenarioEvent[]
  /** Se presente, o simulador derruba a conexão ao atingir este ponto do áudio. */
  failAtMs?: number
  /** Repete os eventos sem parar (sessões longas, T.05). */
  loop?: boolean
}

export function loadScenario(name: string): SttScenario {
  const raw = JSON.parse(readFileSync(join(SCENARIOS_DIR, `${name}.json`), 'utf8')) as Omit<SttScenario, 'name'>
  return { name, ...raw }
}

export function listScenarios(): SttScenario[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadScenario(f.replace(/\.json$/, '')))
}

/** Transcrição de referência: os finais do cenário, na ordem. Base da guarda de fidelidade (F1.10, E2E-11). */
export function referenceTranscript(scenario: SttScenario): string[] {
  return scenario.events.filter((e) => e.kind === 'final').map((e) => e.text)
}

export function audioPath(scenario: SttScenario): string {
  return join(AUDIO_DIR, scenario.audio)
}

/** Argumentos do Chromium para usar um arquivo .wav como microfone. */
export function fakeMicArgs(scenario: SttScenario): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${audioPath(scenario)}`,
  ]
}

/**
 * O que deve virar texto no manuscrito: os finais que não são comandos
 * (guarda de fidelidade, F1.10 e E2E-11). Comandos começam com a palavra de ativação.
 */
export function dictatedFinals(scenario: SttScenario, wakeWord = 'Atena'): string[] {
  const wake = new RegExp(`^${wakeWord}\\b`, 'i')
  return referenceTranscript(scenario).filter((t) => !wake.test(t.trim()))
}
