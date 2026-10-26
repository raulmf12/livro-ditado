-- F1.04 / E2E-13 — Áudio do autor para o benchmark e o teste noturno.
-- Bucket privado e SEM políticas: só a chave secreta (CI noturno, scripts) acessa.
-- O repositório é público; o áudio do autor nunca vai para ele.
-- Reverter: supabase/rollbacks/20261026150000_benchmark_bucket.down.sql
insert into storage.buckets (id, name, public)
values ('benchmark', 'benchmark', false)
on conflict (id) do nothing;
