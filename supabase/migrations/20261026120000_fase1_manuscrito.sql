-- Fase 1 — manuscrito, histórico, áudio por trecho, registro de trocas, exportações e custos.
-- Reverter: supabase/rollbacks/20261026120000_fase1_manuscrito.down.sql

-- ---------------------------------------------------------------- operações do manuscrito (F1.16)
-- Grava uma transação do editor ou do ditado de uma vez só. Roda com as
-- permissões de quem chama (RLS do dono da obra vale normalmente).
create function public.apply_ops(p_book_id uuid, p_ops jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  op jsonb;
  b jsonb;
begin
  if not exists (select 1 from public.books where id = p_book_id) then
    raise exception 'obra não encontrada' using errcode = '42501';
  end if;
  for op in select value from jsonb_array_elements(p_ops) loop
    case op ->> 'op'
      when 'insert' then
        b := op -> 'block';
        insert into public.blocks (id, book_id, parent_id, type, position, content, attrs, origin, status)
        values (
          (b ->> 'id')::uuid, p_book_id, (b ->> 'parent_id')::uuid, (b ->> 'type')::public.block_type,
          b ->> 'position', coalesce(b ->> 'content', ''), coalesce(b -> 'attrs', '{}'::jsonb),
          coalesce((b ->> 'origin')::public.block_origin, 'author'),
          coalesce((b ->> 'status')::public.block_status, 'final')
        );
      when 'update' then
        update public.blocks
          set content = op -> 'after' ->> 'content',
              attrs = coalesce(op -> 'after' -> 'attrs', attrs)
          where id = (op ->> 'id')::uuid and book_id = p_book_id;
        if not found then
          raise exception 'bloco não encontrado: %', op ->> 'id' using errcode = 'P0002';
        end if;
      when 'delete' then
        delete from public.blocks where id = (op -> 'block' ->> 'id')::uuid and book_id = p_book_id;
      when 'move' then
        update public.blocks
          set parent_id = (op -> 'to' ->> 'parent_id')::uuid, position = op -> 'to' ->> 'position'
          where id = (op ->> 'id')::uuid and book_id = p_book_id;
        if not found then
          raise exception 'bloco não encontrado: %', op ->> 'id' using errcode = 'P0002';
        end if;
      else
        raise exception 'operação desconhecida: %', op ->> 'op' using errcode = '22023';
    end case;
  end loop;
end $$;

revoke execute on function public.apply_ops(uuid, jsonb) from public, anon;
grant execute on function public.apply_ops(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- histórico de versões (F1.20)
create table public.block_versions (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.books (id) on delete cascade,
  block_id uuid not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index block_versions_book_id_changed_at_idx on public.block_versions (book_id, changed_at desc);
create index block_versions_block_id_idx on public.block_versions (block_id);

create function public.record_block_version() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.content = new.content and old.attrs = new.attrs
     and old.parent_id is not distinct from new.parent_id and old.position = new.position
     and old.status = new.status then
    return new;
  end if;
  insert into public.block_versions (book_id, block_id, action, old_row, new_row)
  values (
    coalesce(new.book_id, old.book_id),
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger blocks_record_version
  after insert or update or delete on public.blocks
  for each row execute function public.record_block_version();

alter table public.block_versions enable row level security;
revoke all on public.block_versions from anon;
revoke update, delete on public.block_versions from authenticated;
-- o histórico só cresce: o dono lê e o gatilho acrescenta; ninguém altera nem apaga
create policy "histórico: dono lê" on public.block_versions
  for select to authenticated
  using (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())));
create policy "histórico: gatilho acrescenta" on public.block_versions
  for insert to authenticated
  with check (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------- trocas de texto (F1.08, F1.09, F1.10)
create table public.text_changes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  session_id uuid references public.dictation_sessions (id) on delete set null,
  block_id uuid references public.blocks (id) on delete set null,
  rule_id uuid references public.spelling_rules (id) on delete set null,
  kind text not null check (kind in ('spelling', 'hesitation')),
  before text not null,
  after text not null,
  offset_at integer not null check (offset_at >= 0),
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index text_changes_book_id_idx on public.text_changes (book_id, created_at desc);
create index text_changes_session_id_idx on public.text_changes (session_id);
create index text_changes_block_id_idx on public.text_changes (block_id);
create index text_changes_rule_id_idx on public.text_changes (rule_id);

-- ---------------------------------------------------------------- áudio ligado ao texto (F1.05)
alter table public.audio_segments
  add column block_id uuid references public.blocks (id) on delete set null,
  add column char_start integer check (char_start >= 0),
  add column char_end integer check (char_end >= char_start),
  add column is_command boolean not null default false;
create index audio_segments_block_id_idx on public.audio_segments (block_id);

-- ---------------------------------------------------------------- custos por sessão (T.04)
alter table public.dictation_sessions
  add column stt_audio_ms integer not null default 0 check (stt_audio_ms >= 0),
  add column claude_input_tokens integer not null default 0 check (claude_input_tokens >= 0),
  add column claude_output_tokens integer not null default 0 check (claude_output_tokens >= 0);

-- ---------------------------------------------------------------- exportações (F1.25)
create table public.exports (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  chapter_id uuid references public.blocks (id) on delete set null,
  scope text not null check (scope in ('book', 'chapter')),
  citation_style text not null default 'footnote' check (citation_style in ('footnote', 'author_date')),
  trigger text not null check (trigger in ('manual', 'session_end')),
  status text not null check (status in ('done', 'failed')),
  storage_path text,
  size_bytes integer,
  duration_ms integer,
  error text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index exports_book_id_idx on public.exports (book_id, created_at desc);
create index exports_chapter_id_idx on public.exports (chapter_id);
create index exports_created_by_idx on public.exports (created_by);

alter table public.text_changes enable row level security;
alter table public.exports enable row level security;
revoke all on public.text_changes, public.exports from anon;
create policy "dono da obra" on public.text_changes for all to authenticated
  using (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())))
  with check (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())));
create policy "dono da obra" on public.exports for all to authenticated
  using (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())))
  with check (book_id in (select b.id from public.books b where b.owner_id = (select auth.uid())));

insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do nothing;

create policy "exportações: dono da obra lê" on storage.objects
  for select to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));
create policy "exportações: dono da obra grava" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'exports' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));
create policy "exportações: dono da obra apaga" on storage.objects
  for delete to authenticated
  using (bucket_id = 'exports' and (storage.foldername(name))[1] in
    (select b.id::text from public.books b where b.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------- sincronização ao vivo (F1.21)
alter publication supabase_realtime add table public.blocks;
