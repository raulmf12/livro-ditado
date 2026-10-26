-- Reverte supabase/migrations/20261026150000_benchmark_bucket.sql (o bucket precisa estar vazio).
do $$
begin
  delete from storage.buckets where id = 'benchmark';
exception when others then
  raise notice 'bucket benchmark não removido (%); esvazie pela API do Storage', sqlerrm;
end $$;
