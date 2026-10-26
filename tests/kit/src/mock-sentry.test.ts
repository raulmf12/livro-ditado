import * as Sentry from '@sentry/node'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createMockSentry } from './mock-sentry.ts'

let mock: ReturnType<typeof createMockSentry>

beforeAll(async () => {
  mock = createMockSentry()
  const port = await mock.listen(0, '127.0.0.1')
  Sentry.init({ dsn: `http://public@127.0.0.1:${port}/1`, defaultIntegrations: false })
})
afterAll(async () => {
  await Sentry.close()
  await mock.close()
})

it('recebe do SDK oficial o erro com as tags', async () => {
  Sentry.captureException(new Error('falha de teste'), { tags: { sessionId: 'sessao-123' } })
  await Sentry.flush(2000)
  expect(mock.events).toHaveLength(1)
  expect(mock.events[0]?.tags).toMatchObject({ sessionId: 'sessao-123' })
  expect(mock.events[0]?.exception?.values?.[0]?.value).toBe('falha de teste')
})
