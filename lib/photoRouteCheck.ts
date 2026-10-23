/**
 * The photo route checking itself (2026-10-22, cleaner input): each tape held out in turn and predicted from the rest, and
 * the self-check - a photo whose place makes the tapes disagree is left out of the size, and said so.
 *
 * Blind runs of a test house gave its long wall anywhere over a wide range, and the worst of them were
 * the ones with the most photos placed: one photo put a little wrong pulls the whole solve, and nothing in the solve itself
 * says which. The tapes do. Each tape held out in turn is predicted from the others - a wall's length from its side, a line
 * on a photo from where that photo was placed - and when they disagree by more than 5% the house is not measured to 5%.
 * If leaving one measure photo out of the size brings them back within 5%, that photo was the trouble: it is left out (it
 * is still placed, on the house as measured without it, to be read) and the results say so.
 *
 * Pure, no pixels: what the solve already has. The house runner runs it on every measure (scripts/house/steps.mjs); the
 * phone does not yet (a measure there would take the hold-outs' time again, once per tape).
 */

import { castRayToSides, columnBearing, type PhotoRouteInput, type RoutePhotoData, type RouteSolution, type RouteTape, solveRoute, type SolveRouteOptions, type TapeSpread, tapesOffSides } from "./photoRoute";
import { snapToEdge } from "./photoRouteEdges";
import { formatFeetInches } from "./sketch";
import { levelAxes, toLevel } from "./photoRouteLens";
import { planDirection } from "./photoRouteSolve";

/** Tapes that disagree by more than this, held out, percent: the house is not measured to it, and a photo is looked for. */
export const TAPES_AGREE_PCT = 5;

/**
 * How long the line a-b on a placed photo is on the solved house, feet: each end's column cast from where the photo was
 * placed onto the wall its ray meets first, its height from its row and the distance (a level camera). With [snap], each end
 * moved onto the upright edge nearest it first, as a tape's ends are in the solve. Null when the photo was not placed, or an
 * end's ray meets no wall.
 */
export function lineFeet(sol: RouteSolution, data: RoutePhotoData[], photoId: string, a: [number, number], b: [number, number], snap = false): { feet: number; across: number; up: number; sides: [number, number] } | null {
  const d = data.find((q) => q.id === photoId);
  const rc = sol.cameras.find((c) => c.photo === photoId);
  const cam = d?.camera;
  if (!d || !rc || !cam) return null;
  const yaw = (rc.yawTweakDeg * Math.PI) / 180;
  const { zl } = levelAxes(cam);
  const zg = planDirection(Math.atan2(zl[0], zl[2]), rc.quadrant, yaw);
  const ends = [a, b].map(([px, py]) => {
    const [u0, v] = toLevel(cam, px, py);
    const u = snap ? snapToEdge(d.gray, cam, px, py, { above: 60, below: 60 }).u : u0;
    const dir = planDirection(columnBearing(cam, u), rc.quadrant, yaw);
    const hit = castRayToSides({ x: rc.at[0], y: rc.at[1] }, dir, sol.corners);
    if (!hit) return null;
    const P: [number, number] = [rc.at[0] + dir[0] * hit.t, rc.at[1] + dir[1] * hit.t];
    const depth = (P[0] - rc.at[0]) * zg[0] + (P[1] - rc.at[1]) * zg[1];
    return { P, z: -((v - cam.height / 2) / cam.f) * depth, side: hit.side };
  });
  const [e, f] = ends;
  if (!e || !f) return null;
  return { feet: Math.hypot(f.P[0] - e.P[0], f.P[1] - e.P[1], f.z - e.z), across: Math.hypot(f.P[0] - e.P[0], f.P[1] - e.P[1]), up: Math.abs(f.z - e.z), sides: [e.side, f.side] };
}

/** A tape as said, by its parts in the route: one, or one a photo for a tape across things alike (both garage doors). */
export interface TapeGroup {
  id: string;
  parts: string[];
}

/** One tape held out: what the rest predict for it, and whether it sizes the house (a wall's, or a line on a measure photo). */
export interface HoldOut {
  id: string;
  taped: number;
  /** The mean of its parts' predictions, feet; null when none could be made (its photo not placed without it). */
  predicted: number | null;
  errorPct: number | null;
  /** Each part's prediction and where from: a side, or a photo. */
  each: { part: string; feet: number | null; photo?: string; side?: number; plusMinusPct?: number | null }[];
  /** False for a tape on a detail photo: held out it checks where that photo was put, not the size. */
  sizes: boolean;
  /** The tapes it was predicted from. */
  from: string[];
}

/**
 * Each tape held out in turn: the house solved from the others, the tape predicted from that solve. Two tapes at least - or
 * one, with sizes estimated on site held (`RouteEstimate` use "hold"), which then scale the rest.
 */
export function holdOutTapes(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], groups: TapeGroup[], opts: SolveRouteOptions = {}): HoldOut[] {
  const b = input.buildings.find((q) => q.id === buildingId);
  if (!b) return [];
  const live = groups.filter((g) => g.parts.length > 0);
  const held = (b.estimates ?? []).some((e) => e.use === "hold");
  if (live.length < 2 && !(live.length === 1 && held)) return [];
  // The photos that size the house with every tape in: a line on any other only placed its photo.
  const full = solveRoute(input, buildingId, data, { ...opts, guesses: false });
  const sized = new Set(full.cameras.filter((c) => c.role !== "detail").map((c) => c.photo));
  return live.map((g) => {
    const sol = solveRoute(input, buildingId, data, { ...opts, withoutTapes: g.parts, guesses: false });
    const each: HoldOut["each"] = [];
    let taped = 0;
    let sizes = true;
    for (const id of g.parts) {
      const t = b.tapes.find((q) => q.id === id);
      if (!t) continue;
      taped = t.feet;
      if (t.kind === "side") {
        const s = sol.sides[t.from];
        each.push({ part: id, feet: s ? s.lengthFeet : null, side: t.from, plusMinusPct: s?.plusMinusPct ?? null });
      } else {
        if (!sized.has(t.photo)) sizes = false;
        const m = lineFeet(sol, data, t.photo, t.a, t.b, true);
        each.push({ part: id, feet: m ? m.feet : null, photo: t.photo });
      }
    }
    const got = each.filter((e) => e.feet !== null).map((e) => e.feet as number);
    const predicted = got.length ? got.reduce((s, v) => s + v, 0) / got.length : null;
    return { id: g.id, taped, predicted, errorPct: predicted !== null && taped > 0 ? (predicted / taped - 1) * 100 : null, each, sizes, from: live.filter((q) => q !== g).map((q) => q.id) };
  });
}

/** The worst disagreement among the tapes that size the house, held out, percent; null with fewer than two of them predicted. */
export function worstPct(rows: HoldOut[]): number | null {
  const errs = rows.filter((r) => r.sizes && r.errorPct !== null).map((r) => Math.abs(r.errorPct as number));
  return errs.length >= 2 ? Math.max(...errs) : null;
}

export interface SelfCheck {
  /** The hold-outs with every measure photo in. */
  before: HoldOut[];
  /** The photo left out of the size, and the hold-outs without it; null when none was (the tapes agree, or no one photo explains it). */
  dropped: { photo: string; rows: HoldOut[]; worstPct: number; tapes: string[] } | null;
  /** Each measure photo tried, and the worst disagreement left without it (null: too few tapes left to say). */
  tried: { photo: string; worstPct: number | null }[];
  /** In plain words, for the results. */
  words: string;
}

/**
 * The self-check: with the tapes disagreeing by more than 5% held out, each measure photo is left out of the size in turn
 * (`SolveRouteOptions.outOfSize`); the one whose leaving brings them back within 5% - the least disagreement left, two tapes
 * at least still predicted - is left out, and said. One photo at most: two that each explain part of it are not guessed at,
 * and what the tapes size is then said to be not measured. [label] names a photo in the words ("#7").
 */
export function selfCheck(input: PhotoRouteInput, buildingId: string, data: RoutePhotoData[], groups: TapeGroup[], opts: SolveRouteOptions = {}, label: (photo: string) => string = (p) => p): SelfCheck {
  const before = holdOutTapes(input, buildingId, data, groups, opts);
  const worst = worstPct(before);
  if (worst === null) return { before, dropped: null, tried: [], words: "Fewer than two tapes size the house: nothing to check them against." };
  if (worst <= TAPES_AGREE_PCT) return { before, dropped: null, tried: [], words: `The tapes agree, held out in turn, within ${worst.toFixed(1)}%: no photo left out.` };
  const sol = solveRoute(input, buildingId, data, { ...opts, guesses: false });
  const measure = sol.cameras.filter((c) => c.role !== "detail").map((c) => c.photo);
  const b = input.buildings.find((q) => q.id === buildingId);
  const tried: SelfCheck["tried"] = [];
  let best: SelfCheck["dropped"] = null;
  for (const photo of measure) {
    const o = { ...opts, outOfSize: [...(opts.outOfSize ?? []), photo] };
    const rows = holdOutTapes(input, buildingId, data, groups, o);
    const w = worstPct(rows);
    tried.push({ photo, worstPct: w });
    if (w === null || w > TAPES_AGREE_PCT) continue;
    if (!best || w < best.worstPct) best = { photo, rows, worstPct: w, tapes: (b?.tapes ?? []).filter((t) => t.kind === "line" && t.photo === photo).map((t) => t.id) };
  }
  const was = `With every measure photo the tapes disagree by up to ${worst.toFixed(1)}%, held out in turn.`;
  if (!best) return { before, dropped: null, tried, words: `${was} No one photo left out brings them within ${TAPES_AGREE_PCT}%: none is left out, and what they size is not measured.` };
  return {
    before,
    dropped: best,
    tried,
    words: `${was} Without ${label(best.photo)} they agree within ${best.worstPct.toFixed(1)}%: ${label(best.photo)} is left out of the size (still placed on the house, to be read)${best.tapes.length ? `, and its tape${best.tapes.length === 1 ? "" : "s"} ${best.tapes.join(", ")} with it` : ""}.`,
  };
}


// ── Per wall: a tape that disagrees marks only the walls it is on or tied to (2026-10-23) ─────────────

/**
 * The walls between the corners tapped on one photo (2026-10-23): the shortest run round the outline that takes them all
 * in - what that photo sizes. Fewer than two corners: none. Two runs as short (corners straight across): both.
 */
export function wallsBetween(corners: number[], n: number): number[] {
  const ks = [...new Set(corners)].filter((k) => k >= 0 && k < n).sort((a, b) => a - b);
  if (ks.length < 2) return [];
  // The widest gap round the ring between two tapped corners is the part of the house the photo doesn't span.
  const gaps = ks.map((k, i) => ({ after: k, at: i, len: ((ks[(i + 1) % ks.length] as number) - k + n) % n }));
  const widest = Math.max(...gaps.map((g) => g.len));
  const out = new Set<number>();
  for (const g of gaps.filter((q) => q.len === widest)) {
    for (let k = ks[(g.at + 1) % ks.length] as number; k !== g.after; k = (k + 1) % n) out.add(k);
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * The walls a tape is on and tied to, on the measure [sol]: a wall's tape is on its wall, and tied to every wall a photo that
 * sizes it also sizes; a line on a photo is on the walls its ends land on, and tied to the walls between that photo's tapped
 * corners (`wallsBetween`) - held out and off, it says that photo's scale is off, and those are the sizes it gives.
 */
export function tapeWalls(sol: RouteSolution, data: RoutePhotoData[], t: RouteTape): { on: number[]; tied: number[] } {
  const n = sol.corners.length;
  const sizing = sol.cameras.filter((c) => c.role !== "detail");
  if (t.kind === "side") {
    const tied = new Set<number>();
    for (const c of sizing) {
      const run = wallsBetween(c.corners ?? [], n);
      if (run.includes(t.from)) for (const k of run) if (k !== t.from) tied.add(k);
    }
    return { on: [t.from], tied: [...tied].sort((a, b) => a - b) };
  }
  const cam = sizing.find((c) => c.photo === t.photo);
  const m = lineFeet(sol, data, t.photo, t.a, t.b, !t.exact);
  const on = m ? [...new Set(m.sides)].sort((a, b) => a - b) : [];
  return { on, tied: cam ? wallsBetween(cam.corners ?? [], n).filter((k) => !on.includes(k)) : [] };
}

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * Not measured per wall, not all or nothing (2026-10-23; before, every untaped side once any tape was more than 5% off). Each
 * tape held out more than 5% off what the others predict marks the walls it is on or tied to (`tapeWalls`) not measured -
 * why, the wall whose tape or laser settles it, and the tape to check. Every other wall stands on its own ± (a wall over ±10%
 * is not measured by itself). How well the tapes agree as a whole is a note (`RouteSolution.tapeSpread`), not a blanket:
 * on blind runs of a test house some hold-outs were past 5% while the walls away from those tapes were measured well.
 * [words] says a tape ("tape t3 (kitchen window, taped 4'0")"), [label] a photo ("#36"). Fewer than two tapes that size the
 * house predicted: [sol] as it is.
 */
export function tapesOffWalls(
  sol: RouteSolution,
  data: RoutePhotoData[],
  tapes: RouteTape[],
  rows: HoldOut[],
  words: (row: HoldOut) => string = (r) => `tape ${r.id} (taped ${formatFeetInches(r.taped)})`,
  label: (photo: string) => string = (p) => p,
): RouteSolution {
  const worst = worstPct(rows);
  if (worst === null) return sol;
  const sized = rows.filter((r) => r.sizes && r.errorPct !== null);
  const most = sized.reduce((a, r) => (Math.abs(r.errorPct as number) > Math.abs(a.errorPct as number) ? r : a));
  const offs: { side: number; tape: string; on: boolean; why: string; check: string }[] = [];
  for (const r of sized.filter((q) => Math.abs(q.errorPct as number) > TAPES_AGREE_PCT)) {
    const off = signed(r.errorPct as number);
    const check = `Check ${words(r)} again: the others put it ${off} off - what was taped, and its ends.`;
    for (const part of r.each) {
      const t = tapes.find((q) => q.id === part.part);
      if (!t) continue;
      const { on, tied } = tapeWalls(sol, data, t);
      const how = t.kind === "side" ? "along a wall the same photos size" : `on photo ${label(t.photo)}, which sizes it`;
      for (const k of on) offs.push({ side: k, tape: r.id, on: true, why: `${words(r)}, on it, is ${off} off what the other tapes say, held out`, check });
      for (const k of tied) offs.push({ side: k, tape: r.id, on: false, why: `${words(r)}, ${how}, is ${off} off what the other tapes say, held out`, check });
    }
  }
  // One reason a tape a wall: on it before tied to it (a tape across both garage doors is on two photos).
  const kept = offs.filter((o) => {
    const same = offs.filter((p) => p.side === o.side && p.tape === o.tape);
    return (same.find((p) => p.on) ?? same[0]) === o;
  });
  const marked = kept.length ? tapesOffSides(sol.sides, kept) : sol.sides;
  const nOff = new Set(kept.filter((o) => !sol.sides[o.side]?.taped).map((o) => o.side)).size;
  const spread: TapeSpread = {
    worstPct: worst,
    tape: most.id,
    offPct: most.errorPct as number,
    words:
      worst <= TAPES_AGREE_PCT
        ? `The tapes agree within ${worst.toFixed(1)}%, each held out in turn and predicted from the others: the house is scaled to about that.`
        : `The tapes agree within ${worst.toFixed(1)}%, each held out in turn and predicted from the others (tape ${most.id} the most off, ${signed(most.errorPct as number)}): the house as a whole is scaled to about that. Only the walls a tape more than ${TAPES_AGREE_PCT}% off is on or tied to are NOT measured for it (${nOff} of ${sol.sides.length}); every other wall stands on its own ±.`,
  };
  return { ...sol, sides: marked, tapeSpread: spread };
}
