"use client";

import { useMemo, useState } from "react";
import { formatFeetInches, newSketchId, parseFeetInches } from "@/lib/sketch";
import {
  bandLabel,
  CLADDING_KINDS,
  CLADDING_LABEL,
  type CladdingBand,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  DEFAULT_ELBOWS_PER_DOWNSPOUT,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorQuantities,
  type ExteriorRoof,
  type ExteriorScope,
  type ExteriorShape,
  type ExteriorSide,
  emptyScope,
  exteriorQuantities,
  exteriorScopeLines,
  FEET_PER_DOWNSPOUT,
  fixtureLine,
  formatOpeningSize,
  formatPitch,
  lShapeExterior,
  newSide,
  OPENING_LABEL,
  rectangleExterior,
  ROOF_MATERIAL_LABEL,
  ROOF_VENT_LABEL,
  type RoofingQuantities,
  type RoofMaterial,
  type RoofVentKind,
  SIDE_FIXTURE_LABEL,
  type SideFixture,
  type SideFixtureKind,
  type SideQuantities,
} from "@/lib/exterior";
import { pickableEdge, type RoofPick, RoofLegend, RoofPlanDrawing } from "./exteriorDrawings";
import { formatQuantity } from "@/lib/sketchQuantities";
import type { RoofAddition, RoofPlan } from "@/lib/roof";
import type { SideTrace } from "@/lib/exteriorTrace";
import { type PhotoOpacity, SideElevation } from "./SidePhotos";

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

function sf(value: number): string {
  return `${formatQuantity(value)} SF`;
}
function lf(value: number): string {
  return `${formatQuantity(value)} LF`;
}
/** "A", "A and B", "A, B and C". */
function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function ExteriorEditor({ exterior, onChange, readOnly }: { exterior: Exterior | undefined; onChange: ExteriorUpdate; readOnly: boolean }) {
  const [view, setView] = useState<string>("roof");
  /** Each side's AI trace until it is used or set aside, and how the photos are shown: kept here so a side visited again finds them. */
  const [traces, setTraces] = useState<Record<string, SideTrace>>({});
  const [photoOpacity, setPhotoOpacity] = useState<PhotoOpacity>("full");
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
        roof: {
          ...prev.roof,
          ends,
          ridgeAlong: prev.roof.ridgeAlong === id ? null : prev.roof.ridgeAlong,
          additions: prev.roof.additions?.filter((a) => a.sideId !== id),
          lowerWings: prev.roof.lowerWings?.filter((w) => w !== id),
          wingGables: prev.roof.wingGables?.filter((w) => w !== id),
          coveredNotches: prev.roof.coveredNotches?.filter((w) => w !== id),
        },
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
        Measuring the outside is not deciding to replace it. Tick what the scope should price: each tick puts its lines, with these quantities, on the
        scope document under Exterior, and on the Roofing or Siding work order. The roof plan and the elevations go with the scope document.
      </p>
      <div className="exterior-ticks">
        {tick("Roofing", scope.roofing, noRoof, () => onChange((s) => ({ ...s, roofing: !s.roofing })), "roofing", ask?.roofing)}
        {exterior.sides.map((side, i) =>
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
  photoOpacity,
  onPhotoOpacity,
  trace,
  onTrace,
}: {
  side: ExteriorSide;
  index: number;
  q: ExteriorQuantities;
  readOnly: boolean;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
  onRemove: () => void;
  photoOpacity: PhotoOpacity;
  onPhotoOpacity: (o: PhotoOpacity) => void;
  trace: SideTrace | undefined;
  onTrace: (t: SideTrace | undefined) => void;
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
        <SideElevation
          side={side}
          rise={rise}
          readOnly={readOnly}
          opacity={photoOpacity}
          onOpacity={onPhotoOpacity}
          trace={trace}
          onTrace={onTrace}
          onUpdate={onUpdate}
          caption={
            <figcaption className="field-note">
              {side.name.trim() || "Side"} elevation, to scale, seen from outside.
              {sq.complete ? ` ${sf(sq.netSquareFeet)} of cladding after openings.` : " Put in the eave height to work out its area."}
            </figcaption>
          }
        />
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
          {side.heightsFrom === "level"
            ? "The soffit line at each corner, from the phone's one ground level for this side."
            : `The soffit line, from the grade at each corner.${Math.abs(fall) > 1 / 96 ? ` The eave is level, so the grade ${fall > 0 ? "falls" : "rises"} ${formatFeetInches(Math.abs(fall))} from left to right.` : ""}`}
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

        {(side.shapes ?? []).length > 0 ? (
          <>
            <h4 className="exterior-subhead">Cladding, as tapped</h4>
            <ShapesEditor side={side} sq={sq} readOnly={readOnly} onUpdate={onUpdate} />
          </>
        ) : (
          <>
            <h4 className="exterior-subhead">Cladding, bottom up</h4>
            <BandsEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />
          </>
        )}

        <h4 className="exterior-subhead">Openings</h4>
        <OpeningsEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />

        <h4 className="exterior-subhead">On the wall</h4>
        <FixturesEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />

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

/**
 * A side tapped as shapes on the phone: each shape's material can be put right here, and the whole
 * set put aside for bands typed by hand. The polygons themselves are the phone's.
 */
function ShapesEditor({ side, sq, readOnly, onUpdate }: { side: ExteriorSide; sq: SideQuantities; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const shapes = side.shapes ?? [];
  const counted = new Map(sq.bands.map((b) => [b.bandId, b]));
  return (
    <div className="exterior-rows">
      {shapes.map((shape, i) => {
        const q = counted.get(shape.id);
        return (
          <div className="exterior-row" key={shape.id}>
            <select
              aria-label={`Shape ${i + 1}: material`}
              value={shape.kind}
              disabled={readOnly}
              onChange={(e) =>
                onUpdate((s) => ({ ...s, shapes: (s.shapes ?? []).map((x) => (x.id === shape.id ? { ...x, kind: e.target.value as ExteriorShape["kind"] } : x)) }))
              }
            >
              {[...CLADDING_KINDS, "parging" as const].map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "parging" ? "Parging" : CLADDING_LABEL[kind]}
                </option>
              ))}
            </select>
            <span className="exterior-row-note">
              {shape.polygon.length} corners
              {!shape.closed ? " · left open: not counted" : shape.kind === "parging" ? " · not counted as cladding" : q ? ` · ${sf(q.netSquareFeet)} net${q.overlapSquareFeet ? `, less ${sf(q.overlapSquareFeet)} under a shape tapped after it` : ""}` : ""}
            </span>
          </div>
        );
      })}
      {!readOnly && (
        <button type="button" className="btn-secondary" onClick={() => onUpdate((s) => ({ ...s, shapes: undefined }))}>
          Use bands instead
        </button>
      )}
      <p className="field-note">Tapped round on the phone, each material its own shape. Openings come out of every shape they overlap.</p>
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
  const [mode, setMode] = useState<"slopes" | "edges" | "ridges">("slopes");
  const roof = exterior.roof;
  const plan = q.roof;
  const r = q.roofing;
  const nameOf = (id: string) => exterior.sides.find((s) => s.id === id)?.name.trim() || "Side";
  const fp = q.footprint;
  const ridges = plan ? plan.lines.filter((l) => l.kind === "ridge") : [];

  /** One more or one fewer of a choice that means "all" while it is null. */
  const toggleIn = (list: string[] | null | undefined, all: string[], key: string): string[] | null => {
    const current = list ?? all;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    return all.every((k) => next.includes(k)) ? null : next;
  };
  function onPick(what: RoofPick, key: string) {
    if (readOnly || !plan) return;
    const facetKeys = plan.facets.map((f) => f.key);
    const edgeKeys = plan.edges.filter((e) => pickableEdge(e.kind)).map((e) => e.key);
    if (what === "slope") onUpdate((x) => ({ ...x, slopes: toggleIn(x.slopes, facetKeys, key) }));
    else if (what === "edge") onUpdate((x) => ({ ...x, edges: toggleIn(x.edges, edgeKeys, key) }));
    else onUpdate((x) => {
      const current = x.ridgeVents ?? [];
      return { ...x, ridgeVents: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] };
    });
  }

  const chosenSlopes = r ? r.slopes.filter((s) => s.selected) : [];
  const pickNote = !r
    ? ""
    : mode === "slopes"
      ? r.slopes.length === 0
        ? "This outline's slopes are not worked out: the whole roof is counted."
        : r.allSlopes
          ? `All ${r.slopes.length} slopes are being roofed. Tap a slope to leave it out.`
          : `Slope${chosenSlopes.length === 1 ? "" : "s"} ${chosenSlopes.map((s) => s.label).join(", ") || "none"} being roofed: ${sf(r.areaSquareFeet)}. Tap a slope to add or remove it.`
      : mode === "edges"
        ? `${r.allEdges ? "Every eave and rake" : "The eaves and rakes drawn bold"} take the eavestrough (eaves only), soffit and fascia. Tap one to add or remove it.`
        : ridges.length === 0
          ? "This roof has no ridge."
          : roof.ridgeVents === undefined
            ? "Tap each ridge that has ridge vent, or say there is none."
            : `Ridge vent: ${r.ridgeVentFeet > 0 ? lf(r.ridgeVentFeet) : "none"}.`;

  return (
    <div className="exterior-pane">
      <figure className="exterior-figure">
        {plan && fp.closes ? (
          <>
            {!readOnly && (
              <div className="exterior-pick-bar">
                <div className="option-group" role="group" aria-label="What a tap on the plan chooses">
                  {(
                    [
                      ["slopes", "Slopes to roof"],
                      ["edges", "Eaves & rakes"],
                      ["ridges", "Ridge vent"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" className={`option-btn${mode === value ? " selected" : ""}`} aria-pressed={mode === value} onClick={() => setMode(value)}>
                      {label}
                    </button>
                  ))}
                </div>
                {mode === "slopes" && plan.facets.length > 0 && (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, slopes: null }))}>
                      All
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, slopes: [] }))}>
                      None
                    </button>
                  </>
                )}
                {mode === "edges" && (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, edges: null }))}>
                      All
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, edges: plan.edges.filter((e) => e.kind === "eave").map((e) => e.key) }))}>
                      Eaves only
                    </button>
                  </>
                )}
                {mode === "ridges" && ridges.length > 0 && (
                  <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, ridgeVents: [] }))}>
                    No ridge vent
                  </button>
                )}
              </div>
            )}
            <RoofPlanDrawing
              plan={plan}
              footprint={fp}
              nameOf={nameOf}
              slopes={roof.slopes ?? null}
              edges={roof.edges ?? null}
              ridgeVents={roof.ridgeVents ?? []}
              mode={readOnly ? null : mode}
              onPick={readOnly ? undefined : onPick}
            />
            <RoofLegend plan={plan} ridgeVent={(roof.ridgeVents ?? []).length > 0} />
            {!readOnly && <p className="field-note">{pickNote}</p>}
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
        <h4 className="exterior-subhead">The roof</h4>
        <div className="exterior-grid">
          <NumberField
            id="ext-pitch"
            label="Pitch (rise in 12)"
            value={roof.pitch}
            placeholder={q.pitch.source === "sides" && q.pitch.value !== null ? (Math.round(q.pitch.value * 100) / 100).toString() : ""}
            readOnly={readOnly}
            max={24}
            onCommit={(v) => onUpdate((x) => ({ ...x, pitch: v }))}
            note={
              q.pitch.fromSides.length > 0
                ? `Measured gables give ${q.pitch.fromSides.map((f) => `${formatPitch(f.pitch)} (${f.name})`).join(", ")}.${roof.pitch === null ? " Left blank, the roof uses that." : ""}`
                : "No gable peak measured yet, so it has to be typed."
            }
          />
          <FeetField id="ext-eave-oh" label="Eave overhang" value={roof.eaveOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((x) => ({ ...x, eaveOverhangFeet: v }))} />
          <FeetField id="ext-rake-oh" label="Rake overhang" value={roof.rakeOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((x) => ({ ...x, rakeOverhangFeet: v }))} />
        </div>
        {plan && plan.notches.length > 0 && (
          <div className="exterior-rows">
            <span className="exterior-row-label">Notches the roof carries over</span>
            {plan.notches.map((k) => (
              <Choice
                key={`notch-${k.sideId}`}
                label={`${formatFeetInches(k.x1 - k.x0)} × ${formatFeetInches(k.y1 - k.y0)} at ${listOf(k.sideIds.map(nameOf))}`}
                value={k.covered ? "covered" : "open"}
                readOnly={readOnly}
                options={[
                  ["open", "Open"],
                  ["covered", "Roofed over"],
                ]}
                onChange={(v) =>
                  onUpdate((x) => ({ ...x, coveredNotches: [...(x.coveredNotches ?? []).filter((id) => !k.sideIds.includes(id)), ...(v === "covered" ? [k.sideId] : [])] }))
                }
              />
            ))}
            <p className="field-note">
              A covered deck or porch in a corner of the house, under the roof: the roof is planned round the outline with it filled in. A porch roof that is a slope carried on past a wall goes under
              Porches and cross gables.
            </p>
          </div>
        )}
        {plan && (plan.shape === "rectangle" || plan.shape === "wings") && (
          <label className="exterior-field" htmlFor="ext-ridge">
            <span className="exterior-field-label">{plan.shape === "rectangle" ? "Ridge runs" : "Main roof"}</span>
            <select id="ext-ridge" value={roof.ridgeAlong ?? ""} disabled={readOnly} onChange={(e) => onUpdate((x) => ({ ...x, ridgeAlong: e.target.value || null }))}>
              <option value="">{plan.shape === "rectangle" ? "Along the longer walls" : "Worked out from the outline"}</option>
              {exterior.sides.map((s) => (
                <option key={s.id} value={s.id}>
                  {plan.shape === "rectangle" ? `Parallel to ${s.name.trim() || "Side"}` : `Over ${s.name.trim() || "Side"}, its ridge along it`}
                </option>
              ))}
            </select>
          </label>
        )}
        {plan && plan.ends.length > 0 && (
          <>
            {plan.ends.map((end) => (
              <Choice
                key={end.sideId}
                label={`End over ${nameOf(end.sideId)}${end.role === "wing" ? " (wing)" : ""}`}
                value={end.kind}
                readOnly={readOnly}
                options={[
                  ["gable", "Gable"],
                  ["hip", "Hip"],
                ]}
                onChange={(kind) => onUpdate((x) => ({ ...x, ends: { ...x.ends, [end.sideId]: kind } }))}
              />
            ))}
          </>
        )}
        {plan && plan.shape === "L" && plan.wingEnds.length > 0 && (
          <Choice
            label="A wing's roof lower, stopping at the wall"
            hint="A wing set below the house's roof, with a strip of siding between (a garage tied in lower): it meets the wall with step flashing, not valleys."
            value={roof.lowerWings?.find((id) => plan.wingEnds.includes(id)) ?? "none"}
            readOnly={readOnly}
            options={[["none", "No: it runs into the main roof"] as [string, string], ...plan.wingEnds.map((id) => [id, `The wing out to ${nameOf(id)}`] as [string, string])]}
            onChange={(v) => onUpdate((x) => ({ ...x, lowerWings: v === "none" ? [] : [v] }))}
          />
        )}
        {plan && plan.shape === "L" && plan.wings.some((w) => w.lower && w.onSlope) && (
          <Choice
            label="Over the lower wing, the main roof has"
            value={plan.wings.some((w) => w.gable) ? "gable" : "eave"}
            readOnly={readOnly}
            options={[
              ["eave", "Its eave"],
              ["gable", "A gable"],
            ]}
            onChange={(v) => onUpdate((x) => ({ ...x, wingGables: v === "gable" ? plan.wings.filter((w) => w.lower).map((w) => w.sideId) : [] }))}
          />
        )}
        {plan && plan.shape === "wings" && plan.wings.length > 0 && (
          <div className="exterior-rows">
            <span className="exterior-row-label">Wings</span>
            {plan.wings.map((w) => (
              <Choice
                key={`wing-${w.sideId}`}
                label={`The wing out to ${nameOf(w.sideId)}`}
                hint={w.forced ? "It has to sit lower: the note under the plan says why." : undefined}
                value={w.gable ? "gable" : w.lower ? "lower" : "tie"}
                readOnly={readOnly || w.forced}
                options={[
                  ["tie", "Into the roof it meets"],
                  ["lower", "Lower, under its eave"],
                  ...(w.onSlope && !w.forced ? [["gable", "Lower, under a gable"] as ["gable", string]] : []),
                ]}
                onChange={(how) =>
                  onUpdate((x) => ({
                    ...x,
                    lowerWings: [...(x.lowerWings ?? []).filter((id) => id !== w.sideId), ...(how === "tie" ? [] : [w.sideId])],
                    wingGables: [...(x.wingGables ?? []).filter((id) => id !== w.sideId), ...(how === "gable" ? [w.sideId] : [])],
                  }))
                }
              />
            ))}
            <p className="field-note">
              Into the roof it meets: its ridge runs back into that roof&rsquo;s slope, with valleys. Lower: a roof of its own, stopping at the wall with step flashing and a strip of siding between, under that
              roof&rsquo;s eave or under a gable of it (a garage tied in lower).
            </p>
          </div>
        )}
        {plan && plan.shape !== "other" && <RoofAdditions exterior={exterior} plan={plan} lengthOf={(id) => fp.lengthsFeet[fp.sideIds.indexOf(id)] ?? 0} readOnly={readOnly} onUpdate={onUpdate} />}

        <h4 className="exterior-subhead">Roofing</h4>
        <Choice
          label="Material"
          value={roof.material ?? null}
          readOnly={readOnly}
          options={(Object.keys(ROOF_MATERIAL_LABEL) as RoofMaterial[]).map((m) => [m, ROOF_MATERIAL_LABEL[m]] as [RoofMaterial, string])}
          onChange={(material) => onUpdate((x) => ({ ...x, material }))}
        />
        {roof.material === "metal" && (
          <p className="field-note">Metal adds closure strips (eaves + 2 × ridge), high-temperature ice &amp; water barrier and its own disposal line.</p>
        )}
        <YesNo label="Drip edge (photos required)" value={roof.dripEdge ?? null} readOnly={readOnly} onChange={(dripEdge) => onUpdate((x) => ({ ...x, dripEdge }))} />
        <Choice
          label="Underlayment (photos required)"
          value={roof.underlayment ?? null}
          readOnly={readOnly}
          options={[
            ["synthetic", "Synthetic"],
            ["felt", "Felt"],
            ["none", "None"],
          ]}
          onChange={(underlayment) => onUpdate((x) => ({ ...x, underlayment }))}
        />
        <YesNo label="Two storeys or higher (high roof)" value={roof.high ?? null} readOnly={readOnly} onChange={(high) => onUpdate((x) => ({ ...x, high }))} />
        <YesNo
          label="Handload materials"
          hint="More than 30 ft from the front of the driveway, or the loading truck can't reach."
          value={roof.handload ?? null}
          readOnly={readOnly}
          onChange={(handload) => onUpdate((x) => ({ ...x, handload }))}
        />
        <YesNo
          label="Handload to disposal"
          hint="Nowhere to put a bin on the driveway: an alley, or otherwise."
          value={roof.disposalHandload ?? null}
          readOnly={readOnly}
          onChange={(disposalHandload) => onUpdate((x) => ({ ...x, disposalHandload }))}
        />
        <Choice
          label="Chimney flashing"
          value={roof.chimney ?? null}
          readOnly={readOnly}
          options={[
            ["none", "None"],
            ["small", "Small"],
            ["medium", "Medium"],
            ["large", "Large"],
          ]}
          onChange={(chimney) => onUpdate((x) => ({ ...x, chimney }))}
        />
        <div className="exterior-row">
          <span className="exterior-row-label">Roof vents</span>
          {roof.vents === undefined && !readOnly && (
            <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, vents: {} }))}>
              None
            </button>
          )}
        </div>
        <div className="exterior-grid">
          {(Object.keys(ROOF_VENT_LABEL) as RoofVentKind[]).map((kind) => (
            <NumberField
              key={kind}
              id={`ext-vent-${kind}`}
              label={ROOF_VENT_LABEL[kind]}
              value={roof.vents === undefined ? null : roof.vents[kind] ?? 0}
              readOnly={readOnly}
              integer
              max={99}
              onCommit={(v) => onUpdate((x) => ({ ...x, vents: { ...(x.vents ?? {}), [kind]: v ?? 0 } }))}
            />
          ))}
        </div>
        <div className="exterior-row">
          <span className="exterior-row-label">Pipe jacks</span>
          {roof.pipeJacks === undefined && !readOnly && (
            <button type="button" className="btn-secondary" onClick={() => onUpdate((x) => ({ ...x, pipeJacks: { four: 0, six: 0 } }))}>
              None
            </button>
          )}
        </div>
        <div className="exterior-grid">
          {(
            [
              ["four", '4"'],
              ["six", '6"'],
            ] as const
          ).map(([size, label]) => (
            <NumberField
              key={size}
              id={`ext-jack-${size}`}
              label={`Pipe jack ${label}`}
              value={roof.pipeJacks === undefined ? null : roof.pipeJacks[size]}
              readOnly={readOnly}
              integer
              max={99}
              onCommit={(v) => onUpdate((x) => ({ ...x, pipeJacks: { ...(x.pipeJacks ?? { four: 0, six: 0 }), [size]: v ?? 0 } }))}
            />
          ))}
        </div>

        <h4 className="exterior-subhead">Eavestrough</h4>
        <YesNo label="Leaf guard" value={roof.leafGuard ?? null} readOnly={readOnly} onChange={(leafGuard) => onUpdate((x) => ({ ...x, leafGuard }))} />
        <div className="exterior-grid">
          <NumberField
            id="ext-downspouts"
            label="Downspouts"
            value={roof.downspouts}
            placeholder={r ? String(r.gutter.downspouts) : ""}
            readOnly={readOnly}
            integer
            max={40}
            onCommit={(v) => onUpdate((x) => ({ ...x, downspouts: v }))}
            note={`Blank counts one per ${FEET_PER_DOWNSPOUT} ft of eavestrough, at least one per run.`}
          />
          <FeetField
            id="ext-downspout-feet"
            label="Downspouts, total length"
            value={roof.downspoutFeet ?? null}
            placeholder={r && r.gutter.downspoutFeet !== null && !r.gutter.downspoutFeetTyped ? formatFeetInches(r.gutter.downspoutFeet) : ""}
            readOnly={readOnly}
            allowZero
            nullable
            onCommit={(v) => onUpdate((x) => ({ ...x, downspoutFeet: v }))}
            note="Blank takes each eave's height from its elevation, plus 15%."
          />
          <NumberField
            id="ext-elbows"
            label="Elbows per downspout"
            value={roof.elbowsPerDownspout ?? null}
            placeholder={String(DEFAULT_ELBOWS_PER_DOWNSPOUT)}
            readOnly={readOnly}
            integer
            max={9}
            onCommit={(v) => onUpdate((x) => ({ ...x, elbowsPerDownspout: v ?? undefined }))}
            note="Two at the eave and one at the foot, unless changed."
          />
        </div>

        <h4 className="exterior-subhead">Soffit &amp; fascia</h4>
        <Choice
          label="Material"
          value={roof.soffitMaterial ?? null}
          readOnly={readOnly}
          options={[
            ["metal", "Metal"],
            ["wood", "Wood"],
          ]}
          onChange={(soffitMaterial) => onUpdate((x) => ({ ...x, soffitMaterial }))}
        />

        {r && <RoofFigures r={r} />}
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

type AdditionKind = "porch" | "leanto" | "gable";
const ADDITION_LABEL: Record<AdditionKind, string> = {
  porch: "Porch: the slope carried on",
  leanto: "Porch: lower, against the wall",
  gable: "Cross gable",
};
const additionKind = (a: RoofAddition): AdditionKind => (a.kind === "gable" ? "gable" : a.lower ? "leanto" : "porch");

/**
 * What the footprint can't tell about the roof, put on a side (2026-10-12): a porch that is the
 * slope above carried on past the wall and a cross gable rising out of a slope over a front door
 * (both the owner's own house), and a lean-to porch of its own below the eave.
 */
function RoofAdditions({
  exterior,
  plan,
  lengthOf,
  readOnly,
  onUpdate,
}: {
  exterior: Exterior;
  plan: RoofPlan;
  lengthOf: (sideId: string) => number;
  readOnly: boolean;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const adds = exterior.roof.additions ?? [];
  const nameOf = (id: string) => exterior.sides.find((s) => s.id === id)?.name.trim() || "Side";
  const set = (id: string, f: (a: RoofAddition) => RoofAddition) => onUpdate((x) => ({ ...x, additions: (x.additions ?? []).map((a) => (a.id === id ? f(a) : a)) }));
  // A porch carried on, or a cross gable, needs a slope running down to its side: the front, usually.
  const eaveSides = new Set(plan.facets.map((f) => f.sideId).filter((id): id is string => id !== null));
  function add(kind: AdditionKind) {
    const side = (kind === "leanto" ? undefined : exterior.sides.find((s) => eaveSides.has(s.id))) ?? exterior.sides[0];
    if (!side) return;
    const L = lengthOf(side.id) || side.lengthFeet;
    const id = newSketchId("roof");
    const a: RoofAddition =
      kind === "gable"
        ? { id, kind: "gable", sideId: side.id, fromFeet: Math.max(0, L / 2 - 5), toFeet: Math.min(L, L / 2 + 5) }
        : { id, kind: "porch", sideId: side.id, fromFeet: 0, toFeet: L, depthFeet: 6, lower: kind === "leanto" };
    onUpdate((x) => ({ ...x, additions: [...(x.additions ?? []), a] }));
  }
  return (
    <div className="exterior-rows">
      <span className="exterior-row-label">Porches and cross gables</span>
      {adds.length > 0 && (
        <div className="exterior-openings">
          <span className="exterior-th">Kind</span>
          <span className="exterior-th">Side</span>
          <span className="exterior-th">From left</span>
          <span className="exterior-th">To</span>
          <span className="exterior-th" title="From the wall out to the porch's eave">Out from wall</span>
          <span />
          {adds.map((a, i) => {
            const name = `${ADDITION_LABEL[additionKind(a)]} ${i + 1}`;
            return (
              <div key={a.id} style={{ display: "contents" }}>
                <select
                  aria-label={`${name}: kind`}
                  value={additionKind(a)}
                  disabled={readOnly}
                  onChange={(e) => {
                    const k = e.target.value as AdditionKind;
                    set(a.id, (x) => (k === "gable" ? { id: x.id, kind: "gable", sideId: x.sideId, fromFeet: x.fromFeet, toFeet: x.toFeet } : { ...x, kind: "porch", depthFeet: x.depthFeet ?? 6, lower: k === "leanto" }));
                  }}
                >
                  {(Object.keys(ADDITION_LABEL) as AdditionKind[]).map((k) => (
                    <option key={k} value={k}>
                      {ADDITION_LABEL[k]}
                    </option>
                  ))}
                </select>
                <select aria-label={`${name}: side`} value={a.sideId} disabled={readOnly} onChange={(e) => set(a.id, (x) => ({ ...x, sideId: e.target.value }))}>
                  {exterior.sides.map((s) => (
                    <option key={s.id} value={s.id}>
                      {nameOf(s.id)}
                    </option>
                  ))}
                </select>
                <FeetInput label={`${name}: from the left corner`} value={a.fromFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, fromFeet: v }))} />
                <FeetInput label={`${name}: to`} value={a.toFeet} readOnly={readOnly} onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, toFeet: v }))} />
                {a.kind === "porch" ? (
                  <FeetInput label={`${name}: out from the wall to its eave`} value={a.depthFeet ?? null} readOnly={readOnly} onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, depthFeet: v }))} />
                ) : (
                  <span />
                )}
                {readOnly ? (
                  <span />
                ) : (
                  <button type="button" className="btn-secondary exterior-row-x" aria-label={`Remove ${name}`} onClick={() => onUpdate((x) => ({ ...x, additions: (x.additions ?? []).filter((y) => y.id !== a.id) }))}>
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!readOnly && (
        <div className="exterior-row">
          <button type="button" className="btn-secondary" onClick={() => add("porch")}>
            + Porch roof
          </button>
          <button type="button" className="btn-secondary" onClick={() => add("leanto")}>
            + Lean-to porch
          </button>
          <button type="button" className="btn-secondary" onClick={() => add("gable")}>
            + Cross gable
          </button>
        </div>
      )}
      <p className="field-note">
        Along the side from its left end, as seen from outside. A porch roof carried on is the slope above it, one plane with its eave further out; a lean-to is a lower roof of its own, with headwall flashing where it meets
        the wall. A cross gable stands at the drip line there (the porch&rsquo;s, when there is one), over a front door say.
      </p>
    </div>
  );
}

function RoofFigures({ r }: { r: RoofingQuantities }) {
  const g = r.gutter;
  const chosen = r.slopes.filter((s) => s.selected);
  const rows: [string, string][] = [
    ["Pitch", `${formatPitch(r.pitch)} (factor ${r.pitchFactor.toFixed(3)})${r.steep ? `, steep ${r.steep}` : ""}`],
    ["Slopes being roofed", r.slopes.length === 0 ? "the whole roof" : r.allSlopes ? `all: ${r.slopes.map((s) => s.label).join(", ")}` : chosen.map((s) => s.label).join(", ") || "none"],
    ["Roof area", `${sf(r.areaSquareFeet)} (${r.squares.toFixed(2)} SQ, no waste)`],
    ["Ridge", lf(r.ridgeFeet)],
    ["Hips", lf(r.hipFeet)],
    ["Valleys", lf(r.valleyFeet)],
    ...(r.stepFeet > 0 ? [["Step flashing", lf(r.stepFeet)] as [string, string]] : []),
    ...(r.headwallFeet > 0 ? [["Headwall flashing", lf(r.headwallFeet)] as [string, string]] : []),
    ["Eaves", lf(r.eaveFeet)],
    ["Rakes", lf(r.rakeFeet)],
    ["Drip edge (eaves + rakes)", lf(r.dripEdgeFeet)],
    r.material === "metal" ? ["Closure strips (eaves + 2 × ridge)", lf(r.closureFeet)] : ["Starter (eaves)", lf(r.starterFeet)],
    ["Ice & water (eaves + valleys)", lf(r.iceWaterFeet)],
    ["Ridge vent", lf(r.ridgeVentFeet)],
    ["Eavestrough", `${lf(g.feet)} in ${g.runs.length} run${g.runs.length === 1 ? "" : "s"}`],
    ["End caps", String(g.endCaps)],
    ["Mitres", `${g.outsideMitres + g.insideMitres} (${g.outsideMitres} outside, ${g.insideMitres} inside)`],
    ["Drops", String(g.drops)],
    ["Elbows", String(g.elbows)],
    ["Downspouts", `${g.downspouts}${g.downspoutFeet !== null ? `, ${lf(g.downspoutFeet)}${g.downspoutFeetTyped ? "" : " (eave height + 15%)"}` : ""}`],
    ["Soffit, eaves", `${lf(r.soffit.eaveFeet)} (${sf(r.soffit.eaveSquareFeet)})`],
    ["Soffit, rakes", `${lf(r.soffit.rakeFeet)} (${sf(r.soffit.rakeSquareFeet)})`],
    ["Fascia", lf(r.fasciaFeet)],
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
  const fixtures = exterior.sides.flatMap((side) => (side.fixtures ?? []).filter((f) => f.count > 0).map((f) => `${fixtureLine(f)} (${side.name.trim() || "Side"}) × ${f.count}`));
  return (
    <div className="sketch-quantities exterior-totals">
      <h3>Exterior quantities</h3>
      {incomplete.length > 0 && <p className="field-note">Not counted until an eave is put in: {incomplete.map((s) => s.name || "Side").join(", ")}.</p>}
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
          {r && (
            <>
              <tr>
                <th scope="row">Roofing</th>
                <td>
                  {r.squares.toFixed(2)} SQ ({sf(r.areaSquareFeet)} at {formatPitch(r.pitch)}){r.allSlopes ? "" : `, slopes ${r.slopes.filter((s) => s.selected).map((s) => s.label).join(", ")}`}
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
                  {sf(r.soffit.eaveSquareFeet + r.soffit.rakeSquareFeet)} / {lf(r.fasciaFeet)}
                </td>
              </tr>
            </>
          )}
        </tbody>
      </table>
      <p className="field-note">
        Cladding is net of openings and takes in the gables, measured or from the roof. The roof&rsquo;s area is the plan inside the drip line times the
        pitch factor, for the slopes being roofed; its lines are read off the roof the footprint, overhangs and pitch make. Squares are real: waste is
        the estimator&rsquo;s to add.
      </p>
    </div>
  );
}

/** What is on a wall: replaced, or taken off and put back for the cladding. */
function FixturesEditor({ side, readOnly, onUpdate }: { side: ExteriorSide; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const fixtures = side.fixtures ?? [];
  const setFixture = (id: string, f: (x: SideFixture) => SideFixture) => onUpdate((s) => ({ ...s, fixtures: (s.fixtures ?? []).map((x) => (x.id === id ? f(x) : x)) }));
  return (
    <div className="exterior-rows">
      {fixtures.map((f) => (
        <div className="exterior-row" key={f.id}>
          <select aria-label="Item" value={f.kind} disabled={readOnly} onChange={(e) => setFixture(f.id, (x) => ({ ...x, kind: e.target.value as SideFixtureKind }))}>
            {(Object.keys(SIDE_FIXTURE_LABEL) as SideFixtureKind[]).map((k) => (
              <option key={k} value={k}>
                {SIDE_FIXTURE_LABEL[k]}
              </option>
            ))}
          </select>
          {f.kind === "other" && (
            <input
              type="text"
              aria-label="What it is"
              placeholder="What it is"
              key={`${f.id}-${f.label ?? ""}`}
              defaultValue={f.label ?? ""}
              disabled={readOnly}
              onBlur={(e) => setFixture(f.id, (x) => ({ ...x, label: e.target.value.trim() || undefined }))}
            />
          )}
          <select aria-label="What is done" value={f.action} disabled={readOnly} onChange={(e) => setFixture(f.id, (x) => ({ ...x, action: e.target.value === "replace" ? "replace" : "detach_reset" }))}>
            <option value="detach_reset">Detach &amp; reset</option>
            <option value="replace">Replace</option>
          </select>
          <CountInput label={`How many: ${SIDE_FIXTURE_LABEL[f.kind]}`} value={f.count} readOnly={readOnly} onCommit={(count) => setFixture(f.id, (x) => ({ ...x, count }))} />
          {!readOnly && (
            <button
              type="button"
              className="btn-secondary exterior-row-x"
              aria-label={`Remove ${SIDE_FIXTURE_LABEL[f.kind]}`}
              onClick={() => onUpdate((s) => ({ ...s, fixtures: (s.fixtures ?? []).filter((x) => x.id !== f.id) }))}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() => onUpdate((s) => ({ ...s, fixtures: [...(s.fixtures ?? []), { id: newSketchId("fixture"), kind: "dryer_vent", action: "detach_reset", count: 1 }] }))}
        >
          + Item on the wall
        </button>
      )}
      <p className="field-note">Dryer and furnace vents, hose bibs, lights: what has to be replaced, or detached and reset for the cladding. Each goes on the scope.</p>
    </div>
  );
}

/** A yes or no that starts as neither: unanswered is not no. */
function YesNo({ label, hint, value, readOnly, onChange }: { label: string; hint?: string; value: boolean | null; readOnly: boolean; onChange: (v: boolean) => void }) {
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
function Choice<T extends string>({
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
function CountInput({ label, value, readOnly, onCommit }: { label: string; value: number; readOnly: boolean; onCommit: (v: number) => void }) {
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
function FeetInput({
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

