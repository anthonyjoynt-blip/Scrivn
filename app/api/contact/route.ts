import { NextResponse } from "next/server";
import { sendEmail, isEmailConfigured } from "@/lib/email/send";
import { ContactMessage } from "@/emails/ContactMessage";
import { CONTACT_REASONS, type ContactReason } from "@/lib/contact";
import { cleanEnv } from "@/lib/env";

/**
 * The public contact form's endpoint.
 *
 * This is the only route in the app that anyone on the internet can POST to without a session (the
 * Stripe webhook is open too, but it verifies a signature). That shapes everything below: it is an
 * unauthenticated way to make the server send email, so it validates hard, caps sizes, drops
 * obvious bots, and throttles per IP.
 *
 * It is deliberately NOT in middleware.ts's PUBLIC_ROUTES-by-accident sense — see the entry added
 * there. Without it the middleware would 401 every submission from a signed-out visitor, which is
 * every visitor a contact form exists for.
 */

/** Hard caps so a single request can't post a novel into an inbox. */
const LIMITS = { name: 120, email: 254, company: 160, message: 4000 } as const;

/**
 * Per-IP throttle. In-memory, so it resets on deploy and isn't shared between serverless instances —
 * it takes the edge off casual abuse rather than being a real defence. If this form ever gets
 * seriously targeted, move to a durable store (or put a CAPTCHA in front) rather than tuning these
 * numbers.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  // Keep the map from growing without bound on a long-lived instance.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return recent.length > MAX_PER_WINDOW;
}

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Strip CR/LF from single-line fields at the call site; here just trim and cap.
  return value.trim().slice(0, max);
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Too many messages from this connection. Try again shortly." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Could not read that submission." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;

  // Honeypot: a field hidden from real users. Anything filling it is automated, so accept the
  // request with a normal-looking success and send nothing — telling a bot it failed just teaches it.
  if (clean(payload.website, 100)) {
    return NextResponse.json({ ok: true });
  }

  const name = clean(payload.name, LIMITS.name);
  const email = clean(payload.email, LIMITS.email);
  const company = clean(payload.company, LIMITS.company);
  const message = clean(payload.message, LIMITS.message);
  const reasonValue = clean(payload.reason, 60);

  if (!name || !email || !message) {
    return NextResponse.json({ error: "Name, email and message are all required." }, { status: 400 });
  }

  // Enough to catch typos and to make the Reply-To header safe. Real validation is the reply landing.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
  }

  const reason: ContactReason | undefined = CONTACT_REASONS.find((r) => r.value === reasonValue);
  const reasonLabel = reason?.label ?? CONTACT_REASONS[0].label;

  const to = cleanEnv("CONTACT_EMAIL");
  if (!to || !isEmailConfigured()) {
    // Log the whole submission so a misconfiguration loses a notification, not the enquiry itself.
    console.error("[/api/contact] Not configured (CONTACT_EMAIL / RESEND_API_KEY). Submission:", { name, email, company, reason: reasonLabel, message });
    return NextResponse.json({ error: "Messages aren't set up yet. Email us directly and we'll pick it up." }, { status: 503 });
  }

  const sent = await sendEmail({
    to,
    subject: `Scrivn contact — ${reasonLabel} — ${name}`,
    react: ContactMessage({ name, email, company, reason: reasonLabel, message }),
    // Reply goes to the person who wrote in, not to the no-reply sender.
    replyTo: email,
  });

  /*
    `!sent.ok`, not `!sent` — `sendEmail` returns an object now, and `!object` is always false, so
    the plain truthiness check would have reported every failed send as a success. TypeScript cannot
    see that: negating an object is valid JavaScript.
  */
  if (!sent.ok) {
    console.error("[/api/contact] Send failed:", sent.reason, { name, email, company, reason: reasonLabel, message });
    return NextResponse.json({ error: "That didn't send. Try again in a moment." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
