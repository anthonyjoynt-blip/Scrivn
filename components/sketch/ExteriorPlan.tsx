"use client";

import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formatFeetInches, parseFeetInches } from "@/lib/sketch";
import {
  DEFAULT_EAVE_FEET,
  DEFAULT_EAVE_OVERHANG_FEET,
  DEFAULT_ELBOWS_PER_DOWNSPOUT,
  DEFAULT_RAKE_OVERHANG_FEET,
  defaultRoof,
  endsFromPhotos,
  type Exterior,
  type ExteriorQuantities,
  type ExteriorRoof,
  FEET_PER_DOWNSPOUT,
  formatPitch,
  lowerRoofsFromPhotos,
  photoFloorLine,
  photoNotes,
  photoPitches,
  photoReads,
  photoRoofCheck,
  photoRoofPieces,
  photoStoreys,
  photoSectionBreaks,
  photoSectionPitches,
  pieceLine,
  resolvedOverhang,
  ridgeAcrossParty,
  ridgeFromPhotos,
  ROOF_MATERIAL_LABEL,
  roofProposal,
  HOME_TYPE_LABEL,
  isAttachedHome,
  type HomeType,
  sharedOf,
  sharedSides,
  ROOF_VENT_LABEL,
  type RoofingQuantities,
  type RoofMaterial,
  type RoofTotalKey,
  type RoofVentKind,
  type SideTurn,
  sourceWords,
  UPPER_STOREY_FEET,
  unseenState,
} from "@/lib/exterior";
import {
  type AdditionKind,
  closeOutline,
  closeWalk,
  exteriorFromOutline,
  MIN_SIDE_FEET,
  roofWithoutSides,
  sideChain,
  snapOutlinePoint,
  splitTallSides,
  startWalk,
  TALL_SIDE_FEET,
  tallSides,
  toggledEnd,
  upperFromOutline,
  walkState,
  withAddition,
  withNextSide,
  withOneSlope,
  withRoofEnd,
  withSectionBreak,
  withSectionPitch,
  withSideLength,
  withoutUpper,
  withUpperSideLength,
} from "@/lib/exteriorPlan";
import { bearingWords, FRONT_FACES_CHOICES, frontFacesOf, normalDeg } from "@/lib/exteriorViews";
import type { Pt, RoofAddition, RoofPlan } from "@/lib/roof";
import { withWingAnswer } from "@/lib/roofCheck";
import { textWidthEm } from "@/lib/roofLabels";
import { pickableEdge, type RoofPick, RoofLegend, RoofPlanDrawing, type RoofPlanMode } from "./exteriorDrawings";
import { Cell, Choice, FeetField, FeetInput, lf, listOf, NumberField, sf, YesNo } from "./exteriorFields";
import { ExteriorSizes } from "./ExteriorSizes";
import { useExteriorSubject } from "./exteriorSubject";
import { RoofCheckPanel, RoofParts } from "./RoofCheck";
import { RoofPiecesPanel } from "./RoofPieces";
import { RoofTotalsPanel } from "./RoofTotals";

/**
 * The exterior's plan (2026-10-13): the house from above, its footprint and the roof over it, on one
 * screen with nothing to find. The owner, the first time: "Outside of the house is rectangle or L
 * shaped?", and he could not find the roof - it waited for a pitch, on a tab of its own.
 *
 *   * EMPTY: the plan to draw on, corner by corner as the interior's Wall tool draws a room, and
 *     beside it the other ways in - the front's length and then side by side, or a quick shape.
 *   * GOING ROUND, side by side: the sides so far, and the next one's corner and length.
 *   * CLOSED: the roof plan, at an assumed pitch until one is typed. A side's name opens it face-on,
 *     an end's pill switches it between gable and hip, and a porch or cross gable goes on a side
 *     with a tap. The lengths round the house are typed beside it, and the roof's settings and the
 *     owner's questions under that.
 *
 * The model is lib/exterior.ts; what the taps do to it is lib/exteriorPlan.ts.
 */

type Change = (f: (exterior: Exterior) => Exterior) => void;

// ---------------------------------------------------------------------------------------------
// Starting one
// ---------------------------------------------------------------------------------------------

/** A length box that holds what is typed, for a start button beside it to read. */
function LengthBox({ id, label, text, onText, onEnter, placeholder }: { id: string; label: string; text: string; onText: (t: string) => void; onEnter?: () => void; placeholder?: string }) {
  return (
    <input
      id={id}
      className="exterior-feet"
      type="text"
      inputMode="text"
      autoComplete="off"
      aria-label={label}
      value={text}
      placeholder={placeholder}
      onChange={(e) => onText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onEnter) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}

const lengthOf = (text: string): number | null => {
  const v = parseFeetInches(text);
  return v !== null && v >= MIN_SIDE_FEET ? v : null;
};

export function ExteriorStart({ readOnly, onStart }: { readOnly: boolean; onStart: (exterior: Exterior) => void }) {
  // "the house", or the other building being measured (2026-10-16): "the shed".
  const { the } = useExteriorSubject();
  const [eave, setEave] = useState<number | null>(DEFAULT_EAVE_FEET);
  const [front, setFront] = useState("");

  if (readOnly) {
    return <p className="field-note">No exterior has been measured on this claim. Unlock the sketch to start one.</p>;
  }
  const eaveFeet = eave ?? DEFAULT_EAVE_FEET;
  const frontFeet = lengthOf(front);
  const startWalking = () => frontFeet !== null && onStart(startWalk(frontFeet, eaveFeet));

  return (
    <div className="exterior-start">
      <div>
        <h3>Draw the outside of {the}</h3>
        <p className="field-note">
          Tap each corner of {the} in turn, going round it, then tap the first corner again. The street side goes at the bottom. Rough is fine: type the real lengths after. The roof
          appears as soon as the outline closes, and each side opens face-on for its windows, doors and heights.
        </p>
      </div>
      <FootprintDraw
        onClose={(ring) => {
          const next = exteriorFromOutline(ring, eaveFeet);
          if (next) onStart(next);
        }}
      />
      <div className="exterior-start-ways">
        <div className="exterior-start-way">
          <h4 className="exterior-subhead">Or go round it side by side</h4>
          <p className="field-note">Type the front&rsquo;s length, then add each next side round to the right with its corner and its length, as you tape it.</p>
          <div className="exterior-row">
            <LengthBox id="ext-start-front" label="The front's length" text={front} onText={setFront} onEnter={startWalking} placeholder="Front, e.g. 42'6&quot;" />
            <button type="button" className="btn-primary" disabled={frontFeet === null} onClick={startWalking}>
              Start with the front
            </button>
          </div>
        </div>
        <div className="exterior-start-way">
          <h4 className="exterior-subhead">Or type the roof&rsquo;s totals</h4>
          <p className="field-note">From a roof report, or measured by hand, with no outline drawn: the squares, the pitch and the lengths. The outline can be drawn after.</p>
          <button type="button" className="btn-secondary" onClick={() => onStart({ sides: [], roof: { ...defaultRoof(), typed: {} } })}>
            Type the roof&rsquo;s totals
          </button>
        </div>
        <FeetField id="ext-start-eave" label="Eave height, from grade" value={eave} onCommit={setEave} note="Every side starts at this; change any side after." />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Drawing the outline
// ---------------------------------------------------------------------------------------------

/** The plan drawn on: 100' by 70' in feet, y up, with room under it for the street. */
const DRAW_VIEW = { x0: -5, x1: 95, y0: -9, y1: 65 };
/**
 * How near the first corner a tap closes the outline: a fingertip on screen, but never more than 3'
 * of house - zoomed out on a phone a fingertip is 6', and a jog's corner that close to the first one
 * is a corner, not a close. The Close button closes from anywhere.
 */
const CLOSE_PX = 22;
const CLOSE_MAX_FEET = 3;
/** A last corner this close to lining up with the first slides along its wall to line up as it closes: a tap's slip, not a jog. */
const LINE_UP_FEET = 1.5;

const segmentsMeet = (a: Pt, b: Pt, c: Pt, d: Pt) =>
  Math.min(a.x, b.x) <= Math.max(c.x, d.x) + 1e-9 && Math.min(c.x, d.x) <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) <= Math.max(c.y, d.y) + 1e-9 && Math.min(c.y, d.y) <= Math.max(a.y, b.y) + 1e-9;

/** Whether a wall from the last corner to `p` would cross or touch a wall already drawn, other than the one it turns from. */
function crossesDraft(draft: Pt[], p: Pt): boolean {
  const last = draft[draft.length - 1];
  if (!last) return false;
  for (let i = 0; i + 2 < draft.length; i++) if (segmentsMeet(draft[i] as Pt, draft[i + 1] as Pt, last, p)) return true;
  return false;
}

/**
 * The plan to draw the outline on (2026-10-13), the interior Wall tool's way: a tap is a corner, on
 * a one-foot grid and square to the wall before it (`snapOutlinePoint`), and a tap back on the first
 * corner closes it (`closeOutline`). Drawn as SVG in plan feet, front at the bottom, as the roof plan
 * is. `guide` is an outline to draw over, faint: the one being redrawn.
 */
export function FootprintDraw({ onClose, guide, onCancel, snapTo }: { onClose: (ring: Pt[]) => void; guide?: Pt[]; onCancel?: () => void; snapTo?: { xs: number[]; ys: number[] } }) {
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const press = useRef<{ x: number; y: number } | null>(null);

  // The plan grows past 100' by 70' to hold the outline being redrawn, and any corner tapped near its edge: a long ranch fits.
  const view = (() => {
    const pts = [...(guide ?? []), ...draft];
    if (pts.length === 0) return DRAW_VIEW;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const m = 8;
    return { x0: Math.min(DRAW_VIEW.x0, Math.min(...xs) - m), x1: Math.max(DRAW_VIEW.x1, Math.max(...xs) + m), y0: Math.min(DRAW_VIEW.y0, Math.min(...ys) - m), y1: Math.max(DRAW_VIEW.y1, Math.max(...ys) + m) };
  })();
  const vw = view.x1 - view.x0;
  const vh = view.y1 - view.y0;
  const fs = vw * 0.022;
  const Y = (y: number) => -y;

  const toPlan = (clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: -p.y };
  };
  const feetPerPixel = () => {
    const w = svgRef.current?.getBoundingClientRect().width ?? 0;
    return w > 0 ? vw / w : 0.25;
  };
  const nearFirst = (raw: Pt) => {
    const first = draft[0];
    return first !== undefined && draft.length >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) <= Math.min(CLOSE_MAX_FEET, CLOSE_PX * feetPerPixel());
  };

  function close() {
    const ring = closeOutline(draft, LINE_UP_FEET);
    if (!ring) {
      setMessage("That outline would cross itself. Undo a corner, or start over.");
      return;
    }
    setDraft([]);
    setHover(null);
    onClose(ring);
  }
  function tap(raw: Pt) {
    setMessage(null);
    if (nearFirst(raw)) {
      close();
      return;
    }
    const p = snapOutlinePoint(raw, draft, 1, snapTo);
    const last = draft[draft.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
    if (crossesDraft(draft, p)) {
      setMessage("That wall would cross one already drawn. Tap somewhere else, or undo a corner.");
      return;
    }
    setDraft([...draft, p]);
  }
  const undo = () => {
    setMessage(null);
    setDraft(draft.slice(0, -1));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    press.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    const down = press.current;
    press.current = null;
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    const p = toPlan(e.clientX, e.clientY);
    if (p) tap(p);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType !== "mouse") return;
    const p = toPlan(e.clientX, e.clientY);
    setHover(p);
  };
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if ((e.key === "Backspace" || e.key === "Delete") && draft.length > 0) {
      e.preventDefault();
      undo();
    } else if (e.key === "Enter" && draft.length >= 3) {
      e.preventDefault();
      close();
    } else if (e.key === "Escape" && onCancel) onCancel();
  };

  // Where a tap at the pointer would land, and the outline a close there would make.
  const closing = hover && nearFirst(hover) ? closeOutline(draft, LINE_UP_FEET) : null;
  const preview = hover && !closing ? snapOutlinePoint(hover, draft, 1, snapTo) : null;
  const shown = preview && draft.length > 0 ? [...draft, preview] : draft;
  const label = (a: Pt, b: Pt, key: string) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.5) return null;
    const upright = Math.abs(b.x - a.x) < 1e-9;
    const words = formatFeetInches(len);
    const w = textWidthEm(words) * fs + fs * 0.6;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    return (
      <g key={key} transform={`translate(${x} ${Y(y)})${upright ? " rotate(-90)" : ""}`} pointerEvents="none">
        <rect x={-w / 2} y={-fs * 0.7} width={w} height={fs * 1.4} rx={fs * 0.3} fill="#ffffff" fillOpacity={0.92} />
        <text x={0} y={fs * 0.35} fontSize={fs} fontWeight={600} textAnchor="middle" fill="#1b3a5c" fontFamily="system-ui, sans-serif">
          {words}
        </text>
      </g>
    );
  };
  const grid: [Pt, Pt][] = [];
  for (let gx = Math.ceil(view.x0 / 5) * 5; gx <= view.x1; gx += 5) grid.push([{ x: gx, y: view.y0 }, { x: gx, y: view.y1 }]);
  for (let gy = Math.ceil(view.y0 / 5) * 5; gy <= view.y1; gy += 5) grid.push([{ x: view.x0, y: gy }, { x: view.x1, y: gy }]);
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const hint =
    draft.length === 0
      ? "Tap where a corner of the house is."
      : draft.length < 3
        ? "Tap the next corner. Each wall goes square to the last."
        : "Tap the next corner, or tap the first corner again to close the outline.";

  return (
    <div className="exterior-draw">
      <svg
        ref={svgRef}
        className="exterior-svg exterior-draw-svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox={`${view.x0} ${Y(view.y1)} ${vw} ${vh}`}
        role="application"
        aria-label="Plan to draw the outline of the house on: tap each corner in turn"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <rect x={view.x0} y={Y(view.y1)} width={vw} height={vh} fill="#ffffff" />
        {grid.map(([a, b], i) => {
          const major = Math.abs(a.x === b.x ? a.x % 10 : a.y % 10) < 1e-9;
          return <line key={i} x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke={major ? "#d5dbe3" : "#eef1f5"} strokeWidth={1} {...stroke} />;
        })}
        {grid
          .filter(([a, b]) => a.x === b.x && a.x > view.x0 && Math.abs(a.x % 10) < 1e-9)
          .map(([a]) => (
            <text key={`gx-${a.x}`} x={a.x + fs * 0.2} y={Y(view.y1) + fs * 1.1} fontSize={fs * 0.75} fill="#9aa4b2" fontFamily="system-ui, sans-serif">
              {a.x}&prime;
            </text>
          ))}
        <text x={(view.x0 + view.x1) / 2} y={Y(view.y0) - fs * 0.7} fontSize={fs} textAnchor="middle" fill="#7c5a3a" fontFamily="system-ui, sans-serif" fontWeight={600}>
          ▼ Street side (the front) ▼
        </text>
        {guide && guide.length > 2 && (
          <polygon points={guide.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="#e5e7eb" fillOpacity={0.5} stroke="#9ca3af" strokeWidth={1.5} strokeDasharray="5 4" pointerEvents="none" {...stroke} />
        )}
        {closing && <polygon points={closing.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="#dcfce7" fillOpacity={0.6} stroke="#15803d" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" {...stroke} />}
        {shown.length > 1 && (
          <polyline points={shown.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#1b3a5c" strokeWidth={3} strokeLinejoin="round" pointerEvents="none" {...stroke} />
        )}
        {preview && draft.length > 0 && (
          <line x1={(draft[draft.length - 1] as Pt).x} y1={Y((draft[draft.length - 1] as Pt).y)} x2={preview.x} y2={Y(preview.y)} stroke="#ffffff" strokeWidth={2} strokeDasharray="5 5" pointerEvents="none" {...stroke} />
        )}
        {shown.slice(1).map((p, i) => label(shown[i] as Pt, p, `len-${i}`))}
        {draft.map((p, i) => (
          <circle key={`c-${i}`} cx={p.x} cy={Y(p.y)} r={i === 0 && draft.length >= 3 ? fs * 0.75 : fs * 0.4} fill={i === 0 && draft.length >= 3 ? "#dcfce7" : "#ffffff"} stroke={i === 0 && draft.length >= 3 ? "#15803d" : "#1b3a5c"} strokeWidth={2} pointerEvents="none" {...stroke} />
        ))}
        {preview && <circle cx={preview.x} cy={Y(preview.y)} r={fs * 0.35} fill="#1b3a5c" fillOpacity={0.35} pointerEvents="none" />}
      </svg>
      <div className="exterior-draw-bar">
        <p className="field-note" aria-live="polite">
          {hint}
        </p>
        <div className="exterior-row">
          <button type="button" className="btn-secondary" disabled={draft.length === 0} onClick={undo}>
            Undo corner
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={draft.length === 0}
            onClick={() => {
              setDraft([]);
              setMessage(null);
            }}
          >
            Start over
          </button>
          <button type="button" className="btn-primary" disabled={draft.length < 3} onClick={close}>
            Close the outline
          </button>
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
        {message && <p className="sketch-length-error">{message}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Going round side by side
// ---------------------------------------------------------------------------------------------

const turnOn = (d: Pt, turn: SideTurn): Pt => (turn === "outside" ? { x: -d.y, y: d.x } : { x: d.y, y: -d.x });

/**
 * The sides typed so far, walked from the front's left corner and not closed: each with its name
 * and length, where the walk started, and the next side as it would go (dashed) - what the
 * estimator sees grow as he goes round.
 */
function ChainDrawing({ exterior, next }: { exterior: Exterior; next: { turn: SideTurn; lengthFeet: number } | null }) {
  const sides = exterior.sides;
  const { points, dirs } = sideChain(sides);
  const end = points[points.length - 1] as Pt;
  const lastDir = dirs[dirs.length - 1] ?? { x: 1, y: 0 };
  const d = next ? turnOn(lastDir, next.turn) : null;
  const tip = d && next ? { x: end.x + d.x * next.lengthFeet, y: end.y + d.y * next.lengthFeet } : null;
  const all = [...points, ...(tip ? [tip] : [])];
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const fs = Math.max(0.8, Math.max(maxX - minX, maxY - minY, 20) * 0.035);
  const pad = fs * 6;
  const Y = (y: number) => -y;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const tag = (a: Pt, b: Pt, words: string, key: string, color: string) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const upright = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const m = { x: (a.x + b.x) / 2 + out.x * fs * 1.3, y: (a.y + b.y) / 2 + out.y * fs * 1.3 };
    return (
      <text key={key} x={m.x} y={Y(m.y) + fs * 0.35} fontSize={fs * 0.9} textAnchor="middle" fill={color} fontWeight={600} fontFamily="system-ui, sans-serif" transform={upright ? `rotate(-90 ${m.x} ${Y(m.y)})` : undefined}>
        {words}
      </text>
    );
  };
  return (
    <svg className="exterior-svg" xmlns="http://www.w3.org/2000/svg" viewBox={`${minX - pad} ${Y(maxY + pad)} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} role="img" aria-label="The sides typed so far, from above">
      <rect x={minX - pad} y={Y(maxY + pad)} width={maxX - minX + 2 * pad} height={maxY - minY + 2 * pad} fill="#ffffff" />
      {sides.length >= 2 && <line x1={end.x} y1={Y(end.y)} x2={0} y2={0} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 4" {...stroke} />}
      <polyline points={points.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#1b3a5c" strokeWidth={3} strokeLinejoin="round" {...stroke} />
      {tip && <line x1={end.x} y1={Y(end.y)} x2={tip.x} y2={Y(tip.y)} stroke="#15803d" strokeWidth={3} strokeDasharray="7 5" {...stroke} />}
      {sides.map((s, i) => tag(points[i] as Pt, points[i + 1] as Pt, `${s.name.trim() || "Side"} ${formatFeetInches(s.lengthFeet)}`, s.id, "#1a1d23"))}
      {tip && next && tag(end, tip, `next ${formatFeetInches(next.lengthFeet)}`, "next", "#15803d")}
      <circle cx={0} cy={0} r={fs * 0.45} fill="#ffffff" stroke="#1b3a5c" strokeWidth={2} {...stroke} />
      <text x={0} y={fs * 1.6} fontSize={fs * 0.75} textAnchor="middle" fill="#6b7280" fontFamily="system-ui, sans-serif">
        start
      </text>
      <text x={(minX + maxX) / 2} y={Y(minY - pad) - fs * 0.6} fontSize={fs * 0.8} textAnchor="middle" fill="#7c5a3a" fontFamily="system-ui, sans-serif">
        ▼ Street side ▼
      </text>
    </svg>
  );
}

function WalkBuilder({ exterior, next, onNext, onChange }: { exterior: Exterior; next: { turn: SideTurn; text: string }; onNext: (n: { turn: SideTurn; text: string }) => void; onChange: Change }) {
  const w = walkState(exterior);
  const length = lengthOf(next.text);
  const closeHere = w.turnsClose && w.lastSide === null && w.gapFeet <= Math.max(3, w.perimeterFeet * 0.1);
  const add = () => {
    if (length === null) return;
    onChange((e) => withNextSide(e, next.turn, length));
    onNext({ ...next, text: "" });
  };
  return (
    <div className="exterior-walk">
      <h4 className="exterior-subhead">The next side round the house</h4>
      <p className="field-note">Facing the house, the next side is to the right of the last one. Round an outside corner the plan turns left; round an inside corner (the inside of an L) it turns right.</p>
      <div className="option-group" role="group" aria-label="The corner before the next side">
        {(
          [
            ["outside", "↰ Outside corner"],
            ["inside", "↱ Inside corner"],
          ] as const
        ).map(([turn, label]) => (
          <button key={turn} type="button" className={`option-btn${next.turn === turn ? " selected" : ""}`} aria-pressed={next.turn === turn} onClick={() => onNext({ ...next, turn })}>
            {label}
          </button>
        ))}
      </div>
      <div className="exterior-row">
        <label className="exterior-field-label" htmlFor="ext-next-length">
          Its length
        </label>
        <LengthBox id="ext-next-length" label="The next side's length" text={next.text} onText={(text) => onNext({ ...next, text })} onEnter={add} placeholder="e.g. 24'6&quot;" />
        <button type="button" className="btn-primary" disabled={length === null} onClick={add}>
          Add the side
        </button>
      </div>
      {w.lastSide && (
        <button type="button" className="btn-secondary" onClick={() => w.lastSide && onChange((e) => withNextSide(e, w.lastSide?.turn ?? "outside", w.lastSide?.lengthFeet ?? 0))}>
          Close it with {w.lastSide.name}, {formatFeetInches(w.lastSide.lengthFeet)}
        </button>
      )}
      {closeHere && (
        <button type="button" className="btn-secondary" onClick={() => onChange((e) => closeWalk(e) ?? e)}>
          Close the outline here ({formatFeetInches(w.gapFeet)} from the start, shared out over the sides)
        </button>
      )}
      {exterior.sides.length > 1 && (
        <button
          type="button"
          className="btn-secondary"
          onClick={() =>
            onChange((e) => {
              const gone = e.sides[e.sides.length - 1];
              if (!gone || e.sides.length < 2) return e;
              return { ...e, open: true, sides: e.sides.slice(0, -1), roof: roofWithoutSides(e.roof, (id) => id === gone.id), ...(e.scope ? { scope: { ...e.scope, sides: e.scope.sides.filter((s) => s !== gone.id) } } : {}) };
            })
          }
        >
          Take off the last side
        </button>
      )}
    </div>
  );
}

/** The sides in order round the house, each with its length to type and the way to it face-on. */
function SidesList({ exterior, q, readOnly, showTurns, onOpenSide, onChange }: { exterior: Exterior; q: ExteriorQuantities; readOnly: boolean; showTurns: boolean; onOpenSide: (id: string) => void; onChange: Change }) {
  const fp = q.footprint;
  return (
    <div className="exterior-rows">
      <h4 className="exterior-subhead">Sides, round the house from the front</h4>
      <div className="exterior-side-list">
        {exterior.sides.map((s, i) => {
          const name = s.name.trim() || "Side";
          const used = fp.closes ? fp.lengthsFeet[i] : undefined;
          return (
            <div className="exterior-side-item" key={s.id}>
              <button type="button" className="exterior-side-open" onClick={() => onOpenSide(s.id)} title={`See ${name} face-on`}>
                {name} <span aria-hidden="true">›</span>
              </button>
              <FeetInput label={`${name}: length`} value={s.lengthFeet} readOnly={readOnly} onCommit={(v) => v !== null && onChange((e) => withSideLength(e, s.id, v))} />
              {s.shared ? (
                <span className="exterior-row-note" title="Shared with the neighbour: not counted, and the roof stops at it">
                  shared wall
                </span>
              ) : unseenState(exterior, s) ? (
                <span className="exterior-row-note" title="No photo faces this wall: open it to say what windows and doors are on it">
                  not photographed
                </span>
              ) : null}
              {s.lengthFrom === "drawn" ? (
                <span className="exterior-drawn" title="As long as it was drawn: type its length as taped">
                  drawn
                </span>
              ) : used !== undefined && Math.abs(used - s.lengthFeet) > 1 / 96 ? (
                <span className="exterior-row-note">uses {formatFeetInches(used)}</span>
              ) : null}
              {showTurns && (
                <select
                  aria-label={`${name}: the corner at its right-hand end`}
                  value={s.turn}
                  disabled={readOnly}
                  onChange={(e) => onChange((x) => ({ ...x, sides: x.sides.map((y) => (y.id === s.id ? { ...y, turn: e.target.value === "inside" ? "inside" : "outside" } : y)) }))}
                >
                  <option value="outside">then an outside corner</option>
                  <option value="inside">then an inside corner</option>
                </select>
              )}
            </div>
          );
        })}
      </div>
      <p className="field-note">
        {fp.closes
          ? "Type each side as taped: the corner at its right-hand end moves, and the sides only drawn follow. A side marked drawn is as long as it was drawn."
          : "Each side's length, and the corner at its right-hand end as you face it: outside, or inside (the inside of an L)."}
      </p>
      {/* Semi-detached houses and townhouses (2026-10-17): the kind of home, for the report; each shared wall is set on its side. */}
      <label className="exterior-field" htmlFor="ext-home-type">
        <span className="exterior-field-label">The home</span>
        <select
          id="ext-home-type"
          value={exterior.homeType ?? "detached"}
          disabled={readOnly}
          onChange={(e) =>
            onChange((x) => {
              const { homeType: _was, ...rest } = x;
              const v = e.target.value as HomeType;
              return v === "detached" ? rest : { ...rest, homeType: v };
            })
          }
        >
          {(Object.keys(HOME_TYPE_LABEL) as HomeType[]).map((k) => (
            <option key={k} value={k}>
              {HOME_TYPE_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      {isAttachedHome(exterior.homeType) && !exterior.sides.some((s) => s.shared) && (
        <p className="field-note">Open each wall shared with the neighbour and set it shared: it is then not counted, and the roof stops at it.</p>
      )}
      <FrontFaces exterior={exterior} readOnly={readOnly} onChange={onChange} />
    </div>
  );
}

/**
 * Which way the front faces (2026-10-20, the owner: "fix the front label to north"): one tap, never asked and never in
 * the way. Set, the report names its four views north, south, east and west and the plans get a north arrow; not set,
 * the views are the front, back and sides. A bearing between the eight (20 degrees, say) shows on its nearest.
 */
function FrontFaces({ exterior, readOnly, onChange }: { exterior: Exterior; readOnly: boolean; onChange: Change }) {
  const deg = frontFacesOf(exterior);
  const near = deg === undefined ? null : (FRONT_FACES_CHOICES.reduce((a, b) => (turnBetween(b.deg, deg) < turnBetween(a.deg, deg) ? b : a)).deg as number);
  const set = (v: number | null) =>
    onChange((x) => {
      const { frontFacesDeg: _was, ...rest } = x;
      return v === null ? rest : { ...rest, frontFacesDeg: v };
    });
  return (
    <div className="exterior-field">
      <span className="exterior-field-label" id="ext-front-faces">
        Front faces
      </span>
      <div className="option-group exterior-compass" role="group" aria-labelledby="ext-front-faces">
        {FRONT_FACES_CHOICES.map((c) => (
          <button
            key={c.deg}
            type="button"
            className={`option-btn${near === c.deg ? " selected" : ""}`}
            aria-pressed={near === c.deg}
            aria-label={`Front faces ${c.words}`}
            disabled={readOnly}
            onClick={() => near !== c.deg && set(c.deg)}
          >
            {c.label}
          </button>
        ))}
        <button type="button" className={`option-btn${deg === undefined ? " selected" : ""}`} aria-pressed={deg === undefined} disabled={readOnly} onClick={() => deg !== undefined && set(null)}>
          Not set
        </button>
      </div>
      <p className="field-note">
        {deg === undefined
          ? "For the report: its views are named front, back and sides until this is set."
          : `The report names its views by the way each wall faces${deg % 45 !== 0 ? ` (the front faces ${bearingWords(deg)})` : ""}.`}
      </p>
    </div>
  );
}

/** How far apart two bearings are, the short way round, in degrees. */
function turnBetween(a: number, b: number): number {
  const d = normalDeg(a - b);
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------

const ADDITION_LABEL: Record<AdditionKind, string> = {
  porch: "Porch: the slope carried on",
  leanto: "Porch: lower, against the wall",
  gable: "Cross gable",
};
const PLACING_WORDS: Record<AdditionKind, string> = { porch: "porch roof", leanto: "lean-to porch", gable: "cross gable" };
const additionKind = (a: RoofAddition): AdditionKind => (a.kind === "gable" ? "gable" : a.lower ? "leanto" : "porch");

/** A section of the roof as the estimator calls it, by its key (`RoofSection.key`). */
export function sectionName(key: string, exterior: Exterior, nameOf: (id: string) => string): string {
  if (key === "main") return "The main roof";
  const wing = /^wing:(.+)$/.exec(key)?.[1];
  if (wing !== undefined) return `The roof out to ${nameOf(wing)}`;
  const over = /^over-(.+)$/.exec(key)?.[1];
  if (over !== undefined) return `The gable over the roof out to ${nameOf(over)}`;
  const add = (exterior.roof.additions ?? []).find((a) => a.id === key);
  if (add) {
    const words = PLACING_WORDS[additionKind(add)];
    return `The ${words} on ${nameOf(add.sideId)}`;
  }
  return "This part of the roof";
}

/**
 * The section picked in Pitch mode, its pitch typed: blank is the roof's own (a porch or cross
 * gable's, the slope's it comes off). The main roof's pitch is the roof's.
 */
function SectionPitch({ exterior, plan, sectionKey, readOnly, nameOf, onUpdate }: { exterior: Exterior; plan: RoofPlan; sectionKey: string; readOnly: boolean; nameOf: (id: string) => string; onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void }) {
  const section = plan.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const main = sectionKey === "main";
  const own = main ? exterior.roof.pitch : (exterior.roof.sectionPitches?.[sectionKey] ?? null);
  // Its own gable's photo, when one was read and nothing typed is set over it (2026-10-15).
  const photo = main ? undefined : photoSectionPitches(exterior)[sectionKey];
  const photoSides = main ? [] : (photoPitches(exterior).sections[sectionKey] ?? []);
  return (
    <div className="exterior-chosen exterior-section-pitch">
      <NumberField
        id="ext-section-pitch"
        label={`${sectionName(sectionKey, exterior, nameOf)}: pitch (rise in 12)`}
        value={own}
        placeholder={`${Math.round(section.pitch * 100) / 100}${main ? "" : photo !== undefined ? " from photos" : " as the roof"}`}
        readOnly={readOnly}
        max={48}
        onCommit={(v) => onUpdate((x) => withSectionPitch(x, sectionKey, v))}
        note={
          main
            ? "The roof's own pitch: every other part takes it unless given its own."
            : own !== null
              ? `Its own pitch. Clear it to go back to ${photo !== undefined ? "its gable's photo" : "the roof's"}.`
              : photo !== undefined
                ? `Blank: ${formatPitch(photo)}, read off its gable's photo (${photoSides.map((r) => r.name).join(", ")}).`
                : `Blank: ${formatPitch(section.pitch)}, the same as the roof it is part of.`
        }
      />
      {!section.planes && <SectionBreak exterior={exterior} plan={plan} sectionKey={sectionKey} readOnly={readOnly} onUpdate={onUpdate} />}
    </div>
  );
}

/**
 * A gambrel or mansard (2026-10-15): the picked part's pitch is the steep one below the break, and a
 * second, flatter one above it - 0 for a mansard's flat top. Gable ends make it a gambrel, hip ends a
 * mansard. Typed first, else its gable's photo, as the pitch below it is. The maths is lib/roof.ts (`withBreaks`).
 */
function SectionBreak({ exterior, plan, sectionKey, readOnly, onUpdate }: { exterior: Exterior; plan: RoofPlan; sectionKey: string; readOnly: boolean; onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void }) {
  const section = plan.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  const said = exterior.roof.sectionBreaks?.[sectionKey] ?? null;
  // Not typed: its gable's photo, when one read a break (lib/exterior.ts `photoSectionBreaks`).
  const photo = said === null ? (photoSectionBreaks(exterior)[sectionKey] ?? null) : null;
  const brk = said ?? photo;
  const ridge = (section.axis === "x" ? section.y1 - section.y0 : section.x1 - section.x0) / 2;
  const why =
    brk === null
      ? "Blank: one pitch from eave to ridge. For a gambrel (gable ends) or a mansard (hip ends), type the flatter pitch above the break and the break's height."
      : section.break
        ? `${formatPitch(section.pitch)} up to the break, ${formatPitch(section.break.pitch)} above it${photo ? `, ${formatFeetInches(photo.breakFeet)} over the eave, from photos. Type a pitch to set your own.` : ". Clear the upper pitch for one pitch."}`
        : !(brk.breakFeet > 0)
          ? "Type the break's height above the eave."
          : !(brk.upperPitch < section.pitch)
            ? `The pitch above the break${photo ? " the photos read" : ""} has to be flatter than the ${formatPitch(section.pitch)} below it.`
            : brk.breakFeet + resolvedOverhang(exterior, "eave").feet * (section.pitch / 12) >= ridge * (section.pitch / 12)
              ? "That break is as high as the ridge would be, so there is none: check its height."
              : "The break is left out: the note under the plan says why.";
  return (
    <div className="exterior-grid">
      <NumberField
        id="ext-section-upper"
        label="Pitch above a break (gambrel, mansard)"
        value={said?.upperPitch ?? null}
        placeholder={photo ? `${Math.round(photo.upperPitch * 100) / 100} from photos` : "none"}
        readOnly={readOnly}
        max={24}
        onCommit={(v) => onUpdate((x) => withSectionBreak(x, sectionKey, v === null ? null : { upperPitch: v, breakFeet: x.sectionBreaks?.[sectionKey]?.breakFeet ?? photo?.breakFeet ?? 0 }))}
        note={why}
      />
      {said !== null && (
        <FeetField
          id="ext-section-break"
          label="Break, its height above the eave"
          value={said.breakFeet > 0 ? said.breakFeet : null}
          readOnly={readOnly}
          onCommit={(v) => v !== null && onUpdate((x) => withSectionBreak(x, sectionKey, { upperPitch: x.sectionBreaks?.[sectionKey]?.upperPitch ?? 0, breakFeet: v }))}
        />
      )}
    </div>
  );
}

export function PlanPane({
  exterior,
  q,
  readOnly,
  onChange,
  onOpenSide,
  onRemoveAll,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  readOnly: boolean;
  onChange: Change;
  onOpenSide: (id: string) => void;
  onRemoveAll: () => void;
}) {
  const [mode, setMode] = useState<RoofPlanMode>("shape");
  const [placing, setPlacing] = useState<AdditionKind | null>(null);
  /** In Pitch mode, the section tapped. */
  const [sectionKey, setSectionKey] = useState<string | null>(null);
  /** Drawing a two-storey house's upper floor over the plan. */
  const [drawingUpper, setDrawingUpper] = useState(false);
  const [redrawing, setRedrawing] = useState(false);
  const [confirm, setConfirm] = useState<"redraw" | "remove" | null>(null);
  const [next, setNext] = useState<{ turn: SideTurn; text: string }>({ turn: "outside", text: "" });
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const fp = q.footprint;
  // On another building (2026-10-16) removing its exterior removes the building: said so, by its name.
  const { the, isHouse } = useExteriorSubject();

  // Drawn narrow (a phone), the plan letters bigger: its own 3% is too fine there to read or to tap.
  useEffect(() => {
    if (!figure) return;
    const watch = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 1000) < 520));
    watch.observe(figure);
    return () => watch.disconnect();
  }, [figure]);
  // Putting a porch on, pressed under the plan: the plan, where its side is tapped, comes into view.
  useEffect(() => {
    if (placing && figure) figure.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [placing, figure]);
  // A roof report is checked against what the photos read as well as the drawing (2026-10-15): built only while there is one.
  const photoCheck = useMemo(() => (exterior.roof.report ? photoRoofCheck(exterior) : null), [exterior]);
  const plan = q.roof;
  const r = q.roofing;
  const roof = exterior.roof;
  const nameOf = (id: string) => exterior.sides.find((s) => s.id === id)?.name.trim() || "Side";
  const updateRoof = (f: (roof: ExteriorRoof) => ExteriorRoof) => onChange((e) => ({ ...e, roof: f(e.roof) }));
  const sideFeet = (id: string) => fp.lengthsFeet[fp.sideIds.indexOf(id)] ?? exterior.sides.find((s) => s.id === id)?.lengthFeet ?? 0;

  const ending = (
    <>
      {!readOnly &&
        (confirm ? (
          <div className="sketch-undo" role="alert">
            <span>
              {confirm === "redraw"
                ? `Draw the outline again? Its ${exterior.sides.length} sides go, with what is on them; the roof's answers stay.`
                : !isHouse
                  ? `Remove ${the} from the claim, with its ${exterior.sides.length} side${exterior.sides.length === 1 ? "" : "s"} and roof?`
                  : exterior.sides.length > 0
                    ? `Remove all ${exterior.sides.length} sides and the roof?`
                    : "Remove the roof's totals and answers?"}
            </span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (confirm === "redraw") setRedrawing(true);
                else onRemoveAll();
                setConfirm(null);
              }}
            >
              {confirm === "redraw" ? "Draw again" : "Remove"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
              Keep
            </button>
          </div>
        ) : (
          <div className="exterior-row">
            {exterior.sides.length > 0 && (
              <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("redraw")}>
                Draw the outline again…
              </button>
            )}
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("remove")}>
              {isHouse ? "Remove the exterior…" : `Remove ${the}…`}
            </button>
          </div>
        ))}
    </>
  );

  // The upper floor traced over the main floor's outline: a corner within a foot of one of its walls goes on it.
  if (drawingUpper && fp.closes) {
    const put = (ring: Pt[]) =>
      onChange((e) => {
        const up = upperFromOutline(ring, fp);
        return up ? { ...withoutUpper(e), upper: up } : e;
      });
    return (
      <div className="exterior-redraw">
        <p className="field-note">
          Tap the upper floor&rsquo;s corners over the main floor (faint), going round it, and close it on its first corner. Within a foot of one of the main floor&rsquo;s walls a corner goes
          on it, so a wall flush with the one below is flush. It may stand out past them up to 2&prime;, a cantilever: its underside is soffit.
        </p>
        <div className="exterior-row">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDrawingUpper(false);
              put(fp.corners);
            }}
          >
            Over the whole main floor
          </button>
        </div>
        <FootprintDraw
          guide={fp.corners}
          snapTo={{ xs: fp.corners.map((c) => c.x), ys: fp.corners.map((c) => c.y) }}
          onCancel={() => setDrawingUpper(false)}
          onClose={(ring) => {
            setDrawingUpper(false);
            put(ring);
          }}
        />
      </div>
    );
  }

  if (redrawing) {
    return (
      <div className="exterior-redraw">
        <p className="field-note">Draw the new outline over the old one (faint). Closing it replaces the sides; the roof&rsquo;s answers are kept.</p>
        <FootprintDraw
          guide={fp.closes ? fp.corners : undefined}
          onCancel={() => setRedrawing(false)}
          onClose={(ring) => {
            setRedrawing(false);
            onChange((e) => {
              const eave = e.sides[0]?.eaveLeftFeet ?? DEFAULT_EAVE_FEET;
              const fresh = exteriorFromOutline(ring, eave);
              if (!fresh) return e;
              const out: Exterior = { ...e, sides: fresh.sides, roof: { ...roofWithoutSides(e.roof, () => true), slopes: null, edges: null, ridgeVents: undefined } };
              delete out.open;
              if (out.scope) out.scope = { ...out.scope, sides: [] };
              if (out.source) out.source = { ...out.source, walkClosed: undefined };
              return out;
            });
          }}
        />
      </div>
    );
  }

  // The totals typed by the estimator, and the pieces the drawing can't make put on top of it (lib/roofPieces.ts).
  const totals = (showPitch: boolean) => (
    <>
      <RoofTotalsPanel roof={roof} r={r} pitch={q.pitch} showPitch={showPitch} photoCheck={photoCheck} readOnly={readOnly} onUpdate={updateRoof} />
      <RoofPiecesPanel
        roof={roof}
        roofPitch={r?.pitch ?? q.pitch.value ?? 0}
        readOnly={readOnly}
        onUpdate={updateRoof}
        fromPhotos={photoRoofPieces(exterior, q.roof, r?.pitch ?? q.pitch.value ?? 0)}
        onChange={onChange}
      />
    </>
  );

  // Only the roof's totals, typed: nothing to draw on until an outline is drawn.
  if (exterior.sides.length === 0) {
    return (
      <div className="exterior-pane">
        <div className="exterior-fields">
          {totals(true)}
          <RoofingFields roof={roof} r={r} readOnly={readOnly} onUpdate={updateRoof} />
          {r && <RoofFigures r={r} floorSoffitSquareFeet={q.floorSoffitSquareFeet} />}
          {ending}
        </div>
        {!readOnly && (
          <figure className="exterior-figure">
            <h4 className="exterior-subhead">Draw the outline too</h4>
            <p className="field-note">For the siding, and a roof plan on the documents: tap the corners of the house. What is typed stays, over the drawing&rsquo;s.</p>
            <FootprintDraw
              onClose={(ring) =>
                onChange((e) => {
                  const fresh = exteriorFromOutline(ring, DEFAULT_EAVE_FEET);
                  return fresh ? { ...e, sides: fresh.sides } : e;
                })
              }
            />
          </figure>
        )}
      </div>
    );
  }

  if (!fp.closes || !plan) {
    const nextLength = lengthOf(next.text);
    return (
      <div className="exterior-pane">
        <figure className="exterior-figure">
          <ChainDrawing exterior={exterior} next={!readOnly && nextLength !== null ? { turn: next.turn, lengthFeet: nextLength } : null} />
          <figcaption className="field-note">{fp.reason}</figcaption>
        </figure>
        <div className="exterior-fields">
          {!readOnly && <WalkBuilder exterior={exterior} next={next} onNext={setNext} onChange={onChange} />}
          <SidesList exterior={exterior} q={q} readOnly={readOnly} showTurns={!exterior.open} onOpenSide={onOpenSide} onChange={onChange} />
          <ExteriorSizes exterior={exterior} readOnly={readOnly} onChange={onChange} />
          {totals(true)}
          {r && (
            <>
              <RoofingFields roof={roof} r={r} readOnly={readOnly} onUpdate={updateRoof} />
              <RoofFigures r={r} floorSoffitSquareFeet={q.floorSoffitSquareFeet} />
            </>
          )}
          {ending}
        </div>
      </div>
    );
  }

  const ridges = plan.lines.filter((l) => l.kind === "ridge");
  // The roof check (2026-10-16): a house that came in off photos has its roof's parts proposed; until the estimator says it looks
  // right, the parts, the ends and the porches stand first beside the plan.
  const proposal = roofProposal(exterior);
  const checking = proposal !== null && !roof.checkedAt;
  const fromPhotos = endsFromPhotos(exterior, plan);
  const endsFrom = (id: string) => (id in roof.ends ? "said" : fromPhotos.has(id) ? "photo" : "guess") as "said" | "photo" | "guess";
  const additions = <RoofAdditions exterior={exterior} readOnly={readOnly} nameOf={nameOf} sideFeet={sideFeet} placing={placing} onPlace={setPlacing} onUpdate={updateRoof} />;
  /** One more or one fewer of a choice that means "all" while it is null. */
  const toggleIn = (list: string[] | null | undefined, all: string[], key: string): string[] | null => {
    const current = list ?? all;
    const nextList = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    return all.every((k) => nextList.includes(k)) ? null : nextList;
  };
  function onPick(what: RoofPick, key: string) {
    if (readOnly || !plan) return;
    const facetKeys = plan.facets.map((f) => f.key);
    const edgeKeys = plan.edges.filter((e) => pickableEdge(e.kind)).map((e) => e.key);
    if (what === "section") setSectionKey(key);
    else if (what === "slope") updateRoof((x) => ({ ...x, slopes: toggleIn(x.slopes, facetKeys, key) }));
    else if (what === "edge") updateRoof((x) => ({ ...x, edges: toggleIn(x.edges, edgeKeys, key) }));
    else
      updateRoof((x) => {
        const current = x.ridgeVents ?? [];
        return { ...x, ridgeVents: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] };
      });
  }
  const chosenSlopes = r ? r.slopes.filter((s) => s.selected) : [];
  // Each section's pitch, for the Pitch mode's hint: one pitch, or each part with its own.
  const pitched = plan.sections.filter((s) => s.role !== "porch" || s.planes?.length);
  const pitchList = [...new Map(pitched.map((s) => [s.key, s])).values()]
    .filter((s) => s.key !== "")
    .map((s) => `${sectionName(s.key, exterior, nameOf)} ${formatPitch(s.pitch)}`);
  const hint = placing
    ? `Tap the side the ${PLACING_WORDS[placing]} goes on.`
    : mode === "shape"
      ? `Tap a side's name to see it face-on${plan.ends.length > 0 ? `, or Gable or Hip at an end of the roof to switch it` : ""}.`
      : mode === "pitch"
        ? `Tap a slope to set the pitch of its part of the roof. ${pitchList.join("; ")}.`
        : !r
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
      <figure className="exterior-figure" ref={setFigure}>
        {!readOnly && (
          <div className="exterior-pick-bar">
            <div className="option-group" role="group" aria-label="What a tap on the plan does">
              {(
                [
                  ["shape", "Roof shape"],
                  ["pitch", "Pitch"],
                  ["slopes", "Slopes to roof"],
                  ["edges", "Eaves & rakes"],
                  ["ridges", "Ridge vent"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`option-btn${mode === value ? " selected" : ""}`}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    setPlacing(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "slopes" && plan.facets.length > 0 && (
              <>
                <button type="button" className="btn-secondary" onClick={() => updateRoof((x) => ({ ...x, slopes: null }))}>
                  All
                </button>
                <button type="button" className="btn-secondary" onClick={() => updateRoof((x) => ({ ...x, slopes: [] }))}>
                  None
                </button>
              </>
            )}
            {mode === "edges" && (
              <>
                <button type="button" className="btn-secondary" onClick={() => updateRoof((x) => ({ ...x, edges: null }))}>
                  All
                </button>
                <button type="button" className="btn-secondary" onClick={() => updateRoof((x) => ({ ...x, edges: plan.edges.filter((e) => e.kind === "eave").map((e) => e.key) }))}>
                  Eaves only
                </button>
              </>
            )}
            {mode === "ridges" && ridges.length > 0 && (
              <button type="button" className="btn-secondary" onClick={() => updateRoof((x) => ({ ...x, ridgeVents: [] }))}>
                No ridge vent
              </button>
            )}
          </div>
        )}
        {q.pitch.source === "assumed" && (
          <p className="exterior-assumed">
            The roof is drawn at an assumed {formatPitch(plan.pitch)} until its pitch is typed (under The roof), read off a gable&apos;s photo (AI trace, on the side) or a gable peak is measured on a side.
          </p>
        )}
        <RoofPlanDrawing
          plan={plan}
          footprint={fp}
          nameOf={nameOf}
          slopes={roof.slopes ?? null}
          edges={roof.edges ?? null}
          ridgeVents={roof.ridgeVents ?? []}
          mode={readOnly ? "shape" : mode}
          onPick={readOnly ? undefined : onPick}
          onSide={(id) => {
            if (placing) {
              const kind = placing;
              // A cross gable goes over the side's door, when it has one: the gable over a front door (2026-10-16).
              const door = exterior.sides.find((s) => s.id === id)?.openings.find((o) => o.kind === "door");
              updateRoof((x) => withAddition(x, kind, id, sideFeet(id), door));
              setPlacing(null);
            } else onOpenSide(id);
          }}
          onEnd={
            readOnly
              ? undefined
              : (id) => {
                  const kind = toggledEnd(plan, id);
                  if (kind) updateRoof((x) => withRoofEnd(x, id, kind));
                }
          }
          placing={placing !== null}
          shared={sharedOf(exterior)}
          approx={(id) => {
            const s = exterior.sides.find((q) => q.id === id);
            return s?.lengthFrom === "drawn" || !!s?.lengthNotMeasured;
          }}
          fontScale={narrow ? 1.45 : 1}
          section={mode === "pitch" ? sectionKey : null}
          upper={q.upperFootprint?.closes ? q.upperFootprint.corners : null}
          frontFacesDeg={frontFacesOf(exterior)}
        />
        {mode === "pitch" && sectionKey && <SectionPitch exterior={exterior} plan={plan} sectionKey={sectionKey} readOnly={readOnly} nameOf={nameOf} onUpdate={updateRoof} />}
        <RoofLegend plan={plan} ridgeVent={(roof.ridgeVents ?? []).length > 0} upper={q.upperFootprint?.closes === true} />
        {hint && (
          <p className="field-note exterior-plan-hint">
            {hint}
            {placing && (
              <>
                {" "}
                <button type="button" className="btn-secondary" onClick={() => setPlacing(null)}>
                  Cancel
                </button>
              </>
            )}
          </p>
        )}
        {plan.note && <p className="field-note">{plan.note}</p>}
        <figcaption className="field-note">
          {`Roof plan, to scale, front at the bottom. Footprint ${sf(fp.areaSquareFeet)}, ${lf(fp.perimeterFeet)} round.` +
            (fp.misclosureFeet > 1 / 96 ? ` The sides as typed missed meeting by ${formatFeetInches(fp.misclosureFeet)}; that is shared out over them by length.` : "")}
        </figcaption>
      </figure>

      <div className="exterior-fields">
        {checking && plan.shape !== "other" && (
          <RoofCheckPanel plan={plan} roof={roof} proposal={proposal} drops={q.wingDrops} endsFrom={endsFrom} readOnly={readOnly} nameOf={nameOf} additions={additions} onUpdate={updateRoof} />
        )}
        <SidesList exterior={exterior} q={q} readOnly={readOnly} showTurns={false} onOpenSide={onOpenSide} onChange={onChange} />
        <ExteriorSizes exterior={exterior} readOnly={readOnly} onChange={onChange} />
        <RoofShapeFields
          exterior={exterior}
          q={q}
          plan={plan}
          readOnly={readOnly}
          nameOf={nameOf}
          proposal={proposal}
          partsAbove={checking && plan.shape !== "other"}
          additions={additions}
          onUpdate={updateRoof}
        />
        <UpperFloorFields
          exterior={exterior}
          q={q}
          plan={plan}
          readOnly={readOnly}
          nameOf={nameOf}
          onOpenSide={onOpenSide}
          onChange={onChange}
          onDraw={() => setDrawingUpper(true)}
          onUpdate={updateRoof}
        />
        {totals(false)}
        <RoofingFields roof={roof} r={r} readOnly={readOnly} onUpdate={updateRoof} />
        {r && <RoofFigures r={r} floorSoffitSquareFeet={q.floorSoffitSquareFeet} />}
        {ending}
      </div>
    </div>
  );
}

/** The roof's own numbers and what the outline can't say: pitch, overhangs, the main ridge, notches, wings, porches. */
function RoofShapeFields({
  exterior,
  q,
  plan,
  readOnly,
  nameOf,
  proposal,
  partsAbove,
  additions,
  onUpdate,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  plan: RoofPlan;
  readOnly: boolean;
  nameOf: (id: string) => string;
  /** What the roof check proposes for the parts not answered (lib/roofCheck.ts). */
  proposal: ReturnType<typeof roofProposal>;
  /** The parts and porches are on the roof check above, not here. */
  partsAbove: boolean;
  additions: ReactNode;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const roof = exterior.roof;
  return (
    <>
      <h4 className="exterior-subhead">The roof</h4>
      <div className="exterior-grid">
        <NumberField
          id="ext-pitch"
          label="Pitch (rise in 12)"
          value={roof.pitch}
          placeholder={
            q.pitch.source !== "typed" && q.pitch.value !== null
              ? `${Math.round(q.pitch.value * 100) / 100}${q.pitch.source === "assumed" ? " assumed" : q.pitch.source === "photos" ? " from photos" : ""}`
              : ""
          }
          readOnly={readOnly}
          max={24}
          onCommit={(v) => onUpdate((x) => ({ ...x, pitch: v }))}
          note={
            q.pitch.fromPhotos.length > 0
              ? `Read off the gables' photos: ${q.pitch.fromPhotos.map((f) => `${formatPitch(f.value)} (${f.name})`).join(", ")}.${roof.pitch === null ? " Left blank, the roof uses that." : ""}`
              : q.pitch.fromSides.length > 0
                ? `Measured gables give ${q.pitch.fromSides.map((f) => `${formatPitch(f.pitch)} (${f.name})`).join(", ")}.${roof.pitch === null ? " Left blank, the roof uses that." : ""}`
                : roof.pitch === null
                  ? `Nothing typed or measured, so the roof is at an assumed ${formatPitch(q.pitch.value ?? 0)}.`
                  : undefined
          }
        />
        {(["eave", "rake"] as const).map((which) => {
          // Typed, it is shown; else it is blank and says what the roof is drawn at, and where that came from (2026-10-15).
          const o = resolvedOverhang(exterior, which);
          const from = o.source === "photos" ? `from photos` : o.source === "scan" ? "read by the phone" : "default";
          return (
            <FeetField
              key={which}
              id={`ext-${which}-oh`}
              label={which === "eave" ? "Eave overhang" : "Rake overhang"}
              value={o.source === "typed" ? o.feet : null}
              placeholder={o.source === "typed" ? "" : `${formatFeetInches(o.feet)} ${from}`}
              readOnly={readOnly}
              allowZero
              nullable
              note={o.source === "photos" ? `Read off ${o.reads.map((r) => `${formatFeetInches(r.value)} (${r.name})`).join(", ")}.` : undefined}
              onCommit={(v) =>
                onUpdate((x) => {
                  const source = { ...x.overhangSource };
                  // Cleared: not typed any more - the photos', the phone's or the default again.
                  if (v === null) delete source[which];
                  else source[which] = "typed";
                  const feet = v ?? (which === "eave" ? DEFAULT_EAVE_OVERHANG_FEET : DEFAULT_RAKE_OVERHANG_FEET);
                  return which === "eave" ? { ...x, eaveOverhangFeet: feet, overhangSource: source } : { ...x, rakeOverhangFeet: feet, overhangSource: source };
                })
              }
            />
          );
        })}
      </div>
      {photoNotes(exterior).map((n) => (
        <p key={n} className="field-note">
          {n}
        </p>
      ))}
      {/* One slope (2026-10-16, a shed's roof): a rectangle's roof as one plane, draining to the side picked. */}
      {plan.shape === "rectangle" && exterior.sides.length === 4 && (
        <>
          <Choice
            label="Slopes"
            value={roof.oneSlopeTo ? "one" : "two"}
            readOnly={readOnly}
            options={[
              ["two", "Gable or hip"],
              ["one", "One slope"],
            ]}
            onChange={(v) => onUpdate((x) => withOneSlope(x, v === "one" ? (x.oneSlopeTo ?? exterior.sides[2]?.id ?? null) : null))}
          />
          {roof.oneSlopeTo && (
            <Choice
              label="Draining to"
              hint="The low side, with the eavestrough. The side across from it is the high one."
              value={roof.oneSlopeTo}
              readOnly={readOnly}
              options={exterior.sides.map((s) => [s.id, s.name.trim() || "Side"] as [string, string])}
              onChange={(v) => onUpdate((x) => withOneSlope(x, v))}
            />
          )}
        </>
      )}
      {(plan.shape === "rectangle" || plan.shape === "wings") && !roof.oneSlopeTo && (
        <label className="exterior-field" htmlFor="ext-ridge">
          <span className="exterior-field-label">{plan.shape === "rectangle" ? "Ridge runs" : "Main roof"}</span>
          <select id="ext-ridge" value={roof.ridgeAlong ?? ""} disabled={readOnly} onChange={(e) => onUpdate((x) => ({ ...x, ridgeAlong: e.target.value || null }))}>
            <option value="">{ridgeOption(plan.shape, exterior, nameOf)}</option>
            {exterior.sides.map((s) => (
              <option key={s.id} value={s.id}>
                {plan.shape === "rectangle" ? `Parallel to ${s.name.trim() || "Side"}` : `Over ${s.name.trim() || "Side"}, its ridge along it`}
              </option>
            ))}
          </select>
        </label>
      )}
      {!partsAbove && <RoofParts plan={plan} roof={roof} proposal={proposal} readOnly={readOnly} nameOf={nameOf} drops={q.wingDrops} onUpdate={onUpdate} />}
      {plan.shape === "L" && plan.wingEnds.length > 0 && (
        <Choice
          label="A wing's roof lower, stopping at the wall"
          hint="A wing set below the house's roof, with a strip of siding between (a garage tied in lower): it meets the wall with step flashing, not valleys."
          value={plan.wings.find((w) => w.lower && !w.forced)?.sideId ?? "none"}
          readOnly={readOnly}
          options={[["none", "No: it runs into the main roof"] as [string, string], ...plan.wingEnds.map((id) => [id, `The wing out to ${nameOf(id)}`] as [string, string])]}
          onChange={(v) => onUpdate((x) => plan.wingEnds.reduce((r, id) => withWingAnswer(r, plan, id, id === v ? "lower" : "tie"), x))}
        />
      )}
      {plan.shape === "L" && plan.wings.some((w) => w.lower && w.onSlope) && (
        <Choice
          label="Over the lower wing, the main roof has"
          value={plan.wings.some((w) => w.gable) ? "gable" : "eave"}
          readOnly={readOnly}
          options={[
            ["eave", "Its eave"],
            ["gable", "A gable"],
          ]}
          onChange={(v) => onUpdate((x) => plan.wings.filter((w) => w.lower).reduce((r, w) => withWingAnswer(r, plan, w.sideId, v === "gable" ? "gable" : "lower"), x))}
        />
      )}
      {plan.shape !== "other" && !partsAbove && additions}
    </>
  );
}

/**
 * What the footprint can't tell about the roof, put on a side (2026-10-12): a porch that is the
 * slope above carried on past the wall and a cross gable rising out of a slope over a front door
 * (both the owner's own house), and a lean-to porch of its own below the eave. Since 10-13 each is
 * put on with a tap on its side on the plan; its numbers are typed here.
 */
function RoofAdditions({
  exterior,
  readOnly,
  nameOf,
  sideFeet,
  placing,
  onPlace,
  onUpdate,
}: {
  exterior: Exterior;
  readOnly: boolean;
  nameOf: (id: string) => string;
  sideFeet: (id: string) => number;
  placing: AdditionKind | null;
  onPlace: (kind: AdditionKind | null) => void;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const adds = exterior.roof.additions ?? [];
  const set = (id: string, f: (a: RoofAddition) => RoofAddition) => onUpdate((x) => ({ ...x, additions: (x.additions ?? []).map((a) => (a.id === id ? f(a) : a)) }));
  return (
    <div className="exterior-rows">
      <span className="exterior-row-label">Porches and cross gables</span>
      {adds.length > 0 && (
        <div className="exterior-openings">
          <span className="exterior-th">Kind</span>
          <span className="exterior-th">Side</span>
          <span className="exterior-th">From left</span>
          <span className="exterior-th">To</span>
          <span className="exterior-th" title="From the wall out to the porch's eave">
            Out from wall
          </span>
          <span className="exterior-th" />
          {adds.map((a, i) => {
            const name = `${ADDITION_LABEL[additionKind(a)]} ${i + 1}`;
            return (
              <div key={a.id} style={{ display: "contents" }}>
                <Cell label={`${i + 1}`}>
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
                </Cell>
                <Cell label="Side">
                  <select aria-label={`${name}: side`} value={a.sideId} disabled={readOnly} onChange={(e) => set(a.id, (x) => ({ ...x, sideId: e.target.value, fromFeet: 0, toFeet: sideFeet(e.target.value) }))}>
                    {exterior.sides.map((s) => (
                      <option key={s.id} value={s.id}>
                        {nameOf(s.id)}
                      </option>
                    ))}
                  </select>
                </Cell>
                <Cell label="From the left corner">
                  <FeetInput label={`${name}: from the left corner`} value={a.fromFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, fromFeet: v }))} />
                </Cell>
                <Cell label="To">
                  <FeetInput label={`${name}: to`} value={a.toFeet} readOnly={readOnly} onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, toFeet: v }))} />
                </Cell>
                {a.kind === "porch" ? (
                  <Cell label="Out from the wall">
                    <FeetInput label={`${name}: out from the wall to its eave`} value={a.depthFeet ?? null} readOnly={readOnly} onCommit={(v) => v !== null && set(a.id, (x) => ({ ...x, depthFeet: v }))} />
                  </Cell>
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
          {(["porch", "leanto", "gable"] as AdditionKind[]).map((kind) => (
            <button key={kind} type="button" className={`option-btn${placing === kind ? " selected" : ""}`} aria-pressed={placing === kind} onClick={() => onPlace(placing === kind ? null : kind)}>
              + {kind === "porch" ? "Porch roof" : kind === "leanto" ? "Lean-to porch" : "Cross gable"}
            </button>
          ))}
        </div>
      )}
      <p className="field-note">
        Press one, then tap the side it is on in the plan. Along the side from its left end, as seen from outside. A porch roof carried on is the slope above it, one plane with its eave
        further out; a lean-to is a lower roof of its own, with headwall flashing where it meets the wall. A cross gable stands at the drip line there, over a front door say.
      </p>
    </div>
  );
}

/**
 * A two-storey house's upper floor (2026-10-14): drawn over the plan, its sides listed to type and
 * open face-on, and each lower roof round it a lean-to or a ridge out from the wall.
 */
/**
 * The ridge select's first choice, the ridge not picked (2026-10-15): as the photos show it when they
 * set it (`ridgeFromPhotos`), else across an attached home's shared walls (`ridgeAcrossParty`), else along
 * the longer walls or from the outline.
 */
function ridgeOption(shape: RoofPlan["shape"], exterior: Exterior, nameOf: (id: string) => string): string {
  const photos = ridgeFromPhotos(exterior);
  if (photos) return `As the photos show: ${shape === "rectangle" ? `parallel to ${nameOf(photos.ridgeAlong)}` : `over ${nameOf(photos.ridgeAlong)}, its ridge along it`}`;
  if (ridgeAcrossParty(exterior)) return sharedSides(exterior).length > 1 ? "Across the shared walls" : "Across the shared wall";
  return shape === "rectangle" ? "Along the longer walls" : "Worked out from the outline";
}

function UpperFloorFields({
  exterior,
  q,
  plan,
  readOnly,
  nameOf,
  onOpenSide,
  onChange,
  onDraw,
  onUpdate,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  plan: RoofPlan;
  readOnly: boolean;
  nameOf: (id: string) => string;
  onOpenSide: (id: string) => void;
  onChange: Change;
  onDraw: () => void;
  onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void;
}) {
  const [confirm, setConfirm] = useState<"redraw" | "remove" | null>(null);
  /** The floor line typed for splitting tall sides; null until typed, a storey under their eave shown. */
  const [floorLine, setFloorLine] = useState<number | null>(null);
  const up = exterior.upper;
  // What the photos show stands over the sides (2026-10-15): never drawn from them, only said.
  const storeys = photoStoreys(exterior);
  if (!up) {
    return (
      <div className="exterior-rows">
        <h4 className="exterior-subhead">Upper floor</h4>
        {storeys.twoStoreys && (
          <p className="exterior-assumed">
            The photos of {listOf([...new Set(storeys.reads.map((x) => x.name))])} show an upper floor: draw it over the plan for its own sides and roof. Until it is drawn, the high-roof charge is
            taken from the photos.
          </p>
        )}
        <p className="field-note">
          Two storeys? Draw the upper floor over the plan. The house&rsquo;s roof goes over it; the main floor outside it gets a roof of its own against its walls, and the high-roof charge
          follows.
        </p>
        {!readOnly && (
          <button type="button" className="btn-secondary" onClick={onDraw}>
            + Upper floor (two storeys)
          </button>
        )}
      </div>
    );
  }
  const ufp = q.upperFootprint;
  // A main-floor side taped to the upper floor's eave would count the upper floor twice now it has its own sides: split at the floor line, one tap.
  const tall = tallSides(exterior);
  const lone = exterior.sides
    .filter((s) => Math.max(s.eaveLeftFeet ?? 0, s.eaveRightFeet ?? 0) >= TALL_SIDE_FEET && !tall.some((t) => t.sideId === s.id))
    .map((s) => s.name.trim() || "Side");
  // A floor line to start from: a storey under the tall sides' eave.
  const eaves = tall.map((t) => t.eaveFeet).sort((a, b) => a - b);
  const guess = eaves.length > 0 ? Math.max(7, (eaves[Math.floor((eaves.length - 1) / 2)] as number) - UPPER_STOREY_FEET) : null;
  // The floor line read off the photos of flush walls (2026-10-15), over the guess; typed, the estimator's.
  const photoFloor = photoFloorLine(exterior);
  const floor = floorLine ?? photoFloor?.feet ?? guess;
  // Sides whose photo shows no upper floor over them, with one drawn: said, in case it is drawn over the wrong part.
  const noneShown = [...new Set(photoReads(exterior).upper.filter((x) => x.value === "none").map((x) => x.name))];
  const lowerFromPhotos = lowerRoofsFromPhotos(exterior);
  return (
    <div className="exterior-rows">
      <h4 className="exterior-subhead">Upper floor</h4>
      {ufp && !ufp.closes && <p className="sketch-length-error">{ufp.reason}</p>}
      <div className="exterior-side-list">
        {up.sides.map((s) => {
          const name = s.name.trim() || "Side";
          return (
            <div className="exterior-side-item" key={s.id}>
              <button type="button" className="exterior-side-open" onClick={() => onOpenSide(s.id)} title={`See ${name} face-on`}>
                {name} <span aria-hidden="true">›</span>
              </button>
              <FeetInput label={`${name}: length`} value={s.lengthFeet} readOnly={readOnly} onCommit={(v) => v !== null && onChange((e) => withUpperSideLength(e, s.id, v))} />
              {s.lengthFrom === "drawn" && (
                <span className="exterior-drawn" title="As long as it was drawn: type its length as taped">
                  drawn
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="field-note">Its sides stand on the main floor&rsquo;s walls, or on the roof against them: their heights are from the floor line, the top of the main floor&rsquo;s walls.</p>
      {q.floorSoffitSquareFeet > 0.05 && (
        <p className="field-note">It stands out past the main floor&rsquo;s walls, a cantilever: {sf(q.floorSoffitSquareFeet)} of floor soffit under it, priced with the soffit.</p>
      )}
      {tall.length > 0 && (
        <>
          <p className="exterior-assumed">
            {listOf(tall.map((t) => t.name))} {tall.length === 1 ? "reads its" : "read their"} eave {TALL_SIDE_FEET}&prime; or more: measured up to the upper floor&rsquo;s eave, as one tall side.
            Split at the floor line, {tall.length === 1 ? "its" : "each one’s"} eave goes down to it, and what is above - the cladding, the windows over the line, the gable, the roof read off
            it - goes onto the upper side over it. Its photos show both storeys, so each side gets them, laid on its own wall.
          </p>
          {!readOnly && (
            <>
              <div className="exterior-grid">
                <FeetField
                  id="ext-floor-line"
                  label="Floor line, from grade"
                  value={floor}
                  onCommit={setFloorLine}
                  note={
                    floorLine === null && photoFloor
                      ? `Read off the photos of ${listOf([...new Set(photoFloor.reads.map((x) => x.name))])}: the top of the main floor's walls, once for every side.`
                      : "The top of the main floor's walls, once for every side."
                  }
                />
              </div>
              <div className="exterior-row">
                <button type="button" className="btn-secondary" disabled={!floor} onClick={() => floor && onChange((e) => splitTallSides(e, floor))}>
                  Split {tall.length === 1 ? "it" : `all ${tall.length}`} at the floor line
                </button>
              </div>
            </>
          )}
        </>
      )}
      {lone.length > 0 && (
        <p className="exterior-assumed">
          {listOf(lone)} {lone.length === 1 ? "reads its" : "read their"} eave {TALL_SIDE_FEET}&prime; or more, with no upper side flush over {lone.length === 1 ? "it" : "them"}. The main
          floor&rsquo;s sides stop at the floor line: if that was the upper floor&rsquo;s eave, put in the main floor&rsquo;s.
        </p>
      )}
      {noneShown.length > 0 && (
        <p className="exterior-assumed">
          The photos of {listOf(noneShown)} show no upper floor over {noneShown.length === 1 ? "it" : "them"}: check the upper floor is drawn over the right part of the plan.
        </p>
      )}
      {plan.lowerRoofs.map((l) => (
        <Choice
          key={`lower-${l.sideId}`}
          label={`The roof out to ${nameOf(l.sideId)}`}
          hint={lowerFromPhotos.has(l.sideId) ? `From the photo of ${nameOf(l.sideId)}: pick one to set it yourself.` : undefined}
          value={l.kind}
          readOnly={readOnly}
          options={[
            ["leanto", "One slope up to the wall"],
            ["tent", "Ridge out from the wall"],
          ]}
          onChange={(kind) => onUpdate((x) => ({ ...x, lowerRoofs: { ...(x.lowerRoofs ?? {}), [l.sideId]: kind } }))}
        />
      ))}
      {plan.lowerRoofs.length > 0 && (
        <p className="field-note">
          The main floor round the upper floor: a lean-to rises to the wall, with headwall flashing along its top; a ridge running out from the wall (a garage, a bump-out) meets it with step
          flashing up its slopes.
        </p>
      )}
      {!readOnly &&
        (confirm ? (
          <div className="sketch-undo" role="alert">
            <span>{confirm === "redraw" ? "Draw the upper floor again? Its sides go, with what is on them." : "Remove the upper floor and its sides?"}</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (confirm === "redraw") onDraw();
                else onChange((e) => withoutUpper(e));
                setConfirm(null);
              }}
            >
              {confirm === "redraw" ? "Draw again" : "Remove"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
              Keep
            </button>
          </div>
        ) : (
          <div className="exterior-row">
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("redraw")}>
              Draw the upper floor again…
            </button>
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("remove")}>
              Remove the upper floor…
            </button>
          </div>
        ))}
    </div>
  );
}

/** The owner's list (10-12): what a roof, its eavestrough and its soffit are priced from, each a question until answered. */
function RoofingFields({ roof, r, readOnly, onUpdate }: { roof: ExteriorRoof; r: RoofingQuantities | null; readOnly: boolean; onUpdate: (f: (roof: ExteriorRoof) => ExteriorRoof) => void }) {
  return (
    <>
      <h4 className="exterior-subhead">Roofing</h4>
      <Choice
        label="Material"
        value={roof.material ?? null}
        readOnly={readOnly}
        options={(Object.keys(ROOF_MATERIAL_LABEL) as RoofMaterial[]).map((m) => [m, ROOF_MATERIAL_LABEL[m]] as [RoofMaterial, string])}
        onChange={(material) => onUpdate((x) => ({ ...x, material }))}
      />
      {roof.material === "metal" && <p className="field-note">Metal adds closure strips (eaves + 2 × ridge), high-temperature ice &amp; water barrier and its own disposal line.</p>}
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
      {r?.high?.automatic ? (
        <p className="field-note">High roof charge: on the roof over the upper floor, {r.high.squares.toFixed(2)} SQ, from the upper floor drawn.</p>
      ) : (
        <YesNo
          label="Two storeys or higher (high roof)"
          hint={roof.high == null && r?.highFromPhotos ? `From the photos of ${listOf(r.highFromPhotos.sides)}: tap to answer it yourself.` : undefined}
          value={roof.high ?? r?.highFromPhotos?.twoStoreys ?? null}
          readOnly={readOnly}
          onChange={(high) => onUpdate((x) => ({ ...x, high }))}
        />
      )}
      <YesNo label="Handload materials" hint="More than 30 ft from the front of the driveway, or the loading truck can't reach." value={roof.handload ?? null} readOnly={readOnly} onChange={(handload) => onUpdate((x) => ({ ...x, handload }))} />
      <YesNo label="Handload to disposal" hint="Nowhere to put a bin on the driveway: an alley, or otherwise." value={roof.disposalHandload ?? null} readOnly={readOnly} onChange={(disposalHandload) => onUpdate((x) => ({ ...x, disposalHandload }))} />
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
            value={roof.vents === undefined ? null : (roof.vents[kind] ?? 0)}
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
    </>
  );
}

function RoofFigures({ r, floorSoffitSquareFeet }: { r: RoofingQuantities; floorSoffitSquareFeet: number }) {
  const g = r.gutter;
  const chosen = r.slopes.filter((s) => s.selected);
  // With anything typed over a drawing, each total says where it came from, as the scope lines do; the
  // roof report anything was taken from is named once, above them (2026-10-15); and what the added pieces put in it.
  const from = (key: RoofTotalKey) => (r.typed && r.drawn ? `, ${sourceWords(r.from[key])}` : "") + (Math.abs(r.pieces.added[key]) > 0.005 ? `, incl. ${key === "squareFeet" ? sf(r.pieces.added[key]) : lf(r.pieces.added[key])} from added pieces` : "");
  const pieces = r.pieces.list.filter((x) => x.figures.missing.length === 0);
  const rows: [string, string][] = [
    ...(r.report ? [["Roof report", `${r.report.label ?? "no maker or date given"} (${r.report.fileName})`] as [string, string]] : []),
    [
      "Pitch",
      r.byPitch.length > 1 || r.curved
        ? `${[...r.byPitch.map((b) => `${formatPitch(b.pitch)}${b.assumed ? " assumed" : b.fromPhotos ? " from photos" : ""} on ${b.squares.toFixed(2)} SQ`), ...(r.curved ? [`curved on ${r.curved.squares.toFixed(2)} SQ`] : [])].join(", ")}${r.steepBands.length > 0 ? `; steep ${r.steepBands.map((b) => `${b.band} on ${b.squares.toFixed(2)} SQ`).join(", ")}` : ""}`
        : `${formatPitch(r.pitch)}${r.pitchAssumed ? " assumed" : r.pitchFromPhotos ? " from photos" : ""} (factor ${r.pitchFactor.toFixed(3)})${r.steep ? `, steep ${r.steep}` : ""}`,
    ],
    ...(r.drawn
      ? [["Slopes being roofed", r.slopes.length === 0 ? "the whole roof" : r.allSlopes ? `all: ${r.slopes.map((s) => s.label).join(", ")}` : chosen.map((s) => s.label).join(", ") || "none"] as [string, string]]
      : []),
    ...(pieces.length > 0 ? [["Added roof pieces", pieces.map((x) => pieceLine(x.piece, x.figures, r.pitch)).join("; ")] as [string, string]] : []),
    ["Roof area", `${sf(r.areaSquareFeet)} (${r.squares.toFixed(2)} SQ, no waste${from("squareFeet")})`],
    ["Ridge", lf(r.ridgeFeet) + from("ridge")],
    ["Hips", lf(r.hipFeet) + from("hip")],
    ["Valleys", lf(r.valleyFeet) + from("valley")],
    ...(r.stepFeet > 0 ? [["Step flashing", lf(r.stepFeet) + from("step")] as [string, string]] : []),
    ...(r.headwallFeet > 0 ? [["Headwall flashing", lf(r.headwallFeet) + from("headwall")] as [string, string]] : []),
    ["Eaves", lf(r.eaveFeet) + from("eave")],
    ["Rakes", lf(r.rakeFeet) + from("rake")],
    ["Drip edge (eaves + rakes)", lf(r.dripEdgeFeet) + from("dripEdge")],
    r.material === "metal" ? ["Closure strips (eaves + 2 × ridge)", lf(r.closureFeet)] : ["Starter (eaves)", lf(r.starterFeet) + from("starter")],
    ["Ice & water (eaves + valleys)", lf(r.iceWaterFeet) + from("iceWater")],
    ...(r.pieces.sidingSquareFeet > 0.005 ? [["Dormer siding (cheeks & faces)", `${sf(r.pieces.sidingSquareFeet)}, gross`] as [string, string]] : []),
    ["Ridge vent", lf(r.ridgeVentFeet)],
    ["Eavestrough", `${lf(g.feet)} in ${g.runs.length} run${g.runs.length === 1 ? "" : "s"}`],
    ["End caps", String(g.endCaps)],
    ["Mitres", `${g.outsideMitres + g.insideMitres} (${g.outsideMitres} outside, ${g.insideMitres} inside)`],
    ["Drops", String(g.drops)],
    ["Elbows", String(g.elbows)],
    ["Downspouts", `${g.downspouts}${g.downspoutFeet !== null ? `, ${lf(g.downspoutFeet)}${g.downspoutFeetTyped ? "" : " (eave height + 15%)"}` : ""}`],
    ["Soffit, eaves", `${lf(r.soffit.eaveFeet)} (${sf(r.soffit.eaveSquareFeet)})`],
    ["Soffit, rakes", `${lf(r.soffit.rakeFeet)} (${sf(r.soffit.rakeSquareFeet)})`],
    ...(floorSoffitSquareFeet > 0.05 ? [["Soffit, floor overhang", `${sf(floorSoffitSquareFeet)} (the upper floor's underside past the main walls)`] as [string, string]] : []),
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

