# Stripe billing setup

The code is built. These are the steps that need doing in the Stripe and Supabase dashboards before
it works end to end. Nothing here is optional — billing is inert until all of it is done.

## 1. Supabase: run migration 0002

**SQL Editor** → paste `supabase/migrations/0002_billing.sql` → Run.

This adds the four billing columns *and* — importantly — revokes users' ability to write them.
Migration 0001 granted the owner UPDATE on their whole profile row, which was harmless when every
column was descriptive. With billing columns present it is not: RLS controls which *rows* you can
touch, not which *columns*, so without this any signed-in user could run

```js
supabase.from('profiles').update({ subscription_tier: 'unlimited', claims_used_this_period: 0 })
```

from the browser and grant themselves a free unlimited plan. After 0002, `authenticated` can only
update `full_name`, `company_name`, and `phone`; billing columns are writable solely by the service
role, i.e. only the webhook.

## 2. Supabase: add the service-role key

`SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is currently blank and is now **required** — the webhook
has no user session, so it's the only way it can write subscription state.

Supabase dashboard → **Project Settings → API** → the `service_role` / secret key.

Server-side only. Never in a `NEXT_PUBLIC_` variable. It bypasses every access rule in the database.

## 3. Stripe: create three products

**One Product per plan** — not one product with three prices. Checkout and invoices display the
*product* name on each line item, so three tiers sharing a product means every customer's invoice
says the same thing and they can't tell what they bought.

In the Stripe Dashboard (**sandbox mode**), create:

| Product | Price | Recurring |
|---|---|---|
| Scrivn Starter | your call | Monthly |
| Scrivn Growth | your call | Monthly |
| Scrivn Unlimited | your call | Monthly |

Copy each **Price ID** (`price_…`, not the product id) into `.env.local`:

```
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_GROWTH=price_...
STRIPE_PRICE_UNLIMITED=price_...
```

A plan with no configured price renders on the pricing page as "Unavailable" rather than a button
that errors — so you can launch with fewer than three if you want.

Also update `priceLabel` in `lib/plans.ts` so the pricing page shows the real amounts. Those strings
are display-only; Stripe remains the source of truth for what's actually charged.

## 3b. Scrivn Scan on its own (added 2026-10-08)

A fourth product, **Scrivn Scan**, for people who want Scan's floor plans without Scrivn. One product
with **two** prices (monthly and yearly): both are the same plan, so one product name on the
invoice is right here.

| Product | Price | Recurring | Lookup key |
|---|---|---|---|
| Scrivn Scan | $19.00 CAD | Monthly | `scan_monthly` |
| Scrivn Scan | $190.00 CAD | Yearly | `scan_yearly` |

Same tax code as the others (`txcd_10103001`, SaaS) and `exclusive` tax behaviour.
`node scripts/stripe-scan-plan.mjs` creates both in whichever account `STRIPE_SECRET_KEY` points at
(it refuses a live key unless told `--live`) and prints the two lines for `.env.local`:

```
STRIPE_PRICE_SCAN_MONTHLY=price_...
STRIPE_PRICE_SCAN_YEARLY=price_...
```

Run migration `0009_scan_tier.sql` first: the webhook writes `subscription_tier = 'scan'`, which
0002's check refuses until then. The prices shown on the pages are `SCAN_PLAN` in `lib/plans.ts`.

Rules the webhook keeps (`lib/billingTiers.ts`, `npm run test:billing`): checkout refuses Scan to
anyone on a Scrivn plan (it includes Scan); someone on Scan who buys a Scrivn plan has their Scan
subscription cancelled, prorated; and a Scan subscription's events never touch a Scrivn plan.

## 4. Local webhook testing

Stripe can't reach `localhost`, so the CLI forwards events to it:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints a signing secret (`whsec_…`) on start. Put that in `.env.local` as
`STRIPE_WEBHOOK_SECRET` and **restart the dev server** — Next reads env at startup.

Leave `stripe listen` running in its own terminal while testing. The secret it prints is specific to
that session and differs from the production one.

Test card: `4242 4242 4242 4242`, any future expiry, any 3-digit CVC, any postcode.

## 5. Production webhook

For the deployed site, register the endpoint properly:

**Developers → Webhooks → Add endpoint** → `https://scrivn.ca/api/webhooks/stripe`

Subscribe to exactly:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Stripe shows a signing secret for the endpoint — that's the production `STRIPE_WEBHOOK_SECRET`, and
it is **not** the same as the `stripe listen` one. It goes in Vercel's environment variables along
with `STRIPE_SECRET_KEY`, the three price IDs and Scan's two, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
and `SUPABASE_SERVICE_ROLE_KEY`.

## 6. The plan belongs to the organization (added 2026-10-13)

Migration `0011_org_billing.sql` moves `stripe_customer_id`, `subscription_tier`, the claim counter
and the free trial from `profiles` to `organizations`. Everyone today is an organization of one, so
nobody's plan, counter or trial changes. When team accounts are switched on (`TEAMS.md`), everyone on
a team shares one subscription and one claim allowance.

- **Run 0011 in the SQL Editor**, then `0012_teams.sql`. 0011 copies each person's billing onto the
  organization they own, once; running it again copies nothing. Until it has run, the app keeps
  reading and counting the profile columns, as it did before (see "Until 0011 is applied" in
  `lib/usage.ts`), so a deploy that gets ahead of the migration changes nothing anyone sees. A
  trigger also carries the previous build's profile writes onto the organization, so the two can be
  days apart.
- **Only the owner buys.** Checkout and the billing portal refuse anyone but the organization's
  owner. Alone, everyone is the owner of their own organization.
- **How events find the organization.** Checkout sends the organization id as
  `client_reference_id`, and a new Stripe customer carries `metadata.organization_id` (plus
  `supabase_user_id`). Customers made before 0011 carry only `supabase_user_id`; the webhook finds
  them by the customer id 0011 copied onto the organization. The order is `billingLookups` in
  `lib/billingTiers.ts`.
- **The Scan plan covers one person** (owner, 2026-10-14). `seatLimitFor` stores 1 for it
  (`SCAN_SEATS`), and checkout refuses it to an organization of more than one person. See
  `TEAMS.md`, "Seats".
- **Seats: room for a price, no price.** `organizations.seat_limit` holds how many people the plan
  covers; null means no limit, which is every organization on a Scrivn plan or the trial today. `SEAT_PRICING` in `lib/plans.ts`
  is `unlimited`, and has room for either "N seats included per tier" or "a price per seat" (the
  subscription quantity). The webhook stores `seatLimitFor(...)` on every subscription event, and the
  invite functions in 0012 refuse an invite past the limit. Choosing per-seat pricing also needs a
  per-seat Stripe price, a way to change the quantity (the portal's quantity setting, or an "add
  seats" route), and a decision about a team that is over its limit after the plan shrinks.
- **Handing an organization over** (0012) makes the new owner the one who manages billing. The
  Stripe customer's email stays the previous owner's until it is changed in the portal.

### Teams and tax: may need custom invoicing

A team account is one subscription billed to one address, and Stripe Tax charges the GST/HST/PST of
that one address. A restoration company with crews in several provinces may need something one
address cannot give it. Whether it does is a question for the accountant, alongside the tax work in
Known gaps below. If it does, those companies come off Checkout and onto custom invoicing (Stripe
Invoicing with the lines it needs, or invoices made by hand), with the plan set on their
organization by hand or by an admin route. Nothing in 0011 or 0012 assumes Checkout beyond the
subscription itself, so that stays open. The owner parked teams on 2026-09-13 with this in mind; on
2026-10-13 they asked for the infrastructure only, with no price.

## How the pieces fit

- **Checkout** (`/api/checkout`) takes a *tier name* from the browser and resolves the price
  server-side. The client never sends a price ID — if it did, anyone could check out against an
  arbitrary price.
- **The webhook** is what actually grants a plan, to the organization (0011). The success page
  deliberately does not: it's a plain URL anyone can visit, so treating arrival there as proof of
  payment would give away subscriptions.
- **Renewals** arrive as `customer.subscription.updated` carrying a later period end. That
  comparison against the stored `period_reset_at` is what rolls the usage counter over — there's no
  separate scheduled job.
- **The cap** is checked in `/api/extract` and `/api/generate`, but only *counted* in `/api/generate`
  — one claim is one generation, and extraction is two calls in the same claim.

## Known gaps

- **`invoice.payment_failed` is not handled.** A subscription whose renewal payment fails eventually
  becomes `past_due` and then `canceled`, both of which arrive as `customer.subscription.updated`
  and are handled — so access does get revoked, just at Stripe's dunning pace rather than on the
  first failed charge. Add that event if you want to react sooner (e.g. an email).
- **Contents-only claims bypass the counter entirely.** They're generated client-side with no API
  call (by design, see `lib/contentsTM.ts`), so they neither check nor increment usage. Currently
  free and unlimited on every plan.
- **Tax is deliberately deferred until pre-launch** (decided 2026-08-29 — not an oversight). Verified
  state of the sandbox account as of that date:

  | Item | State |
  |---|---|
  | Product tax codes | ✅ `txcd_10103001` (SaaS) on all three products |
  | Default tax behavior | ✅ `exclusive` (tax added on top of the listed price) |
  | Tax settings `status` | ❌ `pending` — head office address not set |
  | Tax registrations | ❌ none |
  | `automatic_tax` in `/api/checkout` | ❌ not enabled |

  Any one of those last three alone means **$0 tax collected, silently, with no error** — which is
  why this needs an explicit check rather than an assumption that "Stripe handles it".

  **Before going live**, three things are needed: set the head office address (Dashboard → Tax →
  Settings) so status flips to `active`; record a registration for each jurisdiction actually
  registered with; and add `automatic_tax: { enabled: true }` to the Checkout Session — which also
  needs `customer_update: { address: 'auto' }`, because Checkout reuses a returning customer's saved
  address otherwise and would compute tax against a stale one.

  Two things worth remembering: **sandbox registrations do not carry over to live mode** and must be
  re-created there, and **under-collection cannot be corrected retroactively** in Stripe — real
  transactions that run with tax silently off become an amended-filing problem, not a fixable one.
  Whether registration is actually required is a question for an accountant, not something to infer
  here.
