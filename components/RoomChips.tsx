"use client";

/**
 * A row of rooms to pick one from — the asbestos form's room picker, shared since 2026-10-14 with
 * the camera and the Photos panel, so a room is named and chosen the same way everywhere in a claim
 * (the labels come from `roomLabels` in lib/photos.ts: the room's name, or "Room 3" by its place).
 *
 * `value` null is an option like any other ("Type the dimensions" on the asbestos form), so the
 * options are passed in whole rather than built from the sketch here.
 */
export interface RoomChipOption<V extends string | null = string | null> {
  value: V;
  label: string;
}

export function RoomChips<V extends string | null>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: RoomChipOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`option-group${className ? ` ${className}` : ""}`} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value === null ? "none" : `room-${o.value}`}
          type="button"
          className={`option-btn${value === o.value ? " selected" : ""}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
