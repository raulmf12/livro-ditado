-- F0.04 — Esquema inicial do sistema de ditado.
-- Reverter: supabase/rollbacks/20261025140000_init.down.sql
--
-- Regra de acesso: todo dado pertence a uma obra (books) e só o dono da obra
-- o enxerga. Não há leitura administrativa de manuscritos (sigilo do livro, T.03).

-- ---------------------------------------------------------------- tipos
create type public.app_role as enum ('autor', 'admin');
create type public.block_type as enum ('chapter', 'section', 'subsection', 'paragraph', 'quote', 'note');
create type public.block_origin as enum ('author', 'ai');
create type public.block_status as enum ('final', 'pending', 'approved', 'rejected');
create type public.session_status as enum ('active', 'ended', 'interrupted');
create type public.transcript_kind as enum ('interim', 'final');
create type public.command_activation as enum ('wake_word', 'key', 'pedal');
create type public.command_status as enum ('executed', 'ignored', 'failed');

create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- perfis
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'autor',
  display_name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', new.email));
  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- obras
create table public.books (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (length(btrim(title)) > 0),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index books_owner_id_idx on public.books (owner_id);
create trigger books_set_updated_at before update on public.books
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- sessões e áudio
create table public.dictation_sessions (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  device text,
  stt_provider text not null,
  status public.session_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create index dictation_sessions_book_id_idx on public.dictation_sessions (book_id);
create index dictation_sessions_user_id_idx on public.dictation_sessions (user_id);

create table public.audio_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.dictation_sessions (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  seq integer not null check (seq >= 0),
  storage_path text not null,
  start_ms integer not null check (start_ms >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, seq)
);
create index audio_segments_book_id_idx on public.audio_segments (book_id);

create table public.transcript_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.dictation_sessions (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  kind public.transcript_kind not null,
  text text not null,
  start_ms integer,
  end_ms integer,
  provider_payload jsonb,
  created_at timestamptz not null default now()
);
create index transcript_events_session_id_idx on public.transcript_events (session_id);
create index transcript_events_book_id_idx on public.transcript_events (book_id);

-- ---------------------------------------------------------------- manuscrito
-- Árvore de blocos com ordem fracionária: "position" é uma chave de texto
-- comparada byte a byte (collate "C"), então inserir entre dois blocos
-- não renumera nada.
create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  parent_id uuid,
  type public.block_type not null,
  position text collate "C" not null,
  content text not null default '',
  attrs jsonb not null default '{}'::jsonb,
  origin public.block_origin not null default 'author',
  status public.block_status not null default 'final',
  audio_segment_id uuid references public.audio_segments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, book_id),
  -- o pai precisa ser da mesma obra
  foreign key (parent_id, book_id) references public.blocks (id, book_id) on delete cascade,
  unique nulls not distinct (book_id, parent_id, position),
  -- texto do autor é sempre final; texto da IA nasce pendente e só muda por aprovação
  constraint blocks_origin_status_check check (
    (origin = 'author' and status = 'final')
    or (origin = 'ai' and status in ('pending', 'approved', 'rejected'))
  )
);
create index blocks_parent_id_book_id_idx on public.blocks (parent_id, book_id);
create index blocks_audio_segment_id_idx on public.blocks (audio_segment_id);
create trigger blocks_set_updated_at before update on public.blocks
  for each row execute function public.set_updated_at();

create table public.commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.dictation_sessions (id) on delete cascade,
  book_id uuid not null references public.books (id) on delete cascade,
  raw_text text not null,
  activation public.command_activation not null,
  parsed jsonb,
  status public.command_status not null,
  created_at timestamptz not null default now()
);
create index commands_session_id_idx on public.commands (session_id);
create index commands_book_id_idx on public.commands (book_id);

-- "references" é palavra reservada no SQL; a tabela de referências CSL-JSON se chama bib_references.
create table public.bib_references (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  block_id uuid references public.blocks (id) on delete cascade,
  kind text not null,
  csl jsonb not null,
  source_url text,
  accessed_at date,
  created_at timestamptz not null default now()
);
create index bib_references_book_id_idx on public.bib_references (book_id);
create index bib_references_block_id_idx on public.bib_references (block_id);

create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  chapter_id uuid references public.blocks (id) on delete cascade,
  term text not null check (length(btrim(term)) > 0),
  created_at timestamptz not null default now(),
  unique nulls not distinct (book_id, chapter_id, term)
);
create index glossary_terms_chapter_id_idx on public.glossary_terms (chapter_id);

create table public.spelling_rules (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  spoken text not null check (length(btrim(spoken)) > 0),
  written text not null,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  unique (book_id, spoken)
);

create table public.search_logs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  session_id uuid references public.dictation_sessions (id) on delete set null,
  spoken_text text not null,
  search_kind text not null,
  query jsonb,
  result_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index search_logs_book_id_idx on public.search_logs (book_id);
create index search_logs_user_id_idx on public.search_logs (user_id);
create index search_logs_session_id_idx on public.search_logs (session_id);

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.books enable row level security;
alter table public.dictation_sessions enable row level security;
alter table public.audio_segments enable row level security;
alter table public.transcript_events enable row level security;
alter table public.blocks enable row level security;
alter table public.commands enable row level security;
alter table public.bib_references enable row level security;
alter table public.glossary_terms enable row level security;
alter table public.spelling_rules enable row level security;
alter table public.search_logs enable row level security;

-- Visitante sem login não toca em nada.
revoke all on public.profiles, public.books, public.dictation_sessions, public.audio_segments,
  public.transcript_events, public.blocks, public.commands, public.bib_references,
  public.glossary_terms, public.spelling_rules, public.search_logs
  from anon;

-- Perfil: cada um lê o seu e só pode mudar o nome (o papel é definido pelo admin, via service role).
create policy "perfil: dono lê" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "perfil: dono altera o nome" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy "obra: só o dono" on public.books
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- As demais tabelas valem pelo dono da obra.
do $$
declare
  t text;
begin
  foreach t in array array[
    'dictation_sessions', 'audio_segments', 'transcript_events', 'blocks', 'commands',
    'bib_references', 'glossary_terms', 'spelling_rules', 'search_logs'
  ] loop
    execute format(
      'create policy "dono da obra" on public.%I for all to authenticated
         using (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())))
         with check (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())))',
      t);
  end loop;
end $$;

-- Sessões e buscas só podem ser abertas em nome de quem está logado.
create policy "sessão em nome próprio" on public.dictation_sessions
  as restrictive for insert to authenticated with check (user_id = (select auth.uid()));
create policy "busca em nome próprio" on public.search_logs
  as restrictive for insert to authenticated with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- Storage do áudio
-- Caminho dos objetos: <book_id>/<session_id>/<seq>.wav
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

create policy "áudio: dono da obra lê" on storage.objects
  for select to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));
create policy "áudio: dono da obra grava" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));
create policy "áudio: dono da obra apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'audio' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));
