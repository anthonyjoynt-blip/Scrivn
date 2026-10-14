"use client";

import { useState } from "react";
import type { Clash } from "@/lib/useClaimPersistence";

/**
 * The claim changed in two places at once, and the estimator decides (2026-10-13, offline mode).
 *
 * Both copies are already kept by the time this shows — the server's on the server, this phone's on
 * this phone — so nothing is lost while it waits, and work on the claim can carry on underneath it.
 * The question is put plainly, with what the two disagree on, because the person who can answer it
 * is the one who knows what they did in the basement and what the office might have done meanwhile.
 * Nothing is merged for them: a merged sketch or a merged set of answers can look right and be wrong.
 */
export function ClashBanner({ clash, onKeep }: { clash: Clash; onKeep: (keep: "mine" | "theirs" | "both") => void }) {
  const [busy, setBusy] = useState(false);
  const keep = (choice: "mine" | "theirs" | "both") => {
    setBusy(true);
    onKeep(choice);
  };

  if (clash.theirs === null) {
    return (
      <div className="clash-banner" role="alert">
        <p>
          <strong>This claim was deleted from Scrivn while you were changing it here.</strong> Your copy is safe on this phone.
        </p>
        <div className="clash-banner-actions">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => keep("mine")}>
            Keep it — save it to Scrivn again
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => keep("theirs")}>
            Let it go — remove it from this phone
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="clash-banner" role="alert">
      <p>
        <strong>This claim was changed somewhere else while you were changing it here.</strong> Both versions are kept — nothing has
        been lost. Which do you want?
      </p>
      {clash.differs.length > 0 && <p className="field-note">They differ in {joinWords(clash.differs)}.</p>}
      <div className="clash-banner-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => keep("both")}>
          Keep both
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => keep("mine")}>
          Keep mine (replace the other)
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => keep("theirs")}>
          Use the other (drop mine)
        </button>
      </div>
      <p className="field-note">
        Keep both saves your version as a separate claim, named “(copy)”, and leaves the other as it is. Mine is what is on screen now.
      </p>
    </div>
  );
}

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
