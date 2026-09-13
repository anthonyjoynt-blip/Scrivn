-- The company letterhead: an organization's name, tagline, colours and logo on every document.
--
-- Run this in the Supabase SQL Editor after 0004_organizations_and_claims.sql. Safe to re-run.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHERE IT LIVES, AND WHY
--
-- 0001_profiles.sql drew the line: `profiles` describes a person, and "no shared/company-level
-- settings (branding, billing, plan) belong on this table — those are what would genuinely hurt to
-- untangle." Branding is the first of those to arrive, and it lands on `organizations`, which is
-- what that note was reserving the space for. When teams exist, one letterhead serves everyone in
-- the company without a row moving anywhere.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- NOTHING CHANGES UNTIL AN OWNER SAYS SO
--
-- Every organization already has a `name`, seeded at signup from the company field — or from the
-- person's own name, or the literal "My organization" when neither was given. Putting that on every
-- PDF the moment this migration runs would replace the Scrivn letterhead with "My organization" for
-- anyone who left the field blank, silently and on documents that go to insurers.
--
-- So `letterhead_configured_at` gates it. Null means the organization has never saved letterhead
-- settings, and documents keep the Scrivn letterhead they have always had. The app stamps it the
-- first time an owner saves the form or uploads a logo. Nothing else reads the new columns until
-- then.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE FIRST USE OF THE ROLE COLUMN
--
-- 0004 added `organization_members.role` and said it was "not enforced anywhere yet". This is the
-- first enforcement: only an owner may change the letterhead. The letterhead is the company's face
-- on every document it sends out, which is not something a member should be able to change from
-- their own account once teams exist. Today every user is the owner of their own organization of
-- one, so nobody loses anything.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.organizations
  add column if not exists tagline text,
  -- `#rrggbb`, lower case. Null means "never set" and the app substitutes its default.
  add column if not exists primary_color text,
  add column if not exists accent_color text,
  -- Path inside the `logos` storage bucket, always `<organization id>/logo.png`. The size is stored
  -- alongside so the PDF can lay the logo out without decoding it first.
  add column if not exists logo_path text,
  add column if not exists logo_width integer,
  add column if not exists logo_height integer,
  add column if not exists letterhead_configured_at timestamptz;

-- Constraints are added separately so a re-run does not fail on the ones that already exist.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_primary_color_check') then
    alter table public.organizations
      add constraint organizations_primary_color_check check (primary_color is null or primary_color ~ '^#[0-9a-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_accent_color_check') then
    alter table public.organizations
      add constraint organizations_accent_color_check check (accent_color is null or accent_color ~ '^#[0-9a-f]{6}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_logo_size_check') then
    alter table public.organizations
      add constraint organizations_logo_size_check check (
        (logo_path is null and logo_width is null and logo_height is null)
        or (logo_path is not null and logo_width between 1 and 1200 and logo_height between 1 and 600)
      );
  end if;
end;
$$;

comment on column public.organizations.letterhead_configured_at is
  'Null until an owner first saves letterhead settings or uploads a logo. While null, documents carry the default Scrivn letterhead and the other letterhead columns are ignored.';

-- ---------------------------------------------------------------------------------------------
-- The ownership test, alongside the membership test from 0004 and hardened the same way: a
-- SECURITY DEFINER function with an empty search_path that reads the caller's identity from
-- auth.uid() itself, so nobody can ask whether SOMEBODY ELSE is an owner.
-- ---------------------------------------------------------------------------------------------

create or replace function public.is_org_owner(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
  );
$$;

revoke all on function public.is_org_owner(uuid) from public;
grant execute on function public.is_org_owner(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- organizations: owners may update their own. Still no insert or delete from the browser — an
-- organization is created by the signup trigger and goes away with its last member, never by hand.
--
-- The `with check` half matters as much as `using`: without it an update could rewrite `id` and
-- turn the row into one the caller does not own.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Organizations are updatable by their owners" on public.organizations;
create policy "Organizations are updatable by their owners"
  on public.organizations for update
  to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

-- ---------------------------------------------------------------------------------------------
-- The logo bucket.
--
-- Private, not public: a public bucket serves any object to anyone holding its URL, and while a
-- logo is hardly a secret, every other byte this app stores is governed by RLS and the bucket is
-- not going to be the one exception somebody later relies on. The app reads the logo through a
-- signed-in session, which is the same door everything else uses.
--
-- The size and type limits are enforced here by Storage itself, in addition to the app's own
-- checks — the browser client can reach the bucket directly with the anon key, so a limit that
-- lived only in application code would be a limit only on the polite.
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', false, 1048576, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The organization an object belongs to is its top-level folder: `<organization id>/logo.png`.
-- Returns null rather than raising for a folder that is not a uuid, so a malformed path is simply
-- nobody's and every policy below evaluates to false for it.
create or replace function public.logo_organization_id(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then split_part(object_name, '/', 1)::uuid
    else null
  end;
$$;

-- Read: anyone in the organization, so a member's document preview shows the company logo.
drop policy if exists "Logos are readable within the organization" on storage.objects;
create policy "Logos are readable within the organization"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'logos' and public.is_org_member(public.logo_organization_id(name)));

-- Write: owners only, and only under their own organization's folder. Three policies rather than
-- one FOR ALL so each verb carries the same test explicitly — an upsert is an insert or an update
-- depending on whether the object exists, and both paths must be closed.
drop policy if exists "Logos are uploadable by the organization's owners" on storage.objects;
create policy "Logos are uploadable by the organization's owners"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos' and public.is_org_owner(public.logo_organization_id(name)));

drop policy if exists "Logos are replaceable by the organization's owners" on storage.objects;
create policy "Logos are replaceable by the organization's owners"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'logos' and public.is_org_owner(public.logo_organization_id(name)))
  with check (bucket_id = 'logos' and public.is_org_owner(public.logo_organization_id(name)));

drop policy if exists "Logos are deletable by the organization's owners" on storage.objects;
create policy "Logos are deletable by the organization's owners"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'logos' and public.is_org_owner(public.logo_organization_id(name)));
