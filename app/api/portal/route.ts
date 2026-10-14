import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";
import { canManageBilling, isOrgRole } from "@/lib/teams";
import { isBillingSchemaMissing } from "@/lib/usageState";

/**
 * Redirects the signed-in user to Stripe's hosted Customer Portal — updating a card, viewing
 * invoices, changing plan, cancelling.
 *
 * Deliberately no custom UI for any of that: the portal already handles it, and rebuilding it would
 * mean reimplementing proration, dunning, and invoice history against a moving API.
 *
 * A GET (rather than the POST used elsewhere) so it can be a plain link. That's safe here because
 * it has no side effects on our data — it creates a short-lived Stripe session and redirects.
 *
 * The billing is the ORGANIZATION'S (0011), and only its owner may open it — the portal can cancel
 * the plan everyone on a team works under. Alone, everyone is the owner of their own organization,
 * so this turns nobody away today. On a database where 0011 has not been applied yet the customer is
 * still read from the profile, as before (see "Until 0011 is applied" in lib/usage.ts).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { data: membership } = await supabase.from("organization_members").select("organization_id, role").eq("user_id", userId).limit(1).maybeSingle();
    const organizationId = typeof membership?.organization_id === "string" ? membership.organization_id : null;
    if (organizationId && !canManageBilling(isOrgRole(membership?.role) ? membership.role : null)) {
      // A teammate, not the owner: the account page says who manages billing.
      return NextResponse.redirect(new URL("/account?portal=owner", request.url));
    }

    const admin = createAdminClient();
    const customerId = await stripeCustomerFor(admin, organizationId, userId);

    if (!customerId) {
      // Never checked out, so there's no billing to manage — pricing is the useful destination.
      return NextResponse.redirect(new URL("/pricing", request.url));
    }

    const origin = new URL(request.url).origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account`,
    });

    return NextResponse.redirect(session.url, { status: 303 });
  } catch (err) {
    console.error("[/api/portal]", err);
    return NextResponse.redirect(new URL("/account?portal=error", request.url));
  }
}

/** The organization's Stripe customer — or, on a database without 0011, the profile's. */
async function stripeCustomerFor(admin: ReturnType<typeof createAdminClient>, organizationId: string | null, userId: string): Promise<string | null> {
  if (organizationId) {
    const { data, error } = await admin.from("organizations").select("stripe_customer_id").eq("id", organizationId).maybeSingle();
    if (!error) return (data?.stripe_customer_id as string | null) ?? null;
    if (!isBillingSchemaMissing(error)) throw new Error(error.message);
  }
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
  return (profile?.stripe_customer_id as string | null) ?? null;
}
