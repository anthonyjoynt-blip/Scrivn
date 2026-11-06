"use client";

/**
 * A length typed on a phone: a box for feet, a box for inches, and a pick for the fraction.
 *
 * One text box with a number keypad can't take 5'10¾" — the keypad has no ' or " — and a full keyboard
 * hides them a page deep. The owner, 10-21: "i couldnt put in feet and inches just straight numbers".
 * Each box here is plain digits, and inches may run past 12 for a window taped in inches alone
 * (0 ft, 70 in, ¾). lib/sketch.ts feetFromParts does the sum.
 */
import { useState } from "react";
import { feetFromParts } from "@/lib/sketch";

const EIGHTHS: { label: string; eighths: number }[] = [
  { label: "—", eighths: 0 },
  { label: "⅛", eighths: 1 },
  { label: "¼", eighths: 2 },
  { label: "⅜", eighths: 3 },
  { label: "½", eighths: 4 },
  { label: "⅝", eighths: 5 },
  { label: "¾", eighths: 6 },
  { label: "⅞", eighths: 7 },
];

/** A length in feet as the boxes show it: whole feet, inches, eighths. */
function parts(feet: number | null | undefined): { f: string; i: string; e: number } {
  if (feet === null || feet === undefined || !Number.isFinite(feet) || feet <= 0) return { f: "", i: "", e: 0 };
  const total = Math.round(feet * 96);
  const f = Math.floor(total / 96);
  const i = Math.floor((total - f * 96) / 8);
  return { f: String(f), i: String(i), e: total - f * 96 - i * 8 };
}

export function FeetInchesInput({ label, autoFocus, initial, onChange }: { label: string; autoFocus?: boolean; initial?: number | null; onChange: (feet: number | null) => void }) {
  const [start] = useState(() => parts(initial));
  const [feet, setFeet] = useState(start.f);
  const [inches, setInches] = useState(start.i);
  const [eighths, setEighths] = useState(start.e);
  const update = (f: string, i: string, e: number) => {
    setFeet(f);
    setInches(i);
    setEighths(e);
    onChange(feetFromParts(f, i, e));
  };
  const box = { width: "4.2em", fontSize: 16 };
  return (
    <span role="group" aria-label={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input type="text" inputMode="decimal" aria-label={`${label}: feet`} value={feet} onChange={(e) => update(e.target.value, inches, eighths)} style={box} autoFocus={autoFocus} />
      ft
      <input type="text" inputMode="decimal" aria-label={`${label}: inches`} value={inches} onChange={(e) => update(feet, e.target.value, eighths)} style={box} />
      in
      <select aria-label={`${label}: and a fraction of an inch`} value={eighths} onChange={(e) => update(feet, inches, Number(e.target.value))} style={{ fontSize: 16, minHeight: 44, minWidth: 56, padding: "0 6px" }}>
        {EIGHTHS.map((o) => (
          <option key={o.eighths} value={o.eighths}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}
