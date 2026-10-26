// Sobe os simuladores para desenvolvimento local e para o Playwright.
import { createMockClaude } from './mock-claude.ts'
import { createMockSentry } from './mock-sentry.ts'
import { createMockStt } from './mock-stt.ts'

const sttPort = Number(new URL(process.env.MOCK_STT_CONTROL_URL ?? 'http://localhost:4010').port)
const claudePort = Number(process.env.MOCK_CLAUDE_PORT ?? 4020)
const sentryPort = Number(process.env.MOCK_SENTRY_PORT ?? 4040)

const stt = createMockStt({ defaultScenario: process.env.MOCK_STT_SCENARIO })
const claude = createMockClaude()
const sentry = createMockSentry()

await stt.listen(sttPort)
await claude.listen(claudePort)
await sentry.listen(sentryPort)
console.log(`simulador de STT em http://localhost:${sttPort} (WebSocket em /stt)`)
console.log(`simulador do Claude em http://localhost:${claudePort}/v1/messages`)
console.log(`simulador do Sentry em http://localhost:${sentryPort} (DSN http://public@localhost:${sentryPort}/1)`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void Promise.all([stt.close(), claude.close(), sentry.close()]).then(() => process.exit(0))
  })
}
