import type { ReactNode } from "react";
import { formatFeetInches } from "@/lib/sketch";
import {
  bandLabel,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  elevationFaces,
  type ExteriorSide,
  type Footprint,
  formatOpeningSize,
  type RoofRise,
  zFromGrade,
} from "@/lib/exterior";
import type { Pt, RoofLineKind, RoofPlan, RoofSection } from "@/lib/roof";
import { facetLabels, type LabelBox, labelsOverlap, lineTotals, roofLineLabels, textWidthEm } from "@/lib/roofLabels";
import { formatQuantity } from "@/lib/sketchQuantities";

/**
 * The exterior's two drawings, to scale: one side's elevation, and the roof plan. Kept apart from
 * the editor because the documents carry them too (`exteriorImages.ts`), and a second way of drawing
 * them would be a copy that drifts - what the carrier sees is what the estimator saw.
 *
 * Styled by attributes, not by the page's stylesheet: drawn on its own as an image, an SVG has no
 * stylesheet, and a label set by a CSS class would come out black on nothing.
 */

export const CLADDING_FILL: Record<CladdingKind, string> = {
  stucco: "#efe5cf",
  vinyl: "#d6e5f1",
  wood_shake: "#dcc097",
  eifs: "#e9e2d6",
  wood: "#e4cba2",
  fibre_cement: "#dddcd2",
  brick: "#d9a28c",
  stone: "#cbc5b9",
  metal: "#cfd6de",
  other: "#e4e4e4",
};

export const LINE_STYLE: Record<RoofLineKind, { stroke: string; width: number; dash?: string; label: string }> = {
  eave: { stroke: "#1a1d23", width: 2, label: "Eave" },
  rake: { stroke: "#b45309", width: 2.5, label: "Rake" },
  ridge: { stroke: "#b91c1c", width: 3, label: "Ridge" },
  hip: { stroke: "#6d28d9", width: 2.5, label: "Hip" },
  valley: { stroke: "#1d4ed8", width: 2.5, dash: "6 4", label: "Valley" },
  headwall: { stroke: "#0f766e", width: 3, label: "Headwall flashing" },
  step: { stroke: "#0f766e", width: 3, dash: "2 3", label: "Step flashing" },
};

/** What a tap in "Eaves & rakes" can choose: flashing takes no eavestrough, soffit or fascia. */
export const pickableEdge = (k: RoofLineKind) => k === "eave" || k === "rake";

const RIDGE_VENT = "#15803d";
const CHOSEN_FILL = "#d3e4f6";
const LEFT_FILL = "#f1f1f1";
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const INK = "#1a1d23";

/** Pixel size for drawing as an image; the editor sizes them by its stylesheet instead. */
type Size = { width: number; height: number };

/** A box in the side's frame, feet: x along from its left end, y up. */
export type ElevationReach = { minX: number; maxX: number; minZ: number; maxZ: number };

/** How far an elevation reaches: the wall, its faces, its roofline and its openings - a strip of stucco over a deck runs past the wall. */
function elevationExtent(side: ExteriorSide, rise: RoofRise | null, reach?: ElevationReach) {
  const { shape, faces, openings } = elevationFaces(side, rise);
  const L = Math.max(1, shape.lengthFeet);
  const roofline = side.roofline ?? [];
  const xs = [0, L, ...faces.flatMap((f) => f.poly.map((p) => p.x)), ...roofline.map((r) => r.alongFeet), ...(reach ? [reach.minX, reach.maxX] : [])];
  const ys = [
    shape.eaveZ ?? DEFAULT_EAVE_FEET,
    side.eaveRightFeet ?? 0,
    ...shape.top.map((p) => p.y),
    ...faces.flatMap((f) => f.poly.map((p) => p.y)),
    ...roofline.map((r) => r.upFeet),
    ...openings.map((o) => o.rect.y1),
    ...(reach ? [reach.maxZ] : []),
  ];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    topZ: Math.max(...ys),
    lowZ: Math.min(0, -shape.fallFeet, ...faces.flatMap((f) => f.poly.map((p) => p.y)), ...(reach ? [reach.minZ] : [])),
  };
}

/** The lettering size an elevation picks for itself, in feet: 3% of its larger dimension. */
export function elevationFontFeet(side: ExteriorSide, rise: RoofRise | null): number {
  const e = elevationExtent(side, rise);
  return Math.max(0.5, Math.max(Math.max(1, e.maxX - e.minX), e.topZ - e.lowZ) * 0.03);
}

/** An elevation's frame: its viewBox in the drawing's space (x feet along, y MINUS feet up) and its lettering size. */
export interface ElevationView {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  fontFeet: number;
}

function elevationView(side: ExteriorSide, rise: RoofRise | null, reach?: ElevationReach, fontFeet?: number): ElevationView & { ext: ReturnType<typeof elevationExtent>; groundZ: number } {
  const ext = elevationExtent(side, rise, reach);
  const fs = fontFeet ?? elevationFontFeet(side, rise);
  const padX = fs * 4.2;
  const groundZ = ext.lowZ - fs * 4;
  return { ext, groundZ, fontFeet: fs, vx: ext.minX - padX, vw: ext.maxX - ext.minX + 2 * padX, vy: -(ext.topZ + fs * 2.6), vh: ext.topZ + fs * 2.6 - groundZ };
}

const FACE_FILL = (kind: CladdingKind | "parging") => (kind === "parging" ? "#c9ccd1" : CLADDING_FILL[kind]);

/**
 * One side, to scale. `fontFeet` sets the lettering, so a sheet of sides drawn at one scale can
 * letter them all alike; left out, the drawing sizes it to itself.
 *
 * In the editor a side's photo can lie behind it (`backdrop`) and an AI trace over it (`overlay`),
 * both drawn in the drawing's own space - x feet along, y MINUS feet up - and `reach` widens the
 * drawing to hold them. `seeThrough` lets the photo show through the faces. `editor` draws what is
 * dragged and tapped to edit the side face-on (2026-10-13), last, in the same space and frame.
 * `roofAssumed`: the roof's pitch is the assumed one, so a gable the roof gives says so.
 */
export function ElevationDrawing({
  side,
  rise,
  size,
  fontFeet,
  backdrop,
  overlay,
  reach,
  seeThrough = false,
  editor,
  roofAssumed = false,
}: {
  side: ExteriorSide;
  rise: RoofRise | null;
  size?: Size;
  fontFeet?: number;
  backdrop?: ReactNode;
  overlay?: ReactNode;
  reach?: ElevationReach;
  seeThrough?: boolean;
  editor?: (view: ElevationView) => ReactNode;
  roofAssumed?: boolean;
}) {
  const { shape, faces, bandLines, grade, openings, fromShapes } = elevationFaces(side, rise);
  const L = Math.max(1, shape.lengthFeet);
  const eaveZ = shape.eaveZ;
  const view = elevationView(side, rise, reach, fontFeet);
  const { ext, groundZ, vx, vw, vy, vh } = view;
  const faceOpacity = seeThrough ? 0.18 : 1;
  const fs = view.fontFeet;
  const Y = (z: number) => -z;
  const pts = (poly: Pt[]) => poly.map((p) => `${p.x},${Y(p.y)}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const text = { fill: INK, fontFamily: FONT };
  const labels: ReactNode[] = [];
  const g0 = grade[0] as Pt;
  const gN = grade[grade.length - 1] as Pt;
  const ground = [{ x: vx, y: g0.y }, ...grade, { x: vx + vw, y: gN.y }];

  // The eave at each end: level for a taped side, each its own on a side tapped from one level.
  const eaveLeftZ = fromShapes || side.heightsFrom === "level" ? side.eaveLeftFeet : eaveZ;
  const eaveRightZ = fromShapes || side.heightsFrom === "level" ? side.eaveRightFeet ?? side.eaveLeftFeet : eaveZ;
  if (eaveLeftZ != null && side.eaveLeftFeet != null) {
    labels.push(
      <text key="eL" x={-fs * 0.5} y={Y(eaveLeftZ) + fs * 0.35} fontSize={fs} textAnchor="end" {...text}>
        {formatFeetInches(side.eaveLeftFeet)}
      </text>,
    );
  }
  if (eaveRightZ != null && side.eaveRightFeet != null) {
    labels.push(
      <text key="eR" x={L + fs * 0.5} y={Y(eaveRightZ) + fs * 0.35} fontSize={fs} textAnchor="start" {...text}>
        {formatFeetInches(side.eaveRightFeet)}
      </text>,
    );
  }
  const peak = fromShapes ? (side.gable ? { x: side.gable.atFeet, y: zFromGrade(side, side.gable.atFeet, side.gable.peakFeet), source: "measured" } : null) : shape.gable ? { ...shape.gable.peak, source: shape.gable.source } : null;
  if (peak) {
    labels.push(
      <text key="peak" x={peak.x} y={Y(peak.y) - fs * 0.6} fontSize={fs} textAnchor="middle" {...text}>
        {formatFeetInches(peak.y - zFromGrade(side, peak.x, 0))}
        {peak.source === "roof" ? (roofAssumed ? " (roof, pitch assumed)" : " (roof)") : ""}
      </text>,
    );
  }
  const roofline = side.roofline ?? [];

  const scaleFeet = L >= 30 ? 10 : 5;
  return (
    <svg
      className={`exterior-svg${editor ? " exterior-svg-editing" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      width={size?.width}
      height={size?.height}
      role={editor ? "group" : "img"}
      aria-label={`${side.name} elevation, to scale`}
    >
      <rect x={vx} y={vy} width={vw} height={vh} fill="#ffffff" />
      {backdrop}
      <polygon points={pts([...ground, { x: vx + vw, y: groundZ }, { x: vx, y: groundZ }])} fill="#efe7da" fillOpacity={seeThrough ? 0.25 : 1} />
      {!fromShapes && side.base === "parging" && (
        <polygon points={pts([shape.grade[0], shape.grade[1], shape.bottom[1], shape.bottom[0]])} fill="#c9ccd1" fillOpacity={faceOpacity} stroke="#8a9099" strokeWidth={1} {...stroke} />
      )}
      {faces.map((f) =>
        f.poly.length >= 3 ? (
          <polygon
            key={f.id}
            points={pts(f.poly)}
            fill={f.closed ? FACE_FILL(f.kind) : "none"}
            fillOpacity={faceOpacity}
            stroke={fromShapes || seeThrough ? "#374151" : "none"}
            strokeWidth={fromShapes || seeThrough ? 1.2 : 0}
            strokeDasharray={f.closed ? undefined : "4 3"}
            {...stroke}
          />
        ) : (
          <polyline key={f.id} points={pts(f.poly)} fill="none" stroke="#374151" strokeWidth={1.2} strokeDasharray="4 3" {...stroke} />
        ),
      )}
      {bandLines.map((hi, i) =>
        eaveZ !== null && hi > Math.min(shape.bottom[0].y, shape.bottom[1].y) && hi < ext.topZ ? (
          <line key={`line-${i}`} x1={0} x2={L} y1={Y(hi)} y2={Y(hi)} stroke="#6b7280" strokeWidth={1} strokeDasharray="5 4" {...stroke} />
        ) : null,
      )}
      {faces.map((f) => {
        if (f.poly.length < 3 || f.kind === "parging") return null;
        const ys = f.poly.map((p) => p.y);
        const h = Math.max(...ys) - Math.min(...ys);
        if (h < fs * 1.4) return null;
        const left = Math.max(Math.min(...f.poly.map((p) => p.x)), 0);
        return (
          <text key={`label-${f.id}`} x={left + fs * 0.6} y={Y(Math.min(...ys) + Math.min(h / 2, fs * 1.6))} fontSize={fs * 0.85} fill="#4b5563" fontFamily={FONT} fontStyle="italic">
            {f.label}
            {f.closed ? "" : " (open: not counted)"}
          </text>
        );
      })}
      {!fromShapes && shape.cladding.length >= 3 && <polygon points={pts(shape.cladding)} fill="none" stroke="#374151" strokeWidth={1.5} {...stroke} />}
      {!fromShapes && shape.gable?.source === "roof" && eaveZ !== null && (
        <line x1={shape.gable.from} x2={shape.gable.to} y1={Y(eaveZ)} y2={Y(eaveZ)} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" {...stroke} />
      )}
      {roofline.length >= 2 && (
        <polyline points={pts(roofline.map((r) => ({ x: r.alongFeet, y: r.upFeet })))} fill="none" stroke="#7c2d12" strokeWidth={2} strokeDasharray="7 4" {...stroke} />
      )}
      {openings.map(({ opening, rect }) => (
        <g key={opening.id}>
          <rect x={rect.x0} y={Y(rect.y1)} width={rect.x1 - rect.x0} height={rect.y1 - rect.y0} fill="#ffffff" fillOpacity={seeThrough ? 0 : 1} stroke="#1d4ed8" strokeWidth={1.5} {...stroke} />
          <text x={(rect.x0 + rect.x1) / 2} y={Y(rect.y1) - fs * 0.3} fontSize={fs * 0.75} textAnchor="middle" {...text}>
            {formatOpeningSize(opening.widthFeet, opening.heightFeet)}
          </text>
        </g>
      ))}
      <polyline points={pts(ground)} fill="none" stroke="#7c5a3a" strokeWidth={2} {...stroke} />
      {/* Where the wall stands, when the cladding runs past it. */}
      {fromShapes && (ext.minX < -1e-6 || ext.maxX > L + 1e-6) && (
        <>
          <line x1={0} x2={0} y1={Y(g0.y)} y2={Y(Math.max(eaveLeftZ ?? 0, g0.y))} stroke="#6b7280" strokeWidth={1} strokeDasharray="2 3" {...stroke} />
          <line x1={L} x2={L} y1={Y(gN.y)} y2={Y(Math.max(eaveRightZ ?? 0, gN.y))} stroke="#6b7280" strokeWidth={1} strokeDasharray="2 3" {...stroke} />
        </>
      )}
      {labels}
      <line x1={0} x2={L} y1={Y(ext.lowZ - fs * 1.4)} y2={Y(ext.lowZ - fs * 1.4)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={0} x2={0} y1={Y(ext.lowZ - fs * 0.9)} y2={Y(ext.lowZ - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={L} x2={L} y1={Y(ext.lowZ - fs * 0.9)} y2={Y(ext.lowZ - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <text x={L / 2} y={Y(ext.lowZ - fs * 2.7)} fontSize={fs} textAnchor="middle" {...text}>
        {side.lengthFrom === "drawn" ? "≈ " : ""}
        {formatFeetInches(shape.lengthFeet)}
      </text>
      <line x1={vx + fs} x2={vx + fs + scaleFeet} y1={Y(groundZ + fs * 0.8)} y2={Y(groundZ + fs * 0.8)} stroke={INK} strokeWidth={2} {...stroke} />
      <text x={vx + fs + scaleFeet / 2} y={Y(groundZ + fs * 1.2)} fontSize={fs * 0.7} textAnchor="middle" {...text}>
        {scaleFeet}&prime;
      </text>
      {overlay}
      {editor?.({ vx, vy, vw, vh, fontFeet: fs })}
    </svg>
  );
}

export type RoofPick = "slope" | "edge" | "ridge";

/** What a tap on the plan does: open a side and switch an end (2026-10-13), or pick slopes, eaves and rakes, or ridges. */
export type RoofPlanMode = "shape" | "slopes" | "edges" | "ridges";

/** The colour of an end's pill: a gable's its rakes', a hip's its hips'. */
const END_INK: Record<"gable" | "hip", { stroke: string; fill: string }> = {
  gable: { stroke: "#b45309", fill: "#fff7ed" },
  hip: { stroke: "#6d28d9", fill: "#f5f3ff" },
};
const SIDE_PILL = { stroke: "#1b3a5c", fill: "#eef4fb" };

/** A pill on the plan that a tap or Enter presses: an end to switch, a side to open. */
function pillProps(label: string, press: () => void) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    className: "exterior-pick exterior-pill",
    onClick: press,
    onKeyDown: (e: { key: string; preventDefault: () => void }) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        press();
      }
    },
  };
}

/**
 * The roof plan, to scale, front at the bottom: each slope lettered and shaded when it is being
 * roofed, the eaves and rakes drawn bold when chosen for the eavestrough, soffit and fascia, ridge
 * vent marked green, and every line with its true length on it (`lib/roofLabels.ts`). A lower roof
 * is drawn first, so the house's overhang lies over it as it does seen from above. With `mode` and
 * `onPick`, a tap on a slope, an edge or a ridge picks it.
 *
 * In "shape" mode (2026-10-13) each side's name is a button that opens it face-on (`onSide`), and
 * each end of the roof carries a pill saying Gable or Hip that switches it (`onEnd`). With `placing`,
 * every wall is a target for what is being put on a side (a porch, a cross gable). A length only
 * drawn, never typed, is shown as about that long (`approx`), here and on the documents alike.
 */
export function RoofPlanDrawing({
  plan,
  footprint,
  nameOf,
  slopes = null,
  edges = null,
  ridgeVents = [],
  mode = null,
  onPick,
  onSide,
  onEnd,
  placing = false,
  approx,
  fontScale = 1,
  size,
}: {
  plan: RoofPlan;
  footprint: Footprint;
  nameOf: (id: string) => string;
  slopes?: string[] | null;
  edges?: string[] | null;
  ridgeVents?: string[];
  mode?: RoofPlanMode | null;
  onPick?: (what: RoofPick, key: string) => void;
  onSide?: (sideId: string) => void;
  onEnd?: (sideId: string) => void;
  placing?: boolean;
  approx?: (sideId: string) => boolean;
  /** Bigger lettering for a plan drawn small (a phone), where the drawing's own 3% is too fine to read or tap. */
  fontScale?: number;
  size?: Size;
}) {
  const corners = footprint.corners;
  const xs = [...plan.outlineRects.flatMap((r) => [r.x0, r.x1]), ...plan.lines.flatMap((l) => [l.a.x, l.b.x]), ...corners.map((p) => p.x)];
  const ys = [...plan.outlineRects.flatMap((r) => [r.y0, r.y1]), ...plan.lines.flatMap((l) => [l.a.y, l.b.y]), ...corners.map((p) => p.y)];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fs = Math.max(0.6, Math.max(maxX - minX, maxY - minY) * 0.03) * fontScale;
  const pad = fs * 3.4;
  const Y = (y: number) => -y;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const text = { fill: INK, fontFamily: FONT };
  const n = corners.length;
  const slopeOn = (key: string) => slopes === null || slopes.includes(key);
  const edgeOn = (key: string) => edges === null || edges.includes(key);
  const pick = (what: RoofPick, key: string) => (onPick ? () => onPick(what, key) : undefined);
  const facetsDrawn = [...plan.facets].sort((p, q) => q.layer - p.layer);
  const sidesOpen = (mode === "shape" || placing) && onSide !== undefined;
  const endsSwitch = mode === "shape" && !placing && onEnd !== undefined;

  /** Each wall: its ends, which way is out, along, and how far the roof reaches out past its middle. */
  const walls = footprint.sideIds.map((id, i) => {
    const a = corners[i] as Pt;
    const b = corners[(i + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    // Out past the roof that reaches out over the middle of this side - a porch's runs further than the
    // eave - but not on across a gap: a wall facing a U's court has its name in the court.
    const along = (px: number, py: number) => ((px - a.x) * (b.x - a.x) + (py - a.y) * (b.y - a.y)) / len;
    const spans = plan.outlineRects
      .filter((r) => Math.min(along(r.x0, r.y0), along(r.x1, r.y1)) < len / 2 && Math.max(along(r.x0, r.y0), along(r.x1, r.y1)) > len / 2)
      .map((r) => {
        const o = [r.x0, r.x1].flatMap((x) => [r.y0, r.y1].map((y) => (x - a.x) * out.x + (y - a.y) * out.y));
        return [Math.min(...o), Math.max(...o)] as [number, number];
      })
      .sort((p, q) => p[0] - q[0]);
    let reach = 0;
    for (const [lo, hi] of spans) if (lo <= reach + 1e-6) reach = Math.max(reach, hi);
    return { id, i, a, b, len, out, dir, reach };
  });

  /*
    An end's pill stands just past the roof at that END - the section's, which on an L is not the
    middle of the wall under it - beside the longest stretch of it that is the roof's edge: a main
    roof's end that a wing runs on from shows only past the wing, and its pill goes there, not on
    top of the wing's own. The side's name steps out past the pill.
  */
  const endAt = (sideId: string): { at: Pt; out: Pt } | null => {
    for (const s of plan.sections) {
      if (s.role !== "main" && s.role !== "wing") continue;
      const free = (end: RoofSection["lo"]) => end !== "tie" && end !== "wall";
      const lo = s.loSide === sideId && free(s.lo);
      const hi = s.hiSide === sideId && free(s.hi);
      if (!lo && !hi) continue;
      // The end's edge: x = at (upright) or y = at, from `from` to `to` across, `out` the way past it.
      const upright = s.axis === "x";
      const at = upright ? (lo ? s.x0 : s.x1) : lo ? s.y0 : s.y1;
      const from = upright ? s.y0 : s.x0;
      const to = upright ? s.y1 : s.x1;
      const out: Pt = upright ? { x: lo ? -1 : 1, y: 0 } : { x: 0, y: lo ? -1 : 1 };
      const past = at + (upright ? out.x : out.y) * 1e-3;
      const covered = (t: number) =>
        plan.outlineRects.some((r) => (upright ? r.x0 < past && past < r.x1 && r.y0 < t && t < r.y1 : r.y0 < past && past < r.y1 && r.x0 < t && t < r.x1));
      const cuts = [...new Set([from, to, ...plan.outlineRects.flatMap((r) => (upright ? [r.y0, r.y1] : [r.x0, r.x1])).filter((v) => v > from && v < to)])].sort((p, q) => p - q);
      let best: [number, number] = [from, to];
      let run: [number, number] | null = null;
      let longest = 0;
      for (let k = 0; k + 1 < cuts.length; k++) {
        const a = cuts[k] as number;
        const b = cuts[k + 1] as number;
        if (covered((a + b) / 2)) {
          run = null;
          continue;
        }
        run = run && Math.abs(run[1] - a) < 1e-9 ? [run[0], b] : [a, b];
        if (run[1] - run[0] > longest) {
          longest = run[1] - run[0];
          best = run;
        }
      }
      const mid = (best[0] + best[1]) / 2;
      return { at: upright ? { x: at, y: mid } : { x: mid, y: at }, out };
    }
    return null;
  };
  const endPills = endsSwitch
    ? plan.ends.flatMap((end) => {
        const e = endAt(end.sideId);
        if (!e) return [];
        const across = e.out.x !== 0 ? e.at.y : e.at.x;
        // Past whatever of the roof stands out beyond the end there: a porch carried round it, say.
        const reach = plan.outlineRects.reduce((most, r) => {
          const over = e.out.x !== 0 ? r.y0 - 1e-6 <= across && across <= r.y1 + 1e-6 : r.x0 - 1e-6 <= across && across <= r.x1 + 1e-6;
          if (!over) return most;
          const far = e.out.x > 0 ? r.x1 - e.at.x : e.out.x < 0 ? e.at.x - r.x0 : e.out.y > 0 ? r.y1 - e.at.y : e.at.y - r.y0;
          return Math.max(most, far);
        }, 0);
        const words = end.kind === "hip" ? "Hip" : "Gable";
        const width = textWidthEm(words) * fs * 0.8 + fs * 1.1;
        const height = fs * 1.35;
        const o = reach + fs * 0.35 + (e.out.x !== 0 ? width / 2 : height / 2);
        const box: LabelBox = { x: e.at.x + e.out.x * o, y: e.at.y + e.out.y * o, angle: 0, width, height };
        return [{ sideId: end.sideId, kind: end.kind, words, box }];
      })
    : [];

  // The lengths keep clear of the slopes' letters and the sides' names.
  const roofBoxes: LabelBox[] = [...plan.outlineRects.map((r) => ({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, angle: 0, width: r.x1 - r.x0, height: r.y1 - r.y0 })), ...endPills.map((p) => p.box)];
  const names: LabelBox[] = [];
  const sideLabels = walls.map(({ id, i, a, b, len, out, dir, reach }) => {
    const off = Math.max(pad * 0.62, reach + fs * 0.75);
    // A label runs along its wall, so one down a side wall reads up the page rather than across the roof.
    const across = Math.abs(b.y - a.y) > Math.abs(b.x - a.x);
    const words = `${nameOf(id)} ${approx?.(id) ? "≈" : ""}${formatFeetInches(footprint.lengthsFeet[i] ?? len)}`;
    // As a button it is a pill, a little bigger than its words.
    const width = textWidthEm(words) * fs * 0.85 + (sidesOpen ? fs * 1.1 : 0);
    const height = fs * (sidesOpen ? 1.45 : 1.05);
    const at = (o: number, s: number): LabelBox => ({
      x: (a.x + b.x) / 2 + out.x * o + dir.x * s,
      y: (a.y + b.y) / 2 + out.y * o + dir.y * s,
      angle: across ? 90 : 0,
      width,
      height,
    });
    /*
      A short wall's name is longer than the wall: round a corner of many short sides it would lie over
      the next side's name, or over the roof beside it. It steps further out, or slides along its wall,
      to the first place clear of both.
    */
    const tries = [0, 1, 2, 3].flatMap((k) => [0, 0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1].map((s) => at(off + k * height * 1.1, s * width)));
    const hits = (t: LabelBox) => names.filter((q) => labelsOverlap(t, q, fs * 0.2)).length + roofBoxes.filter((q) => labelsOverlap(t, q)).length;
    // The first place clear of both; failing that, the one that covers least.
    const box = tries.reduce((best, t) => (hits(best) === 0 || hits(t) >= hits(best) ? best : t), tries[0] as LabelBox);
    names.push(box);
    return { id, box, across, words };
  });
  const facetTags = facetLabels(plan, fs);
  const obstacles: LabelBox[] = [...facetTags.map((f) => f.box), ...names, ...endPills.map((p) => p.box)];
  const labels = roofLineLabels(plan, fs * 0.62, obstacles);
  // The frame takes in every name and pill, one stepped further out than the margin included.
  const half = (b: LabelBox) => (b.angle === 0 ? { x: b.width / 2, y: b.height / 2 } : { x: b.height / 2, y: b.width / 2 });
  const framed = [...names, ...endPills.map((p) => p.box)];
  const fx0 = Math.min(minX - pad, ...framed.map((b) => b.x - half(b).x - fs * 0.3));
  const fx1 = Math.max(maxX + pad, ...framed.map((b) => b.x + half(b).x + fs * 0.3));
  const fy0 = Math.min(minY - pad, ...framed.map((b) => b.y - half(b).y - fs * 0.3));
  const fy1 = Math.max(maxY + pad, ...framed.map((b) => b.y + half(b).y + fs * 0.3));

  return (
    <svg
      className={`exterior-svg${mode ? ` exterior-svg-picking-${mode}` : ""}${placing ? " exterior-svg-placing" : ""}`}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${fx0} ${Y(fy1)} ${fx1 - fx0} ${fy1 - fy0}`}
      width={size?.width}
      height={size?.height}
      role={mode ? "group" : "img"}
      aria-label="Roof plan, to scale"
    >
      <rect x={fx0} y={Y(fy1)} width={fx1 - fx0} height={fy1 - fy0} fill="#ffffff" />
      {plan.facets.length === 0 && plan.shape !== "other" &&
        plan.outlineRects.map((r, i) => <rect key={i} x={r.x0} y={Y(r.y1)} width={r.x1 - r.x0} height={r.y1 - r.y0} fill={CHOSEN_FILL} />)}
      {plan.shape === "other" && <polygon points={plan.edges.map((l) => `${l.a.x},${Y(l.a.y)}`).join(" ")} fill={CHOSEN_FILL} />}
      {facetsDrawn.map((f) => (
        <g key={f.key} onClick={mode === "slopes" ? pick("slope", f.key) : undefined} className={mode === "slopes" ? "exterior-pick" : undefined}>
          {f.cells.map((cell, i) => (
            <polygon key={i} points={cell.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill={slopeOn(f.key) ? CHOSEN_FILL : LEFT_FILL} stroke={slopeOn(f.key) ? CHOSEN_FILL : LEFT_FILL} strokeWidth={0.5} {...stroke} />
          ))}
        </g>
      ))}
      <polygon points={corners.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" {...stroke} />
      {plan.lines.map((l) => {
        const s = LINE_STYLE[l.kind];
        const off = pickableEdge(l.kind) && !edgeOn(l.key);
        return (
          <line
            key={l.key}
            x1={l.a.x}
            y1={Y(l.a.y)}
            x2={l.b.x}
            y2={Y(l.b.y)}
            stroke={off ? "#a3a3a3" : s.stroke}
            strokeWidth={off ? 1 : s.width}
            strokeDasharray={off ? "3 3" : s.dash}
            strokeLinecap="round"
            pointerEvents="none"
            {...stroke}
          />
        );
      })}
      {plan.lines
        .filter((l) => l.kind === "ridge" && ridgeVents.includes(l.key))
        .map((l) => (
          <line key={`rv-${l.key}`} x1={l.a.x} y1={Y(l.a.y)} x2={l.b.x} y2={Y(l.b.y)} stroke={RIDGE_VENT} strokeWidth={7} strokeOpacity={0.55} strokeLinecap="round" pointerEvents="none" {...stroke} />
        ))}
      {/* What a tap can land on, wider than it is drawn: a 2-pixel rake is no target for a finger. */}
      {(mode === "edges" || mode === "ridges") &&
        plan.lines
          .filter((l) => (mode === "edges" ? pickableEdge(l.kind) : l.kind === "ridge"))
          .map((l) => (
            <line
              key={`hit-${l.key}`}
              x1={l.a.x}
              y1={Y(l.a.y)}
              x2={l.b.x}
              y2={Y(l.b.y)}
              stroke="#000000"
              strokeOpacity={0}
              strokeWidth={22}
              className="exterior-pick"
              onClick={pick(mode === "edges" ? "edge" : "ridge", l.key)}
              {...stroke}
            />
          ))}
      {/* Putting a porch or cross gable on a side: every wall is a target, drawn as one. */}
      {placing &&
        onSide &&
        walls.map((w) => (
          <g key={`place-${w.id}`} className="exterior-pick exterior-place-wall" onClick={() => onSide(w.id)}>
            <line x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} stroke="#2563eb" strokeWidth={5} strokeOpacity={0.55} strokeLinecap="round" {...stroke} />
            <line x1={w.a.x} y1={Y(w.a.y)} x2={w.b.x} y2={Y(w.b.y)} stroke="#000000" strokeOpacity={0} strokeWidth={26} {...stroke} />
          </g>
        ))}
      {labels.map((t) => {
        const muted = pickableEdge(t.kind) && !edgeOn(t.key);
        return (
          <g key={`t-${t.key}`} transform={`translate(${t.x} ${Y(t.y)}) rotate(${-t.angle})`} pointerEvents="none">
            <rect x={-t.width / 2} y={-t.height / 2} width={t.width} height={t.height} rx={t.height * 0.22} fill="#ffffff" fillOpacity={0.9} />
            <text x={0} y={t.fontFeet * 0.36} fontSize={t.fontFeet} fontWeight={600} textAnchor="middle" fill={muted ? "#8a8a8a" : LINE_STYLE[t.kind].stroke} fontFamily={FONT}>
              {t.text}
            </text>
          </g>
        );
      })}
      {facetTags.map((f) => (
        <g key={`label-${f.key}`} pointerEvents="none">
          <text x={f.x} y={Y(f.y) + f.size * 0.36} fontSize={f.size} fontWeight={700} textAnchor="middle" {...text} fillOpacity={slopeOn(f.key) ? 1 : 0.4}>
            {f.letter}
          </text>
          {f.area && (
            <text x={f.x} y={Y(f.y) + fs * 1.41} fontSize={fs * 0.65} textAnchor="middle" {...text} fillOpacity={slopeOn(f.key) ? 0.85 : 0.4}>
              {f.area}
            </text>
          )}
        </g>
      ))}
      {endPills.map((p) => {
        const ink = END_INK[p.kind];
        const name = nameOf(p.sideId);
        return (
          <g key={`end-${p.sideId}`} transform={`translate(${p.box.x} ${Y(p.box.y)})`} {...pillProps(`End over ${name}: ${p.words}. Press for a ${p.kind === "hip" ? "gable" : "hip"}`, () => onEnd?.(p.sideId))}>
            <rect x={-p.box.width / 2 - fs * 0.6} y={-p.box.height / 2 - fs * 0.6} width={p.box.width + fs * 1.2} height={p.box.height + fs * 1.2} fill="#000000" fillOpacity={0} />
            <rect x={-p.box.width / 2} y={-p.box.height / 2} width={p.box.width} height={p.box.height} rx={p.box.height / 2} fill={ink.fill} stroke={ink.stroke} strokeWidth={1.5} {...stroke} />
            <text x={0} y={fs * 0.3} fontSize={fs * 0.8} fontWeight={700} textAnchor="middle" fill={ink.stroke} fontFamily={FONT}>
              {p.words}
            </text>
          </g>
        );
      })}
      {sideLabels.map(({ id, box, across, words }) =>
        sidesOpen ? (
          <g key={id} transform={`translate(${box.x} ${Y(box.y)})${across ? " rotate(-90)" : ""}`} {...pillProps(placing ? `Put it on ${nameOf(id)}` : `Open ${nameOf(id)} face-on`, () => onSide?.(id))}>
            <rect x={-box.width / 2 - fs * 0.3} y={-box.height / 2 - fs * 0.45} width={box.width + fs * 0.6} height={box.height + fs * 0.9} fill="#000000" fillOpacity={0} />
            <rect x={-box.width / 2} y={-box.height / 2} width={box.width} height={box.height} rx={box.height / 2} fill={SIDE_PILL.fill} stroke={SIDE_PILL.stroke} strokeWidth={1} {...stroke} />
            <text x={0} y={fs * 0.3} fontSize={fs * 0.85} fontWeight={600} textAnchor="middle" fill={SIDE_PILL.stroke} fontFamily={FONT}>
              {words}
            </text>
          </g>
        ) : (
          <text key={id} x={box.x} y={Y(box.y) + fs * 0.35} fontSize={fs * 0.85} textAnchor="middle" transform={across ? `rotate(-90 ${box.x} ${Y(box.y)})` : undefined} pointerEvents="none" {...text}>
            {words}
          </text>
        ),
      )}
    </svg>
  );
}

/** The legend: each kind of line with its total along the whole roof as drawn. */
export function RoofLegend({ plan, ridgeVent }: { plan: RoofPlan; ridgeVent: boolean }) {
  const totals = lineTotals(plan);
  const swatch = (color: string, width: number, dash?: string, opacity = 1) => (
    <svg width="22" height="10" aria-hidden="true">
      <line x1="1" y1="5" x2="21" y2="5" stroke={color} strokeWidth={width} strokeDasharray={dash} strokeOpacity={opacity} />
    </svg>
  );
  return (
    <div className="exterior-legend">
      {totals.map(({ kind: k, feet }) => (
        <span key={k} className="exterior-legend-item">
          {swatch(LINE_STYLE[k].stroke, LINE_STYLE[k].width, LINE_STYLE[k].dash)}
          {LINE_STYLE[k].label} {formatQuantity(feet)} LF
        </span>
      ))}
      {ridgeVent && (
        <span className="exterior-legend-item">
          {swatch(RIDGE_VENT, 6, undefined, 0.55)}
          Ridge vent
        </span>
      )}
      <span className="exterior-legend-item">
        {swatch("#6b7280", 1, "4 3")}
        Walls
      </span>
      <span className="exterior-legend-item">
        <svg width="14" height="10" aria-hidden="true">
          <rect width="14" height="10" fill={CHOSEN_FILL} />
        </svg>
        Being roofed
      </span>
    </div>
  );
}
