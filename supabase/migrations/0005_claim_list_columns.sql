-- What the claims list searches, sorts and groups by.
--
-- Run this in the Supabase SQL Editor after 0004_organizations_and_claims.sql. Safe to re-run.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- WHY THESE ARE COLUMNS AND NOT jsonb LOOKUPS
--
-- Every value here already exists inside `payload`, and Postgres can search jsonb. The reason not to
-- is the same reason `customer_name` and `job_number` were pulled out in 0004: the payload contains
-- the sketch, which is the largest thing in the row by an order of magnitude. A search that reads
-- payload reads every sketch in the organization to find one claim by insurer.
--
-- These are written by the app on every save, from the same object that becomes the payload — see
-- `claimSummary` in lib/claimState.ts, which is the one place that decides what gets copied out.
--
-- `status` is NOT the same thing as `step`. `step` is the screen the PM last had open, so a claim
-- they opened and glanced at reads as "intake" however complete it is. `status` is derived from what
-- the claim actually contains (see `claimStatus`), which is what a list has to sort by if sorting is
-- to mean anything.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.claims
  add column if not exists address text not null default '',
  add column if not exists insurer text not null default '',
  add column if not exists status text not null default 'intake';

comment on column public.claims.address is
  'Copied out of payload for search. Not authoritative — the payload is.';
comment on column public.claims.insurer is
  'Copied out of payload for search. Not authoritative — the payload is.';
comment on column public.claims.status is
  'Where the claim actually is, derived from its contents by claimStatus() — NOT the same as `step`, which is merely the last screen open.';

-- No CHECK constraint on `status` on purpose, matching `step` in 0004 and for the same reason: the
-- set of statuses belongs to the application and will grow, and a claim that fails to SAVE because a
-- new status was added would be a far worse outcome than an unfamiliar label in a list.

-- ---------------------------------------------------------------------------------------------
-- Search.
--
-- `ilike '%term%'` cannot use an ordinary btree index — the leading wildcard rules it out — so this
-- is a trigram index, which can. pg_trgm ships with Supabase.
--
-- One index across the four searchable fields concatenated, rather than four indexes: the search box
-- is a single field that looks in all of them, so that is the query shape to serve. The expression
-- below must match `searchExpression` in lib/claimsRepo.ts exactly, or the index is simply never
-- used and the search silently degrades to a sequential scan.
-- ---------------------------------------------------------------------------------------------

create extension if not exists pg_trgm;

create index if not exists claims_search_idx
  on public.claims
  using gin ((coalesce(customer_name, '') || ' ' || coalesce(job_number, '') || ' ' || coalesce(address, '') || ' ' || coalesce(insurer, '')) gin_trgm_ops);

-- The "my claims" filter, which is the default view.
create index if not exists claims_created_by_idx
  on public.claims (organization_id, created_by, updated_at desc);

-- ---------------------------------------------------------------------------------------------
-- Backfill the rows that predate these columns.
--
-- Address and insurer come straight out of the payload. `status` deliberately does NOT: working it
-- out properly means running the gap-check engine, which is TypeScript and cannot run here. A rough
-- guess in SQL would be worse than an honest placeholder, because a wrong status is invisible — it
-- just sorts oddly.
--
-- So existing rows get their best available answer from `step`, and correct themselves to the real
-- value the first time each claim is saved. Claims saved before this migration are few and recent.
-- ---------------------------------------------------------------------------------------------

update public.claims
set
  address = coalesce(payload -> 'claim' ->> 'address', ''),
  insurer = coalesce(payload -> 'claim' ->> 'insurer', ''),
  status = case
    when payload -> 'workOrders' is not null and jsonb_array_length(coalesce(payload -> 'workOrders', '[]'::jsonb)) > 0 then 'work_orders'
    when payload -> 'documents' is not null and payload -> 'documents' <> 'null'::jsonb then 'documents'
    when payload -> 'extraction' is not null and payload -> 'extraction' <> 'null'::jsonb then 'gap_check'
    when coalesce(payload ->> 'transcript', '') <> '' then 'transcript'
    else 'intake'
  end
where address = '' and insurer = '' and status = 'intake';

-- ---------------------------------------------------------------------------------------------
-- Roles.
--
-- 0004 created `role` with 'owner' | 'member' and nothing reading it. The claims list is the first
-- feature that does: an owner may switch the list to everyone's claims in their organization, a
-- member sees only their own.
--
-- This is a VIEW filter, not a security boundary, and the distinction matters. The RLS policies in
-- 0004 already permit any member to read any claim in their own organization, which is correct —
-- teammates covering for each other is the point of an organization. What this changes is the
-- default and what the UI offers, so nobody is handed the whole company's claims by accident. The
-- boundary that actually protects anything is still the organization, and it is unchanged.
-- ---------------------------------------------------------------------------------------------

comment on column public.organization_members.role is
  'owner may view every claim in the organization; member sees their own by default. A view filter enforced in lib/claimsRepo.ts — NOT a security boundary. The boundary is the organization, in 0004''s policies.';
