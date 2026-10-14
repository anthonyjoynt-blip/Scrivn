import { NextResponse } from "next/server";

/**
 * "Update your card" — the link in the failed-payment email (emails/PaymentFailed.tsx).
 *
 * Only a hop to /api/portal, which opens Stripe's billing portal. It exists because it is not under
 * /api/: middleware.ts answers a signed-out request for an /api/ path with a 401, which is right for
 * a fetch() and useless to someone tapping a link in their email, whereas any other path sends them
 * to sign in and back here afterwards.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL("/api/portal", request.url));
}
