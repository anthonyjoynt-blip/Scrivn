"use client";

import type { ReactNode } from "react";
import type { ExteriorRoof } from "@/lib/exterior";
import type { RoofPlan } from "@/lib/roof";
import { checkRows, type RoofProposal, type WingDrop, withNotchAnswer, withRoofChecked, withWingAnswer, withWingDrop } from "@/lib/roofCheck";
import { formatFeetInches } from "@/lib/sketch";
import { Choice, FeetField, listOf } from "./exteriorFields";

/**
 * The roof check (2026-10-16, lib/roofCheck.ts): beside the roof as drawn, each part the outline and
 * the photos can't settle - a corner the roof may carry over, a part that may sit lower - with what was
 * proposed already pressed, and the ends as they stand. The estimator presses only what the picture
 * shows wrong; nothing waits on it.
 */

/**
 * The parts' rows: the notches the roof may carry over and, on a main roof with wings, each wing. On the check
 * [decksOnly]: only the corners a deck or porch could be.
 */
export function RoofParts({
  plan,
  roof,
  proposal,
  readOnly,
  nameOf,
  decksOnly = false,
  drops = {},
  onUpdate,
}: {
  plan: RoofPlan;
  roof: ExteriorRoof;
  proposal: RoofProposal | null;
  readOnly: boolean;
  nameOf: (id: string) => string;
  decksOnly?: boolean;
  /** Each lower roof's eave under the eave of the roof it meets (lib/roofCheck.ts `wingDrops`). */
  drops?: Record<string, WingDrop>;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const rows = checkRows(plan, roof, proposal, nameOf, decksOnly, drops);
  const wings = plan.shape === "wings" ? rows.wings : [];
  if (rows.notches.length === 0 && wings.length === 0) return null;
  return (
    <div className="exterior-rows">
      {rows.notches.length > 0 && <span className="exterior-row-label">Corners the roof may carry over (a covered deck or porch)</span>}
      {rows.notches.map((row) => (
        <Choice
          key={row.key}
          label={row.label}
          hint={row.proposed ? `Proposed. ${row.proposed}` : undefined}
          value={row.value}
          readOnly={readOnly}
          options={row.options}
          onChange={(v) => onUpdate((r) => withNotchAnswer(r, plan, row.notch, v))}
        />
      ))}
      {wings.length > 0 && <span className="exterior-row-label">Parts of the roof</span>}
      {wings.map((row) => (
        <div key={row.key} className="exterior-rows">
          <Choice
            label={row.label}
            hint={row.fixed ?? (row.proposed ? `Proposed. ${row.proposed}` : undefined)}
            value={row.value}
            readOnly={readOnly || row.fixed !== null}
            options={row.options}
            onChange={(v) => onUpdate((r) => withWingAnswer(r, plan, row.sideId, v))}
          />
          {row.drop && (
            // How much lower: one level for the house's roofs, what the 3D view and the elevations draw it at.
            <FeetField
              id={`drop-${row.sideId}`}
              label="Its eave under the other roof's"
              value={row.drop.source === "typed" ? row.drop.feet : null}
              placeholder={row.drop.source === "typed" ? "" : `${formatFeetInches(row.drop.feet)} ${row.drop.source === "walls" ? "where the walls meet" : "assumed"}`}
              readOnly={readOnly}
              allowZero
              nullable
              note={row.drop.source === "assumed" ? `Nothing measured it: type it, or leave the ${formatFeetInches(row.drop.feet)} it is drawn at.` : undefined}
              onCommit={(v) => onUpdate((r) => withWingDrop(r, row.sideId, v))}
            />
          )}
        </div>
      ))}
      {wings.length > 0 && (
        <p className="field-note">Lower: a roof of its own, stopping at the wall with step flashing and siding between - under the other roof&rsquo;s eave, or under a gable of it (a garage tied in lower).</p>
      )}
    </div>
  );
}

/**
 * The check itself, until the estimator says the roof is right: what to look at, the parts, the ends as
 * they stand, the porches and gables over doors [additions] - and "Looks right".
 */
export function RoofCheckPanel({
  plan,
  roof,
  proposal,
  drops,
  endsFrom,
  readOnly,
  nameOf,
  additions,
  onUpdate,
}: {
  plan: RoofPlan;
  roof: ExteriorRoof;
  proposal: RoofProposal | null;
  drops: Record<string, WingDrop>;
  /** Each end's side, and whether a photo, the estimator or nothing set it. */
  endsFrom: (sideId: string) => "said" | "photo" | "guess";
  readOnly: boolean;
  nameOf: (id: string) => string;
  additions: ReactNode;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const word = (id: string) => `${nameOf(id)} ${plan.ends.find((e) => e.sideId === id)?.kind ?? "gable"}`;
  const fromPhotos = plan.ends.filter((e) => endsFrom(e.sideId) === "photo").map((e) => word(e.sideId));
  const said = plan.ends.filter((e) => endsFrom(e.sideId) === "said").map((e) => word(e.sideId));
  const guessed = plan.ends.filter((e) => endsFrom(e.sideId) === "guess").map((e) => e.sideId);
  return (
    <section className="roof-check" aria-label="Roof check">
      <h4 className="exterior-subhead">Roof check</h4>
      <p className="field-note">The roof as the outline and the photos give it. Look at the plan, and press only what is wrong; the rest is built as it stands.</p>
      <RoofParts plan={plan} roof={roof} proposal={proposal} readOnly={readOnly} nameOf={nameOf} decksOnly drops={drops} onUpdate={onUpdate} />
      {plan.ends.length > 0 && (
        <div className="exterior-rows">
          <span className="exterior-row-label">Ends of the roof</span>
          <p className="field-note">
            {[
              fromPhotos.length > 0 ? `From the photos: ${listOf(fromPhotos)}.` : "",
              said.length > 0 ? `As you set them: ${listOf(said)}.` : "",
              guessed.length > 0 ? `Nothing shows ${listOf(guessed.map(nameOf))}: drawn as ${guessed.length === 1 ? "a gable" : "gables"}.` : "",
              "Tap Gable or Hip on the plan to switch one.",
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        </div>
      )}
      {additions}
      {!readOnly && (
        <div className="exterior-row">
          <button type="button" className="btn-primary" onClick={() => onUpdate((r) => withRoofChecked(r, plan, guessed, new Date().toISOString(), drops))}>
            Looks right
          </button>
          <span className="field-note">Keeps every part as it is now.</span>
        </div>
      )}
    </section>
  );
}
