/**
 * The walk round the house (2026-10-21): the photo route's way in, one prompted step at a time. Blind tests on the owner's
 * house that week showed the front reliable, the photos showing ONE corner of the house impossible to place (the back and
 * sides drifting 10-35%), and a photo at 45 degrees to every outside corner with a measurement on each side as the
 * capture that holds. So the walk asks for exactly that, in order:
 *
 *   the front, straight on, and something on it measured (a garage door; a window or a door across its frame);
 *   then round the house in one direction, the front's right-hand corner first: each corner at 45 degrees - or, at an
 *   inside corner, where no 45 shows it, the walls either side of it, which are the sides' own photos (the wall before it
 *   asked for there only when its side had no room for one) - and each side straight on if there's room to get back,
 *   with a measurement on it if there is one; until back at the front. Then Send to Scrivn team, or Measure.
 *
 * Where the home meets the neighbour's (a semi, a townhouse) there is no corner to stand at 45 degrees to: the walk asks
 * instead for the open wall at an angle from that end, the whole wall and both its ends in - so a middle townhouse gets
 * two angled photos of its front and two of its back, as Hover asks for (2026-10-21).
 *
 * The lap says the house's shape: how many corners, and at each whether the walk went round the outside of the house or
 * into a notch. That is the outline (`lapOutline`), its sizes rough until measured, so nobody draws it by hand; and each
 * photo's place on it (`RoutePhoto.shot`), so the corners tapped on a photo are named by what it was taken for.
 *
 * Walking with the house on the left (the front's right-hand corner first): an outside corner turns the walk a quarter
 * left, an inside corner a quarter right, and a closed lap four quarters left. Plan feet as lib/photoRoute.ts: x east, y
 * north, the street at the bottom, the outline counter-clockwise from above. The walk's corner k is the outline's corner
 * k - 1, which the plan shows as k (it numbers its corners from 1): corner 1 is the front's right-hand end, the last the
 * front's left. The walk's side k runs from corner k to the next, the outline's side k - 1; the front, the walk's side 0,
 * is the outline's last, from the last corner round to corner 1.
 */

import type { HomeType } from "./exterior";
import type { CornerTap, PhotoRouteState, RouteBuilding, RoutePhoto, RouteShot, RouteTape } from "./photoRoute";
import type { Pt } from "./roof";

/** A corner as walked: round the outside of the house, into a notch, or (an attached home) where it meets the neighbour's. */
export type WalkTurn = "outside" | "inside" | "joined";

/** What can be passed by at a stop: its photo; at an inside corner, the wall before it. */
export type WalkPart = "photo" | "before" | "after";

/** One stop of the walk, as done. */
export interface WalkStop {
  kind: "front" | "corner" | "side";
  /** A corner's: outside unless said. */
  turn?: WalkTurn;
  /** The photos taken here, by claim photo id: one; at an inside corner, the wall before it when its side had no photo. */
  photos: string[];
  /** Asked for and not taken: a side's photo ("Can't get back far enough"), a corner's 45, an inside corner's wall before it. */
  skipped?: WalkPart[];
  /** A side shared with the neighbour's home: not photographed, not measured. */
  shared?: true;
  /** A front's or a side's measurement: put in, or passed by. */
  measure?: "done" | "skipped";
  /**
   * Put in by the walk with the stop before it - a joined corner's shared wall and the neighbour's far corner, once the
   * joined corner's own photo is taken or passed by - and taken out with it.
   */
  auto?: true;
}

/** The walk as kept on the route (`PhotoRouteState.walk`): what was done, so a walk half done picks up where it was. */
export interface RouteWalk {
  stops: WalkStop[];
  /** Back at the front: the lap is done. */
  closed?: true;
  /** "Add photos my own way": the walk set aside for the route as it was before, its photos kept. */
  own?: true;
}

/** A photo's place on the walk (`RoutePhoto.walk`): the front, side k or corner k, and an inside corner's which wall. */
export interface WalkTag {
  role: "front" | "side" | "corner";
  /** Its number on the walk: corner k is the k-th passed, the front's right-hand one first; side k follows corner k; the front is 0. */
  k: number;
  corner?: "outside" | "inside" | "joined";
  /**
   * At an inside corner: the photo of the wall walked up to it (asked only when that side had none of its own). At a joined
   * one: the open wall shot at an angle from this end - the one walked up to it ("before"), or the one on from the
   * neighbour's far corner ("after").
   */
  wall?: "before" | "after";
}

/** Where the walk is: what the card asks for next. */
export type WalkStep =
  | { kind: "front" }
  | { kind: "measure"; stop: number; role: "front" | "side"; k: number }
  | { kind: "corner"; k: number }
  | { kind: "inside"; k: number; wall: "before" | "after" }
  | { kind: "side"; k: number }
  | { kind: "finish" };

export function newWalk(): RouteWalk {
  return { stops: [] };
}

/** The walk is the way in while it's on: started, not set aside. A route with no walk at all is the route as it was. */
export function walkActive(route: Pick<PhotoRouteState, "walk">): boolean {
  return !!route.walk && !route.walk.own;
}

const turnOf = (s: WalkStop): WalkTurn => s.turn ?? "outside";

/** A quarter turn: +1 round an outside corner (or a joined one, the neighbour's), -1 into an inside one. */
const quarter = (t: WalkTurn) => (t === "inside" ? -1 : 1);

/**
 * An inside corner's own photo, of the wall walked up to it: a photo id, null passed by, undefined not asked yet. Asked only
 * when that wall's side had no photo ("Can't get back far enough"): a side's photo straight on, both its corners in, shows
 * the inside corner at its end, and the next side's photo shows it at its start.
 */
export function insideWalls(s: WalkStop): { before: string | null | undefined } {
  if (s.skipped?.includes("before")) return { before: null };
  return { before: s.photos[0] };
}

/** Whether an inside corner still wants the wall before it: when the stop before it - that wall - has no photo. */
function wantsWallBefore(prev: WalkStop | undefined): boolean {
  return !(prev && (prev.kind === "front" || prev.kind === "side") && prev.photos.length > 0);
}

/** Whether a corner stop is done with: its 45 (a joined one's angled photo) taken or passed by, an inside one's wall before it had or asked. */
function cornerDone(s: WalkStop, prev: WalkStop | undefined): boolean {
  const t = turnOf(s);
  if (t === "inside") return !wantsWallBefore(prev) || insideWalls(s).before !== undefined;
  return s.photos.length > 0 || !!s.skipped?.includes("photo");
}

/** Each stop's number on the walk: the front 0, corner k the k-th corner, side k the one after corner k. */
export function stopNumbers(walk: RouteWalk): number[] {
  let k = 0;
  return walk.stops.map((s) => {
    if (s.kind === "corner") k += 1;
    return s.kind === "front" ? 0 : k;
  });
}

export function walkStep(walk: RouteWalk): WalkStep {
  if (walk.closed) return { kind: "finish" };
  const stops = walk.stops;
  const last = stops[stops.length - 1];
  if (!last) return { kind: "front" };
  const i = stops.length - 1;
  const k = stopNumbers(walk)[i] as number;
  if (last.kind === "front" || last.kind === "side") {
    if (last.photos.length > 0 && !last.measure) return { kind: "measure", stop: i, role: last.kind, k };
    return { kind: "corner", k: k + 1 };
  }
  const prev = stops[i - 1];
  if (turnOf(last) === "inside" && !cornerDone(last, prev)) return { kind: "inside", k, wall: "before" };
  return cornerDone(last, prev) ? { kind: "side", k } : { kind: "corner", k };
}

/** The corner stop being asked about, if the walk has one open (a turn said, its photo not yet taken). */
function openCorner(walk: RouteWalk): number | null {
  const step = walkStep(walk);
  const i = walk.stops.length - 1;
  const last = walk.stops[i];
  if ((step.kind === "corner" || step.kind === "inside") && last?.kind === "corner" && !cornerDone(last, walk.stops[i - 1])) return i;
  return null;
}

const withStops = (walk: RouteWalk, stops: WalkStop[]): RouteWalk => ({ ...walk, stops });

/** A photo taken at the step the walk is on. */
export function walkTake(walk: RouteWalk, photo: string): RouteWalk {
  const step = walkStep(walk);
  const stops = [...walk.stops];
  if (step.kind === "front") return withStops(walk, [...stops, { kind: "front", photos: [photo] }]);
  if (step.kind === "side") return withStops(walk, [...stops, { kind: "side", photos: [photo] }]);
  if (step.kind === "corner" || step.kind === "inside") {
    const open = openCorner(walk);
    if (open === null) return withStops(walk, [...stops, { kind: "corner", photos: [photo] }]);
    const s = stops[open] as WalkStop;
    stops[open] = { ...s, photos: [...s.photos, photo] };
    return withStops(walk, withShared(stops));
  }
  return walk;
}

/** A joined corner just done with (not one the walk put in): the shared wall after it, and the neighbour's far corner. */
function withShared(stops: WalkStop[]): WalkStop[] {
  const last = stops[stops.length - 1];
  if (!last || last.kind !== "corner" || last.turn !== "joined" || last.auto) return stops;
  return [...stops, { kind: "side", photos: [], shared: true, auto: true }, { kind: "corner", turn: "joined", photos: [], auto: true }];
}

/** The step passed by: a side's photo, a corner's 45, an inside corner's wall before it, a measurement. The front's photo can't be. */
export function walkSkip(walk: RouteWalk): RouteWalk {
  const step = walkStep(walk);
  const stops = [...walk.stops];
  if (step.kind === "side") return withStops(walk, [...stops, { kind: "side", photos: [], skipped: ["photo"] }]);
  if (step.kind === "measure") {
    stops[step.stop] = { ...(stops[step.stop] as WalkStop), measure: "skipped" };
    return withStops(walk, stops);
  }
  if (step.kind === "corner" || step.kind === "inside") {
    const part: WalkPart = step.kind === "inside" ? "before" : "photo";
    const open = openCorner(walk);
    if (open === null) return withStops(walk, [...stops, { kind: "corner", photos: [], skipped: [part] }]);
    const s = stops[open] as WalkStop;
    stops[open] = { ...s, skipped: [...(s.skipped ?? []), part] };
    return withStops(walk, withShared(stops));
  }
  return walk;
}

/** The measurement step done: a measurement was put in on its photo. */
export function walkMeasured(walk: RouteWalk): RouteWalk {
  const step = walkStep(walk);
  if (step.kind !== "measure") return walk;
  const stops = [...walk.stops];
  stops[step.stop] = { ...(stops[step.stop] as WalkStop), measure: "done" };
  return withStops(walk, stops);
}

/**
 * The corner being asked about is outside (the default), inside, or where this home meets the neighbour's. Said before
 * its photo. A joined corner asks for the wall walked up to it, at an angle from this end; then it puts in the shared wall
 * after it, never photographed, and the neighbour's far corner, which asks for the open wall on from there the same way.
 */
export function walkTurn(walk: RouteWalk, turn: WalkTurn): RouteWalk {
  const step = walkStep(walk);
  if (step.kind !== "corner" && step.kind !== "inside") return walk;
  const open = openCorner(walk);
  const stops = [...walk.stops];
  const prev = open === null ? null : (stops[open] as WalkStop);
  // A turn changed once a photo is in would leave the photo of the wrong thing: Back first.
  if (prev && (prev.photos.length > 0 || (prev.skipped ?? []).length > 0)) return walk;
  const at: WalkStop = { kind: "corner", photos: [], ...(turn === "outside" ? {} : { turn }) };
  if (open === null) stops.push(at);
  else stops[open] = at;
  return withStops(walk, stops);
}

/** Back at the front: the lap is done. Asked at a side step - the side about to be taken is the front, taken first. */
export function walkClose(walk: RouteWalk): RouteWalk {
  return walkStep(walk).kind === "side" ? { ...walk, closed: true } : walk;
}

/**
 * One step back: the lap opened again, a measurement asked again, a photo or a pass taken back, a turn unsaid. The photos
 * of what is taken back are listed (`dropped`): they leave the route, and stay on the claim as its Exterior photos.
 */
export function walkBack(walk: RouteWalk): { walk: RouteWalk; dropped: string[] } {
  if (walk.closed) {
    const { closed: _c, ...rest } = walk;
    return { walk: rest, dropped: [] };
  }
  const stops = [...walk.stops];
  const last = stops[stops.length - 1];
  if (!last) return { walk, dropped: [] };
  if ((last.kind === "front" || last.kind === "side") && last.measure) {
    const { measure: _m, ...rest } = last;
    stops[stops.length - 1] = rest;
    return { walk: withStops(walk, stops), dropped: [] };
  }
  // The neighbour's far corner: its angled photo first; then, with the shared wall, back to the joined corner's own photo.
  if (last.auto) {
    if (last.photos.length > 0 || (last.skipped ?? []).length > 0) {
      stops[stops.length - 1] = { ...last, photos: [], skipped: [] };
      return { walk: withStops(walk, stops), dropped: last.photos };
    }
    while (stops.length && stops[stops.length - 1]?.auto) stops.pop();
    const joined = stops[stops.length - 1] as WalkStop;
    stops[stops.length - 1] = { ...joined, photos: [], skipped: [] };
    return { walk: withStops(walk, stops), dropped: joined.photos };
  }
  if (last.kind === "corner" && turnOf(last) === "inside") {
    // Its wall before it first (taken or passed by), then the turn itself.
    const w = insideWalls(last);
    if (w.before !== undefined) {
      stops[stops.length - 1] = { ...last, photos: [], skipped: (last.skipped ?? []).filter((p) => p !== "before") };
      return { walk: withStops(walk, stops), dropped: w.before === null ? [] : [w.before] };
    }
  }
  stops.pop();
  return { walk: withStops(walk, stops), dropped: last.photos };
}

/**
 * The walk's quarter turns so far: the way the next side faces, 0 the street's way (the front), 1 right, 2 back, 3 left. A
 * corner said to be outside or joined but not yet taken isn't passed yet; an inside one being taken is (its walls are
 * either side).
 */
export function walkHeading(walk: Pick<RouteWalk, "stops">): number {
  const stops = walk.stops;
  return stops.reduce((h, s, i) => {
    if (s.kind !== "corner") return h;
    if (i === stops.length - 1 && turnOf(s) !== "inside" && !cornerDone(s, stops[i - 1])) return h;
    return h + quarter(turnOf(s));
  }, 0);
}

/** The turns of the corners passed, in order: +1 outside or joined, -1 inside. */
export function lapTurns(walk: RouteWalk): number[] {
  return walk.stops.filter((s) => s.kind === "corner").map((s) => quarter(turnOf(s)));
}

/** Which way a side faces, in words, from the walk's quarter turns before it. */
export function facingWords(h: number): "front" | "right side" | "back" | "left side" {
  return (["front", "right side", "back", "left side"] as const)[((h % 4) + 4) % 4] as "front" | "right side" | "back" | "left side";
}

/** Whether the lap as walked closes: four corners or more, four quarters left in all. */
export function lapCloses(walk: RouteWalk): boolean {
  const t = lapTurns(walk);
  return t.length >= 4 && t.reduce((s, x) => s + x, 0) === 4;
}

/**
 * Said when "Back at the front" doesn't close the lap: what the corners make of it. A closed lap goes four quarters
 * left: three means a corner missed (or an inside one said as outside), five an outside one said as inside, and so on.
 */
export function lapProblem(walk: RouteWalk): string | null {
  const t = lapTurns(walk);
  if (lapCloses(walk)) return null;
  const out = t.filter((x) => x > 0).length;
  const inn = t.length - out;
  const counted = `${out} outside corner${out === 1 ? "" : "s"}${inn ? ` and ${inn} inside` : ""}`;
  if (t.length < 4) return `That's ${t.length} corner${t.length === 1 ? "" : "s"} so far: a house has four at least. Carry on round to the front.`;
  const net = out - inn;
  return net < 4
    ? `That's ${counted}: a lap round a house has four more outside corners than inside ones. A corner may be missed, or one said inside that sticks out.`
    : `That's ${counted}: a lap round a house has four more outside corners than inside ones. A corner said outside may be tucked in.`;
}

// ── The shape from the lap ───────────────────────────────────────────────────────────────────────

/** Plan direction of a side by its quarter turns from the front's (east). */
const DIRS: [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const dirOf = (h: number) => DIRS[((h % 4) + 4) % 4] as [number, number];

/** Rough sides for the shape from a lap: a wall between two outside corners long, a step beside a notch short. Feet. */
const ROUGH = { across: 40, back: 30, step: 8, notch: 12, least: 2 };

/**
 * The outline a lap makes: one corner each turn, the walk's corner k at outline corner k - 1 (so the plan's numbers are
 * the walk's), the front its last side, running east to corner 0; each side a quarter turned from the last as walked. Sizes are rough and only the turns are the walk's: a wall between two outside corners
 * is taken long (40' across the street's way, 30' back from it), a step to a notch short (8'), a notch's back 12', and
 * each axis then evened out as little as it takes to close (each side moved in proportion to its size, least squares),
 * none under 2'. If that crosses itself, the long walls are taken longer and the steps shorter until it doesn't. Null for
 * a lap that doesn't close (`lapCloses`).
 */
export function lapOutline(turns: number[]): Pt[] | null {
  const m = turns.length;
  if (m < 4 || turns.reduce((s, t) => s + t, 0) !== 4 || turns.some((t) => t !== 1 && t !== -1)) return null;
  // The turn at outline corner c: corner 0 is the walk's last.
  const turnAt = (c: number) => (c === 0 ? (turns[m - 1] as number) : (turns[c - 1] as number));
  const heading: number[] = [0];
  for (let i = 1; i < m; i++) heading.push((heading[i - 1] as number) + turnAt(i));
  for (const [long, short] of [
    [1, 1],
    [1.5, 0.75],
    [2, 0.5],
    [3, 0.4],
  ] as const) {
    const d = heading.map((h, i) => {
      const a = turnAt(i);
      const b = turnAt((i + 1) % m);
      const across = ((h % 2) + 2) % 2 === 0;
      if (a > 0 && b > 0) return (across ? ROUGH.across : ROUGH.back) * long;
      if (a < 0 && b < 0) return ROUGH.notch * short;
      return ROUGH.step * short;
    });
    const L = [...d];
    for (const axis of [0, 1]) {
      const idx = heading.map((h, i) => i).filter((i) => (((heading[i] as number) % 2) + 2) % 2 === axis);
      const sign = (i: number) => (axis === 0 ? dirOf(heading[i] as number)[0] : dirOf(heading[i] as number)[1]);
      // Least squares on each side's change over its size, the axis's signed sum held at zero; any side driven under the
      // least is held there and the rest solved again.
      const fixed = new Set<number>();
      for (let pass = 0; pass <= idx.length; pass++) {
        const free = idx.filter((i) => !fixed.has(i));
        const sum = idx.reduce((s, i) => s + sign(i) * (fixed.has(i) ? ROUGH.least : (d[i] as number)), 0);
        const w = free.reduce((s, i) => s + (d[i] as number) ** 2, 0);
        if (w === 0) break;
        const lambda = sum / w;
        let more = false;
        for (const i of free) {
          const v = (d[i] as number) - lambda * sign(i) * (d[i] as number) ** 2;
          if (v < ROUGH.least) {
            fixed.add(i);
            more = true;
          }
          L[i] = v;
        }
        for (const i of fixed) L[i] = ROUGH.least;
        if (!more) break;
      }
    }
    const ring: Pt[] = [{ x: 0, y: 0 }];
    for (let i = 0; i < m - 1; i++) {
      const p = ring[i] as Pt;
      const [dx, dy] = dirOf(heading[i] as number);
      ring.push({ x: round2(p.x + dx * (L[i] as number)), y: round2(p.y + dy * (L[i] as number)) });
    }
    // Started from the front's left end; numbered from its right, the walk's first corner.
    if (closesAt(ring, heading, L) && simple(ring)) return [...ring.slice(1), ring[0] as Pt];
  }
  return null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The last side comes back to corner 0. */
function closesAt(ring: Pt[], heading: number[], L: number[]): boolean {
  const m = ring.length;
  const p = ring[m - 1] as Pt;
  const [dx, dy] = dirOf(heading[m - 1] as number);
  return Math.hypot(p.x + dx * (L[m - 1] as number), p.y + dy * (L[m - 1] as number)) < 0.05 && L.every((v) => v >= ROUGH.least - 1e-9);
}

/** No two sides that aren't neighbours touch, and the ring runs counter-clockwise. */
function simple(ring: Pt[]): boolean {
  const n = ring.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Pt;
    const b = ring[(i + 1) % n] as Pt;
    area += a.x * b.y - b.x * a.y;
  }
  if (area <= 0) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsTouch(ring[i] as Pt, ring[(i + 1) % n] as Pt, ring[j] as Pt, ring[(j + 1) % n] as Pt)) return false;
    }
  }
  return true;
}

/** Two square-to-the-axes segments meet or come within a hair of it. */
function segmentsTouch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const eps = 0.05;
  const [ax0, ax1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [ay0, ay1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const [cx0, cx1] = [Math.min(c.x, d.x), Math.max(c.x, d.x)];
  const [cy0, cy1] = [Math.min(c.y, d.y), Math.max(c.y, d.y)];
  return ax0 <= cx1 + eps && cx0 <= ax1 + eps && ay0 <= cy1 + eps && cy0 <= ay1 + eps;
}

/** Left (+1) or right (-1) turn at each corner of a counter-clockwise ring; 0 where it runs straight on. */
export function ringTurns(ring: Pt[]): number[] {
  const n = ring.length;
  return ring.map((b, k) => {
    const a = ring[(k - 1 + n) % n] as Pt;
    const c = ring[(k + 1) % n] as Pt;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    return z > 1e-9 ? 1 : z < -1e-9 ? -1 : 0;
  });
}

/**
 * How a lap's corners sit on a shape drawn by hand: the shift r putting the walk's corner k at outline corner k - 1 + r,
 * with every turn the same and the front (the lap's last side, into its first corner) a side facing the street. Null
 * when no shift fits (a corner more or less, a turn said differently). Where more than one fits, the one whose front is
 * nearest the street.
 */
export function alignLap(turns: number[], outline: Pt[]): number | null {
  const m = turns.length;
  if (outline.length !== m || m < 4) return null;
  const drawn = ringTurns(outline);
  let best: { r: number; y: number } | null = null;
  for (let r = 0; r < m; r++) {
    // The walk's corner c + 1 at outline corner c + r.
    if (!turns.every((t, c) => drawn[(c + r) % m] === t)) continue;
    const a = outline[(m - 1 + r) % m] as Pt;
    const b = outline[r % m] as Pt;
    // The front runs east on the plan (the house on its left, walked with the street behind).
    if (!(b.x - a.x > Math.abs(b.y - a.y))) continue;
    const y = Math.min(a.y, b.y);
    if (!best || y < best.y) best = { r, y };
  }
  return best?.r ?? null;
}

// ── The photos' places on the walk ──────────────────────────────────────────────────────────────

/** Every photo of the walk with its tag, in the order taken. */
export function walkPhotos(walk: RouteWalk): { photo: string; tag: WalkTag; stop: number }[] {
  const nums = stopNumbers(walk);
  const out: { photo: string; tag: WalkTag; stop: number }[] = [];
  walk.stops.forEach((s, i) => {
    const k = nums[i] as number;
    if (s.kind === "front") for (const p of s.photos) out.push({ photo: p, tag: { role: "front", k: 0 }, stop: i });
    else if (s.kind === "side") for (const p of s.photos) out.push({ photo: p, tag: { role: "side", k }, stop: i });
    else if (turnOf(s) === "inside") {
      const w = insideWalls(s);
      if (w.before) out.push({ photo: w.before, tag: { role: "corner", k, corner: "inside", wall: "before" }, stop: i });
    } else if (turnOf(s) === "joined") {
      for (const p of s.photos) out.push({ photo: p, tag: { role: "corner", k, corner: "joined", wall: s.auto ? "after" : "before" }, stop: i });
    } else for (const p of s.photos) out.push({ photo: p, tag: { role: "corner", k, corner: "outside" }, stop: i });
  });
  return out;
}

/**
 * What a photo of the walk names on the outline (`RoutePhoto.shot`), the walk's corner k at outline corner (k - 1 + shift)
 * mod m: a corner's 45 that corner; a side straight on its wall; the front the run of walls from where the walk first came
 * back to facing the street round to the front's right-hand corner - the whole front, with any steps in it; an inside
 * corner's walls that corner, by the order they are tapped (the inside corner first: its place in the photo says nothing).
 */
export function walkShot(tag: WalkTag, walk: RouteWalk, shift = 0): RouteShot | null {
  const t = lapTurns(walk);
  const m = t.length;
  if (m < 4) return null;
  const at = (k: number) => (((k - 1 + shift) % m) + m) % m;
  if (tag.role === "corner" && tag.corner === "joined") {
    // The open wall, at an angle from this end: the one walked up to it, or the one on from the neighbour's far corner -
    // named as that wall straight on, its two ends left and right as seen from outside.
    return { kind: "wall", index: at(tag.wall === "after" ? tag.k : tag.k - 1) };
  }
  if (tag.role === "corner") return tag.corner === "inside" ? { kind: "inside", index: at(tag.k), wall: tag.wall ?? "before" } : { kind: "corner", index: at(tag.k) };
  if (tag.role === "side") return { kind: "wall", index: at(tag.k) };
  // The front: from the corner where the walk first faced the street again (its left end) to corner 1 (its right).
  let h = 0;
  let left = m;
  for (let k = 1; k <= m; k++) {
    h += t[k - 1] as number;
    if (h === 4) {
      left = k;
      break;
    }
  }
  return left === m ? { kind: "wall", index: at(0) } : { kind: "run", index: at(left), to: at(1) };
}

/**
 * The route with the walk's say in it: each photo of the walk tagged with its place (`RoutePhoto.walk`); and once the lap
 * is closed, the house's shape from it (unless one was drawn by hand: then the lap is laid on that), the walls shared
 * with the neighbour, and each photo's `shot` on the shape. A shape that changes clears the corners' numbers, as drawing
 * it again does; the photos' shots name them again.
 */
export function withWalk(route: PhotoRouteState, walk: RouteWalk, homeType?: HomeType): PhotoRouteState {
  const tags = new Map(walkPhotos(walk).map((p) => [p.photo, p.tag]));
  const main = route.buildings.find((b) => b.id === "main") ?? { id: "main", outline: [], corners: [], tapes: [] };
  let b: RouteBuilding = homeType ? { ...main, homeType } : main;
  let shift: number | null = null;
  const turns = lapTurns(walk);
  if (walk.closed && lapCloses(walk)) {
    if (b.outline.length === 0 || isWalkShape(b)) {
      const ring = lapOutline(turns);
      if (ring) {
        const same = b.outline.length === ring.length && b.outline.every((p, i) => Math.hypot(p.x - (ring[i] as Pt).x, p.y - (ring[i] as Pt).y) < 0.01);
        if (!same) b = { ...b, outline: ring, outlineFrom: "walk", corners: b.corners.map(unnumbered) };
        shift = 0;
      }
    } else shift = alignLap(turns, b.outline);
    if (shift !== null) {
      const m = turns.length;
      const nums = stopNumbers(walk);
      const shared = walk.stops.flatMap((s, i) => (s.kind === "side" && s.shared ? [(((nums[i] as number) - 1 + (shift as number)) % m + m) % m] : []));
      b = { ...b, shared: shared.sort((p, q) => p - q) };
    }
  }
  const photos = route.photos.map((p): RoutePhoto => {
    const tag = tags.get(p.id);
    const { walk: _w, ...rest } = p;
    if (!tag) {
      // A photo the walk no longer holds keeps no place on it.
      if (!p.walk) return p;
      const { shot: _s, ...plain } = rest;
      return plain;
    }
    const shot = shift === null ? null : walkShot(tag, walk, shift);
    const { shot: _s, ...noShot } = rest;
    return { ...noShot, walk: tag, ...(shot ? { shot } : {}) };
  });
  const buildings = route.buildings.some((x) => x.id === "main") ? route.buildings.map((x) => (x.id === "main" ? b : x)) : [b, ...route.buildings];
  return { ...route, walk, photos, buildings };
}

/**
 * Whether a building's shape is still the one a lap made, sizes and all: marked so, and just what a lap of its own turns
 * makes. Drawn again - in the pane, or by the Scrivn team measuring a request - it is a drawing, and the walk neither
 * replaces it nor has it held loosely (lib/photoRoute.ts `WALK_HOLD`).
 */
export function isWalkShape(b: Pick<RouteBuilding, "outline" | "outlineFrom">): boolean {
  if (b.outlineFrom !== "walk" || b.outline.length < 4) return false;
  const ring = lapOutline(ringTurns(b.outline));
  return !!ring && ring.length === b.outline.length && ring.every((p, i) => Math.hypot(p.x - (b.outline[i] as Pt).x, p.y - (b.outline[i] as Pt).y) < 0.05);
}

/** A corner tap whose number the shape no longer says: numbered again, by its photo's shot or the app. */
function unnumbered(c: CornerTap): CornerTap {
  const { by: _by, ...rest } = c;
  return { ...rest, corner: -1 };
}

/** The route with photos taken out (`walkBack`'s dropped, a retake's old one): their corner taps and measurements with them. */
export function withoutPhotos(route: PhotoRouteState, ids: string[]): PhotoRouteState {
  if (ids.length === 0) return route;
  const gone = new Set(ids);
  return {
    ...route,
    photos: route.photos.filter((p) => !gone.has(p.id)),
    buildings: route.buildings.map((b) => ({
      ...b,
      corners: b.corners.filter((c) => !gone.has(c.photo)),
      tapes: b.tapes.filter((t: RouteTape) => !(t.kind === "line" && gone.has(t.photo))),
    })),
  };
}

/** The sides walked as shared with the neighbour (a joined corner's), by outline side index on the lap's own shape. */
export function walkSharedSides(walk: RouteWalk): number[] {
  const m = lapTurns(walk).length;
  const nums = stopNumbers(walk);
  return walk.stops.flatMap((s, i) => (s.kind === "side" && s.shared && m > 0 ? [((((nums[i] as number) - 1) % m) + m) % m] : []));
}

/** At least one measurement in the walk: what sets the size. Send and Measure wait for it. */
export function walkHasMeasure(route: PhotoRouteState): boolean {
  return route.buildings.some((b) => b.id === "main" && b.tapes.length > 0);
}

/** The walk in numbers, for the end of it: photos, corners (inside and joined), sides passed by, measurements. */
export function walkSummary(route: PhotoRouteState): { photos: number; corners: number; inside: number; joined: number; sidesSkipped: number; measures: number } {
  const walk = route.walk ?? newWalk();
  const corners = walk.stops.filter((s) => s.kind === "corner");
  return {
    photos: walkPhotos(walk).length,
    corners: corners.length,
    inside: corners.filter((s) => s.turn === "inside").length,
    joined: corners.filter((s) => s.turn === "joined").length,
    sidesSkipped: walk.stops.filter((s) => s.kind === "side" && !s.shared && s.photos.length === 0).length,
    measures: route.buildings.find((b) => b.id === "main")?.tapes.length ?? 0,
  };
}

/** What a photo of the walk is, in words: "the front", "corner 2 at 45°", "the back (side 2)", "the wall before inside corner 4". */
export function walkPhotoWords(tag: WalkTag, walk: RouteWalk): string {
  if (tag.role === "front") return "the front";
  if (tag.role === "corner" && tag.corner === "joined") return `the ${facingWords(headingBefore(walk, tag.wall === "after" ? tag.k : tag.k - 1))} at an angle, from where it meets the neighbour's`;
  if (tag.role === "corner") return tag.corner === "inside" ? `the wall ${tag.wall === "after" ? "on from" : "up to"} inside corner ${tag.k}` : `corner ${tag.k} at 45°`;
  return `the ${facingWords(headingBefore(walk, tag.k))} (side ${tag.k})`;
}

/** The quarter turns walked before side k: through corner k. */
export function headingBefore(walk: RouteWalk, k: number): number {
  let h = 0;
  let seen = 0;
  for (const s of walk.stops) {
    if (s.kind !== "corner") continue;
    seen += 1;
    if (seen > k) break;
    h += quarter(turnOf(s));
  }
  return h;
}

/**
 * What to tap on a photo of the walk, once it is back at the front and measured here: by what the photo was taken for.
 * An inside corner's wall is asked for the inside corner first - its place in the photo says nothing of which it is.
 */
export function walkTapWords(tag: WalkTag, attached: boolean): string {
  if (tag.role === "front") return `Tap each corner of the front you can see, where it meets the ground${attached ? ", and where this home ends" : ""}.`;
  if (tag.role === "side") return "Tap both its corners where they meet the ground.";
  if (tag.corner === "inside") return `Tap inside corner ${tag.k} first, where it meets the ground; then the wall's other corner if it's in.`;
  if (tag.corner === "joined") return "Tap each end of the wall where it meets the ground: where this home ends, and its corner.";
  return `Tap corner ${tag.k} where it meets the ground, then the far end of each of its two walls if you can see it.`;
}
