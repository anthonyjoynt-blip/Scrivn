-- Free trial: 5 claims within 30 days, no card required.
--
-- Run in the Supabase SQL Editor after 0002_billing.sql. Safe to re-run.
--
-- WHY THIS IS APP-SIDE AND NOT A STRIPE TRIAL. Stripe's `trial_period_days` is purely time-based —
-- it has no concept of a "claim", so it cannot enforce "5 uses". And because this trial takes no
-- card, there is no Stripe subscription to attach a trial to in the first place. Both halves of the
-- limit therefore live here, counted against these columns.

alter table public.profiles
  -- Defaults to now() so it is never null for a new signup. The confirmation handler resets it to
  -- the moment the account actually becomes usable — someone who signs up and confirms a fortnight
  -- later should get a full 30 days from confirmation, not 16 days from signup.
  add column if not exists trial_started_at timestamptz not null default now(),
  -- Deliberately separate from claims_used_this_period. Keeping them apart means subscribing starts
  -- a clean allowance rather than inheriting trial usage, and it preserves the record of how much
  -- someone used before converting.
  add column if not exists trial_claims_used integer not null default 0,
  -- Set once, when the "trial almost over" email goes out, so it can't send twice.
  add column if not exists trial_ending_email_sent_at timestamptz;

comment on column public.profiles.trial_started_at is
  'Start of the 30-day free-trial window. Set at signup, reset to confirmation time by app/auth/confirm.';
comment on column public.profiles.trial_claims_used is
  'Claims consumed during the free trial. Separate from claims_used_this_period so subscribing starts clean.';
comment on column public.profiles.trial_ending_email_sent_at is
  'Guards the trial-ending email against repeat sends. Null = not yet sent.';

-- Existing accounts created before the trial existed get their window starting now rather than
-- retroactively expired — nobody should discover their trial ended before it was announced.
update public.profiles set trial_started_at = now() where trial_started_at is null;

-- ---------------------------------------------------------------------------------------------
-- Same column-level lockdown as the billing columns (see 0002): these decide whether someone can
-- generate documents for free, so a user must not be able to write them from the browser. Without
-- this, a signed-in user could reset trial_claims_used to 0 and have an unlimited free trial.
--
-- Re-granting the full descriptive set here rather than adding to it, because GRANT on a column
-- list replaces nothing — it's additive — so this simply restates the allowed set for clarity.
-- ---------------------------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
grant update (full_name, company_name, phone) on public.profiles to authenticated;
