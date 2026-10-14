-- Team accounts: roles, invites, and the rules for moving between organizations (2026-10-13).
--
-- Run in the Supabase SQL Editor after 0011_org_billing.sql. Safe to run twice.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- DORMANT
--
-- The owner, 2026-10-13: "team accounts we should at least have an infrastructure to employ later
-- for when it becomes necessary." This is that infrastructure. Every function below is called only
-- by the /api/team routes, which answer 404 while TEAMS_ENABLED is off (lib/teamsGate.ts), and the
-- Team section of the Account page is not rendered. For an organization of one — every organization
-- today — the two policy changes here (who may delete a claim, who sees every claim on the phone)
-- give the same answers they gave before, because the one member is the owner.
--
-- See TEAMS.md for the rules in plain words and what turning teams on involves.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- THE ROLES
--
--   owner   exactly one per organization. Everything an admin can do, plus: the plan and billing,
--           the letterhead (0005), promoting and demoting admins, removing admins, handing the
--           organization to someone else. Cannot leave — hand it over first.
--   admin   invites members, removes members, withdraws invites, sees every claim by default.
--   member  sees and edits every claim in the organization (0004 — teammates cover for each other),
--           deletes the claims they started, sees their own claims by default.
--
-- "Admins manage members; only the owner manages admins and billing."
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- ONE ORGANIZATION AT A TIME — the rule for someone who already has their own
--
-- Every signup gets an organization of their own (0004). A person belongs to exactly ONE
-- organization at a time; a unique index below holds the line, and everything that resolves "the
-- caller's organization" (lib/claimsRepo.ts, device_pairing_begin in 0006) has always assumed it.
--
-- Accepting an invite while alone in your own organization SETS IT ASIDE: you leave it, and it
-- keeps everything — claims, letterhead, trial, Stripe history — with nobody in it, untouched and
-- out of everyone's sight. Your claims do NOT come into the team. Leaving the team later (or being
-- removed) puts you back in it, as its owner, exactly as you left it. `organizations.personal_for`
-- is how it is found again.
--
-- Accepting is refused, with a reason the page can say, when you are not simply alone in your own
-- organization:
--   * you are on another team                        → leave it first                  (P0410)
--   * you own an organization with other people in it → hand it to one of them first  (P0411)
--   * your own organization has a live plan           → cancel it first; the team's
--                                                       plan covers you                (P0412)
--   * you would leave behind an organization that is not your own and has nobody else
--     (you were handed a team and everyone left)       → same as owning a team          (P0411)
--
-- And if your own organization is not there to go back to — you founded it, it grew into a team,
-- and you handed it over before leaving — leaving gives you a new organization of your own. Its
-- trial window is counted from when your account was made, not from today, so walking out of a team
-- you founded is not a way to a second trial.
--
-- Why not several organizations per person, with a switcher: every query that finds "the caller's
-- organization" would have to learn which one is selected, the claims list (which leans on RLS
-- rather than filtering by organization) would show several companies' claims at once, and a
-- phone's token would need to say which company it scans for. A restoration PM works for one company
-- at a time; the rule costs them nothing and keeps every existing query right.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- INVITES
--
-- By email, with a token. The app makes 256 random bits, emails them in a link, and hands this file
-- only their SHA-256; what is stored is a second SHA-256 of that (`device_secret_hash`, 0006), so a
-- read of the table opens no door — the same arrangement as paired phones. Seven days to answer.
-- Accepting needs the token AND a session whose confirmed email is the address invited: the token
-- proves the email arrived, the session proves who is accepting it. A forwarded invite is no use to
-- anyone signed in as somebody else.
--
-- At most 20 invites per organization per day, because each one sends an email from scrivn.ca to an
-- address the inviter typed — a free trial must not be a way to mail strangers from our domain.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- HOW SQL TALKS BACK
--
-- As in 0006, every function raises with a fixed SQLSTATE and the app reads the code, never the
-- message (lib/teams.ts maps them to sentences):
--   28000 not signed in              42501 your role does not allow it
--   P0002 no such invite or member   22023 malformed argument
--   23505 already a member           P0402 no free seat (seat_limit)
--   P0429 too many invites today     P0410 on another team — leave it first
--   P0411 hand your organization over first (also: an owner cannot leave)
--   P0412 your own organization has a live plan
--   P0414 this invite was sent to another address
--
-- Every function is SECURITY DEFINER with an empty search_path, reads the caller from auth.uid()
-- itself and never takes a user or organization id to act AS, alias-qualifies every column, and has
-- its grants revoked from public, anon and authenticated before being handed out — Supabase grants
-- new functions in `public` to `anon` explicitly, so revoking from `public` alone would leave every
-- one of these callable with the public key.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'seat_limit'
  ) then
    raise exception '0012_teams.sql needs 0011_org_billing.sql applied first.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Roles: owner | admin | member. 0004 made the column with owner | member and an inline check,
-- which Postgres named organization_members_role_check.
-- ---------------------------------------------------------------------------------------------

alter table public.organization_members drop constraint if exists organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'member'));

comment on column public.organization_members.role is
  'owner (exactly one) | admin | member. Owner and admin see every claim in the claims list and on the phone; a member sees their own by default — a view rule (lib/claimsRepo.ts, device_claims). Who may manage whom is enforced by the org_* functions in 0012.';

-- ---------------------------------------------------------------------------------------------
-- 2. One organization per person; one owner per organization.
--
-- Both hold for every row today (0004's trigger made one membership per signup, as owner), and both
-- are checked first so a hand-made exception fails with a sentence instead of an index error.
-- ---------------------------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.organization_members m group by m.user_id having count(*) > 1) then
    raise exception 'Someone belongs to more than one organization. Find them with: select user_id from public.organization_members group by user_id having count(*) > 1;';
  end if;
  if exists (select 1 from public.organization_members m where m.role = 'owner' group by m.organization_id having count(*) > 1) then
    raise exception 'An organization has more than one owner. Find it with: select organization_id from public.organization_members where role = ''owner'' group by organization_id having count(*) > 1;';
  end if;
end;
$$;

create unique index if not exists organization_members_one_per_person
  on public.organization_members (user_id);
-- The plain index 0004 made on user_id is now redundant with the unique one.
drop index if exists public.organization_members_user_id_idx;

create unique index if not exists organization_members_one_owner
  on public.organization_members (organization_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------------------------
-- 3. Whose own organization this is.
--
-- Set at signup and backfilled here for every organization that is someone's alone. Cleared when the
-- person it was made for leaves it as a team (see org_return_home). Not writable from the browser:
-- 0011 limited `authenticated` to the letterhead columns.
-- ---------------------------------------------------------------------------------------------

alter table public.organizations
  add column if not exists personal_for uuid references auth.users (id) on delete set null;

create unique index if not exists organizations_personal_for_key
  on public.organizations (personal_for)
  where personal_for is not null;

comment on column public.organizations.personal_for is
  'The person this organization was made for at signup. While they are on someone else''s team it has no members and waits for them; leaving the team puts them back in it.';

update public.organizations o
set personal_for = m.user_id
from public.organization_members m
where m.organization_id = o.id
  and m.role = 'owner'
  and o.personal_for is null
  and (select count(*) from public.organization_members x where x.organization_id = o.id) = 1
  and not exists (select 1 from public.organizations o2 where o2.personal_for = m.user_id);

-- The signup trigger from 0004, unchanged but for stamping the new organization as the person's own.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_org_id uuid;
  company text;
begin
  company := nullif(new.raw_user_meta_data ->> 'company_name', '');

  insert into public.profiles (id, full_name, company_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    company
  )
  on conflict (id) do nothing;

  -- Only for a genuinely new user: re-running signup for an existing id must not mint a second
  -- organization and quietly strand the claims saved in the first.
  if not exists (select 1 from public.organization_members m where m.user_id = new.id) then
    insert into public.organizations (name, personal_for)
    values (coalesce(company, nullif(new.raw_user_meta_data ->> 'full_name', ''), 'My organization'), new.id)
    returning id into new_org_id;

    insert into public.organization_members (organization_id, user_id, role)
    values (new_org_id, new.id, 'owner');
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. The admin test, beside is_org_member (0004) and is_org_owner (0005), hardened the same way.
-- ---------------------------------------------------------------------------------------------

create or replace function public.is_org_admin(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_org_admin(uuid) from public, anon;
grant execute on function public.is_org_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 5. Claims: everyone in the organization still reads and edits every claim (0004). Deleting one —
-- permanently, payload and all — is for whoever started it, or an owner or admin. Alone in an
-- organization you are its owner, so you may delete everything, as before.
-- ---------------------------------------------------------------------------------------------

drop policy if exists "Claims are deletable within the organization" on public.claims;
drop policy if exists "Claims are deletable by their creator or an admin" on public.claims;
create policy "Claims are deletable by their creator or an admin"
  on public.claims for delete
  to authenticated
  using (
    public.is_org_member(organization_id)
    and (created_by = (select auth.uid()) or public.is_org_admin(organization_id))
  );

-- ---------------------------------------------------------------------------------------------
-- 6. Invites.
--
-- Readable by the organization's owner and admins (the Team section lists pending ones) — every
-- column but the hash, the same column-by-column grant 0006 gave device_tokens. Written only by the
-- functions below.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Lower-cased and trimmed by org_invite_create; compared with the accepting account's email.
  email text not null check (email = lower(btrim(email)) and email like '_%@_%'),
  -- Never 'owner': ownership is handed over (org_transfer_ownership), not invited into.
  role text not null check (role in ('admin', 'member')),
  -- SHA-256 hex of the SHA-256 the app sends of the emailed token. See the header.
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- At most one of these three is ever set; an invite with none, before expires_at, is open.
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  declined_at timestamptz,
  revoked_at timestamptz,
  constraint organization_invites_one_outcome check (num_nonnulls(accepted_at, declined_at, revoked_at) <= 1)
);

comment on table public.organization_invites is
  'Invitations to join an organization, by email. The token is emailed and stored only as a double SHA-256. Readable by the organization''s owner and admins without the hash; written only by the org_invite_* functions.';

-- One open invite per address per organization: inviting again withdraws the old one first.
create unique index if not exists organization_invites_one_open
  on public.organization_invites (organization_id, email)
  where accepted_at is null and declined_at is null and revoked_at is null;

-- The daily limit's count.
create index if not exists organization_invites_org_created_idx
  on public.organization_invites (organization_id, created_at desc);

alter table public.organization_invites enable row level security;

revoke all on public.organization_invites from anon, authenticated;
grant select (id, organization_id, email, role, invited_by, created_at, expires_at, accepted_at, accepted_by, declined_at, revoked_at)
  on public.organization_invites to authenticated;

drop policy if exists "Invites are viewable by the organization's owner and admins" on public.organization_invites;
create policy "Invites are viewable by the organization's owner and admins"
  on public.organization_invites for select
  to authenticated
  using (public.is_org_admin(organization_id));

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- 7. THE FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------------------------
-- Internal: take a person out of an organization.
--
-- Their membership goes, their paired phones stop speaking for it (a phone's token resolves only
-- through a membership already, so this is tidiness: a token that would come back to life if they
-- were ever invited again is revoked instead), and unexchanged pairing codes go. If that leaves the
-- organization empty — their own, set aside — its open invites are withdrawn: nobody is there to
-- welcome whoever accepts.
--
-- Granted to nobody; called only from the functions below, which run as its owner.
-- ---------------------------------------------------------------------------------------------

create or replace function public.org_depart(person uuid, org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.organization_members m
  where m.organization_id = org_depart.org
    and m.user_id = org_depart.person;

  update public.device_tokens t
  set revoked_at = now()
  where t.organization_id = org_depart.org
    and t.user_id = org_depart.person
    and t.revoked_at is null;

  delete from public.device_pairings p
  where p.organization_id = org_depart.org
    and p.user_id = org_depart.person
    and p.claimed_at is null;

  if not exists (select 1 from public.organization_members m where m.organization_id = org_depart.org) then
    update public.organization_invites i
    set revoked_at = now()
    where i.organization_id = org_depart.org
      and i.accepted_at is null and i.declined_at is null and i.revoked_at is null;
  end if;
end;
$$;

revoke all on function public.org_depart(uuid, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- Internal: put a person back in their own organization, or make them a new one.
--
-- Their own is the one `personal_for` names, if it is empty — set aside when they joined a team.
-- If it is not empty they founded it, it became a team, and they handed it over: it is the team's
-- now, so it stops being "theirs" and they get a fresh organization, named as signup would name it,
-- with the trial window counted from when the account was made.
-- ---------------------------------------------------------------------------------------------

create or replace function public.org_return_home(person uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  home uuid;
  p_name text;
  p_company text;
  p_created timestamptz;
begin
  select o.id into home
  from public.organizations o
  where o.personal_for = org_return_home.person
    and not exists (select 1 from public.organization_members m where m.organization_id = o.id)
  for update;

  if home is null then
    update public.organizations o
    set personal_for = null
    where o.personal_for = org_return_home.person;

    select p.full_name, p.company_name, p.created_at into p_name, p_company, p_created
    from public.profiles p
    where p.id = org_return_home.person;

    insert into public.organizations (name, personal_for, trial_started_at)
    values (coalesce(nullif(p_company, ''), nullif(p_name, ''), 'My organization'), org_return_home.person, coalesce(p_created, now()))
    returning id into home;
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (home, org_return_home.person, 'owner');

  return home;
end;
$$;

revoke all on function public.org_return_home(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- org_members — who is in the caller's organization. Any member may ask: a team knows its own
-- people. Names come from profiles and addresses from auth.users, neither of which the browser can
-- read for anyone but itself, which is why this is a function and not a select.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_members();
create function public.org_members()
returns table (user_id uuid, full_name text, email text, role text, joined_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.organization_id into my_org
  from public.organization_members m
  where m.user_id = caller;

  return query
    select m.user_id, coalesce(p.full_name, ''), coalesce(u.email, '')::text, m.role, m.created_at
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
    where m.organization_id = my_org
    order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
             lower(coalesce(nullif(p.full_name, ''), u.email));
end;
$$;

revoke all on function public.org_members() from public, anon, authenticated;
grant execute on function public.org_members() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_invite_create — an owner or admin invites an address.
--
-- An admin may invite members; only the owner may invite an admin. The organization row is locked
-- first so two invites at once cannot both take the last seat or both slip under the daily limit.
-- Inviting an address that already has an open invite withdraws the old one (its link stops
-- working) and sends a new one. The 7 days are INVITE_TTL_DAYS in lib/teams.ts.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_invite_create(text, text, text);
create function public.org_invite_create(invite_email text, invite_role text, token_hash text)
returns table (invite_id uuid, organization_id uuid, organization_name text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
  my_role text;
  addr text := lower(btrim(coalesce(invite_email, '')));
  seats integer;
  taken integer;
  org_name text;
  new_id uuid;
  until timestamptz := now() + interval '7 days';
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = caller;

  if my_org is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;
  if my_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can invite' using errcode = '42501';
  end if;
  if invite_role is null or invite_role not in ('admin', 'member') then
    raise exception 'role must be admin or member' using errcode = '22023';
  end if;
  if invite_role = 'admin' and my_role <> 'owner' then
    raise exception 'only the owner can invite an admin' using errcode = '42501';
  end if;
  if length(addr) > 254 or addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not an email address' using errcode = '22023';
  end if;
  if org_invite_create.token_hash is null or org_invite_create.token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'bad token hash' using errcode = '22023';
  end if;

  select o.seat_limit, o.name into seats, org_name
  from public.organizations o
  where o.id = my_org
  for update;

  if exists (
    select 1
    from public.organization_members m
    join auth.users u on u.id = m.user_id
    where m.organization_id = my_org
      and lower(u.email) = addr
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  if (select count(*) from public.organization_invites i
      where i.organization_id = my_org and i.created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many invites today' using errcode = 'P0429';
  end if;

  update public.organization_invites i
  set revoked_at = now()
  where i.organization_id = my_org
    and i.email = addr
    and i.accepted_at is null and i.declined_at is null and i.revoked_at is null;

  if seats is not null then
    select (select count(*) from public.organization_members m where m.organization_id = my_org)
         + (select count(*) from public.organization_invites i
            where i.organization_id = my_org
              and i.accepted_at is null and i.declined_at is null and i.revoked_at is null
              and i.expires_at > now())
      into taken;
    if taken >= seats then
      raise exception 'no free seat' using errcode = 'P0402';
    end if;
  end if;

  insert into public.organization_invites as i (organization_id, email, role, token_hash, invited_by, expires_at)
  values (my_org, addr, invite_role, public.device_secret_hash(org_invite_create.token_hash), caller, until)
  returning i.id into new_id;

  invite_id := new_id;
  organization_id := my_org;
  organization_name := org_name;
  expires_at := until;
  return next;
end;
$$;

revoke all on function public.org_invite_create(text, text, text) from public, anon, authenticated;
grant execute on function public.org_invite_create(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_invite_preview — what the invite page shows before anyone accepts.
--
-- Open to the bare anon key: the page is reached from an email, often signed out, and the token is
-- the capability — 256 random bits that only the email carried. An unknown token returns no row.
-- `status` is open | accepted | declined | revoked | expired; an invite into an organization nobody
-- is in any more (its owner set it aside) reads as revoked.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_invite_preview(text);
create function public.org_invite_preview(token_hash text)
returns table (organization_name text, email text, role text, invited_by_name text, expires_at timestamptz, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select
      o.name,
      i.email,
      i.role,
      coalesce(p.full_name, ''),
      i.expires_at,
      case
        when i.accepted_at is not null then 'accepted'
        when i.declined_at is not null then 'declined'
        when i.revoked_at is not null then 'revoked'
        when i.expires_at <= now() then 'expired'
        when not exists (select 1 from public.organization_members m where m.organization_id = i.organization_id) then 'revoked'
        else 'open'
      end
    from public.organization_invites i
    join public.organizations o on o.id = i.organization_id
    left join public.profiles p on p.id = i.invited_by
    where i.token_hash = public.device_secret_hash(org_invite_preview.token_hash);
end;
$$;

revoke all on function public.org_invite_preview(text) from public, anon, authenticated;
grant execute on function public.org_invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_invite_accept — the invited person says yes.
--
-- The rules in the header, in order: the invite is open; the session's confirmed email is the
-- address invited; the organization still has people in it and a free seat; and the caller is
-- either already in it (the invite is simply spent) or alone in their own organization with no live
-- plan, which is then set aside. Rows are locked invite → membership → organizations so a double
-- click, or two invites accepted at once, cannot both succeed.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_invite_accept(text);
create function public.org_invite_accept(token_hash text)
returns table (organization_id uuid, organization_name text, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  caller_confirmed timestamptz;
  inv_id uuid;
  inv_org uuid;
  inv_email text;
  inv_role text;
  cur_org uuid;
  cur_role text;
  cur_personal uuid;
  cur_tier text;
  cur_count integer;
  seats integer;
  members integer;
  org_name text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select i.id, i.organization_id, i.email, i.role into inv_id, inv_org, inv_email, inv_role
  from public.organization_invites i
  where i.token_hash = public.device_secret_hash(org_invite_accept.token_hash)
    and i.accepted_at is null and i.declined_at is null and i.revoked_at is null
    and i.expires_at > now()
  for update;

  if inv_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  select u.email, u.email_confirmed_at into caller_email, caller_confirmed
  from auth.users u
  where u.id = caller;

  if caller_confirmed is null or lower(btrim(coalesce(caller_email, ''))) <> inv_email then
    raise exception 'this invite was sent to another address' using errcode = 'P0414';
  end if;

  select m.organization_id, m.role into cur_org, cur_role
  from public.organization_members m
  where m.user_id = caller
  for update;

  if cur_org = inv_org then
    update public.organization_invites i
    set accepted_at = now(), accepted_by = caller
    where i.id = inv_id;

    select o.name into org_name from public.organizations o where o.id = cur_org;
    organization_id := cur_org;
    organization_name := org_name;
    role := cur_role;
    return next;
    return;
  end if;

  select o.seat_limit, o.name into seats, org_name
  from public.organizations o
  where o.id = inv_org
  for update;

  select count(*) into members from public.organization_members m where m.organization_id = inv_org;
  if members = 0 then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;
  if seats is not null and members >= seats then
    raise exception 'no free seat' using errcode = 'P0402';
  end if;

  if cur_org is not null then
    select o.personal_for, o.subscription_tier into cur_personal, cur_tier
    from public.organizations o
    where o.id = cur_org
    for update;

    select count(*) into cur_count from public.organization_members m where m.organization_id = cur_org;

    if cur_count > 1 then
      if cur_role = 'owner' then
        raise exception 'hand your organization to someone else first' using errcode = 'P0411';
      end if;
      raise exception 'leave your team first' using errcode = 'P0410';
    end if;
    if cur_personal is distinct from caller then
      raise exception 'you are the last person in an organization that is not your own' using errcode = 'P0411';
    end if;
    if cur_tier is not null then
      raise exception 'your own organization has a live plan' using errcode = 'P0412';
    end if;

    perform public.org_depart(caller, cur_org);
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (inv_org, caller, inv_role);

  update public.organization_invites i
  set accepted_at = now(), accepted_by = caller
  where i.id = inv_id;

  organization_id := inv_org;
  organization_name := org_name;
  role := inv_role;
  return next;
end;
$$;

revoke all on function public.org_invite_accept(text) from public, anon, authenticated;
grant execute on function public.org_invite_accept(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_invite_decline — the invited person says no. The token is the capability, as for the
-- preview; a signed-in session is required only so the page has someone to show the answer to.
-- Returns false for an invite that was not open.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_invite_decline(text);
create function public.org_invite_decline(token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  update public.organization_invites i
  set declined_at = now()
  where i.token_hash = public.device_secret_hash(org_invite_decline.token_hash)
    and i.accepted_at is null and i.declined_at is null and i.revoked_at is null
    and i.expires_at > now();

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.org_invite_decline(text) from public, anon, authenticated;
grant execute on function public.org_invite_decline(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_invite_revoke — an owner or admin withdraws an open invite. Its link stops working. False for
-- an invite that is not open, or not this organization's (the two look the same on purpose).
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_invite_revoke(uuid);
create function public.org_invite_revoke(invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  update public.organization_invites i
  set revoked_at = now()
  where i.id = org_invite_revoke.invite_id
    and i.accepted_at is null and i.declined_at is null and i.revoked_at is null
    and public.is_org_admin(i.organization_id);

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.org_invite_revoke(uuid) from public, anon, authenticated;
grant execute on function public.org_invite_revoke(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_member_set_role — the owner makes someone an admin, or a member again. Not themselves, and
-- never to owner: ownership changes hands through org_transfer_ownership. False when the person is
-- not in the caller's organization (or is its owner).
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_member_set_role(uuid, text);
create function public.org_member_set_role(member_id uuid, new_role text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
  my_role text;
  changed integer;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if new_role is null or new_role not in ('admin', 'member') then
    raise exception 'role must be admin or member' using errcode = '22023';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = caller;

  if my_role is distinct from 'owner' then
    raise exception 'only the owner can change roles' using errcode = '42501';
  end if;
  if member_id = caller then
    raise exception 'the owner hands the organization over rather than changing their own role' using errcode = '22023';
  end if;

  update public.organization_members m
  set role = new_role
  where m.organization_id = my_org
    and m.user_id = org_member_set_role.member_id
    and m.role <> 'owner';

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

revoke all on function public.org_member_set_role(uuid, text) from public, anon, authenticated;
grant execute on function public.org_member_set_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_member_remove — an owner or admin takes someone off the team.
--
-- An admin may remove members; only the owner may remove an admin; nobody removes the owner, and
-- nobody removes themselves (that is org_leave). The person removed goes back to their own
-- organization (org_return_home). The claims they started stay with the team — they were the
-- team's — and keep their name as creator. False when the person is not in the caller's
-- organization.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_member_remove(uuid);
create function public.org_member_remove(member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
  my_role text;
  their_role text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = caller;

  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can remove someone' using errcode = '42501';
  end if;
  if member_id = caller then
    raise exception 'leave rather than removing yourself' using errcode = '22023';
  end if;

  select m.role into their_role
  from public.organization_members m
  where m.organization_id = my_org
    and m.user_id = org_member_remove.member_id
  for update;

  if their_role is null then
    return false;
  end if;
  if their_role = 'owner' then
    raise exception 'nobody removes the owner' using errcode = '42501';
  end if;
  if their_role = 'admin' and my_role <> 'owner' then
    raise exception 'only the owner can remove an admin' using errcode = '42501';
  end if;

  perform public.org_depart(org_member_remove.member_id, my_org);
  perform public.org_return_home(org_member_remove.member_id);
  return true;
end;
$$;

revoke all on function public.org_member_remove(uuid) from public, anon, authenticated;
grant execute on function public.org_member_remove(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_leave — an admin or member leaves. They go back to their own organization; its id comes back.
-- The owner cannot leave (P0411): an organization is never left without one.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_leave();
create function public.org_leave()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
  my_role text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = caller
  for update;

  if my_org is null then
    raise exception 'no organization' using errcode = 'P0002';
  end if;
  if my_role = 'owner' then
    raise exception 'the owner hands the organization over before leaving' using errcode = 'P0411';
  end if;

  perform public.org_depart(caller, my_org);
  return public.org_return_home(caller);
end;
$$;

revoke all on function public.org_leave() from public, anon, authenticated;
grant execute on function public.org_leave() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- org_transfer_ownership — the owner hands the organization to someone already in it. They become
-- an admin. The plan, its billing and the letterhead go with the role (only the owner manages
-- them). Demote first, then promote, so the one-owner index holds at every statement. False when
-- the person is not in the caller's organization.
-- ---------------------------------------------------------------------------------------------

drop function if exists public.org_transfer_ownership(uuid);
create function public.org_transfer_ownership(new_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  my_org uuid;
  my_role text;
  their_role text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.organization_id, m.role into my_org, my_role
  from public.organization_members m
  where m.user_id = caller
  for update;

  if my_role is distinct from 'owner' then
    raise exception 'only the owner can hand the organization over' using errcode = '42501';
  end if;
  if new_owner = caller then
    raise exception 'already the owner' using errcode = '22023';
  end if;

  select m.role into their_role
  from public.organization_members m
  where m.organization_id = my_org
    and m.user_id = org_transfer_ownership.new_owner
  for update;

  if their_role is null then
    return false;
  end if;

  update public.organization_members m
  set role = 'admin'
  where m.organization_id = my_org and m.user_id = caller;

  update public.organization_members m
  set role = 'owner'
  where m.organization_id = my_org and m.user_id = org_transfer_ownership.new_owner;

  return true;
end;
$$;

revoke all on function public.org_transfer_ownership(uuid) from public, anon, authenticated;
grant execute on function public.org_transfer_ownership(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. The phone's claim list: an admin sees the whole organization, like the owner.
--
-- device_claims from 0006, unchanged but for `tok_role in ('owner', 'admin')` — the same view rule
-- lib/claimsRepo.ts now applies to the claims list. Same signature and result, so `create or
-- replace` keeps its grants.
-- ---------------------------------------------------------------------------------------------

create or replace function public.device_claims(token_hash text)
returns table (
  id uuid,
  customer_name text,
  job_number text,
  address text,
  insurer text,
  status text,
  updated_at timestamptz,
  mine boolean,
  room_names jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  tok_id uuid;
  tok_org uuid;
  tok_user uuid;
  tok_role text;
  tok_last_used timestamptz;
begin
  select t.id, t.organization_id, t.user_id, m.role, t.last_used_at
    into tok_id, tok_org, tok_user, tok_role, tok_last_used
  from public.device_tokens t
  join public.organization_members m
    on m.organization_id = t.organization_id and m.user_id = t.user_id
  where t.token_hash = public.device_secret_hash(device_claims.token_hash)
    and t.revoked_at is null;

  if tok_id is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  if tok_last_used is null or tok_last_used < now() - interval '1 minute' then
    update public.device_tokens t
    set last_used_at = now()
    where t.id = tok_id;
  end if;

  return query
    select
      c.id,
      c.customer_name,
      c.job_number,
      c.address,
      c.insurer,
      c.status,
      c.updated_at,
      coalesce(c.created_by = tok_user, false) as mine,
      coalesce(names.list, '[]'::jsonb) as room_names
    from public.claims c
    left join lateral (
      select jsonb_agg(distinct x.room_name order by x.room_name) as list
      from (
        select btrim(r.value ->> 'name') as room_name
        from jsonb_array_elements(
          case when jsonb_typeof(c.payload -> 'sketch' -> 'rooms') = 'array'
               then c.payload -> 'sketch' -> 'rooms'
               else '[]'::jsonb end
        ) as r(value)
        union all
        select btrim(e.value ->> 'roomName')
        from jsonb_array_elements(
          case when jsonb_typeof(c.payload -> 'extraction' -> 'rooms') = 'array'
               then c.payload -> 'extraction' -> 'rooms'
               else '[]'::jsonb end
        ) as e(value)
      ) x
      where x.room_name is not null
        and x.room_name <> ''
    ) names on true
    where c.organization_id = tok_org
      and (tok_role in ('owner', 'admin') or c.created_by = tok_user)
    order by c.updated_at desc
    limit 200;
end;
$$;

revoke all on function public.device_claims(text) from public;
grant execute on function public.device_claims(text) to anon, authenticated, service_role;
