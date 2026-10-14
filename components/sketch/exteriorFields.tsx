"use client";

import type { ReactNode } from "react";
import { formatFeetInches, parseFeetInches } from "@/lib/sketch";
import { formatQuantity } from "@/lib/sketchQuantities";

/**
 * The exterior's form fields (2026-10-12), shared by its plan and its sides: feet and inches typed
 * as read off a tape, a count, and a choice that is no answer until one is pressed.
 */

export function sf(value: number): string {
  return `${formatQuantity(value)} SF`;
}
export function lf(value: number): string {
  return `${formatQuantity(value)} LF`;
}
/** "A", "A and B", "A, B and C". */
export function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A box in a table whose headings a phone hides: its own heading, shown only there. */
export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="exterior-cell">
      <span className="exterior-cell-label">{label}</span>
      {children}
    </label>
  );
}

/** A yes or no that starts as neither: unanswered is not no. */
export function YesNo({ label, hint, value, readOnly, onChange }: { label: string; hint?: string; value: boolean | null; readOnly: boolean; onChange: (v: boolean) => void }) {
  return (
    <Choice
      label={label}
      hint={hint}
      value={value === null ? null : value ? "yes" : "no"}
      readOnly={readOnly}
      options={[
        ["yes", "Yes"],
        ["no", "No"],
      ]}
      onChange={(v) => onChange(v === "yes")}
    />
  );
}

/** One of a few answers, as buttons; none pressed until it is answered. */
export function Choice<T extends string>({
  label,
  hint,
  value,
  options,
  readOnly,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T | null;
  options: [T, string][];
  readOnly: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="exterior-choice">
      <span className="exterior-field-label">
        {label}
        {value === null && <span className="exterior-unanswered"> · to answer</span>}
      </span>
      <div className="option-group" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={v} type="button" className={`option-btn${value === v ? " selected" : ""}`} aria-pressed={value === v} disabled={readOnly} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
      {hint && <span className="field-note">{hint}</span>}
    </div>
  );
}

/** A whole number in a row of other fields. */
export function CountInput({ label, value, readOnly, onCommit }: { label: string; value: number; readOnly: boolean; onCommit: (v: number) => void }) {
  return (
    <input
      className="exterior-feet exterior-count"
      type="text"
      inputMode="numeric"
      aria-label={label}
      key={`${label}-${value}`}
      defaultValue={String(value)}
      disabled={readOnly}
      onBlur={(e) => {
        const n = Math.round(Number(e.target.value.trim()));
        if (!Number.isFinite(n) || n < 0 || n > 99) {
          e.target.value = String(value);
          return;
        }
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A feet-and-inches box with its label above it. */
export function FeetField({
  id,
  label,
  value,
  onCommit,
  readOnly = false,
  allowZero = false,
  nullable = false,
  note,
  placeholder,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (feet: number | null) => void;
  readOnly?: boolean;
  allowZero?: boolean;
  nullable?: boolean;
  note?: string;
  placeholder?: string;
}) {
  return (
    <div className="exterior-field">
      <label className="exterior-field-label" htmlFor={id}>
        {label}
      </label>
      <FeetInput id={id} label={label} value={value} onCommit={onCommit} readOnly={readOnly} allowZero={allowZero} nullable={nullable} placeholder={placeholder} />
      {note && <span className="field-note">{note}</span>}
    </div>
  );
}

/** Commits on blur or Enter; puts back what it can't read, as the sketch's own length boxes do. */
export function FeetInput({
  id,
  label,
  value,
  onCommit,
  readOnly = false,
  allowZero = false,
  nullable = false,
  placeholder,
}: {
  id?: string;
  label: string;
  value: number | null;
  onCommit: (feet: number | null) => void;
  readOnly?: boolean;
  allowZero?: boolean;
  nullable?: boolean;
  placeholder?: string;
}) {
  const shown = value == null ? "" : formatFeetInches(value);
  return (
    <input
      id={id}
      className="exterior-feet"
      type="text"
      inputMode="text"
      autoComplete="off"
      aria-label={id ? undefined : label}
      key={`${label}-${value ?? "none"}`}
      defaultValue={shown}
      placeholder={placeholder}
      disabled={readOnly}
      onInput={(e) => {
        e.currentTarget.dataset.typed = "1";
      }}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const typed = e.target.dataset.typed === "1";
        delete e.target.dataset.typed;
        // Only what was typed is committed: the box shows a length to the inch, and passing through it must not round a
        // length the phone measured, or the drawing gave, into one typed. The same length typed again does count: it says so.
        if (!typed && raw === shown) return;
        if (raw === "") {
          if (nullable && value !== null) onCommit(null);
          else e.target.value = shown;
          return;
        }
        const feet = parseFeetInches(raw);
        if (feet == null || feet < 0 || (!allowZero && feet === 0)) {
          e.target.value = shown;
          return;
        }
        if (typed || value === null || Math.abs(feet - value) > 1e-9) onCommit(feet);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberField({
  id,
  label,
  value,
  onCommit,
  readOnly = false,
  placeholder,
  integer = false,
  max,
  note,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  readOnly?: boolean;
  placeholder?: string;
  integer?: boolean;
  max?: number;
  note?: string;
}) {
  const shown = value == null ? "" : String(value);
  return (
    <div className="exterior-field">
      <label className="exterior-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="exterior-feet"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        key={`${id}-${shown}`}
        defaultValue={shown}
        placeholder={placeholder}
        disabled={readOnly}
        onBlur={(e) => {
          const raw = e.target.value.trim().replace(/\/\s*12$/, "");
          if (raw === "") {
            if (value !== null) onCommit(null);
            return;
          }
          let n = Number(raw);
          if (!Number.isFinite(n) || n < 0 || (max !== undefined && n > max)) {
            e.target.value = shown;
            return;
          }
          if (integer) n = Math.round(n);
          if (n !== value) onCommit(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      {note && <span className="field-note">{note}</span>}
    </div>
  );
}
