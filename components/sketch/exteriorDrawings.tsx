import type { ReactNode } from "react";
import { textureMarks, textureOf } from "@/lib/claddingTexture";
import { COMPASS_WORD, type HouseView } from "@/lib/exteriorViews";
import { formatFeetInches } from "@/lib/sketch";
import {
  bandLabel,
  type CladdingKind,
  DEFAULT_EAVE_FEET,
  elevationFaces,
  type ExteriorOpening,
  type ExteriorSide,
  type Footprint,
  formatOpeningSize,
  groundAt,
  lengthToCheck,
  type RoofRise,
  zFromGrade,
} from "@/lib/exterior";
import type { Pt, RoofLineKind, RoofPlan, RoofSection } from "@/lib/roof";
import { facetLabels, type LabelBox, lineTotals, placeWallNames, roofLineLabels, type SideName, textWidthEm, type WallToName } from "@/lib/roofLabels";
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
/** The section picked to set its pitch. */
const SECTION_FILL = "#fde68a";
const FONT = "system-ui, -apple-system, Segoe UI, sans-serif";
const INK = "#1a1d23";

/** Pixel size for drawing as an image; the editor sizes them by its stylesheet instead. */
type Size = { width: number; height: number };

/** A box in the side's frame, feet: x along from its left end, y up. */
export type ElevationReach = { minX: number; maxX: number; minZ: number; maxZ: number };

/** How far an elevation reaches: the wall, its faces, its roofline and its openings - a strip of stucco over a deck runs past the wall. */
function elevationExtent(side: ExteriorSide, rise: RoofRise | null, reach?: ElevationReach, base: RoofRise | null = null) {
  const { shape, faces, openings } = elevationFaces(side, rise, base);
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
export function elevationFontFeet(side: ExteriorSide, rise: RoofRise | null, base: RoofRise | null = null): number {
  const e = elevationExtent(side, rise, undefined, base);
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

function elevationView(side: ExteriorSide, rise: RoofRise | null, reach?: ElevationReach, fontFeet?: number, base: RoofRise | null = null): ElevationView & { ext: ReturnType<typeof elevationExtent>; groundZ: number } {
  const ext = elevationExtent(side, rise, reach, base);
  const fs = fontFeet ?? elevationFontFeet(side, rise, base);
  const padX = fs * 4.2;
  const groundZ = ext.lowZ - fs * 4.6;
  return { ext, groundZ, fontFeet: fs, vx: ext.minX - padX, vw: ext.maxX - ext.minX + 2 * padX, vy: -(ext.topZ + fs * 2.6), vh: ext.topZ + fs * 2.6 - groundZ };
}

const PARGING_FILL = "#dfe1e5";
const FACE_FILL = (kind: CladdingKind | "parging") => (kind === "parging" ? PARGING_FILL : CLADDING_FILL[kind]);
/** A length worked out from the photos, not taped, and further out than it should be (`lengthToCheck`): marked to check. */
export const CHECK_INK = "#a21caf";
const MARK = "#7b8089";
const GLASS = "#e2ebf1";

/** "±6%": a side's length to check. */
export function plusMinusWords(pct: number | undefined): string {
  return pct !== undefined && pct > 0 ? `±${Math.max(1, Math.round(pct))}%` : "";
}

/**
 * A face's cladding drawn as it looks (2026-10-16): stucco's stipple, lap lines at their exposure,
 * brick coursing, stone, shakes, battens, metal ribs, parging's hatch - lib/claddingTexture.ts, grey on
 * the face's light fill. `unit` is the drawing's lettering, which sets how fine the marks go.
 */
function FaceTexture({ poly, kind, label, unit }: { poly: Pt[]; kind: CladdingKind | "parging" | "ground" | "shingles"; label?: string; unit: number }) {
  // Shingles: their courses, 5" to the weather, seen square-on.
  const marks = textureMarks(poly, kind === "ground" ? { texture: "ground" } : kind === "shingles" ? { texture: "lap", exposureFeet: 5 / 12 } : textureOf(kind, label), unit);
  const Y = (z: number) => -z;
  const ink = kind === "ground" ? "#a08a6c" : MARK;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  return (
    <g pointerEvents="none">
      {marks.lines.map(([a, b], i) => (
        <line key={`l${i}`} x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke={ink} strokeWidth={0.7} {...stroke} />
      ))}
      {marks.fine.map(([a, b], i) => (
        <line key={`f${i}`} x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke={ink} strokeOpacity={0.7} strokeWidth={0.5} {...stroke} />
      ))}
      {marks.dots.map((d, i) => (
        <line key={`d${i}`} x1={d.a.x} y1={Y(d.a.y)} x2={d.b.x} y2={Y(d.b.y)} stroke={ink} strokeWidth={1.3} strokeLinecap="round" strokeDasharray={d.dash} strokeDashoffset={d.offset} {...stroke} />
      ))}
    </g>
  );
}

/**
 * An opening drawn as what it is (2026-10-16): its trim round it, then a window's frame, glass and the
 * split a slider or a hung sash shows (a wide window slides, a tall one hangs: the shape says which); a
 * door's panels and knob, a pair of doors' glass; a garage door's sections and panels.
 */
/** The trim drawn round an opening, feet: 4", less on a small one. */
function openingTrim(rect: { x0: number; x1: number; y0: number; y1: number }): number {
  return Math.min(1 / 3, (rect.x1 - rect.x0) * 0.1, (rect.y1 - rect.y0) * 0.1);
}

/**
 * Where each opening's size is written: over it, above its trim - and, where two openings stand close
 * enough for their sizes to run into each other, the later one a line higher.
 */
function sizeLabelLevels(openings: { opening: ExteriorOpening; rect: { x0: number; x1: number; y0: number; y1: number } }[], fs: number): Map<string, number> {
  const placed: { x0: number; x1: number; y: number }[] = [];
  const at = new Map<string, number>();
  for (const { opening, rect } of [...openings].sort((a, b) => a.rect.x0 - b.rect.x0)) {
    const half = (textWidthEm(formatOpeningSize(opening.widthFeet, opening.heightFeet)) * fs * 0.75) / 2 + fs * 0.15;
    const mid = (rect.x0 + rect.x1) / 2;
    let y = rect.y1 + openingTrim(rect) + fs * 0.3;
    while (placed.some((q) => q.x0 < mid + half && q.x1 > mid - half && Math.abs(q.y - y) < fs * 0.8)) y += fs * 0.85;
    placed.push({ x0: mid - half, x1: mid + half, y });
    at.set(opening.id, y);
  }
  return at;
}

function OpeningGlyph({
  opening,
  rect,
  fs,
  seeThrough,
  labelZ,
}: {
  opening: Pick<ExteriorOpening, "kind"> & Partial<Pick<ExteriorOpening, "widthFeet" | "heightFeet">>;
  rect: { x0: number; x1: number; y0: number; y1: number };
  fs: number;
  seeThrough: boolean;
  /** Where its size is written; none, no size (the house's elevations: each side's has them). */
  labelZ?: number;
}) {
  const Y = (z: number) => -z;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const fillOpacity = seeThrough ? 0 : 1;
  const { x0, x1, y0, y1 } = rect;
  const w = x1 - x0;
  const h = y1 - y0;
  const trim = openingTrim(rect);
  const sill = opening.kind === "window" ? trim : 0;
  const box = (key: string, a: number, b: number, c: number, d: number, fill: string, ink: string, width: number) => (
    <rect key={key} x={a} y={Y(d)} width={Math.max(0, c - a)} height={Math.max(0, d - b)} fill={fill} fillOpacity={fill === "none" ? undefined : fillOpacity} stroke={ink} strokeWidth={width} {...stroke} />
  );
  // Two strokes across a pane's upper corner: glass, read in black and white.
  const glint = (key: string, a: number, b: number, c: number, d: number) => {
    const pw = c - a;
    const ph = d - b;
    const s = Math.min(pw, ph);
    return (
      <g key={key}>
        <line x1={a + pw * 0.14} y1={Y(d - ph * 0.14 - s * 0.32)} x2={a + pw * 0.14 + s * 0.32} y2={Y(d - ph * 0.14)} stroke="#9db0be" strokeWidth={0.7} {...stroke} />
        <line x1={a + pw * 0.14} y1={Y(d - ph * 0.14 - s * 0.5)} x2={a + pw * 0.14 + s * 0.5} y2={Y(d - ph * 0.14)} stroke="#9db0be" strokeWidth={0.7} {...stroke} />
      </g>
    );
  };
  const pane = (key: string, a: number, b: number, c: number, d: number) => [box(`${key}g`, a, b, c, d, GLASS, "#6b7280", 0.7), glint(`${key}s`, a, b, c, d)];
  const parts: ReactNode[] = [box("trim", x0 - trim, y0 - sill, x1 + trim, y1 + trim, "#ffffff", "#6b7280", 0.8), box("frame", x0, y0, x1, y1, "#ffffff", INK, 1.1)];
  if (opening.kind === "window") {
    const f = Math.min(0.15, w * 0.07, h * 0.07);
    if (w >= h * 1.5) {
      const mid = (x0 + x1) / 2;
      parts.push(...pane("l", x0 + f, y0 + f, mid - f / 3, y1 - f), ...pane("r", mid + f / 3, y0 + f, x1 - f, y1 - f));
    } else if (h >= w * 1.3) {
      const mid = (y0 + y1) / 2;
      parts.push(...pane("b", x0 + f, y0 + f, x1 - f, mid - f / 3), ...pane("t", x0 + f, mid + f / 3, x1 - f, y1 - f));
    } else parts.push(...pane("p", x0 + f, y0 + f, x1 - f, y1 - f));
  } else if (opening.kind === "door") {
    const f = Math.min(0.12, w * 0.05);
    const knob = (key: string, x: number) => <circle key={key} cx={x} cy={Y(y0 + Math.min(3, h * 0.45))} r={Math.min(0.09, w * 0.035)} fill="#6b7280" fillOpacity={fillOpacity} stroke={INK} strokeWidth={0.6} {...stroke} />;
    if (w >= 4.5) {
      // A pair: two leaves of glass meeting in the middle.
      const mid = (x0 + x1) / 2;
      for (const [k, a, c] of [["a", x0 + f, mid], ["b", mid, x1 - f]] as [string, number, number][]) {
        const m = (c - a) * 0.16;
        parts.push(box(`leaf${k}`, a, y0, c, y1 - f, "#ffffff", "#4b5563", 0.8), ...pane(k, a + m, y0 + m * 1.6, c - m, y1 - f - m));
      }
      parts.push(knob("ka", mid - w * 0.05), knob("kb", mid + w * 0.05));
    } else {
      // Six panels: two small over two tall over two.
      const lw = w - 2 * f;
      const m = lw * 0.13;
      const top = y1 - f - m;
      const bottom = y0 + m;
      const span = top - bottom - 2 * m;
      const rows = [0.3, 0.42, 0.28].map((r) => r * span);
      let y = top;
      parts.push(box("leaf", x0 + f, y0, x1 - f, y1 - f, "#ffffff", "#4b5563", 0.8));
      rows.forEach((rh, r) => {
        for (const c of [0, 1]) {
          const a = x0 + f + m + c * ((lw - m) / 2);
          parts.push(box(`p${r}${c}`, a, y - rh, a + (lw - 3 * m) / 2, y, "none", "#6b7280", 0.6));
        }
        y -= rh + m;
      });
      parts.push(knob("k", x1 - f - lw * 0.12));
    }
  } else {
    // A garage door: its sections, each of panels.
    const rows = Math.max(3, Math.round(h / 1.9));
    const cols = Math.max(2, Math.round(w / 3));
    const rh = h / rows;
    for (let r = 1; r < rows; r++) parts.push(<line key={`s${r}`} x1={x0} x2={x1} y1={Y(y0 + r * rh)} y2={Y(y0 + r * rh)} stroke="#4b5563" strokeWidth={0.8} {...stroke} />);
    const mx = Math.min(0.35, w / cols * 0.12);
    const my = Math.min(0.3, rh * 0.18);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = x0 + (c * w) / cols;
        parts.push(box(`g${r}${c}`, a + mx, y0 + r * rh + my, a + w / cols - mx, y0 + (r + 1) * rh - my, "none", "#8a9099", 0.6));
      }
    }
  }
  return (
    <g pointerEvents="none">
      {parts}
      {labelZ !== undefined && opening.widthFeet !== undefined && opening.heightFeet !== undefined && (
        <text x={(x0 + x1) / 2} y={Y(labelZ)} fontSize={fs * 0.75} textAnchor="middle" fill={INK} fontFamily={FONT}>
          {formatOpeningSize(opening.widthFeet, opening.heightFeet)}
        </text>
      )}
    </g>
  );
}

function insidePoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Where a face's name goes: low and to the left, wholly on the face and clear of every opening, its trim
 * and the size over it - the first such place up from the bottom. Null where there is none: the legend names it.
 */
function faceLabelSpot(poly: Pt[], width: number, fs: number, rects: { x0: number; x1: number; y0: number; y1: number }[]): Pt | null {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.max(0, Math.min(...xs)), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const clear = rects.map((r) => ({ x0: r.x0 - 0.5, x1: r.x1 + 0.5, y0: r.y0 - 0.5, y1: r.y1 + 0.5 + fs }));
  for (let y = y0 + fs * 0.6; y + fs * 1.1 <= y1; y += fs * 0.5) {
    for (let x = x0 + fs * 0.6; x + width + fs * 0.4 <= x1; x += fs) {
      const box = { x0: x - fs * 0.3, x1: x + width + fs * 0.3, y0: y - fs * 0.35, y1: y + fs * 0.95 };
      const corners = [
        { x: box.x0, y: box.y0 },
        { x: box.x1, y: box.y0 },
        { x: box.x1, y: box.y1 },
        { x: box.x0, y: box.y1 },
        { x: (box.x0 + box.x1) / 2, y: box.y0 },
        { x: (box.x0 + box.x1) / 2, y: box.y1 },
      ];
      if (!corners.every((c) => insidePoly(poly, c))) continue;
      if (clear.some((r) => box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0)) continue;
      return { x, y };
    }
  }
  return null;
}

/** A material in the legend: what the elevations show it as. */
export interface LegendItem {
  kind: CladdingKind | "parging";
  label: string;
}

/**
 * The elevations' legend (2026-10-16): each material on the house as its swatch shows it - the same
 * marks as the faces - with its name. Lettered at 1 unit; drawn at whatever scale the page wants.
 */
export function CladdingLegend({ items, size }: { items: LegendItem[]; size?: Size }) {
  const sw = 2.6;
  const sh = 1.6;
  const gap = 1.2;
  const fs = 1;
  const Y = (z: number) => -z;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  let x = 0;
  const cells = items.map((it) => {
    const at = x;
    x += sw + 0.5 + textWidthEm(it.label) * fs + gap;
    return { it, at };
  });
  const w = Math.max(1, x - gap);
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 ${-sh - 0.2} ${w} ${sh + 0.4}`} width={size?.width} height={size?.height} role="img" aria-label="Materials">
      {cells.map(({ it, at }) => {
        const poly = [
          { x: at, y: 0 },
          { x: at + sw, y: 0 },
          { x: at + sw, y: sh },
          { x: at, y: sh },
        ];
        return (
          <g key={`${it.kind}-${it.label}`}>
            <rect x={at} y={Y(sh)} width={sw} height={sh} fill={FACE_FILL(it.kind)} />
            <FaceTexture poly={poly} kind={it.kind} label={it.label} unit={fs} />
            <rect x={at} y={Y(sh)} width={sw} height={sh} fill="none" stroke="#374151" strokeWidth={0.8} {...stroke} />
            <text x={at + sw + 0.5} y={Y(sh / 2) + fs * 0.35} fontSize={fs} fill={INK} fontFamily={FONT}>
              {it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * One side, to scale. `fontFeet` sets the lettering, so a sheet of sides drawn at one scale can
 * letter them all alike; left out, the drawing sizes it to itself.
 *
 * In the editor a side's photo can lie behind it (`backdrop`) and an AI trace over it (`overlay`),
 * both drawn in the drawing's own space - x feet along, y MINUS feet up - and `reach` widens the
 * drawing to hold them. `seeThrough` lets the photo show through the faces. `editor` draws what is
 * dragged and tapped to edit the side face-on (2026-10-13), last, in the same space and frame.
 * `roofAssumed`: the roof's pitch is the assumed one, so a gable the roof gives says so. `base`: an
 * upper-floor side (2026-10-14) stands on it - the floor line, and any lower roof against it - drawn
 * as the roof and wall below in grey, where a side on the ground has the ground.
 */
export function ElevationDrawing({
  side,
  rise,
  base = null,
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
  base?: RoofRise | null;
}) {
  const { shape, faces, bandLines, grade, openings, fromShapes } = elevationFaces(side, rise, base);
  const L = Math.max(1, shape.lengthFeet);
  const eaveZ = shape.eaveZ;
  const view = elevationView(side, rise, reach, fontFeet, base);
  // An upper-floor side stands on the main floor and its lower roofs, not on the ground.
  const upper = shape.bottomLine !== undefined || base !== null;
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
  // Drawn as it looks, not over the side's photo: there the photo is the look.
  const textured = !seeThrough;

  // The eave at each end: level for a taped side, each its own on a side tapped from one level.
  const eaveLeftZ = fromShapes || side.heightsFrom === "level" ? side.eaveLeftFeet : eaveZ;
  const eaveRightZ = fromShapes || side.heightsFrom === "level" ? side.eaveRightFeet ?? side.eaveLeftFeet : eaveZ;
  // Each height as a tape from the ground under it reads it: on a side tapped as shapes, from its parging's bottom, stepped or not.
  const fromGround = (z: number, x: number) => z - groundAt(side, x);
  if (eaveLeftZ != null && side.eaveLeftFeet != null) {
    labels.push(
      <text key="eL" x={-fs * 0.5} y={Y(eaveLeftZ) + fs * 0.35} fontSize={fs} textAnchor="end" {...text}>
        {formatFeetInches(fromShapes ? fromGround(eaveLeftZ, 0) : side.eaveLeftFeet)}
      </text>,
    );
  }
  if (eaveRightZ != null && side.eaveRightFeet != null) {
    labels.push(
      <text key="eR" x={L + fs * 0.5} y={Y(eaveRightZ) + fs * 0.35} fontSize={fs} textAnchor="start" {...text}>
        {formatFeetInches(fromShapes ? fromGround(eaveRightZ, L) : side.eaveRightFeet)}
      </text>,
    );
  }
  const peak = fromShapes ? (side.gable ? { x: side.gable.atFeet, y: zFromGrade(side, side.gable.atFeet, side.gable.peakFeet), source: "measured" } : null) : shape.gable ? { ...shape.gable.peak, source: shape.gable.source } : null;
  if (peak) {
    labels.push(
      <text key="peak" x={peak.x} y={Y(peak.y) - fs * 0.6} fontSize={fs} textAnchor="middle" {...text}>
        {formatFeetInches(fromShapes ? fromGround(peak.y, peak.x) : peak.y - zFromGrade(side, peak.x, 0))}
        {peak.source === "roof" ? (roofAssumed ? " (roof, pitch assumed)" : " (roof)") : ""}
      </text>,
    );
  }
  const roofline = side.roofline ?? [];
  // The ground's edge: a hatched strip under the line it stands on, stepped where the ground steps.
  const earth = [...ground, ...[...ground].reverse().map((p) => ({ x: p.x, y: p.y - fs * 0.55 }))];
  const parging = !fromShapes && side.base === "parging" ? [shape.grade[0], shape.grade[1], shape.bottom[1], shape.bottom[0]] : null;
  // A length worked out from the photos, not taped: to check, on the drawing as in the report.
  const pm = plusMinusWords(lengthToCheck(side));
  const dimInk = pm ? CHECK_INK : "#374151";
  const sizeAt = sizeLabelLevels(openings, fs);

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
      <polygon points={pts([...ground, { x: vx + vw, y: groundZ }, { x: vx, y: groundZ }])} fill={upper ? "#e5e7eb" : "#f4efe6"} fillOpacity={seeThrough ? 0.25 : 1} />
      {textured && !upper && <FaceTexture poly={earth} kind="ground" unit={fs} />}
      {parging && (
        <>
          <polygon points={pts(parging)} fill={PARGING_FILL} fillOpacity={faceOpacity} />
          {textured && <FaceTexture poly={parging} kind="parging" unit={fs} />}
          <polygon points={pts(parging)} fill="none" stroke="#8a9099" strokeWidth={1} {...stroke} />
        </>
      )}
      {faces.map((f) =>
        f.poly.length >= 3 ? (
          <g key={f.id}>
            {f.closed && <polygon points={pts(f.poly)} fill={FACE_FILL(f.kind)} fillOpacity={faceOpacity} />}
            {f.closed && textured && <FaceTexture poly={f.poly} kind={f.kind} label={f.label} unit={fs} />}
            {(fromShapes || seeThrough) && <polygon points={pts(f.poly)} fill="none" stroke="#374151" strokeWidth={1.2} strokeDasharray={f.closed ? undefined : "4 3"} {...stroke} />}
          </g>
        ) : (
          <polyline key={f.id} points={pts(f.poly)} fill="none" stroke="#374151" strokeWidth={1.2} strokeDasharray="4 3" {...stroke} />
        ),
      )}
      {bandLines.map((hi, i) =>
        eaveZ !== null && hi > Math.min(shape.bottom[0].y, shape.bottom[1].y) && hi < ext.topZ ? (
          <line key={`line-${i}`} x1={0} x2={L} y1={Y(hi)} y2={Y(hi)} stroke="#4b5563" strokeWidth={1} strokeDasharray="5 4" {...stroke} />
        ) : null,
      )}
      {faces.map((f) => {
        if (f.poly.length < 3 || f.kind === "parging") return null;
        const words = `${f.label}${f.closed ? "" : " (open: not counted)"}`;
        const at = faceLabelSpot(f.poly, textWidthEm(words) * fs * 0.85, fs, openings.map((o) => o.rect));
        if (!at) return null;
        // On a plate of white, so the face's marks don't run through it.
        return (
          <g key={`label-${f.id}`} pointerEvents="none">
            {textured && <rect x={at.x - fs * 0.2} y={Y(at.y) - fs * 0.85} width={textWidthEm(words) * fs * 0.85 + fs * 0.4} height={fs * 1.15} rx={fs * 0.2} fill="#ffffff" fillOpacity={0.85} />}
            <text x={at.x} y={Y(at.y)} fontSize={fs * 0.85} fill="#4b5563" fontFamily={FONT} fontStyle="italic">
              {words}
            </text>
          </g>
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
        <OpeningGlyph key={opening.id} opening={opening} rect={rect} fs={fs} seeThrough={seeThrough} labelZ={sizeAt.get(opening.id) ?? rect.y1} />
      ))}
      <polyline points={pts(ground)} fill="none" stroke={upper ? "#4b5563" : "#5b4630"} strokeWidth={2} {...stroke} />
      {/* Where the wall stands, when the cladding runs past it. */}
      {fromShapes && (ext.minX < -1e-6 || ext.maxX > L + 1e-6) && (
        <>
          <line x1={0} x2={0} y1={Y(g0.y)} y2={Y(Math.max(eaveLeftZ ?? 0, g0.y))} stroke="#6b7280" strokeWidth={1} strokeDasharray="2 3" {...stroke} />
          <line x1={L} x2={L} y1={Y(gN.y)} y2={Y(Math.max(eaveRightZ ?? 0, gN.y))} stroke="#6b7280" strokeWidth={1} strokeDasharray="2 3" {...stroke} />
        </>
      )}
      {labels}
      <line x1={0} x2={L} y1={Y(ext.lowZ - fs * 1.4)} y2={Y(ext.lowZ - fs * 1.4)} stroke={dimInk} strokeWidth={1} strokeDasharray={pm ? "5 3" : undefined} {...stroke} />
      <line x1={0} x2={0} y1={Y(ext.lowZ - fs * 0.9)} y2={Y(ext.lowZ - fs * 1.9)} stroke={dimInk} strokeWidth={1} {...stroke} />
      <line x1={L} x2={L} y1={Y(ext.lowZ - fs * 0.9)} y2={Y(ext.lowZ - fs * 1.9)} stroke={dimInk} strokeWidth={1} {...stroke} />
      <text x={L / 2} y={Y(ext.lowZ - fs * 2.7)} fontSize={fs} textAnchor="middle" fill={pm ? CHECK_INK : INK} fontFamily={FONT} fontWeight={pm ? 600 : undefined}>
        {side.lengthFrom === "drawn" ? "≈ " : ""}
        {formatFeetInches(shape.lengthFeet)}
        {pm ? ` ${pm}` : ""}
      </text>
      <line x1={vx + fs} x2={vx + fs + scaleFeet} y1={Y(groundZ + fs * 0.55)} y2={Y(groundZ + fs * 0.55)} stroke={INK} strokeWidth={2} {...stroke} />
      <text x={vx + fs + scaleFeet / 2} y={Y(groundZ + fs * 0.95)} fontSize={fs * 0.7} textAnchor="middle" {...text}>
        {scaleFeet}&prime;
      </text>
      {overlay}
      {editor?.({ vx, vy, vw, vh, fontFeet: fs })}
    </svg>
  );
}

const ROOF_FILL = "#cdd2d8";
const ROOF_FILL_SIDE = "#e1e4e8";
/** A siding face the roof brings (a cross gable's front, a step between two parts of one roof). */
const ROOF_SIDING = "#ece7dc";

/** The lettering size a house elevation picks for itself, in feet: 3% of its larger dimension. */
export function houseViewFontFeet(view: HouseView): number {
  return Math.max(0.5, Math.max(view.maxX - view.minX, view.topY - view.groundY) * 0.03);
}

/**
 * The whole house seen square-on from one compass point (2026-10-16): lib/exteriorViews.ts's pieces drawn
 * back to front - each wall that faces the view with its cladding's marks, windows and doors as on its own
 * elevation, the roof's slopes with their shingle courses, the fascia and the posts - standing on the
 * ground as the nearest wall meets it. Under it the overall width; to its right the main levels, each
 * above the lowest ground the view shows.
 */
export function HouseElevationDrawing({ view, fontFeet, size }: { view: HouseView; fontFeet?: number; size?: Size }) {
  const fs = fontFeet ?? houseViewFontFeet(view);
  const Y = (z: number) => -z;
  const pts = (poly: Pt[]) => poly.map((p) => `${p.x},${Y(p.y)}`).join(" ");
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const text = { fill: INK, fontFamily: FONT };
  const ground = view.ground.length >= 2 ? view.ground : [{ x: view.minX, y: view.groundY }, { x: view.maxX, y: view.groundY }];
  const levelsW = Math.max(0, ...view.levels.map((l) => textWidthEm(`${l.label} ${formatFeetInches(l.y - view.groundY)}`))) * fs * 0.8;
  const vx = view.minX - fs * 2;
  const vw = view.maxX + fs * 2.2 + levelsW - vx + fs;
  const bottomY = view.groundY - fs * 4.6;
  const vy = -(view.topY + fs * 1.5);
  const vh = view.topY + fs * 1.5 - bottomY;
  const g0 = ground[0] as Pt;
  const gN = ground[ground.length - 1] as Pt;
  // The ground stops short of the levels' column, so their words stand clear of it.
  const line = [{ x: vx, y: g0.y }, ...ground, { x: view.maxX + fs * 0.6, y: gN.y }];
  const earth = [...line, ...[...line].reverse().map((p) => ({ x: p.x, y: p.y - fs * 0.55 }))];
  // The levels up the right, kept a line apart where two are close.
  const levels: { label: string; y: number; at: number }[] = [];
  for (const l of [{ label: "Ground", y: view.groundY }, ...view.levels]) {
    const last = levels[levels.length - 1];
    levels.push({ ...l, at: last ? Math.max(l.y, last.at + fs * 1.1) : l.y });
  }
  const width = view.maxX - view.minX;
  const scaleFeet = width >= 30 ? 10 : 5;
  const lx = view.maxX + fs * 0.8;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${vx} ${vy} ${vw} ${vh}`} width={size?.width} height={size?.height} role="img" aria-label={`${COMPASS_WORD[view.compass]} elevation of the house, to scale`}>
      <rect x={vx} y={vy} width={vw} height={vh} fill="#ffffff" />
      {view.pieces.map((p, i) => {
        if (p.type === "post") {
          return <rect key={`post-${i}`} x={p.x0} y={Y(p.y1)} width={p.x1 - p.x0} height={p.y1 - p.y0} fill="#ffffff" stroke="#374151" strokeWidth={0.9} {...stroke} />;
        }
        if (p.type === "roof" && p.kind === "edge") {
          // A slope seen edge-on: the roof's profile, a line.
          return <polyline key={`roof-${i}`} points={pts([...p.poly, p.poly[0] as Pt])} fill="none" stroke="#4b5563" strokeWidth={0.9} strokeLinejoin="round" {...stroke} />;
        }
        if (p.type === "roof") {
          const fill = p.kind === "fascia" ? "#ffffff" : p.kind === "slope" ? (p.facing > 0.7 ? ROOF_FILL : ROOF_FILL_SIDE) : ROOF_SIDING;
          return (
            <g key={`roof-${i}`}>
              <polygon points={pts(p.poly)} fill={fill} />
              {p.kind === "slope" && <FaceTexture poly={p.poly} kind="shingles" unit={fs} />}
              <polygon points={pts(p.poly)} fill="none" stroke="#4b5563" strokeWidth={p.kind === "fascia" ? 0.8 : 0.9} strokeLinejoin="round" {...stroke} />
            </g>
          );
        }
        return (
          <g key={`wall-${p.id}-${i}`}>
            <polygon points={pts(p.outline)} fill={p.background === "unclad" ? "#eef0f2" : FACE_FILL(p.background)} />
            {p.background !== "unclad" && <FaceTexture poly={p.outline} kind={p.background} unit={fs} />}
            {p.faces.map((f, k) =>
              f.poly.length >= 3 ? (
                <g key={k}>
                  <polygon points={pts(f.poly)} fill={FACE_FILL(f.kind)} />
                  <FaceTexture poly={f.poly} kind={f.kind} unit={fs} />
                  <polygon points={pts(f.poly)} fill="none" stroke="#6b7280" strokeWidth={0.6} {...stroke} />
                </g>
              ) : null,
            )}
            {p.openings.map((o) => (
              <OpeningGlyph key={o.id} opening={{ kind: o.kind }} rect={o} fs={fs} seeThrough={false} />
            ))}
            <polygon points={pts(p.outline)} fill="none" stroke="#374151" strokeWidth={1.1} strokeLinejoin="round" {...stroke} />
          </g>
        );
      })}
      {/* The ground in front, over the foot of all behind it: a post or a wall further back stands down into it. */}
      <polygon points={pts([...line, { x: view.maxX + fs * 0.6, y: bottomY }, { x: vx, y: bottomY }])} fill="#f4efe6" />
      <FaceTexture poly={earth} kind="ground" unit={fs} />
      <polyline points={pts(line)} fill="none" stroke="#5b4630" strokeWidth={2} {...stroke} />
      {/* The overall width under it. */}
      <line x1={view.minX} x2={view.maxX} y1={Y(view.groundY - fs * 1.4)} y2={Y(view.groundY - fs * 1.4)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={view.minX} x2={view.minX} y1={Y(view.groundY - fs * 0.9)} y2={Y(view.groundY - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <line x1={view.maxX} x2={view.maxX} y1={Y(view.groundY - fs * 0.9)} y2={Y(view.groundY - fs * 1.9)} stroke="#374151" strokeWidth={1} {...stroke} />
      <text x={(view.minX + view.maxX) / 2} y={Y(view.groundY - fs * 2.7)} fontSize={fs} textAnchor="middle" {...text}>
        {formatFeetInches(width)} overall
      </text>
      {/* The main levels up the right, each above the lowest ground in the view. */}
      {levels.map((l, k) => (
        <g key={`level-${k}`}>
          <line x1={view.maxX + fs * 0.15} x2={lx + fs * 0.5} y1={Y(l.y)} y2={Y(l.y)} stroke="#6b7280" strokeWidth={0.8} strokeDasharray="3 2" {...stroke} />
          <polygon points={pts([{ x: lx + fs * 0.5, y: l.y }, { x: lx + fs * 0.85, y: l.y + fs * 0.35 }, { x: lx + fs * 0.15, y: l.y + fs * 0.35 }])} fill="#374151" />
          <text x={lx + fs * 1.1} y={Y(l.at) - fs * 0.12} fontSize={fs * 0.8} {...text}>
            {k === 0 ? "Ground" : `${l.label} ${formatFeetInches(l.y - view.groundY)}`}
          </text>
        </g>
      ))}
      <line x1={vx + fs} x2={vx + fs + scaleFeet} y1={Y(bottomY + fs * 0.55)} y2={Y(bottomY + fs * 0.55)} stroke={INK} strokeWidth={2} {...stroke} />
      <text x={vx + fs + scaleFeet / 2} y={Y(bottomY + fs * 0.95)} fontSize={fs * 0.7} textAnchor="middle" {...text}>
        {scaleFeet}&prime;
      </text>
    </svg>
  );
}

export type RoofPick = "slope" | "edge" | "ridge" | "section";

/**
 * What a tap on the plan does: open a side and switch an end (2026-10-13), pick slopes, eaves and
 * rakes, or ridges, or pick a section to set its own pitch (2026-10-14).
 */
export type RoofPlanMode = "shape" | "slopes" | "edges" | "ridges" | "pitch";

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
 * drawn, never typed, is shown as about that long (`approx`), here and on the documents alike; one worked
 * out from the photos with its ± (`plusMinus`, 2026-10-16), marked along its outside to check.
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
  plusMinus,
  fontScale = 1,
  section = null,
  upper = null,
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
  /** A side's ± on its length, worked out from the photos: `ExteriorSide.lengthPlusMinusPct`. */
  plusMinus?: (sideId: string) => number | undefined;
  /** Bigger lettering for a plan drawn small (a phone), where the drawing's own 3% is too fine to read or tap. */
  fontScale?: number;
  /** In "pitch" mode, the section picked (`RoofSection.key`): its slopes shaded. */
  section?: string | null;
  /** A two-storey house's upper floor, drawn over the main floor's walls. */
  upper?: Pt[] | null;
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

  /*
    Each wall's name and length beside it, just past the roof's edge (2026-10-16: on the owner's report
    they floated off across the page): kept off the roof, the pills and each other, on two lines where one
    is longer than the wall, and with a line back to the wall where it has to stand off (lib/roofLabels.ts).
  */
  const nameEm = fs * 0.85;
  const roofPolys = plan.outlineRects.map((r) => [
    { x: r.x0, y: r.y0 },
    { x: r.x1, y: r.y0 },
    { x: r.x1, y: r.y1 },
    { x: r.x0, y: r.y1 },
  ]);
  const sideNames = placeWallNames(
    walls.map(({ id, i, a, b, len, out, reach }) => ({ id, a, b, out, name: nameOf(id), length: lengthWords(id, footprint.lengthsFeet[i] ?? len, approx, plusMinus), clear: reach })),
    nameEm,
    { boxes: endPills.map((p) => p.box), polygons: [...roofPolys, corners] },
    sidesOpen ? fs * 0.45 : 0,
  );
  const facetTags = facetLabels(plan, fs);
  const obstacles: LabelBox[] = [...facetTags.map((f) => f.box), ...sideNames.map((n) => n.box), ...endPills.map((p) => p.box)];
  const labels = roofLineLabels(plan, fs * 0.62, obstacles);
  // The frame takes in every name and pill, one stepped further out than the margin included.
  const half = (b: LabelBox) => (b.angle === 0 ? { x: b.width / 2, y: b.height / 2 } : { x: b.height / 2, y: b.width / 2 });
  const framed = [...sideNames.map((n) => n.box), ...endPills.map((p) => p.box)];
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
      {facetsDrawn.map((f) => {
        // Picking a section's pitch: every slope is a target, and the picked section's are shaded.
        const fill = mode === "pitch" ? (section !== null && (f.section ?? "main") === section ? SECTION_FILL : CHOSEN_FILL) : slopeOn(f.key) ? CHOSEN_FILL : LEFT_FILL;
        const onClick = mode === "slopes" ? pick("slope", f.key) : mode === "pitch" ? pick("section", f.section ?? "main") : undefined;
        return (
          <g key={f.key} onClick={onClick} className={onClick ? "exterior-pick" : undefined}>
            {f.cells.map((cell, i) => (
              <polygon key={i} points={cell.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill={fill} stroke={fill} strokeWidth={0.5} {...stroke} />
            ))}
          </g>
        );
      })}
      <polygon points={corners.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#6b7280" strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" {...stroke} />
      {walls.filter((w) => plusMinusWords(plusMinus?.(w.id))).map((w) => (
        <CheckMark key={`check-${w.id}`} a={w.a} b={w.b} out={w.out} off={0} />
      ))}
      {upper && upper.length > 2 && <polygon points={upper.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#1b3a5c" strokeWidth={1.6} strokeDasharray="9 4" pointerEvents="none" {...stroke} />}
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
      {sideNames.map((n) => {
        const ink = plusMinusWords(plusMinus?.(n.id)) ? CHECK_INK : sidesOpen ? SIDE_PILL.stroke : INK;
        const { box } = n;
        return (
          <g key={n.id}>
            <NameLeader name={n} fs={fs} />
            {sidesOpen ? (
              <g transform={`translate(${box.x} ${Y(box.y)})${n.upright ? " rotate(-90)" : ""}`} {...pillProps(placing ? `Put it on ${nameOf(n.id)}` : `Open ${nameOf(n.id)} face-on`, () => onSide?.(n.id))}>
                <rect x={-box.width / 2 - fs * 0.3} y={-box.height / 2 - fs * 0.45} width={box.width + fs * 0.6} height={box.height + fs * 0.9} fill="#000000" fillOpacity={0} />
                <rect x={-box.width / 2} y={-box.height / 2} width={box.width} height={box.height} rx={Math.min(box.height / 2, nameEm * 0.8)} fill={SIDE_PILL.fill} stroke={SIDE_PILL.stroke} strokeWidth={1} {...stroke} />
                <NameLines lines={n.lines} em={nameEm} ink={ink} bold />
              </g>
            ) : (
              <g transform={`translate(${box.x} ${Y(box.y)})${n.upright ? " rotate(-90)" : ""}`} pointerEvents="none">
                <rect x={-box.width / 2} y={-box.height / 2} width={box.width} height={box.height} rx={nameEm * 0.2} fill="#ffffff" fillOpacity={0.85} />
                <NameLines lines={n.lines} em={nameEm} ink={ink} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** A wall's length as its name gives it: about that long when only drawn, and ± when worked out from photos. */
function lengthWords(id: string, feet: number, approx?: (sideId: string) => boolean, plusMinus?: (sideId: string) => number | undefined): string {
  const pm = plusMinusWords(plusMinus?.(id));
  return `${approx?.(id) ? "≈" : ""}${formatFeetInches(feet)}${pm ? ` ${pm}` : ""}`;
}

/** A wall name's lines, centred on its box: drawn in the box's own frame. */
function NameLines({ lines, em, ink, bold = false }: { lines: string[]; em: number; ink: string; bold?: boolean }) {
  const lead = em * 1.2;
  return (
    <>
      {lines.map((t, k) => (
        <text key={k} x={0} y={(k - (lines.length - 1) / 2) * lead + em * 0.35} fontSize={em} fontWeight={bold ? 600 : undefined} textAnchor="middle" fill={ink} fontFamily={FONT}>
          {t}
        </text>
      ))}
    </>
  );
}

/** The thin line from a name that had to stand off its wall back to it, with a dot on the wall. */
function NameLeader({ name, fs }: { name: SideName; fs: number }) {
  if (!name.leader) return null;
  const [p, q] = name.leader;
  return (
    <g pointerEvents="none">
      <line x1={p.x} y1={-p.y} x2={q.x} y2={-q.y} stroke="#6b7280" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      <circle cx={q.x} cy={-q.y} r={fs * 0.12} fill="#6b7280" />
    </g>
  );
}

/** A wall whose length is to check, marked along its outside: dashed, in the check's colour. */
function CheckMark({ a, b, out, off }: { a: Pt; b: Pt; out: Pt; off: number }) {
  return <line x1={a.x + out.x * off} y1={-(a.y + out.y * off)} x2={b.x + out.x * off} y2={-(b.y + out.y * off)} stroke={CHECK_INK} strokeWidth={2.2} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
}

/** The legend: each kind of line with its total along the whole roof as drawn. */
export function RoofLegend({ plan, ridgeVent, upper = false }: { plan: RoofPlan; ridgeVent: boolean; upper?: boolean }) {
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
      {upper && (
        <span className="exterior-legend-item">
          {swatch("#1b3a5c", 1.6, "9 4")}
          Upper floor walls
        </span>
      )}
      <span className="exterior-legend-item">
        <svg width="14" height="10" aria-hidden="true">
          <rect width="14" height="10" fill={CHOSEN_FILL} />
        </svg>
        Being roofed
      </span>
    </div>
  );
}

/**
 * The footprint alone, to scale, front at the bottom (2026-10-15, the exterior report): the walls as
 * the house's outline, each with its name and length beside it outside - placed as the roof plan places
 * them (lib/roofLabels.ts `placeWallNames`): off the house and each other, on two lines where one is
 * longer than the wall, with a line back to it where it has to stand off - and the upper floor's outline
 * over it on a two-storey house. A length only drawn reads "≈"; one worked out from the photos carries
 * its ± and a dashed mark along the wall's outside (2026-10-16).
 */
export function FootprintDrawing({
  footprint,
  nameOf,
  approx,
  plusMinus,
  upper = null,
  size,
  fontFeet,
}: {
  footprint: Footprint;
  nameOf: (id: string) => string;
  approx?: (sideId: string) => boolean;
  /** A side's ± on its length: `ExteriorSide.lengthPlusMinusPct`. */
  plusMinus?: (sideId: string) => number | undefined;
  upper?: Pt[] | null;
  size?: Size;
  /** The lettering, feet: a page drawn to a fixed scale sets it; left out, 3% of the house. */
  fontFeet?: number;
}) {
  const corners = footprint.corners;
  const n = corners.length;
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fs = fontFeet ?? Math.max(0.6, Math.max(maxX - minX, maxY - minY) * 0.03);
  const Y = (y: number) => -y;
  const stroke = { vectorEffect: "non-scaling-stroke" as const };
  const nameEm = fs * 0.85;
  const areaWords = `${Math.round(footprint.areaSquareFeet).toLocaleString("en-US")} SF`;
  const areaBox: LabelBox = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, angle: 0, width: textWidthEm(areaWords) * fs, height: fs * 1.2 };
  const walls = footprint.sideIds.map((id, i) => {
    const a = corners[i] as Pt;
    const b = corners[(i + 1) % n] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    return { id, a, b, out, name: nameOf(id), length: lengthWords(id, footprint.lengthsFeet[i] ?? len, approx, plusMinus), clear: fs * 0.25 } satisfies WallToName;
  });
  const names = placeWallNames(walls, nameEm, { boxes: [areaBox], polygons: [corners] });
  const half = (b: LabelBox) => (b.angle === 0 ? { x: b.width / 2, y: b.height / 2 } : { x: b.height / 2, y: b.width / 2 });
  const pad = fs * 1.5;
  const boxes = names.map((m) => m.box);
  const fx0 = Math.min(minX - pad, ...boxes.map((b) => b.x - half(b).x - fs * 0.3));
  const fx1 = Math.max(maxX + pad, ...boxes.map((b) => b.x + half(b).x + fs * 0.3));
  const fy0 = Math.min(minY - pad, ...boxes.map((b) => b.y - half(b).y - fs * 0.3));
  const fy1 = Math.max(maxY + pad, ...boxes.map((b) => b.y + half(b).y + fs * 0.3));
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${fx0} ${Y(fy1)} ${fx1 - fx0} ${fy1 - fy0}`} width={size?.width} height={size?.height} role="img" aria-label="Footprint, to scale">
      <rect x={fx0} y={Y(fy1)} width={fx1 - fx0} height={fy1 - fy0} fill="#ffffff" />
      <polygon points={corners.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="#f4efe4" stroke={INK} strokeWidth={2} strokeLinejoin="round" {...stroke} />
      {upper && upper.length > 2 && <polygon points={upper.map((p) => `${p.x},${Y(p.y)}`).join(" ")} fill="none" stroke="#1b3a5c" strokeWidth={1.6} strokeDasharray="9 4" {...stroke} />}
      {walls.filter((w) => plusMinusWords(plusMinus?.(w.id))).map((w) => (
        <CheckMark key={`check-${w.id}`} a={w.a} b={w.b} out={w.out} off={fs * 0.3} />
      ))}
      <text x={areaBox.x} y={Y(areaBox.y) + fs * 0.35} fontSize={fs} textAnchor="middle" fill="#5b6472" fontFamily={FONT}>
        {areaWords}
      </text>
      {names.map((m) => (
        <g key={m.id}>
          <NameLeader name={m} fs={fs} />
          <g transform={`translate(${m.box.x} ${Y(m.box.y)})${m.upright ? " rotate(-90)" : ""}`}>
            <NameLines lines={m.lines} em={nameEm} ink={plusMinusWords(plusMinus?.(m.id)) ? CHECK_INK : INK} />
          </g>
        </g>
      ))}
    </svg>
  );
}
