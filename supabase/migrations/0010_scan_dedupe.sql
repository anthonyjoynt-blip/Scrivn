-- A scan sent twice is filed once (2026-10-10).
--
-- The phone sends every scan with its capture id (a new one at each Start, kept through every send of
-- that capture). Until now nothing read it: a Send whose answer was lost on a bad connection, tried
-- again, made a SECOND claim when New claim had been chosen, and a second pending copy in a claim
-- that had been chosen. The phone's failure dialog had to warn about it. Now, within the token's
-- organization:
--
--   * The same capture, storey and body, already in the claim (pending or adopted, not discarded):
--     that row is the answer. Nothing is inserted; `duplicate` is true.
--   * New claim chosen, and this capture already MADE a claim that still exists: no second claim.
--     The same body is the row that made it (`created` true, as the first answer said); a changed
--     capture (rooms added since) goes into that claim as a pending scan, for its page to adopt.
--   * A capture sent with no id is never matched, and a discarded scan never stands in for one sent
--     again - sending it again is asking for it back.
--
-- `claim_scans.created_claim` marks the row that made its claim; rows from before this migration are
-- marked where `device_receive_scan` made them (adopted at the instant received - the browser's
-- adoption is always later). Two sends of one capture in flight at once are serialised on a
-- transaction lock of (organization, capture id), so both cannot miss each other.
--
-- The function's result gains a column, so it is dropped and made again with its grants.
-- Run in the Supabase SQL editor. Safe to run twice.

alter table public.claim_scans add column if not exists created_claim boolean not null default false;

comment on column public.claim_scans.created_claim is
  'True on the scan that made its claim (a New claim send). device_receive_scan reads it so the same capture sent again never makes a second claim.';

update public.claim_scans
set created_claim = true
where not created_claim
  and status = 'adopted'
  and resolved_at = received_at;

-- The look-up a send now makes: this organization's scans of one capture.
create index if not exists claim_scans_org_capture_idx
  on public.claim_scans (organization_id, capture_id)
  where capture_id is not null;

drop function if exists public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb);
create function public.device_receive_scan(
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
returns table (claim_id uuid, scan_id uuid, created boolean, duplicate boolean)
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
  use_level integer := coalesce(scan_level, 0);
  found_claim uuid;
  made_claim uuid;
  same_scan uuid;
  same_made boolean;
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

  -- One send of a capture at a time, so a retry racing the send it repeats still finds it.
  if device_receive_scan.capture_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(tok_org::text || ':' || device_receive_scan.capture_id, 0));
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

    -- Sent before, as it is now: that row is the answer.
    if device_receive_scan.capture_id is not null then
      select s.id into same_scan
      from public.claim_scans s
      where s.claim_id = found_claim
        and s.capture_id = device_receive_scan.capture_id
        and s.level = use_level
        and s.status <> 'discarded'
        and s.body = device_receive_scan.body
      order by s.received_at desc
      limit 1;

      if same_scan is not null then
        claim_id := found_claim;
        scan_id := same_scan;
        created := false;
        duplicate := true;
        return next;
        return;
      end if;
    end if;

    insert into public.claim_scans
      (id, claim_id, organization_id, device_token_id, capture_id, captured_at, level, received_at, body, status)
    values
      (use_scan_id, found_claim, tok_org, tok_id,
       device_receive_scan.capture_id, device_receive_scan.captured_at, use_level,
       use_received_at, device_receive_scan.body, 'pending');

    claim_id := found_claim;
    scan_id := use_scan_id;
    created := false;
    duplicate := false;
    return next;
    return;
  end if;

  -- New claim chosen: the claim this capture already made, if it made one and it is still there.
  if device_receive_scan.capture_id is not null then
    select s.claim_id into made_claim
    from public.claim_scans s
    where s.organization_id = tok_org
      and s.capture_id = device_receive_scan.capture_id
      and s.created_claim
    order by s.received_at desc
    limit 1;

    if made_claim is not null then
      select s.id, s.created_claim into same_scan, same_made
      from public.claim_scans s
      where s.claim_id = made_claim
        and s.capture_id = device_receive_scan.capture_id
        and s.level = use_level
        and s.status <> 'discarded'
        and s.body = device_receive_scan.body
      order by s.received_at desc
      limit 1;

      if same_scan is not null then
        claim_id := made_claim;
        scan_id := same_scan;
        created := coalesce(same_made, false);
        duplicate := true;
        return next;
        return;
      end if;

      -- Changed since (rooms added, a tape typed): into the claim it made, for its page to adopt.
      insert into public.claim_scans
        (id, claim_id, organization_id, device_token_id, capture_id, captured_at, level, received_at, body, status)
      values
        (use_scan_id, made_claim, tok_org, tok_id,
         device_receive_scan.capture_id, device_receive_scan.captured_at, use_level,
         use_received_at, device_receive_scan.body, 'pending');

      claim_id := made_claim;
      scan_id := use_scan_id;
      created := false;
      duplicate := false;
      return next;
      return;
    end if;
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
    (id, claim_id, organization_id, device_token_id, capture_id, captured_at, level, received_at, body, status, resolved_at, created_claim)
  values
    (use_scan_id, found_claim, tok_org, tok_id,
     device_receive_scan.capture_id, device_receive_scan.captured_at, use_level,
     use_received_at, device_receive_scan.body, 'adopted', use_received_at, true);

  claim_id := found_claim;
  scan_id := use_scan_id;
  created := true;
  duplicate := false;
  return next;
  return;
end;
$$;

revoke all on function public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb) from public;
grant execute on function public.device_receive_scan(text, uuid, uuid, timestamptz, jsonb, text, timestamptz, integer, jsonb) to anon, authenticated, service_role;
