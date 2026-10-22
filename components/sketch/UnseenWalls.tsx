"use client";

import type { ExteriorSide } from "@/lib/exterior";
import { formatFeetInches } from "@/lib/sketch";
import styles from "./UnseenWalls.module.css";

/**
 * A wall no photo faces (2026-10-21, lib/exterior.ts `notPhotographed`): "No photo of this wall: any windows or doors?",
 * answered with None or a count of each, by the person who was at the house. Asked where only they can answer it -
 * before a measure from the Scrivn team is used (TeamMeasure.tsx), and on the wall itself (ExteriorSide.tsx) - never
 * about anything a photo shows: what the photos show is ours to read (the owner, 10-21: "it shouldnt have to ask if the
 * garage drops. you can see it in the photos can you not?").
 */

export type UnseenSaid = { windows: number; doors: number } | null;

export function UnseenWallAsk({ side, said, readOnly, onSay }: { side: ExteriorSide; said: UnseenSaid; readOnly: boolean; onSay: (said: UnseenSaid) => void }) {
  const none = !!said && said.windows === 0 && said.doors === 0;
  const name = side.name.trim() || "This wall";
  const set = (k: "windows" | "doors", n: number) => onSay({ windows: said?.windows ?? 0, doors: said?.doors ?? 0, [k]: Math.max(0, Math.min(20, n)) });
  return (
    <div className={styles.ask} role="group" aria-label={`${name}: no photo of this wall`}>
      <p>
        <strong>{name}</strong> <span className="field-note">({formatFeetInches(side.lengthFeet)})</span>: no photo of this wall. Any windows or doors on it?
      </p>
      <div className={styles.row}>
        <button type="button" className={`option-btn${none ? " selected" : ""}`} aria-pressed={none} disabled={readOnly} onClick={() => onSay(none ? null : { windows: 0, doors: 0 })}>
          None
        </button>
        <Stepper label="Windows" value={said && !none ? said.windows : null} readOnly={readOnly} onChange={(n) => set("windows", n)} />
        <Stepper label="Doors" value={said && !none ? said.doors : null} readOnly={readOnly} onChange={(n) => set("doors", n)} />
      </div>
      {said && !readOnly && (
        <button type="button" className="link-button" onClick={() => onSay(null)}>
          Not sure: leave it unknown
        </button>
      )}
    </div>
  );
}

/** A count with − and + either side, finger-sized: "–" until one is said. */
function Stepper({ label, value, readOnly, onChange }: { label: string; value: number | null; readOnly: boolean; onChange: (n: number) => void }) {
  return (
    <span className={styles.stepper} role="group" aria-label={label}>
      <span className={styles.stepLabel}>{label}</span>
      <button type="button" className="btn-secondary" aria-label={`Fewer ${label.toLowerCase()}`} disabled={readOnly || !value} onClick={() => onChange((value ?? 0) - 1)}>
        &minus;
      </button>
      <span className={styles.count} aria-live="polite">
        {value ?? "–"}
      </span>
      <button type="button" className="btn-secondary" aria-label={`More ${label.toLowerCase()}`} disabled={readOnly} onClick={() => onChange((value ?? 0) + 1)}>
        +
      </button>
    </span>
  );
}
