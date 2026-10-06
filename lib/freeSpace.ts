/**
 * The space a run of new walls closes off against the walls already there.
 *
 * "drawing the wall freehand is placing a wall over another wall and protruding into the next room. and not
 * creating a room with the area thats now enclosed" (the owner, 2026-10-05, drawing a closet with the wall tool
 * into the corner between the bedroom's notch and the rec room's wall). The wall tool made a room of a run that
 * closed on its own first corner, on free walls, or across one room; a run from one room's wall to another's
 * closed off a space just as surely and was left as free walls. This finds that space.
 *
 * Worked on a grid of inches, which is what a room's corners are given in: every room's floor, and a wall's
 * thickness out from its walls (where the wall between two rooms stands), and the free walls' thickness, are taken;
 * the run itself is a line nothing crosses. The space beside the run is flooded; if it closes inside
 * [ENCLOSURE_REACH_PX] of the run it is the space, else the run closed nothing on that side. Its outline is traced
 * off the grid, straightened (Douglas-Peucker), and each side laid on the line of the wall it runs along - the run's
 * own, or a room's wall's outer face - so its corners are where those lines meet, exact, not on the grid.
 *
 * Pure geometry in world pixels (an inch each), so it is checked in Node.
 */

import { type FreeWall, type SketchRoom, PIXELS_PER_FOOT, WALL_THICKNESS_PX, freeWallSegments, wallsOf } from "./sketch";

type Point = { x: number; y: number };

/** How far round the run the space is looked for: 20'. Not closed inside that, it is open. */
const ENCLOSURE_REACH_PX = 20 * PIXELS_PER_FOOT;
/** The least space worth a room: a square foot. */
const MIN_SPACE_PX = PIXELS_PER_FOOT * PIXELS_PER_FOOT;
/** How near a side must run to a wall's line, and how near parallel, to be laid on it. */
const SNAP_LINE_PX = 2;
const SNAP_LINE_SIN = Math.sin((4 * Math.PI) / 180);
/** How far a straightened side may stray from the traced outline: an inch, the grid's own grain. */
const STRAIGHTEN_PX = 1;
/** Half the narrowest a space may be and still be part of a room: a gap under 7" between walls is a wall ([opened]). */
const OPEN_PX = 3;

/** A line a side may be laid on: through [a], along unit [d], from [from] to [to] along it. */
interface WallLine {
  a: Point;
  d: Point;
  from: number;
  to: number;
}

/**
 * The space [run] closes off against [rooms] (the storey's) and [freeWalls], as the corners of a room clockwise - the
 * smaller, when it closes space on both sides - or null when it closes none.
 */
export function spaceClosedBy(run: Point[], rooms: SketchRoom[], freeWalls: FreeWall[]): Point[] | null {
  if (run.length < 2) return null;
  const xs = run.map((p) => p.x);
  const ys = run.map((p) => p.y);
  const x0 = Math.floor(Math.min(...xs) - ENCLOSURE_REACH_PX);
  const y0 = Math.floor(Math.min(...ys) - ENCLOSURE_REACH_PX);
  const w = Math.ceil(Math.max(...xs) + ENCLOSURE_REACH_PX) - x0;
  const h = Math.ceil(Math.max(...ys) + ENCLOSURE_REACH_PX) - y0;
  const taken = new Uint8Array(w * h);

  const lines: WallLine[] = [];
  const T = WALL_THICKNESS_PX;
  for (const room of rooms) {
    fillPolygon(taken, w, h, x0, y0, room.vertices);
    // A wall's thickness out from each face, mitred at the corners as the walls are drawn.
    const outer = mitredOutline(room.vertices, T);
    const walls = wallsOf(room);
    walls.forEach((wall, i) => {
      if (wall.lengthPx <= 0) return;
      const j = (i + 1) % walls.length;
      fillPolygon(taken, w, h, x0, y0, [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }, outer[j] as Point, outer[i] as Point]);
      const d = { x: (wall.x2 - wall.x1) / wall.lengthPx, y: (wall.y2 - wall.y1) / wall.lengthPx };
      const face = outerNormal(room.vertices, d);
      lines.push({ a: { x: wall.x1 + face.x * T, y: wall.y1 + face.y * T }, d, from: -T, to: wall.lengthPx + T });
    });
  }
  for (const free of freeWalls) {
    for (const s of freeWallSegments(free)) {
      if (s.lengthPx <= 0) continue;
      const d = { x: (s.x2 - s.x1) / s.lengthPx, y: (s.y2 - s.y1) / s.lengthPx };
      band(taken, w, h, x0, y0, { x: s.x1, y: s.y1 }, d, s.lengthPx, -T / 2, T / 2, T / 2);
      for (const side of [-T / 2, T / 2]) lines.push({ a: { x: s.x1 - d.y * side, y: s.y1 + d.x * side }, d, from: -T / 2, to: s.lengthPx + T / 2 });
    }
  }
  // The run: a line nothing crosses, and the lines its sides are laid on.
  const barrier = new Uint8Array(w * h);
  for (let i = 0; i + 1 < run.length; i++) {
    const p = run[i] as Point;
    const q = run[i + 1] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    if (length <= 0) continue;
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    band(barrier, w, h, x0, y0, p, d, length, -0.75, 0.75, 0.75);
    lines.push({ a: p, d, from: 0, to: length });
  }
  for (let i = 0; i < taken.length; i++) if (barrier[i]) taken[i] = 1;

  // Flood beside the run, both sides of its longest piece; a flood reaching the window's edge is open.
  let best: { cells: Uint8Array; count: number } | null = null;
  const seen = new Uint8Array(w * h);
  let longest = 0;
  for (let i = 1; i < run.length; i++) {
    if (Math.hypot((run[i] as Point).x - (run[i - 1] as Point).x, (run[i] as Point).y - (run[i - 1] as Point).y) > Math.hypot((run[longest + 1] as Point).x - (run[longest] as Point).x, (run[longest + 1] as Point).y - (run[longest] as Point).y)) longest = i - 1;
  }
  const p = run[longest] as Point;
  const q = run[longest + 1] as Point;
  const length = Math.hypot(q.x - p.x, q.y - p.y);
  if (length <= 0) return null;
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const normal = { x: -(q.y - p.y) / length, y: (q.x - p.x) / length };
  for (const side of [1, -1]) {
    for (const off of [2, 3, 4]) {
      const cx = Math.floor(mid.x + normal.x * off * side) - x0;
      const cy = Math.floor(mid.y + normal.y * off * side) - y0;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h || taken[cy * w + cx] || seen[cy * w + cx]) continue;
      const flood = floodFrom(taken, seen, w, h, cx, cy);
      if (flood && flood.count >= MIN_SPACE_PX && (!best || flood.count < best.count)) best = flood;
      break;
    }
  }
  if (!best) return null;

  /*
    Not up a wall's cavity (2026-10-05, the phone's walk of 13:04): where two rooms' walls stand a little more than a
    wall's thickness apart, the space between them is open to the flood - the walk-in's ran 1.6" wide 8' up between the
    bedroom's wall and the main room's. Anything narrower than [OPEN_PX] twice over is let go, and the room is what is left.
  */
  const cells = opened(best.cells, w, h, OPEN_PX);
  if (!cells) return null;
  const traced = traceOutline(cells, w, h);
  if (!traced) return null;
  const straight = straighten(traced.map((c) => ({ x: c.x + x0, y: c.y + y0 })));
  const corners = laidOnWalls(straight, lines);
  if (corners.length < 3 || Math.abs(area2(corners)) / 2 < MIN_SPACE_PX) return null;
  return area2(corners) >= 0 ? corners : [...corners].reverse();
}

/** The least space asked about as a room ([spacesBetweenRooms]): 12 sq ft, a small closet. */
const ROOM_SPACE_MIN_PX = 12 * PIXELS_PER_FOOT * PIXELS_PER_FOOT;
/** The most: 400 sq ft. More is the outdoors between two wings, not a room nobody tapped. */
const ROOM_SPACE_MAX_PX = 400 * PIXELS_PER_FOOT * PIXELS_PER_FOOT;
/** How far apart along their line two rooms' walls facing the same way may end and still be bridged as one wall: 16'. */
const BRIDGE_MAX_PX = 16 * PIXELS_PER_FOOT;
/** How far off one line two such walls may stand and still be one: 6". A foot bridged a notch in the outside wall as a room. */
const BRIDGE_LINE_PX = 6;
/** Half the narrowest a space asked about may be: 6", so a gap of a foot between two walls is a gap, not a room. */
const ROOM_OPEN_PX = 6;

/**
 * THE SPACES BETWEEN THE ROOMS THAT NOBODY TAPPED (2026-10-06, the walk of 06:31): "not a closet but it could suggest
 * filling this in as a room. is there a room here, tap to fill it, name it" (the owner, of the space over the stairs between
 * a bedroom's closet and the next bedroom - three sides the rooms' walls, the fourth the house's own wall carrying on
 * between the two bedrooms' outside walls).
 *
 * Worked on the grid [spaceClosedBy] works on: every room's floor and a wall's thickness out from its walls are taken; and
 * where two rooms' walls face the same way within [BRIDGE_LINE_PX] of one line, ending no more than [BRIDGE_MAX_PX] apart
 * along it, the wall between their ends is taken too - the house's wall carrying on, or a corridor's, between two rooms
 * that stand on it. Then everything the outside reaches is outside, and each space left - between [ROOM_SPACE_MIN_PX] and
 * [ROOM_SPACE_MAX_PX], whatever of it is narrower than [ROOM_OPEN_PX] twice let go - is traced, straightened, and its sides
 * laid on the walls round it: the outline a room there would have, a wall off every room beside it. Clockwise, largest
 * first. [rooms] are one storey's.
 */
export function spacesBetweenRooms(rooms: SketchRoom[]): Point[][] {
  const live = rooms.filter((r) => r.vertices.length >= 3);
  if (live.length < 2) return [];
  const T = WALL_THICKNESS_PX;
  const xs = live.flatMap((r) => r.vertices.map((v) => v.x));
  const ys = live.flatMap((r) => r.vertices.map((v) => v.y));
  const margin = T + 8;
  const x0 = Math.floor(Math.min(...xs) - margin);
  const y0 = Math.floor(Math.min(...ys) - margin);
  const w = Math.ceil(Math.max(...xs) + margin) - x0;
  const h = Math.ceil(Math.max(...ys) + margin) - y0;
  if (w * h > 4_000_000) return [];
  const taken = new Uint8Array(w * h);
  const lines: WallLine[] = [];
  interface Face {
    room: number;
    a: Point;
    d: Point;
    n: Point;
    length: number;
  }
  const faces: Face[] = [];
  live.forEach((room, r) => {
    fillPolygon(taken, w, h, x0, y0, room.vertices);
    const outer = mitredOutline(room.vertices, T);
    const walls = wallsOf(room);
    walls.forEach((wall, i) => {
      if (wall.lengthPx <= 0) return;
      const j = (i + 1) % walls.length;
      fillPolygon(taken, w, h, x0, y0, [{ x: wall.x1, y: wall.y1 }, { x: wall.x2, y: wall.y2 }, outer[j] as Point, outer[i] as Point]);
      const d = { x: (wall.x2 - wall.x1) / wall.lengthPx, y: (wall.y2 - wall.y1) / wall.lengthPx };
      const n = outerNormal(room.vertices, d);
      const a = { x: wall.x1 + n.x * T, y: wall.y1 + n.y * T };
      lines.push({ a, d, from: -T, to: wall.lengthPx + T });
      faces.push({ room: r, a, d, n, length: wall.lengthPx });
    });
  });
  // Each wall's face bridged to the nearest face beyond its end on its line, of another room, facing the same way.
  const bridgeCos = Math.cos((2 * Math.PI) / 180);
  for (const f of faces) {
    let best: { gap: number; q: Point } | null = null;
    for (const g of faces) {
      if (g.room === f.room || f.n.x * g.n.x + f.n.y * g.n.y < bridgeCos) continue;
      const off1 = (g.a.x - f.a.x) * f.n.x + (g.a.y - f.a.y) * f.n.y;
      const gb = { x: g.a.x + g.d.x * g.length, y: g.a.y + g.d.y * g.length };
      const off2 = (gb.x - f.a.x) * f.n.x + (gb.y - f.a.y) * f.n.y;
      if (Math.abs(off1) > BRIDGE_LINE_PX || Math.abs(off2) > BRIDGE_LINE_PX) continue;
      const t1 = (g.a.x - f.a.x) * f.d.x + (g.a.y - f.a.y) * f.d.y;
      const t2 = (gb.x - f.a.x) * f.d.x + (gb.y - f.a.y) * f.d.y;
      const near = Math.min(t1, t2);
      const gap = near - f.length;
      if (gap <= 1 || gap > BRIDGE_MAX_PX) continue;
      if (!best || gap < best.gap) best = { gap, q: t1 <= t2 ? g.a : gb };
    }
    if (!best) continue;
    const p = { x: f.a.x + f.d.x * f.length, y: f.a.y + f.d.y * f.length };
    const length = Math.hypot(best.q.x - p.x, best.q.y - p.y);
    if (length <= 0) continue;
    const d = { x: (best.q.x - p.x) / length, y: (best.q.y - p.y) / length };
    // Out of the house, as the faces it joins are: across is (d.y, -d.x) in [band].
    const outward = d.y * f.n.x - d.x * f.n.y >= 0;
    band(taken, w, h, x0, y0, p, d, length, outward ? 0 : -T, outward ? T : 0, 0.5);
    lines.push({ a: p, d, from: 0, to: length });
  }
  // Everything the outside reaches.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const reach = (i: number) => {
    if (taken[i] || outside[i]) return;
    outside[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) { reach(x); reach((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { reach(y * w); reach(y * w + w - 1); }
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) reach(i - 1);
    if (x < w - 1) reach(i + 1);
    if (y > 0) reach(i - w);
    if (y < h - 1) reach(i + w);
  }
  // Each space left: traced, straightened, laid on its walls.
  const seen = new Uint8Array(w * h);
  const found: Point[][] = [];
  for (let start = 0; start < w * h; start++) {
    if (taken[start] || outside[start] || seen[start]) continue;
    const cells = new Uint8Array(w * h);
    let count = 0;
    const queue = [start];
    seen[start] = 1;
    while (queue.length > 0) {
      const i = queue.pop() as number;
      cells[i] = 1;
      count++;
      const x = i % w;
      const y = (i - x) / w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j < 0 || taken[j] || outside[j] || seen[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    if (count < ROOM_SPACE_MIN_PX || count > ROOM_SPACE_MAX_PX) continue;
    const open = opened(cells, w, h, ROOM_OPEN_PX);
    if (!open) continue;
    const traced = traceOutline(open, w, h);
    if (!traced) continue;
    const corners = laidOnWalls(straighten(traced.map((c) => ({ x: c.x + x0, y: c.y + y0 }))), lines);
    if (corners.length < 3 || Math.abs(area2(corners)) / 2 < ROOM_SPACE_MIN_PX) continue;
    found.push(area2(corners) >= 0 ? corners : [...corners].reverse());
  }
  return found.sort((p, q) => Math.abs(area2(q)) - Math.abs(area2(p)));
}

/** Out of a room along a wall running [d]: the way turned -90 degrees on the page for a clockwise room. */
function outerNormal(ring: Point[], d: Point): Point {
  return area2(ring) >= 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
}

/** The most a mitred corner may stand off its corner, in wall thicknesses, before it is squared off instead. */
const MITER_LIMIT = 4;

/**
 * Each corner of [ring] moved [by] out, where its two walls' outer faces meet - the outer corners of the walls as they
 * are drawn. A corner so sharp its faces meet further than [MITER_LIMIT] thicknesses off is squared off at a thickness.
 */
function mitredOutline(ring: Point[], by: number): Point[] {
  const n = ring.length;
  const clockwise = area2(ring) >= 0;
  const faces = ring.map((p, i) => {
    const q = ring[(i + 1) % n] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const d = { x: (q.x - p.x) / length, y: (q.y - p.y) / length };
    const o = clockwise ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
    return { a: { x: p.x + o.x * by, y: p.y + o.y * by }, d, o };
  });
  return ring.map((p, i) => {
    const s = faces[(i - 1 + n) % n] as { a: Point; d: Point; o: Point };
    const t = faces[i] as { a: Point; d: Point; o: Point };
    const cross = s.d.x * t.d.y - s.d.y * t.d.x;
    const square = { x: p.x + t.o.x * by, y: p.y + t.o.y * by };
    if (Math.abs(cross) < 1e-9) return square;
    const k = ((t.a.x - s.a.x) * t.d.y - (t.a.y - s.a.y) * t.d.x) / cross;
    const corner = { x: s.a.x + s.d.x * k, y: s.a.y + s.d.y * k };
    if (Math.hypot(corner.x - p.x, corner.y - p.y) <= MITER_LIMIT * by) return corner;
    const m = { x: s.o.x + t.o.x, y: s.o.y + t.o.y };
    const length = Math.hypot(m.x, m.y) || 1;
    return { x: p.x + (m.x / length) * by, y: p.y + (m.y / length) * by };
  });
}

/** Twice the signed area: positive clockwise on the page (y down). */
function area2(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/** Marks the cells whose middles are inside [ring], a row at a time. */
function fillPolygon(grid: Uint8Array, w: number, h: number, x0: number, y0: number, ring: Point[]): void {
  const ys = ring.map((p) => p.y);
  const top = Math.max(0, Math.floor(Math.min(...ys) - y0));
  const bottom = Math.min(h - 1, Math.ceil(Math.max(...ys) - y0));
  for (let cy = top; cy <= bottom; cy++) {
    const y = y0 + cy + 0.5;
    const crossings: number[] = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i] as Point;
      const b = ring[j] as Point;
      if (a.y > y !== b.y > y) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    crossings.sort((m, n) => m - n);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const from = Math.max(0, Math.ceil((crossings[k] as number) - x0 - 0.5));
      const to = Math.min(w - 1, Math.floor((crossings[k + 1] as number) - x0 - 0.5));
      for (let cx = from; cx <= to; cx++) grid[cy * w + cx] = 1;
    }
  }
}

/**
 * Marks the cells whose middles lie in the strip along a segment from [a] along [d] for [length]: between [near] and
 * [far] across it (turned +90 degrees on the page is negative, the other way positive - a clockwise room's outside),
 * and [cap] past each end.
 */
function band(grid: Uint8Array, w: number, h: number, x0: number, y0: number, a: Point, d: Point, length: number, near: number, far: number, cap: number): void {
  // Across, positive out of a clockwise room: (d.y, -d.x).
  const nx = d.y;
  const ny = -d.x;
  const corners = [
    { x: a.x - d.x * cap + nx * near, y: a.y - d.y * cap + ny * near },
    { x: a.x - d.x * cap + nx * far, y: a.y - d.y * cap + ny * far },
    { x: a.x + d.x * (length + cap) + nx * near, y: a.y + d.y * (length + cap) + ny * near },
    { x: a.x + d.x * (length + cap) + nx * far, y: a.y + d.y * (length + cap) + ny * far },
  ];
  const left = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) - x0));
  const right = Math.min(w - 1, Math.ceil(Math.max(...corners.map((c) => c.x)) - x0));
  const top = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) - y0));
  const bottom = Math.min(h - 1, Math.ceil(Math.max(...corners.map((c) => c.y)) - y0));
  for (let cy = top; cy <= bottom; cy++) {
    for (let cx = left; cx <= right; cx++) {
      const px = x0 + cx + 0.5 - a.x;
      const py = y0 + cy + 0.5 - a.y;
      const along = px * d.x + py * d.y;
      const across = px * nx + py * ny;
      if (along >= -cap && along <= length + cap && across > Math.min(near, far) && across < Math.max(near, far)) grid[cy * w + cx] = 1;
    }
  }
}

/**
 * [cells] opened by a square [r] cells from its middle each way: every place the square fits inside the set, all of the
 * square - so a part narrower than the square is gone and the rest is as it was, its straight sides and its square or
 * wider corners exactly. Null when nothing is left. The phone's SharedWalls does the same.
 */
function opened(cells: Uint8Array, w: number, h: number, r: number): Uint8Array | null {
  const pass = (src: Uint8Array, horizontal: boolean, all: boolean): Uint8Array => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let hit = all;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x;
          const yy = horizontal ? y : y + k;
          const v = xx >= 0 && xx < w && yy >= 0 && yy < h && src[yy * w + xx] === 1;
          if (all && !v) {
            hit = false;
            break;
          }
          if (!all && v) {
            hit = true;
            break;
          }
        }
        out[y * w + x] = hit ? 1 : 0;
      }
    }
    return out;
  };
  const eroded = pass(pass(cells, true, true), false, true);
  if (!eroded.some((v) => v === 1)) return null;
  const grown = pass(pass(eroded, true, false), false, false);
  for (let i = 0; i < grown.length; i++) grown[i] = grown[i] === 1 && cells[i] === 1 ? 1 : 0;
  return grown;
}

/** The cells reached from (cx, cy) through free cells, or null when they reach the grid's edge - open. */
function floodFrom(taken: Uint8Array, seen: Uint8Array, w: number, h: number, cx: number, cy: number): { cells: Uint8Array; count: number } | null {
  const cells = new Uint8Array(w * h);
  const stack = [cy * w + cx];
  cells[cy * w + cx] = 1;
  seen[cy * w + cx] = 1;
  let count = 0;
  let open = false;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    count++;
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) open = true;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || taken[j] || cells[j]) continue;
      cells[j] = 1;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return open ? null : { cells, count };
}

/**
 * The outline of a set of cells, as grid corners clockwise (the set on the right going round), with the corners
 * where it runs straight on left out: the biggest loop when it has holes.
 */
function traceOutline(cells: Uint8Array, w: number, h: number): Point[] | null {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] === 1;
  // Each boundary side of a cell, as a step from one grid corner to the next, the cells on its right.
  const steps = new Map<number, { x: number; y: number; dx: number; dy: number }[]>();
  const key = (x: number, y: number) => y * (w + 1) + x;
  const add = (x: number, y: number, dx: number, dy: number) => {
    const k = key(x, y);
    const list = steps.get(k);
    if (list) list.push({ x, y, dx, dy });
    else steps.set(k, [{ x, y, dx, dy }]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y - 1)) add(x, y, 1, 0);
      if (!inside(x + 1, y)) add(x + 1, y, 0, 1);
      if (!inside(x, y + 1)) add(x + 1, y + 1, -1, 0);
      if (!inside(x - 1, y)) add(x, y + 1, 0, -1);
    }
  }
  let best: Point[] | null = null;
  let bestArea = 0;
  for (const [, list] of steps) {
    while (list.length > 0) {
      const start = list.pop() as { x: number; y: number; dx: number; dy: number };
      const loop: Point[] = [];
      let step = start;
      for (let guard = 0; guard < w * h * 4; guard++) {
        loop.push({ x: step.x, y: step.y });
        const nx = step.x + step.dx;
        const ny = step.y + step.dy;
        if (nx === start.x && ny === start.y) break;
        const next = steps.get(key(nx, ny));
        if (!next || next.length === 0) break;
        // At a corner two pieces meet, turn right first: the set stays on the right, and the loops stay apart.
        const order = [
          { dx: -step.dy, dy: step.dx },
          { dx: step.dx, dy: step.dy },
          { dx: step.dy, dy: -step.dx },
        ];
        let chosen = -1;
        for (const o of order) {
          chosen = next.findIndex((s) => s.dx === o.dx && s.dy === o.dy);
          if (chosen >= 0) break;
        }
        if (chosen < 0) chosen = 0;
        step = next.splice(chosen, 1)[0] as { x: number; y: number; dx: number; dy: number };
      }
      const ring = withoutStraights(loop);
      const a = area2(ring);
      if (a > bestArea) {
        bestArea = a;
        best = ring;
      }
    }
  }
  return best;
}

/** [ring] with every corner its neighbours run straight through left out. */
function withoutStraights(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length] as Point;
    const b = ring[i] as Point;
    const c = ring[(i + 1) % ring.length] as Point;
    if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) > 1e-9) out.push(b);
  }
  return out;
}

/** [ring] straightened: the fewest of its corners that keep it within [STRAIGHTEN_PX] of itself (Douglas-Peucker). */
function straighten(ring: Point[]): Point[] {
  if (ring.length <= 4) return ring;
  // Split at the corner furthest from the first, and straighten each half.
  const first = ring[0] as Point;
  let far = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot((ring[i] as Point).x - first.x, (ring[i] as Point).y - first.y) > Math.hypot((ring[far] as Point).x - first.x, (ring[far] as Point).y - first.y)) far = i;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[far] = 1;
  const pass = (from: number, to: number) => {
    const a = ring[from % ring.length] as Point;
    const b = ring[to % ring.length] as Point;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    let worst = -1;
    let worstAt = -1;
    for (let i = from + 1; i < to; i++) {
      const p = ring[i % ring.length] as Point;
      const off = length > 0 ? Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length : Math.hypot(p.x - a.x, p.y - a.y);
      if (off > worst) {
        worst = off;
        worstAt = i;
      }
    }
    if (worst > STRAIGHTEN_PX) {
      keep[worstAt % ring.length] = 1;
      pass(from, worstAt);
      pass(worstAt, to);
    }
  };
  pass(0, far);
  pass(far, ring.length);
  return ring.filter((_, i) => keep[i]);
}

/**
 * [ring]'s sides each laid on the line of the wall it runs along - within [SNAP_LINE_PX] of it and as near parallel as
 * [SNAP_LINE_SIN] - and its corners where those lines meet. A side along no wall keeps its own line. A corner whose
 * lines meet far off (nearly parallel sides) keeps its traced place.
 */
function laidOnWalls(ring: Point[], lines: WallLine[]): Point[] {
  const n = ring.length;
  const sides = ring.map((p, i) => {
    const q = ring[(i + 1) % n] as Point;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const d = length > 0 ? { x: (q.x - p.x) / length, y: (q.y - p.y) / length } : { x: 1, y: 0 };
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    let best: { a: Point; d: Point } = { a: p, d };
    let bestOff = SNAP_LINE_PX;
    for (const line of lines) {
      if (Math.abs(d.x * line.d.y - d.y * line.d.x) > SNAP_LINE_SIN) continue;
      const off = Math.abs((mid.x - line.a.x) * line.d.y - (mid.y - line.a.y) * line.d.x);
      if (off > bestOff) continue;
      const s1 = (p.x - line.a.x) * line.d.x + (p.y - line.a.y) * line.d.y;
      const s2 = (q.x - line.a.x) * line.d.x + (q.y - line.a.y) * line.d.y;
      if (Math.max(s1, s2) < line.from - SNAP_LINE_PX || Math.min(s1, s2) > line.to + SNAP_LINE_PX) continue;
      bestOff = off;
      best = { a: line.a, d: line.d };
    }
    return best;
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const s = sides[(i - 1 + n) % n] as { a: Point; d: Point };
    const t = sides[i] as { a: Point; d: Point };
    const traced = ring[i] as Point;
    const cross = s.d.x * t.d.y - s.d.y * t.d.x;
    if (Math.abs(cross) < 1e-6) {
      // One line through: no corner here at all.
      if (Math.abs((t.a.x - s.a.x) * s.d.y - (t.a.y - s.a.y) * s.d.x) < 0.5) continue;
      out.push(traced);
      continue;
    }
    const k = ((t.a.x - s.a.x) * t.d.y - (t.a.y - s.a.y) * t.d.x) / cross;
    const corner = { x: s.a.x + s.d.x * k, y: s.a.y + s.d.y * k };
    out.push(Math.hypot(corner.x - traced.x, corner.y - traced.y) > 6 ? traced : corner);
  }
  // Two corners one place are one.
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length] as Point;
    return out.length < 2 || Math.hypot(p.x - q.x, p.y - q.y) > 0.01;
  });
}
