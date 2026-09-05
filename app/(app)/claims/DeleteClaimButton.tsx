"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Deleting a claim, for real.
 *
 * Two-step rather than a browser `confirm()`: this removes a real person's address, loss details and
 * generated documents permanently, and there is no undo behind it. A second, explicit click is the
 * least that should stand between a mis-tap and that — and an inline confirmation says what is about
 * to happen in the page's own words, which a native dialog cannot.
 */
export function DeleteClaimButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/claims/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : `Delete failed (${res.status}).`);
      }
      // Re-fetch the server component rather than removing the row locally, so what is on screen is
      // what the database actually holds — including if something else changed in the meantime.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete that claim.");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (error) {
    return (
      <span className="claims-row-delete">
        <span className="field-note">{error}</span>
      </span>
    );
  }

  if (!confirming) {
    return (
      <span className="claims-row-delete">
        <button type="button" className="btn-secondary" onClick={() => setConfirming(true)} aria-label={`Delete ${name}`}>
          Delete
        </button>
      </span>
    );
  }

  return (
    <span className="claims-row-delete">
      <span className="field-note">Delete permanently?</span>
      <button type="button" className="btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
        Cancel
      </button>
      <button type="button" className="btn-danger" onClick={() => void remove()} disabled={busy}>
        {busy ? "Deleting…" : "Delete"}
      </button>
    </span>
  );
}
