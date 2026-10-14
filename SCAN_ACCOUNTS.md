# Scrivn Scan on its own: accounts, free scans, deleting

Built 2026-10-14 for launch items **sa-signin**, **sa-free**, **sa-delete** and **b-guard**. The
decisions behind it are the owner's (2026-10-01 and 10-08): a Scan user is an ordinary Scrivn account;
the Scan plan is sold on scrivn.ca through Stripe, never in the app; a Scrivn plan includes Scan; about
three free scans a month, counted on the server; the app names scrivn.ca/scan in plain text only.

## What a standalone user sees

On the phone, top left whenever a capture isn't running, there's **Account**:

- **Not signed in:** Sign in · Create an account · Pair with a code from Scrivn · Delete an account
  (which says: sign in first, or scrivn.ca/account/delete). Send on a phone with no account opens the
  same screen, and its button reads **Sign in** (it read Pair).
- **Sign in:** email and password, and Forgot password (opens scrivn.ca/forgot-password in the
  browser). The phone keeps a device token exactly like pairing's, never the password.
- **Create an account:** asks Scrivn first. While sign-up is invite-only it shows Scrivn's sentence
  instead of a form. Open: name, email, password; then "Check your email". The link confirms the
  address and lands on scrivn.ca/scan/ready ("go back to Scan and sign in").
- **Signed in:** who, which organization, the email, the scans this month as Scrivn words them
  ("Free plan: 2 of 3 free scans used this month. They start again on November 1."), Sign out and
  Delete account. Sign out revokes the phone's token on Scrivn too.
- **Share** (the plan PDF + JPG) asks Scrivn first when the phone has an account; past the free scans
  it shows "You've used your 3 free scans this month. They start again on November 1. For unlimited
  scans, see the Scrivn Scan plan at scrivn.ca/scan." — plain text, no link, no button, and no plan is
  made. **Send** past the limit is refused with the same sentence and the scan waits on the phone.
- **Delete account:** the password again; then it's gone and the phone is signed out.

On scrivn.ca: the Account page shows phones that are paired *or signed in*, the scans this month, and
a Delete account card; /account/delete explains deletion to anyone (signed out it says how; signed in
it has the form). A signed-in phone's scans land in the account's claims exactly as a paired phone's.

## What counts as a scan (sa-free)

One **capture**: everything walked between pressing Start and the next Start, named by the capture id
the phone already sends with every scan. It's counted the first time it leaves the phone, sent to
Scrivn or shared as a plan, and never again (re-sent, sent to another claim, shared after sending:
free). Its levels and exterior are the same scan. A walk that never leaves the phone isn't counted.
Counted per organization, per calendar month (UTC). Any plan, Scrivn's or Scan's, is unlimited.

**Decisions taken here (the owner may change any of them):**

1. **A phone with no account isn't counted** (signed out, never paired): Share works on it exactly as
   today. So the limit binds signed-in and paired phones only. Requiring an account to Share would be
   a one-line change in `ScrivnSend.beforeShare`.
2. **Counted always, refused only once billing is on** (`BILLING_ENABLED=true`), because a refusal
   that points at a plan nobody can buy is only a wall. `SCAN_FREE_TIER=on` / `off` overrides either
   way (to try the limit before billing opens).
3. **A Scrivn trial counts as no plan**: a trial user (or a paired phone of a company on the trial)
   gets three free scans a month like anyone without a plan.
4. **With no signal** the phone decides from what Scrivn said last, generously, and tells Scrivn when
   the signal is back.

## Deleting an account (sa-delete)

`lib/accountDeletion.ts`, from the phone (`POST /api/device/account/delete`, bearer + password) or the
web (`POST /api/account/delete`, session + password). In order: the plan of every organization that
goes is cancelled in Stripe (no refund of the period paid; if Stripe can't be reached nothing is
deleted); then `account_close` (0013); then the photos and logo in storage; then the auth user; then a
"your account has been deleted" email.

- Alone in their organization: the organization goes with everything in it (claims, scans, photos,
  letterhead, scan counts). PRIVACY.md: claims are kept "until the company deletes them"; the only
  person in a company deleting their account is the company deleting them.
- On a team: they leave it; the claims they started stay with the team, with no name on them.
- Owner of a team with other people: refused until they hand it over (teams are dormant).
- Their own organization set aside while on a team: deleted too.
- Kept: Stripe's payment records; the salted hash of the email in `trial_emails`.

## Endpoints

| Route | What |
|---|---|
| `POST /api/device/signin` | email + password → device token (a pairing begun and spent for the phone) |
| `GET/POST /api/device/signup` | is sign-up open; make an account (same door as the website) |
| `GET /api/device/me` | now also `email` and `allowance` |
| `POST /api/device/scans/use` | Share: count this capture, or 402 |
| `POST /api/device/scans` | Send: counts the capture; 402 past the limit; answers `allowance` |
| `POST /api/device/signout` | the phone's token revokes itself |
| `POST /api/device/account/delete` | delete, from the phone |
| `POST /api/signup` | the website's sign-up form |
| `POST /api/account/delete` · `/account/delete` | delete, on the website (the page is public) |

## Migration

`supabase/migrations/0013_scan_accounts.sql` — written, **not applied**. Needs 0011 and 0012 first.
Until it's applied, everything degrades to today: nothing counted or refused, guards let everything
through, deletion answers "email privacy@scrivn.ca", phone sign-in works (it uses 0006's functions).

## Play Console (sa-declare) and TermsFeed

**Data safety form**, changes for Scrivn Scan:

- Data collected → **Personal info: Email address, Name** — collected, not shared; purposes: Account
  management, App functionality; optional (Scan works without an account).
- **Financial info: Purchase history** — collected (Stripe, when someone buys a plan on scrivn.ca and
  signs in to Scan); purpose: Account management / App functionality. Bought outside the app.
- **App info and performance / App activity → Other user-generated content or App interactions**:
  the scan count (capture id, time) — App functionality.
- **Personal info: User IDs** — the account id behind the token — App functionality, Account management.
- Data is encrypted in transit: yes. **Users can request deletion: yes**, in the app and at
  **https://scrivn.ca/account/delete** (the URL to give for "Delete account URL").
- App content → **Account creation**: the app lets people create an account; deletion URL as above.

**TermsFeed**: paste PRIVACY.md's sections again — Scrivn Scan, Service providers, Keeping and
deleting claim data, Deleting your account, Security and preventing abuse.

## Known gaps

- Every phone sign-in reaches Supabase from Scrivn's server address, so Supabase's own per-address
  limit can't tell phones apart; Scrivn's per-address and per-email throttle stands in front.
- The free tier is as strong as the app: a modified app holding a token could skip asking before
  Share, or call the send function directly. Worth closing only if it's ever seen.
- "24 months after the company's account closes" in PRIVACY.md has no job behind it (an account that
  stops paying isn't closed by anything); deletion is immediate.
- Supabase's "Allow new users to sign up" must stay off; the confirmation email is now Scrivn's.

## Trying it locally (no production touched)

`test/e2e/fakeSupabase.mjs` is Supabase's auth, REST and storage over PGlite with every migration.

1. `node test/e2e/fakeSupabase.mjs --write-env .env.development.local` (leave it running)
2. Add to that file: `NEXT_PUBLIC_SIGNUPS_OPEN=true`, `SCAN_FREE_TIER=on`,
   `SIGNUP_LIMIT_PER_IP_PER_DAY=3`, and empty `RESEND_API_KEY=`, `STRIPE_SECRET_KEY=`,
   `ANTHROPIC_API_KEY=` so nothing leaves the machine; start `next dev` on 3005.
3. `npm run test:e2e:scan` (45 checks), and Scan's own client:
   `SCRIVN_E2E_ORIGIN=http://127.0.0.1:3005 ./gradlew.bat testDebugUnitTest --tests "*ScrivnAccountE2ETest*"`.
4. Delete `.env.development.local` afterwards.
