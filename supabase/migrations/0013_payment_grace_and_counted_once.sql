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

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 2. A GENERATION IS COUNTED ONCE
--
-- Offline mode (2026-10-13) sends a generation again when its answer was lost on the way back: the
-- connection died after the server had finished and counted it, so the device never saw the
-- documents and, when the signal returned, asked again. That counted the claim twice.
--
-- Now every generation carries an id the device chooses once (`jobId`, lib/aiJobs.ts) and sends on
-- every retry. The server:
--
--   * begins it (`generation_job_begin`): a new id is written down as running; an id already
--     finished answers with the documents it produced, which the server sends back again without
--     calling Claude or counting; an id still running says so, and the device waits;
--   * finishes it (`generation_job_finish`): the documents are kept and the claim is counted, in one
--     statement, only by whichever request finishes the id first;
--   * releases it (`generation_job_release`) if the generation failed, so a retry can run.
--
-- Returning the saved documents, rather than generating again uncounted, is deliberate: an id that
-- re-ran for free would be a way to generate for free. A repeat is only ever the same answer.
--
-- Ids are the person's own (the key is person + id), kept 30 days — far longer than any site visit
-- a step waits through — and then forgotten. The documents kept are the ones already saved on the
-- claim; they go with the account (on delete cascade).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.generation_jobs (
  user_id uuid not null references auth.users (id) on delete cascade,
  id uuid not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  documents jsonb,
  primary key (user_id, id)
);

comment on table public.generation_jobs is
  'One row per generation the device sent with an id (lib/aiJobs.ts), so a retry after a lost answer is answered from here and not counted again. Service role only; kept 30 days (0013).';

-- The functions below are its only door. RLS with no policy, and no grant, says so twice.
alter table public.generation_jobs enable row level security;
revoke all on public.generation_jobs from anon, authenticated;

-- generation_job_begin. A request that has not finished within 6 minutes has died (Vercel stops a
-- function at 300 s), so a retry may take its id over rather than wait for an answer that never comes.
create or replace function public.generation_job_begin(job_id uuid, caller uuid, org_id uuid)
returns table (outcome text, saved jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  job public.generation_jobs%rowtype;
begin
  delete from public.generation_jobs g
  where g.user_id = generation_job_begin.caller and g.started_at < now() - interval '30 days';

  insert into public.generation_jobs (user_id, id, organization_id)
  values (generation_job_begin.caller, generation_job_begin.job_id, generation_job_begin.org_id)
  on conflict do nothing;
  if found then
    return query select 'new'::text, null::jsonb;
    return;
  end if;

  select * into job
  from public.generation_jobs g
  where g.user_id = generation_job_begin.caller and g.id = generation_job_begin.job_id
  for update;

  if job.finished_at is not null then
    return query select 'done'::text, job.documents;
  elsif job.started_at < now() - interval '6 minutes' then
    update public.generation_jobs g
    set started_at = now(), organization_id = generation_job_begin.org_id
    where g.user_id = generation_job_begin.caller and g.id = generation_job_begin.job_id;
    return query select 'new'::text, null::jsonb;
  else
    return query select 'running'::text, null::jsonb;
  end if;
end;
$$;

-- Keeps the documents and counts the claim, through org_count_claim (0011), only if this request is
-- the one that finishes the id. No row back means it was already counted.
create or replace function public.generation_job_finish(job_id uuid, caller uuid, on_trial boolean, documents jsonb)
returns table (used_before integer, used_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid;
begin
  update public.generation_jobs g
  set finished_at = now(), documents = generation_job_finish.documents
  where g.user_id = generation_job_finish.caller and g.id = generation_job_finish.job_id and g.finished_at is null
  returning g.organization_id into org;

  if org is null then
    return;
  end if;
  return query select c.used_before, c.used_after from public.org_count_claim(org, generation_job_finish.on_trial) c;
end;
$$;

-- A generation that failed gives its id back, so the retry runs. A finished one is never released.
create or replace function public.generation_job_release(job_id uuid, caller uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.generation_jobs g
  where g.user_id = generation_job_release.caller and g.id = generation_job_release.job_id and g.finished_at is null;
$$;

revoke all on function public.generation_job_begin(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.generation_job_finish(uuid, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.generation_job_release(uuid, uuid) from public, anon, authenticated;
grant execute on function public.generation_job_begin(uuid, uuid, uuid) to service_role;
grant execute on function public.generation_job_finish(uuid, uuid, boolean, jsonb) to service_role;
grant execute on function public.generation_job_release(uuid, uuid) to service_role;
