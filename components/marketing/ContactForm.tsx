"use client";

import { useState } from "react";
import { CONTACT_REASONS } from "@/lib/contact";

/**
 * The contact form.
 *
 * The initial reason comes in as a prop rather than being read from the URL here, so /pricing's
 * "Get a custom quote" link can land on this page with the right option already selected without
 * the form needing a Suspense boundary for useSearchParams.
 *
 * On success the whole form is replaced by a confirmation. Leaving a filled-in form on screen
 * beside a "sent!" message is how people end up sending the same enquiry three times.
 */
export function ContactForm({ initialReason }: { initialReason: string }) {
  const [reason, setReason] = useState(initialReason);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSending(true);

    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          company: form.get("company"),
          reason: form.get("reason"),
          message: form.get("message"),
          website: form.get("website"),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "That didn't send. Try again in a moment.");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't send. Try again in a moment.");
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="narrow">
        <div className="mk-altcontact" style={{ marginTop: "40px" }}>
          <p>
            <b>Thanks — that&rsquo;s sent.</b> We typically respond within one business day, to the address you gave.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form className="mk-form narrow" onSubmit={handleSubmit}>
      {error && <div className="mk-form-error">{error}</div>}

      <div className="mk-row2">
        <div className="mk-field">
          <label htmlFor="contact-name">Name</label>
          <input id="contact-name" name="name" type="text" placeholder="Your name" required maxLength={120} autoComplete="name" />
        </div>
        <div className="mk-field">
          <label htmlFor="contact-email">Email</label>
          <input id="contact-email" name="email" type="email" placeholder="you@company.com" required maxLength={254} autoComplete="email" />
        </div>
      </div>

      <div className="mk-field">
        <label htmlFor="contact-company">Company</label>
        <input id="contact-company" name="company" type="text" placeholder="Company name" maxLength={160} autoComplete="organization" />
      </div>

      <div className="mk-field">
        <label htmlFor="contact-reason">Reason for contact</label>
        <select id="contact-reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)}>
          {CONTACT_REASONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mk-field">
        <label htmlFor="contact-message">Message</label>
        <textarea id="contact-message" name="message" placeholder="What can we help with?" required maxLength={4000} />
      </div>

      {/*
        Honeypot. Hidden from people and from screen readers, and skipped by tab order — a human
        can't fill it, so anything that does is automated. The server silently discards those.
      */}
      <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
        <label htmlFor="contact-website">Leave this field empty</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" className="mk-submit-btn" disabled={sending}>
        {sending ? "Sending…" : "Send message"}
      </button>
      <div className="mk-response-note">We typically respond within one business day.</div>
    </form>
  );
}
