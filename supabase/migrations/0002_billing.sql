-- Billing columns on profiles, plus the column-level lockdown that makes them safe to store there.
--
-- Run this in the Supabase SQL Editor after 0001_profiles.sql. Safe to re-run.

alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists subscription_tier text,
  add column if not exists claims_used_this_period integer not null default 0,
  add column if not exists period_reset_at timestamptz;

comment on column public.profiles.stripe_customer_id is
  'Stripe Customer id, set on first checkout. The join key the webhook uses to find this profile from a Stripe event.';
comment on column public.profiles.subscription_tier is
  'null = no active subscription. Otherwise starter | growth | unlimited. Written ONLY by the webhook via the service role.';
comment on column public.profiles.claims_used_this_period is
  'Hard-cap counter. Incremented on each successful document generation; reset to 0 when a new billing period starts.';
comment on column public.profiles.period_reset_at is
  'End of the current Stripe billing period. When a subscription.updated event carries a later period end, the counter resets.';

-- One Stripe customer maps to at most one profile. Partial index so the many null rows don't collide.
create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Guard against a typo'd tier silently disabling a customer's access: an unrecognised tier has no
-- cap defined in lib/plans.ts and would be treated as "no plan".
alter table public.profiles drop constraint if exists profiles_subscription_tier_check;
alter table public.profiles add constraint profiles_subscription_tier_check
  check (subscription_tier is null or subscription_tier in ('starter', 'growth', 'unlimited'));

-- ---------------------------------------------------------------------------------------------
-- CRITICAL: stop users from writing their own billing state.
--
-- 0001 granted the owner UPDATE on their whole profile row, which was fine when every column was
-- descriptive (name, company, phone). It is NOT fine now. The anon key is public and runs in the
-- browser, so with a row-level-only policy any signed-in user could run:
--
--   supabase.from('profiles').update({ subscription_tier: 'unlimited', claims_used_this_period: 0 })
--
-- against their own row and hand themselves a free unlimited plan. Row Level Security controls
-- WHICH ROWS you may touch, not WHICH COLUMNS — so the fix is column-level privileges.
--
-- After this, `authenticated` may only update the three descriptive columns. The billing columns
-- are writable solely by the service role, which is exactly and only the Stripe webhook.
-- ---------------------------------------------------------------------------------------------

revoke update on public.profiles from authenticated;
grant update (full_name, company_name, phone) on public.profiles to authenticated;

-- select/insert are unchanged: reading your own billing state is fine and the app needs it.
