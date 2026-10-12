import {
  type AirMoverInput,
  type AirMoverResult,
  type DehumidifierResult,
  type EquipmentSettings,
  WALL_BASE_FEET,
  airMovers,
  dehumidifiers,
} from "./equipment";

/**
 * A drying plan: how many air movers and dehumidifiers a set of wet rooms needs, and where they go.
 *
 * ── The counts are not worked out here ───────────────────────────────────────────────────────────
 * They are `airMovers` and `dehumidifiers` from lib/equipment.ts, the two functions the sketch's
 * equipment panel runs, fed the same figures. A room carries its wet areas in exactly the shape
 * `airMovers` takes them (`DryingRoom.wet`), so nothing here can sum an area a different way and
 * drift a count from the panel's. The public calculator, the sketch panel and whatever Scan's
 * moisture maps drive later all agree by construction, and test/drying holds them to it.
 *
 * ── What this adds ───────────────────────────────────────────────────────────────────────────────
 * A room described by plain geometry instead of by the sketch's types: an outline in feet, its
 * doorways, and the stretches of wall that are wet. A rectangle typed into the calculator
 * (`rectangleRoom`) and a room drawn or scanned on a claim (lib/dryingPlanSketch.ts) both come down
 * to it. And the LAYOUT: a spot and a heading for every air mover, a spot for every dehumidifier.
 *
 * Feet throughout, on the sketch's own axes: x to the right, y DOWN, angles in degrees clockwise from
 * +x. A spot multiplied by PIXELS_PER_FOOT lands on the sketch, and a heading is a Konva rotation.
 *
 * ── The layout is a first placement, not the standard ────────────────────────────────────────────
 * S500 says how MANY. Where they stand is practice, and these are the common rules of it written
 * down: movers a foot off the wet walls, aimed into them at an angle and all chasing each other the
 * same way round the room; dehumidifiers out in the middle, clear of the doorways. The tech on site
 * moves them. The distances are named constants below so a rule the field disagrees with is one edit.
 */

/* ── Layout rules ──────────────────────────────────────────────────────────────────────────────── */

/** How far a mover's centre stands off the wall it is drying. */
export const MOVER_OFF_WALL_FEET = 1;
/** How far a mover is turned in towards its wall from running along it. */
export const MOVER_AIM_DEG = 45;
/** The closest two movers are set along one wall, nose to tail. */
export const MOVER_SPACING_FEET = 3;
/** No mover in the last stretch of a wall before a corner: it would be blowing into the next wall. */
export const CORNER_CLEARANCE_FEET = 1.5;
/** Kept clear either side of a doorway, so nobody trips over a cord walking through it. */
export const DOORWAY_MARGIN_FEET = 0.5;
/** A dehumidifier wants air all round it. */
export const DEHU_WALL_CLEARANCE_FEET = 2;
/** And stands out of the way of anyone coming through a door. */
export const DEHU_DOOR_CLEARANCE_FEET = 4;
/** Two dehumidifiers in one room are spread out, not stood side by side. */
export const DEHU_SEPARATION_FEET = 4;

/* ── The room ──────────────────────────────────────────────────────────────────────────────────── */

export interface PlanPoint {
  x: number;
  y: number;
}

/**
 * A stretch of one wall. Wall `wall` runs from `outline[wall]` to the next corner, the way the
 * sketch numbers its walls, and the stretch is measured in feet from that wall's start corner.
 */
export interface WallStretch {
  wall: number;
  fromFeet: number;
  toFeet: number;
}

export interface DryingRoom {
  id: string;
  name: string;
  /** The room's corners, in feet. Either winding. */
  outline: PlanPoint[];
  /** Doorways and open sides: no mover stands in one and no dehumidifier near one. */
  openings: WallStretch[];
  /** Where the walls are wet: the movers go along these first. Layout only — the area is in `wet`. */
  wetWalls: WallStretch[];
  /**
   * The floor area the dehumidifier volume is sized on. The caller's own figure rather than the
   * outline's area worked out again here, so a room off the sketch is sized on the very number the
   * sketch panel uses: an area recomputed a different way can differ in the last bit, and a count
   * that rounds up can tip on that.
   */
  floorSquareFeet: number;
  ceilingHeightFeet: number;
  /** What `airMovers` counts from, exactly as it takes it. */
  wet: AirMoverInput;
}

/**
 * Whether there is anything in this room to dry: something wet, or an inset to cover. A wall wet only
 * below 2 ft counts as wet here though it adds nothing to the wall area — the room still gets its base
 * mover, as a sketch room with a reading on it does.
 */
export function hasWetArea(room: DryingRoom): boolean {
  return (
    room.wetWalls.length > 0 ||
    room.wet.affectedFloorSquareFeet > 0 ||
    room.wet.affectedUpperSquareFeet > 0 ||
    room.wet.insetsAndOffsetsOver18Inches > 0
  );
}

export interface RectangleRoomInput {
  id: string;
  name: string;
  /** Along the top and bottom walls. */
  lengthFeet: number;
  /** Along the left and right walls. */
  widthFeet: number;
  heightFeet: number;
  /** Top, right, bottom, left: the order the outline's walls run in. */
  wetWalls: readonly [boolean, boolean, boolean, boolean];
  /** How far up the wet walls the water has wicked. */
  wetHeightFeet: number;
  /** Share of the floor that is wet, 0 to 1. */
  wetFloorShare: number;
  /** Share of the ceiling that is wet, 0 to 1. */
  wetCeilingShare: number;
  insetsOver18Inches: number;
}

/**
 * A plain rectangular room, as the calculator takes one: length by width by height, which walls are
 * wet and how high, and how much of the floor and ceiling.
 *
 * Wall area is each wet wall's length times how far it is wet ABOVE 2 ft, plus the wet ceiling: the
 * same sum the sketch makes from its moisture readings (`affectedUpperSquareFeet`), so a room typed in
 * here and the same room marked up on a sketch come out with the same air movers. A wall wet to 2 ft
 * or less adds no area, but it is still a wet wall, and the movers still go along it first.
 */
export function rectangleRoom(input: RectangleRoomInput): DryingRoom {
  const length = Math.max(0, input.lengthFeet);
  const width = Math.max(0, input.widthFeet);
  const floor = length * width;
  const wallLengths = [length, width, length, width];
  const wetWalls: WallStretch[] = [];
  let wallArea = 0;
  input.wetWalls.forEach((wet, wall) => {
    const run = wallLengths[wall] ?? 0;
    if (!wet || run <= 0 || !(input.wetHeightFeet > 0)) return;
    wetWalls.push({ wall, fromFeet: 0, toFeet: run });
    wallArea += run * Math.max(0, input.wetHeightFeet - WALL_BASE_FEET);
  });
  return {
    id: input.id,
    name: input.name.trim() || "Unnamed room",
    // Clockwise on screen, from the top-left corner: top, right, bottom, left.
    outline: [
      { x: 0, y: 0 },
      { x: length, y: 0 },
      { x: length, y: width },
      { x: 0, y: width },
    ],
    openings: [],
    wetWalls,
    floorSquareFeet: floor,
    ceilingHeightFeet: Math.max(0, input.heightFeet),
    wet: {
      affectedFloorSquareFeet: floor * clampShare(input.wetFloorShare),
      affectedUpperSquareFeet: wallArea + floor * clampShare(input.wetCeilingShare),
      insetsAndOffsetsOver18Inches: Math.max(0, input.insetsOver18Inches),
    },
  };
}

function clampShare(share: number): number {
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
}

/* ── The plan ──────────────────────────────────────────────────────────────────────────────────── */

export interface AirMoverSpot {
  x: number;
  y: number;
  /** The way the air leaves it. */
  headingDeg: number;
  /** The wall it is drying. */
  wall: number;
}

export interface DehumidifierSpot {
  x: number;
  y: number;
  /** Along the room's long side. */
  headingDeg: number;
}

export interface RoomDryingPlan {
  roomId: string;
  roomName: string;
  cubicFeet: number;
  airMovers: AirMoverResult;
  airMoverSpots: AirMoverSpot[];
  /**
   * Movers the walls had no room for at `MOVER_SPACING_FEET`. They belong out on the open floor,
   * which this does not try to arrange: said, rather than crammed nose to nose along a wall.
   */
  airMoversUnplaced: number;
  /** This room's share of the job's dehumidifiers — see `shareByVolume`. Zero for desiccants. */
  dehumidifierUnits: number;
  dehumidifierSpots: DehumidifierSpot[];
}

export interface DryingPlan {
  rooms: RoomDryingPlan[];
  totalAirMovers: number;
  /** Sized once over every room's volume, as `claimEquipment` does: the air moves between them. */
  dehumidifiers: DehumidifierResult;
  /**
   * False for desiccants. The sizes offered are trailer and large portable units that stand
   * outside and are ducted in, so no room gets a spot for one.
   */
  dehumidifiersPlaced: boolean;
}

/**
 * Every room it is given is planned. Which rooms are being dried is the caller's call: the sketch
 * takes the rooms with anything marked on them, as `claimEquipment` does, the calculator the rooms
 * with anything ticked wet (`hasWetArea`).
 */
export function dryingPlan(rooms: DryingRoom[], settings: EquipmentSettings): DryingPlan {
  const volumes = rooms.map((room) => room.floorSquareFeet * room.ceilingHeightFeet);
  const dehu = dehumidifiers(
    volumes.reduce((sum, v) => sum + v, 0),
    settings.waterClass,
    settings.dehumidifierType,
    settings.dehumidifierSize,
  );
  const placed = settings.dehumidifierType === "lgr";
  const shares = placed ? shareByVolume(volumes, dehu.units) : rooms.map(() => 0);

  const planned = rooms.map((room, i): RoomDryingPlan => {
    const walls = outlineWalls(room.outline);
    const count = airMovers(room.wet);
    const movers = placeAirMovers(room, walls, count.units);
    const units = shares[i] ?? 0;
    return {
      roomId: room.id,
      roomName: room.name,
      cubicFeet: volumes[i] ?? 0,
      airMovers: count,
      airMoverSpots: movers.spots,
      airMoversUnplaced: movers.unplaced,
      dehumidifierUnits: units,
      dehumidifierSpots: placeDehumidifiers(room, walls, units),
    };
  });

  return {
    rooms: planned,
    totalAirMovers: planned.reduce((sum, r) => sum + r.airMovers.units, 0),
    dehumidifiers: dehu,
    dehumidifiersPlaced: placed,
  };
}

/**
 * The job's dehumidifiers dealt out to its rooms by volume, largest remainder first.
 *
 * The total is sized once over the whole volume and must stay that total: giving each room its own
 * rounded-up count would buy a machine for every doorway, which is the mistake `claimEquipment`
 * exists to avoid. So the biggest rooms get them, and a small room beside a big one may get none —
 * its air is dried through the doorway. Ties go to the bigger room, then the earlier one.
 */
export function shareByVolume(volumes: number[], total: number): number[] {
  const sum = volumes.reduce((s, v) => s + Math.max(0, v), 0);
  if (sum <= 0 || total <= 0) return volumes.map(() => 0);
  const exact = volumes.map((v) => (Math.max(0, v) / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e), volume: volumes[i] ?? 0 }))
    .sort((a, b) => b.rest - a.rest || b.volume - a.volume || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/* ── Geometry ──────────────────────────────────────────────────────────────────────────────────── */

interface PlanWall {
  index: number;
  a: PlanPoint;
  b: PlanPoint;
  length: number;
  /** Unit vector from `a` to `b`. */
  dir: PlanPoint;
  /** Unit vector into the room. */
  inward: PlanPoint;
  /** Unit vector along the wall the way the air goes round: clockwise on screen, whatever the winding. */
  flow: PlanPoint;
}

/** Twice the signed area. Positive when the outline runs clockwise on screen (y down). */
function signedArea2(outline: PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i] as PlanPoint;
    const b = outline[(i + 1) % outline.length] as PlanPoint;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function outlineWalls(outline: PlanPoint[]): PlanWall[] {
  const turn = signedArea2(outline) < 0 ? -1 : 1;
  return outline.map((a, index) => {
    const b = outline[(index + 1) % outline.length] as PlanPoint;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    const dir = length > 0 ? { x: dx / length, y: dy / length } : { x: 0, y: 0 };
    return {
      index,
      a,
      b,
      length,
      dir,
      // For a clockwise outline the room is on the wall's right-hand side as drawn on screen.
      inward: { x: -dir.y * turn, y: dir.x * turn },
      flow: { x: dir.x * turn, y: dir.y * turn },
    };
  });
}

function pointInOutline(outline: PlanPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i] as PlanPoint;
    const b = outline[j] as PlanPoint;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: PlanPoint, a: PlanPoint, b: PlanPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const lenSq = vx * vx + vy * vy;
  const t = lenSq > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lenSq)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

function pointAlong(wall: PlanWall, feet: number): PlanPoint {
  return { x: wall.a.x + wall.dir.x * feet, y: wall.a.y + wall.dir.y * feet };
}

function headingOf(v: PlanPoint): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

/** The area centroid; the middle of the corners for an outline with no area. */
function centroid(outline: PlanPoint[]): PlanPoint {
  const a2 = signedArea2(outline);
  if (Math.abs(a2) < 1e-9) {
    const n = Math.max(1, outline.length);
    return { x: outline.reduce((s, p) => s + p.x, 0) / n, y: outline.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i] as PlanPoint;
    const q = outline[(i + 1) % outline.length] as PlanPoint;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}

/* ── Stretches of wall, as [from, to] pairs in feet ───────────────────────────────────────────── */

type Span = [number, number];

function unionSpans(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function subtractSpans(from: Span[], cut: Span[]): Span[] {
  let out = from;
  for (const [ca, cb] of unionSpans(cut)) {
    out = out.flatMap(([a, b]): Span[] => {
      if (cb <= a || ca >= b) return [[a, b]];
      const keep: Span[] = [];
      if (ca > a) keep.push([a, ca]);
      if (cb < b) keep.push([cb, b]);
      return keep;
    });
  }
  return out.filter(([a, b]) => b - a > 1e-6);
}

function intersectSpans(from: Span[], within: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of from) {
    for (const [c, d] of unionSpans(within)) {
      const lo = Math.max(a, c);
      const hi = Math.min(b, d);
      if (hi - lo > 1e-6) out.push([lo, hi]);
    }
  }
  return out;
}

/* ── Air movers ────────────────────────────────────────────────────────────────────────────────── */

interface Run {
  wall: PlanWall;
  from: number;
  to: number;
}

/** The stretches of wall a mover may stand against, split into wet and dry. */
function moverRuns(room: DryingRoom, walls: PlanWall[]): { wet: Run[]; dry: Run[] } {
  const wet: Run[] = [];
  const dry: Run[] = [];
  for (const wall of walls) {
    if (wall.length <= 2 * CORNER_CLEARANCE_FEET) continue;
    const blocked = room.openings
      .filter((o) => o.wall === wall.index)
      .map((o): Span => [o.fromFeet - DOORWAY_MARGIN_FEET, o.toFeet + DOORWAY_MARGIN_FEET]);
    const free = subtractSpans([[CORNER_CLEARANCE_FEET, wall.length - CORNER_CLEARANCE_FEET]], blocked);
    const wetHere = room.wetWalls
      .filter((s) => s.wall === wall.index)
      .map((s): Span => [Math.max(0, s.fromFeet), Math.min(wall.length, s.toFeet)]);
    for (const [from, to] of intersectSpans(free, wetHere)) wet.push({ wall, from, to });
    for (const [from, to] of subtractSpans(free, wetHere)) dry.push({ wall, from, to });
  }
  return { wet, dry };
}

/** How many movers a run takes at `MOVER_SPACING_FEET`. A short run between a door and a corner still takes one. */
function runCapacity(run: Run): number {
  return Math.max(1, Math.floor((run.to - run.from) / MOVER_SPACING_FEET + 1e-9));
}

/**
 * Movers dealt to runs one at a time, each to the run where it leaves the widest spacing. That keeps
 * them evenly spread along the walls whatever the count — one mover goes on the longest wall, four on
 * a square room go one to a wall — and the result does not depend on the order the walls are listed.
 */
function dealMovers(runs: Run[], units: number): { counts: number[]; left: number } {
  const counts = runs.map(() => 0);
  let left = units;
  while (left > 0) {
    let best = -1;
    let bestGap = -Infinity;
    runs.forEach((run, i) => {
      const n = counts[i] ?? 0;
      if (n >= runCapacity(run)) return;
      const gap = (run.to - run.from) / (n + 1);
      if (gap > bestGap + 1e-9) {
        best = i;
        bestGap = gap;
      }
    });
    if (best < 0) break;
    counts[best] = (counts[best] ?? 0) + 1;
    left -= 1;
  }
  return { counts, left };
}

/**
 * Along the wet walls first, evenly spaced, a foot off the wall and aimed into it; then, once the wet
 * walls are full, along the dry ones; and any left over are reported, not placed. A room wet only on
 * the floor has no wet walls, so its movers ring the whole room.
 */
function placeAirMovers(room: DryingRoom, walls: PlanWall[], units: number): { spots: AirMoverSpot[]; unplaced: number } {
  const runs = moverRuns(room, walls);
  const onWet = dealMovers(runs.wet, units);
  const onDry = dealMovers(runs.dry, onWet.left);
  const aim = (MOVER_AIM_DEG * Math.PI) / 180;

  const spots: AirMoverSpot[] = [];
  let unplaced = onDry.left;
  const lay = (list: Run[], counts: number[]) =>
    list.forEach((run, i) => {
      const n = counts[i] ?? 0;
      const { wall } = run;
      for (let k = 0; k < n; k++) {
        const along = run.from + ((k + 0.5) * (run.to - run.from)) / n;
        const onWall = pointAlong(wall, along);
        const spot = { x: onWall.x + wall.inward.x * MOVER_OFF_WALL_FEET, y: onWall.y + wall.inward.y * MOVER_OFF_WALL_FEET };
        // A corridor narrower than the offset, or an outline that crosses itself: no spot, and said so.
        if (!pointInOutline(room.outline, spot.x, spot.y)) {
          unplaced += 1;
          continue;
        }
        const heading = {
          x: wall.flow.x * Math.cos(aim) - wall.inward.x * Math.sin(aim),
          y: wall.flow.y * Math.cos(aim) - wall.inward.y * Math.sin(aim),
        };
        spots.push({ ...spot, headingDeg: headingOf(heading), wall: wall.index });
      }
    });
  lay(runs.wet, onWet.counts);
  lay(runs.dry, onDry.counts);
  spots.sort((p, q) => p.wall - q.wall);
  return { spots, unplaced };
}

/* ── Dehumidifiers ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Out in the room, clear of the walls and the doorways, as near the middle as that allows.
 *
 * The middle is the outline's centroid for one unit; two or more are spread along the room's long
 * side. Each takes the nearest free point on a grid over the room, and the clearances relax a step
 * at a time when the room is too small to honour them — a dehumidifier in a closet still goes in
 * the closet. The centroid of an L can fall outside it; the grid only ever offers points inside.
 */
function placeDehumidifiers(room: DryingRoom, walls: PlanWall[], units: number): DehumidifierSpot[] {
  if (units <= 0 || room.outline.length < 3) return [];
  const xs = room.outline.map((p) => p.x);
  const ys = room.outline.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const along = maxX - minX >= maxY - minY;
  const middle = centroid(room.outline);
  const targets: PlanPoint[] = Array.from({ length: units }, (_, i) => {
    if (units === 1) return middle;
    const t = (i + 0.5) / units;
    return along ? { x: minX + (maxX - minX) * t, y: middle.y } : { x: middle.x, y: minY + (maxY - minY) * t };
  });

  // Half a foot, coarsened on a very big floor so the search stays around forty thousand points.
  const grid = Math.max(0.5, Math.sqrt(((maxX - minX) * (maxY - minY)) / 40000));
  const openings = room.openings.flatMap((o) => {
    const wall = walls[o.wall];
    return wall ? [{ a: pointAlong(wall, Math.max(0, o.fromFeet)), b: pointAlong(wall, Math.min(wall.length, o.toFeet)) }] : [];
  });
  const candidates: { p: PlanPoint; wallGap: number; doorGap: number }[] = [];
  const offer = (p: PlanPoint) => {
    if (!pointInOutline(room.outline, p.x, p.y)) return;
    const wallGap = Math.min(...walls.map((w) => distanceToSegment(p, w.a, w.b)));
    const doorGap = openings.length ? Math.min(...openings.map((o) => distanceToSegment(p, o.a, o.b))) : Infinity;
    candidates.push({ p, wallGap, doorGap });
  };
  // The targets themselves first, so a room with nothing in the way gets its unit dead centre.
  targets.forEach(offer);
  for (let x = minX + grid / 2; x < maxX; x += grid) {
    for (let y = minY + grid / 2; y < maxY; y += grid) offer({ x, y });
  }

  const tiers = [
    { wall: DEHU_WALL_CLEARANCE_FEET, door: DEHU_DOOR_CLEARANCE_FEET, apart: DEHU_SEPARATION_FEET },
    { wall: DEHU_WALL_CLEARANCE_FEET / 2, door: DEHU_DOOR_CLEARANCE_FEET / 2, apart: DEHU_SEPARATION_FEET / 2 },
    { wall: 0, door: 0, apart: 0 },
  ];
  const chosen: PlanPoint[] = [];
  for (const target of targets) {
    let pick: PlanPoint | null = null;
    for (const tier of tiers) {
      let best = Infinity;
      for (const c of candidates) {
        if (c.wallGap < tier.wall || c.doorGap < tier.door) continue;
        if (chosen.some((q) => Math.hypot(q.x - c.p.x, q.y - c.p.y) < tier.apart)) continue;
        const d = Math.hypot(c.p.x - target.x, c.p.y - target.y);
        if (d < best) {
          best = d;
          pick = c.p;
        }
      }
      if (pick) break;
    }
    chosen.push(pick ?? middle);
  }
  const headingDeg = along ? 0 : 90;
  return chosen.map((p) => ({ x: p.x, y: p.y, headingDeg }));
}
