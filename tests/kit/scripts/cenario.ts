// Escolhe o que o simulador de transcrição devolve em desenvolvimento.
//   pnpm cenario                    lista os cenários
//   pnpm cenario capitulo-completo  todas as obras passam a receber este cenário
import { listScenarios } from '../src/scenarios.ts'
import { mockSttControl } from '../src/mock-stt.ts'

const name = process.argv[2]
const scenarios = listScenarios()
if (!name) {
  console.log('Cenários disponíveis (o que o simulador "ouve"):\n')
  for (const s of scenarios) console.log(`  ${s.name.padEnd(20)} ${s.description}`)
  console.log('\nUso: pnpm cenario <nome>')
  process.exit(0)
}
if (!scenarios.some((s) => s.name === name)) {
  console.error(`cenário desconhecido: ${name}`)
  process.exit(2)
}
await mockSttControl(process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010').useScenario(name)
console.log(`simulador agora devolve "${name}" para qualquer obra (até reiniciar o pnpm dev)`)
