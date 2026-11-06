/**
 * Tracing a sketch photo by hand (2026-11-05): the no-AI way to a read. The person taps each room's
 * corners on the photo and types the number written on each wall; this keeps what they have done,
 * and turns it into the same `HandSketchRead` a model's reading gives, so both go through one build.
 *
 * Everything is in the photo's own pixels, as it was taken. Corners tapped close to one already
 * placed land exactly on it, so rooms drawn against each other share their corners and the build
 * joins them. And the answers to the build's questions are edits of the read, made here.
 */
import { feetInches, parseLength, type DrawnItem, type DrawnOpening, type DrawnPoint, type DrawnRoomGuess, type HandSketchQuestion, type HandSketchRead } from "./handSketch";

export interface TraceRoom {
  /** The outline as tapped, in the photo's pixels. */
  corners: DrawnPoint[];
  /** Tapped back round to its first corner. */
  closed: boolean;
  /** lengths[i] is wall i's (corners[i] to corners[i + 1]) number as written, or null. */
  lengths: (string | null)[];
  name: string | null;
  ceiling: string | null;
  /** From a model's reading: what it was taken for, and its doors, windows and fixtures, carried through as read. */
  guess?: DrawnRoomGuess | null;
  openings?: DrawnOpening[];
  items?: DrawnItem[];
}

export interface TraceState {
  photo: { width: number; height: number };
  rooms: TraceRoom[];
  /** Quarter turns clockwise that put the drawing the right way up. */
  rotate: 0 | 90 | 180 | 270;
  /**
   * A model's reading being corrected: corners can be moved, numbers and names changed, but none added
   * or taken away, since its doors and fixtures are tied to the walls by number.
   */
  locked: boolean;
  /**
   * The rooms were found in the photo by Scrivn (lib/handSketchBoxes.ts), not tapped: the person goes through them one
   * at a time, naming each (or joining a shape that is not a room into the one beside it) and typing its numbers.
   */
  found?: boolean;
}

export type TraceProblem = "crosses" | "tooFew" | null;

export function emptyTrace(width: number, height: number): TraceState {
  return { photo: { width, height }, rooms: [], rotate: 0, locked: false };
}

const same = (a: DrawnPoint, b: DrawnPoint) => a.x === b.x && a.y === b.y;

/** Every corner already placed, in any room. */
function allCorners(state: TraceState): DrawnPoint[] {
  return state.rooms.flatMap((r) => r.corners);
}

/** [p], or the corner already placed within [within] photo pixels of it, exactly. */
export function snapped(state: TraceState, p: DrawnPoint, within: number): DrawnPoint {
  let best: DrawnPoint | null = null;
  let gap = within;
  for (const q of allCorners(state)) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= gap) [best, gap] = [q, d];
  }
  return best ? { ...best } : { x: Math.round(p.x), y: Math.round(p.y) };
}

/** The room being traced, if one is open. */
export function openRoom(state: TraceState): TraceRoom | null {
  const last = state.rooms[state.rooms.length - 1];
  return last && !last.closed ? last : null;
}

function segmentsCross(a: DrawnPoint, b: DrawnPoint, c: DrawnPoint, d: DrawnPoint): boolean {
  const o = (p: DrawnPoint, q: DrawnPoint, r: DrawnPoint) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** Whether the wall from [a] to [b] would cross one of [corners]'s walls drawn so far (not the one it starts from). */
function wouldCross(corners: DrawnPoint[], a: DrawnPoint, b: DrawnPoint): boolean {
  for (let i = 0; i + 1 < corners.length; i++) {
    if (segmentsCross(a, b, corners[i] as DrawnPoint, corners[i + 1] as DrawnPoint)) return true;
  }
  return false;
}

/**
 * A tap at [p] (photo pixels) while tracing: the next corner of the open room, or the first of a new
 * one. A tap on the open room's first corner, with three or more placed, closes it. [within] is how
 * near (photo pixels) counts as on a corner already placed.
 */
export function tapCorner(state: TraceState, p: DrawnPoint, within: number): { state: TraceState; problem: TraceProblem } {
  if (state.locked) return { state, problem: null };
  const at = snapped(state, p, within);
  const open = openRoom(state);
  if (!open) {
    const room: TraceRoom = { corners: [at], closed: false, lengths: [], name: null, ceiling: null };
    return { state: { ...state, rooms: [...state.rooms, room] }, problem: null };
  }
  const first = open.corners[0] as DrawnPoint;
  const last = open.corners[open.corners.length - 1] as DrawnPoint;
  if (same(at, last)) return { state, problem: null };
  const closing = same(at, first);
  if (closing && open.corners.length < 3) return { state, problem: "tooFew" };
  if (open.corners.some((c, i) => i > 0 && same(c, at))) return { state, problem: "crosses" };
  // The new wall must not cross the ones before it; closing, it may touch the first corner.
  if (wouldCross(closing ? open.corners.slice(1) : open.corners.slice(0, -1), last, at)) return { state, problem: "crosses" };
  const room: TraceRoom = closing
    ? { ...open, closed: true, lengths: open.corners.map((_, i) => open.lengths[i] ?? null) }
    : { ...open, corners: [...open.corners, at] };
  return { state: { ...state, rooms: [...state.rooms.slice(0, -1), room] }, problem: null };
}

/** Takes back the last tap: the open room's last corner, or reopens the room last closed. */
export function undoTap(state: TraceState): TraceState {
  if (state.locked) return state;
  const last = state.rooms[state.rooms.length - 1];
  if (!last) return state;
  const rest = state.rooms.slice(0, -1);
  if (last.closed) return { ...state, rooms: [...rest, { ...last, closed: false }] };
  if (last.corners.length <= 1) return { ...state, rooms: rest };
  return { ...state, rooms: [...rest, { ...last, corners: last.corners.slice(0, -1) }] };
}

/** Every corner at [from], in every room, to [to] (snapped to another corner when near one): shared corners move together. */
export function moveCorner(state: TraceState, from: DrawnPoint, to: DrawnPoint, within: number): TraceState {
  const others = { ...state, rooms: state.rooms.map((r) => ({ ...r, corners: r.corners.filter((c) => !same(c, from)) })) };
  const at = snapped(others, to, within);
  return { ...state, rooms: state.rooms.map((r) => ({ ...r, corners: r.corners.map((c) => (same(c, from) ? { ...at } : c)) })) };
}

export function setLength(state: TraceState, room: number, wall: number, text: string | null): TraceState {
  return edit(state, room, (r) => ({ ...r, lengths: r.lengths.map((l, i) => (i === wall ? text : l)) }));
}

export function setName(state: TraceState, room: number, name: string | null): TraceState {
  return edit(state, room, (r) => ({ ...r, name: name?.trim() || null }));
}

export function setCeiling(state: TraceState, room: number, text: string | null): TraceState {
  return edit(state, room, (r) => ({ ...r, ceiling: text }));
}

function edit(state: TraceState, room: number, f: (r: TraceRoom) => TraceRoom): TraceState {
  return { ...state, rooms: state.rooms.map((r, i) => (i === room ? f(r) : r)) };
}

/**
 * The earlier room that has wall [wall] of room [room] too — the same two corners — when there is
 * one: a wall two rooms share is typed once, and the build gives it to both.
 */
export function sharedWith(state: TraceState, room: number, wall: number): { room: number; wall: number } | null {
  const r = state.rooms[room];
  if (!r) return null;
  const n = r.corners.length;
  const a = r.corners[wall] as DrawnPoint;
  const b = r.corners[(wall + 1) % n] as DrawnPoint;
  for (let k = 0; k < room; k++) {
    const o = state.rooms[k] as TraceRoom;
    const m = o.corners.length;
    for (let j = 0; j < m; j++) {
      const p = o.corners[j] as DrawnPoint;
      const q = o.corners[(j + 1) % m] as DrawnPoint;
      if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) return { room: k, wall: j };
    }
  }
  return null;
}

/** A length as the tracer writes it: 14'3", or 14'3 1/2" to the eighth. */
export function lengthText(inches: number): string {
  const eighths = Math.round(inches * 8);
  const whole = Math.floor(eighths / 8);
  const rest = eighths - whole * 8;
  if (rest === 0) return feetInches(whole);
  const f = Math.floor(whole / 12);
  const i = whole - f * 12;
  const g = gcd(rest, 8);
  return `${f}'${i} ${rest / g}/${8 / g}"`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** What still stops the trace being built: no room closed yet, or not one wall's length typed. */
export function traceProblem(state: TraceState): "noRoom" | "noLength" | null {
  const closed = state.rooms.filter((r) => r.closed);
  if (closed.length === 0) return "noRoom";
  if (!closed.some((r) => r.lengths.some((l) => parseLength(l) !== null))) return "noLength";
  return null;
}

/** The trace as a read, for the build: the closed rooms, their numbers, and what a model read in them. */
export function traceToRead(state: TraceState): HandSketchRead {
  return {
    version: 1,
    kind: "hand",
    rotate: state.rotate,
    ignored: [],
    rooms: state.rooms
      .filter((r) => r.closed)
      .map((r) => ({
        name: r.name,
        guess: r.guess ?? null,
        corners: r.corners,
        walls: r.corners.map((_, i) => ({ length: r.lengths[i] ?? null })),
        ceiling: r.ceiling,
        openings: r.openings ?? [],
        items: r.items ?? [],
      })),
  };
}

/** A model's reading as a trace to correct: its rooms closed, its numbers in, its corners fixed in number. */
export function readToTrace(read: HandSketchRead, photo: { width: number; height: number }): TraceState {
  return {
    photo,
    rotate: read.rotate,
    locked: true,
    rooms: read.rooms.map((r) => ({
      corners: r.corners.map((c) => ({ x: c.x, y: c.y })),
      closed: true,
      lengths: r.walls.map((w) => w.length),
      name: r.name,
      ceiling: r.ceiling,
      guess: r.guess,
      openings: r.openings,
      items: r.items,
    })),
  };
}

const signedArea = (p: DrawnPoint[]) => p.reduce((s, a, i) => s + a.x * (p[(i + 1) % p.length] as DrawnPoint).y - (p[(i + 1) % p.length] as DrawnPoint).x * a.y, 0) / 2;

/** The nearest point to [p] on the segment [a]-[b]: how far along (0 to 1, unclamped) and how far off. */
function onSegment(p: DrawnPoint, a: DrawnPoint, b: DrawnPoint): { t: number; off: number } {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  const c = Math.max(0, Math.min(1, t));
  return { t, off: Math.hypot(p.x - (a.x + (b.x - a.x) * c), p.y - (a.y + (b.y - a.y) * c)) };
}

function inside(p: DrawnPoint, poly: DrawnPoint[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as DrawnPoint;
    const b = poly[j] as DrawnPoint;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The wall of [corners] a point lies on (within [tol] photo pixels), and how far along it. */
function wallAt(corners: DrawnPoint[], p: DrawnPoint, tol: number): { wall: number; t: number; off: number } | null {
  let best: { wall: number; t: number; off: number } | null = null;
  corners.forEach((a, i) => {
    const m = onSegment(p, a, corners[(i + 1) % corners.length] as DrawnPoint);
    if (m.off <= tol && (!best || m.off < best.off)) best = { wall: i, t: Math.max(0, Math.min(1, m.t)), off: m.off };
  });
  return best;
}

const along = (corners: DrawnPoint[], wall: number, t: number): DrawnPoint => {
  const a = corners[wall] as DrawnPoint;
  const b = corners[(wall + 1) % corners.length] as DrawnPoint;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

/** How near counts as on a wall, in the photo's pixels: a pen line's width or so at the size photos are kept. */
const onWallTol = (photo: { width: number; height: number }) => Math.max(4, 0.012 * Math.max(photo.width, photo.height));

/**
 * The doors Scrivn saw drawn (a door leaf drawn open from a wall) on the rooms they open into: on the wall at the hinge,
 * as wide as the leaf is long, and not sure, so the person is asked.
 */
function doorsOn(rooms: TraceRoom[], swings: { hinge: DrawnPoint; tip: DrawnPoint }[], photo: { width: number; height: number }): TraceRoom[] {
  const tol = onWallTol(photo) * 4;
  return rooms.map((r) => {
    const openings: DrawnOpening[] = [];
    for (const s of swings) {
      if (!inside(s.tip, r.corners)) continue;
      // The wall nearest the hinge; at a corner, the other wall there too.
      const near = r.corners
        .map((a, i) => ({ i, m: onSegment(s.hinge, a, r.corners[(i + 1) % r.corners.length] as DrawnPoint) }))
        .filter((c) => c.m.off <= tol)
        .sort((x, y) => x.m.off - y.m.off);
      const on = near[0];
      if (!on) continue;
      const a = r.corners[on.i] as DrawnPoint;
      const b = r.corners[(on.i + 1) % r.corners.length] as DrawnPoint;
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const leaf = Math.hypot(s.tip.x - s.hinge.x, s.tip.y - s.hinge.y);
      // The opening runs from the hinge the way the leaf leans.
      const lean = Math.sign((s.tip.x - s.hinge.x) * (b.x - a.x) + (s.tip.y - s.hinge.y) * (b.y - a.y)) || 1;
      const hingeT = Math.max(0, Math.min(1, on.m.t));
      const at = Math.max(0, Math.min(1, hingeT + (lean * leaf) / (2 * len)));
      const other = near[1];
      openings.push({ kind: "door", wall: on.i, at, size: null, orWall: other ? other.i : null, sure: false, note: "a door drawn open" });
    }
    return openings.length ? { ...r, openings: [...(r.openings ?? []), ...openings] } : r;
  });
}

/**
 * The rooms Scrivn found in a photo as a trace: each closed, no numbers or names yet. Corners stay where found. The
 * smallest come first: a tub or a vanity is joined into its room before that room's walls are typed, since joining
 * changes them. Door swings found go on the rooms they open into, to be confirmed.
 */
export function foundToTrace(
  rooms: { corners: DrawnPoint[] }[],
  photo: { width: number; height: number },
  swings: { hinge: DrawnPoint; tip: DrawnPoint }[] = [],
): TraceState {
  const traced = rooms
    .filter((r) => r.corners.length >= 3)
    .sort((p, q) => Math.abs(signedArea(p.corners)) - Math.abs(signedArea(q.corners)))
    .map((r): TraceRoom => ({ corners: r.corners.map((c) => ({ x: c.x, y: c.y })), closed: true, lengths: r.corners.map(() => null), name: null, ceiling: null }));
  return { photo, rotate: 0, locked: false, found: true, rooms: doorsOn(traced, swings, photo) };
}

/** [poly] with a corner added wherever a corner of [other] lies on one of its walls: so shared walls match piece for piece. */
function splitAtCorners(poly: DrawnPoint[], other: DrawnPoint[], tol: number): DrawnPoint[] {
  const out: DrawnPoint[] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as DrawnPoint;
    out.push(a);
    const on = other
      .filter((v) => !same(v, a) && !same(v, b))
      .map((v) => ({ v, m: onSegment(v, a, b) }))
      .filter(({ m }) => m.t > 0.001 && m.t < 0.999 && m.off <= tol)
      .sort((x, y) => x.m.t - y.m.t);
    for (const { v } of on) out.push({ x: v.x, y: v.y });
  });
  return out;
}

/** How much wall [a] and [b] share, piece for piece once each is split at the other's corners. */
function sharedLength(a: DrawnPoint[], b: DrawnPoint[], tol: number): number {
  const pa = splitAtCorners(a, b, tol);
  const pb = splitAtCorners(b, a, tol);
  let s = 0;
  for (let i = 0; i < pa.length; i++) {
    const p = pa[i] as DrawnPoint;
    const q = pa[(i + 1) % pa.length] as DrawnPoint;
    for (let j = 0; j < pb.length; j++) {
      const r = pb[j] as DrawnPoint;
      const t = pb[(j + 1) % pb.length] as DrawnPoint;
      if ((same(p, r) && same(q, t)) || (same(p, t) && same(q, r))) s += Math.hypot(q.x - p.x, q.y - p.y);
    }
  }
  return s;
}

/**
 * One outline round two that share walls: the walls they share taken out, and the rest followed round. Where that
 * leaves more than one loop (the two touch again further on, closing a gap between them) the outside one is kept, the
 * gap with it. Null when they share no wall.
 */
function joinOutlines(a: DrawnPoint[], b: DrawnPoint[], tol: number): DrawnPoint[] | null {
  const ccw = (p: DrawnPoint[]) => (signedArea(p) < 0 ? p.slice().reverse() : p);
  const edges: [DrawnPoint, DrawnPoint][] = [];
  for (const poly of [ccw(splitAtCorners(a, b, tol)), ccw(splitAtCorners(b, a, tol))])
    for (let i = 0; i < poly.length; i++) edges.push([poly[i] as DrawnPoint, poly[(i + 1) % poly.length] as DrawnPoint]);
  // Shared walls run opposite ways round the two outlines.
  const kept = edges.filter(([p, q]) => !edges.some(([r, t]) => same(p, t) && same(q, r)));
  if (kept.length < 3 || kept.length === edges.length) return null;
  const used = new Set<number>();
  const loops: DrawnPoint[][] = [];
  for (let start = 0; start < kept.length; start++) {
    if (used.has(start)) continue;
    const loop: DrawnPoint[] = [];
    let at = start;
    for (let guard = 0; guard <= kept.length; guard++) {
      used.add(at);
      const [p, q] = kept[at] as [DrawnPoint, DrawnPoint];
      loop.push(p);
      const next = kept.findIndex(([r], i) => !used.has(i) && same(r, q));
      if (next < 0) break;
      at = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  const out = loops.sort((x, y) => Math.abs(signedArea(y)) - Math.abs(signedArea(x)))[0];
  if (!out) return null;
  // Corners left in a straight run where the two met are not corners: each side was drawn (and found) on its own, so
  // they meet a few degrees off straight; a corner turns much further.
  const straight = out.filter((p, i) => {
    const o = out[(i - 1 + out.length) % out.length] as DrawnPoint;
    const n = out[(i + 1) % out.length] as DrawnPoint;
    const cross = (p.x - o.x) * (n.y - p.y) - (p.y - o.y) * (n.x - p.x);
    const dot = (p.x - o.x) * (n.x - p.x) + (p.y - o.y) * (n.y - p.y);
    return Math.abs(Math.atan2(cross, dot)) > (12 * Math.PI) / 180;
  });
  return straight.length >= 3 ? straight : null;
}

/** What a shape joined into a room was, when it was not a room. */
export type JoinedAs = "tub" | "shower" | "vanity" | "toilet";

/**
 * A fixture drawn as a shape against a room's walls, as the build takes it: on the room's wall it runs along most,
 * from where to where along it, and how far out it is drawn.
 */
function fixtureFrom(room: DrawnPoint[], shape: DrawnPoint[], kind: JoinedAs, tol: number): DrawnItem | null {
  let best: { wall: number; from: number; to: number; span: number } | null = null;
  room.forEach((a, i) => {
    const b = room[(i + 1) % room.length] as DrawnPoint;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ts = shape.map((v) => onSegment(v, a, b)).filter((m) => m.off <= tol * 2).map((m) => Math.max(0, Math.min(1, m.t)));
    if (ts.length < 2) return;
    const from = Math.min(...ts);
    const to = Math.max(...ts);
    const span = (to - from) * len;
    if (!best || span > best.span) best = { wall: i, from, to, span };
  });
  const got = best as { wall: number; from: number; to: number; span: number } | null;
  if (!got) return null;
  const a = room[got.wall] as DrawnPoint;
  const b = room[(got.wall + 1) % room.length] as DrawnPoint;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const depth = Math.max(...shape.map((v) => Math.abs((v.x - a.x) * (b.y - a.y) - (v.y - a.y) * (b.x - a.x)) / len));
  return { kind, label: null, wall: got.wall, from: got.from, to: got.to, depth, size: null };
}

/**
 * A shape that is not a room (a tub, a vanity, drawn touching the walls) joined into the room it shares the most wall
 * with. That room keeps its name, the numbers on the walls it still has, and its doors and fixtures; told what the
 * shape was ([as]), the room gets that fixture where the shape was. Null when it shares no wall with a room.
 */
export function joinRoom(state: TraceState, room: number, as: JoinedAs | null = null): { state: TraceState; into: number } | null {
  const r = state.rooms[room];
  if (!r?.closed) return null;
  const tol = onWallTol(state.photo);
  let best = -1;
  let most = 0;
  state.rooms.forEach((o, i) => {
    if (i === room || !o.closed) return;
    const s = sharedLength(r.corners, o.corners, tol);
    if (s > most) [best, most] = [i, s];
  });
  const into = state.rooms[best];
  if (!into) return null;
  const corners = joinOutlines(into.corners, r.corners, tol);
  if (!corners) return null;
  // A wall that is the same two corners as one before keeps its number.
  const lengthOf = (p: DrawnPoint, q: DrawnPoint): string | null => {
    for (const o of [into, r]) {
      for (let i = 0; i < o.corners.length; i++) {
        const a = o.corners[i] as DrawnPoint;
        const b = o.corners[(i + 1) % o.corners.length] as DrawnPoint;
        if ((same(a, p) && same(b, q)) || (same(a, q) && same(b, p))) return o.lengths[i] ?? null;
      }
    }
    return null;
  };
  // Doors and fixtures go to the wall of the new outline they lie on: its walls are numbered afresh.
  const moveOpening = (from: TraceRoom, o: DrawnOpening): DrawnOpening | null => {
    const m = wallAt(corners, along(from.corners, o.wall, o.at), tol);
    return m ? { ...o, wall: m.wall, at: m.t, orWall: null } : null;
  };
  const moveItem = (from: TraceRoom, it: DrawnItem): DrawnItem | null => {
    // The wall is the one under its middle: an end at a corner is on two walls at once.
    const m = wallAt(corners, along(from.corners, it.wall, (it.from + it.to) / 2), tol);
    if (!m) return null;
    const a = corners[m.wall] as DrawnPoint;
    const b = corners[(m.wall + 1) % corners.length] as DrawnPoint;
    const ends = [it.from, it.to].map((t) => Math.max(0, Math.min(1, onSegment(along(from.corners, it.wall, t), a, b).t)));
    return { ...it, wall: m.wall, from: Math.min(...ends), to: Math.max(...ends) };
  };
  const openings = [...(into.openings ?? []).map((o) => moveOpening(into, o)), ...(r.openings ?? []).map((o) => moveOpening(r, o))].filter((o): o is DrawnOpening => !!o);
  const items = [...(into.items ?? []).map((it) => moveItem(into, it)), ...(r.items ?? []).map((it) => moveItem(r, it))].filter((it): it is DrawnItem => !!it);
  if (as) {
    const fixture = fixtureFrom(corners, r.corners, as, tol);
    if (fixture) items.push(fixture);
  }
  const joined: TraceRoom = { ...into, corners, lengths: corners.map((p, i) => lengthOf(p, corners[(i + 1) % corners.length] as DrawnPoint)), openings, items };
  const rooms = state.rooms.map((o, i) => (i === best ? joined : o)).filter((_, i) => i !== room);
  return { state: { ...state, rooms }, into: best > room ? best - 1 : best };
}

/* ── The build's questions, answered ───────────────────────────────────────────────────────── */

export type HandSketchAnswer =
  | { kind: "roomName"; name: string }
  | { kind: "doorWall"; wall: number }
  | { kind: "isOpening"; yes: boolean }
  | { kind: "wallDiffers"; length: string | null }
  | { kind: "tapeWall"; length: string | null };

/** A question's key, the same for the same question after a rebuild: what "leave it" is remembered by. */
export function questionKey(q: HandSketchQuestion): string {
  switch (q.kind) {
    case "roomName":
      return `roomName:${q.room}`;
    case "doorWall":
    case "isOpening":
      return `${q.kind}:${q.room}:${q.opening}`;
    case "wallDiffers":
    case "tapeWall":
      return `${q.kind}:${q.room}:${q.wall}`;
  }
}

/**
 * [read] with [answer] to [question] in it, and the questions now left alone: a null length for a
 * wall question means "leave it as it is", which is remembered rather than written into the read.
 */
export function answerQuestion(read: HandSketchRead, question: HandSketchQuestion, answer: HandSketchAnswer, dismissed: string[]): { read: HandSketchRead; dismissed: string[] } {
  const rooms = read.rooms.map((r) => ({ ...r }));
  const room = rooms[question.room];
  if (!room) return { read, dismissed };
  const leave = (): { read: HandSketchRead; dismissed: string[] } => ({ read, dismissed: [...new Set([...dismissed, questionKey(question)])] });
  if (question.kind === "roomName" && answer.kind === "roomName") {
    room.name = answer.name.trim() || null;
  } else if (question.kind === "doorWall" && answer.kind === "doorWall") {
    const n = room.corners.length;
    room.openings = room.openings.map((o, i) => {
      if (i !== question.opening) return o;
      if (answer.wall === o.wall) return { ...o, orWall: null };
      // The other wall at the corner the door is drawn from: it stands at that corner's end of it.
      const b = answer.wall;
      const at = b === (o.wall + 1) % n ? 0 : b === (o.wall - 1 + n) % n ? 1 : o.at;
      return { ...o, wall: b, at, orWall: null };
    });
  } else if (question.kind === "isOpening" && answer.kind === "isOpening") {
    room.openings = answer.yes ? room.openings.map((o, i) => (i === question.opening ? { ...o, sure: true } : o)) : room.openings.filter((_, i) => i !== question.opening);
    // Taking one away renumbers the rest: what was left alone about this room's openings starts over.
    if (!answer.yes) dismissed = dismissed.filter((k) => !k.startsWith(`doorWall:${question.room}:`) && !k.startsWith(`isOpening:${question.room}:`));
  } else if ((question.kind === "wallDiffers" || question.kind === "tapeWall") && (answer.kind === "wallDiffers" || answer.kind === "tapeWall")) {
    if (answer.length === null) return leave();
    room.walls = room.walls.map((w, i) => (i === question.wall ? { length: answer.length } : w));
  } else {
    return { read, dismissed };
  }
  return { read: { ...read, rooms }, dismissed };
}

/** The questions not yet left alone. */
export function openQuestions(questions: HandSketchQuestion[], dismissed: string[]): HandSketchQuestion[] {
  const left = new Set(dismissed);
  return questions.filter((q) => !left.has(questionKey(q)));
}
