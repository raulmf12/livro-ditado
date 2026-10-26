// Gera os .wav dos cenários com a voz sintética do macOS (Luciana, pt-BR).
// Os arquivos ficam versionados; rode de novo só quando mudar a fala de um cenário.
// O áudio real do autor (cenário noturno, F1.04) não passa por aqui.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AUDIO_DIR, listScenarios } from '../src/scenarios.ts'

const force = process.argv.includes('--force')

for (const scenario of listScenarios()) {
  if (!scenario.speech) continue
  const out = join(AUDIO_DIR, scenario.audio)
  if (existsSync(out) && !force) {
    console.log(`já existe: ${scenario.audio}`)
    continue
  }
  execFileSync('say', [
    '-v',
    'Luciana',
    '-r',
    '165',
    '--file-format=WAVE',
    '--data-format=LEI16@16000',
    '-o',
    out,
    scenario.speech,
  ], { timeout: 60_000 })
  console.log(`gerado: ${scenario.audio}`)
}
