import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const PSQL = process.env.PSQL ?? 'psql'
const PG_DUMP = process.env.PG_DUMP ?? 'pg_dump'

/**
 * Tabelas do auth que não entram no backup: sessões e tokens expiram e seriam
 * inválidos na restauração; o histórico de migrações do auth pertence ao destino.
 */
export const AUTH_TABLES_EXCLUDED = [
  'auth.schema_migrations',
  'auth.sessions',
  'auth.refresh_tokens',
  'auth.mfa_amr_claims',
  'auth.mfa_challenges',
  'auth.flow_state',
  'auth.one_time_tokens',
  'auth.audit_log_entries',
]

/** Dados (sem esquema) de public e auth. O esquema vem das migrações do repositório. */
export async function dumpData(dbUrl: string, file: string) {
  await run(
    PG_DUMP,
    [
      dbUrl,
      '--data-only',
      '--schema=public',
      '--schema=auth',
      ...AUTH_TABLES_EXCLUDED.map((t) => `--exclude-table=${t}`),
      '--no-owner',
      '--no-privileges',
      `--file=${file}`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
}

/** Carrega o dump numa transação só, sem disparar gatilhos nem checar FKs durante a carga. */
export async function loadData(dbUrl: string, file: string) {
  await run(
    PSQL,
    [dbUrl, '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-c', 'SET session_replication_role = replica', '-f', file],
    { maxBuffer: 16 * 1024 * 1024 },
  )
}

export async function query(dbUrl: string, sql: string): Promise<string[][]> {
  const { stdout } = await run(PSQL, [dbUrl, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t', '-c', sql])
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
}

/** Contagem de linhas das tabelas de public e de auth.users, para conferir a restauração. */
export async function rowCounts(dbUrl: string): Promise<Record<string, number>> {
  const tables = (await query(dbUrl, "select 'public.' || quote_ident(tablename) from pg_tables where schemaname = 'public' order by 1"))
    .map((r) => r[0]!)
    .concat('auth.users', 'auth.identities')
  const sql = tables.map((t) => `select '${t}', count(*) from ${t}`).join(' union all ')
  return Object.fromEntries((await query(dbUrl, sql)).map(([t, n]) => [t!, Number(n)]))
}
