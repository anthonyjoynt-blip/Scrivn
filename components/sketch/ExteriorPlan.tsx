"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { formatFeetInches, parseFeetInches } from "@/lib/sketch";
import {
  DEFAULT_EAVE_FEET,
  DEFAULT_ELBOWS_PER_DOWNSPOUT,
  type Exterior,
  type ExteriorQuantities,
  type ExteriorRoof,
  FEET_PER_DOWNSPOUT,
  formatPitch,
  lShapeExterior,
  rectangleExterior,
  ROOF_MATERIAL_LABEL,
  ROOF_VENT_LABEL,
  type RoofingQuantities,
  type RoofMaterial,
  type RoofVentKind,
  type SideTurn,
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
  startWalk,
  toggledEnd,
  walkState,
  withAddition,
  withNextSide,
  withRoofEnd,
  withSideLength,
} from "@/lib/exteriorPlan";
import type { Pt, RoofAddition, RoofPlan } from "@/lib/roof";
import { textWidthEm } from "@/lib/roofLabels";
import { pickableEdge, type RoofPick, RoofLegend, RoofPlanDrawing, type RoofPlanMode } from "./exteriorDrawings";
import { Cell, Choice, FeetField, FeetInput, lf, listOf, NumberField, sf, YesNo } from "./exteriorFields";

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
  const [eave, setEave] = useState<number | null>(DEFAULT_EAVE_FEET);
  const [front, setFront] = useState("");
  const [shape, setShape] = useState<"rectangle" | "L" | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [depth, setDepth] = useState<number | null>(null);
  const [notchWidth, setNotchWidth] = useState<number | null>(null);
  const [notchDepth, setNotchDepth] = useState<number | null>(null);

  if (readOnly) {
    return <p className="field-note">No exterior has been measured on this claim. Unlock the sketch to start one.</p>;
  }
  const eaveFeet = eave ?? DEFAULT_EAVE_FEET;
  const frontFeet = lengthOf(front);
  const lValid = width !== null && depth !== null && notchWidth !== null && notchDepth !== null && notchWidth < width && notchDepth < depth;
  const shapeReady = width !== null && depth !== null && (shape === "rectangle" || lValid);
  const startWalking = () => frontFeet !== null && onStart(startWalk(frontFeet, eaveFeet));

  return (
    <div className="exterior-start">
      <div>
        <h3>Draw the outside of the house</h3>
        <p className="field-note">
          Tap each corner of the house in turn, going round it, then tap the first corner again. The street side goes at the bottom. Rough is fine: type the real lengths after. The roof
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
          <h4 className="exterior-subhead">Or start from a shape</h4>
          <div className="option-group" role="group" aria-label="Shape of the house">
            {(
              [
                ["rectangle", "Rectangle"],
                ["L", "L-shape"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" className={`option-btn${shape === value ? " selected" : ""}`} aria-pressed={shape === value} onClick={() => setShape(shape === value ? null : value)}>
                {label}
              </button>
            ))}
          </div>
          {shape && (
            <>
              <div className="exterior-grid">
                <FeetField id="ext-start-width" label="Width (the front)" value={width} onCommit={setWidth} />
                <FeetField id="ext-start-depth" label="Depth (the sides)" value={depth} onCommit={setDepth} />
                {shape === "L" && (
                  <>
                    <FeetField id="ext-start-nw" label="Notch width (rear right)" value={notchWidth} onCommit={setNotchWidth} />
                    <FeetField id="ext-start-nd" label="Notch depth" value={notchDepth} onCommit={setNotchDepth} />
                  </>
                )}
              </div>
              {shape === "L" && width !== null && depth !== null && notchWidth !== null && notchDepth !== null && !lValid && (
                <p className="sketch-length-error">The notch has to be smaller than the house both ways.</p>
              )}
              <button
                type="button"
                className="btn-secondary"
                disabled={!shapeReady}
                onClick={() => {
                  if (!shapeReady) return;
                  onStart(
                    shape === "rectangle"
                      ? rectangleExterior(width as number, depth as number, eaveFeet)
                      : lShapeExterior(width as number, depth as number, notchWidth as number, notchDepth as number, eaveFeet),
                  );
                }}
              >
                {shape === "rectangle" ? "Start with 4 sides" : "Start with 6 sides"}
              </button>
            </>
          )}
        </div>
        <FeetField id="ext-start-eave" label="Eave height, from grade" value={eave} onCommit={setEave} note="Every side starts at this; change any side after." />
      </div>
      <p className="field-note">A Scrivn Scan exterior comes in from the phone, or through Import scan on the Sketch view.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Drawing the outline
// ---------------------------------------------------------------------------------------------

/** The plan drawn on: 100' by 70' in feet, y up, with room under it for the street. */
const DRAW_VIEW = { x0: -5, x1: 95, y0: -9, y1: 65 };
/** How near the first corner a tap closes the outline, in screen pixels: a fingertip. */
const CLOSE_PX = 22;

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
export function FootprintDraw({ onClose, guide, onCancel }: { onClose: (ring: Pt[]) => void; guide?: Pt[]; onCancel?: () => void }) {
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
    return first !== undefined && draft.length >= 3 && Math.hypot(raw.x - first.x, raw.y - first.y) <= CLOSE_PX * feetPerPixel();
  };

  function close() {
    const ring = closeOutline(draft, Math.max(1.5, CLOSE_PX * feetPerPixel()));
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
    const p = snapOutlinePoint(raw, draft);
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
  const closing = hover && nearFirst(hover) ? closeOutline(draft, Math.max(1.5, CLOSE_PX * feetPerPixel())) : null;
  const preview = hover && !closing ? snapOutlinePoint(hover, draft) : null;
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
    </div>
  );
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
  const [redrawing, setRedrawing] = useState(false);
  const [confirm, setConfirm] = useState<"redraw" | "remove" | null>(null);
  const [next, setNext] = useState<{ turn: SideTurn; text: string }>({ turn: "outside", text: "" });
  const [figure, setFigure] = useState<HTMLElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  const fp = q.footprint;

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
            <span>{confirm === "redraw" ? `Draw the outline again? Its ${exterior.sides.length} sides go, with what is on them; the roof's answers stay.` : `Remove all ${exterior.sides.length} sides and the roof?`}</span>
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
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("redraw")}>
              Draw the outline again…
            </button>
            <button type="button" className="btn-secondary exterior-remove" onClick={() => setConfirm("remove")}>
              Remove the exterior…
            </button>
          </div>
        ))}
    </>
  );

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
          {ending}
        </div>
      </div>
    );
  }

  const ridges = plan.lines.filter((l) => l.kind === "ridge");
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
    if (what === "slope") updateRoof((x) => ({ ...x, slopes: toggleIn(x.slopes, facetKeys, key) }));
    else if (what === "edge") updateRoof((x) => ({ ...x, edges: toggleIn(x.edges, edgeKeys, key) }));
    else
      updateRoof((x) => {
        const current = x.ridgeVents ?? [];
        return { ...x, ridgeVents: current.includes(key) ? current.filter((k) => k !== key) : [...current, key] };
      });
  }
  const chosenSlopes = r ? r.slopes.filter((s) => s.selected) : [];
  const hint = placing
    ? `Tap the side the ${PLACING_WORDS[placing]} goes on.`
    : mode === "shape"
      ? `Tap a side's name to see it face-on${plan.ends.length > 0 ? `, or Gable or Hip at an end of the roof to switch it` : ""}.`
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
            The roof is drawn at an assumed {formatPitch(plan.pitch)} until its pitch is typed (under The roof) or a gable peak is measured on a side.
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
              updateRoof((x) => withAddition(x, kind, id, sideFeet(id)));
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
          approx={(id) => exterior.sides.find((s) => s.id === id)?.lengthFrom === "drawn"}
          fontScale={narrow ? 1.45 : 1}
        />
        <RoofLegend plan={plan} ridgeVent={(roof.ridgeVents ?? []).length > 0} />
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
        <SidesList exterior={exterior} q={q} readOnly={readOnly} showTurns={false} onOpenSide={onOpenSide} onChange={onChange} />
        <RoofShapeFields exterior={exterior} q={q} plan={plan} readOnly={readOnly} nameOf={nameOf} sideFeet={sideFeet} placing={placing} onPlace={setPlacing} onUpdate={updateRoof} />
        <RoofingFields roof={roof} r={r} readOnly={readOnly} onUpdate={updateRoof} />
        {r && <RoofFigures r={r} />}
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
  sideFeet,
  placing,
  onPlace,
  onUpdate,
}: {
  exterior: Exterior;
  q: ExteriorQuantities;
  plan: RoofPlan;
  readOnly: boolean;
  nameOf: (id: string) => string;
  sideFeet: (id: string) => number;
  placing: AdditionKind | null;
  onPlace: (kind: AdditionKind | null) => void;
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
          placeholder={q.pitch.source !== "typed" && q.pitch.value !== null ? `${Math.round(q.pitch.value * 100) / 100}${q.pitch.source === "assumed" ? " assumed" : ""}` : ""}
          readOnly={readOnly}
          max={24}
          onCommit={(v) => onUpdate((x) => ({ ...x, pitch: v }))}
          note={
            q.pitch.fromSides.length > 0
              ? `Measured gables give ${q.pitch.fromSides.map((f) => `${formatPitch(f.pitch)} (${f.name})`).join(", ")}.${roof.pitch === null ? " Left blank, the roof uses that." : ""}`
              : roof.pitch === null
                ? `Nothing typed or measured, so the roof is at an assumed ${formatPitch(q.pitch.value ?? 0)}.`
                : undefined
          }
        />
        <FeetField id="ext-eave-oh" label="Eave overhang" value={roof.eaveOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((x) => ({ ...x, eaveOverhangFeet: v }))} />
        <FeetField id="ext-rake-oh" label="Rake overhang" value={roof.rakeOverhangFeet} readOnly={readOnly} allowZero onCommit={(v) => v !== null && onUpdate((x) => ({ ...x, rakeOverhangFeet: v }))} />
      </div>
      {(plan.shape === "rectangle" || plan.shape === "wings") && (
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
      {plan.notches.length > 0 && (
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
              onChange={(v) => onUpdate((x) => ({ ...x, coveredNotches: [...(x.coveredNotches ?? []).filter((id) => !k.sideIds.includes(id)), ...(v === "covered" ? [k.sideId] : [])] }))}
            />
          ))}
          <p className="field-note">A covered deck or porch in a corner of the house, under the roof: the roof is planned round the outline with it filled in.</p>
        </div>
      )}
      {plan.shape === "L" && plan.wingEnds.length > 0 && (
        <Choice
          label="A wing's roof lower, stopping at the wall"
          hint="A wing set below the house's roof, with a strip of siding between (a garage tied in lower): it meets the wall with step flashing, not valleys."
          value={roof.lowerWings?.find((id) => plan.wingEnds.includes(id)) ?? "none"}
          readOnly={readOnly}
          options={[["none", "No: it runs into the main roof"] as [string, string], ...plan.wingEnds.map((id) => [id, `The wing out to ${nameOf(id)}`] as [string, string])]}
          onChange={(v) => onUpdate((x) => ({ ...x, lowerWings: v === "none" ? [] : [v] }))}
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
          onChange={(v) => onUpdate((x) => ({ ...x, wingGables: v === "gable" ? plan.wings.filter((w) => w.lower).map((w) => w.sideId) : [] }))}
        />
      )}
      {plan.shape === "wings" && plan.wings.length > 0 && (
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
      {plan.shape !== "other" && <RoofAdditions exterior={exterior} readOnly={readOnly} nameOf={nameOf} sideFeet={sideFeet} placing={placing} onPlace={onPlace} onUpdate={onUpdate} />}
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
      <YesNo label="Two storeys or higher (high roof)" value={roof.high ?? null} readOnly={readOnly} onChange={(high) => onUpdate((x) => ({ ...x, high }))} />
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

function RoofFigures({ r }: { r: RoofingQuantities }) {
  const g = r.gutter;
  const chosen = r.slopes.filter((s) => s.selected);
  const rows: [string, string][] = [
    ["Pitch", `${formatPitch(r.pitch)}${r.pitchAssumed ? " assumed" : ""} (factor ${r.pitchFactor.toFixed(3)})${r.steep ? `, steep ${r.steep}` : ""}`],
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

