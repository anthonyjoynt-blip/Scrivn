# Team accounts

**State: built, tested, switched off** (2026-10-13). The owner asked for "an infrastructure to
employ later for when it becomes necessary". Everything below exists in the code. While
`TEAMS_ENABLED` is off, nobody can reach any of it, and nothing a user sees has changed.

## What a team is

An **organization** is a company's account in Scrivn: its claims, its letterhead, its plan and its
claim allowance. Every signup has had one since migration 0004, as an organization of one.
A team is an organization with more than one person in it.

| Role | Can |
|---|---|
| **Owner** (exactly one) | Everything an admin can, plus the plan and billing, the letterhead, making and unmaking admins, removing admins, and handing the organization to someone else. Can't leave until they've handed it over. |
| **Admin** | Invite members, remove members, withdraw invitations, see every claim by default. |
| **Member** | See and edit every claim in the organization (teammates cover for each other), delete the claims they started, see their own claims by default. |

In short: admins manage members; only the owner manages admins and billing.

Nobody can change who started a claim, so "delete the claims they started" can't be worked around
by reassigning one.

Everyone on a team shares **one plan and one claim allowance**. A claim any of them generates comes
off the same counter. The usage emails (80%, cap reached, trial nearly over) go to the owner,
because the owner is the one who can upgrade.

## Joining a team when you already have your own account

**A person belongs to one organization at a time.** The database enforces it, and every part of the
app that finds "your organization" relies on it.

- **Accepting an invitation sets your own account aside.** Your own organization keeps everything:
  claims, letterhead, trial, Stripe history. Nobody is in it while you're on the team, and nobody
  sees it, you included. **Your claims do not come into the team.**
- **Leaving the team, or being removed, puts you back** in your own organization as its owner,
  exactly as you left it.
- Accepting is refused, with a sentence saying why, if:
  - you're on another team. Leave it first.
  - you own an organization with other people in it. Make one of them the owner first.
  - your own account has a live plan, Scan included. Cancel it first; the team's plan covers you.
- If you founded an organization, it grew into a team, and you handed it over and left, your own
  organization is now the team's. You get a new one of your own. Its trial window is counted from
  when your account was made, not from that day, so this is not a route to a second free trial.
- The claims someone started stay with the team when they leave or are removed, still showing who
  started them.

Why not several organizations per person with a switcher: every query that finds the caller's
organization would need to know which one is selected. The claims list would show several
companies' claims at once, and a paired phone would need to know which company it scans for. A
restoration PM works for one company at a time.

## Invitations

- An owner or admin invites by email. The email goes out through the app's own Resend sender
  (`no-reply@scrivn.ca`) with a link to `/team/invite?token=…`.
- The link works for **7 days**, and only for someone signed in with **that email address**,
  confirmed. A forwarded link is no use to anyone else.
- Inviting the same address again withdraws the earlier link.
- At most **20 invitations per organization per day**, because each one mails a stranger from our
  domain.
- The invited person needs a Scrivn account. While public sign-up is off (`SIGNUPS.md`), make one
  for them in Supabase first (Authentication → Users → Add user), then they open the link and sign
  in.
- If the email fails to send, the invitation still stands and the Team section shows the link to
  pass on another way.

## Seats

There's room for seat pricing, but no price yet for the Scrivn plans. `organizations.seat_limit`
holds how many people a plan covers. Null means no limit, which is every organization on a Scrivn
plan or the trial. Invitations past the limit are refused. `SEAT_PRICING` in `lib/plans.ts` can
become "N seats included per plan" or "a price per seat". See `STRIPE.md` §6, and the owner's
pricing doc ("Team accounts: what a seat costs"), which recommends unlimited.

**The Scan plan covers one person** (owner, 2026-10-14: "one person per scan plan"). It has no claim
allowance to grow with a team, so without a limit one C$19 plan would cover a whole crew's phones.
`seatLimitFor` stores `SCAN_SEATS` (1) for it whatever `SEAT_PRICING` says, and 0011's copy gives a
Scan plan bought earlier the same limit. So:

- the owner of a Scan-only organization can't invite anyone: the Team section says the plan covers
  one person and that a Scrivn plan covers the whole team, instead of offering the invite form;
- checkout refuses the Scan plan to an organization that already has more than one person in it;
- an invitation sent earlier (on the trial) can't be accepted once the Scan plan is bought.

## Turning teams on

1. **Apply the migrations** in the Supabase SQL Editor, in this order, if they aren't already:
   `0011_org_billing.sql`, then `0012_teams.sql`. Both are safe to run twice. Check them first with
   `npm run test:rls:local`, `npm run test:teams` and `npm run test:billing`. They need no
   Supabase, and every check should pass. After applying, run `npm run test:rls`: its teams section
   runs against the real project once the migrations are there.
2. **Decide seats and invoicing** (below), at least for the first teams.
3. **Update `PRIVACY.md` and paste it into TermsFeed.** Teams add two things: invitees' email
   addresses are stored (until the invitation is answered or lapses, and kept after as a record),
   and people on a team see each other's names, email addresses and claims.
4. **Restore the pricing copy** if wanted. Growth's "Multiple team members, one account" was taken
   off because it wasn't built (`lib/plans.ts`, `app/faq/page.tsx`), and so was the "Multiple
   offices?" panel's shared claims pool (`app/pricing/page.tsx`, 2026-10-14).
5. **Set `TEAMS_ENABLED=true`** in Vercel (Production) and redeploy.

What switching it on reveals: the **Team** card on the Account page, the `/api/team/*` routes, the
invitation page `/team/invite` (also reachable signed out), and invitation emails.

## What's where

| Piece | File |
|---|---|
| Plan, counter, trial on the organization; seat limit; column lockdown | `supabase/migrations/0011_org_billing.sql` |
| Roles, one organization per person, invitations, every team action | `supabase/migrations/0012_teams.sql` |
| The flag | `lib/teamsGate.ts` |
| Who may do what, the refusal sentences | `lib/teams.ts` |
| Calls to the database | `lib/teamRepo.ts` |
| Routes | `app/api/team/` (list, invite, withdraw, accept, decline, change role, remove, leave, hand over) |
| Team section | `components/TeamSection.tsx`, on `app/(app)/account/page.tsx` |
| Invitation page and email | `app/(app)/team/invite/page.tsx`, `components/TeamInviteAnswer.tsx`, `emails/TeamInvite.tsx` |
| Tests | `test/rls/local.mjs`, `test/teams/run.mjs`, `test/billing/db.mjs` (local Postgres, no Supabase needed), and `test/rls/run.mjs` (the real project) |

## Known gaps

- **Handing over doesn't change the Stripe customer's email.** Invoices keep going to the previous
  owner until the new owner changes it in the billing portal.
- **No way to bring your own claims into a team.** It would mean moving the claims, their scans, and
  the scan photos stored under the organization's id. Deliberately left out: claims hold homeowners'
  details, and sharing them with a company should be a decision, not a side effect.
- **No organization switcher.** One organization at a time, as above.
- **No invite list for the invitee.** Someone who loses the email asks for a new invitation.
- **Delete account (2026-10-14, SCAN_ACCOUNTS.md) refuses an owner with other people in the
  organization** until they hand it over; a member or admin who deletes their account leaves the team
  and the claims they started stay with it. Deleting by hand in Supabase has no such check:
- **Deleting the owner's account in Supabase leaves the team with no owner.** Nobody can manage
  billing or admins until an owner is set by hand in the SQL Editor
  (`update organization_members set role = 'owner' where …`). Hand the organization over before
  deleting an owner's account.
