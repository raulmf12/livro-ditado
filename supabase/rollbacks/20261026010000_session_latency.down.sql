-- Reverte supabase/migrations/20261026010000_session_latency.sql.
alter table public.dictation_sessions
  drop column if exists latency_p50_ms,
  drop column if exists latency_p95_ms,
  drop column if exists latency_samples;
