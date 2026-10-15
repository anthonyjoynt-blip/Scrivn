"use client";

import { useState } from "react";
import { type ExteriorRoof, formatPitch, hasTypedTotals, type PitchReading, ROOF_TOTAL_LABEL, type RoofingQuantities, type RoofTotalKey, typedTotal } from "@/lib/exterior";
import { parseFeetInches } from "@/lib/sketch";
import { formatQuantity } from "@/lib/sketchQuantities";
import { NumberField } from "./exteriorFields";

/**
 * "Enter roof totals yourself" (2026-10-14): any roof can be scoped, whatever the drawing can make
 * of it. The estimator types what a roof report says, or what was measured by hand - a dormer, a
 * turret, a curved roof - and each total typed replaces the drawing's on the scope, the quantities
 * and the documents, which say where each number came from. A box left blank keeps the drawing's,
 * shown in it, so only what differs needs typing. With no outline drawn, the typed totals are the
 * whole roof. The model is lib/exterior.ts (`ExteriorRoof.typed`).
 */

type Update = (f: (roof: ExteriorRoof) => ExteriorRoof) => void;

/** The lengths, in the order a roof report lists them. */
const LENGTHS: RoofTotalKey[] = ["ridge", "hip", "valley", "eave", "rake", "step", "headwall", "dripEdge", "starter", "iceWater"];
/** What a total that follows others is made of, while it is left blank. */
const MADE_OF: Partial<Record<RoofTotalKey, string>> = { dripEdge: "eaves + rakes", starter: "eaves", iceWater: "eaves + valleys" };
/** Where each length is in the quantities, typed or not. */
const FEET_OF: Record<Exclude<RoofTotalKey, "squareFeet">, (r: RoofingQuantities) => number> = {
  ridge: (r) => r.ridgeFeet,
  hip: (r) => r.hipFeet,
  valley: (r) => r.valleyFeet,
  eave: (r) => r.eaveFeet,
  rake: (r) => r.rakeFeet,
  step: (r) => r.stepFeet,
  headwall: (r) => r.headwallFeet,
  dripEdge: (r) => r.dripEdgeFeet,
  starter: (r) => r.starterFeet,
  iceWater: (r) => r.iceWaterFeet,
};

const parseNumber = (raw: string): number | null => {
  const n = Number(raw.replace(/,/g, "").replace(/\s*(sq|squares?|sf|ft|lf)\.?$/i, ""));
  return Number.isFinite(n) ? n : null;
};
/** Decimal feet as a report gives them, or feet and inches as a tape does: 45.3, 45'3". */
const parseLength = (raw: string): number | null => parseFeetInches(raw.replace(/\s*lf\.?$/i, "")) ?? parseNumber(raw);

/** A total's box: blank to take the drawing's, which it shows. */
function TotalBox({
  id,
  label,
  unit,
  value,
  placeholder,
  note,
  readOnly,
  parse,
  onCommit,
}: {
  id: string;
  label: string;
  unit: string;
  value: number | null;
  placeholder: string;
  note?: string;
  readOnly: boolean;
  parse: (raw: string) => number | null;
  onCommit: (v: number | null) => void;
}) {
  const shown = value == null ? "" : String(unit === "SQ" ? Math.round(value * 100) / 100 : Math.round(value * 10) / 10);
  return (
    <div className="exterior-field">
      <label className="exterior-field-label" htmlFor={id}>
        {label} <span className="roof-total-unit">{unit}</span>
      </label>
      <input
        id={id}
        className={`exterior-feet${value != null ? " roof-total-typed" : ""}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        key={`${id}-${shown}`}
        defaultValue={shown}
        placeholder={placeholder}
        disabled={readOnly}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (raw === "") {
            if (value !== null) onCommit(null);
            return;
          }
          const v = parse(raw);
          if (v === null || v < 0) {
            e.target.value = shown;
            return;
          }
          if (value === null || Math.abs(v - value) > 1e-9) onCommit(v);
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

export function RoofTotalsPanel({
  roof,
  r,
  pitch,
  showPitch,
  readOnly,
  onUpdate,
}: {
  roof: ExteriorRoof;
  r: RoofingQuantities | null;
  pitch: PitchReading;
  /** The pitch is typed here only with no roof drawn: with one it is the roof's own, set under The roof. */
  showPitch: boolean;
  readOnly: boolean;
  onUpdate: Update;
}) {
  const typedAny = hasTypedTotals(roof);
  const [open, setOpen] = useState(false);
  const drawing = r?.drawing ?? null;
  const setTotal = (key: RoofTotalKey, v: number | null) =>
    onUpdate((x) => {
      const typed = { ...(x.typed ?? {}) };
      if (v === null) delete typed[key];
      else typed[key] = v;
      return { ...x, typed };
    });

  if (!open && !typedAny && drawing !== null) {
    return (
      <div className="exterior-rows roof-totals">
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Enter roof totals yourself
          </button>
        )}
        <p className="field-note">For a roof the drawing can&rsquo;t make, or the totals off a roof report: each one typed replaces the drawing&rsquo;s, and a box left blank keeps it.</p>
      </div>
    );
  }

  const area = typedTotal(roof, "squareFeet");
  // Blank, a box shows what stands there now: the drawing's, or what a total that follows others adds up to.
  const placeholderOf = (key: Exclude<RoofTotalKey, "squareFeet">): string => {
    if (!r || (!drawing && !MADE_OF[key])) return "";
    const made = MADE_OF[key];
    return `${formatQuantity(FEET_OF[key](r))} ${made ? `(${made})` : "drawn"}`;
  };
  const typedNames = (Object.keys(ROOF_TOTAL_LABEL) as RoofTotalKey[]).filter((k) => typedTotal(roof, k) !== null).map((k) => ROOF_TOTAL_LABEL[k].toLowerCase());

  return (
    <div className="exterior-rows roof-totals">
      <h4 className="exterior-subhead">Roof totals typed by you</h4>
      <p className="field-note">
        {drawing
          ? "Each total typed replaces the drawing's on the scope and the documents, which say it came from you. A box left blank keeps the drawing's, shown in grey."
          : "No outline is drawn, so these totals are the roof. Type what the roof report says, or what you measured: a box left blank is not counted."}
      </p>
      <div className="exterior-grid">
        <TotalBox
          id="roof-total-squares"
          label="Squares"
          unit="SQ"
          value={area === null ? null : area / 100}
          placeholder={drawing ? `${(drawing.squareFeet / 100).toFixed(2)} drawn` : ""}
          readOnly={readOnly}
          parse={parseNumber}
          onCommit={(v) => setTotal("squareFeet", v === null ? null : v * 100)}
        />
        <TotalBox
          id="roof-total-sf"
          label="or area"
          unit="SF"
          value={area}
          placeholder={drawing ? `${formatQuantity(drawing.squareFeet)} drawn` : ""}
          note="On the slope, no waste."
          readOnly={readOnly}
          parse={parseNumber}
          onCommit={(v) => setTotal("squareFeet", v)}
        />
        {showPitch && (
          <NumberField
            id="roof-total-pitch"
            label="Pitch (rise in 12)"
            value={roof.pitch}
            placeholder={pitch.source !== "typed" && pitch.value !== null ? `${Math.round(pitch.value * 100) / 100}${pitch.source === "assumed" ? " assumed" : ""}` : ""}
            readOnly={readOnly}
            max={24}
            onCommit={(v) => onUpdate((x) => ({ ...x, pitch: v }))}
            note={roof.pitch === null && pitch.source === "assumed" ? `Blank: ${formatPitch(pitch.value ?? 0)} is assumed, and asked for.` : "For the steep charge and the scope line."}
          />
        )}
        {LENGTHS.map((key) => (
          <TotalBox
            key={key}
            id={`roof-total-${key}`}
            label={ROOF_TOTAL_LABEL[key]}
            unit="LF"
            value={typedTotal(roof, key)}
            placeholder={key === "squareFeet" ? "" : placeholderOf(key)}
            readOnly={readOnly}
            parse={parseLength}
            onCommit={(v) => setTotal(key, v)}
          />
        ))}
      </div>
      <p className="field-note">
        {typedNames.length > 0 ? `Typed: ${typedNames.join(", ")}.${drawing ? " The rest are the drawing's." : ""}` : drawing ? "Nothing typed yet: every total is the drawing's." : "Nothing typed yet."}
        {r && drawing && r.typed && !r.allEdges ? " The eavestrough, soffit and fascia follow the eaves and rakes picked on the plan." : ""}
      </p>
      {!readOnly && (typedAny || drawing) && (
        <div className="exterior-row">
          {typedAny && (
            <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, typed: {} }))}>
              Clear what is typed
            </button>
          )}
          {drawing && !typedAny && (
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
