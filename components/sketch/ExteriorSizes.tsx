"use client";

import { useState } from "react";
import { allSides, type Exterior } from "@/lib/exterior";
import { currentRef, type ScaleChoice, type ScaleRef, scaleFlags, scaleOf, scaleRefs, signedPercent, sizesLine, withoutSizeDoor, withScaleFrom } from "@/lib/exteriorScale";
import { parseFeetInches } from "@/lib/sketch";

/**
 * What a scanned house's sizes are from (2026-10-15, lib/exteriorScale.ts), on Plan & roof: the
 * phone's own measure, a tape, or a door of a standard size kept off a side's AI trace. Which one
 * they are from, the references more than 3% apart, a press to take the sizes from another, and a
 * tape typed on one side.
 */

type Change = (f: (exterior: Exterior) => Exterior) => void;

const choiceOf = (r: ScaleRef): ScaleChoice => (r.kind === "door" && r.doorId ? { from: "door", doorId: r.doorId } : r.kind === "tape" ? { from: "tape" } : { from: "phone" });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function ExteriorSizes({ exterior, readOnly, onChange }: { exterior: Exterior; readOnly: boolean; onChange: Change }) {
  const sides = allSides(exterior);
  const [tapeSide, setTapeSide] = useState<string>(sides[0]?.id ?? "");
  const [tapeText, setTapeText] = useState("");
  const scale = scaleOf(exterior);
  if (!scale || sides.length === 0) return null;
  const refs = scaleRefs(exterior);
  const flags = scaleFlags(exterior);
  const now = currentRef(exterior);
  const tapeFeet = parseFeetInches(tapeText);
  const tapeOk = tapeFeet !== null && tapeFeet > 0 && sides.some((s) => s.id === tapeSide);
  return (
    <div className="exterior-rows">
      <h4 className="exterior-subhead">Sizes</h4>
      <p className="field-note">{sizesLine(exterior)}</p>
      {flags.map((f) => (
        <p key={`${f.a.key}|${f.b.key}`} className="exterior-assumed">
          {f.text}
        </p>
      ))}
      <div className="exterior-rows" role="radiogroup" aria-label="What the house's sizes are from">
        {refs.map((r) => (
          <div className="exterior-row" key={r.key}>
            <input
              type="radio"
              name="exterior-sizes-from"
              aria-label={`Sizes from ${r.label}`}
              checked={now?.key === r.key}
              disabled={readOnly}
              onChange={() => onChange((e) => withScaleFrom(e, choiceOf(r)))}
            />
            <span className="exterior-row-label">{capital(r.label)}</span>
            {r.kind !== "phone" && <span className="exterior-row-note">{signedPercent(r.factor - 1)} on the phone&rsquo;s own measure</span>}
            {r.kind === "door" && r.doorId && now?.key !== r.key && !readOnly && (
              <button type="button" className="btn-secondary" onClick={() => onChange((e) => withoutSizeDoor(e, r.doorId as string))}>
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="exterior-row">
          <span className="exterior-row-label">Tape one side</span>
          <select aria-label="The side taped" value={tapeSide} onChange={(e) => setTapeSide(e.target.value)}>
            {sides.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name.trim() || "Side"}
              </option>
            ))}
          </select>
          <input
            className="exterior-feet"
            type="text"
            inputMode="text"
            autoComplete="off"
            aria-label="Its length on the tape"
            placeholder={`e.g. 34'2"`}
            value={tapeText}
            onChange={(e) => setTapeText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tapeOk) {
                e.preventDefault();
                onChange((x) => withScaleFrom(x, { from: "tape", sideId: tapeSide, feet: tapeFeet as number }));
                setTapeText("");
              }
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={!tapeOk}
            onClick={() => {
              onChange((x) => withScaleFrom(x, { from: "tape", sideId: tapeSide, feet: tapeFeet as number }));
              setTapeText("");
            }}
          >
            Scale to it
          </button>
        </div>
      )}
      <p className="field-note">
        Taking the sizes from another scales every length and height of the house to it, once: the sides with their openings and shapes, the photos, the porches and gables on the plan,
        and the overhangs the phone or the photos read. Roof totals and overhangs typed stay as typed. A garage door or a door is kept as a check from a side&rsquo;s AI trace; a tape
        typed here takes the place of the one before.
      </p>
    </div>
  );
}
