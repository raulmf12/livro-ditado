// Sobe os simuladores para desenvolvimento local e para o Playwright.
import { createMockClaude } from './mock-claude.ts'
import { createMockSentry } from './mock-sentry.ts'
import { createMockStt } from './mock-stt.ts'
import { createNetCutter } from './net-cutter.ts'

const sttPort = Number(new URL(process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010').port)
const claudePort = Number(process.env.MOCK_CLAUDE_PORT ?? 4020)
const sentryPort = Number(process.env.MOCK_SENTRY_PORT ?? 4040)

const stt = createMockStt({ defaultScenario: process.env.MOCK_STT_SCENARIO })
const claude = createMockClaude()
const sentry = createMockSentry()
// navegador → 4002 → servidor de sessão (4001); os testes cortam a rede por aqui
const cutter = createNetCutter({
  listenPort: Number(process.env.NET_CUTTER_PORT ?? 4002),
  targetPort: Number(process.env.SESSION_PORT ?? 4001),
  controlPort: Number(process.env.NET_CUTTER_CONTROL_PORT ?? 4012),
})

await stt.listen(sttPort)
await claude.listen(claudePort)
await sentry.listen(sentryPort)
await cutter.listen()
console.log(`simulador de STT em http://localhost:${sttPort} (WebSocket em /stt)`)
console.log(`simulador do Claude em http://localhost:${claudePort}/v1/messages`)
console.log(`simulador do Sentry em http://localhost:${sentryPort} (DSN http://public@localhost:${sentryPort}/1)`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void Promise.all([stt.close(), claude.close(), sentry.close(), cutter.close()]).then(() => process.exit(0))
  })
}
