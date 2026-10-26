-- F0.06 — Latência fala → texto na tela, resumida por sessão de ditado.
-- Reverter: supabase/rollbacks/20261026010000_session_latency.down.sql
alter table public.dictation_sessions
  add column latency_p50_ms integer check (latency_p50_ms >= 0),
  add column latency_p95_ms integer check (latency_p95_ms >= 0),
  add column latency_samples integer not null default 0 check (latency_samples >= 0);
