"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatFeetInches, newSketchId, parseFeetInches } from "@/lib/sketch";
import {
  bandLabel,
  CLADDING_KINDS,
  CLADDING_LABEL,
  type CladdingBand,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  elevationFaces,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorQuantities,
  type ExteriorRoof,
  type ExteriorScope,
  type ExteriorSide,
  emptyScope,
  exteriorQuantities,
  exteriorScopeLines,
  FEET_PER_DOWNSPOUT,
  type Footprint,
  formatOpeningSize,
  formatPitch,
  lShapeExterior,
  newSide,
  OPENING_LABEL,
  rectangleExterior,
  type RoofRise,
  type SideQuantities,
  zFromGrade,
} from "@/lib/exterior";
import type { Pt, RoofLineKind, RoofPlan } from "@/lib/roof";
import { formatQuantity } from "@/lib/sketchQuantities";

/**
 * The outside of the house (2026-10-12) - see `lib/exterior.ts` for the model and why it is not a
 * level of rooms.
 *
 * Laid out the way the owner works round a house: a tab per side, in the order walked, each with its
 * elevation drawn to scale beside what was measured on it, then the roof and footprint the sides
 * make. Everything is typed in feet and inches as read off a tape; nothing is dragged, because the
 * numbers ARE the drawing here - a face drawn by hand and then measured would be measured twice.
 */

export type ExteriorUpdate = (update: (prev: Exterior | undefined) => Exterior | undefined) => void;

const CLADDING_FILL: Record<CladdingKind, string> = {
  stucco: "#efe5cf",
  vinyl: "#d6e5f1",
  wood: "#e4cba2",
  fibre_cement: "#dddcd2",
  brick: "#d9a28c",
  stone: "#cbc5b9",
  metal: "#cfd6de",
  other: "#e4e4e4",
};

const LINE_STYLE: Record<RoofLineKind, { stroke: string; width: number; dash?: string; label: string }> = {
  eave: { stroke: "#1a1d23", width: 2, label: "Eave" },
  rake: { stroke: "#b45309", width: 2.5, label: "Rake" },
  ridge: { stroke: "#b91c1c", width: 3, label: "Ridge" },
  hip: { stroke: "#6d28d9", width: 2.5, label: "Hip" },
  valley: { stroke: "#1d4ed8", width: 2.5, dash: "6 4", label: "Valley" },
};

function sf(value: number): string {
  return `${formatQuantity(value)} SF`;
}
function lf(value: number): string {
  return `${formatQuantity(value)} LF`;
}

export function ExteriorEditor({ exterior, onChange, readOnly }: { exterior: Exterior | undefined; onChange: ExteriorUpdate; readOnly: boolean }) {
  const [view, setView] = useState<string>("roof");
  const q = useMemo(() => (exterior ? exteriorQuantities(exterior) : null), [exterior]);

  if (!exterior || !q) {
    return (
      <div className="exterior">
        <ExteriorStart
          readOnly={readOnly}
          onStart={(next) => {
            onChange(() => next);
            setView(next.sides[0]?.id ?? "roof");
          }}
        />
      </div>
    );
  }

  const index = exterior.sides.findIndex((s) => s.id === view);
  const current = index >= 0 ? (exterior.sides[index] as ExteriorSide) : null;

  /** A change to what was measured: from here on a scanned exterior is the estimator's (`exteriorReplaceable`). */
  const measured = (next: Exterior): Exterior => (next.source && !next.source.edited ? { ...next, source: { ...next.source, edited: true } } : next);
  const updateSide = (id: string, f: (side: ExteriorSide) => ExteriorSide) =>
    onChange((prev) => (prev ? measured({ ...prev, sides: prev.sides.map((s) => (s.id === id ? f(s) : s)) }) : prev));
  const updateRoof = (f: (roof: ExteriorRoof) => ExteriorRoof) => onChange((prev) => (prev ? measured({ ...prev, roof: f(prev.roof) }) : prev));

  function addSide() {
    const last = exterior?.sides[exterior.sides.length - 1];
    const side = newSide(`Side ${(exterior?.sides.length ?? 0) + 1}`, 10, last?.eaveLeftFeet ?? DEFAULT_EAVE_FEET);
    onChange((prev) => (prev ? measured({ ...prev, sides: [...prev.sides, side] }) : prev));
    setView(side.id);
  }

  function removeSide(id: string) {
    const at = exterior?.sides.findIndex((s) => s.id === id) ?? -1;
    onChange((prev) => {
      if (!prev) return prev;
      const ends = { ...prev.roof.ends };
      delete ends[id];
      return measured({
        ...prev,
        sides: prev.sides.filter((s) => s.id !== id),
        roof: { ...prev.roof, ends, ridgeAlong: prev.roof.ridgeAlong === id ? null : prev.roof.ridgeAlong },
        ...(prev.scope ? { scope: { ...prev.scope, sides: prev.scope.sides.filter((s) => s !== id) } } : {}),
      });
    });
    const next = exterior?.sides[Math.max(0, at - 1)];
    setView(next && next.id !== id ? next.id : "roof");
  }

  return (
    <div className="exterior">
      <div className="exterior-tabs">
        <div className="option-group" role="group" aria-label="Sides of the house">
          {exterior.sides.map((s) => (
            <button key={s.id} type="button" className={`option-btn${view === s.id ? " selected" : ""}`} aria-pressed={view === s.id} onClick={() => setView(s.id)}>
              {s.name.trim() || "Side"}
            </button>
          ))}
          <button type="button" className={`option-btn${current === null ? " selected" : ""}`} aria-pressed={current === null} onClick={() => setView("roof")}>
            Roof &amp; footprint
          </button>
        </div>
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={addSide} title="Add the next side round the house">
            + Side
          </button>
        )}
      </div>

      {exterior.source && (
        <p className="field-note exterior-source">
          Measured with Scrivn Scan{exterior.source.edited ? ", and changed here since" : ""}. {exterior.source.notes.join(" ")}
        </p>
      )}

      {current ? (
        <SidePanel
          key={current.id}
          side={current}
          index={index}
          q={q}
          readOnly={readOnly}
          onUpdate={(f) => updateSide(current.id, f)}
          onRemove={() => removeSide(current.id)}
        />
      ) : (
        <RoofPanel exterior={exterior} q={q} readOnly={readOnly} onUpdate={updateRoof} onRemoveAll={() => onChange(() => undefined)} />
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
  const tick = (label: string, checked: boolean, disabled: boolean, flip: () => void, key: string) => (
    <label key={key} className="exterior-tick">
      <input type="checkbox" checked={checked} disabled={readOnly || disabled} onChange={flip} />
      <span>{label}</span>
    </label>
  );
  return (
    <div className="sketch-quantities exterior-totals">
      <h3>In the scope</h3>
      <p className="field-note">
        Measuring the outside is not deciding to replace it. Tick what the scope should price: each tick puts its lines, with these quantities, on the
        scope document under Exterior, and on the Roofing or Siding work order.
      </p>
      <div className="exterior-ticks">
        {tick("Roofing", scope.roofing, noRoof, () => onChange((s) => ({ ...s, roofing: !s.roofing })), "roofing")}
        {exterior.sides.map((side, i) =>
          tick(
            `${side.name.trim() || "Side"} cladding`,
            scope.sides.includes(side.id),
            !(q.sides[i] as SideQuantities).complete,
            () => onChange((s) => ({ ...s, sides: s.sides.includes(side.id) ? s.sides.filter((x) => x !== side.id) : [...s.sides, side.id] })),
            side.id,
          ),
        )}
        {tick("Soffit & fascia", scope.soffitFascia, noRoof, () => onChange((s) => ({ ...s, soffitFascia: !s.soffitFascia })), "soffit")}
        {tick("Eavestrough & downspouts", scope.eavestrough, noRoof, () => onChange((s) => ({ ...s, eavestrough: !s.eavestrough })), "trough")}
      </div>
      {noRoof && <p className="field-note">Roofing, soffit, fascia and eavestrough need the roof: the sides closed round the house and a pitch.</p>}
      {all.length > 0 && <pre className="document-text exterior-lines">{all.map((l) => `- ${l}`).join("\n")}</pre>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------------------------------

function ExteriorStart({ readOnly, onStart }: { readOnly: boolean; onStart: (exterior: Exterior) => void }) {
  const [shape, setShape] = useState<"rectangle" | "L">("rectangle");
  const [width, setWidth] = useState<number | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [notchWidth, setNotchWidth] = useState<number | null>(null);
  const [notchDepth, setNotchDepth] = useState<number | null>(null);
  const [eave, setEave] = useState<number | null>(DEFAULT_EAVE_FEET);

  if (readOnly) {
    return <p className="field-note">No exterior has been measured on this claim. Unlock the sketch to start one.</p>;
  }
  const lValid = width !== null && depth !== null && notchWidth !== null && notchDepth !== null && notchWidth < width && notchDepth < depth;
  const ready = width !== null && depth !== null && eave !== null && (shape === "rectangle" || lValid);

  return (
    <div className="exterior-start">
      <h3>The outside of the house</h3>
      <p className="field-note">
        Each side of the house is an elevation. Start with the outline, then go round side by side, typing in what you measured: the length,
        the eave at each corner, the gable peak, the cladding and the openings. Heights are from the grade under the point. The footprint and
        the roof build from the sides.
      </p>
      <div className="option-group" role="group" aria-label="Shape of the house">
        <button type="button" className={`option-btn${shape === "rectangle" ? " selected" : ""}`} aria-pressed={shape === "rectangle"} onClick={() => setShape("rectangle")}>
          Rectangle
        </button>
        <button type="button" className={`option-btn${shape === "L" ? " selected" : ""}`} aria-pressed={shape === "L"} onClick={() => setShape("L")}>
          L-shape
        </button>
      </div>
      <div className="exterior-grid">
        <FeetField id="ext-start-width" label="Width (the front)" value={width} onCommit={setWidth} />
        <FeetField id="ext-start-depth" label="Depth (the sides)" value={depth} onCommit={setDepth} />
        {shape === "L" && (
          <>
            <FeetField id="ext-start-nw" label="Notch width (rear right)" value={notchWidth} onCommit={setNotchWidth} />
            <FeetField id="ext-start-nd" label="Notch depth" value={notchDepth} onCommit={setNotchDepth} />
          </>
        )}
        <FeetField id="ext-start-eave" label="Eave height (from grade)" value={eave} onCommit={setEave} note="Every side starts at this; change any side after." />
      </div>
      {shape === "L" && width !== null && depth !== null && notchWidth !== null && notchDepth !== null && !lValid && (
        <p className="sketch-length-error">The notch has to be smaller than the house both ways.</p>
      )}
      <button
        type="button"
        className="btn-primary"
        disabled={!ready}
        onClick={() => {
          if (!ready) return;
          onStart(
            shape === "rectangle"
              ? rectangleExterior(width as number, depth as number, eave as number)
              : lShapeExterior(width as number, depth as number, notchWidth as number, notchDepth as number, eave as number),
          );
        }}
      >
        {shape === "rectangle" ? "Start with 4 sides" : "Start with 6 sides"}
      </button>
      <p className="field-note">A Scrivn Scan exterior file comes in through Import scan on the Sketch view.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One side
// ---------------------------------------------------------------------------------------------

function SidePanel({
  side,
  index,
  q,
  readOnly,
  onUpdate,
  onRemove,
}: {
  side: ExteriorSide;
  index: number;
  q: ExteriorQuantities;
  readOnly: boolean;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
  onRemove: () => void;
}) {
  const sq = q.sides[index] as SideQuantities;
  const rise = q.rises[side.id] ?? null;
  const used = q.footprint.closes ? q.footprint.lengthsFeet[index] : undefined;
  const id = (name: string) => `ext-${side.id}-${name}`;
  const fall = side.eaveLeftFeet != null && side.eaveRightFeet != null ? side.eaveRightFeet - side.eaveLeftFeet : 0;
  const roofPeak = rise && rise.length > 0 ? Math.max(...rise.map((r) => r.rise)) : 0;

  return (
    <div className="exterior-pane">
      <figure className="exterior-figure">
        <ElevationDrawing side={side} rise={rise} />
        <figcaption className="field-note">
          {side.name.trim() || "Side"} elevation, to scale, seen from outside.
          {sq.complete ? ` ${sf(sq.netSquareFeet)} of cladding after openings.` : " Put in the eave height to work out its area."}
        </figcaption>
      </figure>

      <div className="exterior-fields">
        <div className="exterior-grid">
          <label className="exterior-field" htmlFor={id("name")}>
            <span className="exterior-field-label">Name</span>
            <input
              id={id("name")}
              type="text"
              key={`${id("name")}-${side.name}`}
              defaultValue={side.name}
              disabled={readOnly}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== side.name) onUpdate((s) => ({ ...s, name }));
                else e.target.value = side.name;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
          <FeetField
            id={id("length")}
            label="Length, corner to corner"
            value={side.lengthFeet}
            readOnly={readOnly}
            onCommit={(v) => v !== null && onUpdate((s) => ({ ...s, lengthFeet: v }))}
            note={used !== undefined && Math.abs(used - side.lengthFeet) > 1 / 96 ? `The footprint uses ${formatFeetInches(used)}: the sides don't quite meet.` : undefined}
          />
          <label className="exterior-field" htmlFor={id("turn")}>
            <span className="exterior-field-label">Corner at its right end</span>
            <select id={id("turn")} value={side.turn} disabled={readOnly} onChange={(e) => onUpdate((s) => ({ ...s, turn: e.target.value === "inside" ? "inside" : "outside" }))}>
              <option value="outside">Outside corner</option>
              <option value="inside">Inside corner (the inside of an L)</option>
            </select>
          </label>
        </div>

        <h4 className="exterior-subhead">Eave</h4>
        <div className="exterior-grid">
          <FeetField id={id("eaveL")} label="At the left corner" value={side.eaveLeftFeet} readOnly={readOnly} nullable onCommit={(v) => onUpdate((s) => ({ ...s, eaveLeftFeet: v, eaveRightFeet: s.eaveRightFeet ?? v }))} />
          <FeetField id={id("eaveR")} label="At the right corner" value={side.eaveRightFeet} readOnly={readOnly} nullable onCommit={(v) => onUpdate((s) => ({ ...s, eaveRightFeet: v, eaveLeftFeet: s.eaveLeftFeet ?? v }))} />
        </div>
        <p className="field-note">
          The soffit line, from the grade at each corner.
          {Math.abs(fall) > 1 / 96 ? ` The eave is level, so the grade ${fall > 0 ? "falls" : "rises"} ${formatFeetInches(Math.abs(fall))} from left to right.` : ""}
        </p>

        <h4 className="exterior-subhead">Cladding starts at</h4>
        <div className="option-group" role="group" aria-label="Base line">
          {(["parging", "grade"] as const).map((base) => (
            <button
              key={base}
              type="button"
              className={`option-btn${side.base === base ? " selected" : ""}`}
              aria-pressed={side.base === base}
              disabled={readOnly}
              onClick={() => onUpdate((s) => ({ ...s, base }))}
            >
              {base === "parging" ? "Top of the parging" : "Grade"}
            </button>
          ))}
        </div>
        {side.base === "parging" && (
          <div className="exterior-grid">
            <FeetField id={id("baseL")} label="Parging at the left corner" value={side.baseLeftFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((s) => ({ ...s, baseLeftFeet: v }))} />
            <FeetField id={id("baseR")} label="At the right corner" value={side.baseRightFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((s) => ({ ...s, baseRightFeet: v }))} />
          </div>
        )}

        <h4 className="exterior-subhead">Gable</h4>
        {side.gable ? (
          <>
            <div className="exterior-grid">
              <FeetField
                id={id("peak")}
                label="Peak, from the grade under it"
                value={side.gable.peakFeet}
                readOnly={readOnly}
                onCommit={(v) => v !== null && onUpdate((s) => (s.gable ? { ...s, gable: { ...s.gable, peakFeet: v } } : s))}
              />
              <FeetField
                id={id("peakAt")}
                label="Peak from the left corner"
                value={side.gable.atFeet}
                readOnly={readOnly}
                allowZero
                onCommit={(v) => v !== null && onUpdate((s) => (s.gable ? { ...s, gable: { ...s.gable, atFeet: v } } : s))}
              />
            </div>
            <p className="field-note">
              {sq.pitchFromGable !== null ? `Gives a pitch of ${formatPitch(sq.pitchFromGable)}: the peak less the eave, over half the span. ` : ""}
              {sq.complete ? `The gable is ${sf(sq.gableSquareFeet)}.` : ""}
            </p>
            {!readOnly && (
              <button type="button" className="btn-secondary" onClick={() => onUpdate((s) => ({ ...s, gable: null }))}>
                No gable on this side
              </button>
            )}
          </>
        ) : (
          <>
            <p className="field-note">
              {roofPeak > 0
                ? `None measured. The roof puts a gable here, ${formatFeetInches(roofPeak)} above the eave at ${formatPitch(q.pitch.value ?? 0)}, and it is counted in the cladding. Measure the peak to use yours instead.`
                : "None: the roof meets this side at its eave."}
            </p>
            {!readOnly && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  onUpdate((s) => ({
                    ...s,
                    gable: { peakFeet: (s.eaveLeftFeet ?? DEFAULT_EAVE_FEET) + Math.max(roofPeak, (s.lengthFeet / 2) * (4 / 12)), atFeet: s.lengthFeet / 2 },
                  }))
                }
              >
                + Measured gable
              </button>
            )}
          </>
        )}

        <h4 className="exterior-subhead">Cladding, bottom up</h4>
        <BandsEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />

        <h4 className="exterior-subhead">Openings</h4>
        <OpeningsEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />

        <SideFigures sq={sq} />

        {!readOnly && (
          <button type="button" className="btn-secondary exterior-remove" onClick={onRemove}>
            Remove this side
          </button>
        )}
      </div>
    </div>
  );
}

function BandsEditor({ side, readOnly, onUpdate }: { side: ExteriorSide; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const setBand = (bandId: string, f: (b: CladdingBand) => CladdingBand) => onUpdate((s) => ({ ...s, bands: s.bands.map((b) => (b.id === bandId ? f(b) : b)) }));
  const bands = side.bands.length > 0 ? side.bands : [{ id: "default", kind: "stucco" as CladdingKind, top: null }];
  return (
    <div className="exterior-rows">
      {bands.map((band, i) => {
        const last = i === bands.length - 1;
        return (
          <div className="exterior-row" key={band.id}>
            <select
              aria-label={`Cladding ${i + 1}`}
              value={band.kind}
              disabled={readOnly}
              onChange={(e) => setBand(band.id, (b) => ({ ...b, kind: e.target.value as CladdingKind }))}
            >
              {CLADDING_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CLADDING_LABEL[kind]}
                </option>
              ))}
            </select>
            {band.kind === "other" && (
              <input
                type="text"
                aria-label="What it is"
                placeholder="What it is"
                key={`${band.id}-${band.label ?? ""}`}
                defaultValue={band.label ?? ""}
                disabled={readOnly}
                onBlur={(e) => setBand(band.id, (b) => ({ ...b, label: e.target.value.trim() || undefined }))}
              />
            )}
            {last ? (
              <span className="exterior-row-note">to the top{side.gable || bands.length === 1 ? ", gable included" : ""}</span>
            ) : (
              <>
                <select
                  aria-label="Up to"
                  value={band.top === "eave" ? "eave" : "height"}
                  disabled={readOnly}
                  onChange={(e) => setBand(band.id, (b) => ({ ...b, top: e.target.value === "eave" ? "eave" : typeof b.top === "number" ? b.top : 3 }))}
                >
                  <option value="height">up to</option>
                  <option value="eave">up to the eave</option>
                </select>
                {band.top !== "eave" && (
                  <FeetInput
                    label={`Top of ${bandLabel(band)}, from the grade at the left corner`}
                    value={typeof band.top === "number" ? band.top : null}
                    readOnly={readOnly}
                    onCommit={(v) => v !== null && setBand(band.id, (b) => ({ ...b, top: v }))}
                  />
                )}
              </>
            )}
            {!readOnly && bands.length > 1 && (
              <button type="button" className="btn-secondary exterior-row-x" aria-label={`Remove ${bandLabel(band)}`} onClick={() => onUpdate((s) => ({ ...s, bands: s.bands.filter((b) => b.id !== band.id) }))}>
                ×
              </button>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            onUpdate((s) => {
              const current = s.bands.length > 0 ? s.bands : bands;
              const below = current.slice(0, -1);
              const prevTop = below.length > 0 ? below[below.length - 1]?.top : null;
              const top = typeof prevTop === "number" ? prevTop + 3 : 3;
              return { ...s, bands: [...below, { id: newSketchId("band"), kind: "stone", top }, current[current.length - 1] as CladdingBand] };
            })
          }
        >
          + Band below
        </button>
      )}
      <p className="field-note">A band&rsquo;s top is from the grade at the left corner: a band line is level, so one height places it.</p>
    </div>
  );
}

function OpeningsEditor({ side, readOnly, onUpdate }: { side: ExteriorSide; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const setOpening = (openingId: string, f: (o: ExteriorOpening) => ExteriorOpening) =>
    onUpdate((s) => ({ ...s, openings: s.openings.map((o) => (o.id === openingId ? f(o) : o)) }));
  function add(kind: ExteriorOpeningKind) {
    onUpdate((s) => {
      const size = kind === "window" ? { w: 3, h: 4, sill: 3 } : kind === "door" ? { w: 3, h: 6 + 8 / 12, sill: s.base === "parging" ? s.baseLeftFeet : 0 } : { w: 16, h: 7, sill: 0 };
      const after = s.openings.reduce((x, o) => Math.max(x, o.fromLeftFeet + o.widthFeet), 0);
      const from = after + 2 + size.w <= s.lengthFeet ? after + 2 : Math.max(0, (s.lengthFeet - size.w) / 2);
      return { ...s, openings: [...s.openings, { id: newSketchId("opening"), kind, widthFeet: size.w, heightFeet: size.h, sillFeet: size.sill, fromLeftFeet: from }] };
    });
  }
  return (
    <div className="exterior-rows">
      {side.openings.length > 0 && (
        <div className="exterior-openings">
          <span className="exterior-th">Kind</span>
          <span className="exterior-th">Width</span>
          <span className="exterior-th">Height</span>
          <span className="exterior-th" title="From the grade under it">Sill</span>
          <span className="exterior-th">From left</span>
          <span />
          {side.openings.map((o, i) => (
            <OpeningRow key={o.id} o={o} n={i + 1} readOnly={readOnly} onSet={(f) => setOpening(o.id, f)} onRemove={() => onUpdate((s) => ({ ...s, openings: s.openings.filter((x) => x.id !== o.id) }))} />
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="exterior-row">
          <button type="button" className="btn-secondary" onClick={() => add("window")}>
            + Window
          </button>
          <button type="button" className="btn-secondary" onClick={() => add("door")}>
            + Door
          </button>
          <button type="button" className="btn-secondary" onClick={() => add("garage")}>
            + Garage door
          </button>
        </div>
      )}
      <p className="field-note">The opening in the cladding, as taped. Sill is from the grade under it; from left is to its left edge.</p>
    </div>
  );
}

function OpeningRow({ o, n, readOnly, onSet, onRemove }: { o: ExteriorOpening; n: number; readOnly: boolean; onSet: (f: (o: ExteriorOpening) => ExteriorOpening) => void; onRemove: () => void }) {
  const name = `${OPENING_LABEL[o.kind]} ${n}`;
  return (
    <>
      <select aria-label={`${name}: kind`} value={o.kind} disabled={readOnly} onChange={(e) => onSet((x) => ({ ...x, kind: e.target.value as ExteriorOpeningKind }))}>
        {(Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((k) => (
          <option key={k} value={k}>
            {OPENING_LABEL[k]}
          </option>
        ))}
      </select>
      <FeetInput label={`${name}: width`} value={o.widthFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, widthFeet: v }))} />
      <FeetInput label={`${name}: height`} value={o.heightFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, heightFeet: v }))} />
      <FeetInput label={`${name}: sill from grade`} value={o.sillFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, sillFeet: v }))} />
      <FeetInput label={`${name}: from the left corner`} value={o.fromLeftFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, fromLeftFeet: v }))} />
      {readOnly ? (
        <span />
      ) : (
        <button type="button" className="btn-secondary exterior-row-x" aria-label={`Remove ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </>
  );
}

function SideFigures({ sq }: { sq: SideQuantities }) {
  if (!sq.complete) return null;
  return (
    <table className="sketch-qty-table exterior-table">
      <thead>
        <tr>
          <th scope="col">This side</th>
          <th scope="col">Gross</th>
          <th scope="col">Openings</th>
          <th scope="col">Net</th>
        </tr>
      </thead>
      <tbody>
        {sq.bands.map((b) => (
          <tr key={b.bandId}>
            <th scope="row">{b.label}</th>
            <td>{sf(b.grossSquareFeet)}</td>
            <td>{sf(b.openingSquareFeet)}</td>
            <td>{sf(b.netSquareFeet)}</td>
          </tr>
        ))}
        <tr>
          <th scope="row">Of which gable</th>
          <td>{sf(sq.gableSquareFeet)}</td>
          <td />
          <td />
        </tr>
        <tr>
          <th scope="row">Trim round openings</th>
          <td>{lf(sq.openingTrimFeet)}</td>
          <td />
          <td />
        </tr>
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------------------------
// The roof and footprint
// ---------------------------------------------------------------------------------------------

function RoofPanel({
  exterior,
  q,
  readOnly,
  onUpdate,
  onRemoveAll,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  readOnly: boolean;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
  onRemoveAll: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const roof = exterior.roof;
  const plan = q.roof;
  const nameOf = (id: string) => exterior.sides.find((s) => s.id === id)?.name.trim() || "Side";
  const fp = q.footprint;

  return (
    <div className="exterior-pane">
      <figure className="exterior-figure">
        {plan && fp.closes ? (
          <>
            <RoofPlanDrawing plan={plan} footprint={fp} nameOf={nameOf} />
            <RoofLegend plan={plan} />
          </>
        ) : (
          <div className="exterior-empty">
            <p>{!fp.closes ? fp.reason : "Type the pitch, or measure a gable peak on a side, to build the roof."}</p>
          </div>
        )}
        <figcaption className="field-note">
          {fp.closes
            ? `Roof plan, to scale, front at the bottom. Footprint ${formatQuantity(fp.areaSquareFeet)} SF, ${lf(fp.perimeterFeet)} round.` +
              (fp.misclosureFeet > 1 / 96 ? ` The sides as typed missed meeting by ${formatFeetInches(fp.misclosureFeet)}; that is shared out over them by length.` : "")
            : "The footprint is the sides joined, each corner square."}
        </figcaption>
        {plan?.note && <p className="field-note">{plan.note}</p>}
      </figure>

      <div className="exterior-fields">
        <div className="exterior-grid">
          <NumberField
            id="ext-pitch"
            label="Pitch (rise in 12)"
            value={roof.pitch}
            placeholder={q.pitch.source === "sides" && q.pitch.value !== null ? (Math.round(q.pitch.value * 100) / 100).toString() : ""}
            readOnly={readOnly}
            max={24}
            onCommit={(v) => onUpdate((r) => ({ ...r, pitch: v }))}
            note={
              q.pitch.fromSides.length > 0
                ? `Measured gables give ${q.pitch.fromSides.map((f) => `${formatPitch(f.pitch)} (${f.name})`).join(", ")}.${roof.pitch === null ? " Left blank, the roof uses that." : ""}`
                : "No gable peak measured yet, so it has to be typed."
            }
          />
          <FeetField id="ext-eave-oh" label="Eave overhang" value={roof.eaveOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((r) => ({ ...r, eaveOverhangFeet: v }))} />
          <FeetField id="ext-rake-oh" label="Rake overhang" value={roof.rakeOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((r) => ({ ...r, rakeOverhangFeet: v }))} />
          <NumberField id="ext-waste" label="Waste %" value={roof.wastePercent} readOnly={readOnly} max={50} onCommit={(v) => onUpdate((r) => ({ ...r, wastePercent: v ?? 0 }))} />
          <NumberField
            id="ext-downspouts"
            label="Downspouts"
            value={roof.downspouts}
            placeholder={q.roofing ? String(q.roofing.downspouts.count) : ""}
            readOnly={readOnly}
            integer
            max={40}
            onCommit={(v) => onUpdate((r) => ({ ...r, downspouts: v }))}
            note={`Blank counts one per ${FEET_PER_DOWNSPOUT} ft of eavestrough, at least one per run.`}
          />
        </div>
        {plan && plan.shape === "rectangle" && (
          <label className="exterior-field" htmlFor="ext-ridge">
            <span className="exterior-field-label">Ridge runs</span>
            <select
              id="ext-ridge"
              value={roof.ridgeAlong ?? ""}
              disabled={readOnly}
              onChange={(e) => onUpdate((r) => ({ ...r, ridgeAlong: e.target.value || null }))}
            >
              <option value="">Along the longer walls</option>
              {exterior.sides.map((s) => (
                <option key={s.id} value={s.id}>
                  Parallel to {s.name.trim() || "Side"}
                </option>
              ))}
            </select>
          </label>
        )}
        {plan && plan.ends.length > 0 && (
          <>
            <h4 className="exterior-subhead">Roof ends</h4>
            {plan.ends.map((end) => (
              <div key={end.sideId} className="exterior-row">
                <span className="exterior-row-label">
                  Over {nameOf(end.sideId)}
                  {end.role === "wing" ? " (wing)" : ""}
                </span>
                <div className="option-group" role="group" aria-label={`End over ${nameOf(end.sideId)}`}>
                  {(["gable", "hip"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={`option-btn${end.kind === kind ? " selected" : ""}`}
                      aria-pressed={end.kind === kind}
                      disabled={readOnly}
                      onClick={() => onUpdate((r) => ({ ...r, ends: { ...r.ends, [end.sideId]: kind } }))}
                    >
                      {kind === "gable" ? "Gable" : "Hip"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
        {q.roofing && <RoofFigures q={q} />}
        {!readOnly &&
          (confirmRemove ? (
            <div className="sketch-undo" role="alert">
              <span>Remove all {exterior.sides.length} sides and the roof?</span>
              <button type="button" className="btn-secondary" onClick={onRemoveAll}>
                Remove
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </div>
          ) : (
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirmRemove(true)}>
              Remove the exterior…
            </button>
          ))}
      </div>
    </div>
  );
}

function RoofFigures({ q }: { q: ExteriorQuantities }) {
  const r = q.roofing;
  if (!r) return null;
  const rows: [string, string][] = [
    ["Pitch", `${formatPitch(r.pitch)} (factor ${r.pitchFactor.toFixed(3)})${r.steep ? `, steep ${r.steep}` : ""}`],
    ["Roof area", sf(r.areaSquareFeet)],
    ["Squares", `${r.squares.toFixed(2)} SQ; ${r.squaresWithWaste.toFixed(2)} SQ with ${formatQuantity(r.wastePercent)}% waste`],
    ["Ridge", lf(r.ridgeFeet)],
    ["Hips", lf(r.hipFeet)],
    ["Valleys", lf(r.valleyFeet)],
    ["Eaves", lf(r.eaveFeet)],
    ["Rakes", lf(r.rakeFeet)],
    ["Drip edge (eaves + rakes)", lf(r.dripEdgeFeet)],
    ["Starter (eaves)", lf(r.starterFeet)],
    ["Ice & water (eaves + valleys)", lf(r.iceWaterFeet)],
  ];
  return (
    <table className="sketch-qty-table exterior-table">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------------------------

function ExteriorTotals({ exterior, q }: { exterior: Exterior; q: ExteriorQuantities }) {
  const incomplete = q.sides.filter((s) => !s.complete);
  const r = q.roofing;
  return (
    <div className="sketch-quantities exterior-totals">
      <h3>Exterior quantities</h3>
      {incomplete.length > 0 && (
        <p className="field-note">Not counted until an eave is put in: {incomplete.map((s) => s.name || "Side").join(", ")}.</p>
      )}
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
      <table className="sketch-qty-table exterior-table">
        <tbody>
          <tr>
            <th scope="row">Gables (in the above)</th>
            <td>{sf(q.totals.gableSquareFeet)}</td>
          </tr>
          <tr>
            <th scope="row">House wrap (net cladding)</th>
            <td>{sf(q.totals.netSquareFeet)}</td>
          </tr>
          <tr>
            <th scope="row">Openings</th>
            <td>
              {q.openings.length === 0
                ? "none"
                : q.openings.map((o) => `${o.count} × ${OPENING_LABEL[o.kind].toLowerCase()} ${formatOpeningSize(o.widthFeet, o.heightFeet)}`).join("; ")}
            </td>
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
          {r && (
            <>
              <tr>
                <th scope="row">Roofing</th>
                <td>
                  {r.squaresWithWaste.toFixed(2)} SQ with {formatQuantity(r.wastePercent)}% waste ({sf(r.areaSquareFeet)} at {formatPitch(r.pitch)})
                </td>
              </tr>
              <tr>
                <th scope="row">Soffit</th>
                <td>{sf(r.soffitSquareFeet)}</td>
              </tr>
              <tr>
                <th scope="row">Fascia (eaves + rakes)</th>
                <td>{lf(r.fasciaFeet)}</td>
              </tr>
              <tr>
                <th scope="row">Eavestrough</th>
                <td>{lf(r.eavestroughFeet)}</td>
              </tr>
              <tr>
                <th scope="row">Downspouts</th>
                <td>
                  {r.downspouts.count}
                  {r.downspouts.feet !== null ? `, ${lf(r.downspouts.feet)} at the eave height` : ""}
                  {r.downspouts.auto ? " (counted)" : ""}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <p className="field-note">
        Cladding is net of openings and takes in the gables, measured or from the roof. The roof&rsquo;s area is the plan inside the drip line times the
        pitch factor; its lines are read off the roof the footprint, overhangs and pitch make.
        {exterior.sides.some((s) => s.gable === null) && q.roof ? " A gable nobody measured is the roof's." : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Drawings
// ---------------------------------------------------------------------------------------------

function ElevationDrawing({ side, rise }: { side: ExteriorSide; rise: RoofRise | null }) {
  const { shape, bands, openings } = elevationFaces(side, rise);
  const L = Math.max(1, shape.lengthFeet);
  const fall = shape.fallFeet;
  const eaveZ = shape.eaveZ;
  const topZ = Math.max(eaveZ ?? DEFAULT_EAVE_FEET, ...shape.top.map((p) => p.y), ...openings.map((o) => o.rect.y1));
  const lowZ = Math.min(0, -fall);
  const fs = Math.max(0.5, Math.max(L, topZ - lowZ) * 0.03);
  const padX = fs * 4.2;
  const groundZ = lowZ - fs * 4;
  const vx = -padX;
  const vw = L + 2 * padX;
  const vy = -(topZ + fs * 2.6);
  const vh = topZ + fs * 2.6 - groundZ;
  const Y = (z: number) => -z;
  const pts = (poly: Pt[]) => poly.map((p) => `${p.x},${Y(p.y)}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const labels: ReactNode[] = [];

  if (eaveZ !== null && side.eaveLeftFeet != null && side.eaveRightFeet != null) {
    labels.push(
      <text key="eL" x={-fs * 0.5} y={Y(eaveZ) + fs * 0.35} fontSize={fs} textAnchor="end" className="exterior-svg-label">
        {formatFeetInches(side.eaveLeftFeet)}
      </text>,
      <text key="eR" x={L + fs * 0.5} y={Y(eaveZ) + fs * 0.35} fontSize={fs} textAnchor="start" className="exterior-svg-label">
        {formatFeetInches(side.eaveRightFeet)}
      </text>,
    );
  }
  if (shape.gable) {
    const p = shape.gable.peak;
    const above = p.y - zFromGrade(side, p.x, 0);
    labels.push(
      <text key="peak" x={p.x} y={Y(p.y) - fs * 0.6} fontSize={fs} textAnchor="middle" className="exterior-svg-label">
        {formatFeetInches(above)}
        {shape.gable.source === "roof" ? " (roof)" : ""}
      </text>,
    );
  }

  const scaleFeet = L >= 30 ? 10 : 5;
  return (
    <svg className="exterior-svg" viewBox={`${vx} ${vy} ${vw} ${vh}`} role="img" aria-label={`${side.name} elevation, to scale`}>
      <rect x={vx} y={vy} width={vw} height={vh} fill="#ffffff" />
      <polygon points={pts([{ x: vx, y: 0 }, { x: 0, y: 0 }, { x: L, y: -fall }, { x: vx + vw, y: -fall }, { x: vx + vw, y: groundZ }, { x: vx, y: groundZ }])} fill="#efe7da" />
      {side.base === "parging" && <polygon points={pts([shape.grade[0], shape.grade[1], shape.bottom[1], shape.bottom[0]])} fill="#c9ccd1" stroke="#8a9099" strokeWidth={1} {...stroke} />}
      {bands.map(({ band, poly }) => poly.length >= 3 && <polygon key={band.id} points={pts(poly)} fill={CLADDING_FILL[band.kind]} />)}
      {bands.slice(0, -1).map(({ band, hi }) =>
        Number.isFinite(hi) && eaveZ !== null && hi > Math.min(shape.bottom[0].y, shape.bottom[1].y) && hi < topZ ? (
          <line key={`line-${band.id}`} x1={0} x2={L} y1={Y(hi)} y2={Y(hi)} stroke="#6b7280" strokeWidth={1} strokeDasharray="5 4" {...stroke} />
        ) : null,
      )}
      {bands.map(({ band, poly }) => {
        if (poly.length < 3) return null;
        const ys = poly.map((p) => p.y);
        const h = Math.max(...ys) - Math.min(...ys);
        if (h < fs * 1.4) return null;
        return (
          <text key={`label-${band.id}`} x={fs * 0.6} y={Y(Math.min(...ys) + Math.min(h / 2, fs * 1.6))} fontSize={fs * 0.85} className="exterior-svg-band">
            {bandLabel(band)}
          </text>
        );
      })}
      {shape.cladding.length >= 3 && (
        <polygon points={pts(shape.cladding)} fill="none" stroke="#374151" strokeWidth={1.5} {...stroke} />
      )}
      {shape.gable?.source === "roof" && eaveZ !== null && (
        <line x1={shape.gable.from} x2={shape.gable.to} y1={Y(eaveZ)} y2={Y(eaveZ)} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" {...stroke} />
      )}
      {openings.map(({ opening, rect }) => (
        <g key={opening.id}>
          <rect x={rect.x0} y={Y(rect.y1)} width={rect.x1 - rect.x0} height={rect.y1 - rect.y0} fill="#ffffff" stroke="#1d4ed8" strokeWidth={1.5} {...stroke} />
          <text x={(rect.x0 + rect.x1) / 2} y={Y(rect.y1) - fs * 0.3} fontSize={fs * 0.75} textAnchor="middle" className="exterior-svg-label">
            {formatOpeningSize(opening.widthFeet, opening.heightFeet)}
          </text>
        </g>
      ))}
      <line x1={vx} x2={0} y1={0} y2={0} stroke="#7c5a3a" strokeWidth={2} {...stroke} />
      <line x1={0} x2={L} y1={Y(0)} y2={Y(-fall)} stroke="#7c5a3a" strokeWidth={2} {...stroke} />
      <line x1={L} x2={vx + vw} y1={Y(-fall)} y2={Y(-fall)} stroke="#7c5a3a" strokeWidth={2} {...stroke} />
      {labels}
      {/* The length, under the grade. */}
      <line x1={0} x2={L} y1={Y(lowZ - fs * 1.4)} y2={Y(lowZ - fs * 1.4)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={0} x2={0} y1={Y(lowZ - fs * 0.9)} y2={Y(lowZ - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={L} x2={L} y1={Y(lowZ - fs * 0.9)} y2={Y(lowZ - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <text x={L / 2} y={Y(lowZ - fs * 2.7)} fontSize={fs} textAnchor="middle" className="exterior-svg-label">
        {formatFeetInches(shape.lengthFeet)}
      </text>
      <line x1={vx + fs} x2={vx + fs + scaleFeet} y1={Y(groundZ + fs * 0.8)} y2={Y(groundZ + fs * 0.8)} stroke="#1a1d23" strokeWidth={2} {...stroke} />
      <text x={vx + fs + scaleFeet / 2} y={Y(groundZ + fs * 1.2)} fontSize={fs * 0.7} textAnchor="middle" className="exterior-svg-label">
        {scaleFeet}&prime;
      </text>
    </svg>
  );
}

function RoofPlanDrawing({ plan, footprint, nameOf }: { plan: RoofPlan; footprint: Footprint; nameOf: (id: string) => string }) {
  const corners = footprint.corners;
  const xs = [...plan.outlineRects.flatMap((r) => [r.x0, r.x1]), ...plan.lines.flatMap((l) => [l.a.x, l.b.x]), ...corners.map((p) => p.x)];
  const ys = [...plan.outlineRects.flatMap((r) => [r.y0, r.y1]), ...plan.lines.flatMap((l) => [l.a.y, l.b.y]), ...corners.map((p) => p.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fs = Math.max(0.6, Math.max(maxX - minX, maxY - minY) * 0.03);
  const pad = fs * 3.4;
  const Y = (y: number) => -y;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const n = corners.length;
  return (
    <svg
      className="exterior-svg"
      viewBox={`${minX - pad} ${Y(maxY) - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
      role="img"
      aria-label="Roof plan, to scale"
    >
      <rect x={minX - pad} y={Y(maxY) - pad} width={maxX - minX + 2 * pad} height={maxY - minY + 2 * pad} fill="#ffffff" />
      {plan.outlineRects.map((r, i) => (
        <rect key={i} x={r.x0} y={Y(r.y1)} width={r.x1 - r.x0} height={r.y1 - r.y0} fill="#eef1f5" />
      ))}
      {plan.shape === "other" && <polygon points={plan.lines.map((l) => `${l.a.x},${Y(l.a.y)}`).join(" ")} fill="#eef1f5" />}
      <polygon points={corners.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" {...stroke} />
      {plan.lines.map((l, i) => {
        const s = LINE_STYLE[l.kind];
        return <line key={i} x1={l.a.x} y1={Y(l.a.y)} x2={l.b.x} y2={Y(l.b.y)} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" {...stroke} />;
      })}
      {plan.lines
        .filter((l) => (l.kind === "ridge" || l.kind === "hip" || l.kind === "valley") && l.feet >= fs * 3)
        .map((l, i) => (
          <text key={`t${i}`} x={(l.a.x + l.b.x) / 2} y={Y((l.a.y + l.b.y) / 2) - fs * 0.35} fontSize={fs * 0.8} textAnchor="middle" className="exterior-svg-label" fill={LINE_STYLE[l.kind].stroke}>
            {formatFeetInches(l.feet)}
          </text>
        ))}
      {footprint.sideIds.map((id, i) => {
        const a = corners[i] as Pt;
        const b = corners[(i + 1) % n] as Pt;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
        const m = { x: (a.x + b.x) / 2 + out.x * pad * 0.62, y: (a.y + b.y) / 2 + out.y * pad * 0.62 };
        // A label runs along its wall, so one down a side wall reads up the page rather than across the roof.
        const across = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
        return (
          <text
            key={id}
            x={m.x}
            y={Y(m.y) + fs * 0.35}
            fontSize={fs * 0.85}
            textAnchor="middle"
            className="exterior-svg-label"
            transform={across ? `rotate(-90 ${m.x} ${Y(m.y)})` : undefined}
          >
            {nameOf(id)} {formatFeetInches(footprint.lengthsFeet[i] ?? len)}
          </text>
        );
      })}
    </svg>
  );
}

function RoofLegend({ plan }: { plan: RoofPlan }) {
  const kinds = (Object.keys(LINE_STYLE) as RoofLineKind[]).filter((k) => plan.lines.some((l) => l.kind === k));
  return (
    <div className="exterior-legend">
      {kinds.map((k) => (
        <span key={k} className="exterior-legend-item">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" stroke={LINE_STYLE[k].stroke} strokeWidth={LINE_STYLE[k].width} strokeDasharray={LINE_STYLE[k].dash} />
          </svg>
          {LINE_STYLE[k].label}
        </span>
      ))}
      <span className="exterior-legend-item">
        <svg width="22" height="8" aria-hidden="true">
          <line x1="1" y1="4" x2="21" y2="4" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" />
        </svg>
        Walls
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------------------------

/** A feet-and-inches box with its label above it. */
function FeetField({
  id,
  label,
  value,
  onCommit,
  readOnly = false,
  allowZero = false,
  nullable = false,
  note,
}: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (feet: number | null) => void;
  readOnly?: boolean;
  allowZero?: boolean;
  nullable?: boolean;
  note?: string;
}) {
  return (
    <div className="exterior-field">
      <label className="exterior-field-label" htmlFor={id}>
        {label}
      </label>
      <FeetInput id={id} label={label} value={value} onCommit={onCommit} readOnly={readOnly} allowZero={allowZero} nullable={nullable} />
      {note && <span className="field-note">{note}</span>}
    </div>
  );
}

/** Commits on blur or Enter; puts back what it can't read, as the sketch's own length boxes do. */
function FeetInput({
  id,
  label,
  value,
  onCommit,
  readOnly = false,
  allowZero = false,
  nullable = false,
}: {
  id?: string;
  label: string;
  value: number | null;
  onCommit: (feet: number | null) => void;
  readOnly?: boolean;
  allowZero?: boolean;
  nullable?: boolean;
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
      disabled={readOnly}
      onBlur={(e) => {
        const raw = e.target.value.trim();
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
        if (value === null || Math.abs(feet - value) > 1e-9) onCommit(feet);
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

function NumberField({
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

