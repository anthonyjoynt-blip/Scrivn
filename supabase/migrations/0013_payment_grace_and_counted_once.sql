-- Ready for real money: a card that fails gets a grace period, and a generation is counted once
-- (2026-10-14).
--
-- Run in the Supabase SQL Editor after 0012_teams.sql. It needs 0011_org_billing.sql (it refuses to
-- run without it). Safe to run twice. WRITTEN, NOT APPLIED.
--
-- Until it is applied the app behaves exactly as the build before it: a renewal the card does not
-- pay takes the plan away at once (as Stripe marks the subscription past due), and a generation is
-- counted every time it succeeds. Nothing breaks in the meantime; the code asks for these columns
-- and functions and falls back when they are not there (`isBillingSchemaMissing` in
-- lib/usageState.ts), the same way it waits for 0011.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'seat_limit'
  ) then
    raise exception '0013 needs 0011_org_billing.sql applied first.';
  end if;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 1. A CARD THAT FAILS
--
-- When a renewal is declined Stripe marks the subscription past due and tries the card again over
-- the following days. Before this the webhook read "past due" as "no plan", so one declined renewal
-- stopped a company's estimators on the spot, with no word to anyone. Now:
--
--   * the owner is emailed once per unpaid invoice, with a link to update the card;
--   * the plan keeps working for PAYMENT_GRACE_DAYS (lib/plans.ts, 7) from the first failure, which
--     is the retry window Stripe is set to (STRIPE.md, "A card that fails");
--   * every page shows a banner while it lasts, and generating pauses when it runs out;
--   * a payment that goes through clears all of it.
--
-- Two columns hold that state. The webhook writes them through the two functions below; nothing
-- else does. 0011 left `authenticated` able to update only the letterhead columns, and a column
-- added later is not among them, so an owner cannot clear their own failure from the browser.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.organizations
  add column if not exists payment_failed_at timestamptz,
  add column if not exists payment_failed_invoice text;

comment on column public.organizations.payment_failed_at is
  'When the card first failed for the plan''s unpaid invoice (the Stripe event time). Null = paid up. The plan keeps working for PAYMENT_GRACE_DAYS after it (lib/plans.ts). Written by the webhook only (0013).';
comment on column public.organizations.payment_failed_invoice is
  'The Stripe invoice that failed. The owner is emailed once per invoice, not once per retry. Cleared with payment_failed_at.';

-- ---------------------------------------------------------------------------------------------
-- org_payment_failed — record a failed payment, keeping the time of the FIRST failure.
--
-- Called for invoice.payment_failed (with the invoice) and for a subscription that turns past due
-- (without one; Stripe does not promise which of the two events arrives first). The grace period
-- runs from the earliest, so a retry that fails again does not extend it. `first_notice` is true
-- only the first time an invoice is seen, which is when the owner is emailed: a retry, or Stripe
-- delivering the same event twice, sends nothing more.
-- ---------------------------------------------------------------------------------------------

create or replace function public.org_payment_failed(org_id uuid, invoice_id text, failed_at timestamptz)
returns table (failed_since timestamptz, first_notice boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous text;
begin
  select o.payment_failed_invoice into previous
  from public.organizations o
  where o.id = org_payment_failed.org_id
  for update;
  if not found then
    return;
  end if;

  return query
    update public.organizations o
    -- least() ignores a null, so a first failure sets it and any later one keeps the earliest.
    set payment_failed_at = least(o.payment_failed_at, org_payment_failed.failed_at),
        payment_failed_invoice = coalesce(org_payment_failed.invoice_id, o.payment_failed_invoice)
    where o.id = org_payment_failed.org_id
    returning o.payment_failed_at,
              org_payment_failed.invoice_id is not null and org_payment_failed.invoice_id is distinct from previous;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- org_payment_settled — the plan is paid (or gone): clear the failure.
--
-- Only a failure from before `paid_at` is cleared. Stripe can deliver events out of order, and an
-- "active" snapshot taken before the card failed must not wipe out the failure that followed it.
-- Says whether anything was cleared.
-- ---------------------------------------------------------------------------------------------

create or replace function public.org_payment_settled(org_id uuid, paid_at timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations o
  set payment_failed_at = null,
      payment_failed_invoice = null
  where o.id = org_payment_settled.org_id
    and o.payment_failed_at is not null
    and o.payment_failed_at <= org_payment_settled.paid_at;
  return found;
end;
$$;

-- Supabase grants new functions in `public` to `anon` and `authenticated` by default (see 0012), so
-- revoking from `public` alone would leave these callable with the public key.
revoke all on function public.org_payment_failed(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.org_payment_settled(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.org_payment_failed(uuid, text, timestamptz) to service_role;
grant execute on function public.org_payment_settled(uuid, timestamptz) to service_role;
