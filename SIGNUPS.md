# Who can sign up, and who can pay

Scrivn is deployed and usable before it is a business. Three things are therefore held shut on
purpose, and this is the record of which switch does what.

All three flags **fail closed**: they open only on the exact string `true`. A missing, empty or misspelt
value leaves the door shut. That direction is deliberate — the cost of accidentally-closed is a
confused tester, and the cost of accidentally-open is somebody's money or somebody's API bill.

## Billing — `BILLING_ENABLED`

Off in production. While off:

- `POST /api/checkout` returns 503 before it does anything else, including the auth check.
- The pricing page renders every plan with a disabled **Coming soon** button.
- `/api/portal` is deliberately left OPEN, so anyone who somehow already has a subscription can
  still reach Stripe to cancel it. Closing it would trap them.

**Do not turn this on until both of these are true**, because each one silently takes money and
gives nothing back:

1. **`STRIPE_WEBHOOK_SECRET` is set in production.** Without it the webhook returns 503 and refuses
   to process events, so a completed checkout never reaches the app: the customer is charged and no
   tier is granted. Get the `whsec_…` from the Stripe Dashboard's endpoint for this deployment —
   NOT the one in `.env.local`, which belongs to a local `stripe listen` session.
2. **Stripe Tax is sorted.** Tax settings are `status: pending`, there are no registrations, and
   `automatic_tax` is not enabled in `/api/checkout`. Any one of those means $0 collected with no
   error, and under-collection cannot be corrected retroactively. See `STRIPE.md` → Known gaps.

Check which Stripe account production points at before flipping anything: `sk_test_…` charges
nobody, `sk_live_…` charges real cards.

## Sign-up — `NEXT_PUBLIC_SIGNUPS_OPEN`

Off in production. While off, `/signup` shows an invite-only panel instead of the form, and Scrivn
Scan's "Create an account" shows the same sentence.

**Since 2026-10-14 this is enforcement.** Both forms post to Scrivn's server (`/api/signup`,
`/api/device/signup`, one door: `lib/signup.ts`), which refuses while the flag is not `true`, applies
the guard below, and makes the account with Supabase's admin API. Scrivn then sends the confirmation
email itself (Resend), with the same `/auth/confirm` link Supabase's template carried.

**So Supabase's own switch stays OFF, for good**, also after sign-up opens:

> Authentication → Sign In / Providers → Email → **Allow new users to sign up** → off

The admin API is not subject to it, and with it off the public anon key (in every page's JavaScript)
can make no account at all, so nothing gets round the guard. Opening sign-up is
`NEXT_PUBLIC_SIGNUPS_OPEN=true` in Vercel and a redeploy, nothing in Supabase. Give testers accounts
with the script below, not the dashboard's Add user. The first time sign-up opens, make one account on
scrivn.ca and check the confirmation email arrives and its link signs you in.

### Giving a tester an account (while sign-up is shut)

From this machine (it needs the service-role key and `RESEND_API_KEY` in `.env.local`):

    node scripts/add-tester.mjs jane@example.com --name "Jane Smith" --company "Smith Restoration"
    node scripts/list-testers.mjs

- The account is the same as a sign-up's, made by the same steps (`lib/accountMaking.ts`): the user,
  their profile, their own organization (named after `--company`, else after `--name`, as sign-up
  does) with them as owner, and the one-trial-per-mailbox check.
- It is made with the email confirmed and **no password**. No password passes through us: they get one
  plain-text email from no-reply@scrivn.ca, no links, telling them to go to scrivn.ca/forgot-password,
  set a password, then try Exterior → From photos or Scrivn Scan. The words are `testerEmail` in
  `lib/testerAccounts.ts`. `--no-email` sends nothing; the script prints what to tell them.
- `--dry-run` reads only: it says what it would make and prints the email.
- Safe to run twice: an address that already has an account, however it was made, is reported and
  left exactly as it is. A typo in an option, a bad address or a missing key stops it before anything.
- `list-testers` finds them by the mark the script leaves in each account's app_metadata
  (`invited_by: "add-tester"`), with company, when made, and whether they have signed in.
- If production sets `GUARD_HASH_SECRET`, put the same value in `.env.local`, so the trial check hashes
  the address as the site does.
- Tested by `npm run test:testers`, against the local Supabase stand-in and a stand-in for Resend.

### The guard (b-guard)

Counted in the database (`request_limit_hit`, 0014), shared by every serverless instance, numbers
from the environment (a value that isn't a whole number keeps the default):

| Variable | Limits | Default |
|---|---|---|
| `SIGNUP_LIMIT_PER_IP_PER_DAY` | new accounts from one address in a day (UTC) | 3 |
| `SIGNUP_LIMIT_PER_DAY` | new accounts from everywhere in a day | 25 |
| `SIGNIN_LIMIT_PER_IP_PER_HOUR` | Scrivn Scan sign-ins (and delete-account passwords) from one address | 30 |
| `SIGNIN_LIMIT_PER_EMAIL_PER_HOUR` | Scrivn Scan sign-ins to one email | 10 |
| `GUARD_HASH_SECRET` | optional salt for the hashed addresses and emails | unset |

**Trial abuse:** one free trial per mailbox. Each new account's email is normalised (lower case,
`+tag` dropped, Gmail dots dropped) and kept as a salted hash in `trial_emails`; an address seen before
gets an account whose trial starts spent. The hash survives account deletion on purpose (PRIVACY.md
says so), so deleting and signing up again is not five more free claims.

**AI spend alarm:** every Claude call's tokens are priced (`lib/aiPricing.ts`, Opus 5.5 at US$4 / $20
per million in / out) and added to the day's total (`ai_spend_days`). The call that takes the day past
`AI_SPEND_ALARM_USD` emails `AI_SPEND_ALARM_EMAIL` (or `CONTACT_EMAIL`) once that day; the day is
`AI_SPEND_TIMEZONE`'s (America/Edmonton by default). It is an estimate that only watches. **The hard
stop is the Anthropic console's own spend limit (Settings → Limits), which only the owner can set.**

The guards fail open if the database can't answer (0014 not applied, Supabase down): they are a brake,
and Supabase's own per-address limits stand behind them.

### Why this matters more than it looks

A new account gets a **free trial of 5 claims over 30 days with no card**, and every claim spends
Anthropic credit on extraction and generation. An open sign-up page on a public domain is therefore
a live, uncapped cost, not just an empty user table.

## Team accounts — `TEAMS_ENABLED`

Off everywhere (built 2026-10-13, dormant). While off, the `/api/team` routes answer 404, the Team
card on the Account page is not drawn, the invitation page is a 404, and no invitation email can be
sent. Everyone is alone in their own organization, as they have been since migration 0004.

Turning it on needs migrations `0011_org_billing.sql` and `0012_teams.sql` applied first, plus the
other steps in `TEAMS.md`.

It meets sign-up in one place: **an invited person needs an account.** While
`NEXT_PUBLIC_SIGNUPS_OPEN` is off, make one for them with `node scripts/add-tester.mjs` and the address
the invitation went to. They set a password with Forgot password, then open the link and sign in.
