import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/send";
import { DocumentsDeliveryEmail } from "@/emails/DocumentsDelivery";

/**
 * Emails a claim's finished documents as PDF attachments.
 *
 * The PDFs arrive already built: the browser renders them with the same `lib/pdf.ts` code the
 * Download PDF buttons use, then posts them here as multipart form data. Nothing is stored — the
 * attachments live in memory for the duration of this request and are gone when it returns, which
 * is the same lifetime a downloaded PDF has today. No database write, no bucket, no claim record.
 *
 * Unlike the lifecycle emails, a failure here IS the user's problem: sending is what they asked
 * for, so the result is reported honestly rather than swallowed.
 */

/** Total attachment ceiling. Resend's own limit is 40MB per message; staying under it with headroom avoids a provider-side rejection that would surface as an opaque failure. */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_RECIPIENTS = 10;

/** Deliberately permissive — the goal is catching typos, not policing valid address syntax, which is far stranger than most patterns allow. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  const senderEmail = typeof claims?.email === "string" ? claims.email : null;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data." }, { status: 400 });
  }

  const recipientsRaw = String(form.get("recipients") ?? "");
  // Accept commas, semicolons, or whitespace — PMs paste address lists from all sorts of places.
  const recipients = recipientsRaw
    .split(/[,;\s]+/)
    .map((r) => r.trim())
    .filter((r) => r !== "");

  if (recipients.length === 0) {
    return NextResponse.json({ error: "Enter at least one recipient email address." }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `Too many recipients (limit ${MAX_RECIPIENTS}).` }, { status: 400 });
  }
  const invalid = recipients.filter((r) => !looksLikeEmail(r));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Not a valid email address: ${invalid.join(", ")}` }, { status: 400 });
  }

  const customerName = String(form.get("customerName") ?? "");
  const jobNumber = String(form.get("jobNumber") ?? "");
  const senderName = String(form.get("senderName") ?? "") || null;
  const message = String(form.get("message") ?? "").trim() || null;

  const files = form.getAll("documents").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No documents were attached." }, { status: 400 });
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json({ error: "Those documents are too large to email together. Try sending fewer at a time." }, { status: 413 });
  }

  const attachments = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      // Resend takes base64 for attachment content.
      content: Buffer.from(await file.arrayBuffer()).toString("base64"),
    })),
  );

  const sent = await sendEmail({
    to: recipients,
    subject: `${jobNumber ? `${jobNumber} – ` : ""}${customerName || "Claim documents"}`,
    react: DocumentsDeliveryEmail({ customerName, jobNumber, documentNames: files.map((f) => f.name), senderName, message }),
    attachments,
    // Replies go to the PM who sent it, not to the unmonitored no-reply sender.
    ...(senderEmail ? { replyTo: senderEmail } : {}),
  });

  if (!sent) {
    return NextResponse.json({ error: "The email couldn’t be sent. Check the address and try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, recipients: recipients.length });
}
