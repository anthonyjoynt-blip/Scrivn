"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  allSides,
  emptyScope,
  type Exterior,
  type ExteriorQuantities,
  type ExteriorScope,
  type ExteriorSide,
  exteriorQuantities,
  exteriorScopeLines,
  fixtureLine,
  formatOpeningSize,
  formatPitch,
  OPENING_LABEL,
  type SideQuantities,
} from "@/lib/exterior";
import { roofWithoutSides, withSideAfter } from "@/lib/exteriorPlan";
import { isOldTapeNote, scaleFlags, sizesLine } from "@/lib/exteriorScale";
import { newSketchId } from "@/lib/sketch";
import type { SideTrace } from "@/lib/exteriorTrace";
import { lf, sf } from "./exteriorFields";
import { ExteriorStart, PlanPane } from "./ExteriorPlan";
import { SidePane } from "./ExteriorSide";
import type { PhotoOpacity } from "./SidePhotos";

/**
 * The outside of the house (2026-10-12) - see `lib/exterior.ts` for the model and why it is not a
 * level of rooms.
 *
 * Reworked 2026-10-13 after the owner's first try: "I don't understand how to use it". One strip
 * across the top - the plan, then every side in order round the house - and nothing behind it:
 *
 *   * PLAN & ROOF (ExteriorPlan.tsx): empty, the plan to draw the outline on, corner by corner, or
 *     the front's length to go round side by side; closed, the roof over it straight away, its ends
 *     switched and its porches put on with taps, and the lengths round the house typed beside it.
 *   * A SIDE (ExteriorSide.tsx): face-on, to scale. Windows and doors put on with a tap, dragged or
 *     typed; the eave, parging, peak and length dragged or typed; ‹ › or a swipe to the next side.
 *
 * The quantities and what the scope prices sit under both, and follow every change.
 */

export type ExteriorUpdate = (update: (prev: Exterior | undefined) => Exterior | undefined) => void;

export function ExteriorEditor({
  exterior,
  onChange,
  readOnly,
  onShow3d,
}: {
  exterior: Exterior | undefined;
  onChange: ExteriorUpdate;
  readOnly: boolean;
  /** Opens the house in 3D, where the header has no room for it (a phone). */
  onShow3d?: () => void;
}) {
  /** "plan", or the id of the side open face-on. */
  const [view, setView] = useState<string>("plan");
  /** Each side's AI trace until it is used or set aside, and how the photos are shown: kept here so a side visited again finds them. */
  const [traces, setTraces] = useState<Record<string, SideTrace>>({});
  const [photoOpacity, setPhotoOpacity] = useState<PhotoOpacity>("full");
  const q = useMemo(() => (exterior ? exteriorQuantities(exterior) : null), [exterior]);
  const root = useRef<HTMLDivElement | null>(null);

  // A side opened from further down the plan opens at its top: the drawing is what was asked for.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (el.scrollHeight > el.clientHeight && el.scrollTop > 0) el.scrollTop = 0;
    const top = el.getBoundingClientRect().top;
    if (top < 0) window.scrollBy({ top: top - 8 });
  }, [view]);

  if (!exterior || !q) {
    return (
      <div className="exterior" ref={root}>
        <ExteriorStart
          readOnly={readOnly}
          onStart={(next) => {
            onChange(() => next);
            setView("plan");
          }}
        />
      </div>
    );
  }

  // The side open face-on: one of the main floor's, or of a two-storey house's upper floor's.
  const upperSides = exterior.upper?.sides ?? [];
  const mainIndex = exterior.sides.findIndex((s) => s.id === view);
  const upperIndex = upperSides.findIndex((s) => s.id === view);
  const onUpper = mainIndex < 0 && upperIndex >= 0;
  const index = onUpper ? upperIndex : mainIndex;
  const current = mainIndex >= 0 ? (exterior.sides[mainIndex] as ExteriorSide) : onUpper ? (upperSides[upperIndex] as ExteriorSide) : null;
  const loop = onUpper ? { sides: upperSides, footprint: q.upperFootprint, upper: true } : { sides: exterior.sides, footprint: q.footprint, upper: false };
  const qIndex = onUpper ? exterior.sides.length + upperIndex : mainIndex;

  /** A change to what was measured: from here on a scanned exterior is the estimator's (`exteriorReplaceable`). */
  const measured = (next: Exterior): Exterior => (next.source && !next.source.edited ? { ...next, source: { ...next.source, edited: true } } : next);
  const change = (f: (e: Exterior) => Exterior) => onChange((prev) => (prev ? measured(f(prev)) : prev));
  const updateSide = (id: string, f: (side: ExteriorSide) => ExteriorSide) =>
    change((prev) => ({
      ...prev,
      sides: prev.sides.map((s) => (s.id === id ? f(s) : s)),
      ...(prev.upper ? { upper: { ...prev.upper, sides: prev.upper.sides.map((s) => (s.id === id ? f(s) : s)) } } : {}),
    }));

  function removeSide(id: string) {
    const list = loop.sides;
    const at = list.findIndex((s) => s.id === id);
    change((prev) => ({
      ...prev,
      sides: prev.sides.filter((s) => s.id !== id),
      ...(prev.upper ? { upper: { ...prev.upper, sides: prev.upper.sides.filter((s) => s.id !== id) } } : {}),
      roof: roofWithoutSides(prev.roof, (x) => x === id),
      ...(prev.scope ? { scope: { ...prev.scope, sides: prev.scope.sides.filter((s) => s !== id) } } : {}),
    }));
    const next = list[Math.max(0, at - 1)];
    setView(next && next.id !== id ? next.id : "plan");
  }

  return (
    <div className="exterior" ref={root}>
      <div className="exterior-strip">
        <div className="option-group exterior-strip-tabs" role="group" aria-label="The plan, and each side of the house in order round it">
          <button type="button" className={`option-btn${current === null ? " selected" : ""}`} aria-pressed={current === null} onClick={() => setView("plan")}>
            Plan &amp; roof
          </button>
          {allSides(exterior).map((s) => (
            <button key={s.id} type="button" className={`option-btn${view === s.id ? " selected" : ""}`} aria-pressed={view === s.id} onClick={() => setView(s.id)}>
              {s.name.trim() || "Side"}
            </button>
          ))}
        </div>
        {onShow3d && (
          <button type="button" className="btn-secondary" onClick={onShow3d} title="See the outside of the house in 3D">
            3D view
          </button>
        )}
      </div>

      {exterior.source && (
        <p className="field-note exterior-source">
          Measured with Scrivn Scan{exterior.source.edited ? ", and changed here since" : ""}. {exterior.source.notes.filter((n) => !isOldTapeNote(n)).join(" ")} {sizesLine(exterior)}
        </p>
      )}
      {/* Two of the sizes' references more than 3% apart (2026-10-15): said wherever the house is, the detail on the plan. */}
      {exterior.source && scaleFlags(exterior).length > 0 && (
        <p className="exterior-assumed">
          {scaleFlags(exterior).length === 1 ? "Two" : "Some"} of the things the sizes can be taken from are more than 3% apart: see Sizes, on Plan &amp; roof.
        </p>
      )}

      {current ? (
        <SidePane
          key={current.id}
          exterior={exterior}
          side={current}
          index={index}
          qIndex={qIndex}
          loop={loop}
          q={q}
          readOnly={readOnly}
          onUpdate={(f) => updateSide(current.id, f)}
          onChange={change}
          onRemove={() => removeSide(current.id)}
          onInsertAfter={() => {
            const id = newSketchId("side");
            change((prev) => {
              if (!onUpper || !prev.upper) return withSideAfter(prev, current.id, id);
              // On the upper floor's own outline.
              const done = withSideAfter({ sides: prev.upper.sides, roof: prev.roof }, current.id, id);
              return { ...prev, upper: { ...prev.upper, sides: done.sides } };
            });
            setView(id);
          }}
          onGo={setView}
          photoOpacity={photoOpacity}
          onPhotoOpacity={setPhotoOpacity}
          trace={traces[current.id]}
          onTrace={(t) =>
            setTraces((prev) => {
              const next = { ...prev };
              if (t) next[current.id] = t;
              else delete next[current.id];
              return next;
            })
          }
        />
      ) : (
        <PlanPane exterior={exterior} q={q} readOnly={readOnly} onChange={change} onOpenSide={setView} onRemoveAll={() => onChange(() => undefined)} />
      )}

      <ExteriorTotals exterior={exterior} q={q} />
      <ExteriorScopePicker
        exterior={exterior}
        q={q}
        readOnly={readOnly}
        onChange={(f) => onChange((prev) => (prev ? { ...prev, scope: f(prev.scope ?? emptyScope()) } : prev))}
      />
    </div>
  );
}

/**
 * What of the outside the scope prices. Off until ticked: an exterior measured for a water claim is
 * a record of the house, and a roof nobody decided to replace must not arrive on the scope as one.
 * A ticked part with questions unanswered says which, beside the tick: an unanswered question is
 * never read as a no.
 */
function ExteriorScopePicker({
  exterior,
  q,
  readOnly,
  onChange,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  readOnly: boolean;
  onChange: (f: (scope: ExteriorScope) => ExteriorScope) => void;
}) {
  const scope = exterior.scope ?? emptyScope();
  const lines = exteriorScopeLines(exterior);
  const all = [...lines.roofing, ...lines.siding];
  const noRoof = q.roofing === null;
  const ask = q.roofing?.toAnswer;
  const tick = (label: string, checked: boolean, disabled: boolean, flip: () => void, key: string, questions: string[] = []) => (
    <div key={key} className="exterior-tick-row">
      <label className="exterior-tick">
        <input type="checkbox" checked={checked} disabled={readOnly || disabled} onChange={flip} />
        <span>{label}</span>
      </label>
      {checked && questions.length > 0 && <span className="exterior-to-answer">Still to answer: {questions.join("; ")}.</span>}
    </div>
  );
  return (
    <div className="sketch-quantities exterior-totals">
      <h3>In the scope</h3>
      <p className="field-note">
        Measuring the outside is not deciding to replace it. Tick what the scope should price: each tick puts its lines, with these quantities, on the scope document under Exterior, and on
        the Roofing or Siding work order. The roof plan and the elevations go with the scope document.
      </p>
      <div className="exterior-ticks">
        {tick("Roofing", scope.roofing, noRoof, () => onChange((s) => ({ ...s, roofing: !s.roofing })), "roofing", ask?.roofing)}
        {allSides(exterior).map((side, i) =>
          tick(
            `${side.name.trim() || "Side"} cladding`,
            scope.sides.includes(side.id),
            !(q.sides[i] as SideQuantities).complete,
            () => onChange((s) => ({ ...s, sides: s.sides.includes(side.id) ? s.sides.filter((x) => x !== side.id) : [...s.sides, side.id] })),
            side.id,
          ),
        )}
        {tick("Soffit & fascia", scope.soffitFascia, noRoof, () => onChange((s) => ({ ...s, soffitFascia: !s.soffitFascia })), "soffit", ask?.soffitFascia)}
        {tick("Eavestrough & downspouts", scope.eavestrough, noRoof, () => onChange((s) => ({ ...s, eavestrough: !s.eavestrough })), "trough", ask?.eavestrough)}
      </div>
      {noRoof && <p className="field-note">Roofing, soffit, fascia and eavestrough need the roof: the outline closed round the house, or its totals typed on the plan.</p>}
      {all.length > 0 && <pre className="document-text exterior-lines">{all.map((l) => `- ${l}`).join("\n")}</pre>}
    </div>
  );
}

function ExteriorTotals({ exterior, q }: { exterior: Exterior; q: ExteriorQuantities }) {
  const incomplete = q.sides.filter((s) => !s.complete);
  const r = q.roofing;
  const fixtures = allSides(exterior).flatMap((side) => (side.fixtures ?? []).filter((f) => f.count > 0).map((f) => `${fixtureLine(f)} (${side.name.trim() || "Side"}) × ${f.count}`));
  // Only the roof's totals typed: no sides, so nothing of the walls to count.
  const walls = exterior.sides.length > 0;
  return (
    <div className="sketch-quantities exterior-totals">
      <h3>Exterior quantities</h3>
      {incomplete.length > 0 && <p className="field-note">Not counted until an eave is put in: {incomplete.map((s) => s.name || "Side").join(", ")}.</p>}
      {walls && (
        <div className="sketch-qty-scroll">
          <table className="sketch-qty-table">
            <thead>
              <tr>
                <th scope="col">Cladding</th>
                <th scope="col">Gross</th>
                <th scope="col">Openings</th>
                <th scope="col">Net</th>
              </tr>
            </thead>
            <tbody>
              {q.cladding.map((c) => (
                <tr key={c.key}>
                  <th scope="row">{c.label}</th>
                  <td>{sf(c.grossSquareFeet)}</td>
                  <td>{sf(c.openingSquareFeet)}</td>
                  <td>{sf(c.netSquareFeet)}</td>
                </tr>
              ))}
              {q.cladding.length > 1 && (
                <tr>
                  <th scope="row">All cladding</th>
                  <td>{sf(q.totals.grossSquareFeet)}</td>
                  <td>{sf(q.totals.openingSquareFeet)}</td>
                  <td>{sf(q.totals.netSquareFeet)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <table className="sketch-qty-table exterior-table">
        <tbody>
          {walls && (
            <>
              <tr>
                <th scope="row">Gables (in the above)</th>
                <td>
                  {sf(q.totals.gableSquareFeet)}
                  {q.pitch.source === "assumed" && q.sides.some((s) => s.gableSource === "roof") ? ", the roof's at its assumed pitch" : ""}
                </td>
              </tr>
              <tr>
                <th scope="row">House wrap (net cladding)</th>
                <td>{sf(q.totals.netSquareFeet)}</td>
              </tr>
              <tr>
                <th scope="row">Openings</th>
                <td>{q.openings.length === 0 ? "none" : q.openings.map((o) => `${o.count} × ${OPENING_LABEL[o.kind].toLowerCase()} ${formatOpeningSize(o.widthFeet, o.heightFeet)}`).join("; ")}</td>
              </tr>
              <tr>
                <th scope="row">Trim round openings</th>
                <td>{lf(q.totals.openingTrimFeet)}</td>
              </tr>
              <tr>
                <th scope="row">Outside corners</th>
                <td>{lf(q.totals.outsideCornerFeet)}</td>
              </tr>
              {q.totals.insideCornerFeet > 0 && (
                <tr>
                  <th scope="row">Inside corners</th>
                  <td>{lf(q.totals.insideCornerFeet)}</td>
                </tr>
              )}
              {fixtures.length > 0 && (
                <tr>
                  <th scope="row">On the walls</th>
                  <td>{fixtures.join("; ")}</td>
                </tr>
              )}
            </>
          )}
          {r && (
            <>
              <tr>
                <th scope="row">Roofing</th>
                <td>
                  {r.squares.toFixed(2)} SQ ({sf(r.areaSquareFeet)} at {r.byPitch.length > 1 ? r.byPitch.map((b) => formatPitch(b.pitch)).join(" and ") : formatPitch(r.pitch)}
                  {r.pitchAssumed ? ", assumed" : r.pitchFromPhotos ? ", from photos" : ""}){r.allSlopes ? "" : `, slopes ${r.slopes.filter((s) => s.selected).map((s) => s.label).join(", ")}`}
                </td>
              </tr>
              <tr>
                <th scope="row">Eavestrough</th>
                <td>
                  {lf(r.gutter.feet)}, {r.gutter.downspouts} downspout{r.gutter.downspouts === 1 ? "" : "s"}
                </td>
              </tr>
              <tr>
                <th scope="row">Soffit / fascia</th>
                <td>
                  {sf(r.soffit.eaveSquareFeet + r.soffit.rakeSquareFeet + q.floorSoffitSquareFeet)} / {lf(r.fasciaFeet)}
                  {q.floorSoffitSquareFeet > 0.05 ? `, ${sf(q.floorSoffitSquareFeet)} of it under the upper floor's overhang` : ""}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <p className="field-note">
        Cladding is net of openings and takes in the gables, measured or from the roof. The roof&rsquo;s area is the plan inside the drip line times the pitch factor, for the slopes being
        roofed; its lines are read off the roof the footprint, overhangs and pitch make, except a total typed on the plan, which replaces the drawing&rsquo;s. Squares are real: waste is
        the estimator&rsquo;s to add.
      </p>
    </div>
  );
}
