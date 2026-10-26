-- Reverte supabase/migrations/20261026120000_fase1_manuscrito.sql.
-- O bucket "exports" precisa estar vazio (o Supabase bloqueia apagar objetos por SQL).

alter publication supabase_realtime drop table public.blocks;

drop policy if exists "exportações: dono da obra lê" on storage.objects;
drop policy if exists "exportações: dono da obra grava" on storage.objects;
drop policy if exists "exportações: dono da obra apaga" on storage.objects;
do $$
begin
  delete from storage.buckets where id = 'exports';
exception when others then
  raise notice 'bucket exports não removido (%); remova pela API do Storage', sqlerrm;
end $$;

drop table if exists public.exports;

alter table public.dictation_sessions
  drop column if exists stt_audio_ms,
  drop column if exists claude_input_tokens,
  drop column if exists claude_output_tokens;

drop index if exists public.audio_segments_block_id_idx;
alter table public.audio_segments
  drop column if exists block_id,
  drop column if exists char_start,
  drop column if exists char_end,
  drop column if exists is_command;

drop table if exists public.text_changes;

drop trigger if exists blocks_record_version on public.blocks;
drop function if exists public.record_block_version();
drop table if exists public.block_versions;

drop function if exists public.apply_ops(uuid, jsonb);
