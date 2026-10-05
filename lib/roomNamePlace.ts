/**
 * Where a room's name goes on the plan (2026-10-05). The phone's join of the 07:26 walk showed a hall 3'4" x 3'8" and
 * a bathroom 8'3" x 4'10" covered whole by their names: "the room names on these small rooms cover the entire room. I
 * cant tell where im joining im just blindly trusting it. the room labels need to shrink within the room or get placed
 * outside of it with a line designating what room it is" - and then "yes do the same in scrivn" (the owner). Scrivn's
 * plan had the same fault zoomed out, the hall's name broken a letter a line ("Ro / o / m / 3") to fit its width.
 *
 * So a name sits at its room's own spot only when it fits inside the room there, clear of the walls - at its own size
 * first, then smaller (the [NameSize]s given, largest first) - and when it fits at none it goes outside the room: clear
 * of every room's floor it is given to keep off and of the names already placed, as near as that allows, with a line
 * from it to its room ([NameSpot.outside]). The same rule as Scrivn Scan's (RoomNamePlace.kt). Plain numbers, so it is
 * tested in Node; the canvas measures the text and draws (components/sketch/SketchCanvas.tsx).
 */

/** A box: left, top, right, bottom. */
export interface NameBox {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** One way a name can be drawn: at [scale] of its full size, in a box [hw] by [hh] each side of its middle. */
export interface NameSize {
  scale: number;
  hw: number;
  hh: number;
}

/** Where a name went: its box's middle, the size it is drawn, and whether it is outside its room - with a line to it. */
export interface NameSpot {
  x: number;
  y: number;
  size: NameSize;
  outside: boolean;
}

export function nameBox(spot: NameSpot): NameBox {
  return { l: spot.x - spot.size.hw, t: spot.y - spot.size.hh, r: spot.x + spot.size.hw, b: spot.y + spot.size.hh };
}

export function boxesHit(a: NameBox, b: NameBox): boolean {
  return a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
}

/** Up, the sides, down, then the diagonals (y down). */
const DIRECTIONS: [number, number][] = (() => {
  const k = Math.SQRT1_2;
  return [
    [0, -1],
    [1, 0],
    [-1, 0],
    [0, 1],
    [k, -k],
    [-k, -k],
    [k, k],
    [-k, k],
  ];
})();
/** How far out, in steps of the first place clear of the room: a neighbour's floor may be there. */
const DISTANCES = [1, 1.5, 2.2, 3.2, 4.5];

/**
 * Places a name. [room] is the room's outline (x0, y0, x1, y1, ...); [obstacles] the floors a name outside must keep
 * off (its own room's among them); [taken] the names already placed; ([x], [y]) the room's own spot for its name.
 * Inside, the box must sit [margin] clear of the walls; outside, [gap] clear of every obstacle and of [taken], and in
 * [bounds] when given - and where it can, with its line to the room crossing none of [others], the rooms the line would
 * otherwise seem to point into (the hall of 07:26's first went diagonally across the rec room's corner). With nowhere
 * outside either, the last of [inside] at the room's spot.
 */
export function placeName(opts: {
  room: number[];
  obstacles: number[][];
  taken: NameBox[];
  x: number;
  y: number;
  inside: NameSize[];
  outside: NameSize;
  margin: number;
  gap: number;
  bounds?: NameBox;
  others?: number[][];
}): NameSpot {
  return (
    fitInside(opts) ?? placeOutside(opts) ?? { x: opts.x, y: opts.y, size: opts.inside[opts.inside.length - 1] as NameSize, outside: false }
  );
}

/** The name at the room's own spot, at the first of [inside] that fits there clear of the walls and of [taken]; null at none. */
export function fitInside(opts: { room: number[]; taken: NameBox[]; x: number; y: number; inside: NameSize[]; margin: number }): NameSpot | null {
  const { room, taken, x, y, inside, margin } = opts;
  for (const size of inside) {
    const spot = { x, y, size, outside: false };
    const box = nameBox(spot);
    const clear = { l: box.l - margin, t: box.t - margin, r: box.r + margin, b: box.b + margin };
    if (boxInsidePolygon(room, clear) && !taken.some((t) => boxesHit(t, box))) return spot;
  }
  return null;
}

/**
 * The name beside its room ([placeName]'s outside): the nearest place clear of [obstacles], [taken] and outside [bounds]
 * whose line to the room crosses none of [others], else the nearest clear place; null when there is none.
 */
export function placeOutside(opts: {
  room: number[];
  obstacles: number[][];
  taken: NameBox[];
  x: number;
  y: number;
  outside: NameSize;
  gap: number;
  bounds?: NameBox;
  others?: number[][];
}): NameSpot | null {
  const { room, obstacles, taken, x, y, outside, gap, bounds, others = [] } = opts;
  const around = boundsOf(room);
  // The nearest clear place whose line crosses no other room, else the nearest clear place.
  let best: NameSpot | null = null;
  let bestD = Infinity;
  let bestCrossing = true;
  for (const m of DISTANCES) {
    for (const [dx, dy] of DIRECTIONS) {
      // From the room's spot to the edge of its bounding box that way, then the gap and the name's own half that way.
      const toEdge = Math.min(
        dx > 0 ? (around.r - x) / dx : dx < 0 ? (around.l - x) / dx : Infinity,
        dy > 0 ? (around.b - y) / dy : dy < 0 ? (around.t - y) / dy : Infinity,
      );
      const d = (toEdge + gap + outside.hw * Math.abs(dx) + outside.hh * Math.abs(dy)) * m;
      if (best && !bestCrossing && d >= bestD) continue;
      const spot = { x: x + dx * d, y: y + dy * d, size: outside, outside: true };
      const box = nameBox(spot);
      if (bounds && (box.l < bounds.l || box.t < bounds.t || box.r > bounds.r || box.b > bounds.b)) continue;
      const padded = { l: box.l - gap, t: box.t - gap, r: box.r + gap, b: box.b + gap };
      if (obstacles.some((o) => boxHitsPolygon(o, padded))) continue;
      if (taken.some((t) => boxesHit(t, box))) continue;
      const [ex, ey] = edgeToward(spot, x, y);
      const crossing = others.some((o) => segmentHitsPolygon(o, ex, ey, x, y));
      if (best && (crossing ? bestCrossing === false || d >= bestD : bestCrossing === false && d >= bestD)) continue;
      best = spot;
      bestD = d;
      bestCrossing = crossing;
    }
  }
  return best;
}

/** Whether the segment from ([ax], [ay]) to ([bx], [by]) crosses a wall of [poly] or runs inside it. */
export function segmentHitsPolygon(poly: number[], ax: number, ay: number, bx: number, by: number): boolean {
  if (poly.length < 6) return false;
  if (pointInPolygon(poly, ax, ay) || pointInPolygon(poly, bx, by)) return true;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (segmentsCross(ax, ay, bx, by, poly[i * 2] as number, poly[i * 2 + 1] as number, poly[j * 2] as number, poly[j * 2 + 1] as number)) return true;
  }
  return false;
}

/** Where the line from a name outside its room leaves the name's box, heading for ([x], [y]). */
export function edgeToward(spot: NameSpot, x: number, y: number): [number, number] {
  const dx = x - spot.x;
  const dy = y - spot.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [spot.x, spot.y];
  const t = Math.min(Math.abs(dx) > 1e-9 ? spot.size.hw / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-9 ? spot.size.hh / Math.abs(dy) : Infinity, 1);
  return [spot.x + dx * t, spot.y + dy * t];
}

function boundsOf(poly: number[]): NameBox {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    l = Math.min(l, poly[i] as number);
    r = Math.max(r, poly[i] as number);
    t = Math.min(t, poly[i + 1] as number);
    b = Math.max(b, poly[i + 1] as number);
  }
  return { l, t, r, b };
}

/** Whether ([x], [y]) is inside [poly] (even-odd). */
export function pointInPolygon(poly: number[], x: number, y: number): boolean {
  const n = poly.length / 2;
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] as number;
    const yi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number;
    const yj = poly[j * 2 + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Whether all of [box] is inside [poly]: its corners in, and no wall of the room across it. */
export function boxInsidePolygon(poly: number[], box: NameBox): boolean {
  if (poly.length < 6) return false;
  const corners: [number, number][] = [
    [box.l, box.t],
    [box.r, box.t],
    [box.l, box.b],
    [box.r, box.b],
  ];
  if (!corners.every(([cx, cy]) => pointInPolygon(poly, cx, cy))) return false;
  return !edgesCross(poly, box);
}

/** Whether [box] touches [poly]'s floor at all: a corner of either inside the other, or a wall across it. */
export function boxHitsPolygon(poly: number[], box: NameBox): boolean {
  if (poly.length < 6) return false;
  const corners: [number, number][] = [
    [box.l, box.t],
    [box.r, box.t],
    [box.l, box.b],
    [box.r, box.b],
  ];
  if (corners.some(([cx, cy]) => pointInPolygon(poly, cx, cy))) return true;
  for (let i = 0; i + 1 < poly.length; i += 2) {
    const px = poly[i] as number;
    const py = poly[i + 1] as number;
    if (px > box.l && px < box.r && py > box.t && py < box.b) return true;
  }
  return edgesCross(poly, box);
}

function edgesCross(poly: number[], box: NameBox): boolean {
  const n = poly.length / 2;
  const sides: [number, number, number, number][] = [
    [box.l, box.t, box.r, box.t],
    [box.r, box.t, box.r, box.b],
    [box.r, box.b, box.l, box.b],
    [box.l, box.b, box.l, box.t],
  ];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2] as number;
    const ay = poly[i * 2 + 1] as number;
    const bx = poly[j * 2] as number;
    const by = poly[j * 2 + 1] as number;
    for (const [cx, cy, dx, dy] of sides) if (segmentsCross(ax, ay, bx, by, cx, cy, dx, dy)) return true;
  }
  return false;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = cross(cx, cy, dx, dy, ax, ay);
  const d2 = cross(cx, cy, dx, dy, bx, by);
  const d3 = cross(ax, ay, bx, by, cx, cy);
  const d4 = cross(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * A name laid out in lines no wider than [maxWidth], broken only at its spaces - never inside a word, which is how a
 * 3'4" hall's name read "Ro / o / m / 3" - by [measure] (a line's width at the size being tried). Null when a word on
 * its own is wider than [maxWidth]: the name does not fit that width at that size.
 */
export function wrapAtSpaces(name: string, maxWidth: number, measure: (line: string) => number): { lines: string[]; width: number } | null {
  const words = name.split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return { lines: [""], width: 0 };
  const whole = measure(words.join(" "));
  if (whole <= maxWidth) return { lines: [words.join(" ")], width: whole };
  const lines: string[] = [];
  let width = 0;
  let line = "";
  for (const word of words) {
    if (measure(word) > maxWidth) return null;
    const next = line === "" ? word : `${line} ${word}`;
    if (line !== "" && measure(next) > maxWidth) {
      lines.push(line);
      width = Math.max(width, measure(line));
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  width = Math.max(width, measure(line));
  return { lines, width };
}
