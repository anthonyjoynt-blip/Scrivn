-- 0007 — The photos a phone takes on its walk, for the walk-through (2026-09-27).
--
-- The phone sends a scan (0006), then each keyframe photo of its walk to
-- /api/device/scans/<scan id>/photos?n=<number>. That route checks the device token and that the
-- scan is the token's organization's, then stores the photo here at
-- `<organization id>/<scan id>/<n>.jpg` with the service role. Nobody writes to this bucket with a
-- user's key: there is no insert, update or delete policy, so the anon key in every page's
-- JavaScript can do nothing here but read what its organization may read.
--
-- Where each photo was taken travels in the scan body itself (`walk.photos`), and the editor places
-- it on the plan when the scan is adopted (`adoptScan`); this bucket holds only the pictures.
--
-- Safe to run more than once.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scan-photos', 'scan-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone in the organization, so a member opening the 3D view sees the walk's photos. The
-- organization is the top-level folder, read by the same function the logos use (0005): null for a
-- folder that is not a uuid, and then the policy is false.
drop policy if exists "Scan photos are readable within the organization" on storage.objects;
create policy "Scan photos are readable within the organization"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'scan-photos' and public.is_org_member(public.logo_organization_id(name)));
