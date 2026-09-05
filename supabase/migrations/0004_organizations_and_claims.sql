-- Organizations, membership, and saved claims.
--
-- Run this in the Supabase SQL Editor after 0003_trial.sql. Safe to re-run.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY ORGANIZATIONS EXIST NOW, BEFORE TEAMS DO
--
-- Nothing in the app yet lets two people share a claim, and this migration does not add invites,
-- roles, or member management. It still creates organizations, because the TENANT BOUNDARY is the
-- one thing that cannot be retrofitted safely. Scoping claims to `user_id` today and to an
-- organization later would mean rewriting every policy on a table that by then holds real people's
-- addresses and loss details, and getting that migration wrong is exactly the failure this is meant
-- to prevent. So the boundary is organization-shaped from the first row.
--
-- Every signup gets a personal organization of one. When teams arrive, that is a membership insert
-- and a UI, not a change to the security model.
--
-- 0001_profiles.sql anticipated this and said `profiles` describes A PERSON, not a tenant. That
-- holds: nothing moves off profiles here. `company_name` remains the stopgap it was described as —
-- it seeds the organization's name below and is otherwise untouched.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS STORED, AND WHY IT IS ONE JSONB COLUMN
--
-- A claim's state is a set of TypeScript objects (ClaimInfo, WaterLossExtraction, Sketch,
-- MoistureMap, ContentsTM, BricABracData, DGIGData, AsbestosScope, and the gap-check answer log).
-- Those shapes change most weeks — this project has added fields to WaterLossExtraction in nearly
-- every recent session. Normalising them into relational tables would mean a migration per field
-- and a schema that is perpetually one step behind the types, and the request was explicitly to
-- persist the real current shape rather than an idealised one.
--
-- So the payload is jsonb and the TypeScript types stay the single definition of that shape — see
-- lib/claimState.ts, which is the only place that decides what goes in and out.
--
-- The columns OUTSIDE the payload are the ones the claims list needs (`customer_name`,
-- `job_number`, `step`, `updated_at`). They are duplicated out of the payload deliberately so the
-- list view never has to read a multi-megabyte sketch to render a row.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'A tenant. Every claim belongs to exactly one. Today each user has a personal one of these; teams add members to an existing row rather than changing anything about how claims are scoped.';

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Not enforced anywhere yet. Present so the first team feature does not need a migration on a
  -- table that by then has real membership in it.
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

comment on table public.organization_members is
  'Who belongs to which organization. This table IS the authorization boundary — every claims policy resolves through it.';

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Who started it. Kept for attribution once organizations have more than one member; NOT used for
  -- authorization, which is organization-level by design — a teammate must be able to pick up a
  -- colleague's claim without the row changing hands.
  created_by uuid references auth.users (id) on delete set null,

  -- Denormalised out of `payload` so the list view can render without reading the whole claim.
  -- Written by the app on every save from the same objects that go into the payload; see
  -- lib/claimState.ts's `claimSummary`.
  customer_name text not null default '',
  job_number text not null default '',
  -- Where the PM had got to: intake | transcript | questions | ready | contents | results | ...
  -- Free text rather than an enum on purpose — the step list changes with the UI, and a claim that
  -- fails to save because a new step was added would be a worse outcome than an unrecognised label.
  step text not null default 'intake',

  -- The whole claim. See the shape note above.
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.claims is
  'One saved claim, resumable at whatever point the PM had reached. Contains real personal information about people who never signed up for this system — the RLS policies below are load-bearing, not defence in depth.';

-- The list view's query: this organization's claims, newest first.
create index if not exists claims_organization_updated_idx
  on public.claims (organization_id, updated_at desc);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--
-- The anon key is public and ships to every browser, so any signed-in user can issue arbitrary
-- PostgREST queries against these tables. RLS is the only thing standing between them and every
-- other organization's claims. Treat everything below as the security boundary itself.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.claims enable row level security;

-- ---------------------------------------------------------------------------------------------
-- The membership test, as a SECURITY DEFINER function.
--
-- This exists because of RECURSION, not convenience. A policy on `claims` that reads
-- `organization_members` triggers that table's own policies; a policy on `organization_members`
-- that reads `organization_members` recurses outright and Postgres raises "infinite recursion
-- detected in policy". A definer function runs with the function owner's rights and so does not
-- re-enter RLS, which breaks the cycle.
--
-- That makes this function itself security-critical, so it is written defensively:
--   * `set search_path = ''` — every identifier is schema-qualified, so nothing it touches can be
--     shadowed by an object a caller placed on their own search_path.
--   * it takes the organization as an argument and reads the caller's identity from auth.uid()
--     itself, rather than accepting a user id — a caller cannot ask "is SOMEBODY ELSE a member".
--   * `stable` so the planner may cache it per statement rather than per row.
-- ---------------------------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
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
  );
$$;

revoke all on function public.is_org_member(uuid) from public;
grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- organizations: visible only to members. No insert/update/delete policy for ordinary users —
-- organizations are created by the signup trigger below, running as definer. A user cannot create
-- an organization from the browser, which also means they cannot create one and then try to move
-- someone else's claim into it.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Organizations are viewable by their members" on public.organizations;
create policy "Organizations are viewable by their members"
  on public.organizations for select
  to authenticated
  using (public.is_org_member(id));

-- ---------------------------------------------------------------------------------------------
-- organization_members: a user may see the membership rows of organizations they belong to.
--
-- Deliberately NOT `user_id = auth.uid()`. That narrower rule would hide teammates from each other
-- and would have to be widened the moment teams ship — the boundary is the organization, and
-- writing it that way now means the first team feature changes no policy.
--
-- No write policies at all: membership is granted by the signup trigger today, and by whatever
-- invite flow arrives later, always through elevated code. A user who could insert here could add
-- themselves to any organization whose id they guessed, which would defeat every policy above.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Members are viewable within the organization" on public.organization_members;
create policy "Members are viewable within the organization"
  on public.organization_members for select
  to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------------------------
-- claims: full access within the owning organization, nothing outside it.
--
-- Every policy carries the SAME organization test, including the `with check` halves. A policy with
-- a `using` clause and no `with check` on UPDATE would let a member move a row INTO their
-- organization from another, or push one out — the read test alone does not constrain the new row.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Claims are viewable within the organization" on public.claims;
create policy "Claims are viewable within the organization"
  on public.claims for select
  to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "Claims are insertable within the organization" on public.claims;
create policy "Claims are insertable within the organization"
  on public.claims for insert
  to authenticated
  with check (public.is_org_member(organization_id));

drop policy if exists "Claims are updatable within the organization" on public.claims;
create policy "Claims are updatable within the organization"
  on public.claims for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- Deletion is a real, permanent delete of the row and everything in its payload — the sketch, the
-- extraction, the generated documents. There is no soft-delete flag on this table on purpose: a
-- hidden row still holds the personal information of someone who never signed up for this system,
-- and "deleted" has to mean deleted.
drop policy if exists "Claims are deletable within the organization" on public.claims;
create policy "Claims are deletable within the organization"
  on public.claims for delete
  to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------------------------
-- Give every user a personal organization at signup.
--
-- Extends the existing handle_new_user() from 0001 rather than adding a second trigger, so the
-- profile row and the organization are created in one transaction — a user with a profile and no
-- organization could sign in and then be unable to save anything.
-- ---------------------------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  company text;
begin
  company := nullif(new.raw_user_meta_data ->> 'company_name', '');

  insert into public.profiles (id, full_name, company_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    company
  )
  on conflict (id) do nothing;

  -- Only for a genuinely new user: re-running signup for an existing id must not mint a second
  -- organization and quietly strand the claims saved in the first.
  if not exists (select 1 from public.organization_members m where m.user_id = new.id) then
    insert into public.organizations (name)
    values (coalesce(company, nullif(new.raw_user_meta_data ->> 'full_name', ''), 'My organization'))
    returning id into new_org_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (new_org_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Backfill: every user who signed up before this migration needs an organization too, or they
-- would sign in to an app that cannot save anything.
-- ---------------------------------------------------------------------------------------------

do $$
declare
  u record;
  new_org_id uuid;
begin
  for u in
    select p.id, p.company_name, p.full_name
    from public.profiles p
    where not exists (select 1 from public.organization_members m where m.user_id = p.id)
  loop
    insert into public.organizations (name)
    values (coalesce(nullif(u.company_name, ''), nullif(u.full_name, ''), 'My organization'))
    returning id into new_org_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (new_org_id, u.id, 'owner');
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- updated_at, maintained by the database rather than trusted to every caller. The claims list is
-- ordered by it, so a caller that forgot to set it would quietly sort wrong.
-- ---------------------------------------------------------------------------------------------

drop trigger if exists organizations_touch_updated_at on public.organizations;
create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function public.touch_updated_at();

drop trigger if exists claims_touch_updated_at on public.claims;
create trigger claims_touch_updated_at
  before update on public.claims
  for each row execute function public.touch_updated_at();
