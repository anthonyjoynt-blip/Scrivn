-- 0008 — Scan reports: a tester sends us a scan that went wrong (2026-10-07).
--
-- Scrivn Scan's "Send to Scrivn team" posts the capture (the taps file, its walk included), the
-- app's own log for the walk (gzipped, base64) and what the tester wrote to /api/device/reports.
-- It works without pairing: Scan is tested as a product of its own, and a tester with no Scrivn
-- account must be able to tell us what went wrong. A paired phone's token, when it sends one, only
-- says whose report it is.
--
-- Nobody in any organization reads these: the table has row level security on and NO policies, and
-- nothing is granted to the browser roles. Only the service role (the pull script, run by us) reads
-- it. The phone writes through `file_scan_report`, a definer function granted to anon, which also
-- holds the line on how many a phone or an address may send in an hour.
--
-- Safe to run more than once.

create table if not exists public.scan_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- A random id the app makes on first run and keeps: one phone's reports, with nothing about the person.
  install_id text not null,
  -- SHA-256 of the sender's address, salted, for the hourly limit only. Never the address itself.
  ip_hash text not null default '',
  app_version text not null default '',
  device text not null default '',
  android text not null default '',
  -- What the tester wrote, and how to reach them if they gave it (name, email or phone - their choice).
  note text not null default '',
  contact text not null default '',
  -- The capture as the phone would send it to a claim (taps JSON, the walk inside it).
  capture jsonb,
  capture_id text,
  captured_at timestamptz,
  -- The app's log for the walk, gzipped and base64'd as the phone sent it. The pull script unpacks it.
  log_gz text,
  -- Whose phone, when a paired phone sent its token. Null for a phone that is not paired.
  token_id uuid references public.device_tokens (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  -- Ours: 'new' until we have looked at it.
  status text not null default 'new'
);

comment on table public.scan_reports is
  'Scans testers sent us from Scrivn Scan with a note, for diagnosis. No policies: readable only by the service role. Written only by file_scan_report.';

create index if not exists scan_reports_created_at on public.scan_reports (created_at desc);
create index if not exists scan_reports_install on public.scan_reports (install_id, created_at desc);
create index if not exists scan_reports_ip on public.scan_reports (ip_hash, created_at desc);

alter table public.scan_reports enable row level security;
revoke all on public.scan_reports from anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- file_scan_report — the phone files a report.
--
-- `token_hash` is null for a phone that is not paired. One that is sent and does not resolve (a
-- revoked token, a phone unpaired since) files the report anyway, without an owner: what went wrong
-- matters more than whose phone it was.
--
-- The limits: 12 an hour from one install, 40 an hour from one address. A tester reporting one walk
-- after another is nowhere near either; a loop or a stranger hammering the endpoint is stopped at
-- the table, whatever the route in front of it does. Raised as P0429, which the route turns into 429.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.file_scan_report(text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text);
create or replace function public.file_scan_report(
  token_hash text,
  install_id text,
  ip_hash text,
  app_version text,
  device text,
  android text,
  note text,
  contact text,
  capture jsonb,
  capture_id text,
  captured_at timestamptz,
  log_gz text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok_id uuid;
  org_id uuid;
  usr_id uuid;
  new_id uuid;
begin
  if coalesce(length(file_scan_report.install_id), 0) < 8 or length(file_scan_report.install_id) > 64 then
    raise exception 'Send the install id.' using errcode = '22023';
  end if;
  if coalesce(octet_length(file_scan_report.log_gz), 0) > 4194304 then
    raise exception 'That log is over 4 MB.' using errcode = '22023';
  end if;

  if (select count(*) from public.scan_reports r
      where r.install_id = file_scan_report.install_id and r.created_at > now() - interval '1 hour') >= 12 then
    raise exception 'Too many reports from this phone in the last hour.' using errcode = 'P0429';
  end if;
  if coalesce(file_scan_report.ip_hash, '') <> '' and (select count(*) from public.scan_reports r
      where r.ip_hash = file_scan_report.ip_hash and r.created_at > now() - interval '1 hour') >= 40 then
    raise exception 'Too many reports from this address in the last hour.' using errcode = 'P0429';
  end if;

  if file_scan_report.token_hash is not null then
    select t.id, t.organization_id, t.user_id
      into tok_id, org_id, usr_id
    from public.device_tokens t
    join public.organization_members m
      on m.organization_id = t.organization_id and m.user_id = t.user_id
    where t.token_hash = public.device_secret_hash(file_scan_report.token_hash)
      and t.revoked_at is null;
  end if;

  insert into public.scan_reports (
    install_id, ip_hash, app_version, device, android, note, contact,
    capture, capture_id, captured_at, log_gz, token_id, organization_id, user_id
  ) values (
    file_scan_report.install_id, coalesce(file_scan_report.ip_hash, ''),
    left(coalesce(file_scan_report.app_version, ''), 40), left(coalesce(file_scan_report.device, ''), 120),
    left(coalesce(file_scan_report.android, ''), 40), left(coalesce(file_scan_report.note, ''), 4000),
    left(coalesce(file_scan_report.contact, ''), 200),
    file_scan_report.capture, left(file_scan_report.capture_id, 100), file_scan_report.captured_at,
    file_scan_report.log_gz, tok_id, org_id, usr_id
  )
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.file_scan_report(text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text) from public;
grant execute on function public.file_scan_report(text, text, text, text, text, text, text, text, jsonb, text, timestamptz, text) to anon, authenticated, service_role;
