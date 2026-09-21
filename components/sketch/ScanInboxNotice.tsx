"use client";

import { useEffect, useRef } from "react";
import type { PendingScan } from "@/lib/scanInbox";
import { levelLabel } from "@/lib/sketch";

/**
 * What the page says when a scan arrives from a paired phone.
 *
 * Two notices, one style: the same strip the sketch editor uses for "Wall deleted — Undo" and its
 * import result, because to the estimator this IS an import — one that happened to come over the
 * air. `ScanInboxNotice` is the question (Adopt or Discard, when applying would throw work away);
 * `ScanInboxMessage` is the receipt after a scan was applied without asking. Which one shows is
 * decided by `scanDecision` in lib/scanInbox.ts, not here.
 */

/** How long the receipt stays up on its own. Long enough to be read after looking up from the phone. */
const MESSAGE_MS = 12_000;

/** "3:12 pm" — the clock time the scan came in, lower-case so it reads as prose rather than a timestamp. */
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLocaleLowerCase();
}

/** The phone's name as the notice should say it; a phone that was never named is "your phone". */
function phoneName(scan: PendingScan): string {
  return scan.deviceName?.trim() || "your phone";
}

function rooms(n: number): string {
  return `${n} room${n === 1 ? "" : "s"}`;
}

/**
 * A scan that needs an answer.
 *
 * The copy says what adopting does — replaces the rooms on that storey, readings and marks included
 * — because that is the whole reason it is a question rather than a done deed: the storey has
 * something on it the estimator drew, marked or measured, and the replace would take it with it.
 */
export function ScanInboxNotice({
  scan,
  roomCount,
  error,
  onAdopt,
  onDiscard,
  busy,
}: {
  scan: PendingScan;
  /** How many rooms the scan draws, or null when that cannot be told because it does not draw. */
  roomCount: number | null;
  /**
   * Always "ask": a scan the rule says to adopt is applied before this could render. The prop is
   * here so the call site states the case it is rendering rather than leaving it implied.
   */
  decision: "ask";
  /** Why the scan could not be drawn, when it could not. The notice then offers only Discard. */
  error?: string | null;
  onAdopt: () => void;
  onDiscard: () => void;
  busy: boolean;
}) {
  const storey = levelLabel(scan.level).toLowerCase();
  const arrived = `A scan arrived from ${phoneName(scan)} at ${clockTime(scan.receivedAt)}`;
  const text = error
    ? `${arrived}, but it could not be drawn. ${error}`
    : `${arrived} — ${roomCount === null ? "rooms" : rooms(roomCount)} for the ${storey}. Adopting replaces the rooms on that storey, and anything drawn or metered on them goes with them.`;

  return (
    <div className="sketch-undo scan-inbox-notice" role={error ? "alert" : "status"}>
      <span>{text}</span>
      {!error && (
        <button type="button" className="btn-primary" disabled={busy} onClick={onAdopt}>
          {busy ? "Adopting…" : "Adopt"}
        </button>
      )}
      <button type="button" className="btn-secondary" disabled={busy} onClick={onDiscard}>
        Discard
      </button>
    </div>
  );
}

/**
 * The receipt for a scan applied without asking. Goes away on its own or on OK, whichever is first.
 */
export function ScanInboxMessage({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  // Read through a ref so a page that re-renders on every drag does not keep restarting the timer.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className="sketch-undo scan-inbox-notice" role="status">
      <span>{message}</span>
      <button type="button" className="btn-secondary" onClick={onDismiss}>
        OK
      </button>
    </div>
  );
}

/** The receipt's wording, shared with the page so the silent and the chosen adoption read the same. */
export function scanAdoptedMessage(level: number, roomCount: number): string {
  return `${levelLabel(level)} updated from your phone — ${rooms(roomCount)}.`;
}
