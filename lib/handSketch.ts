/**
 * A photo of a hand-drawn sketch, turned into Scrivn rooms at their real size (2026-11-05).
 *
 * Two halves. A READ of the photo says only what is on the paper: the corners in order round each
 * room, the number written against each wall as it was written, the door and window marks, the
 * fixtures, a ceiling height if one is written. It is made by a model looking at the photo, and it
 * guesses nothing it cannot see — where it is unsure (a door drawn at a corner could be on either
 * wall; a wall drawn over heavily may be a door) it says so.
 *
 * The BUILD here turns a read into rooms, and is plain arithmetic so it can be tested. A hand
 * drawing is never to scale, so its proportions are the weakest thing in it: the written numbers
 * set the sizes, the drawing only says which way each wall runs and how the corners join.
 *  - A wall drawn near level or plumb is square, and its written length stands exactly.
 *  - An angled wall takes whatever closes the room — so a written diagonal that disagrees with
 *    the walls round it is reported, not used to bend them.
 *  - A wall with no number takes its length from the walls round it when they settle it (the
 *    opposite wall of a rectangle), and only otherwise from the drawing's proportions, flagged.
 *  - Rooms drawn against each other share the corners they meet at, so a closet behind a room
 *    gets its size from the room.
 * Everything not written — a door's width, a vanity's size — comes from a standard size or the
 * drawing, and is listed as a question rather than passed off as measured.
 */
import {
  DEFAULT_CEILING_HEIGHT_FEET,
  FIXTURE_DEFAULT_FEET,
  FIXTURE_DEFAULT_HEIGHT_FEET,
  newSketchId,
  type CabinetSymbol,
  type DoorSymbol,
  type FixtureSymbol,
  type FixtureType,
  type SketchRoom,
  type SketchSymbol,
  type WindowSymbol,
} from "./sketch";
import { roomFromPoints } from "./sketchWalls";

/* ── The read ──────────────────────────────────────────────────────────────────────────────── */

export interface DrawnPoint {
  x: number;
  y: number;
}

export type DrawnOpeningKind = "door" | "window" | "opening" | "bifold" | "sliding" | "pocket";

export interface DrawnOpening {
  kind: DrawnOpeningKind;
  /** The wall it is on: an index into the room's walls. */
  wall: number;
  /** Its centre, 0 to 1 along the drawn wall from the wall's first corner. */
  at: number;
  /** Its size as written ("2'8", "5'9 x 2'9"), or null. */
  size: string | null;
  /** Another wall the mark could equally be on, as a door drawn at a corner can. */
  orWall?: number | null;
  /** False when it may not be an opening at all: a wall drawn over heavily, a scribble. */
  sure: boolean;
  note?: string;
}

export type DrawnItemKind = "vanity" | "toilet" | "tub" | "shower" | "sink" | "cabinet" | "fridge" | "range" | "furnace" | "waterHeater";

export interface DrawnItem {
  kind: DrawnItemKind;
  /** The word written on it, or null. */
  label: string | null;
  /** The wall it stands against. */
  wall: number;
  /** Where it starts and ends, 0 to 1 along the drawn wall. */
  from: number;
  to: number;
  /** How far it is drawn out from the wall, in the photo's pixels. */
  depth: number;
  /** Its size as written ("36", "3' x 21"), or null. */
  size: string | null;
}

export type DrawnRoomGuess = "bedroom" | "bathroom" | "closet" | "kitchen" | "living" | "hall" | "laundry" | "utility" | "office" | "room";

export interface DrawnRoom {
  /** The name written in it, or null. */
  name: string | null;
  /** What the drawing suggests it is, for asking its name. */
  guess: DrawnRoomGuess | null;
  /** The outline as drawn, corner by corner round the room, in the upright photo's pixels. */
  corners: DrawnPoint[];
  /** walls[i] runs from corners[i] to corners[i + 1]: the number written against it, as written, or null. */
  walls: { length: string | null }[];
  /** The ceiling height as written, or null. */
  ceiling: string | null;
  openings: DrawnOpening[];
  items: DrawnItem[];
}

export interface HandSketchRead {
  version: 1;
  kind: "hand" | "blueprint";
  /** Quarter turns clockwise that make the writing upright; the corners are in that upright frame. */
  rotate: 0 | 90 | 180 | 270;
  rooms: DrawnRoom[];
  /** Writing read but not used: crossed out, unreadable, or not about the rooms. */
  ignored: string[];
}

/* ── Lengths as written ─────────────────────────────────────────────────────────────────────── */

/**
 * Inches from a length as written: 14'3, 14'3", 14' 3", 14'-3", 4'11, 8'5-C, 16', 144 1/2", 374",
 * 2.4m. Null when nothing in it reads as a length — a bare number is not taken, since 12 could be
 * feet or inches.
 */
export function parseLength(text: string | null | undefined): number | null {
  if (!text) return null;
  const s = text.replace(/[’′]/g, "'").replace(/[”″]/g, '"').trim();
  const feet = s.match(/(\d+(?:\.\d+)?)\s*(?:'|ft\b|feet\b)\s*-?\s*(\d+(?:\.\d+)?)?(?:\s+(\d+)\s*\/\s*(\d+))?/i);
  if (feet) {
    const f = Number(feet[1]);
    const i = feet[2] ? Number(feet[2]) : 0;
    const frac = feet[3] && feet[4] ? Number(feet[3]) / Number(feet[4]) : 0;
    return f * 12 + i + frac;
  }
  const inches = s.match(/(\d+(?:\.\d+)?)(?:\s+(\d+)\s*\/\s*(\d+))?\s*(?:"|in\b|inches\b)/i);
  if (inches) return Number(inches[1]) + (inches[2] && inches[3] ? Number(inches[2]) / Number(inches[3]) : 0);
  const metres = s.match(/(\d+(?:\.\d+)?)\s*m\b/i);
  if (metres) return Number(metres[1]) / 0.0254;
  const cm = s.match(/(\d+(?:\.\d+)?)\s*cm\b/i);
  if (cm) return Number(cm[1]) / 2.54;
  return null;
}

/** Two lengths written as a size — "5'9 x 2'9", "36 by 21" — as [first, second] inches; either may be null. */
export function parseSize(text: string | null | undefined): [number | null, number | null] {
  if (!text) return [null, null];
  const parts = text.split(/\s*(?:x|×|by)\s*/i);
  if (parts.length >= 2) return [parseLength(parts[0]), parseLength(parts[1])];
  return [parseLength(text), null];
}

/** 4'11" from 59. */
export function feetInches(inches: number): string {
  const total = Math.round(inches);
  const f = Math.floor(total / 12);
  const i = total - f * 12;
  return i === 0 ? `${f}'` : `${f}'${i}"`;
}

/* ── Solving the outline ────────────────────────────────────────────────────────────────────── */

/** A wall drawn within this much of level or plumb is taken as square. */
const SQUARE_WITHIN_DEG = 15;
/** Corners of different rooms drawn this close (a share of the drawing's size) are the same corner. */
const SAME_CORNER = 0.035;

export type WallSource =
  /** The written number, as written. */
  | "written"
  /** Written, but the walls round it close the room at another length, which is used. */
  | "written-differs"
  /** Not written; the walls round it settle it. */
  | "closed"
  /** Not written and not settled: the drawing's proportions. Worth a tape. */
  | "drawing";

export interface SolvedWall {
  room: number;
  wall: number;
  written: number | null;
  inches: number;
  source: WallSource;
}

interface Row {
  coeffs: Map<number, number>;
  rhs: number;
  sigma: number;
}

/** The corners every room's outline uses, merged where rooms meet. */
interface CornerGraph {
  points: DrawnPoint[];
  /** roomCorner[r][i] is the merged point room r's corner i became. */
  roomCorner: number[][];
}

function rotateAll(read: HandSketchRead): DrawnPoint[][] {
  // The drawing as a whole may sit at a slant on the photo: the median slant of the walls that are
  // nearly square, weighted by how long they are drawn, is taken out first.
  const offsets: { off: number; w: number }[] = [];
  for (const room of read.rooms) {
    room.corners.forEach((a, i) => {
      const b = room.corners[(i + 1) % room.corners.length] as DrawnPoint;
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const quarter = Math.PI / 2;
      let off = ang - Math.round(ang / quarter) * quarter;
      if (Math.abs(off) <= (SQUARE_WITHIN_DEG * Math.PI) / 180) offsets.push({ off, w: Math.hypot(b.x - a.x, b.y - a.y) });
    });
  }
  offsets.sort((p, q) => p.off - q.off);
  const total = offsets.reduce((s, o) => s + o.w, 0);
  let acc = 0;
  let tilt = 0;
  for (const o of offsets) {
    acc += o.w;
    if (acc >= total / 2) {
      tilt = o.off;
      break;
    }
  }
  const c = Math.cos(-tilt);
  const s = Math.sin(-tilt);
  return read.rooms.map((room) => room.corners.map((p) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })));
}

function cornerGraph(rooms: DrawnPoint[][]): CornerGraph {
  const all = rooms.flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const tol = SAME_CORNER * size;
  const points: DrawnPoint[] = [];
  const counts: number[] = [];
  const roomCorner = rooms.map((corners) =>
    corners.map((p) => {
      const near = points.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= tol);
      if (near >= 0) {
        // Merged corners sit at their average, so no one room's hand wobble wins.
        const n = (counts[near] as number) + 1;
        const q = points[near] as DrawnPoint;
        points[near] = { x: q.x + (p.x - q.x) / n, y: q.y + (p.y - q.y) / n };
        counts[near] = n;
        return near;
      }
      points.push({ ...p });
      counts.push(1);
      return points.length - 1;
    }),
  );
  return { points, roomCorner };
}

/** Solves A x ≈ b, weighted by 1/sigma², for the unknowns: the normal equations by elimination. */
function leastSquares(rows: Row[], n: number): { x: number[]; normal: number[][] } {
  const N = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const v = new Array<number>(n).fill(0);
  for (const row of rows) {
    const w = 1 / (row.sigma * row.sigma);
    for (const [i, ai] of row.coeffs) {
      v[i] = (v[i] as number) + w * ai * row.rhs;
      const Ni = N[i] as number[];
      for (const [j, aj] of row.coeffs) Ni[j] = (Ni[j] as number) + w * ai * aj;
    }
  }
  return { x: solveLinear(N.map((r) => [...r]), [...v]), normal: N };
}

function solveLinear(M: number[][], v: number[]): number[] {
  const n = v.length;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((M[r] as number[])[c] as number) > Math.abs((M[pivot] as number[])[c] as number)) pivot = r;
    [M[c], M[pivot]] = [M[pivot] as number[], M[c] as number[]];
    [v[c], v[pivot]] = [v[pivot] as number, v[c] as number];
    const Mc = M[c] as number[];
    const d = Mc[c] as number;
    if (Math.abs(d) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const Mr = M[r] as number[];
      const f = (Mr[c] as number) / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) Mr[k] = (Mr[k] as number) - f * (Mc[k] as number);
      v[r] = (v[r] as number) - f * (v[c] as number);
    }
  }
  return v.map((vi, i) => {
    const d = (M[i] as number[])[i] as number;
    return Math.abs(d) < 1e-12 ? 0 : vi / d;
  });
}

export interface SolvedOutline {
  /** Each room's corners, in inches, in drawing order. */
  rooms: DrawnPoint[][];
  walls: SolvedWall[];
  /** Inches per drawn pixel, from the written walls. */
  scale: number;
}

/**
 * Every room's corners at their real size, in inches, with each wall's length and where it came
 * from. The corners of all rooms are solved together, so rooms meet where they are drawn to.
 */
export function solveOutline(read: HandSketchRead): SolvedOutline {
  const drawn = rotateAll(read);
  const graph = cornerGraph(drawn);

  // Inches per drawn pixel: the median over the written walls. Only the unwritten walls use it.
  const ratios: number[] = [];
  read.rooms.forEach((room, r) =>
    room.walls.forEach((wall, i) => {
      const W = parseLength(wall.length);
      if (W === null) return;
      const a = (drawn[r] as DrawnPoint[])[i] as DrawnPoint;
      const b = (drawn[r] as DrawnPoint[])[(i + 1) % room.corners.length] as DrawnPoint;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 0) ratios.push(W / d);
    }),
  );
  ratios.sort((p, q) => p - q);
  const scale = ratios.length ? (ratios[Math.floor(ratios.length / 2)] as number) : 1;

  const K = graph.points.length;
  const X = (k: number) => 2 * k;
  const Y = (k: number) => 2 * k + 1;
  const rows: Row[] = [];
  const add = (coeffs: [number, number][], rhs: number, sigma: number) => rows.push({ coeffs: new Map(coeffs), rhs, sigma });
  add([[X(0), 1]], 0, 1e-3);
  add([[Y(0), 1]], 0, 1e-3);

  type WallEq = { room: number; wall: number; a: number; b: number; ux: number; uy: number; axis: boolean; written: number | null };
  const eqs: WallEq[] = [];
  read.rooms.forEach((room, r) => {
    const n = room.corners.length;
    for (let i = 0; i < n; i++) {
      const a = (graph.roomCorner[r] as number[])[i] as number;
      const b = (graph.roomCorner[r] as number[])[(i + 1) % n] as number;
      const pa = (drawn[r] as DrawnPoint[])[i] as DrawnPoint;
      const pb = (drawn[r] as DrawnPoint[])[(i + 1) % n] as DrawnPoint;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const len = Math.hypot(dx, dy);
      const ang = Math.abs(((Math.atan2(dy, dx) * 180) / Math.PI) % 90);
      const axis = Math.min(ang, 90 - ang) <= SQUARE_WITHIN_DEG;
      const written = parseLength((room.walls[i] ?? { length: null }).length);
      eqs.push({ room: r, wall: i, a, b, ux: len ? dx / len : 1, uy: len ? dy / len : 0, axis, written });
      if (a === b || len === 0) continue;
      const prior = Math.max(3, 0.3 * scale * len);
      if (axis) {
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const along = horizontal ? X : Y;
        const across = horizontal ? Y : X;
        const sign = Math.sign(horizontal ? dx : dy) || 1;
        // Square: the far corner is level (or plumb) with the near one.
        add([[across(b), 1], [across(a), -1]], 0, 0.01);
        // A written length stands; an unwritten one leans, weakly, on the drawing.
        if (written !== null) add([[along(b), 1], [along(a), -1]], sign * written, 0.05);
        else add([[along(b), 1], [along(a), -1]], sign * scale * len, prior);
      } else {
        const ux = dx / len;
        const uy = dy / len;
        if (written !== null) {
          // An angled wall's written length is a check on it rather than a hold: it gives way to
          // the square walls round it, and how far it gave is reported.
          add([[X(b), ux], [X(a), -ux], [Y(b), uy], [Y(a), -uy]], written, 1);
          add([[X(b), -uy], [X(a), uy], [Y(b), ux], [Y(a), -ux]], 0, 0.35 * written);
        } else {
          add([[X(b), 1], [X(a), -1]], scale * dx, prior);
          add([[Y(b), 1], [Y(a), -1]], scale * dy, prior);
        }
      }
    }
  });

  const { x, normal } = leastSquares(rows, 2 * K);
  const pt = (k: number): DrawnPoint => ({ x: x[X(k)] as number, y: x[Y(k)] as number });

  // How firmly each wall's length is settled, from the solve's own uncertainty: a wall the walls
  // round it pin down has a small spread whatever the drawing says; one only the drawing places has
  // the drawing's large one.
  const spreadOf = (a: number, b: number): number => {
    const pa = pt(a);
    const pb = pt(b);
    const L = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const g = new Array<number>(2 * K).fill(0);
    g[X(b)] = (pb.x - pa.x) / L;
    g[Y(b)] = (pb.y - pa.y) / L;
    g[X(a)] = -(pb.x - pa.x) / L;
    g[Y(a)] = -(pb.y - pa.y) / L;
    const z = solveLinear(normal.map((r) => [...r]), [...g]);
    return Math.sqrt(Math.max(0, g.reduce((s, gi, i) => s + gi * (z[i] as number), 0)));
  };

  const walls: SolvedWall[] = eqs.map((e) => {
    const pa = pt(e.a);
    const pb = pt(e.b);
    const inches = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    let source: WallSource;
    if (e.written !== null) source = Math.abs(inches - e.written) < 0.75 ? "written" : "written-differs";
    else source = spreadOf(e.a, e.b) < 1.5 ? "closed" : "drawing";
    return { room: e.room, wall: e.wall, written: e.written, inches, source };
  });

  return { rooms: graph.roomCorner.map((corners) => corners.map(pt)), walls, scale };
}

/* ── Rooms, openings and fixtures ───────────────────────────────────────────────────────────── */

export type SizeSource = "written" | "wall" | "drawing" | "standard";

export interface PlacedThing {
  room: number;
  what: string;
  /** The size it was given, for the review: "2'8\" wide". */
  size: string;
  source: SizeSource;
}

export type HandSketchQuestion =
  | { kind: "roomName"; room: number; guess: DrawnRoomGuess | null }
  | { kind: "doorWall"; room: number; opening: number; walls: [number, number] }
  | { kind: "isOpening"; room: number; opening: number; note: string }
  | { kind: "wallDiffers"; room: number; wall: number; written: number; closes: number }
  | { kind: "tapeWall"; room: number; wall: number; inches: number };

export interface HandSketchBuild {
  rooms: SketchRoom[];
  walls: SolvedWall[];
  placed: PlacedThing[];
  questions: HandSketchQuestion[];
  scale: number;
}

/** The nearest of [sizes] to [inches], when it is within [within] of it; otherwise [inches] rounded. */
function standard(inches: number, sizes: number[], within: number): number {
  let best = Math.round(inches);
  let gap = within;
  for (const s of sizes) if (Math.abs(s - inches) <= gap) [best, gap] = [s, Math.abs(s - inches)];
  return best;
}

const DOOR_WIDTHS = [24, 28, 30, 32, 34, 36];
const VANITY_WIDTHS = [18, 24, 30, 36, 42, 48, 60, 72];
const BASE_DEPTHS = [18, 21, 24];
const TUB_DEPTHS = [30, 32, 36];
/** A door standing at a corner stands this far off it: the casing's return. */
const DOOR_OFF_CORNER = 4;

const NAMES: Record<DrawnRoomGuess, string> = {
  bedroom: "Bedroom",
  bathroom: "Bathroom",
  closet: "Closet",
  kitchen: "Kitchen",
  living: "Living Room",
  hall: "Hallway",
  laundry: "Laundry",
  utility: "Utility",
  office: "Office",
  room: "Room",
};

/** The drawing as Scrivn rooms on [level], with what was placed from what, and what to ask. */
export function buildFromRead(read: HandSketchRead, level = 0): HandSketchBuild {
  const solved = solveOutline(read);
  const rooms: SketchRoom[] = [];
  const placed: PlacedThing[] = [];
  const questions: HandSketchQuestion[] = [];

  read.rooms.forEach((drawn, r) => {
    const corners = solved.rooms[r] as DrawnPoint[];
    const ceilingIn = parseLength(drawn.ceiling);
    const name = drawn.name?.trim() || (drawn.guess ? NAMES[drawn.guess] : "Room");
    if (!drawn.name?.trim()) questions.push({ kind: "roomName", room: r, guess: drawn.guess });
    const room = roomFromPoints(corners, level, name);
    if (!room) return;
    room.ceilingHeightFeet = ceilingIn !== null ? ceilingIn / 12 : DEFAULT_CEILING_HEIGHT_FEET;

    // The drawn wall i is the Scrivn wall between the same two corners, whichever way round the
    // room Scrivn winds it.
    const n = drawn.corners.length;
    const wallOf = (i: number): { wallId: string; reversed: boolean; length: number } | null => {
      const a = corners[i] as DrawnPoint;
      const b = corners[(i + 1) % n] as DrawnPoint;
      const vs = room.vertices;
      for (let j = 0; j < vs.length; j++) {
        const p = vs[j] as { id: string; x: number; y: number };
        const q = vs[(j + 1) % vs.length] as { x: number; y: number };
        const near = (u: DrawnPoint, v: { x: number; y: number }) => Math.hypot(u.x - v.x, u.y - v.y) < 0.5;
        if (near(a, p) && near(b, q)) return { wallId: p.id, reversed: false, length: Math.hypot(q.x - p.x, q.y - p.y) };
        if (near(b, p) && near(a, q)) return { wallId: p.id, reversed: true, length: Math.hypot(q.x - p.x, q.y - p.y) };
      }
      return null;
    };

    // A door into a bathroom or a closet is the narrower standard, whichever side it was drawn from.
    const narrow = (g: DrawnRoomGuess | null) => g === "bathroom" || g === "closet";
    const opensOnto = (i: number): DrawnRoomGuess | null => {
      const a = corners[i] as DrawnPoint;
      const b = corners[(i + 1) % drawn.corners.length] as DrawnPoint;
      const other = solved.rooms.findIndex((cs, k) => k !== r && cs.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 0.5) && cs.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 0.5));
      return other >= 0 ? (read.rooms[other] as DrawnRoom).guess : null;
    };
    drawn.openings.forEach((o, oi) => {
      const guessDoor = narrow(drawn.guess) || narrow(opensOnto(o.wall)) ? 30 : 32;
      if (!o.sure) {
        questions.push({ kind: "isOpening", room: r, opening: oi, note: o.note ?? "" });
      }
      if (o.orWall !== undefined && o.orWall !== null) questions.push({ kind: "doorWall", room: r, opening: oi, walls: [o.wall, o.orWall] });
      const wall = wallOf(o.wall);
      if (!wall) return;
      const [w, h] = parseSize(o.size);
      if (o.kind === "window") {
        const width = w ?? standard(0.25 * wall.length, [24, 36, 48, 60, 72], 6);
        const sym: WindowSymbol = {
          id: newSketchId("window"),
          type: "window",
          wallId: wall.wallId,
          t: wall.reversed ? 1 - o.at : o.at,
          widthFraction: Math.min(1, width / wall.length),
          widthFeet: width / 12,
          heightFeet: h !== null ? h / 12 : null,
          sillFeet: null,
        };
        room.symbols.push(sym);
        placed.push({ room: r, what: "Window", size: `${feetInches(width)}${h !== null ? ` x ${feetInches(h)}` : ""}`, source: w !== null ? "written" : "drawing" });
        return;
      }
      const width = w ?? guessDoor;
      // A door drawn at a corner stands just off it, not over it.
      let centre = o.at * wall.length;
      centre = Math.min(Math.max(centre, width / 2 + DOOR_OFF_CORNER), wall.length - width / 2 - DOOR_OFF_CORNER);
      const t = centre / wall.length;
      const sym: DoorSymbol = {
        id: newSketchId("door"),
        type: "door",
        wallId: wall.wallId,
        t: wall.reversed ? 1 - t : t,
        widthFraction: Math.min(1, width / wall.length),
        widthFeet: width / 12,
        heightFeet: 80 / 12,
        doorType: o.kind === "door" ? "swing" : o.kind,
        leaves: "single",
        flipX: false,
        flipY: false,
      };
      room.symbols.push(sym as SketchSymbol);
      placed.push({ room: r, what: "Door", size: `${feetInches(width)} wide`, source: w !== null ? "written" : "standard" });
    });

    drawn.items.forEach((item) => {
      const wall = wallOf(item.wall);
      if (!wall) return;
      const [w, d] = parseSize(item.size);
      const span = Math.max(0, Math.min(1, item.to) - Math.max(0, item.from));
      const wholeWall = span >= 0.9;
      const drawnWidth = span * wall.length;
      const drawnDepth = item.depth * solved.scale;
      const mid = (Math.max(0, item.from) + Math.min(1, item.to)) / 2;
      const t = wall.reversed ? 1 - mid : mid;
      if (item.kind === "vanity" || item.kind === "cabinet") {
        const width = w ?? (wholeWall ? wall.length : standard(drawnWidth, VANITY_WIDTHS, 4));
        const depth = d ?? standard(drawnDepth, BASE_DEPTHS, 4);
        const sym: CabinetSymbol = {
          id: newSketchId("cabinet"),
          type: "cabinet",
          wallId: wall.wallId,
          t,
          widthFraction: Math.min(1, width / wall.length),
          widthFeet: width / 12,
          label: item.kind === "vanity" ? "Vanity" : item.label?.trim() || "Cabinet",
          tier: "base",
          depthFeet: depth / 12,
          heightFeet: item.kind === "vanity" ? 32 / 12 : 3,
        };
        room.symbols.push(sym);
        placed.push({ room: r, what: sym.label, size: `${feetInches(width)} x ${feetInches(depth)}`, source: w !== null ? "written" : wholeWall ? "wall" : "drawing" });
        return;
      }
      const fixtureType: FixtureType = item.kind;
      const def = FIXTURE_DEFAULT_FEET[fixtureType];
      // A tub or shower drawn wall to wall is as long as the wall; otherwise the standard size, or
      // the drawing's where it is plainly bigger.
      let width = w ?? (wholeWall && (item.kind === "tub" || item.kind === "shower") ? wall.length : def.width * 12);
      let depth = d ?? (item.kind === "tub" ? standard(drawnDepth, TUB_DEPTHS, 6) : def.depth * 12);
      if (item.kind === "toilet") [width, depth] = [w ?? def.width * 12, d ?? def.depth * 12];
      const sym: FixtureSymbol = {
        id: newSketchId("fixture"),
        type: "fixture",
        wallId: wall.wallId,
        t,
        widthFraction: Math.min(1, width / wall.length),
        widthFeet: width / 12,
        fixtureType,
        label: "",
        depthFeet: depth / 12,
        heightFeet: FIXTURE_DEFAULT_HEIGHT_FEET[fixtureType],
        showerShape: "rectangular",
      };
      room.symbols.push(sym);
      const what = item.kind === "tub" ? "Tub" : item.kind === "toilet" ? "Toilet" : item.kind[0]!.toUpperCase() + item.kind.slice(1);
      placed.push({ room: r, what, size: `${feetInches(width)} x ${feetInches(depth)}`, source: w !== null ? "written" : wholeWall ? "wall" : "standard" });
    });

    rooms.push(room);
  });

  for (const w of solved.walls) {
    if (w.source === "written-differs") questions.push({ kind: "wallDiffers", room: w.room, wall: w.wall, written: w.written as number, closes: w.inches });
    if (w.source === "drawing") questions.push({ kind: "tapeWall", room: w.room, wall: w.wall, inches: w.inches });
  }
  return { rooms, walls: solved.walls, placed, questions, scale: solved.scale };
}

/** A read checked for shape before it is built from: what is wrong with it, or null. */
export function readProblem(value: unknown): string | null {
  const read = value as HandSketchRead | null;
  if (!read || typeof read !== "object") return "not an object";
  if (!Array.isArray(read.rooms) || read.rooms.length === 0) return "no rooms";
  for (const [r, room] of read.rooms.entries()) {
    if (!Array.isArray(room.corners) || room.corners.length < 3) return `room ${r}: fewer than 3 corners`;
    if (!Array.isArray(room.walls) || room.walls.length !== room.corners.length) return `room ${r}: walls and corners differ in number`;
    for (const o of room.openings ?? []) if (!(o.wall >= 0 && o.wall < room.corners.length)) return `room ${r}: an opening on a wall it does not have`;
    for (const it of room.items ?? []) if (!(it.wall >= 0 && it.wall < room.corners.length)) return `room ${r}: an item on a wall it does not have`;
  }
  return null;
}
