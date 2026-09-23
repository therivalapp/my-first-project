-- Scope storage writes to the file's owner, and cap what can be uploaded.
--
-- The existing write policies only asked whether the caller was signed in, not
-- whether the file was theirs, so any RIVAL user could overwrite anyone else's
-- photo or avatar. The buckets also had no size or type limit, which is how
-- 40 MB files got in. Reads are deliberately left public — photos load by
-- public URL and changing that is a separate product decision.
--
-- Files live at "<user_id>/<file>", so the first path segment is the owner.
-- Team logos are the one exception: they live at "leagues/<league_id>/<file>"
-- in the avatars bucket, and belong to that team's admins.
--
-- Edge functions use the service role, which bypasses RLS entirely, so the
-- Strava importer ("strava/..."), the crest generator and the share pipeline's
-- own housekeeping are all unaffected.

begin;

-- ── Write policies ────────────────────────────────────────────────────────
drop policy if exists "Authenticated upload activity-photos" on storage.objects;
drop policy if exists "Authenticated update activity-photos" on storage.objects;
drop policy if exists "Authenticated upload avatars"         on storage.objects;
drop policy if exists "Authenticated update avatars"         on storage.objects;

-- Activity photos: your own folder only.
create policy "Owners write activity-photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'activity-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners update activity-photos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'activity-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'activity-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deleting your own photo was impossible before: there was no delete policy at
-- all, which is part of why orphans piled up.
create policy "Owners delete activity-photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'activity-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Avatars: your own folder, or a team logo if you administer that team. The
-- league_id is compared as text so a non-UUID folder name can't raise a cast
-- error and take the whole policy down with it.
create policy "Owners write avatars"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'leagues'
        and exists (
          select 1 from public.league_members lm
          where lm.league_id::text = (storage.foldername(name))[2]
            and lm.user_id = auth.uid()
            and lm.is_admin
        )
      )
    )
  );

create policy "Owners update avatars"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'leagues'
        and exists (
          select 1 from public.league_members lm
          where lm.league_id::text = (storage.foldername(name))[2]
            and lm.user_id = auth.uid()
            and lm.is_admin
        )
      )
    )
  )
  with check (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or (
        (storage.foldername(name))[1] = 'leagues'
        and exists (
          select 1 from public.league_members lm
          where lm.league_id::text = (storage.foldername(name))[2]
            and lm.user_id = auth.uid()
            and lm.is_admin
        )
      )
    )
  );

create policy "Owners delete avatars"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Bucket limits ─────────────────────────────────────────────────────────
-- Activity photos still accept the short clips the diary supports, so the cap
-- is generous rather than photo-sized. Avatars never need to be large.
update storage.buckets
   set file_size_limit = 26214400,  -- 25 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime']
 where id = 'activity-photos';

update storage.buckets
   set file_size_limit = 5242880,   -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif']
 where id in ('avatars', 'feed-photos');

commit;
