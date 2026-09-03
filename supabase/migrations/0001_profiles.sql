-- Profiles: the app-owned data about a person, alongside what Supabase Auth already stores.
--
-- Supabase keeps email, password hash, and confirmation state in `auth.users`, which application
-- code cannot write to. Anything of our own about a person lives here instead, keyed to the same id.
--
-- SHAPE NOTE (matters for adding organizations/teams later):
-- This table describes A PERSON, not an account or a tenant. That distinction is the thing that
-- makes teams addable later without a rewrite — when organizations arrive, they become their own
-- table plus an `organization_members` join table, and nothing here has to move, because nothing
-- here is really organization-level.
--
-- `company_name` is the one deliberate exception and the one field to revisit then. It's here
-- because the app needs it now (the letterhead currently hardcodes a placeholder company — see
-- lib/letterhead.ts), it's a plain text column with no dependents, and copying it into an
-- organizations table later is a single UPDATE...FROM. It is intentionally NOT a foreign key to
-- anything, and no shared/company-level settings (branding, billing, plan) belong on this table —
-- those are what would genuinely hurt to untangle.

create table if not exists public.profiles (
  -- Same id as the auth user. ON DELETE CASCADE means deleting the auth user removes this row too,
  -- so there's no orphan cleanup to remember and no need for a delete policy below.
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  -- Stopgap — see the shape note above.
  company_name text,
  -- Fills the "PM Phone" field the inspection report currently always renders blank
  -- (see lib/jobInformation.ts). Nullable: not collected at signup, filled in later.
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Per-person profile data, 1:1 with auth.users. Describes a person, not an organization — see 0001_profiles.sql for why that matters before adding teams.';

-- ---------------------------------------------------------------------------------------------
-- Row Level Security: a user can only ever see or change their own row.
--
-- Without this, the anon key (which is public and shipped to every browser) would be able to read
-- the whole table. RLS is the actual protection; the key is just the front door.
-- ---------------------------------------------------------------------------------------------

alter table public.profiles enable row level security;

-- `(select auth.uid())` rather than a bare `auth.uid()`: wrapping it in a scalar subquery lets
-- Postgres evaluate it once per statement instead of once per row.

drop policy if exists "Profiles are viewable by their owner" on public.profiles;
create policy "Profiles are viewable by their owner"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Profiles are insertable by their owner" on public.profiles;
create policy "Profiles are insertable by their owner"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "Profiles are updatable by their owner" on public.profiles;
create policy "Profiles are updatable by their owner"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No delete policy on purpose: profile rows go away with their auth user via the cascade above.
-- Adding one would let a signed-in user delete their profile row while keeping their login, which
-- leaves an account with no profile — a state nothing in the app expects.

-- ---------------------------------------------------------------------------------------------
-- Create the profile row automatically when an auth user is created.
--
-- A trigger rather than an insert from the signup form, for three reasons: the row exists no matter
-- how the account was created (signup form today, an admin invite or a social login later); it
-- can't get skipped by a client that fails between the two calls; and it needs no elevated key in
-- application code, since at signup time the user isn't signed in yet and so couldn't satisfy the
-- insert policy above anyway.
-- ---------------------------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
-- SECURITY DEFINER so it can write a row the not-yet-signed-in user couldn't write themselves.
-- `set search_path = ''` is the hardened form Supabase recommends for definer functions: with an
-- empty search path, every identifier below must be schema-qualified, so no object this function
-- touches can be shadowed by something a caller put earlier on their own search_path.
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, company_name)
  values (
    new.id,
    -- Supplied by the signup form via signUp()'s options.data; null for any path that doesn't set it.
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'company_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------------------------
-- Keep updated_at honest, rather than trusting every future caller to set it.
-- ---------------------------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
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
