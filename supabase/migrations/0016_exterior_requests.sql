-- 0016 — Send to Scrivn team: a house measured for a tester from their own photos (2026-10-17).
--
-- During the beta a tester can send a house (or another building on the claim) to us instead of
-- measuring it themselves: on the photo route, "Send to Scrivn team to measure". The photos are
-- already the claim's own site photos (0015); what is sent is which of them, the route's inputs as
-- the route stores them (the shape drawn, the corners tapped, the tapes) and a note. We measure it on
-- our own machine (scripts/pull-exterior-request.mjs, scripts/return-exterior-request.mjs) and the
-- measured exterior comes back here as `result`. The tester's own browser puts it into the claim when
-- they tap "Use it", through the claim's ordinary save: nothing here, and nothing on the server, ever
-- writes a claim's payload.
--
-- Who may do what:
--   * a member of the claim's organization creates a request for that claim, as themselves, and reads
--     their organization's requests. Nothing crosses organizations: every policy and function below
--     goes through is_org_member (0004), and a request must name a claim of the organization it is
--     filed under.
--   * the member's own two moves are functions, not an update policy: withdrawing a request
--     (exterior_request_withdraw) and marking a ready one used (exterior_request_applied). Neither can
--     touch the result, the route or anything else.
--   * everything else — measuring, ready, the result — is written by the service role only, i.e. by
--     the scripts we run. There is no update or delete policy, and no column but the inputs is granted
--     to the browser roles for insert, so the anon key in every page cannot set a status or plant a
--     result.
--
-- A claim deleted takes its requests with it (on delete cascade), result and all.
--
-- Depends only on 0004 (claims, organizations, is_org_member). Safe to run more than once.

create table if not exists public.exterior_requests (
  -- Chosen on the device when the tester taps Send, so a send repeated after a lost answer is the same request.
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Who sent it. Their session's own id, by default; the browser roles cannot name anyone else.
  user_id uuid references auth.users (id) on delete set null default auth.uid(),
  -- 'house' for the claim's house (Sketch.exterior), else the id of one of its other buildings (Sketch.buildings).
  building text not null default 'house',
  -- What the tester calls it ("Shed"), for our list; empty for the house.
  building_name text not null default '',
  -- The claim photos sent (lib/photos.ts ids), in the order the route keeps them.
  photo_ids text[] not null default '{}',
  -- The photo route's inputs as the route stores them (lib/photoRoute.ts PhotoRouteState): the photos,
  -- the shape drawn, the corners tapped on each photo, the tapes, and the tester's own measure if any.
  route jsonb,
  note text not null default '',
  status text not null default 'sent',
  -- The measured Exterior (lib/exterior.ts), written by the return script. Null until then.
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  measuring_at timestamptz,
  ready_at timestamptz,
  applied_at timestamptz,
  withdrawn_at timestamptz,
  constraint exterior_requests_status check (status in ('sent', 'measuring', 'ready', 'applied', 'withdrawn')),
  constraint exterior_requests_building check (building ~ '^[A-Za-z0-9:_.-]{1,80}$'),
  constraint exterior_requests_building_name check (char_length(building_name) <= 80),
  constraint exterior_requests_note check (char_length(note) <= 2000),
  constraint exterior_requests_photos check (cardinality(photo_ids) between 1 and 300),
  constraint exterior_requests_route check (route is null or octet_length(route::text) <= 524288)
);

comment on table public.exterior_requests is
  'Send to Scrivn team (0016): a claim''s exterior photos and tapes sent for us to measure, and the measured Exterior returned. Members of the claim''s organization create and read them; only the service role writes status and result, but for the member''s own withdraw and applied (definer functions).';

create index if not exists exterior_requests_claim on public.exterior_requests (claim_id, created_at desc);
create index if not exists exterior_requests_status on public.exterior_requests (status, created_at desc);

-- updated_at follows every change, whoever makes it.
create or replace function public.exterior_requests_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.exterior_requests_touch() from public, anon, authenticated;

drop trigger if exists exterior_requests_touch on public.exterior_requests;
create trigger exterior_requests_touch
  before update on public.exterior_requests
  for each row execute function public.exterior_requests_touch();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

alter table public.exterior_requests enable row level security;

-- Supabase grants every new table to the browser roles; take it all back and give only what is meant.
revoke all on public.exterior_requests from anon, authenticated;
grant select on public.exterior_requests to authenticated;
-- The inputs, and nothing else: user_id, status, result and the times take their defaults.
grant insert (id, claim_id, organization_id, building, building_name, photo_ids, route, note) on public.exterior_requests to authenticated;

drop policy if exists "Exterior requests are viewable within the organization" on public.exterior_requests;
create policy "Exterior requests are viewable within the organization"
  on public.exterior_requests for select
  to authenticated
  using (public.is_org_member(organization_id));

-- A member files one for a claim of their own organization, as themselves, as just sent. The claim is
-- looked for under the member's own policies (0004), so a claim of another organization is not there.
drop policy if exists "Exterior requests are insertable within the organization" on public.exterior_requests;
create policy "Exterior requests are insertable within the organization"
  on public.exterior_requests for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and user_id = (select auth.uid())
    and status = 'sent'
    and result is null
    and exists (
      select 1 from public.claims c
      where c.id = exterior_requests.claim_id
        and c.organization_id = exterior_requests.organization_id
    )
  );

-- No update or delete policy: see the file's note.

-- ---------------------------------------------------------------------------------------------
-- exterior_request_withdraw — the tester takes it back: while it is being sent, measured or waiting
-- to be used. True when it was withdrawn; false when it is not theirs to withdraw or is past that
-- (used already, or withdrawn).
-- ---------------------------------------------------------------------------------------------

create or replace function public.exterior_request_withdraw(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.exterior_requests r
     set status = 'withdrawn', withdrawn_at = now()
   where r.id = exterior_request_withdraw.request_id
     and r.status in ('sent', 'measuring', 'ready')
     and public.is_org_member(r.organization_id);
  return found;
end;
$$;

revoke all on function public.exterior_request_withdraw(uuid) from public, anon;
grant execute on function public.exterior_request_withdraw(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- exterior_request_applied — the tester tapped "Use it": the measurement is in their claim now (their
-- own save put it there), so it is not offered again. Only from ready.
-- ---------------------------------------------------------------------------------------------

create or replace function public.exterior_request_applied(request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.exterior_requests r
     set status = 'applied', applied_at = now()
   where r.id = exterior_request_applied.request_id
     and r.status = 'ready'
     and public.is_org_member(r.organization_id);
  return found;
end;
$$;

revoke all on function public.exterior_request_applied(uuid) from public, anon;
grant execute on function public.exterior_request_applied(uuid) to authenticated, service_role;
