import { SCAN_DROP } from "./scanInbox";
import {
  MAIN_LEVEL,
  PIXELS_PER_FOOT,
  freeWallLevel,
  freeWallsOf,
  levelsOf,
  newSketchId,
  roomBounds,
  roomLevel,
  withDerivedParents,
  withLevel,
  type FreeWall,
  type Sketch,
  type SketchRoom,
  type WallDetail,
} from "./sketch";

/**
 * A hand-drawn sketch's rooms, on their way from the drop-a-sketch page into a claim.
 *
 * ── Why the claim page does the adding, not the server ───────────────────────────────────────────
 *
 * A browser with a claim open re-saves the whole claim after every edit (lib/scanInbox.ts says it at
 * length), so rooms written into the claim's row by the server would be erased by the next save of
 * any tab that has it open. So the drop page hands the rooms over in this browser — a `handoff` in
 * localStorage under a one-off token — and navigates to the claim with `?handSketch=<token>`. The
 * claim page, once its own load has settled, adds them through its normal save path: the device
 * first, then the server, with the version check that catches the office having changed the claim
 * meanwhile.
 *
 * ── Adding, not replacing ────────────────────────────────────────────────────────────────────────
 *
 * `adoptScan` REPLACES a storey: the phone measured it and owns it. A hand sketch is an addition — a
 * room or two the PM drew on paper — so nothing already on the claim is moved or removed. The new
 * rooms are set clear of what is there, beside it, and named so they never share a name with a room
 * already on the claim, because the scope and the moisture map find rooms by name.
 *
 * ── Twice is once ────────────────────────────────────────────────────────────────────────────────
 *
 * The handoff is kept until the claim with the rooms in it is safely saved, so a reload in between
 * reads it again. A room whose id is already on the claim is the same room, added before, and is
 * skipped: a second merge adds nothing. The drawing's other ids — corners, doors, cabinets — are
 * changed only where one happens to clash with an id on the claim.
 *
 * Pure apart from the small storage helpers at the bottom, which never throw.
 */

/** What the drop page hands the claim page. */
export interface HandSketchHandoff {
  token: string;
  /** When the drop page wrote it (ISO 8601). Old ones are pruned (`pruneHandoffs`). */
  createdAt: string;
  /** The claim the PM picked on the drop page, or null for a new claim. */
  claimId: string | null;
  /** The rooms as built from the drawing (lib/handSketch.ts `buildFromRead`), with anything else drawn beside them. */
  sketch: HandSketchRooms;
  /**
   * A gap check from the Drop a sketch or scope page (2026-11-12): the tidied scope as the block of notes it becomes
   * (lib/scopeUpload.ts `scopeToNotes`), for a NEW claim's notes, where Generate reads it as any uploaded scope. The
   * rooms may be none, when the pages held only a scope.
   */
  notes?: string;
}

export type HandSketchRooms = Pick<Sketch, "rooms" | "freeWalls" | "levels" | "levelNames">;

export const HANDOFF_KEY_PREFIX = "scrivn.handSketch.handoff.";

/** How far the new rooms stand to the right of what is already on the floor: 3 ft. */
export const HAND_SKETCH_GAP_PX = 3 * PIXELS_PER_FOOT;

/** How long a handoff nobody picked up is kept. */
export const HANDOFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/* ── The merge ──────────────────────────────────────────────────────────────────────────────────── */

/** Every id the claim's drawing uses: rooms, their corners, symbols and free cabinets, free walls and their corners. */
function idsIn(sketch: Sketch): Set<string> {
  const ids = new Set<string>();
  for (const room of sketch.rooms) {
    ids.add(room.id);
    for (const v of room.vertices) ids.add(v.id);
    for (const s of room.symbols ?? []) ids.add(s.id);
    for (const c of room.freeCabinets ?? []) ids.add(c.id);
  }
  for (const wall of freeWallsOf(sketch)) {
    ids.add(wall.id);
    for (const v of wall.vertices) ids.add(v.id);
  }
  return ids;
}

/** The incoming rooms not yet on the claim — what an add would add. Empty once they all are. */
export function handSketchRoomsToAdd(claimSketch: Sketch, incoming: HandSketchRooms): SketchRoom[] {
  const onClaim = new Set(claimSketch.rooms.map((r) => r.id));
  return incoming.rooms.filter((r) => !onClaim.has(r.id));
}

/**
 * The incoming storey the chosen floor stands for: its main level when it has rooms there, else its
 * lowest. A drawing of one storey is that storey, whichever number it was built on; one of a basement
 * and a main floor puts its main floor on the floor chosen and its basement under it.
 */
export function handSketchBaseLevel(incoming: HandSketchRooms): number {
  const levels = [...incoming.rooms.map(roomLevel), ...(incoming.freeWalls ?? []).map(freeWallLevel)];
  if (levels.length === 0 || levels.includes(MAIN_LEVEL)) return MAIN_LEVEL;
  return Math.min(...levels);
}

/** "Bathroom" when free, else "Bathroom 2", "Bathroom 3"...; "Bedroom 2" taken goes on to "Bedroom 3". */
function freeName(name: string, taken: Set<string>): string {
  const trimmed = name.trim();
  if (trimmed === "" || !taken.has(trimmed.toLowerCase())) return name;
  const numbered = /^(.*\S)\s+(\d+)$/.exec(trimmed);
  const stem = numbered ? (numbered[1] as string) : trimmed;
  let n = numbered ? Number(numbered[2]) + 1 : 2;
  while (taken.has(`${stem} ${n}`.toLowerCase())) n++;
  return `${stem} ${n}`;
}

/** The room with a new id for each corner, symbol and free cabinet whose id the claim already uses, and everything that names a corner following it. */
function withFreeIds(room: SketchRoom, taken: Set<string>): SketchRoom {
  const corner = new Map<string, string>();
  const vertices = room.vertices.map((v) => {
    if (!taken.has(v.id)) return v;
    const id = newSketchId("v");
    corner.set(v.id, id);
    return { ...v, id };
  });
  const symbols = (room.symbols ?? []).map((s) => {
    const id = taken.has(s.id) ? newSketchId(s.type) : s.id;
    const wallId = corner.get(s.wallId) ?? s.wallId;
    return id === s.id && wallId === s.wallId ? s : { ...s, id, wallId };
  });
  const freeCabinets = (room.freeCabinets ?? []).map((c) => (taken.has(c.id) ? { ...c, id: newSketchId("cabinet") } : c));
  const out: SketchRoom = { ...room, vertices, symbols, freeCabinets };
  if (corner.size > 0 && room.missingWalls) out.missingWalls = room.missingWalls.map((id) => corner.get(id) ?? id);
  if (corner.size > 0 && room.wallDetails) {
    const details: Record<string, WallDetail> = {};
    for (const [id, detail] of Object.entries(room.wallDetails)) details[corner.get(id) ?? id] = detail;
    out.wallDetails = details;
  }
  return out;
}

function onLevel<T extends { level?: number }>(thing: T, level: number): T {
  const out = { ...thing };
  // The main level is written as no level at all, as everything that draws a room writes it.
  if (level === MAIN_LEVEL) delete out.level;
  else out.level = level;
  return out;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

function boxOf(points: { x: number; y: number }[]): Box | null {
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

function union(boxes: (Box | null)[]): Box | null {
  const real = boxes.filter((b): b is Box => b !== null);
  if (real.length === 0) return null;
  return {
    minX: Math.min(...real.map((b) => b.minX)),
    minY: Math.min(...real.map((b) => b.minY)),
    maxX: Math.max(...real.map((b) => b.maxX)),
    maxY: Math.max(...real.map((b) => b.maxY)),
  };
}

/**
 * The hand sketch's rooms added to the claim's drawing, on `level`.
 *
 *   * The incoming storey `handSketchBaseLevel` names goes on `level`; any other storey it has goes
 *     where it stands relative to that one (its level above onto the level above `level`).
 *   * The rooms move as one group, so they keep their places against each other and the storeys
 *     stay stacked: 3 ft to the right of everything already on the storeys they land on, their tops
 *     level with its top; at `SCAN_DROP` when those storeys are empty.
 *   * A room whose id is already on the claim is skipped (see the file's note); so is a free wall.
 *   * A name already on the claim, on any storey, gets the next number: "Bathroom 2".
 *   * Parents are re-derived over the whole drawing, so a closet drawn inside a bedroom is its sub-room.
 *
 * Nothing already on the claim is changed. With nothing to add, the claim's sketch comes back as it was.
 */
export function mergeHandSketch(claimSketch: Sketch, incoming: HandSketchRooms, level: number): Sketch {
  const onClaim = new Set(claimSketch.rooms.map((r) => r.id));
  const wallsOnClaim = new Set(freeWallsOf(claimSketch).map((w) => w.id));
  const rooms = incoming.rooms.filter((r) => !onClaim.has(r.id) && Array.isArray(r.vertices) && r.vertices.length >= 3);
  const walls = (incoming.freeWalls ?? []).filter((w) => !wallsOnClaim.has(w.id) && Array.isArray(w.vertices) && w.vertices.length >= 2);
  if (rooms.length === 0 && walls.length === 0) return claimSketch;

  const shift = level - handSketchBaseLevel(incoming);
  const landing = new Set([...rooms.map((r) => roomLevel(r) + shift), ...walls.map((w) => freeWallLevel(w) + shift)]);

  // Where the group goes: beside everything on the storeys it lands on, or at the drop on empty ones.
  const there = union([
    ...claimSketch.rooms.filter((r) => landing.has(roomLevel(r))).map(roomBounds),
    ...freeWallsOf(claimSketch)
      .filter((w) => landing.has(freeWallLevel(w)))
      .map((w) => boxOf(w.vertices)),
  ]);
  const group = union([...rooms.map(roomBounds), ...walls.map((w) => boxOf(w.vertices))]) as Box;
  const to = there ? { x: there.maxX + HAND_SKETCH_GAP_PX, y: there.minY } : SCAN_DROP;
  const dx = to.x - group.minX;
  const dy = to.y - group.minY;

  const taken = idsIn(claimSketch);
  const names = new Set(claimSketch.rooms.map((r) => r.name.trim().toLowerCase()).filter((n) => n !== ""));
  const added = rooms.map((room) => {
    const freed = withFreeIds(room, taken);
    const name = freeName(room.name, names);
    if (name.trim() !== "") names.add(name.trim().toLowerCase());
    return onLevel({ ...freed, name, vertices: freed.vertices.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy })) }, roomLevel(room) + shift);
  });
  const addedWalls: FreeWall[] = walls.map((wall) =>
    onLevel(
      {
        ...wall,
        vertices: wall.vertices.map((v) => ({ ...v, id: taken.has(v.id) ? newSketchId("v") : v.id, x: v.x + dx, y: v.y + dy })),
      },
      freeWallLevel(wall) + shift,
    ),
  );

  // A floor the claim did not have is recorded as one, so it stays a tab if its rooms are deleted (`Sketch.levels`).
  let out: Sketch = claimSketch;
  for (const l of [...landing].sort((a, b) => a - b)) out = withLevel(out, l);
  out = { ...out, rooms: withDerivedParents([...claimSketch.rooms, ...added]) };
  if (addedWalls.length > 0) out.freeWalls = [...freeWallsOf(claimSketch), ...addedWalls];

  // The drawing's names for its other storeys, where the claim has none; the chosen floor keeps its own.
  const base = handSketchBaseLevel(incoming);
  const named = Object.entries(incoming.levelNames ?? {}).filter(([key, name]) => Number(key) !== base && name.trim() !== "" && landing.has(Number(key) + shift));
  for (const [key, name] of named) {
    const at = String(Number(key) + shift);
    if (out.levelNames?.[at]?.trim()) continue;
    out = { ...out, levelNames: { ...(out.levelNames ?? {}), [at]: name } };
  }
  return out;
}

/**
 * The floor the notice offers first: the one the drawing's own storey names, when the claim has it,
 * else the main level.
 */
export function handSketchDefaultFloor(claimSketch: Sketch, incoming: HandSketchRooms): number {
  const base = handSketchBaseLevel(incoming);
  return levelsOf(claimSketch).includes(base) ? base : MAIN_LEVEL;
}

/* ── The handoff in this browser ────────────────────────────────────────────────────────────────── */

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null; // Storage refused outright (a locked-down private window).
  }
}

/** A token for a new handoff: random, and safe in a URL. */
export function newHandoffToken(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID().replace(/-/g, "");
  } catch {
    // Fall through to the plainer one.
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** Keep the handoff for the claim page. False when this browser would not store it. */
export function writeHandoff(handoff: HandSketchHandoff): boolean {
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(HANDOFF_KEY_PREFIX + handoff.token, JSON.stringify(handoff));
    return true;
  } catch {
    return false; // Full, or refused.
  }
}

/** A stored handoff checked for shape, with the room arrays an older build may have left out filled in. Null when it is not one. */
export function parseHandoff(value: unknown, token?: string): HandSketchHandoff | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.token !== "string" || (token !== undefined && v.token !== token)) return null;
  const sketch = v.sketch as Record<string, unknown> | null | undefined;
  if (!sketch || typeof sketch !== "object" || !Array.isArray(sketch.rooms)) return null;
  const rooms: SketchRoom[] = [];
  for (const r of sketch.rooms as unknown[]) {
    if (r === null || typeof r !== "object") return null;
    const room = r as SketchRoom;
    if (typeof room.id !== "string" || typeof room.name !== "string" || !Array.isArray(room.vertices)) return null;
    rooms.push({ ...room, symbols: Array.isArray(room.symbols) ? room.symbols : [], freeCabinets: Array.isArray(room.freeCabinets) ? room.freeCabinets : [] });
  }
  const out: HandSketchHandoff = {
    token: v.token,
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date(0).toISOString(),
    claimId: typeof v.claimId === "string" && v.claimId !== "" ? v.claimId : null,
    sketch: { rooms },
  };
  if (Array.isArray(sketch.freeWalls)) out.sketch.freeWalls = sketch.freeWalls as FreeWall[];
  if (Array.isArray(sketch.levels)) out.sketch.levels = (sketch.levels as unknown[]).filter((l): l is number => typeof l === "number" && Number.isInteger(l));
  if (sketch.levelNames && typeof sketch.levelNames === "object") out.sketch.levelNames = sketch.levelNames as Record<string, string>;
  if (typeof v.notes === "string" && v.notes.trim() !== "") out.notes = v.notes;
  return out;
}

/* ── A gap check's scope in the notes ───────────────────────────────────────────────────────────── */

/**
 * The notes with the handoff's scope added at the end, or null when there is nothing to add: it brings none, or the
 * notes hold it already (a reload before the handoff was let go). Twice is once, as for the rooms.
 */
export function handoffNotesToAdd(transcript: string, handoff: HandSketchHandoff): string | null {
  const block = handoff.notes?.trim();
  if (!block || transcript.includes(block)) return null;
  const before = transcript.trimEnd();
  return before ? `${before}\n\n${block}` : block;
}

/**
 * Everything the handoff brings is on the claim: its rooms (some of them, as `mergeHandSketch` adds them all at once;
 * or it brings none) and its scope in the notes. Until then it is kept, and an add can be tried again.
 */
export function handoffLanded(claimSketch: Sketch, transcript: string, handoff: HandSketchHandoff): boolean {
  const rooms = handoff.sketch.rooms;
  const roomsIn = rooms.length === 0 || handSketchRoomsToAdd(claimSketch, handoff.sketch).length < rooms.length;
  const notesIn = !handoff.notes?.trim() || transcript.includes(handoff.notes.trim());
  return roomsIn && notesIn;
}

/** The handoff under `token`, or null when there is none, it is not one, or storage cannot be read. */
export function readHandoff(token: string): HandSketchHandoff | null {
  try {
    const raw = storage()?.getItem(HANDOFF_KEY_PREFIX + token);
    return raw ? parseHandoff(JSON.parse(raw), token) : null;
  } catch {
    return null;
  }
}

export function deleteHandoff(token: string): void {
  try {
    storage()?.removeItem(HANDOFF_KEY_PREFIX + token);
  } catch {
    // Nothing to do: it is pruned in a week.
  }
}

/** Drop handoffs older than `maxAgeMs`, and any that cannot be read — ones a page never came back for. */
export function pruneHandoffs(now: number = Date.now(), maxAgeMs: number = HANDOFF_MAX_AGE_MS): void {
  try {
    const store = storage();
    if (!store) return;
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (!key || !key.startsWith(HANDOFF_KEY_PREFIX)) continue;
      let made = NaN;
      try {
        made = Date.parse((JSON.parse(store.getItem(key) ?? "null") as { createdAt?: string } | null)?.createdAt ?? "");
      } catch {
        // Unreadable: stale.
      }
      if (!Number.isFinite(made) || now - made > maxAgeMs) stale.push(key);
    }
    for (const key of stale) store.removeItem(key);
  } catch {
    // Storage went away mid-walk; the next visit tries again.
  }
}
