-- Moments — database & security (Phase 1)
-- Paste into the Supabase SQL editor. Idempotent: safe to run repeatedly.
-- The two user IDs in section 8 come from Auth > Users (Samarth, Shreyasi).

-- ───────────────────────────────────────────────────────────────────
-- 1. Allow-list
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.members (
  user_id uuid primary key references auth.users on delete cascade
);
alter table public.members enable row level security;  -- intentionally no policies

-- Lives in a non-exposed schema: RLS policies can call it, but it is NOT
-- reachable as /rest/v1/rpc/is_member (keeps the Security Advisor clean).
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- The only SECURITY DEFINER function: returns a boolean, nothing else.
create or replace function private.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members where user_id = (select auth.uid()));
$$;
revoke execute on function private.is_member() from public, anon;
grant  execute on function private.is_member() to authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 2. Tables
-- ───────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  theme text not null default 'a',            -- key into themes in the frontend
  avatar_path text,
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users default auth.uid(),
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 10000),
  happened_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities on delete cascade,
  author_id uuid not null references auth.users default auth.uid(),
  storage_path text not null,
  width int,
  height int,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities on delete cascade,
  author_id uuid not null references auth.users default auth.uid(),
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
-- Added in Phase 4 (shown as "edited" in the UI); safe on databases created earlier.
alter table public.comments add column if not exists edited_at timestamptz;

-- Meet feedback (Phase 6): one member asks the other for feedback on a post, writing 1-5 questions.
create table if not exists public.feedback_requests (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.activities on delete cascade,
  requester_id uuid not null references auth.users default auth.uid(),
  recipient_id uuid not null references public.profiles on delete cascade,   -- only members have a profile
  questions jsonb not null,
  answers jsonb,
  status text not null default 'pending' check (status in ('pending', 'answered')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  check (recipient_id <> requester_id),
  check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) between 1 and 5
         and length(questions::text) <= 2500
         and not jsonb_path_exists(questions, '$[*] ? (@.type() != "string")')),
  check (answers is null or (jsonb_typeof(answers) = 'array'
         and jsonb_array_length(answers) = jsonb_array_length(questions)
         and length(answers::text) <= 12000
         and not jsonb_path_exists(answers, '$[*] ? (@.type() != "string")')))
);

-- ───────────────────────────────────────────────────────────────────
-- 3. Indexes
-- ───────────────────────────────────────────────────────────────────
create index if not exists activities_happened_at_idx on public.activities (happened_at desc);
create index if not exists photos_activity_id_idx     on public.photos (activity_id);
create index if not exists comments_activity_created_idx on public.comments (activity_id, created_at);
create index if not exists feedback_activity_idx on public.feedback_requests (activity_id);
create index if not exists feedback_recipient_idx on public.feedback_requests (recipient_id, status);

-- ───────────────────────────────────────────────────────────────────
-- 4. updated_at maintenance (SECURITY INVOKER, no elevated rights)
-- ───────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists activities_set_updated_at on public.activities;
create trigger activities_set_updated_at before update on public.activities
  for each row execute function public.set_updated_at();

-- edited_at is set only when the text actually changes, and can't be set from the client.
create or replace function public.set_comment_edited_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.edited_at := case when new.body is distinct from old.body then now() else old.edited_at end;
  return new;
end;
$$;

drop trigger if exists comments_set_edited_at on public.comments;
create trigger comments_set_edited_at before update on public.comments
  for each row execute function public.set_comment_edited_at();

-- Submitting answers marks the request answered; nothing else about a request can be changed.
create or replace function public.set_feedback_answered() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.answers is not null and old.answers is null then
    new.status := 'answered';
    new.answered_at := now();
  else
    new.status := old.status;
    new.answered_at := old.answered_at;
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_set_answered on public.feedback_requests;
create trigger feedback_set_answered before update on public.feedback_requests
  for each row execute function public.set_feedback_answered();

-- ───────────────────────────────────────────────────────────────────
-- 5. Row-level security (every table in public)
--    Reads:  any member.
--    Writes: a member, on their own rows only.
-- ───────────────────────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.activities enable row level security;
alter table public.photos     enable row level security;
alter table public.comments   enable row level security;

-- profiles (owner column is `id`)
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_insert on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (private.is_member());
create policy profiles_insert on public.profiles for insert to authenticated
  with check (private.is_member() and id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (private.is_member() and id = (select auth.uid()))
  with check (private.is_member() and id = (select auth.uid()));
create policy profiles_delete on public.profiles for delete to authenticated
  using (private.is_member() and id = (select auth.uid()));

-- activities / photos / comments (owner column is `author_id`)
do $$
declare t text;
begin
  foreach t in array array['activities', 'photos', 'comments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format($f$create policy %I on public.%I for select to authenticated
      using (private.is_member())$f$, t || '_select', t);
    execute format($f$create policy %I on public.%I for insert to authenticated
      with check (private.is_member() and author_id = (select auth.uid()))$f$, t || '_insert', t);
    execute format($f$create policy %I on public.%I for update to authenticated
      using (private.is_member() and author_id = (select auth.uid()))
      with check (private.is_member() and author_id = (select auth.uid()))$f$, t || '_update', t);
    execute format($f$create policy %I on public.%I for delete to authenticated
      using (private.is_member() and author_id = (select auth.uid()))$f$, t || '_delete', t);
  end loop;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 5b. Table privileges
--    New Supabase projects don't auto-grant Data API access on new tables,
--    so grant it explicitly. Only `authenticated` gets access (RLS above then
--    narrows it to the two members); `anon` and `members` get nothing.
-- ───────────────────────────────────────────────────────────────────
revoke all on public.members, public.profiles, public.activities, public.photos, public.comments from anon;
revoke all on public.members from authenticated;
grant select, insert, update, delete on public.profiles, public.activities, public.photos, public.comments to authenticated;

-- Feedback requests: only the two people involved can read one. The requester creates it
-- (questions only) and can withdraw it; the recipient answers once (answers only).
alter table public.feedback_requests enable row level security;

drop policy if exists feedback_select on public.feedback_requests;
drop policy if exists feedback_insert on public.feedback_requests;
drop policy if exists feedback_answer on public.feedback_requests;
drop policy if exists feedback_delete on public.feedback_requests;
create policy feedback_select on public.feedback_requests for select to authenticated
  using (private.is_member() and (select auth.uid()) in (requester_id, recipient_id));
create policy feedback_insert on public.feedback_requests for insert to authenticated
  with check (private.is_member() and requester_id = (select auth.uid()) and recipient_id <> requester_id
              and status = 'pending' and answers is null);
create policy feedback_answer on public.feedback_requests for update to authenticated
  using (private.is_member() and recipient_id = (select auth.uid()) and status = 'pending')
  with check (private.is_member() and recipient_id = (select auth.uid()) and answers is not null);
create policy feedback_delete on public.feedback_requests for delete to authenticated
  using (private.is_member() and requester_id = (select auth.uid()));

-- Column-level privileges keep each side to its own part of the row.
revoke all on public.feedback_requests from anon, authenticated;
grant select, delete on public.feedback_requests to authenticated;
grant insert (activity_id, recipient_id, questions) on public.feedback_requests to authenticated;
grant update (answers) on public.feedback_requests to authenticated;

-- ───────────────────────────────────────────────────────────────────
-- 6. Storage: private `photos` bucket, ~5 MB, images only
--    Path convention: {user_id}/{activity_id}/{uuid}.jpg
-- ───────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/*'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists photos_objects_select on storage.objects;
drop policy if exists photos_objects_insert on storage.objects;
drop policy if exists photos_objects_delete on storage.objects;

create policy photos_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and private.is_member());

-- Uploads must land under the uploader's own folder.
create policy photos_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and private.is_member()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Only the uploader can delete (owner_id replaces the deprecated `owner` uuid).
create policy photos_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'photos'
    and private.is_member()
    and owner_id = (select auth.uid())::text
  );

-- Remove the old exposed copy (earlier versions of this file created it in
-- public). Every policy above now uses private.is_member(), so nothing depends on it.
drop function if exists public.is_member();

-- ───────────────────────────────────────────────────────────────────
-- 7. Realtime (Phase 4): RLS still applies to postgres_changes
-- ───────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['activities', 'comments', 'photos', 'feedback_requests'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────────
-- 8. Seed: the two members and their profiles
-- ───────────────────────────────────────────────────────────────────
insert into public.members (user_id) values
  ('e060e48b-67fe-4964-ad78-a7e1162987da'::uuid),
  ('3a56ca00-b170-4fc8-9f2b-89ff693a85ec'::uuid)
on conflict do nothing;

insert into public.profiles (id, display_name, theme) values
  ('e060e48b-67fe-4964-ad78-a7e1162987da'::uuid,  'Samarth',  'a'),
  ('3a56ca00-b170-4fc8-9f2b-89ff693a85ec'::uuid, 'Shreyasi', 'b')
on conflict (id) do update
  set display_name = excluded.display_name;
