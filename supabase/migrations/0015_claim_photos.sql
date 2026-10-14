-- 0015 — Site photos with spoken captions: the pictures (2026-10-14).
--
-- A technician photographs the job from the claim (the Photos button) and says or types a caption.
-- Each photo's RECORD — its room, the time, the caption — rides in the claim's own payload like
-- everything else in a claim (lib/photos.ts), so there is no new table. Only the PICTURES live here:
--
--   claim-photos/<organization id>/<claim id>/<photo id>.jpg         about 2,000 px, under 2 MB
--   claim-photos/<organization id>/<claim id>/<photo id>.thumb.jpg   a small thumbnail
--
-- Written only by Scrivn's server (app/api/claims/[id]/photos/[photoId]), with the service role,
-- after the member's own session has found the claim and the claim lists the photo. Nobody writes to
-- this bucket with a user's key: there is no insert, update or delete policy, so the anon key in
-- every page's JavaScript can do nothing here but read what its organization may read — the same
-- arrangement as the scan photos (0007) and the logos (0005).
--
-- Deleting a claim deletes its folder here, and its scans' folders in scan-photos (the route does it,
-- with the service role, after the claim's row is gone).
--
-- Depends only on 0004 (is_org_member) and 0005 (logo_organization_id); nothing in 0011-0014, none of
-- which is applied in production yet, so it can be pasted on its own.
-- Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-photos', 'claim-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone in the organization, so whoever opens the claim sees its photos. The organization is
-- the top-level folder, read by the function the logos and the scan photos use (0005): null for a
-- folder that is not a uuid, and then the policy is false.
drop policy if exists "Claim photos are readable within the organization" on storage.objects;
create policy "Claim photos are readable within the organization"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'claim-photos' and public.is_org_member(public.logo_organization_id(name)));
