import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/server";

/**
 * Redirects the signed-in user to Stripe's hosted Customer Portal — updating a card, viewing
 * invoices, changing plan, cancelling.
 *
 * Deliberately no custom UI for any of that: the portal already handles it, and rebuilding it would
 * mean reimplementing proration, dunning, and invoice history against a moving API.
 *
 * A GET (rather than the POST used elsewhere) so it can be a plain link. That's safe here because
 * it has no side effects on our data — it creates a short-lived Stripe session and redirects.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const admin = createAdminClient();
    const { data: profile } = await admin.from("profiles").select("stripe_customer_id").eq("id", userId).maybeSingle();
    const customerId = (profile?.stripe_customer_id as string | null) ?? null;

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
