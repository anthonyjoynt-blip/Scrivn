"use client";

import { type PointerEvent, type ReactNode, useRef, useState } from "react";
import { formatFeetInches, newSketchId } from "@/lib/sketch";
import {
  bandLabel,
  CLADDING_KINDS,
  CLADDING_LABEL,
  type CladdingBand,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  elevationShape,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorQuantities,
  type ExteriorShape,
  type ExteriorSide,
  type Footprint,
  COLUMN_LABEL,
  formatOpeningSize,
  formatPitch,
  OPENING_LABEL,
  type OpeningTrim,
  openingRect,
  photoPieceOnRoof,
  SIDE_FIXTURE_LABEL,
  type SideFixture,
  type SideFixtureKind,
  type SideQuantities,
  zFromGrade,
  sharedSideIds,
} from "@/lib/exterior";
import { MIN_SIDE_FEET, sideChain, withSideLength, withUpperSideLength } from "@/lib/exteriorPlan";
import { surroundWords } from "@/lib/exteriorReport";
import { scaleOf } from "@/lib/exteriorScale";
import type { SideTrace } from "@/lib/exteriorTrace";
import type { Pt } from "@/lib/roof";
import type { ElevationView } from "./exteriorDrawings";
import { Cell, Choice, CountInput, FeetField, FeetInput, lf, sf } from "./exteriorFields";
import { type PhotoOpacity, SideElevation } from "./SidePhotos";

/**
 * One side of the house face-on (2026-10-13): its elevation to scale, to be edited where it is seen.
 * The owner wanted to "select any side and see it face-on, and edit it there: add doors and windows,
 * adjust heights and peaks", and to go round the sides one after another.
 *
 *   * ‹ and › (or a swipe across the drawing) go to the side before and after round the house; the
 *     little plan beside the name shows which side this is, and goes back to the plan.
 *   * + Window, + Door, + Garage door, then a tap on the wall where it goes. A window is centred
 *     where the wall was tapped; a door stands on the parging, a garage door on the grade.
 *   * A tap on an opening picks it, for its numbers to be typed under the drawing; a drag moves it.
 *   * The dots drag what the side is measured by: the eave and the parging at the left corner (the
 *     whole line moves), the gable's peak, each band's line, and the length at the right corner.
 *
 * Everything dragged is also typed in the fields beside it, which are the measurements: a drag is a
 * quick way to put a number in, to the inch, and the quantities follow either way.
 */

type Tool = "select" | ExteriorOpeningKind;

const DEFAULT_SIZE: Record<ExteriorOpeningKind, { w: number; h: number }> = { window: { w: 3, h: 4 }, door: { w: 3, h: 6 + 8 / 12 }, garage: { w: 16, h: 7 }, rollup: { w: 6, h: 7 } };
const inch = (v: number) => Math.round(v * 12) / 12;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** What a press on the drawing started: a drag of something on the side, or a tap or swipe on the wall. */
type Press = {
  inv: DOMMatrix;
  /** Where it started: on screen, and in the side's frame (feet along, feet up). */
  cx: number;
  cy: number;
  x: number;
  z: number;
  moved: boolean;
  what: "wall" | "opening" | "eave" | "peak" | "base" | "band" | "length";
  id?: string;
};

/** The sides a side is one of, round its own floor: the main floor's, or a two-storey house's upper floor's. */
export interface SideLoop {
  sides: ExteriorSide[];
  footprint: Footprint | null;
  upper: boolean;
}

export function SidePane({
  exterior,
  side,
  index,
  qIndex,
  loop,
  q,
  readOnly,
  onUpdate,
  onChange,
  onRemove,
  onInsertAfter,
  onGo,
  photoOpacity,
  onPhotoOpacity,
  trace,
  onTrace,
}: {
  exterior: Exterior;
  side: ExteriorSide;
  /** Its place round its own floor. */
  index: number;
  /** Its place in `q.sides`: the main floor's, then the upper floor's. */
  qIndex: number;
  loop: SideLoop;
  q: ExteriorQuantities;
  readOnly: boolean;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
  onChange: (f: (exterior: Exterior) => Exterior) => void;
  onRemove: () => void;
  /** Puts a new side in after this one, and opens it. */
  onInsertAfter: () => void;
  /** Opens another side by its id, or the plan ("plan"). */
  onGo: (view: string) => void;
  photoOpacity: PhotoOpacity;
  onPhotoOpacity: (o: PhotoOpacity) => void;
  trace: SideTrace | undefined;
  onTrace: (t: SideTrace | undefined) => void;
}) {
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string | null>(null);
  /** The side as a drag leaves it, until the drag ends and it is put on the side. */
  const [dragged, setDragged] = useState<ExteriorSide | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const press = useRef<Press | null>(null);
  const apply = useRef<((s: ExteriorSide) => ExteriorSide) | null>(null);

  const sq = q.sides[qIndex] as SideQuantities;
  // Shared with the neighbour (2026-10-17): said on this side, or standing on a shared wall of the floor below.
  const sharedHere = sharedSideIds(exterior).has(side.id);
  const rise = q.rises[side.id] ?? null;
  const base = q.bases[side.id] ?? null;
  const used = loop.footprint?.closes ? loop.footprint.lengthsFeet[index] : undefined;
  // A length typed moves this floor's own outline.
  const typedLength = (x: Exterior, feet: number) => (loop.upper ? withUpperSideLength(x, side.id, feet) : withSideLength(x, side.id, feet));
  const id = (name: string) => `ext-${side.id}-${name}`;
  const fall = side.eaveLeftFeet != null && side.eaveRightFeet != null ? side.eaveRightFeet - side.eaveLeftFeet : 0;
  const roofPeak = rise && rise.length > 0 ? Math.max(...rise.map((r) => r.rise)) : 0;
  const n = loop.sides.length;
  const before = loop.sides[(index - 1 + n) % n] as ExteriorSide;
  const after = loop.sides[(index + 1) % n] as ExteriorSide;
  const nameOf = (s: ExteriorSide) => s.name.trim() || "Side";
  const shown = dragged ?? side;
  const fromShapes = (side.shapes ?? []).length > 0;
  const chosen = side.openings.find((o) => o.id === selected) ?? null;

  // ---- What a drag does --------------------------------------------------------------------
  const gradeAt = (s: ExteriorSide, x: number) => zFromGrade(s, x, 0);
  /** The highest the cladding reaches: an opening's head stays under it. */
  const topZ = (s: ExteriorSide) => Math.max(...elevationShape(s, rise).top.map((p) => p.y), s.eaveLeftFeet ?? DEFAULT_EAVE_FEET);
  const moveOpening = (o: ExteriorOpening, from: number, sill: number) => (s: ExteriorSide): ExteriorSide => {
    const L = s.lengthFeet;
    const fromLeftFeet = inch(clamp(from, 0, L - o.widthFeet));
    const g = gradeAt(s, fromLeftFeet + o.widthFeet / 2);
    const sillFeet = inch(clamp(sill, 0, topZ(s) - g - o.heightFeet));
    return { ...s, openings: s.openings.map((x) => (x.id === o.id ? { ...x, fromLeftFeet, sillFeet } : x)) };
  };
  function dragTo(p: Press, x: number, z: number): ((s: ExteriorSide) => ExteriorSide) | null {
    const dx = x - p.x;
    const dz = z - p.z;
    switch (p.what) {
      case "opening": {
        const o = side.openings.find((v) => v.id === p.id);
        return o ? moveOpening(o, o.fromLeftFeet + dx, o.sillFeet + dz) : null;
      }
      case "eave": {
        if (side.eaveLeftFeet == null) return null;
        const base = Math.max(side.base === "grade" ? 0 : side.baseLeftFeet, 0);
        const d = inch(Math.max(dz, base + 1 - side.eaveLeftFeet));
        return (s) => ({ ...s, eaveLeftFeet: (side.eaveLeftFeet ?? 0) + d, eaveRightFeet: (side.eaveRightFeet ?? side.eaveLeftFeet ?? 0) + d });
      }
      case "base": {
        const top = (side.eaveLeftFeet ?? DEFAULT_EAVE_FEET) - 1;
        const d = inch(clamp(dz, -Math.min(side.baseLeftFeet, side.baseRightFeet), top - Math.max(side.baseLeftFeet, side.baseRightFeet)));
        return (s) => ({ ...s, baseLeftFeet: side.baseLeftFeet + d, baseRightFeet: side.baseRightFeet + d });
      }
      case "band": {
        const band = side.bands.find((b) => b.id === p.id);
        if (!band || typeof band.top !== "number") return null;
        const top = inch(clamp(band.top + dz, 0.25, topZ(side) - 0.25));
        return (s) => ({ ...s, bands: s.bands.map((b) => (b.id === band.id ? { ...b, top } : b)) });
      }
      case "peak": {
        const shape = elevationShape(side, rise);
        const eave = shape.eaveZ ?? DEFAULT_EAVE_FEET;
        const g = side.gable;
        const from = g ? clamp(g.fromFeet ?? 0, 0, side.lengthFeet) : (shape.gable?.from ?? 0);
        const to = g ? clamp(g.toFeet ?? side.lengthFeet, from, side.lengthFeet) : (shape.gable?.to ?? side.lengthFeet);
        const at0 = g ? g.atFeet : (shape.gable?.peak.x ?? side.lengthFeet / 2);
        const z0 = g ? zFromGrade(side, g.atFeet, g.peakFeet) : (shape.gable?.peak.y ?? eave + 4);
        const at = inch(clamp(at0 + dx, from + 0.5, to - 0.5));
        const peakZ = Math.max(eave + 0.25, z0 + dz);
        const peakFeet = inch(peakZ - gradeAt(side, at));
        const span = from > 1e-6 || to < side.lengthFeet - 1e-6 ? { fromFeet: from, toFeet: to } : {};
        return (s) => ({ ...s, gable: { ...(s.gable ?? {}), ...span, atFeet: at, peakFeet } });
      }
      case "length": {
        const L = inch(Math.max(MIN_SIDE_FEET, side.lengthFeet + dx));
        return (s) => ({ ...s, lengthFeet: L });
      }
      default:
        return null;
    }
  }

  const toSide = (inv: DOMMatrix, clientX: number, clientY: number) => {
    const p = new DOMPoint(clientX, clientY).matrixTransform(inv);
    return { x: p.x, z: -p.y };
  };
  function begin(e: PointerEvent<SVGElement>, what: Press["what"], pid?: string) {
    const svg = e.currentTarget.ownerSVGElement;
    const m = svg?.getScreenCTM();
    if (!m) return;
    const inv = m.inverse();
    const at = toSide(inv, e.clientX, e.clientY);
    press.current = { inv, cx: e.clientX, cy: e.clientY, x: at.x, z: at.z, moved: false, what, id: pid };
    apply.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }
  function move(e: PointerEvent<SVGElement>) {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.cx, e.clientY - p.cy) < 6) return;
    p.moved = true;
    if (p.what === "wall" || readOnly) return;
    const at = toSide(p.inv, e.clientX, e.clientY);
    const f = dragTo(p, at.x, at.z);
    apply.current = f;
    setDragged(f ? f(side) : null);
  }
  function end(e: PointerEvent<SVGElement>) {
    const p = press.current;
    press.current = null;
    const f = apply.current;
    apply.current = null;
    setDragged(null);
    if (!p) return;
    if (!p.moved) {
      if (p.what === "opening") setSelected(p.id ?? null);
      else if (p.what === "wall") {
        if (tool !== "select" && !readOnly) place(tool, p.x, p.z);
        else setSelected(null);
      }
      return;
    }
    if (p.what === "wall") {
      // A swipe across the drawing goes round the house: to the left, the next side.
      const dx = e.clientX - p.cx;
      const dy = e.clientY - p.cy;
      if (n > 1 && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) onGo((dx < 0 ? after : before).id);
      return;
    }
    if (!f || readOnly) return;
    if (p.what === "length") {
      const L = f(side).lengthFeet;
      onChange((x) => typedLength(x, L));
    } else onUpdate(f);
    if (p.what === "opening" && p.id) setSelected(p.id);
  }
  /** A touch the browser took back - a scroll or a pinch that began on the wall: nothing is placed, and a drag is let go. */
  function cancel() {
    press.current = null;
    apply.current = null;
    setDragged(null);
  }
  function place(kind: ExteriorOpeningKind, x: number, z: number) {
    const size = DEFAULT_SIZE[kind];
    const opening: ExteriorOpening = { id: newSketchId("opening"), kind, widthFeet: size.w, heightFeet: size.h, sillFeet: 0, fromLeftFeet: 0 };
    const base = side.base === "parging" ? Math.min(side.baseLeftFeet, side.baseRightFeet) : 0;
    const from = x - size.w / 2;
    const sill = kind === "window" ? z - gradeAt(side, x) - size.h / 2 : kind === "door" ? base : 0;
    onUpdate((s) => moveOpening(opening, from, sill)({ ...s, openings: [...s.openings, opening] }));
    setSelected(opening.id);
    // Back to picking after each one, as the plan's tools do: the next tap is more often a look than another window.
    setTool("select");
  }

  // ---- What is drawn over the elevation to edit it ----------------------------------------------
  const editor = (view: ElevationView): ReactNode => {
    const s = shown;
    const shape = elevationShape(s, fromShapes ? null : rise);
    const L = Math.max(0, s.lengthFeet);
    const r = view.vw * 0.011;
    const hit = view.vw * 0.032;
    const stroke = { vectorEffect: "non-scaling-stroke" as const };
    const dot = (key: string, x: number, z: number, what: Press["what"], label: string, color: string, hollow = false, pid?: string) => (
      <g key={key} className="exterior-handle" aria-label={label} onPointerDown={(e) => begin(e, what, pid)}>
        <circle cx={x} cy={-z} r={hit} fill="#000000" fillOpacity={0} />
        <circle cx={x} cy={-z} r={r} fill={hollow ? "#ffffff" : color} stroke={hollow ? color : "#ffffff"} strokeWidth={2} {...stroke} />
      </g>
    );
    const handles: ReactNode[] = [];
    if (!readOnly && !fromShapes && shape.eaveZ !== null) {
      handles.push(dot("eave", 0, shape.eaveZ, "eave", "Eave: drag up or down", "#1d4ed8"));
      if (s.base === "parging") handles.push(dot("base", 0, shape.bottom[0].y, "base", "Top of the parging: drag up or down", "#6b7280"));
      s.bands.slice(0, -1).forEach((b) => {
        if (typeof b.top === "number") handles.push(dot(`band-${b.id}`, 0, b.top, "band", `Top of the ${bandLabel(b).toLowerCase()}: drag up or down`, "#92400e", false, b.id));
      });
      if (shape.gable) handles.push(dot("peak", shape.gable.peak.x, shape.gable.peak.y, "peak", shape.gable.source === "measured" ? "Gable peak: drag it" : "The roof's gable peak: drag it to where you measured it", "#b91c1c", shape.gable.source === "roof"));
      handles.push(dot("length", L, shape.grade[1].y, "length", "Length: drag the right-hand corner", "#0f766e"));
    }
    return (
      <g onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}>
        <rect
          className={tool === "select" ? "exterior-wall-hit" : "exterior-wall-hit exterior-wall-placing"}
          x={view.vx}
          y={view.vy}
          width={view.vw}
          height={view.vh}
          fill="#000000"
          fillOpacity={0}
          onPointerDown={(e) => begin(e, "wall")}
        />
        {s.openings.map((o) => {
          const rect = openingRect(s, o);
          const on = o.id === selected;
          return (
            <rect
              key={o.id}
              className="exterior-opening-hit"
              x={rect.x0}
              y={-rect.y1}
              width={rect.x1 - rect.x0}
              height={rect.y1 - rect.y0}
              fill={on ? "#2563eb" : "#000000"}
              fillOpacity={on ? 0.12 : 0}
              stroke={on ? "#2563eb" : "none"}
              strokeWidth={on ? 3 : 0}
              aria-label={`${OPENING_LABEL[o.kind]} ${formatFeetInches(o.widthFeet)} wide`}
              onPointerDown={(e) => begin(e, "opening", o.id)}
              {...stroke}
            />
          );
        })}
        {handles}
      </g>
    );
  };

  const hint = readOnly
    ? "Swipe across the drawing, or use the arrows, to go round the house."
    : tool !== "select"
      ? `Tap the wall where the ${OPENING_LABEL[tool].toLowerCase()} goes.`
      : fromShapes
        ? "Tap a window or door to change it, or drag it to move it. Swipe across the drawing for the next side."
        : "Tap a window or door to change it, or drag it. Drag a dot to set the eave, the parging, a band, the peak or the length. Swipe for the next side.";

  return (
    <div className="exterior-pane">
      <figure className="exterior-figure">
        <div className="exterior-side-head">
          {n > 1 && (
            <button type="button" className="btn-secondary exterior-cycle" onClick={() => onGo(before.id)} aria-label={`The side before: ${nameOf(before)}`}>
              ‹ <span className="exterior-cycle-name">{nameOf(before)}</span>
            </button>
          )}
          <button type="button" className="exterior-locator" onClick={() => onGo("plan")} title="Back to the plan" aria-label="Back to the plan">
            <SideLocator exterior={exterior} q={q} index={index} loop={loop} />
          </button>
          <div className="exterior-side-title">
            <strong>{nameOf(side)}</strong>
            <span className="field-note">
              {loop.upper ? "Upper floor, " : ""}
              {index + 1} of {n}, face-on
            </span>
          </div>
          {n > 1 && (
            <button type="button" className="btn-secondary exterior-cycle" onClick={() => onGo(after.id)} aria-label={`The side after: ${nameOf(after)}`}>
              <span className="exterior-cycle-name">{nameOf(after)}</span> ›
            </button>
          )}
        </div>
        {!readOnly && (
          <div className="exterior-pick-bar">
            <div className="option-group" role="group" aria-label="Put on the wall">
              {(Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((kind) => (
                <button key={kind} type="button" className={`option-btn${tool === kind ? " selected" : ""}`} aria-pressed={tool === kind} onClick={() => setTool(tool === kind ? "select" : kind)}>
                  + {OPENING_LABEL[kind]}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="field-note exterior-plan-hint">{hint}</p>
        <SideElevation
          side={shown}
          rise={rise}
          base={base}
          readOnly={readOnly}
          opacity={photoOpacity}
          onOpacity={onPhotoOpacity}
          trace={trace}
          onTrace={onTrace}
          onUpdate={onUpdate}
          editor={editor}
          roofAssumed={q.pitch.source === "assumed"}
          scaleFactor={scaleOf(exterior)?.factor ?? null}
          pieceOnRoof={photoPieceOnRoof(exterior, q.roof, q.roof?.pitch ?? q.pitch.value ?? 0, side.id)}
          caption={
            <figcaption className="field-note">
              {nameOf(side)} elevation, to scale, seen from outside.
              {sharedHere ? " Shared with the neighbour – not counted." : sq.complete ? ` ${sf(sq.netSquareFeet)} of cladding after openings.` : " Put in the eave height to work out its area."}
            </figcaption>
          }
        />
        {chosen && (
          <ChosenOpening
            o={chosen}
            n={side.openings.indexOf(chosen) + 1}
            readOnly={readOnly}
            onSet={(f) => onUpdate((s) => ({ ...s, openings: s.openings.map((o) => (o.id === chosen.id ? f(o) : o)) }))}
            onRemove={() => {
              onUpdate((s) => ({ ...s, openings: s.openings.filter((o) => o.id !== chosen.id) }));
              setSelected(null);
            }}
            onDone={() => setSelected(null)}
          />
        )}
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
            onCommit={(v) => v !== null && onChange((x) => typedLength(x, v))}
            note={
              side.lengthFrom === "drawn"
                ? "As drawn on the plan: type it as taped."
                : used !== undefined && Math.abs(used - side.lengthFeet) > 1 / 96
                  ? `The footprint uses ${formatFeetInches(used)}: the sides don't quite meet.`
                  : undefined
            }
          />
          <label className="exterior-field" htmlFor={id("turn")}>
            <span className="exterior-field-label">Corner at its right end</span>
            <select id={id("turn")} value={side.turn} disabled={readOnly} onChange={(e) => onUpdate((s) => ({ ...s, turn: e.target.value === "inside" ? "inside" : "outside" }))}>
              <option value="outside">Outside corner</option>
              <option value="inside">Inside corner (the inside of an L)</option>
            </select>
          </label>
        </div>
        {/* A semi-detached house or a townhouse (2026-10-17): a party wall counts nothing, and the roof is cut at it. */}
        <Choice
          label="Shared with the neighbour"
          hint={
            sharedHere && !side.shared
              ? "It stands on a shared wall of the floor below, so it is shared too."
              : sharedHere
                ? "A party wall: nothing on it is counted or scoped, and the roof stops at the party line over it."
                : "A wall this home shares with the next one: a semi-detached house or a townhouse."
          }
          value={sharedHere ? "yes" : "no"}
          readOnly={readOnly || (sharedHere && !side.shared)}
          options={[
            ["no", "No"],
            ["yes", "Yes, a shared wall"],
          ]}
          onChange={(v) =>
            onUpdate((s) => {
              const { shared: _was, ...rest } = s;
              return v === "yes" ? { ...rest, shared: true } : rest;
            })
          }
        />

        <h4 className="exterior-subhead">Eave</h4>
        <div className="exterior-grid">
          <FeetField id={id("eaveL")} label="At the left corner" value={side.eaveLeftFeet} readOnly={readOnly} nullable onCommit={(v) => onUpdate((s) => ({ ...s, eaveLeftFeet: v, eaveRightFeet: s.eaveRightFeet ?? v }))} />
          <FeetField id={id("eaveR")} label="At the right corner" value={side.eaveRightFeet} readOnly={readOnly} nullable onCommit={(v) => onUpdate((s) => ({ ...s, eaveRightFeet: v, eaveLeftFeet: s.eaveLeftFeet ?? v }))} />
        </div>
        <p className="field-note">
          {loop.upper
            ? "The soffit line at each corner, from the floor line: the top of the main floor's walls, their eave."
            : side.heightsFrom === "level"
              ? "The soffit line at each corner, from the phone's one ground level for this side."
              : `The soffit line, from the grade at each corner.${Math.abs(fall) > 1 / 96 ? ` The eave is level, so the grade ${fall > 0 ? "falls" : "rises"} ${formatFeetInches(Math.abs(fall))} from left to right.` : ""}`}
        </p>

        {loop.upper ? (
          <p className="field-note">
            {base
              ? "It stands on the main floor's wall below it, and on the lower roof against it where one meets it: its cladding starts there."
              : "It stands on the main floor's wall below it: its cladding starts at the floor line."}
          </p>
        ) : (
          <>
            <h4 className="exterior-subhead">Cladding starts at</h4>
            <div className="option-group" role="group" aria-label="Base line">
              {(["parging", "grade"] as const).map((base) => (
                <button key={base} type="button" className={`option-btn${side.base === base ? " selected" : ""}`} aria-pressed={side.base === base} disabled={readOnly} onClick={() => onUpdate((s) => ({ ...s, base }))}>
                  {base === "parging" ? "Top of the parging" : "Grade"}
                </button>
              ))}
            </div>
          </>
        )}
        {!loop.upper && side.base === "parging" && (
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
                label={loop.upper ? "Peak, from the floor line" : "Peak, from the grade under it"}
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
                ? `None measured. The roof puts a gable here, ${formatFeetInches(roofPeak)} above the eave${(q.roofing?.byPitch.length ?? 1) > 1 ? " at the pitch of the roof over it" : ` at ${formatPitch(q.pitch.value ?? 0)}`}${q.pitch.source === "assumed" ? " (assumed)" : ""}, and it is counted in the cladding. Drag its peak, or measure it, to use yours instead.`
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

        {fromShapes ? (
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
        <OpeningsEditor side={side} readOnly={readOnly} selected={selected} onSelect={setSelected} onUpdate={onUpdate} />

        <TrimList side={side} sq={sq} readOnly={readOnly} onUpdate={onUpdate} />

        <h4 className="exterior-subhead">On the wall</h4>
        <FixturesEditor side={side} readOnly={readOnly} onUpdate={onUpdate} />

        <SideFigures sq={sq} />

        {!readOnly && (
          <div className="exterior-rows">
            <h4 className="exterior-subhead">The outline</h4>
            {confirmRemove ? (
              <div className="sketch-undo" role="alert">
                <span>Remove {nameOf(side)}, with what is on it?</span>
                <button type="button" className="btn-secondary" onClick={onRemove}>
                  Remove
                </button>
                <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(false)}>
                  Keep
                </button>
              </div>
            ) : (
              <div className="exterior-row">
                <button type="button" className="btn-secondary" onClick={onInsertAfter}>
                  + Side after this one
                </button>
                <button type="button" className="btn-secondary" onClick={() => setConfirmRemove(true)}>
                  Remove this side…
                </button>
              </div>
            )}
            <p className="field-note">For a corner the outline is missing, or one too many. Then put each side&rsquo;s length and corner right: the plan says what is left until it closes.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The house from above, small, with this side drawn bold and a mark outside it where you stand to see
 * it face-on: which side this is, at a glance, when going round twelve of them.
 */
function SideLocator({ exterior, q, index, loop }: { exterior: Exterior; q: ExteriorQuantities; index: number; loop: SideLoop }) {
  // An upper-floor side: the main floor drawn faint under the upper floor's outline.
  const closed = loop.upper ? loop.footprint?.closes === true : q.footprint.closes;
  const pts: Pt[] = loop.upper ? (closed ? (loop.footprint as Footprint).corners : []) : closed ? q.footprint.corners : sideChain(exterior.sides).points;
  if (pts.length < 2) return null;
  const framed = loop.upper && q.footprint.closes ? [...pts, ...q.footprint.corners] : pts;
  const xs = framed.map((p) => p.x);
  const ys = framed.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const pad = size * 0.2;
  const a = pts[index] as Pt;
  const b = pts[(index + 1) % pts.length] as Pt;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
  const m = { x: (a.x + b.x) / 2 + out.x * pad * 0.6, y: (a.y + b.y) / 2 + out.y * pad * 0.6 };
  const Y = (y: number) => -y;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  return (
    <svg className="exterior-locator-svg" viewBox={`${Math.min(...xs) - pad} ${Y(Math.max(...ys) + pad)} ${Math.max(...xs) - Math.min(...xs) + 2 * pad} ${Math.max(...ys) - Math.min(...ys) + 2 * pad}`} aria-hidden="true">
      {loop.upper && q.footprint.closes && <polygon points={q.footprint.corners.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="#f5f6f8" stroke="#c4cad3" strokeWidth={1} {...stroke} />}
      {closed ? (
        <polygon points={pts.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="#eef1f5" stroke="#9aa4b2" strokeWidth={1.5} {...stroke} />
      ) : (
        <polyline points={pts.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#9aa4b2" strokeWidth={1.5} {...stroke} />
      )}
      <line x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke="#b91c1c" strokeWidth={4} strokeLinecap="round" {...stroke} />
      <circle cx={m.x} cy={Y(m.y)} r={size * 0.06} fill="#b91c1c" />
    </svg>
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
              onChange={(e) => onUpdate((s) => ({ ...s, shapes: (s.shapes ?? []).map((x) => (x.id === shape.id ? { ...x, kind: e.target.value as ExteriorShape["kind"] } : x)) }))}
            >
              {[...CLADDING_KINDS, "parging" as const].map((kind) => (
                <option key={kind} value={kind}>
                  {kind === "parging" ? "Parging" : CLADDING_LABEL[kind]}
                </option>
              ))}
            </select>
            <span className="exterior-row-note">
              {shape.polygon.length} corners
              {!shape.closed
                ? " · left open: not counted"
                : shape.kind === "parging"
                  ? " · not counted as cladding"
                  : q
                    ? ` · ${sf(q.netSquareFeet)} net${q.overlapSquareFeet ? `, less ${sf(q.overlapSquareFeet)} under a shape tapped after it` : ""}`
                    : ""}
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
            <select aria-label={`Cladding ${i + 1}`} value={band.kind} disabled={readOnly} onChange={(e) => setBand(band.id, (b) => ({ ...b, kind: e.target.value as CladdingKind }))}>
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
      <p className="field-note">A band&rsquo;s top is from the grade at the left corner: a band line is level, so one height places it. Drag its dot on the drawing, or type it.</p>
    </div>
  );
}

/** Every opening on the side, as typed: the drawing's + buttons put them on, and a tap on one picks it. */
function OpeningsEditor({
  side,
  readOnly,
  selected,
  onSelect,
  onUpdate,
}: {
  side: ExteriorSide;
  readOnly: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void;
}) {
  const setOpening = (openingId: string, f: (o: ExteriorOpening) => ExteriorOpening) => onUpdate((s) => ({ ...s, openings: s.openings.map((o) => (o.id === openingId ? f(o) : o)) }));
  return (
    <div className="exterior-rows">
      {side.openings.length > 0 ? (
        <div className="exterior-openings">
          <span className="exterior-th">Kind</span>
          <span className="exterior-th">Width</span>
          <span className="exterior-th">Height</span>
          <span className="exterior-th" title="From the grade under it">
            Sill
          </span>
          <span className="exterior-th">From left</span>
          <span className="exterior-th" />
          {side.openings.map((o, i) => (
            <OpeningRow
              key={o.id}
              o={o}
              n={i + 1}
              readOnly={readOnly}
              picked={o.id === selected}
              onPick={() => onSelect(o.id)}
              onSet={(f) => setOpening(o.id, f)}
              onRemove={() => {
                onUpdate((s) => ({ ...s, openings: s.openings.filter((x) => x.id !== o.id) }));
                if (o.id === selected) onSelect(null);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="field-note">None yet: press + Window, + Door or + Garage door over the drawing, then tap the wall where it goes.</p>
      )}
      <p className="field-note">The opening in the cladding, as taped. Sill is from the grade under it; from left is to its left edge.</p>
    </div>
  );
}

/** The opening picked on the drawing, its numbers typed right under it, each box named. */
function ChosenOpening({ o, n, readOnly, onSet, onRemove, onDone }: { o: ExteriorOpening; n: number; readOnly: boolean; onSet: (f: (o: ExteriorOpening) => ExteriorOpening) => void; onRemove: () => void; onDone: () => void }) {
  const id = (name: string) => `ext-chosen-${o.id}-${name}`;
  return (
    <div className="exterior-chosen">
      <div className="exterior-row">
        <strong>
          {OPENING_LABEL[o.kind]} {n}
        </strong>
        <select aria-label={`${OPENING_LABEL[o.kind]} ${n}: kind`} value={o.kind} disabled={readOnly} onChange={(e) => onSet((x) => ({ ...x, kind: e.target.value as ExteriorOpeningKind, confirmed: true }))}>
          {(Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((k) => (
            <option key={k} value={k}>
              {OPENING_LABEL[k]}
            </option>
          ))}
        </select>
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={onRemove}>
            Remove
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="exterior-grid">
        <FeetField id={id("w")} label="Width" value={o.widthFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, widthFeet: v }))} />
        <FeetField id={id("h")} label="Height" value={o.heightFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, heightFeet: v }))} />
        <FeetField id={id("sill")} label="Sill, from grade" value={o.sillFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, sillFeet: v }))} />
        <FeetField id={id("from")} label="From the left corner" value={o.fromLeftFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, fromLeftFeet: v }))} />
      </div>
    </div>
  );
}

function OpeningRow({
  o,
  n,
  readOnly,
  picked = false,
  onPick,
  onSet,
  onRemove,
}: {
  o: ExteriorOpening;
  n: number;
  readOnly: boolean;
  picked?: boolean;
  onPick?: () => void;
  onSet: (f: (o: ExteriorOpening) => ExteriorOpening) => void;
  onRemove: () => void;
}) {
  const name = `${OPENING_LABEL[o.kind]} ${n}`;
  return (
    <>
      <Cell label={name}>
        <select aria-label={`${name}: kind`} className={picked ? "exterior-picked" : undefined} value={o.kind} disabled={readOnly} onFocus={onPick} onChange={(e) => onSet((x) => ({ ...x, kind: e.target.value as ExteriorOpeningKind, confirmed: true }))}>
          {(Object.keys(OPENING_LABEL) as ExteriorOpeningKind[]).map((k) => (
            <option key={k} value={k}>
              {OPENING_LABEL[k]}
            </option>
          ))}
        </select>
      </Cell>
      <Cell label="Width">
        <FeetInput label={`${name}: width`} value={o.widthFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, widthFeet: v }))} />
      </Cell>
      <Cell label="Height">
        <FeetInput label={`${name}: height`} value={o.heightFeet} readOnly={readOnly} onCommit={(v) => v !== null && onSet((x) => ({ ...x, heightFeet: v }))} />
      </Cell>
      <Cell label="Sill, from grade">
        <FeetInput label={`${name}: sill from grade`} value={o.sillFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, sillFeet: v }))} />
      </Cell>
      <Cell label="From the left corner">
        <FeetInput label={`${name}: from the left corner`} value={o.fromLeftFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onSet((x) => ({ ...x, fromLeftFeet: v }))} />
      </Cell>
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

/**
 * The side's trim (2026-10-17): each surround and column read off its photo, in a line with what it adds up to, and
 * a way to take one away that isn't there. Nothing at all on a side with none.
 */
function TrimList({ side, sq, readOnly, onUpdate }: { side: ExteriorSide; sq: SideQuantities; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const t = sq.trim;
  if (!t) return null;
  const surrounds = side.openings.map((o, i) => ({ o, n: i + 1 })).filter(({ o }) => o.trim);
  const columns = side.columns ?? [];
  const row = (key: string, label: string, note: string, remove: () => void) => (
    <div className="exterior-row" key={key}>
      <span className="exterior-row-label">{label}</span>
      <span className="exterior-row-note">{note}</span>
      {!readOnly && (
        <button type="button" className="btn-secondary exterior-row-x" aria-label={`Take away ${label.toLowerCase()}`} onClick={remove}>
          ×
        </button>
      )}
    </div>
  );
  return (
    <>
      <h4 className="exterior-subhead">Trim</h4>
      <div className="exterior-rows">
        {surrounds.map(({ o, n }) => {
          const q = t.surrounds.find((g) => g.openingId === o.id);
          return row(
            `s-${o.id}`,
            `${OPENING_LABEL[o.kind]} ${n}'s surround`,
            `${surroundWords(o.trim as OpeningTrim).replace(/^surround /, "")}${q ? ` · ${lf(q.linearFeet)}, ${sf(q.squareFeet)}` : ""}`,
            () => onUpdate((s) => ({ ...s, openings: s.openings.map((x) => (x.id === o.id ? (({ trim: _t, ...rest }) => rest)(x) : x)) })),
          );
        })}
        {columns.map((c, i) => {
          const q = t.columns.find((g) => g.id === c.id);
          const blocks = [c.base ? "base" : "", c.cap ? "cap" : ""].filter(Boolean).join(" and ");
          return row(
            `c-${c.id}`,
            `${COLUMN_LABEL[c.kind]} ${i + 1}`,
            `${formatOpeningSize(c.widthFeet, c.heightFeet)}${blocks ? `, ${blocks}` : ""}${q ? ` · ${sf(q.wrapSquareFeet)} wrap` : ""}`,
            () => onUpdate((s) => ({ ...s, columns: (s.columns ?? []).filter((x) => x.id !== c.id) })),
          );
        })}
        <p className="field-note">Off this side&apos;s cladding: {sf(t.squareFeet)}, as an opening comes off it.</p>
      </div>
    </>
  );
}

/** What is on a wall: replaced, or taken off and put back for the cladding. */
function FixturesEditor({ side, readOnly, onUpdate }: { side: ExteriorSide; readOnly: boolean; onUpdate: (f: (side: ExteriorSide) => ExteriorSide) => void }) {
  const fixtures = side.fixtures ?? [];
  const setFixture = (fid: string, f: (x: SideFixture) => SideFixture) => onUpdate((s) => ({ ...s, fixtures: (s.fixtures ?? []).map((x) => (x.id === fid ? f(x) : x)) }));
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
            <button type="button" className="btn-secondary exterior-row-x" aria-label={`Remove ${SIDE_FIXTURE_LABEL[f.kind]}`} onClick={() => onUpdate((s) => ({ ...s, fixtures: (s.fixtures ?? []).filter((x) => x.id !== f.id) }))}>
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
