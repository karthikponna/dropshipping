-- DropShipping — storage for images the user uploads
--
-- Run this after 0002_page_types.sql (Dashboard → SQL Editor → New query → Run).
-- Safe to re-run.
--
-- A generated shop used to be entirely picsum placeholders. This bucket lets a
-- user attach their own product photos in the composer: Claude looks at them
-- while it writes the page, and the page ends up pointing at these exact URLs.
--
-- The bucket is PUBLIC on purpose, and that is a real decision. A generated
-- shop is meant to be exported and deployed anywhere, and Anthropic has to be
-- able to fetch the image to look at it; both break under signed URLs that
-- expire. Nothing private should ever be uploaded here, which is why uploads
-- are capped to images and the UI says so.
--
-- Writes are still owner-scoped: the first path segment must be the uploader's
-- user id, so one account cannot write into, overwrite or delete another's
-- folder even though everyone can read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shop-assets',
  'shop-assets',
  true,
  10485760, -- 10 MB; the browser downscales to well under this before uploading
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ───────────────────────────── access policies ────────────────────────────
--
-- Policies live on storage.objects, which already has RLS enabled. Each is
-- dropped first so the whole file stays re-runnable.

drop policy if exists "shop assets are publicly readable" on storage.objects;
create policy "shop assets are publicly readable"
  on storage.objects for select
  using (bucket_id = 'shop-assets');

drop policy if exists "users upload into their own folder" on storage.objects;
create policy "users upload into their own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update their own shop assets" on storage.objects;
create policy "users update their own shop assets"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own shop assets" on storage.objects;
create policy "users delete their own shop assets"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'shop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
