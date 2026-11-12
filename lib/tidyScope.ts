import { matchRoomName, normaliseRoomName } from "./gapCheck";
import { mergePages, scopeToNotes, type ScopeItem, type ScopeLinePhase, type ScopePageRead, type UploadedScope } from "./scopeUpload";

/**
 * The tidied scope on the Drop a sketch or scope page (2026-11-12): the scope pages Scrivn read, organized room by room
 * into a document the person can check, change and download, before any gap check.
 *
 * The owner decided how far the tidying goes:
 * - Room by room. Where there is a sketch, a room on the scope that is a room on the plan takes the plan's name, and the
 *   scope's own name is shown beside it. One room written and one drawn on the same page are the same room, whatever
 *   each is called: the reader is told the lines beside a room on a sketch are that room's. Otherwise by name, each of
 *   the plan's rooms matched to one of the scope's at most; where that is not sure, the room stays as written.
 * - Each line in plain trade words, with its quantity and the writing it was read from beside it. A line the reader was
 *   not sure of is flagged until the person says it is right, or changes it.
 * - Lines go under Emergency or Repair only where the page itself put them there (ScopeItem.phase); nothing is guessed.
 * - No questions. Asking what is missing is the gap check, a claim's own step, and the document becomes that claim's
 *   notes as any uploaded scope's block (lib/scopeUpload.ts `scopeToNotes`), so Generate reads it unchanged.
 *
 * Pure: shared by the page and its tests.
 */

export interface TidyLine {
  id: string;
  /** The work in plain trade words: the reading's, or the person's own once they change it. */
  plain: string;
  /** The line as written on the page; "" for a line the person added. */
  written: string;
  /** As written, with its unit ("48 LF", "F, the whole floor"); "" when none. */
  quantity: string;
  /** Part of it may be misread: flagged until the person says it is right or changes it. */
  unsure: boolean;
  /** The heading the page itself put it under, or null. */
  phase: ScopeLinePhase | null;
  /**
   * The person changed its words or its quantity. It is theirs then: in a claim's notes it goes without the writing,
   * which the extraction would otherwise be told to go by.
   */
  changed: boolean;
}

export interface TidyRoom {
  id: string;
  name: string;
  /** The level as the scope gives it ("Basement"), or "". */
  level: string;
  /** What the scope itself calls the room, when it is shown by the plan's name instead; else null. */
  scopeName: string | null;
  lines: TidyLine[];
}

export interface TidyScope {
  version: 1;
  rooms: TidyRoom[];
  /** Work for the job as a whole. */
  general: TidyLine[];
  /** What is on the pages that is not work: the cause, dates, names, numbers, and what the sketch says. */
  notes: string[];
  unreadable: { page: number; what: string }[];
  files: string[];
  pages: number;
}

/** One page's reading of its scope, in the order the pages were dropped. */
export interface ScopePageIn {
  read: ScopePageRead;
  file: string;
  /** The rooms drawn on the same page, by their names on the plan. */
  sketchRooms: string[];
}

const same = (a: string, b: string) => normaliseRoomName(a) === normaliseRoomName(b);

/** A room drawn beside a bigger one that is part of it on a scope: a closet, a pantry, a linen cupboard. */
const SMALL_ROOM = /\b(closet|pantry|linen|storage|w\.?i\.?c\.?)\b/i;

function lineFrom(item: ScopeItem, id: string): TidyLine {
  return { id, plain: item.plain, written: item.written, quantity: item.quantity ?? "", unsure: item.unsure, phase: item.phase ?? null, changed: false };
}

/**
 * The scope pages as one tidied scope, against the plan's room names (`sketchNames`, empty when there is no sketch).
 * The ids are numbered in order, so the same pages give the same document.
 */
export function tidyScope(pages: ScopePageIn[], sketchNames: readonly string[]): TidyScope {
  let n = 0;
  const id = (prefix: string) => `${prefix}${++n}`;

  // One room written and one drawn on a page are the same room: the scope's room takes the plan's name before the pages
  // are joined, so a later page naming the plan's room joins it. A closet drawn beside the room is part of it, as the
  // reader is told a room drawn in another with no name of its own is.
  const scopeNames = new Map<string, string>();
  const prepared = pages.map(({ read, file, sketchRooms }) => {
    const only = read.rooms.length === 1 ? read.rooms[0] : undefined;
    const main = sketchRooms.filter((n) => n.trim() !== "" && !SMALL_ROOM.test(n));
    const drawn = main.length === 1 ? main[0] : undefined;
    if (!only || drawn === undefined || same(only.name, drawn)) return { read, file };
    const key = normaliseRoomName(drawn);
    if (!scopeNames.has(key)) scopeNames.set(key, only.name);
    return { read: { ...read, rooms: [{ ...only, name: drawn }] }, file };
  });
  const merged = mergePages(prepared);

  // Then by name against the plan, each of its rooms taken by one of the scope's at most: the same name first, then one
  // matchRoomName is sure of, in the scope's order. A scope room whose plan room another has taken stays as it is
  // written: two rooms on the scope are never joined into one by a guess.
  const taken = new Set<number>();
  const planAt = new Map<number, number>();
  merged.rooms.forEach((room, i) => {
    const at = sketchNames.findIndex((n, k) => !taken.has(k) && same(n, room.name));
    if (at >= 0) {
      taken.add(at);
      planAt.set(i, at);
    }
  });
  merged.rooms.forEach((room, i) => {
    if (planAt.has(i) || sketchNames.length === 0) return;
    const at = matchRoomName(sketchNames, room.name);
    if (at !== undefined && !taken.has(at)) {
      taken.add(at);
      planAt.set(i, at);
    }
  });
  const rooms: TidyRoom[] = merged.rooms.map((room, i) => {
    const lines = room.items.map((item) => lineFrom(item, id("l")));
    const at = planAt.get(i);
    const planName = at === undefined ? undefined : sketchNames[at];
    if (planName === undefined) return { id: id("r"), name: room.name, level: room.level ?? "", scopeName: null, lines };
    const written = scopeNames.get(normaliseRoomName(planName)) ?? room.name;
    return { id: id("r"), name: planName, level: room.level ?? "", scopeName: same(written, planName) ? null : written, lines };
  });
  return {
    version: 1,
    rooms,
    general: merged.general.map((item) => lineFrom(item, id("l"))),
    notes: merged.notes,
    unreadable: merged.unreadable,
    files: merged.files,
    pages: merged.pages,
  };
}

/* ── Reading it ─────────────────────────────────────────────────────────────────────────────────── */

export const PHASE_HEADINGS: Record<ScopeLinePhase, string> = { EMERGENCY: "Emergency", REPAIR: "Repair" };

/** A room's lines as they are shown: those under no heading first, then Emergency's, then Repair's, each in order. */
export function linesByPhase(lines: readonly TidyLine[]): { phase: ScopeLinePhase | null; lines: TidyLine[] }[] {
  const order: (ScopeLinePhase | null)[] = [null, "EMERGENCY", "REPAIR"];
  return order.map((phase) => ({ phase, lines: lines.filter((l) => l.phase === phase) })).filter((g) => g.lines.length > 0);
}

const allLines = (doc: TidyScope) => [...doc.rooms.flatMap((r) => r.lines), ...doc.general];

/** Lines of work in it, the empty ones the person added and left left out. */
export function tidyLineCount(doc: TidyScope): number {
  return allLines(doc).filter((l) => l.plain.trim() !== "").length;
}

/** Lines still flagged as maybe misread. */
export function tidyFlaggedCount(doc: TidyScope): number {
  return allLines(doc).filter((l) => l.unsure && l.plain.trim() !== "").length;
}

function itemOf(line: TidyLine): ScopeItem | null {
  const plain = line.plain.trim();
  if (!plain) return null;
  const item: ScopeItem = {
    // The person's own words stand alone: the writing would otherwise be gone by.
    written: line.changed || !line.written.trim() ? plain : line.written,
    plain,
    quantity: line.quantity.trim() || null,
    unsure: line.unsure && !line.changed,
  };
  if (line.phase) item.phase = line.phase;
  return item;
}

const itemsOf = (lines: readonly TidyLine[]) =>
  linesByPhase(lines)
    .flatMap((g) => g.lines)
    .map(itemOf)
    .filter((i): i is ScopeItem => i !== null);

/** The document as an uploaded scope, as it stands: what a gap check's claim takes into its notes. */
export function tidyToUploaded(doc: TidyScope): UploadedScope {
  return {
    rooms: doc.rooms
      .map((r) => ({ name: r.name.trim() || "Room not named", level: r.level.trim() || null, items: itemsOf(r.lines) }))
      .filter((r) => r.items.length > 0),
    general: itemsOf(doc.general),
    notes: doc.notes.map((n) => n.trim()).filter(Boolean),
    unreadable: doc.unreadable,
    files: doc.files,
    pages: doc.pages,
  };
}

/** The block a gap check's new claim starts its notes with: today's uploaded-scope block, of the document as edited. */
export function tidyToNotes(doc: TidyScope): string {
  return scopeToNotes(tidyToUploaded(doc));
}

/* ── Changing it ────────────────────────────────────────────────────────────────────────────────── */

export const GENERAL = "general";

/** An id no line or room in the document has. */
function freshId(doc: TidyScope, prefix: string): string {
  const taken = new Set([...doc.rooms.map((r) => r.id), ...allLines(doc).map((l) => l.id)]);
  let k = taken.size + 1;
  while (taken.has(`${prefix}${k}`)) k++;
  return `${prefix}${k}`;
}

function mapLines(doc: TidyScope, fn: (lines: TidyLine[]) => TidyLine[]): TidyScope {
  return { ...doc, rooms: doc.rooms.map((r) => ({ ...r, lines: fn(r.lines) })), general: fn(doc.general) };
}

export function setRoom(doc: TidyScope, roomId: string, patch: Partial<Pick<TidyRoom, "name" | "level">>): TidyScope {
  return { ...doc, rooms: doc.rooms.map((r) => (r.id === roomId ? { ...r, ...patch } : r)) };
}

export function removeRoom(doc: TidyScope, roomId: string): TidyScope {
  return { ...doc, rooms: doc.rooms.filter((r) => r.id !== roomId) };
}

/** A line's words or quantity changed: the person's own now, so no longer flagged. */
export function setLine(doc: TidyScope, lineId: string, patch: Partial<Pick<TidyLine, "plain" | "quantity">>): TidyScope {
  return mapLines(doc, (lines) => lines.map((l) => (l.id === lineId ? { ...l, ...patch, changed: true, unsure: false } : l)));
}

/** "Looks right": a flagged line checked against the page. */
export function lineRight(doc: TidyScope, lineId: string): TidyScope {
  return mapLines(doc, (lines) => lines.map((l) => (l.id === lineId ? { ...l, unsure: false } : l)));
}

export function removeLine(doc: TidyScope, lineId: string): TidyScope {
  return mapLines(doc, (lines) => lines.filter((l) => l.id !== lineId));
}

/** An empty line at the end of a room (or of the whole job's, `GENERAL`), under the heading given. */
export function addLine(doc: TidyScope, to: string, phase: ScopeLinePhase | null = null): { doc: TidyScope; id: string } {
  const id = freshId(doc, "l");
  const line: TidyLine = { id, plain: "", written: "", quantity: "", unsure: false, phase, changed: true };
  if (to === GENERAL) return { doc: { ...doc, general: [...doc.general, line] }, id };
  return { doc: { ...doc, rooms: doc.rooms.map((r) => (r.id === to ? { ...r, lines: [...r.lines, line] } : r)) }, id };
}

/** A room the scope has no heading for, with one empty line to fill in. */
export function addRoom(doc: TidyScope, name = ""): { doc: TidyScope; id: string } {
  const id = freshId(doc, "r");
  const lineId = freshId({ ...doc, rooms: [...doc.rooms, { id, name, level: "", scopeName: null, lines: [] }] }, "l");
  const room: TidyRoom = { id, name, level: "", scopeName: null, lines: [{ id: lineId, plain: "", written: "", quantity: "", unsure: false, phase: null, changed: true }] };
  return { doc: { ...doc, rooms: [...doc.rooms, room] }, id };
}

export function removeNote(doc: TidyScope, index: number): TidyScope {
  return { ...doc, notes: doc.notes.filter((_, i) => i !== index) };
}

/* ── Checking what was kept ─────────────────────────────────────────────────────────────────────── */

function isLine(v: unknown): v is TidyLine {
  const l = v as TidyLine;
  return !!l && typeof l === "object" && typeof l.id === "string" && typeof l.plain === "string" && typeof l.written === "string" && typeof l.quantity === "string";
}

/** A kept document checked for shape (it comes back from this browser's storage), or null. */
export function parseTidyScope(value: unknown): TidyScope | null {
  const d = value as TidyScope;
  if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.rooms) || !Array.isArray(d.general)) return null;
  const line = (l: TidyLine): TidyLine => ({ ...l, unsure: !!l.unsure, changed: !!l.changed, phase: l.phase === "EMERGENCY" || l.phase === "REPAIR" ? l.phase : null });
  for (const r of d.rooms) if (!r || typeof r.id !== "string" || typeof r.name !== "string" || !Array.isArray(r.lines) || !r.lines.every(isLine)) return null;
  if (!d.general.every(isLine)) return null;
  return {
    version: 1,
    rooms: d.rooms.map((r) => ({ id: r.id, name: r.name, level: typeof r.level === "string" ? r.level : "", scopeName: typeof r.scopeName === "string" ? r.scopeName : null, lines: r.lines.map(line) })),
    general: d.general.map(line),
    notes: Array.isArray(d.notes) ? d.notes.filter((n): n is string => typeof n === "string") : [],
    unreadable: Array.isArray(d.unreadable) ? d.unreadable.filter((u) => u && typeof u.what === "string" && typeof u.page === "number") : [],
    files: Array.isArray(d.files) ? d.files.filter((f): f is string => typeof f === "string") : [],
    pages: typeof d.pages === "number" ? d.pages : 0,
  };
}

/* ── The PDF ────────────────────────────────────────────────────────────────────────────────────── */

/** A room's size off the plan, for its heading: "11' 2\" x 10' 4\", 115.2 SF floor, 43.0 LF floor perimeter". */
export interface PlanRoomSize {
  name: string;
  size: string;
  f: string;
  pf: string;
}

/** The plan's room by the name a room of the document goes by: the same name, or one matchRoomName is sure of. */
export function planRoomFor(rows: readonly PlanRoomSize[], name: string): PlanRoomSize | null {
  const exact = rows.find((r) => same(r.name, name));
  if (exact) return exact;
  const at = matchRoomName(
    rows.map((r) => r.name),
    name,
  );
  return at === undefined ? null : (rows[at] ?? null);
}

export function sizeWords(row: PlanRoomSize): string {
  return `${row.size}, ${row.f} SF floor, ${row.pf} LF floor perimeter`;
}

/** What the PDF draws: a table per room and heading, then the whole job's, the notes, and what could not be read. */
export interface TidyPdfTable {
  caption: string;
  rows: string[][];
}

export function tidyPdfTables(doc: TidyScope, plan: readonly PlanRoomSize[]): TidyPdfTable[] {
  const row = (l: TidyLine) => {
    const flag = l.unsure ? " (check: may be misread)" : "";
    const written = l.changed || !l.written.trim() || l.written.trim() === l.plain.trim() ? "" : l.written.trim();
    return [`${l.plain.trim()}${flag}`, l.quantity.trim(), written];
  };
  const tables: TidyPdfTable[] = [];
  for (const room of doc.rooms) {
    const groups = linesByPhase(room.lines.filter((l) => l.plain.trim() !== ""));
    if (groups.length === 0) continue;
    const size = planRoomFor(plan, room.name);
    const head = [room.name.trim() || "Room not named", room.level.trim() ? `(${room.level.trim()})` : ""].filter(Boolean).join(" ");
    const extra = [size ? sizeWords(size) : "", room.scopeName ? `on the scope: ${room.scopeName}` : ""].filter(Boolean).join("; ");
    for (const g of groups) {
      const phase = g.phase ? ` - ${PHASE_HEADINGS[g.phase]}` : "";
      tables.push({ caption: `${head}${phase}${extra ? ` (${extra})` : ""}`, rows: g.lines.map(row) });
    }
  }
  for (const g of linesByPhase(doc.general.filter((l) => l.plain.trim() !== ""))) {
    tables.push({ caption: `Whole job${g.phase ? ` - ${PHASE_HEADINGS[g.phase]}` : ""}`, rows: g.lines.map(row) });
  }
  return tables;
}
