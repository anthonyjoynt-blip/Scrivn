# Who can sign up, and who can pay

Scrivn is deployed and usable before it is a business. Two things are therefore held shut on
purpose, and this is the record of which switch does what.

Both flags **fail closed**: they open only on the exact string `true`. A missing, empty or misspelt
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

Off in production. While off, `/signup` shows an invite-only panel instead of the form.

**This is honesty, not enforcement.** Sign-up runs in the browser against Supabase's public anon
key, which is in every page's JavaScript, so anyone who wants to can call `auth.signUp` directly
whatever this app renders. The flag stops the app *inviting* someone to fill in a form the backend
should reject; it does not do the rejecting.

**The switch that actually enforces it** is in the Supabase dashboard for project
`jfwgeujrbrwiyrfcpwug`:

> Authentication → Sign In / Providers → Email → **Allow new users to sign up** → off

With that off, `auth.signUp` fails for everyone regardless of the UI. Add testers with
**Authentication → Users → Add user**, or Invite, which emails them a link.

### Why this matters more than it looks

A new account gets a **free trial of 5 claims over 30 days with no card**, and every claim spends
Anthropic credit on extraction and generation. An open sign-up page on a public domain is therefore
a live, uncapped cost, not just an empty user table.
