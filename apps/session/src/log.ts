type Level = 'debug' | 'info' | 'warn' | 'error'

export type Logger = Record<Level, (msg: string, fields?: Record<string, unknown>) => void>

/** Logs estruturados em JSON, uma linha por evento. */
export function jsonLogger(base: Record<string, unknown> = {}): Logger {
  const write = (level: Level) => (msg: string, fields: Record<string, unknown> = {}) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...base, ...fields }, errorReplacer)
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n')
    else process.stdout.write(line + '\n')
  }
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }

function errorReplacer(_key: string, value: unknown) {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value
}
