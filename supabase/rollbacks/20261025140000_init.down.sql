-- Reverte supabase/migrations/20261025140000_init.sql.
-- O bucket "audio" precisa estar vazio; o Supabase bloqueia apagar objetos por SQL,
-- então esvazie-o antes pela API do Storage (pnpm db:rollback faz isso).

drop policy if exists "áudio: dono da obra lê" on storage.objects;
drop policy if exists "áudio: dono da obra grava" on storage.objects;
drop policy if exists "áudio: dono da obra apaga" on storage.objects;

do $$
begin
  delete from storage.buckets where id = 'audio';
exception when others then
  raise notice 'bucket audio não removido (%); remova pela API do Storage', sqlerrm;
end $$;

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.search_logs;
drop table if exists public.spelling_rules;
drop table if exists public.glossary_terms;
drop table if exists public.bib_references;
drop table if exists public.commands;
drop table if exists public.blocks;
drop table if exists public.transcript_events;
drop table if exists public.audio_segments;
drop table if exists public.dictation_sessions;
drop table if exists public.books;
drop table if exists public.profiles;

drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();

drop type if exists public.command_status;
drop type if exists public.command_activation;
drop type if exists public.transcript_kind;
drop type if exists public.session_status;
drop type if exists public.block_status;
drop type if exists public.block_origin;
drop type if exists public.block_type;
drop type if exists public.app_role;
