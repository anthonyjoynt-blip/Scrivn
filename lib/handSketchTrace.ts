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
