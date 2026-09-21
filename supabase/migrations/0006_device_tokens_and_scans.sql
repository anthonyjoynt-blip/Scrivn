-- Paired phones and the room scans they send in.
--
-- Run this in the Supabase SQL Editor after 0005_letterhead.sql. Safe to re-run. It also needs
-- 0005_claim_list_columns.sql, for the `address`, `insurer` and `status` columns it lists and
-- writes.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A PHONE IS NOT A SIGNED-IN USER
--
-- Everything before this migration is reached through a browser session: a person signs in, the
-- session travels in a cookie, `auth.uid()` names them, and RLS decides what they may touch. The
-- scanning phone has none of that. It pairs ONCE — by scanning a QR on the Account page — and from
-- then on carries a long-lived device token as a bearer header. Nobody wants to type a password into
-- a phone in a wet basement, and a token that dies when a browser session does would mean re-pairing
-- every few days.
--
-- So the phone talks to the database as the `anon` role, with no session at all, and the ONLY doors
-- open to it are the SECURITY DEFINER functions below. Each one takes the token's hash, looks the
-- token up itself, and does exactly one job on behalf of the person who paired the phone. There is
-- no policy anywhere that lets `anon` read or write a row directly: with RLS enabled and no `anon`
-- policies, a bare anon key still sees nothing, exactly as 0004 arranged for `claims`.
--
-- That makes these functions the security boundary for the phone, in the same way the policies in
-- 0004 are for the browser, and they are written to the same standard: `set search_path = ''` with
-- every identifier schema-qualified, the token resolved inside the function from its hash and never
-- from a caller-supplied user or organization id, and grants revoked from public before being handed
-- out explicitly.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT IS STORED, AND WHAT IS NOT
--
-- Neither secret is stored, and neither is what the app sends. The app hashes the pairing code and
-- the device token (SHA-256, lib/deviceCodes.ts) and hands the functions the hash; the functions
-- hash it AGAIN (`device_secret_hash`) before storing or comparing. So a read of either table — by a
-- member of the organization, by a dump, by anyone — hands out nothing a phone could present: the
-- stored value is two hashes deep and the public functions accept only the value one hash deep. The
-- code is eight letters and lives ten minutes, single-use — see lib/deviceCodes.ts for why that is
-- enough. The token is 256 random bits, so there is no dictionary to salt against.
--
-- On top of that, the browser role may not read `token_hash` at all: the select grant on
-- device_tokens is column by column, the way 0002 did it for profiles, because RLS decides which
-- ROWS a member may see and says nothing about which columns.
--
-- A scan for an EXISTING claim is stored in `claim_scans` as a PENDING row and is never written into
-- the claim's payload here. The browser autosaves the whole payload from its own state, so a change
-- made to `payload` behind its back would be overwritten on the next keystroke; instead the browser
-- reads the pending row over its own session, applies it with the same importer the sketch editor
-- uses, and marks it adopted or discarded. A scan for a NEW claim has no browser to race, so the
-- server converts it and inserts the claim with the sketch already in place, and the scan row is
-- recorded as adopted from the start — the row is how the phone's capture stays attributable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------------------------
-- device_pairings: a code that has been shown and may still be exchanged.
--
-- One row per QR shown. `claimed_at` is set the moment a phone exchanges it, and the exchange
-- refuses a claimed or expired row, so a code is worth exactly one pairing. No browser policies at
-- all: the Account page only ever needs the code it was just handed back by `device_pairing_begin`,
-- and a table that lists live codes to anyone in the organization would be a way to pair a phone to
-- a colleague's account.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.device_pairings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Who showed the QR. The token minted from this code belongs to this person, so the phone acts as
  -- them — a scan it sends is `created_by` them, and their role decides which claims it can list.
  user_id uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 hex of the SHA-256 the app sends of the eight-letter code (see the header). Unique so an
  -- exchange can look a code up directly.
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Null until a phone exchanges the code. Set once and never cleared.
  claimed_at timestamptz
);

comment on table public.device_pairings is
  'Pairing codes shown as QRs on the Account page, stored as hashes. Single-use and short-lived; no browser policies on purpose — only the definer functions read this table.';
comment on column public.device_pairings.code_hash is
  'SHA-256 hex of the hash the app sends of the eight-letter pairing code. Neither the code nor what the app sends is stored.';
comment on column public.device_pairings.claimed_at is
  'When a phone exchanged this code for a token. A claimed code cannot be exchanged again.';

-- ---------------------------------------------------------------------------------------------
-- device_tokens: the phones that have paired.
--
-- Visible to the organization (the Account page lists them, with who paired each one), never
-- writable from the browser: a token is minted by `device_pair` when a code is exchanged and put
-- out of use by `device_token_revoke`, both definer functions. Revocation is a timestamp rather than
-- a delete so a scan already received keeps pointing at the phone that sent it.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What the phone called itself when it paired ("Anthony's S25"), capped at 80 characters by the
  -- pairing function. Empty when it sent nothing; the UI shows "Unnamed phone".
  name text not null default '',
  -- SHA-256 hex of the SHA-256 the app sends of the bearer token the phone holds (see the header).
  -- Unique so a request can be resolved directly. Not readable by the browser role — see the grants.
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  -- Touched at most once a minute by the functions the phone calls, so a burst of requests is one
  -- write. Null until the phone has made its first request after pairing.
  last_used_at timestamptz,
  -- Set by `device_token_revoke`. A revoked token resolves to nothing, as if it never existed.
  revoked_at timestamptz
);

comment on table public.device_tokens is
  'Paired phones. Each row is one long-lived bearer token, stored as its SHA-256 only. Readable within the organization so the Account page can list and revoke phones; written only by the definer functions.';
comment on column public.device_tokens.token_hash is
  'SHA-256 hex of the hash the app sends of the bearer token. The token itself is shown to the phone once, at pairing; neither it nor what the app sends is stored, and this column is not granted to the browser role.';
comment on column public.device_tokens.last_used_at is
  'Last request from this phone, to the minute. Written by the phone-facing functions, not by the app.';
comment on column public.device_tokens.revoked_at is
  'Null while the phone may still act. Set by device_token_revoke; the row stays so received scans keep their sender.';

-- ---------------------------------------------------------------------------------------------
-- claim_scans: what a phone sent, as it sent it.
--
-- `body` is the capture exactly as received — the taps JSON the importer reads — so a scan can be
-- re-applied, inspected, or discarded without the phone. `status` is the browser's verdict: pending
-- until the claim page has looked at it, then adopted or discarded. A scan for a brand-new claim is
-- adopted on arrival by `device_receive_scan`, because there is no browser state to protect.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.claim_scans (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  -- Duplicated from the claim so the read policy is the same one-line membership test every other
  -- table uses, rather than a join through `claims` inside a policy.
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Which phone. Set null rather than cascading if the token row ever goes, so the scan outlives it.
  device_token_id uuid references public.device_tokens (id) on delete set null,
  -- The phone's own id for the capture, when it sent one. Not unique: a phone may resend.
  capture_id text,
  -- When the phone says the capture happened. Its clock, so informational only.
  captured_at timestamptz,
  -- The storey the scan is for. 0 is the main floor, matching `roomLevel` in lib/sketch.ts.
  level integer not null default 0,
  -- When the server received it — the time the notice in the browser shows.
  received_at timestamptz not null default now(),
  body jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'adopted', 'discarded')),
  -- When the browser adopted or discarded it. Null while pending.
  resolved_at timestamptz
);

comment on table public.claim_scans is
  'Room scans received from paired phones, one row per capture, with the capture stored verbatim. Pending rows are waiting for the claim page to adopt or discard them. Readable within the organization; written only by the definer functions.';
comment on column public.claim_scans.body is
  'The capture as the phone sent it (taps JSON). The importer in lib/scanImport.ts reads this; nothing here interprets it.';
comment on column public.claim_scans.status is
  'pending until the claim page has seen it, then adopted (applied to the sketch) or discarded. A scan that created a new claim is adopted on arrival.';

-- The claim page's query: this claim's pending scans.
create index if not exists claim_scans_claim_status_idx
  on public.claim_scans (claim_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
--
-- Enabled on all three tables. The browser may READ tokens and scans within its organization — the
-- Account page lists phones, the claim page lists pending scans — and may write nothing directly;
-- every write goes through a function below. `device_pairings` has no policies at all, so even a
-- signed-in member sees no rows. `anon` has no policies on any of them, so a phone with nothing but
-- the anon key reads nothing.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.device_pairings enable row level security;
alter table public.device_tokens enable row level security;
alter table public.claim_scans enable row level security;

drop policy if exists "Device tokens are viewable within the organization" on public.device_tokens;
create policy "Device tokens are viewable within the organization"
  on public.device_tokens for select
  to authenticated
  using (public.is_org_member(organization_id));

drop policy if exists "Scans are viewable within the organization" on public.claim_scans;
create policy "Scans are viewable within the organization"
  on public.claim_scans for select
  to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------------------------
-- Which COLUMNS of device_tokens the browser may read.
--
-- The policy above decides which rows; it cannot narrow the columns, and Supabase grants the
-- browser roles select on every column of a new public table. `token_hash` is the one column that
-- must not travel to a browser — it is one hash away from acting as the phone — so the table-wide
-- grant is taken back and re-issued without it, exactly as 0002 did for the billing columns on
-- profiles. lib/deviceRepo.ts names its columns, so nothing in the app notices.
-- ---------------------------------------------------------------------------------------------

revoke select on public.device_tokens from anon, authenticated;
grant select (id, organization_id, user_id, name, created_at, last_used_at, revoked_at)
  on public.device_tokens to authenticated;

-- ---------------------------------------------------------------------------------------------
-- The second hash — see the header. pgcrypto lives in the `extensions` schema on Supabase and is
-- enabled by default; the `create extension` is a no-op then and a requirement made explicit
-- otherwise. Immutable, so the planner may fold it, and internal: the definer functions call it
-- and nobody else needs to.
-- ---------------------------------------------------------------------------------------------

create extension if not exists pgcrypto with schema extensions;

create or replace function public.device_secret_hash(sent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(sent, 'sha256'), 'hex');
$$;

revoke all on function public.device_secret_hash(text) from public;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE FUNCTIONS
--
-- All seven are SECURITY DEFINER with an empty search_path, like `is_org_member` in 0004 and for
-- the same reasons. Two conventions hold throughout, both about PL/pgSQL name resolution:
--
--   * Every table is aliased and every column reference is alias-qualified. A function that
--     RETURNS TABLE turns its result columns into variables, and PL/pgSQL raises "column reference
--     is ambiguous" when a bare name could be either a variable or a column of a table in the query.
--     `id`, `organization_id`, `user_id` and `status` are all both.
--   * A parameter that shares a name with a column (`code_hash`, `token_hash`, `received_at`, ...)
--     is written with the function's name in front, `device_pair.code_hash`, where the column is
--     also in scope. That is the resolution PL/pgSQL documents, and it reads as what it is.
--
-- They are also deliberately VOLATILE (the default). PostgREST runs a function marked STABLE in a
-- read-only transaction, and three of these write `last_used_at` on what looks like a read.
--
-- Every comparison against a stored secret goes through `device_secret_hash` — the argument the
-- caller sends is never what the table holds, so the table's contents open no door (see the header).
--
-- Each function is dropped before it is created. `create or replace` refuses to change a function's
-- result columns ("cannot change return type of existing function"), so without the drop a re-run
-- after any change to a RETURNS TABLE list would fail. Nothing depends on these functions — no
-- policy, no trigger — so dropping them is free.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------------------------
-- 1. device_pairing_begin — the Account page asks for a code to show.
--
-- The app generates the code and hands over its hash; the database never sees the letters. The row
-- is scoped to the caller's own organization and identity, both read from the session here rather
-- than taken as arguments, so a request body cannot mint a code for somebody else's account.
--
-- Housekeeping rides along: the caller's own claimed or expired codes are deleted once they are a
-- day old. This is the one moment the table is touched by a signed-in person, and it keeps the
-- table from growing by one row per QR ever shown without a scheduled job to remember.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_pairing_begin(text);
create or replace function public.device_pairing_begin(code_hash text)
returns table (id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  org uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- The caller's organization, the same way lib/claimsRepo.ts resolves it: a person has one today,
  -- and when teams arrive this becomes the one they have selected.
  select m.organization_id into org
  from public.organization_members m
  where m.user_id = caller
  order by m.created_at, m.organization_id
  limit 1;

  if org is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;

  -- A claimed code is spent and an expired one can never be exchanged; a day later neither is
  -- worth keeping for anyone reading the table by hand.
  delete from public.device_pairings p
  where p.user_id = caller
    and coalesce(p.claimed_at, p.expires_at) < now() - interval '1 day';

  -- 600 seconds is PAIRING_CODE_TTL_SECONDS in lib/deviceCodes.ts; the two must agree or the
  -- countdown on the Account page lies.
  return query
    insert into public.device_pairings as p (organization_id, user_id, code_hash, expires_at)
    values (org, caller, public.device_secret_hash(device_pairing_begin.code_hash), now() + interval '600 seconds')
    returning p.id, p.expires_at;
end;
$$;

revoke all on function public.device_pairing_begin(text) from public;
grant execute on function public.device_pairing_begin(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. device_pair — the phone trades a code for a token.
--
-- Called by `anon`: the phone has no session yet, that is the point. Returns no rows for a code
-- that is unknown, spent, or expired — one answer for all three, so a guess learns nothing about
-- which it was. `for update` on the pairing row makes two phones racing for the same code safe:
-- the second waits, re-checks `claimed_at is null`, and gets nothing.
--
-- The token itself is minted by the app and arrives here as its hash, like the code. The row is
-- returned joined to the organization and the person, so the phone can show whose account it now
-- speaks for.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_pair(text, text, text);
create or replace function public.device_pair(code_hash text, token_hash text, device_name text)
returns table (token_id uuid, organization_id uuid, organization_name text, user_id uuid, user_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  pairing_id uuid;
  pairing_org uuid;
  pairing_user uuid;
  new_token_id uuid;
begin
  select p.id, p.organization_id, p.user_id
    into pairing_id, pairing_org, pairing_user
  from public.device_pairings p
  where p.code_hash = public.device_secret_hash(device_pair.code_hash)
    and p.claimed_at is null
    and p.expires_at > now()
  for update;

  if pairing_id is null then
    return;
  end if;

  update public.device_pairings p
  set claimed_at = now()
  where p.id = pairing_id;

  -- 80 characters is more than any phone calls itself and less than a name that is really a message.
  insert into public.device_tokens as t (organization_id, user_id, name, token_hash)
  values (pairing_org, pairing_user, left(coalesce(device_name, ''), 80), public.device_secret_hash(device_pair.token_hash))
  returning t.id into new_token_id;

  return query
    select t.id, t.organization_id, o.name, t.user_id, coalesce(pr.full_name, '')
    from public.device_tokens t
    join public.organizations o on o.id = t.organization_id
    left join public.profiles pr on pr.id = t.user_id
    where t.id = new_token_id;
end;
$$;

revoke all on function public.device_pair(text, text, text) from public;
grant execute on function public.device_pair(text, text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. device_identity — who is this token?
--
-- The lookup every phone request starts with, and the one 4 and 5 repeat inline: the token row
-- whose hash matches, not revoked, AND whose person is still a member of the organization. The
-- membership join is what makes removing someone from a team also switch off their phone — a token
-- is a standing grant of that person's access, so it has to end when their access does.
--
-- No rows means "not paired", and the app answers 401. Nothing distinguishes a revoked token from
-- one that never existed, deliberately.
--
-- `last_used_at` is written at most once a minute rather than on every call, so a phone listing
-- claims, posting a scan and checking itself in quick succession costs one write, not three.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_identity(text);
create or replace function public.device_identity(token_hash text)
returns table (token_id uuid, organization_id uuid, organization_name text, user_id uuid, user_name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok_id uuid;
  tok_role text;
  tok_last_used timestamptz;
begin
  select t.id, m.role, t.last_used_at
    into tok_id, tok_role, tok_last_used
  from public.device_tokens t
  join public.organization_members m
    on m.organization_id = t.organization_id and m.user_id = t.user_id
  where t.token_hash = public.device_secret_hash(device_identity.token_hash)
    and t.revoked_at is null;

  if tok_id is null then
    return;
  end if;

  if tok_last_used is null or tok_last_used < now() - interval '1 minute' then
    update public.device_tokens t
    set last_used_at = now()
    where t.id = tok_id;
  end if;

  return query
    select t.id, t.organization_id, o.name, t.user_id, coalesce(pr.full_name, ''), tok_role
    from public.device_tokens t
    join public.organizations o on o.id = t.organization_id
    left join public.profiles pr on pr.id = t.user_id
    where t.id = tok_id;
end;
$$;

revoke all on function public.device_identity(text) from public;
grant execute on function public.device_identity(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. device_claims — the list the phone shows before a scan.
--
-- The same view rule as `listClaims` in lib/claimsRepo.ts: an owner sees the whole organization,
-- a member sees the claims they started. It is a view rule there and a view rule here; the boundary
-- is still the organization, which the token lookup pins.
--
-- `room_names` is what the phone needs to offer "which room is this?" without downloading a single
-- payload: the distinct, trimmed, non-empty names from the sketch's rooms and the extraction's
-- rooms, as a jsonb array. Both paths are guarded with `jsonb_typeof = 'array'` because a payload
-- saved by an older build may have neither key, or `null` where an array is expected, and a claim
-- that fails to list because its payload is odd is worse than one with no room names.
--
-- Raises rather than returning no rows for a bad token, so the app can tell "not paired" (401) from
-- "no claims yet" (an empty list).
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_claims(text);
create or replace function public.device_claims(token_hash text)
returns table (
  id uuid,
  customer_name text,
  job_number text,
  address text,
  insurer text,
  status text,
  updated_at timestamptz,
  mine boolean,
  room_names jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok_id uuid;
  tok_org uuid;
  tok_user uuid;
  tok_role text;
  tok_last_used timestamptz;
begin
  select t.id, t.organization_id, t.user_id, m.role, t.last_used_at
    into tok_id, tok_org, tok_user, tok_role, tok_last_used
  from public.device_tokens t
  join public.organization_members m
    on m.organization_id = t.organization_id and m.user_id = t.user_id
  where t.token_hash = public.device_secret_hash(device_claims.token_hash)
    and t.revoked_at is null;

  if tok_id is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  if tok_last_used is null or tok_last_used < now() - interval '1 minute' then
    update public.device_tokens t
    set last_used_at = now()
    where t.id = tok_id;
  end if;

  return query
    select
      c.id,
      c.customer_name,
      c.job_number,
      c.address,
      c.insurer,
      c.status,
      c.updated_at,
      -- `created_by` is nullable (set null when the account goes), and null = anything is null, not
      -- false; the phone wants a boolean.
      coalesce(c.created_by = tok_user, false) as mine,
      coalesce(names.list, '[]'::jsonb) as room_names
    from public.claims c
    left join lateral (
      select jsonb_agg(distinct x.room_name order by x.room_name) as list
      from (
        select btrim(r.value ->> 'name') as room_name
        from jsonb_array_elements(
          case when jsonb_typeof(c.payload -> 'sketch' -> 'rooms') = 'array'
               then c.payload -> 'sketch' -> 'rooms'
               else '[]'::jsonb end
        ) as r(value)
        union all
        select btrim(e.value ->> 'roomName')
        from jsonb_array_elements(
          case when jsonb_typeof(c.payload -> 'extraction' -> 'rooms') = 'array'
               then c.payload -> 'extraction' -> 'rooms'
               else '[]'::jsonb end
        ) as e(value)
      ) x
      where x.room_name is not null
        and x.room_name <> ''
    ) names on true
    where c.organization_id = tok_org
      and (tok_role = 'owner' or c.created_by = tok_user)
    order by c.updated_at desc
    limit 200;
end;
$$;

revoke all on function public.device_claims(text) from public;
grant execute on function public.device_claims(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. device_receive_scan — a capture arrives.
--
-- Two shapes, decided by `target_claim_id`:
--
--   * An EXISTING claim. The claim must be in the token's organization — a phone cannot post into
--     a claim it merely knows the id of — and the scan is stored PENDING for the browser to adopt.
--     Nothing here touches `payload`; see the header for why that would be overwritten.
--   * A NEW claim (`target_claim_id` null). The app has already converted the capture into a sketch
--     and built the full claim state around it; `new_claim` carries that state as `payload` plus the
--     denormalised list columns, exactly the object `claimSummary` in lib/claimState.ts produces, so
--     the row is indistinguishable from one the browser saved. The scan row is recorded as adopted
--     at the moment it was received.
--
-- The scan's id is chosen by the app (it goes into the sketch as `scan.scanId` before the row
-- exists), which is why it is a parameter and not a default. `received_at` likewise comes from the
-- app so the sketch and the row carry the same instant.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb);
create or replace function public.device_receive_scan(
  token_hash text,
  target_claim_id uuid,
  new_scan_id uuid,
  received_at timestamptz,
  body jsonb,
  capture_id text,
  captured_at timestamptz,
  scan_level integer,
  new_claim jsonb
)
returns table (claim_id uuid, scan_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok_id uuid;
  tok_org uuid;
  tok_user uuid;
  tok_last_used timestamptz;
  use_scan_id uuid := coalesce(new_scan_id, gen_random_uuid());
  use_received_at timestamptz := coalesce(received_at, now());
  found_claim uuid;
begin
  select t.id, t.organization_id, t.user_id, t.last_used_at
    into tok_id, tok_org, tok_user, tok_last_used
  from public.device_tokens t
  join public.organization_members m
    on m.organization_id = t.organization_id and m.user_id = t.user_id
  where t.token_hash = public.device_secret_hash(device_receive_scan.token_hash)
    and t.revoked_at is null;

  if tok_id is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  if tok_last_used is null or tok_last_used < now() - interval '1 minute' then
    update public.device_tokens t
    set last_used_at = now()
    where t.id = tok_id;
  end if;

  if target_claim_id is not null then
    -- Both halves of the test in one query: the claim exists AND it is this organization's. A claim
    -- in another organization answers the same as no claim at all.
    select c.id into found_claim
    from public.claims c
    where c.id = target_claim_id
      and c.organization_id = tok_org;

    if found_claim is null then
      raise exception 'claim not found' using errcode = 'P0002';
    end if;

    insert into public.claim_scans
      (id, claim_id, organization_id, device_token_id, capture_id, captured_at, level, received_at, body, status)
    values
      (use_scan_id, found_claim, tok_org, tok_id,
       device_receive_scan.capture_id, device_receive_scan.captured_at, coalesce(scan_level, 0),
       use_received_at, device_receive_scan.body, 'pending');

    claim_id := found_claim;
    scan_id := use_scan_id;
    created := false;
    return next;
    return;
  end if;

  -- A new claim needs the whole summary, not just a payload: the list columns are what the claims
  -- list renders without reading the payload, and a row missing them would show as a blank line.
  if new_claim is null
     or jsonb_typeof(new_claim) <> 'object'
     or not (new_claim ?& array['payload', 'customer_name', 'job_number', 'address', 'insurer', 'step', 'status'])
     or jsonb_typeof(new_claim -> 'payload') <> 'object' then
    raise exception 'new claim missing' using errcode = '22023';
  end if;

  insert into public.claims as c
    (organization_id, created_by, customer_name, job_number, address, insurer, step, status, payload)
  values
    (tok_org, tok_user,
     coalesce(new_claim ->> 'customer_name', ''),
     coalesce(new_claim ->> 'job_number', ''),
     coalesce(new_claim ->> 'address', ''),
     coalesce(new_claim ->> 'insurer', ''),
     coalesce(new_claim ->> 'step', 'intake'),
     coalesce(new_claim ->> 'status', 'intake'),
     new_claim -> 'payload')
  returning c.id into found_claim;

  insert into public.claim_scans
    (id, claim_id, organization_id, device_token_id, capture_id, captured_at, level, received_at, body, status, resolved_at)
  values
    (use_scan_id, found_claim, tok_org, tok_id,
     device_receive_scan.capture_id, device_receive_scan.captured_at, coalesce(scan_level, 0),
     use_received_at, device_receive_scan.body, 'adopted', use_received_at);

  claim_id := found_claim;
  scan_id := use_scan_id;
  created := true;
  return next;
  return;
end;
$$;

revoke all on function public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb) from public;
grant execute on function public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. claim_scan_resolve — the browser has adopted or discarded a pending scan.
--
-- Called over the cookie session, so the caller is `auth.uid()` and the organization test is the
-- same `is_org_member` every policy uses; it is inside the UPDATE's WHERE so a scan in another
-- organization simply matches nothing. Only a pending row changes: resolving twice, or resolving a
-- scan that created its own claim, is a no-op that returns false, which the app reports as 404.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.claim_scan_resolve(uuid, text);
create or replace function public.claim_scan_resolve(scan_id uuid, new_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if new_status is null or new_status not in ('adopted', 'discarded') then
    raise exception 'bad status' using errcode = '22023';
  end if;

  update public.claim_scans s
  set status = new_status,
      resolved_at = now()
  where s.id = claim_scan_resolve.scan_id
    and s.status = 'pending'
    and public.is_org_member(s.organization_id);

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.claim_scan_resolve(uuid, text) from public;
grant execute on function public.claim_scan_resolve(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 7. device_token_revoke — unpair a phone.
--
-- The person who paired it may always revoke it; an owner may revoke any phone in the organization,
-- the same shape as the letterhead rule in 0005 — a phone that can post into the company's claims
-- is the company's business. A token already revoked, or one the caller may not touch, matches
-- nothing and the function returns false.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_token_revoke(uuid);
create or replace function public.device_token_revoke(token_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  changed integer;
begin
  update public.device_tokens t
  set revoked_at = now()
  where t.id = device_token_revoke.token_id
    and t.revoked_at is null
    and (t.user_id = caller or public.is_org_owner(t.organization_id));

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.device_token_revoke(uuid) from public;
grant execute on function public.device_token_revoke(uuid) to authenticated;
