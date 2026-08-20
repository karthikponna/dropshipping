-- DropShipping — a project becomes a site with more than one page
--
-- Run this after 0001_init.sql (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run.
--
-- Until now a project was one page: `projects.page_type` fixed it at creation
-- and every version belonged to that one type. A user who had built a landing
-- page and wanted a matching product page had to start a second project, which
-- meant a second palette, a second set of fonts, and no relationship between
-- the two.
--
-- After this migration a project holds one tree per page type. Versions carry
-- their own `page_type`, `projects.page_type` becomes the page the builder
-- opens on, and `versions.idx` counts per page type rather than per project.

-- ─────────────────────────── versions.page_type ──────────────────────────

alter table public.versions
  add column if not exists page_type text;

-- Existing rows all belong to their project's single page type.
update public.versions v
set page_type = p.page_type
from public.projects p
where v.project_id = p.id and v.page_type is null;

alter table public.versions
  alter column page_type set default 'landing';

update public.versions set page_type = 'landing' where page_type is null;

alter table public.versions
  alter column page_type set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'versions_page_type_check'
  ) then
    alter table public.versions
      add constraint versions_page_type_check
      check (page_type in ('landing', 'product'));
  end if;
end $$;

comment on column public.versions.page_type is
  'Which page of the site this version is. A project holds one tree per type.';

-- ───────────────────────── per-page-type version idx ─────────────────────
--
-- `idx` used to be unique per project. It now numbers each page type's own
-- history, so a project reads "landing v3, product v1" instead of one confusing
-- interleaved run of numbers.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'versions_project_id_idx_key' and conrelid = 'public.versions'::regclass
  ) then
    alter table public.versions drop constraint versions_project_id_idx_key;
  end if;
end $$;

-- Renumber existing rows so each page type starts at 1 and stays contiguous.
with renumbered as (
  select id, row_number() over (
    partition by project_id, page_type order by created_at, idx
  ) as new_idx
  from public.versions
)
update public.versions v
set idx = r.new_idx
from renumbered r
where v.id = r.id and v.idx is distinct from r.new_idx;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'versions_project_page_idx_key' and conrelid = 'public.versions'::regclass
  ) then
    alter table public.versions
      add constraint versions_project_page_idx_key unique (project_id, page_type, idx);
  end if;
end $$;

create index if not exists versions_project_page_idx_desc
  on public.versions (project_id, page_type, idx desc);

-- ──────────────────── projects: pointer per page type ────────────────────
--
-- `current_version_id` stays as the version the project as a whole last
-- produced (the dashboard card previews it). Each page type also needs its own
-- pointer, so switching pages in the builder restores the right tree.

alter table public.projects
  add column if not exists landing_version_id uuid,
  add column if not exists product_version_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_landing_version_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_landing_version_id_fkey
      foreign key (landing_version_id) references public.versions (id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'projects_product_version_id_fkey'
  ) then
    alter table public.projects
      add constraint projects_product_version_id_fkey
      foreign key (product_version_id) references public.versions (id) on delete set null;
  end if;
end $$;

-- Point each page type at its newest existing version.
update public.projects p
set landing_version_id = newest.id
from (
  select distinct on (project_id) project_id, id
  from public.versions
  where page_type = 'landing'
  order by project_id, idx desc
) newest
where p.id = newest.project_id and p.landing_version_id is null;

update public.projects p
set product_version_id = newest.id
from (
  select distinct on (project_id) project_id, id
  from public.versions
  where page_type = 'product'
  order by project_id, idx desc
) newest
where p.id = newest.project_id and p.product_version_id is null;

comment on column public.projects.page_type is
  'The page the builder opens on. Both page types may exist; this is the active one.';
comment on column public.projects.landing_version_id is
  'Newest landing-page version, or null if the site has no landing page yet.';
comment on column public.projects.product_version_id is
  'Newest product-page version, or null if the site has no product page yet.';
