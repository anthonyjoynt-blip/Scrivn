/**
 * Uploading a scope (2026-11-06): photos of a handwritten scope's pages, or a PDF of a typed or printed one, read by
 * Claude into the claim's notes, so the usual pipeline (the four extraction calls, the follow-up questions that are
 * the gap check, the documents) runs on them unchanged.
 *
 * This file is what both sides share, with no server or browser code in it:
 * - what one page's reading is;
 * - how pages join into one scope (a room carried over a page break, the same room written twice);
 * - the block of notes it becomes, with the marker lines that tell the extraction calls part of the notes is a
 *   written scope;
 * - the rule those calls read when the marker is there.
 *
 * The marker lives in the notes text itself on purpose. A step that waits for signal rebuilds its request from the
 * claim's notes as they stand then (lib/aiJobs.ts, lib/claimGeneration.ts `extractionRequest`), so the rule follows
 * the text wherever it goes, with no new claim state. Notes with no uploaded scope in them make every call send
 * exactly what it sent before.
 */

/** One line of work on a scope. */
export interface ScopeItem {
  /** The line exactly as written: abbreviations, numbers and all. */
  written: string;
  /** The same line in plain words, abbreviations spelled out where the reader was sure of them. */
  plain: string;
  /** The quantity as written with its unit ("140 SF", "48 LF", "2"), or null. */
  quantity: string | null;
  /** Part of the line could not be read with confidence. */
  unsure: boolean;
}

export interface ScopeRoom {
  /** The room as named on the scope, spelled out ("Basement bedroom"). */
  name: string;
  /** The level, when the scope gives one ("Basement", "Main floor"), or null. */
  level: string | null;
  items: ScopeItem[];
}

export type ScopePageKind = "handwritten" | "printed" | "estimate" | "other";

/** What one page (a photo) or one PDF was read as. */
export interface ScopePageRead {
  version: 1;
  pageKind: ScopePageKind;
  /** Lines at the top of the page with no room heading above them: the last room of the page before, carried on. */
  continuing: ScopeItem[];
  rooms: ScopeRoom[];
  /** Work for the job as a whole: equipment totals, containment, contents, testing. */
  general: ScopeItem[];
  /** Lines that are not work: the cause of loss, dates, names, claim or job numbers, the address. As written. */
  notes: string[];
  /** What could not be read at all, saying where. */
  unreadable: string[];
}

/** The pages of one upload, joined. */
export interface UploadedScope {
  rooms: ScopeRoom[];
  general: ScopeItem[];
  notes: string[];
  /** What could not be read, with the page (1-based) it was on. */
  unreadable: { page: number; what: string }[];
  /** The file names, in order, for the heading. */
  files: string[];
  pages: number;
}

/**
 * The biggest file one read takes. Vercel refuses a request body over 4.5 MB, so a page goes up as the file itself
 * (multipart, no base64), and a PDF no bigger than a roof report may be (lib/roofReport.ts). Here, not in the server
 * module, so the notes step can check a file before sending it.
 */
export const SCOPE_UPLOAD_MAX_BYTES = 4_400_000;

/** The opening of the block in the notes. What the extraction calls look for. */
export const UPLOADED_SCOPE_START = "=== FROM AN UPLOADED SCOPE";
export const UPLOADED_SCOPE_END = "=== END OF UPLOADED SCOPE ===";

const roomKey = (r: ScopeRoom) =>
  `${r.name}|${r.level ?? ""}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The pages of one upload as one scope, in the order they were picked:
 * - a page's carried-on lines go to the last room of the pages before it (or to the whole job, on the first page);
 * - a room written again on a later page, the same name and level, is the same room;
 * - the rest is kept in order.
 */
export function mergePages(pages: { read: ScopePageRead; file: string }[]): UploadedScope {
  const rooms: ScopeRoom[] = [];
  const general: ScopeItem[] = [];
  const notes: string[] = [];
  const unreadable: { page: number; what: string }[] = [];
  const byKey = new Map<string, ScopeRoom>();
  pages.forEach(({ read }, i) => {
    if (read.continuing.length) {
      const last = rooms[rooms.length - 1];
      if (last) last.items.push(...read.continuing);
      else general.push(...read.continuing);
    }
    for (const room of read.rooms) {
      const key = roomKey(room);
      const known = byKey.get(key);
      if (known) {
        known.items.push(...room.items);
        continue;
      }
      const copy: ScopeRoom = { name: room.name, level: room.level, items: [...room.items] };
      byKey.set(key, copy);
      rooms.push(copy);
    }
    general.push(...read.general);
    for (const n of read.notes) if (!notes.includes(n)) notes.push(n);
    for (const what of read.unreadable) unreadable.push({ page: i + 1, what });
  });
  return { rooms, general, notes, unreadable, files: pages.map((p) => p.file), pages: pages.length };
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** One item as a line of notes: the plain words, the writing when it says something else, the quantity, a doubt. */
export function itemLine(item: ScopeItem): string {
  const plain = item.plain.trim() || item.written.trim();
  const written = item.written.trim();
  let line = `- ${plain}`;
  if (written && squash(written) !== squash(plain)) line += ` [written: ${written}]`;
  if (item.quantity) line += ` (${item.quantity})`;
  if (item.unsure) line += " (not sure this was read right)";
  return line;
}

/** The scope as the block of notes it becomes, between its marker lines. */
export function scopeToNotes(scope: UploadedScope): string {
  const out: string[] = [];
  const files = scope.files.filter(Boolean);
  out.push(`${UPLOADED_SCOPE_START} (${scope.pages} page${scope.pages === 1 ? "" : "s"}${files.length ? `: ${files.join(", ")}` : ""}) ===`);
  for (const room of scope.rooms) {
    out.push(`${room.name}${room.level ? ` (${room.level})` : ""}:`);
    for (const item of room.items) out.push(itemLine(item));
  }
  if (scope.general.length) {
    out.push("Whole job:");
    for (const item of scope.general) out.push(itemLine(item));
  }
  if (scope.notes.length) {
    out.push("Notes on the scope:");
    for (const n of scope.notes) out.push(`- ${n}`);
  }
  if (scope.unreadable.length) {
    out.push("Could not read:");
    for (const u of scope.unreadable) out.push(`- page ${u.page}: ${u.what}`);
  }
  out.push(UPLOADED_SCOPE_END);
  return out.join("\n");
}

/** The notes with an uploaded scope's block added at the end, after a blank line. */
export function appendToNotes(notes: string, block: string): string {
  const before = notes.trimEnd();
  return before ? `${before}\n\n${block}` : block;
}

/** How many lines of work a scope holds: what the notes step reports once it is read. */
export function scopeLineCount(scope: UploadedScope): number {
  return scope.rooms.reduce((s, r) => s + r.items.length, 0) + scope.general.length;
}

export const UPLOADED_SCOPE_RULE = `UPLOADED SCOPE. Part of the transcript, between the lines "${UPLOADED_SCOPE_START} …" and "${UPLOADED_SCOPE_END}", was read by Scrivn from a scope the estimator wrote or printed for this loss. Read it as the estimator's own decisions about the work: each line under a room heading is work for that room (what is torn out, removed, replaced, cleaned or treated, how high a wall is cut, the equipment set there), exactly as if it had been said in the walkthrough. Abbreviations have been spelled out; "[written: …]" after a line is how it was actually written, and where the spelled-out words do not fit the writing, go by the writing. A quantity in brackets is as written (LF, SF, each), or one of Xactimate's room measurements with its meaning ("F, the whole floor"; "PF, the whole perimeter of the floor"), and then the work covers all of it. Lines under "Whole job" are for the job as a whole, not one room. A line marked as not sure may have been misread: use it only where it fits the rest. Anything said elsewhere in the transcript about the same item is the same item, never a second one.`;

/** The rule, to add after the transcript in a user message, when the transcript holds an uploaded scope; else nothing. */
export function uploadedScopeSection(transcript: string | null | undefined): string {
  return (transcript ?? "").includes(UPLOADED_SCOPE_START) ? `\n\n${UPLOADED_SCOPE_RULE}` : "";
}
