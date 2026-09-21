import { importScanRoom, type ScanImportResult } from "./scanImport";
import { hasRoomMoisture, type MoistureMap } from "./moisture";
import type { ScopeMarks } from "./scopeMarks";
import { MAIN_LEVEL, roomBounds, roomLevel, roomsOnLevel, withDerivedParents, type Sketch, type SketchRoom, type SketchScan } from "./sketch";

export type { SketchScan } from "./sketch";

/**
 * A scan from the phone, on its way into a claim's sketch.
 *
 * ── The rule this file carries out ───────────────────────────────────────────────────────────────
 *
 * The phone owns a storey's geometry until the estimator edits it in Scrivn; after that, Scrivn
 * owns it. Concretely:
 *
 *   * The FIRST scan into a brand-new claim is applied on the server as the claim is created —
 *     nothing can have that row open, so nothing can be overwritten (`sketchFromScan`).
 *   * Every LATER scan is stored as a pending row (`claim_scans`) and never written into the claim
 *     by the server, because a browser with the claim open re-saves the whole payload after every
 *     edit and would erase it. The editor reads the pending rows and applies them itself.
 *   * Applying a scan REPLACES the rooms on its storey — no merging. Whether that happens silently
 *     or is offered as Adopt / Discard is `scanDecision`: silently while the storey is empty, or is
 *     the one the phone last drew and the sketch is still exactly what the phone sent (the
 *     fingerprint on `sketch.scan` still matches) with nothing marked on that storey; otherwise ask,
 *     because the replace would throw away work.
 *
 * Every function here is pure and runs in Node as readily as in the browser — the route that
 * creates a claim from a scan and the editor that adopts a later one use the same code, so the two
 * cannot disagree about what a scan becomes.
 */

/** A `claim_scans` row as the browser and the phone see it. */
export interface PendingScan {
  id: string;
  claimId: string;
  captureId: string | null;
  /** When the phone says the capture happened (ISO 8601), when it said. */
  capturedAt: string | null;
  /** When the server received it (ISO 8601). */
  receivedAt: string;
  level: number;
  /** The taps JSON as the phone sent it — either shape the importer reads. */
  body: unknown;
  /** The paired phone's name, for the notice. */
  deviceName: string | null;
}

/**
 * Where a scan lands when nothing on its storey says otherwise: a margin in from the world origin,
 * the same margin the editor keeps between a new room and the frame of the canvas.
 */
export const SCAN_DROP = { x: 30, y: 30 };

/** What a room is to the fingerprint — everything the estimator can change about it, in a fixed key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`).join(",")}}`;
}

/**
 * A room's canonical text, remembered by the room object.
 *
 * The decision below is re-made on every render of the claim page while a scan waits, and a wall
 * being dragged re-renders per pointer frame; the editor replaces only the room being changed and
 * keeps every other room's object, so remembering the text per object turns a whole-sketch hash
 * into one room's worth of work per frame. A WeakMap, so a room that is gone takes its entry with it.
 */
const roomText = new WeakMap<object, string>();

function canonicalRoom(room: SketchRoom): string {
  const known = roomText.get(room);
  if (known !== undefined) return known;
  const text = canonical(room);
  roomText.set(room, text);
  return text;
}

/**
 * A short, stable digest of the drawing.
 *
 * Over everything but `scan` itself: rooms, free walls and the level list, with object keys in a
 * fixed order so the same drawing serialised by two builds hashes the same. FNV-1a, 52 bits in two
 * halves, as hex — not a cryptographic hash and not meant as one; it only has to notice a change,
 * and two different drawings colliding would cost one unnecessary Adopt / Discard prompt.
 */
export function sketchFingerprint(sketch: Sketch): string {
  // The same text `canonical` would build for the whole object, with the rooms' parts remembered.
  const text = `{"freeWalls":${canonical(sketch.freeWalls ?? [])},"levels":${canonical(sketch.levels ?? [])},"rooms":[${sketch.rooms.map(canonicalRoom).join(",")}]}`;
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x0100019d) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * True while the drawing is exactly as it was when the phone's scan was adopted — nobody has edited
 * since. Says nothing about which storey the phone drew; that is `sketch.scan.level`, and
 * `scanDecision` reads both.
 */
export function isPhoneOwned(sketch: Sketch): boolean {
  return sketch.scan !== undefined && sketch.scan.fingerprint === sketchFingerprint(sketch);
}

/**
 * How big a capture the importer will be asked to draw. The phone's real captures are a few
 * hundred corners at most; the importer's cost grows with corners times openings, so a body far
 * beyond that is refused before it is converted. Generous on purpose — a whole house tapped room
 * by room is nowhere near it.
 */
export const SCAN_LIMITS = { corners: 5000, features: 1000 };

/**
 * Why a body is too big to convert, or null when it is within `SCAN_LIMITS`. Counts only what the
 * importer would walk — outline corners, openings, cabinets, flights — over every room the body
 * names; a body that is not even an object is left to the importer to describe.
 */
export function scanTooBig(body: unknown): string | null {
  const parsed = typeof body === "string" ? safeParse(body) : body;
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const rooms = Array.isArray(record.rooms) ? (record.rooms as unknown[]) : [record];
  let corners = 0;
  let features = 0;
  for (const room of rooms) {
    if (room === null || typeof room !== "object") continue;
    const r = room as Record<string, unknown>;
    corners += lengthOf(r.outline) + lengthOf(r.outline_unsquared) + lengthOf(r.walls);
    features += lengthOf(r.outline_openings) + lengthOf(r.cabinets) + lengthOf(r.stairs);
  }
  if (corners > SCAN_LIMITS.corners) return `This scan has ${corners} corners — more than a capture can hold.`;
  if (features > SCAN_LIMITS.features) return `This scan has ${features} openings, cabinets and flights — more than a capture can hold.`;
  return null;
}

function lengthOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** The scan's body as text — what the importer reads. A string body is taken as already being that text. */
export function scanText(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

/**
 * Where a scan lands on a storey: over the rooms it is replacing, so the plan stays where the
 * estimator left it, or at the default drop when the storey is empty.
 */
export function scanDropPoint(sketch: Sketch, level: number): { x: number; y: number } {
  const rooms = roomsOnLevel(sketch, level);
  if (rooms.length === 0) return { ...SCAN_DROP };
  const bounds = rooms.map(roomBounds);
  return { x: Math.min(...bounds.map((b) => b.minX)), y: Math.min(...bounds.map((b) => b.minY)) };
}

/** The scan converted to rooms on `level`, dropped at `at`. */
export function convertScan(body: unknown, at: { x: number; y: number }, level: number): ScanImportResult {
  return importScanRoom(scanText(body), at, level);
}

export type ScanDecision = "adopt" | "ask";

/**
 * Whether a pending scan may be applied without asking.
 *
 * Silently when nothing would be lost: the storey it names has no rooms, or is the storey the phone
 * last drew, still exactly as the phone drew it (the sketch is phone-owned), with no moisture
 * reading or scope mark on any of its rooms. Anything else — a hand-drawn room, a renamed one, a
 * typed ceiling height, a metered wall — is work the replace would throw away, and that is the
 * estimator's call.
 *
 * The storey check matters because the fingerprint covers the whole drawing: after a scan of the
 * main floor is adopted beside a hand-drawn upstairs, the upstairs is inside the fingerprint too,
 * and ownership alone would call it the phone's. Only the storey the provenance names is known to
 * be. The cost is one Adopt / Discard prompt when a phone that has scanned two storeys re-scans the
 * earlier one — the direction this file already accepts.
 *
 * The readings and marks are checked before the fingerprint because they are the cheap test and,
 * once metering has started, the one that decides; the hash is left for the storeys that pass.
 */
export function scanDecision(sketch: Sketch, moisture: MoistureMap, scopeMarks: ScopeMarks, level: number): ScanDecision {
  const rooms = roomsOnLevel(sketch, level);
  if (rooms.length === 0) return "adopt";
  const ids = new Set(rooms.map((r) => r.id));
  for (const id of ids) if (hasRoomMoisture(moisture, id)) return "ask";
  for (const mark of Object.values(scopeMarks)) {
    if (mark.walls.some((w) => ids.has(w.roomId))) return "ask";
    if (Object.keys(mark.floorCells).some((roomId) => ids.has(roomId))) return "ask";
  }
  if (sketch.scan === undefined || sketch.scan.level !== level) return "ask";
  if (!isPhoneOwned(sketch)) return "ask";
  return "adopt";
}

/** What `adoptScan` did, for the notice. */
export interface Adoption {
  sketch: Sketch;
  /** Rooms now on the storey, from the scan (flights of stairs included). */
  roomCount: number;
  /** Rooms that were on the storey before and are gone. */
  replacedCount: number;
  notes: string[];
}

/**
 * The scan applied: the storey's rooms replaced by the scan's, every other storey untouched, and
 * the provenance written so the result reads as phone-owned until somebody edits it.
 *
 * The rooms are dropped where the old ones stood (`scanDropPoint`), so a re-scan does not move
 * the plan under the estimator. Parents are re-derived over the whole sketch because a room on
 * another storey may have chosen one of the replaced rooms — it cannot keep a parent that is gone.
 */
export function adoptScan(sketch: Sketch, scan: PendingScan, receivedAt: string = scan.receivedAt): Adoption | { ok: false; error: string } {
  const level = scan.level;
  const result = convertScan(scan.body, scanDropPoint(sketch, level), level);
  if (!result.ok) return result;
  const incoming = [result.room, ...result.extraRooms];
  const kept = sketch.rooms.filter((room) => roomLevel(room) !== level);
  const replacedCount = sketch.rooms.length - kept.length;
  const rooms = withDerivedParents([...kept, ...incoming]);
  const withoutScan: Sketch = { ...sketch, rooms };
  delete withoutScan.scan;
  const provenance: SketchScan = {
    scanId: scan.id,
    captureId: scan.captureId,
    receivedAt,
    level,
    fingerprint: sketchFingerprint(withoutScan),
  };
  return { sketch: { ...withoutScan, scan: provenance }, roomCount: incoming.length, replacedCount, notes: result.notes };
}

/**
 * A brand-new sketch from a scan — what the server builds when the phone sends a scan for a claim
 * that does not exist yet. The same conversion the editor's Import scan does, at the default drop.
 */
export function sketchFromScan(
  body: unknown,
  scan: { scanId: string; captureId: string | null; receivedAt: string; level?: number },
): { ok: true; sketch: Sketch; roomCount: number; notes: string[] } | { ok: false; error: string } {
  const level = scan.level ?? MAIN_LEVEL;
  const adopted = adoptScan(
    { rooms: [] },
    { id: scan.scanId, claimId: "", captureId: scan.captureId, capturedAt: null, receivedAt: scan.receivedAt, level, body, deviceName: null },
    scan.receivedAt,
  );
  if ("ok" in adopted) return adopted;
  return { ok: true, sketch: adopted.sketch, roomCount: adopted.roomCount, notes: adopted.notes };
}

/** The rooms of a sketch a phone might be sent to pick a name from: the sketch's own, placeholders left out. */
export function namedRooms(rooms: SketchRoom[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const room of rooms) {
    const name = room.name.trim();
    if (name === "" || /^room \d+$/i.test(name)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
