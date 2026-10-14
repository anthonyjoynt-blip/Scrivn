"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number typed with a thumb, kept as the text typed until the field is left (2026-10-13).
 *
 * Why not an <input type="number"> bound straight to a number: while a number is half typed, "4.", "-"
 * or "0.0" is not a number, and a controlled field that re-renders from the parsed value rewrites what was
 * typed under the finger ("0.05" becomes "0.05" only if every step along the way was valid). A tech
 * reading a meter types fast and does not look at the field, so the field must never fight them.
 *
 * So this holds the text itself. It reports a number to its parent whenever the text is one (and null when
 * it is empty), takes a comma as a decimal point because phones in Canada offer one, and ignores a key
 * that would make the text something that could never become a number. When the value changes from
 * outside (another visit selected, a reading cleared) and the field is not being typed in, it follows.
 */
export function NumberField({
  value,
  onChange,
  ariaLabel,
  placeholder,
  id,
  allowNegative = false,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
  ariaLabel?: string;
  placeholder?: string;
  id?: string;
  allowNegative?: boolean;
}) {
  const show = (v: number | null) => (v === null ? "" : String(v));
  const [text, setText] = useState(show(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(show(value));
  }, [value]);

  const shape = allowNegative ? /^-?\d*[.,]?\d*$/ : /^\d*[.,]?\d*$/;

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        editing.current = true;
      }}
      onBlur={() => {
        editing.current = false;
        setText(show(value));
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!shape.test(raw)) return;
        setText(raw);
        const trimmed = raw.trim();
        if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === ",") {
          onChange(null);
          return;
        }
        const n = Number(trimmed.replace(",", "."));
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}
