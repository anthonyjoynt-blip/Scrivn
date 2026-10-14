import { levelName, roomLevel, type Sketch } from "./sketch";

/**
 * Site photos with spoken captions (2026-10-14): what a claim holds about each photo, and the rules
 * for filing, merging and reading them.
 *
 * ── Records, never pictures ──────────────────────────────────────────────────────────────────────
 *
 * A claim is one JSON payload saved whole every second and a half, already hundreds of kilobytes
 * with a sketch in it. So the claim carries only small records here — which room, when, what was
 * said — and the pictures live in the `claim-photos` bucket (migration 0015), sent one at a time by
 * lib/devicePhotos.ts from the phone's own store, where they wait with no signal.
 *
 * ── Filed by room id, with the name beside it ────────────────────────────────────────────────────
 *
 * `room` is the sketch room's id, so renaming a room never strands its photos. The name it had when
 * the photo was filed rides along (`roomName`) for one case: a re-scan that replaces a storey's rooms
 * gives them new ids, and the photos fall to Unsorted with the old name to suggest a room by.
 *
 * ── Two phones on one claim ──────────────────────────────────────────────────────────────────────
 *
 * Two technicians photographing the same job add records to the same list. Any other part of a claim
 * changed in two places is a question for the estimator (ClashBanner), but photos are a set with an
 * id each, so they are merged quietly: every id kept, the later edit of a record wins, and a photo
 * deleted on one phone stays deleted — the deletion leaves a mark (`deleted`) for thirty days so the
 * other phone, still holding it, cannot bring it back. `mergeClaimPhotos` is that rule; it gives the
 * same answer whichever copy comes first, and merging a copy with itself changes nothing.
 *
 * ── Run twice, the same answer ───────────────────────────────────────────────────────────────────
 *
 * `normalizeClaimPhotos` runs inside `parseSavedClaimState`, which the sync check runs twice — once
 * on what was sent and once on the server's copy of it — and compares fingerprints. So it sorts into
 * one order, reads no clock, and returns exactly what it is given when that is already clean.
 */

/** The room value for a photo of the outside of the house. */
export const EXTERIOR_ROOM = "exterior";
/** The room value for a photo not filed to a room yet. */
export const UNSORTED_ROOM = "";
/** The owner's limit (2026-10-14): enough for any job, few enough to keep phones, storage and PDFs in hand. */
export const MAX_CLAIM_PHOTOS = 300;
export const MAX_CAPTION_CHARS = 2000;
/** How long a deleted photo's mark is kept, so a phone that still has the photo does not bring it back. */
export const DELETION_MARK_DAYS = 30;
/** A hard bound on records in one payload, far past the limit above: two phones each at the limit fit. */
const MAX_RECORDS = 1000;

export type PhotoSource = "camera" | "gallery" | "scan";
export type CaptionBy = "voice" | "typed";

export interface ClaimPhoto {
  /** Made on the phone that took it, so it names the photo before the server has heard of it. */
  id: string;
  /** A sketch room id, `EXTERIOR_ROOM`, or `UNSORTED_ROOM`. */
  room: string;
  /** The room's name when it was filed — see the file's note. */
  roomName: string;
  /** When it was taken, by the phone's clock (ms). From a gallery photo, when the camera took it. */
  takenAt: number;
  caption: string;
  /** How the caption came: spoken, or typed (a spoken one fixed by typing counts as typed). Null with no caption. */
  captionBy: CaptionBy | null;
  width: number;
  height: number;
  source: PhotoSource;
  /** When this record last changed — what decides between two phones' copies of it. */
  editedAt: number;
}

export interface PhotoDeletion {
  id: string;
  at: number;
}

export interface ClaimPhotos {
  items: ClaimPhoto[];
  /** Photos deleted, kept for `DELETION_MARK_DAYS` — see the file's note. */
  deleted: PhotoDeletion[];
  /**
   * The photo notes the scope was last made from, one short print each (`notePrint`), sorted. Null
   * until a scope has been made since photos existed. What the "new photo notes since the scope"
   * line compares against — see `notesSinceScope`.
   */
  scopedNotes: string[] | null;
}

export function emptyClaimPhotos(): ClaimPhotos {
  return { items: [], deleted: [], scopedNotes: null };
}

/* ── Cleaning ───────────────────────────────────────────────────────────────────────────────────── */

const ID = /^[A-Za-z0-9:_-]{1,80}$/;

export function isPhotoId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function dimension(value: unknown): number {
  const n = Math.round(num(value, 0));
  return n > 0 && n <= 20000 ? n : 0;
}

/** One record with every field present, in one key order — so two equal records print the same. */
function cleanPhoto(raw: unknown): ClaimPhoto | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isPhotoId(r.id)) return null;
  const takenAt = Math.max(0, num(r.takenAt, 0));
  const caption = str(r.caption, MAX_CAPTION_CHARS);
  const by = r.captionBy === "voice" || r.captionBy === "typed" ? r.captionBy : null;
  return {
    id: r.id,
    room: str(r.room, 80),
    roomName: str(r.roomName, 120),
    takenAt,
    caption,
    captionBy: caption.trim() === "" ? null : (by ?? "typed"),
    width: dimension(r.width),
    height: dimension(r.height),
    source: r.source === "gallery" || r.source === "scan" ? r.source : "camera",
    editedAt: Math.max(0, num(r.editedAt, takenAt)),
  };
}

/** Of two copies of one record, the one to keep: the later edit, and on a tie the same one whichever is asked first. */
function later(a: ClaimPhoto, b: ClaimPhoto): ClaimPhoto {
  if (a.editedAt !== b.editedAt) return a.editedAt > b.editedAt ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

/**
 * A stored or merged value, made safe and put in one order. Idempotent — see the file's note.
 *
 * Deliberately reads no clock: old deletion marks are let go when the estimator next changes the
 * photos (`deletePhoto`), not here, or two runs a day apart would disagree.
 */
export function normalizeClaimPhotos(value: unknown): ClaimPhotos {
  if (!value || typeof value !== "object") return emptyClaimPhotos();
  const v = value as Partial<Record<keyof ClaimPhotos, unknown>>;

  const deleted = new Map<string, number>();
  for (const raw of Array.isArray(v.deleted) ? v.deleted : []) {
    const d = raw as Partial<PhotoDeletion> | null;
    if (!d || !isPhotoId(d.id)) continue;
    const at = Math.max(0, num(d.at, 0));
    deleted.set(d.id, Math.max(at, deleted.get(d.id) ?? 0));
  }

  const byId = new Map<string, ClaimPhoto>();
  for (const raw of Array.isArray(v.items) ? v.items : []) {
    const photo = cleanPhoto(raw);
    if (!photo || deleted.has(photo.id)) continue;
    const seen = byId.get(photo.id);
    byId.set(photo.id, seen ? later(seen, photo) : photo);
  }

  const items = [...byId.values()].sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, MAX_RECORDS);
  const marks = [...deleted.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const scopedNotes = Array.isArray(v.scopedNotes)
    ? [...new Set(v.scopedNotes.filter((s): s is string => typeof s === "string" && s.length > 0 && s.length <= 32))].sort()
    : null;
  return { items, deleted: marks, scopedNotes };
}

/**
 * Two copies of a claim's photos as one: every photo either has, the later edit of each, nothing
 * either deleted. Order-independent for the photos; `scopedNotes` is the first copy's — the copy whose
 * scope is being kept — unless it has none.
 */
export function mergeClaimPhotos(first: ClaimPhotos, second: ClaimPhotos): ClaimPhotos {
  return normalizeClaimPhotos({
    items: [...first.items, ...second.items],
    deleted: [...first.deleted, ...second.deleted],
    scopedNotes: first.scopedNotes ?? second.scopedNotes,
  });
}

/* ── Changing them ──────────────────────────────────────────────────────────────────────────────── */

export function addPhoto(photos: ClaimPhotos, photo: ClaimPhoto): ClaimPhotos {
  return normalizeClaimPhotos({ ...photos, items: [...photos.items, photo] });
}

function changePhoto(photos: ClaimPhotos, id: string, change: (p: ClaimPhoto) => ClaimPhoto): ClaimPhotos {
  let changed = false;
  const items = photos.items.map((p) => {
    if (p.id !== id) return p;
    const next = change(p);
    changed = changed || JSON.stringify(next) !== JSON.stringify(p);
    return next;
  });
  return changed ? normalizeClaimPhotos({ ...photos, items }) : photos;
}

export function captionPhoto(photos: ClaimPhotos, id: string, caption: string, by: CaptionBy, now = Date.now()): ClaimPhotos {
  return changePhoto(photos, id, (p) =>
    p.caption === caption && (caption.trim() === "" || p.captionBy === by) ? p : { ...p, caption: caption.slice(0, MAX_CAPTION_CHARS), captionBy: caption.trim() ? by : null, editedAt: now },
  );
}

export function movePhoto(photos: ClaimPhotos, id: string, room: string, roomName: string, now = Date.now()): ClaimPhotos {
  return changePhoto(photos, id, (p) => (p.room === room && p.roomName === roomName ? p : { ...p, room, roomName, editedAt: now }));
}

/** Old marks go here, while the estimator is changing the photos anyway — see `normalizeClaimPhotos`. */
export function pruneDeletionMarks(deleted: PhotoDeletion[], now = Date.now()): PhotoDeletion[] {
  const cutoff = now - DELETION_MARK_DAYS * 24 * 60 * 60 * 1000;
  return deleted.filter((d) => d.at >= cutoff);
}

export function deletePhoto(photos: ClaimPhotos, id: string, now = Date.now()): ClaimPhotos {
  return normalizeClaimPhotos({
    ...photos,
    items: photos.items.filter((p) => p.id !== id),
    deleted: [...pruneDeletionMarks(photos.deleted, now), { id, at: now }],
  });
}

export function hasPhotos(photos: ClaimPhotos): boolean {
  return photos.items.length > 0;
}

export function captioned(photo: ClaimPhoto): boolean {
  return photo.caption.trim() !== "";
}

/* ── Rooms ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * What every room is called on a chip, in the PDF and in the photo notes: its name, or "Room 3" by
 * its place in the sketch when it has none — the asbestos form's wording. Two rooms with the same name
 * on different levels get the level after it, so a chip never names two rooms.
 */
export function roomLabels(sketch: Pick<Sketch, "rooms" | "levelNames">): Map<string, string> {
  const base = sketch.rooms.map((room, i) => room.name.trim() || `Room ${i + 1}`);
  const counts = new Map<string, number>();
  for (const label of base) counts.set(label.toLowerCase(), (counts.get(label.toLowerCase()) ?? 0) + 1);
  const out = new Map<string, string>();
  sketch.rooms.forEach((room, i) => {
    const label = base[i]!;
    out.set(room.id, (counts.get(label.toLowerCase()) ?? 0) > 1 ? `${label} (${levelName(sketch, roomLevel(room))})` : label);
  });
  return out;
}

/** Where a photo is filed now: its room if the sketch still has it, Exterior, or Unsorted. */
export function photoRoomKey(photo: Pick<ClaimPhoto, "room">, sketch: Pick<Sketch, "rooms">): string {
  if (photo.room === EXTERIOR_ROOM) return EXTERIOR_ROOM;
  return sketch.rooms.some((r) => r.id === photo.room) ? photo.room : UNSORTED_ROOM;
}

export function roomKeyLabel(key: string, labels: Map<string, string>): string {
  if (key === EXTERIOR_ROOM) return "Exterior";
  if (key === UNSORTED_ROOM) return "Unsorted";
  return labels.get(key) ?? "Unsorted";
}

export interface PhotoRoomGroup {
  key: string;
  label: string;
  photos: ClaimPhoto[];
}

/**
 * The photos by room, in the sketch's room order — lowest level first, as the sketch tabs run — then
 * Exterior, then Unsorted. Only rooms with photos. Within a room, in the order they were taken.
 */
export function photosByRoom(photos: ClaimPhotos, sketch: Pick<Sketch, "rooms" | "levelNames">): PhotoRoomGroup[] {
  const labels = roomLabels(sketch);
  const byKey = new Map<string, ClaimPhoto[]>();
  for (const photo of photos.items) {
    const key = photoRoomKey(photo, sketch);
    byKey.set(key, [...(byKey.get(key) ?? []), photo]);
  }
  const order: string[] = [
    ...[...sketch.rooms].map((r, i) => ({ r, i })).sort((a, b) => roomLevel(a.r) - roomLevel(b.r) || a.i - b.i).map(({ r }) => r.id),
    EXTERIOR_ROOM,
    UNSORTED_ROOM,
  ];
  return order.filter((key) => byKey.has(key)).map((key) => ({ key, label: roomKeyLabel(key, labels), photos: byKey.get(key)! }));
}

/** What a photo filed under `room` remembers the room as: the room's own name (not the chip's level suffix). */
export function roomNameFor(room: string, sketch: Pick<Sketch, "rooms">): string {
  if (room === EXTERIOR_ROOM) return "Exterior";
  if (room === UNSORTED_ROOM) return "";
  return sketch.rooms.find((r) => r.id === room)?.name.trim() ?? "";
}

/** The chips a photo can be filed under: every room, then Exterior and Unsorted. */
export function photoRoomOptions(sketch: Pick<Sketch, "rooms" | "levelNames">): { value: string; label: string }[] {
  const labels = roomLabels(sketch);
  return [
    ...sketch.rooms.map((room) => ({ value: room.id, label: labels.get(room.id) ?? room.name })),
    { value: EXTERIOR_ROOM, label: "Exterior" },
    { value: UNSORTED_ROOM, label: "Unsorted" },
  ];
}

/* ── Photo notes, for the scope step (stage 2) ──────────────────────────────────────────────────── */

/** cyrb53, as lib/claimSync.ts uses: a short print compared for equality, never trusted for security. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export interface PhotoNote {
  id: string;
  /** The room as the scope step knows rooms: by name. */
  room: string;
  takenAt: number;
  caption: string;
  /** What this note was when the scope read it — its photo, where it was filed, what it said. */
  print: string;
}

/**
 * The captioned photos as the scope step reads them: one note each, in the order taken. A photo with
 * no caption says nothing to the scope and is left out.
 *
 * The print is of the room it is filed under (by id, so renaming a room is not a change to the note)
 * and the caption's words: moving a photo or editing its caption is a new note.
 */
export function photoNotes(photos: ClaimPhotos, sketch: Pick<Sketch, "rooms" | "levelNames">): PhotoNote[] {
  const labels = roomLabels(sketch);
  return photos.items
    .filter(captioned)
    .map((p) => {
      const key = photoRoomKey(p, sketch);
      const caption = p.caption.replace(/\s+/g, " ").trim();
      return {
        id: p.id,
        room: key === UNSORTED_ROOM ? "room not given" : roomKeyLabel(key, labels),
        takenAt: p.takenAt,
        caption,
        print: hash53(`${p.id}|${key}|${caption}`),
      };
    });
}

/** The prints of a set of notes, as `scopedNotes` stores them. */
export function notePrints(notes: PhotoNote[]): string[] {
  return [...new Set(notes.map((n) => n.print))].sort();
}

/**
 * The notes as a block of text for the prompts, one line each: room · time · words. Empty when there
 * are none, so a claim with no captions sends exactly what it sent before photos existed.
 *
 * `when` formats a time the way the estimator reads it on site — built in the browser, which knows
 * the phone's time zone; the server does not.
 */
export function photoNotesText(notes: PhotoNote[], when: (ms: number, withDate: boolean) => string): string {
  if (notes.length === 0) return "";
  const days = new Set(notes.map((n) => new Date(n.takenAt).toDateString()));
  return notes.map((n) => `- ${n.room} · ${when(n.takenAt, days.size > 1)} · ${n.caption}`).join("\n");
}

/** The phone's own way of writing a time, for the notes: "10:42 a.m.", or with the day when the photos span several. */
export function noteTime(ms: number, withDate: boolean): string {
  const d = new Date(ms);
  return withDate ? d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
}

/**
 * How far the photo notes have moved on since the scope was made, for the line that offers to update
 * it: notes the scope never read — new, or edited or moved since, each of which is a new note to it —
 * and notes it read that are gone without a new one in their place (a caption cleared, a photo
 * deleted). An edit is one changed note, not one added and one removed. Nothing when there is no
 * scope to compare with.
 */
export function notesSinceScope(photos: ClaimPhotos, sketch: Pick<Sketch, "rooms" | "levelNames">, hasScope: boolean): { added: number; removed: number } {
  if (!hasScope) return { added: 0, removed: 0 };
  const now = notePrints(photoNotes(photos, sketch));
  const then = new Set(photos.scopedNotes ?? []);
  const current = new Set(now);
  const added = now.filter((p) => !then.has(p)).length;
  const gone = [...then].filter((p) => !current.has(p)).length;
  return { added, removed: Math.max(0, gone - added) };
}

/** The line itself, or null when the scope is up to date with the photos. */
export function notesSinceScopeLine(change: { added: number; removed: number }): string | null {
  if (change.added > 0) return `${change.added} new photo note${change.added === 1 ? "" : "s"} since the scope was made.`;
  if (change.removed > 0) return `${change.removed} photo note${change.removed === 1 ? "" : "s"} removed since the scope was made.`;
  return null;
}

