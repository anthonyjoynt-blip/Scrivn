-- The plan, the claim counter and the free trial belong to the organization (2026-10-13).
--
-- Run in the Supabase SQL Editor after 0010_scan_dedupe.sql. Safe to run twice. Apply it, then
-- deploy the build that reads it — see THE CUTOVER below for why the two may be days apart without
-- harm.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY THE PLAN MOVES
--
-- 0001_profiles.sql reserved this space: "no shared/company-level settings (branding, billing,
-- plan) belong on this table — those are what would genuinely hurt to untangle." The letterhead went
-- to `organizations` in 0005. The subscription, the claim counter and the trial follow it here,
-- because a team shares one subscription and one allowance, and a counter per person would let a
-- company of five run five plans' worth of claims on one bill.
--
-- A person on their own is an organization of one (0004), so for everyone today nothing changes:
-- the same numbers, read from the row next door. The rules that read them are untouched and still
-- live in TypeScript — the hard caps (lib/plans.ts: 20 / 75 / 300), the 5-claim, 30-day trial
-- (lib/usage.ts), and the Scan-only plan, whose 'scan' tier carries no claims and whose webhook
-- rules are lib/billingTiers.ts.
--
-- WHAT MOVES, copied once from each person's profile onto the organization they own:
--   stripe_customer_id, subscription_tier, claims_used_this_period, period_reset_at   (0002)
--   trial_started_at, trial_claims_used, trial_ending_email_sent_at                   (0003)
--
-- WHAT DOES NOT: the profile columns stay where they are, no longer written by the app, so the build
-- before this one still finds them if it ever has to be put back. A later migration drops them once
-- this has run in production for a while. Until then they are history, not truth.
--
-- SEATS — `seat_limit` is room for team pricing, not a price. Null means no limit, which is every
-- organization today: no seat price has been chosen (owner, 2026-10-13). When one is, the webhook
-- writes the limit from the subscription (`seatLimitFor` in lib/plans.ts) and the invite functions in
-- 0012_teams.sql refuse an invite past it. Nothing here decides between "N seats included per plan"
-- and "a price per seat"; both fit this one column.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE CUTOVER
--
-- Migrations here are applied by hand and deploys happen separately, so there may be a gap in which
-- this has run and the previous build is still live, still writing the PROFILE columns: a trial
-- claim counted, a webhook granting a plan. Without help those writes would land on columns the new
-- build no longer reads, and the organization's copy would quietly fall behind — a trial claim
-- uncounted is a free claim.
--
-- So a trigger mirrors any write to a profile's billing columns onto the organization that person
-- owns ALONE, column by column, only the columns that actually changed. Once the new build is live
-- nothing writes those profile columns and the trigger never fires again; it goes with the columns
-- in the cleanup migration. It never touches an organization with more than one member, because
-- such an organization can only exist after the new build — whose writes go to the organization
-- directly — and a profile write must never move a team's plan.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------------------------
-- The columns, and the one-time copy.
--
-- In one block, keyed on whether the columns exist yet, so a second run copies nothing. That
-- matters: once the new build is live the organization's counters move on, and copying the frozen
-- profile values over them again would hand every organization back the claims it has used.
--
-- The copy follows the owner membership. Every account today has exactly one membership, as owner
-- of its own organization (0004's trigger and backfill made it so); the check below refuses to guess
-- if that has ever been broken by hand.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'subscription_tier'
  ) then
    return;
  end if;

  if exists (select 1 from public.organization_members m group by m.user_id having count(*) > 1) then
    raise exception 'Someone belongs to more than one organization, so whose plan goes where is ambiguous. Find them with: select user_id from public.organization_members group by user_id having count(*) > 1;';
  end if;

  alter table public.organizations
    add column stripe_customer_id text,
    add column subscription_tier text,
    add column claims_used_this_period integer not null default 0,
    add column period_reset_at timestamptz,
    add column trial_started_at timestamptz not null default now(),
    add column trial_claims_used integer not null default 0,
    add column trial_ending_email_sent_at timestamptz,
    add column seat_limit integer;

  update public.organizations o
  set stripe_customer_id = p.stripe_customer_id,
      subscription_tier = p.subscription_tier,
      claims_used_this_period = p.claims_used_this_period,
      period_reset_at = p.period_reset_at,
      trial_started_at = p.trial_started_at,
      trial_claims_used = p.trial_claims_used,
      trial_ending_email_sent_at = p.trial_ending_email_sent_at
  from public.organization_members m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = o.id
    and m.role = 'owner';
end;
$$;

comment on column public.organizations.stripe_customer_id is
  'Stripe Customer id, set on first checkout. The join key the webhook uses to find this organization from a Stripe event. Moved from profiles in 0011.';
comment on column public.organizations.subscription_tier is
  'null = no active subscription. Otherwise starter | growth | unlimited | scan. Written ONLY by the webhook via the service role. Moved from profiles in 0011.';
comment on column public.organizations.claims_used_this_period is
  'Hard-cap counter, shared by everyone in the organization. Incremented on each successful document generation (org_count_claim); reset to 0 when a new billing period starts.';
comment on column public.organizations.period_reset_at is
  'End of the current Stripe billing period. When a subscription.updated event carries a later period end, the counter resets.';
comment on column public.organizations.trial_started_at is
  'Start of the 30-day free-trial window. Set at signup, reset to confirmation time by app/auth/confirm.';
comment on column public.organizations.trial_claims_used is
  'Claims consumed during the free trial. Separate from claims_used_this_period so subscribing starts clean.';
comment on column public.organizations.trial_ending_email_sent_at is
  'Guards the trial-ending email against repeat sends. Null = not yet sent.';
comment on column public.organizations.seat_limit is
  'How many people the subscription covers. Null = no limit (no seat price chosen yet). Written by the webhook; read by the invite functions in 0012.';

-- Constraints are added separately so a re-run does not fail on the ones that already exist.
alter table public.organizations drop constraint if exists organizations_subscription_tier_check;
alter table public.organizations add constraint organizations_subscription_tier_check
  check (subscription_tier is null or subscription_tier in ('starter', 'growth', 'unlimited', 'scan'));

alter table public.organizations drop constraint if exists organizations_seat_limit_check;
alter table public.organizations add constraint organizations_seat_limit_check
  check (seat_limit is null or seat_limit >= 1);

-- One Stripe customer maps to at most one organization, as it did to one profile.
create unique index if not exists organizations_stripe_customer_id_key
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

comment on column public.profiles.stripe_customer_id is 'SUPERSEDED by organizations.stripe_customer_id (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.subscription_tier is 'SUPERSEDED by organizations.subscription_tier (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.claims_used_this_period is 'SUPERSEDED by organizations.claims_used_this_period (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.period_reset_at is 'SUPERSEDED by organizations.period_reset_at (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.trial_started_at is 'SUPERSEDED by organizations.trial_started_at (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.trial_claims_used is 'SUPERSEDED by organizations.trial_claims_used (0011). No longer written by the app; dropped in a later migration.';
comment on column public.profiles.trial_ending_email_sent_at is 'SUPERSEDED by organizations.trial_ending_email_sent_at (0011). No longer written by the app; dropped in a later migration.';

-- ---------------------------------------------------------------------------------------------
-- CRITICAL: the same column lockdown 0002 put on profiles.
--
-- 0005 let an owner UPDATE their organization row, for the letterhead, with a row-level policy —
-- and RLS decides WHICH ROWS, never WHICH COLUMNS. With the plan now on that row, an owner could
-- otherwise run, from the browser, with the public key:
--
--   supabase.from('organizations').update({ subscription_tier: 'unlimited', claims_used_this_period: 0 })
--
-- So `authenticated` may update the letterhead columns and nothing else; the billing columns are
-- written by the service role alone (the webhook, and lib/usage.ts through org_count_claim).
-- lib/organizationRepo.ts writes exactly these eight, so nothing in the app notices. Insert and
-- delete have no policy and stay closed; the revoke says so twice.
-- ---------------------------------------------------------------------------------------------

revoke insert, update, delete on public.organizations from anon, authenticated;
grant update (name, tagline, primary_color, accent_color, logo_path, logo_width, logo_height, letterhead_configured_at)
  on public.organizations to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_count_claim — count one claim against an organization, in one statement.
--
-- lib/usage.ts counted with a read and then a write, and said so: two generations finishing in the
-- same instant could both read 4 and both write 5. One person rarely has two in flight; a team
-- sharing one counter will, so the increment moves into the database, where it is atomic. Which
-- counter is the caller's decision (`on_trial`, from the tier it read — the tier rules stay in
-- TypeScript); the function only adds one and says what the count was before and after, which is
-- what the 80% and at-limit emails key on.
--
-- Service role only: a counter the browser could call is a counter it could also not call.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_count_claim(uuid, boolean);
create function public.org_count_claim(org_id uuid, on_trial boolean)
returns table (used_before integer, used_after integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if on_trial then
    return query
      update public.organizations o
      set trial_claims_used = o.trial_claims_used + 1
      where o.id = org_count_claim.org_id
      returning o.trial_claims_used - 1, o.trial_claims_used;
  else
    return query
      update public.organizations o
      set claims_used_this_period = o.claims_used_this_period + 1
      where o.id = org_count_claim.org_id
      returning o.claims_used_this_period - 1, o.claims_used_this_period;
  end if;
end;
$$;

revoke all on function public.org_count_claim(uuid, boolean) from public, anon, authenticated;
grant execute on function public.org_count_claim(uuid, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- The cutover mirror — see THE CUTOVER in the header.
-- ---------------------------------------------------------------------------------------------

create or replace function public.mirror_profile_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  select m.organization_id into org
  from public.organization_members m
  where m.user_id = new.id
    and m.role = 'owner'
    and (select count(*) from public.organization_members x where x.organization_id = m.organization_id) = 1
  limit 1;

  if org is null then
    return new;
  end if;

  update public.organizations o
  set stripe_customer_id = case when new.stripe_customer_id is distinct from old.stripe_customer_id then new.stripe_customer_id else o.stripe_customer_id end,
      subscription_tier = case when new.subscription_tier is distinct from old.subscription_tier then new.subscription_tier else o.subscription_tier end,
      claims_used_this_period = case when new.claims_used_this_period is distinct from old.claims_used_this_period then new.claims_used_this_period else o.claims_used_this_period end,
      period_reset_at = case when new.period_reset_at is distinct from old.period_reset_at then new.period_reset_at else o.period_reset_at end,
      trial_started_at = case when new.trial_started_at is distinct from old.trial_started_at then new.trial_started_at else o.trial_started_at end,
      trial_claims_used = case when new.trial_claims_used is distinct from old.trial_claims_used then new.trial_claims_used else o.trial_claims_used end,
      trial_ending_email_sent_at = case when new.trial_ending_email_sent_at is distinct from old.trial_ending_email_sent_at then new.trial_ending_email_sent_at else o.trial_ending_email_sent_at end
  where o.id = org;

  return new;
end;
$$;

revoke all on function public.mirror_profile_billing() from public, anon, authenticated;

drop trigger if exists profiles_mirror_billing on public.profiles;
create trigger profiles_mirror_billing
  after update of stripe_customer_id, subscription_tier, claims_used_this_period, period_reset_at,
                  trial_started_at, trial_claims_used, trial_ending_email_sent_at
  on public.profiles
  for each row execute function public.mirror_profile_billing();
