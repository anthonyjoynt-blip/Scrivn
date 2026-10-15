/**
 * Every line on the roof plan carries its true length (the owner, 2026-10-12: "on the roof sketch i
 * would want to see the ridges, eaves, rakes and valleys all with measurements shown"). Each label
 * sits ON its line, turned to run along it and never upside down, and none covers another or the
 * plan's own lettering: one that would slides along its line, and only when the line has no room
 * left does it step off to one side.
 *
 * Plan feet with y up, angles counter-clockwise in degrees, in (-90, 90]. Kept apart from the
 * drawing so the tests hold the placement to that, and the editor and the documents place alike.
 */
import type { Pt, RoofLineKind, RoofPlan } from "./roof";
import { formatFeetInches } from "./sketch";

/** A label's box: its centre, the way it runs, and its size. */
export interface LabelBox {
  x: number;
  y: number;
  angle: number;
  width: number;
  height: number;
}

export interface LineLabel extends LabelBox {
  key: string;
  kind: RoofLineKind;
  text: string;
  fontFeet: number;
  /** False only when the line had no room left and the label stepped off it. */
  onLine: boolean;
}

/** Roughly how wide a lengths' text sets, in ems: figures and the foot and inch marks. */
export function textWidthEm(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === "'" ? 0.26 : ch === '"' ? 0.4 : ch === " " ? 0.28 : /[0-9]/.test(ch) ? 0.56 : 0.6;
  return w;
}

/** The angle text along a → b reads at, turned so it is never upside down; straight up the page for a vertical line. */
export function uprightAngle(a: Pt, b: Pt): number {
  let deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (deg > 90 + 1e-9) deg -= 180;
  else if (deg <= -90 + 1e-9) deg += 180;
  return deg;
}

function axes(b: LabelBox): [Pt, Pt] {
  const r = (b.angle * Math.PI) / 180;
  return [
    { x: Math.cos(r), y: Math.sin(r) },
    { x: -Math.sin(r), y: Math.cos(r) },
  ];
}

/** Whether two turned boxes overlap, or come within `gap` of each other (separating axes). */
export function labelsOverlap(p: LabelBox, q: LabelBox, gap = 0): boolean {
  const [pu, pv] = axes(p);
  const [qu, qv] = axes(q);
  const c = { x: q.x - p.x, y: q.y - p.y };
  const dot = (u: Pt, v: Pt) => Math.abs(u.x * v.x + u.y * v.y);
  for (const ax of [pu, pv, qu, qv]) {
    const rp = (p.width / 2 + gap / 2) * dot(pu, ax) + (p.height / 2 + gap / 2) * dot(pv, ax);
    const rq = (q.width / 2 + gap / 2) * dot(qu, ax) + (q.height / 2 + gap / 2) * dot(qv, ax);
    if (dot(c, ax) >= rp + rq - 1e-12) return false;
  }
  return true;
}

/** Where along a line a label is tried: the middle, then out either way a twenty-fifth at a time. */
const ALONG = [0.5, ...Array.from({ length: 12 }, (_, i) => [0.5 - (i + 1) * 0.04, 0.5 + (i + 1) * 0.04]).flat()];

/**
 * A label for every line of the plan, at `fontFeet`, clear of `obstacles` (the slopes' letters, the
 * sides' names) and of each other. The shortest lines are placed first: they have the least room.
 */
export function roofLineLabels(plan: RoofPlan, fontFeet: number, obstacles: LabelBox[] = []): LineLabel[] {
  const height = fontFeet * 1.25;
  const gap = fontFeet * 0.12;
  const placed: LineLabel[] = [];
  const planLength = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const order = plan.lines.map((l, i) => ({ l, i })).sort((p, q) => planLength(p.l.a, p.l.b) - planLength(q.l.a, q.l.b) || p.i - q.i);
  for (const { l } of order) {
    const len = planLength(l.a, l.b);
    if (len < 1e-9) continue;
    const text = formatFeetInches(l.feet);
    const width = textWidthEm(text) * fontFeet + fontFeet * 0.3;
    const angle = uprightAngle(l.a, l.b);
    const d = { x: (l.b.x - l.a.x) / len, y: (l.b.y - l.a.y) / len };
    const n = { x: -d.y, y: d.x };
    // Kept within the line's ends where it fits; a label longer than its line stays at the middle.
    const room = width / (2 * len);
    const ts = room >= 0.5 ? [0.5] : [...new Set(ALONG.map((t) => Math.min(1 - room, Math.max(room, t))))];
    const offsets = [0, 1, -1, 2, -2].map((k) => k * height * 1.05);
    const candidates = offsets.flatMap((o) => ts.map((t) => ({ x: l.a.x + d.x * len * t + n.x * o, y: l.a.y + d.y * len * t + n.y * o, onLine: o === 0 })));
    const others: LabelBox[] = [...obstacles, ...placed];
    let best: (typeof candidates)[number] | null = null;
    let bestHits = Infinity;
    for (const c of candidates) {
      const box = { x: c.x, y: c.y, angle, width, height };
      const hits = others.reduce((s, o) => s + (labelsOverlap(box, o, gap) ? 1 : 0), 0);
      if (hits < bestHits) {
        best = c;
        bestHits = hits;
        if (hits === 0) break;
      }
    }
    const at = best ?? (candidates[0] as (typeof candidates)[number]);
    placed.push({ key: l.key, kind: l.kind, text, fontFeet, x: at.x, y: at.y, angle, width, height, onLine: at.onLine });
  }
  const index = new Map(plan.lines.map((l, i) => [l.key, i]));
  return placed.sort((p, q) => (index.get(p.key) ?? 0) - (index.get(q.key) ?? 0));
}

/** A slope's letter on the plan, and its area under it when there is room. */
export interface FacetLabel {
  key: string;
  letter: string;
  /** "123 SF", or null on a slope too small to take it (the slopes' list has it). */
  area: string | null;
  /** The letter's centre and size, feet. */
  x: number;
  y: number;
  size: number;
  /** All of it, for the lengths to keep clear of. */
  box: LabelBox;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function insidePolygon(poly: Pt[], p: Pt): boolean {
  let pos = false;
  let neg = false;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Pt;
    const b = poly[(i + 1) % poly.length] as Pt;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > 1e-9) pos = true;
    if (cross < -1e-9) neg = true;
  }
  return !(pos && neg);
}

/**
 * The slopes' letters, at lettering `fs` feet. A slope with room round its middle takes its letter
 * and area there. A small one (a cross gable's triangle) takes only its letter, at the point
 * furthest from the lines round it - where the lengths on those lines leave the most room - sized
 * to fit between them.
 */
export function facetLabels(plan: RoofPlan, fs: number): FacetLabel[] {
  // How far into a slope a length on its edge reaches: half its height and half the gap kept round it.
  const gap = fs * 0.62 * 0.12;
  const intrusion = (fs * 0.62 * 1.25) / 2 + gap / 2;
  // A roof of more than one pitch (2026-10-14): each slope says its own under its letter.
  const mixed = new Set(plan.facets.map((f) => Math.round(f.pitch * 10))).size > 1;
  return plan.facets.map((f) => {
    const bounds = plan.lines.filter((l) => l.facets.includes(f.key));
    const clear = (p: Pt) => Math.min(Infinity, ...bounds.map((l) => distanceToSegment(p, l.a, l.b)));
    const c = f.centroid;
    const area = `${mixed ? `${Math.round(f.pitch * 10) / 10}/12 · ` : ""}${Math.round(f.areaSquareFeet)} SF`;
    if (clear(c) >= fs * 1.6) {
      // The letter 1.3 high from 0.2 under the middle, the area 0.65 high under that.
      return { key: f.key, letter: f.label, area, x: c.x, y: c.y + fs * 0.26, size: fs * 1.3, box: { x: c.x, y: c.y - fs * 0.2, angle: 0, width: Math.max(fs, textWidthEm(area) * fs * 0.65), height: fs * 2 } };
    }
    let best = c;
    let room = clear(c);
    for (const cell of f.cells) {
      const xs = cell.map((p) => p.x);
      const ys = cell.map((p) => p.y);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      for (let i = 1; i < 16; i++) {
        for (let j = 1; j < 16; j++) {
          const p = { x: x0 + ((x1 - x0) * i) / 16, y: y0 + ((y1 - y0) * j) / 16 };
          if (!insidePolygon(cell, p)) continue;
          const r = clear(p);
          if (r > room) {
            room = r;
            best = p;
          }
        }
      }
    }
    // Its box is 0.8 of the letter square, and a corner of it can point at a line on the slant.
    const size = Math.max(fs * 0.5, Math.min(fs * 1.3, ((room - intrusion) / Math.SQRT2 - gap / 2) / 0.4));
    return { key: f.key, letter: f.label, area: null, x: best.x, y: best.y, size, box: { x: best.x, y: best.y, angle: 0, width: size * 0.8, height: size * 0.8 } };
  });
}

/** What the lengths keep clear of: the slopes' letters as `facetLabels` sets them. */
export function facetLabelBoxes(plan: RoofPlan, fs: number): LabelBox[] {
  return facetLabels(plan, fs).map((f) => f.box);
}

/** Each kind's total along the roof, for the legend: only the kinds the roof has. */
export function lineTotals(plan: RoofPlan): { kind: RoofLineKind; feet: number }[] {
  return (Object.keys(plan.totals) as RoofLineKind[]).filter((k) => plan.lines.some((l) => l.kind === k)).map((kind) => ({ kind, feet: plan.totals[kind] }));
}
