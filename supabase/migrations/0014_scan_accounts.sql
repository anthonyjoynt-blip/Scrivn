-- Scrivn Scan on its own: free scans counted here, deleting an account, and the guards on new
-- accounts and on AI spend (2026-10-14).
--
-- Run in the Supabase SQL Editor after 0013_payment_grace_and_counted_once.sql (it needs 0011 and 0012;
-- it does not depend on 0013, which was written alongside it). Safe to run twice. Every object here is new
-- and nothing reads it until the build that ships with it is deployed, so the two may be applied in
-- either order; until this has run, that build counts no scans and refuses none (lib/scanAllowance.ts),
-- and its guards let everything through (lib/requestGuard.ts) — which is what production does today.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHAT A "SCAN" IS, FOR THE FREE TIER
--
-- One capture: everything walked between pressing Start and the next Start. Its id is the one the
-- phone already sends with every scan (`capture_id`, 0010), so:
--
--   * a capture is counted once, the first time it leaves the phone — sent to Scrivn, or saved as a
--     plan with Share — and never again, however many times it is sent, re-sent, shared or sent to
--     another claim;
--   * the levels and the exterior of one walk are one scan (they travel under one capture id);
--   * a walk that never leaves the phone is not counted, so a walk abandoned half way costs nothing.
--
-- Counted per ORGANIZATION (the plan is the organization's, 0011) per calendar month, UTC. An
-- organization with any plan — a Scrivn plan or the Scan plan — has unlimited scans; the free limit
-- (three, SCAN_PLAN.freeScansPerMonth in lib/plans.ts) is the caller's to pass, because the tier rules
-- live in TypeScript as they do for claims.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- DELETING AN ACCOUNT
--
-- `account_close` does the database half of deleting a person (lib/accountDeletion.ts does the rest:
-- the Stripe subscription first, the stored photos and logo, then the auth user, whose foreign keys
-- clear the profile, memberships and phones). Per PRIVACY.md: claims are kept until the company
-- deletes them. A person deleting their account when nobody else is in their organization IS the
-- company deleting them, so that organization goes with everything in it. A person on a team leaves
-- it; the team's claims stay with the team.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- HOW SQL TALKS BACK
--
-- As in 0006 and 0012: P0411 "hand the organization over first", 22023 a malformed argument.
-- Every function here is SECURITY DEFINER with an empty search_path and is granted to the service
-- role ONLY: they are called by the server after it has checked who is asking, and a counter or a
-- limit the browser could call is one it could also not call. The one exception is
-- device_token_revoke_self (6), which a phone calls with its own token, like 0006's functions.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'personal_for'
  ) then
    raise exception '0014_scan_accounts.sql needs 0011_org_billing.sql and 0012_teams.sql applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. scan_uses — one row per capture an organization has taken off a phone.
--
-- Readable within the organization (the Account page shows "2 of 3 this month"); written only by
-- org_use_scan. `how` says which way it first left: sent to Scrivn or saved as a plan on the phone.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.scan_uses (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- The phone's capture id, or 'scan:<id>' for a scan sent by a build too old to send one.
  capture_key text not null check (length(capture_key) between 1 and 200),
  used_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  device_token_id uuid references public.device_tokens (id) on delete set null,
  how text not null check (how in ('sent', 'saved')),
  primary key (organization_id, capture_key)
);

comment on table public.scan_uses is
  'Captures taken off a phone, one row each, for the free tier''s monthly count. Readable within the organization; written only by org_use_scan.';

create index if not exists scan_uses_org_used_at_idx on public.scan_uses (organization_id, used_at desc);

alter table public.scan_uses enable row level security;
revoke insert, update, delete on public.scan_uses from anon, authenticated;

drop policy if exists "Scan uses are viewable within the organization" on public.scan_uses;
create policy "Scan uses are viewable within the organization"
  on public.scan_uses for select
  to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------------------------
-- org_use_scan — take one scan off an organization's allowance.
--
-- `free_limit` null means the organization has a plan (unlimited); the use is recorded all the same,
-- so the count is there if the plan lapses mid-month. A capture already recorded is always allowed
-- and counted nothing. Serialised per organization, so two phones sending their third and fourth at
-- the same instant cannot both be the third.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_use_scan(uuid, text, uuid, uuid, text, integer);
create function public.org_use_scan(org_id uuid, capture_key text, person uuid, token_id uuid, how text, free_limit integer)
returns table (allowed boolean, counted boolean, used integer, month_start timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  start_of_month timestamptz := date_trunc('month', now(), 'UTC');
  this_month integer;
begin
  if org_use_scan.capture_key is null or length(org_use_scan.capture_key) not between 1 and 200
     or org_use_scan.how not in ('sent', 'saved') then
    raise exception 'bad scan' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('scan_uses:' || org_use_scan.org_id::text, 0));

  select count(*)::integer into this_month
  from public.scan_uses u
  where u.organization_id = org_use_scan.org_id
    and u.used_at >= start_of_month;

  if exists (
    select 1 from public.scan_uses u
    where u.organization_id = org_use_scan.org_id and u.capture_key = org_use_scan.capture_key
  ) then
    return query select true, false, this_month, start_of_month;
    return;
  end if;

  if org_use_scan.free_limit is not null and this_month >= org_use_scan.free_limit then
    return query select false, false, this_month, start_of_month;
    return;
  end if;

  insert into public.scan_uses (organization_id, capture_key, user_id, device_token_id, how)
  values (org_use_scan.org_id, org_use_scan.capture_key, org_use_scan.person, org_use_scan.token_id, org_use_scan.how);

  return query select true, true, this_month + 1, start_of_month;
end;
$$;

revoke all on function public.org_use_scan(uuid, text, uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.org_use_scan(uuid, text, uuid, uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. request_limits — counted attempts in fixed windows, for the guards in lib/requestGuard.ts:
-- new accounts per address per day and in all per day, and phone sign-ins per address and per email.
--
-- The key is a salted hash (an address, an email) or 'all'; nothing here can be read back into one.
-- No policies at all: the service role only. Rows older than two days are swept as the table is used.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.request_limits (
  bucket text not null check (length(bucket) between 1 and 40),
  key text not null check (length(key) between 1 and 128),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, key, window_start)
);

comment on table public.request_limits is
  'Attempts per fixed window for the sign-up and sign-in guards (lib/requestGuard.ts). Keys are salted hashes. Service role only.';

alter table public.request_limits enable row level security;
revoke all on public.request_limits from anon, authenticated;

-- Counts this attempt and says whether it is within `max_hits` for its window. An attempt over the
-- limit is counted too, so hammering does not open the door again before the window ends.
drop function if exists public.request_limit_hit(text, text, integer, integer);
create function public.request_limit_hit(bucket text, key text, window_seconds integer, max_hits integer)
returns table (allowed boolean, hits integer, retry_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  win timestamptz;
  n integer;
begin
  if window_seconds is null or window_seconds < 1 or max_hits is null or max_hits < 0 then
    raise exception 'bad limit' using errcode = '22023';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / window_seconds) * window_seconds);

  insert into public.request_limits as r (bucket, key, window_start, hits)
  values (request_limit_hit.bucket, request_limit_hit.key, win, 1)
  -- By the constraint's name, for the same reason as ai_spend_add below.
  on conflict on constraint request_limits_pkey do update set hits = r.hits + 1
  returning r.hits into n;

  -- Housekeeping, now and then: one call in fifty sweeps the stale windows.
  if random() < 0.02 then
    delete from public.request_limits r where r.window_start < now() - interval '2 days';
  end if;

  return query select n <= max_hits, n, win + make_interval(secs => window_seconds);
end;
$$;

revoke all on function public.request_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.request_limit_hit(text, text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. trial_emails — one free trial per email address.
--
-- A salted hash of the address as normalised by lib/requestGuard.ts (lower case, "+tag" dropped, a
-- Gmail address's dots dropped), recorded when an account is made through Scrivn's sign-up. It is
-- kept when the account is deleted — that is its purpose: without it, deleting an account and
-- signing up again would be five more free claims, as often as anyone liked. PRIVACY.md says so.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.trial_emails (
  email_hash text primary key check (length(email_hash) between 32 and 128),
  first_seen timestamptz not null default now()
);

comment on table public.trial_emails is
  'Salted hashes of normalised email addresses that have had a free trial, kept after an account is deleted so the trial cannot be claimed twice. Service role only.';

alter table public.trial_emails enable row level security;
revoke all on public.trial_emails from anon, authenticated;

-- True when this address has had a trial before (and so the new account starts with it spent).
drop function if exists public.trial_email_seen(text);
create function public.trial_email_seen(email_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
begin
  insert into public.trial_emails (email_hash) values (trial_email_seen.email_hash)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  return inserted = 0;
end;
$$;

revoke all on function public.trial_email_seen(text) from public, anon, authenticated;
grant execute on function public.trial_email_seen(text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4. ai_spend_days — what the Claude calls cost, estimated, per day.
--
-- lib/anthropic.ts reports each call's tokens; lib/aiSpend.ts prices them and adds them here. The
-- day is the owner's (America/Edmonton by default, AI_SPEND_TIMEZONE). The alarm is claimed in the
-- same statement that crosses the threshold, so it goes once a day however many calls race past it;
-- `ai_spend_alarm_unsent` gives it back when the email did not go.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.ai_spend_days (
  day date primary key,
  calls integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  cache_read_tokens bigint not null default 0,
  usd numeric(12, 4) not null default 0,
  alarm_sent_at timestamptz
);

comment on table public.ai_spend_days is
  'Estimated Claude spend per day, from the tokens each call reports (lib/aiSpend.ts). An estimate: the Anthropic console is the authority. Service role only.';

alter table public.ai_spend_days enable row level security;
revoke all on public.ai_spend_days from anon, authenticated;

drop function if exists public.ai_spend_add(date, bigint, bigint, bigint, bigint, numeric, numeric);
create function public.ai_spend_add(day date, input_tokens bigint, output_tokens bigint, cache_write_tokens bigint, cache_read_tokens bigint, usd numeric, alarm_usd numeric)
returns table (total_usd numeric, calls integer, alarm boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  t numeric;
  c integer;
  sent timestamptz;
  claimed integer := 0;
begin
  insert into public.ai_spend_days as d (day, calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, usd)
  values (ai_spend_add.day, 1, greatest(ai_spend_add.input_tokens, 0), greatest(ai_spend_add.output_tokens, 0),
          greatest(ai_spend_add.cache_write_tokens, 0), greatest(ai_spend_add.cache_read_tokens, 0), greatest(ai_spend_add.usd, 0))
  -- By the constraint's name: a bare (day) here would be read as the parameter of the same name.
  on conflict on constraint ai_spend_days_pkey do update set
    calls = d.calls + 1,
    input_tokens = d.input_tokens + excluded.input_tokens,
    output_tokens = d.output_tokens + excluded.output_tokens,
    cache_write_tokens = d.cache_write_tokens + excluded.cache_write_tokens,
    cache_read_tokens = d.cache_read_tokens + excluded.cache_read_tokens,
    usd = d.usd + excluded.usd
  returning d.usd, d.calls, d.alarm_sent_at into t, c, sent;

  if ai_spend_add.alarm_usd is not null and t >= ai_spend_add.alarm_usd and sent is null then
    update public.ai_spend_days d set alarm_sent_at = now()
    where d.day = ai_spend_add.day and d.alarm_sent_at is null;
    get diagnostics claimed = row_count;
  end if;

  return query select t, c, claimed > 0;
end;
$$;

revoke all on function public.ai_spend_add(date, bigint, bigint, bigint, bigint, numeric, numeric) from public, anon, authenticated;
grant execute on function public.ai_spend_add(date, bigint, bigint, bigint, bigint, numeric, numeric) to service_role;

drop function if exists public.ai_spend_alarm_unsent(date);
create function public.ai_spend_alarm_unsent(day date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.ai_spend_days d set alarm_sent_at = null where d.day = ai_spend_alarm_unsent.day;
$$;

revoke all on function public.ai_spend_alarm_unsent(date) from public, anon, authenticated;
grant execute on function public.ai_spend_alarm_unsent(date) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. Deleting an account — see the header.
--
-- account_deletion_plan says what deleting `person` would do, without doing it: one row per
-- organization touched, 'delete' for one that is theirs alone (the one they own with nobody else in
-- it, and their own organization set aside while they are on a team), 'leave' for a team they are on.
-- The Stripe customers come with it, so the server can cancel a plan BEFORE anything is deleted. An
-- owner with other people in their organization is refused (P0411): a team is never left without an
-- owner (TEAMS.md, Known gaps).
--
-- account_close does it: the phones stop, unexchanged codes go, problem reports they sent go (they
-- hold what was typed in the note and contact boxes), and each organization is left or deleted —
-- deleting cascades its claims, scans, phones, invites and scan counts (0004, 0006, 0012, above).
-- The auth user is deleted afterwards by the server, which clears the profile and the membership.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.account_deletion_plan(uuid);
create function public.account_deletion_plan(person uuid)
returns table (organization_id uuid, stripe_customer_id text, action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  my_org uuid;
  my_role text;
  others integer := 0;
begin
  if person is null then
    raise exception 'no person' using errcode = '22023';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = account_deletion_plan.person;

  if my_org is not null then
    select count(*)::integer into others
    from public.organization_members m
    where m.organization_id = my_org and m.user_id <> account_deletion_plan.person;

    if others > 0 and my_role = 'owner' then
      raise exception 'the owner hands the organization over before deleting their account' using errcode = 'P0411';
    end if;
  end if;

  return query
    select o.id, o.stripe_customer_id, case when o.id = my_org and others > 0 then 'leave' else 'delete' end
    from public.organizations o
    where o.id = my_org
       or (o.personal_for = account_deletion_plan.person
           and not exists (select 1 from public.organization_members x where x.organization_id = o.id));
end;
$$;

revoke all on function public.account_deletion_plan(uuid) from public, anon, authenticated;
grant execute on function public.account_deletion_plan(uuid) to service_role;

drop function if exists public.account_close(uuid);
create function public.account_close(person uuid)
returns table (organization_id uuid, action text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- The plan again, under the lock this transaction now holds, so nobody joined in between.
  perform 1 from public.organization_members m where m.user_id = account_close.person for update;

  for r in select * from public.account_deletion_plan(account_close.person) loop
    if r.action = 'leave' then
      delete from public.organization_members m
      where m.organization_id = r.organization_id and m.user_id = account_close.person;
    else
      delete from public.scan_reports s where s.organization_id = r.organization_id;
      delete from public.organizations o where o.id = r.organization_id;
    end if;
    organization_id := r.organization_id;
    action := r.action;
    return next;
  end loop;

  update public.device_tokens t set revoked_at = now()
  where t.user_id = account_close.person and t.revoked_at is null;
  delete from public.device_pairings p where p.user_id = account_close.person;
  delete from public.scan_reports s where s.user_id = account_close.person;
end;
$$;

revoke all on function public.account_close(uuid) from public, anon, authenticated;
grant execute on function public.account_close(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. device_token_revoke_self — Sign out, from the phone.
--
-- 0006's device_token_revoke is for the Account page (a session revoking a phone). A phone signing
-- itself out has only its token, so this takes the token's hash, as every phone-facing function does,
-- and revokes that one token: the phone gives up its own standing grant, nothing more. True when it
-- was live. Granted to anon like the other phone functions — the token is the credential.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.device_token_revoke_self(text);
create function public.device_token_revoke_self(token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.device_tokens t
  set revoked_at = now()
  where t.token_hash = public.device_secret_hash(device_token_revoke_self.token_hash)
    and t.revoked_at is null;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.device_token_revoke_self(text) from public;
grant execute on function public.device_token_revoke_self(text) to anon, authenticated, service_role;
