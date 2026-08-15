-- DropShipping — initial schema
--
-- Paste this whole file into the Supabase SQL editor (Dashboard → SQL Editor →
-- New query → Run). It is idempotent enough to re-run safely.
--
-- Tables: profiles, projects, versions. RLS is on for all three and every
-- policy funnels through auth.uid(), so a signed-in user can only ever see
-- their own rows. A trigger on auth.users creates the profile row on signup.

-- ─────────────────────────────── profiles ────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  -- AES-256-GCM payload written by lib/crypto.ts. Never exposed to the client.
  anthropic_key_encrypted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.anthropic_key_encrypted is
  'User-supplied Anthropic API key, AES-256-GCM encrypted with APP_ENCRYPTION_KEY.';

-- ─────────────────────────────── projects ────────────────────────────────

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled shop',
  page_type text not null check (page_type in ('landing', 'product')),
  initial_prompt text not null default '',
  -- FK added after versions exists (the two tables reference each other).
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_updated_at_idx
  on public.projects (user_id, updated_at desc);

-- ─────────────────────────────── versions ────────────────────────────────

create table if not exists public.versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- 1-based generation counter within the project.
  idx integer not null,
  prompt text not null default '',
  -- FileMap: { "app/page.tsx": "...", "components/Hero.tsx": "..." }
  files jsonb not null default '{}'::jsonb,
  -- Theme: { colors: {...}, fonts: {...}, radius: "..." }
  theme jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, idx)
);

create index if not exists versions_project_id_idx_desc
  on public.versions (project_id, idx desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_current_version_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_current_version_id_fkey
      foreign key (current_version_id) references public.versions (id) on delete set null;
  end if;
end $$;

-- ──────────────────────────── updated_at touch ───────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ──────────────────── profile auto-insert on signup ──────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for users that already exist.
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(u.raw_user_meta_data ->> 'full_name', '')
from auth.users u
on conflict (id) do nothing;

-- ─────────────────────────────────── RLS ─────────────────────────────────

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.versions enable row level security;

-- profiles: a user reads and writes exactly one row, their own.
drop policy if exists "profiles are self-readable" on public.profiles;
create policy "profiles are self-readable"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles are self-insertable" on public.profiles;
create policy "profiles are self-insertable"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles are self-updatable" on public.profiles;
create policy "profiles are self-updatable"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- projects: owner-only, all four verbs.
drop policy if exists "projects are self-readable" on public.projects;
create policy "projects are self-readable"
  on public.projects for select
  using (auth.uid() = user_id);

drop policy if exists "projects are self-insertable" on public.projects;
create policy "projects are self-insertable"
  on public.projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "projects are self-updatable" on public.projects;
create policy "projects are self-updatable"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects are self-deletable" on public.projects;
create policy "projects are self-deletable"
  on public.projects for delete
  using (auth.uid() = user_id);

-- versions: ownership is inherited from the parent project.
drop policy if exists "versions are readable by project owner" on public.versions;
create policy "versions are readable by project owner"
  on public.versions for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = versions.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "versions are insertable by project owner" on public.versions;
create policy "versions are insertable by project owner"
  on public.versions for insert
  with check (
    exists (
      select 1 from public.projects p
      where p.id = versions.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "versions are updatable by project owner" on public.versions;
create policy "versions are updatable by project owner"
  on public.versions for update
  using (
    exists (
      select 1 from public.projects p
      where p.id = versions.project_id and p.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = versions.project_id and p.user_id = auth.uid()
    )
  );

drop policy if exists "versions are deletable by project owner" on public.versions;
create policy "versions are deletable by project owner"
  on public.versions for delete
  using (
    exists (
      select 1 from public.projects p
      where p.id = versions.project_id and p.user_id = auth.uid()
    )
  );

-- ────────────────────────────────- grants ────────────────────────────────

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.versions to authenticated;
grant all on public.profiles, public.projects, public.versions to service_role;
