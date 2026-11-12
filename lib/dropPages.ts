import type { HandSketchRead } from "./handSketch";
import { mergeHandSketch } from "./handSketchClaim";
import type { TraceState } from "./handSketchTrace";
import type { ScopePageRead } from "./scopeUpload";
import { MAIN_LEVEL, emptySketch, type Sketch } from "./sketch";
import { parseTidyScope, type ScopePageIn, type TidyScope } from "./tidyScope";

/**
 * The pages dropped on the Drop a sketch or scope page (2026-11-12): what each holds, and the one plan and one scope
 * they make between them. Pure: shared by the page and its tests.
 *
 * A page is a photo or a PDF. For each, Scrivn works out whether it is a sketch, a scope or both:
 * - a drawing, by looking for rooms in a photo in the browser (lib/handSketchBoxes.ts: free, nothing sent anywhere);
 * - a scope, by reading the page (/api/scope-upload/read, signed in): a page read with no line of work on it has none.
 * The person can say otherwise either way. A PDF is read as a scope only: its pages are not drawn in the browser, so
 * a sketch in one is not looked for.
 *
 * The sketch side of a page is the drop page's sketch as it was before pages (2026-11-05): a trace, a read built into
 * rooms, its answered questions, and the editor's version once it has been changed there. The plan is every page's
 * rooms side by side, as a claim takes rooms from more than one drawing (`mergeHandSketch`).
 */

/** Where a page's sketch stands. */
export type SketchSide =
  /** No drawing on the page, or the person said so. */
  | "none"
  /** Being read. */
  | "reading"
  /** A trace waiting on the person: the rooms Scrivn found to name and size, or a read's numbers to confirm. */
  | "check"
  /** Checked: on the plan. */
  | "ready"
  /** It could not be read or found; the person can trace it. */
  | "failed";

/** Where a page's scope stands. */
export type ScopeSide =
  /** Not read: signed out, reads off, or not asked yet. */
  | "unread"
  | "reading"
  /** Read, with work on it. */
  | "read"
  /** Read with no work on it, or the person said there is none. */
  | "none"
  | "failed";

export interface PagePhoto {
  /** A JPEG data URL, PHOTO_EDGE on its long side: what is traced on and what the sketch read is sent. */
  url: string;
  width: number;
  height: number;
}

export interface DropPage {
  id: string;
  /** The file's name, or "Photo 2". */
  file: string;
  kind: "photo" | "pdf";
  /** A photo's copy for tracing; null for a PDF. */
  photo: PagePhoto | null;
  sketch: SketchSide;
  scope: ScopeSide;
  trace: TraceState | null;
  read: HandSketchRead | null;
  /** The build's questions answered or let go (lib/handSketchTrace.ts `openQuestions`). */
  dismissed: string[];
  /** The page's rooms as changed in the editor, which then stand instead of the read. */
  edited: Sketch | null;
  scopeRead: ScopePageRead | null;
  sketchError: string | null;
  scopeError: string | null;
}

export function newPage(id: string, file: string, kind: DropPage["kind"], photo: PagePhoto | null): DropPage {
  return { id, file, kind, photo, sketch: "none", scope: "unread", trace: null, read: null, dismissed: [], edited: null, scopeRead: null, sketchError: null, scopeError: null };
}

/** Lines of work a page's scope reading holds. */
export function scopeLines(read: ScopePageRead | null): number {
  if (!read) return 0;
  return read.continuing.length + read.general.length + read.rooms.reduce((s, r) => s + r.items.length, 0);
}

/**
 * Where a page's scope stands once it is read: read when there is work on it. A printed or estimate page is no
 * drawing, whatever lines were found on it: a table's rules are not walls.
 */
export function afterScopeRead(page: DropPage, read: ScopePageRead): DropPage {
  const typed = read.pageKind === "printed" || read.pageKind === "estimate";
  const sketch = typed && page.sketch !== "ready" && !page.trace?.rooms.some((r) => r.name || r.lengths.some(Boolean)) ? "none" : page.sketch;
  return { ...page, scopeRead: read, scope: scopeLines(read) > 0 ? "read" : "none", scopeError: null, sketch };
}

export type PageHolds = "sketch" | "scope" | "both" | "nothing" | "unknown";

/** What a page is, as far as is known: its sketch counts while it is anything but "none"; its scope once read. */
export function pageHolds(page: DropPage): PageHolds {
  const sketch = page.sketch !== "none";
  if (page.scope === "read") return sketch ? "both" : "scope";
  if (page.scope === "none") return sketch ? "sketch" : "nothing";
  return sketch ? "sketch" : "unknown";
}

export function holdsWords(page: DropPage): string {
  switch (pageHolds(page)) {
    case "both":
      return "Sketch and scope";
    case "scope":
      return "Scope";
    case "sketch":
      return "Sketch";
    case "nothing":
      return "Nothing found on it";
    default:
      return page.kind === "pdf" ? "Scope, not read yet" : "No sketch found; a scope, not read yet";
  }
}

/** The pages whose sketch is on the plan, with the plan's version of each (built from its read, or as edited). */
export interface PageSketch {
  pageId: string;
  sketch: Sketch;
}

/**
 * Every page's rooms in one plan, side by side in the order the pages were dropped (3 ft apart; a name used twice gets
 * the next number), and which of the plan's names are each page's: what the page's scope rooms are matched to.
 */
export function combineSketches(pages: readonly PageSketch[]): { sketch: Sketch; names: Map<string, string[]> } {
  let sketch: Sketch = emptySketch();
  const names = new Map<string, string[]>();
  for (const page of pages) {
    const ids = new Set(page.sketch.rooms.map((r) => r.id));
    sketch = mergeHandSketch(sketch, { rooms: page.sketch.rooms, freeWalls: page.sketch.freeWalls, levels: page.sketch.levels, levelNames: page.sketch.levelNames }, MAIN_LEVEL);
    names.set(
      page.pageId,
      sketch.rooms.filter((r) => ids.has(r.id) && !r.parentRoomId).map((r) => r.name),
    );
  }
  return { sketch, names };
}

/** The pages with a scope read, as the tidied scope takes them, each with the plan's names for the rooms drawn on it. */
export function scopePagesIn(pages: readonly DropPage[], names: Map<string, string[]>): ScopePageIn[] {
  return pages.filter((p) => p.scope === "read" && p.scopeRead).map((p) => ({ read: p.scopeRead as ScopePageRead, file: p.file, sketchRooms: p.sketch === "ready" ? (names.get(p.id) ?? []) : [] }));
}

/* ── Kept in this browser ───────────────────────────────────────────────────────────────────────── */

/**
 * The work in progress, kept in this browser so a reload or a sign-in in the middle loses nothing. The page files
 * (`blobs`: a photo as read for its scope, or the PDF) are kept until the person starts again, so a page dropped while
 * signed out can be read once they sign in.
 */
export interface DropDraft {
  version: 2;
  pages: DropPage[];
  blobs: Record<string, Blob>;
  /** The scope as the person changed it; null while it is still Scrivn's tidying of the pages. */
  doc: TidyScope | null;
}

const SKETCH_SIDES: SketchSide[] = ["none", "reading", "check", "ready", "failed"];
const SCOPE_SIDES: ScopeSide[] = ["unread", "reading", "read", "none", "failed"];

function parsePage(v: unknown): DropPage | null {
  const p = v as DropPage;
  if (!p || typeof p !== "object" || typeof p.id !== "string" || (p.kind !== "photo" && p.kind !== "pdf")) return null;
  const photo = p.photo && typeof p.photo.url === "string" && p.photo.width > 0 && p.photo.height > 0 ? p.photo : null;
  if (p.kind === "photo" && !photo) return null;
  // A read cut off by the reload is not reading any more: asked again from the page.
  const sketch: SketchSide = p.sketch === "reading" ? "failed" : SKETCH_SIDES.includes(p.sketch) ? p.sketch : "none";
  const scope: ScopeSide = p.scope === "reading" ? "unread" : SCOPE_SIDES.includes(p.scope) ? p.scope : "unread";
  return {
    ...newPage(p.id, typeof p.file === "string" ? p.file : "Page", p.kind, photo),
    sketch: (sketch === "check" || sketch === "ready") && !p.trace ? "failed" : sketch,
    scope: scope === "read" && !p.scopeRead ? "unread" : scope,
    trace: p.trace ?? null,
    read: p.read ?? null,
    dismissed: Array.isArray(p.dismissed) ? p.dismissed.filter((d): d is string => typeof d === "string") : [],
    edited: p.edited && Array.isArray(p.edited.rooms) ? p.edited : null,
    scopeRead: p.scopeRead && Array.isArray(p.scopeRead.rooms) ? p.scopeRead : null,
    sketchError: typeof p.sketchError === "string" ? p.sketchError : null,
    scopeError: typeof p.scopeError === "string" ? p.scopeError : null,
  };
}

/** What the drop page kept before it took scopes (2026-11-05): one photo of one sketch. */
interface DraftV1 {
  stage: string;
  photo: PagePhoto;
  trace: TraceState;
  read: HandSketchRead | null;
  dismissed?: string[];
  edited: Sketch | null;
}

/** A kept draft checked for shape, a one-sketch draft from before pages taken in as its one page, or null. */
export function parseDraft(value: unknown): DropDraft | null {
  const v = value as Partial<DropDraft> & Partial<DraftV1>;
  if (!v || typeof v !== "object") return null;
  if (v.version === 2 && Array.isArray(v.pages)) {
    const pages = v.pages.map(parsePage).filter((p): p is DropPage => p !== null);
    if (pages.length === 0) return null;
    const blobs: Record<string, Blob> = {};
    for (const [id, blob] of Object.entries(v.blobs ?? {})) if (typeof Blob !== "undefined" && blob instanceof Blob) blobs[id] = blob;
    return { version: 2, pages, blobs, doc: v.doc ? parseTidyScope(v.doc) : null };
  }
  if (v.photo?.url && v.trace) {
    // It was dropped as a sketch, so no scope is looked for on it unless the person asks.
    const page: DropPage = {
      ...newPage("p1", "Your sketch", "photo", v.photo),
      sketch: v.read ? "ready" : "check",
      scope: "none",
      trace: v.trace,
      read: v.read ?? null,
      dismissed: Array.isArray(v.dismissed) ? v.dismissed : [],
      edited: v.edited ?? null,
    };
    return { version: 2, pages: [page], blobs: {}, doc: null };
  }
  return null;
}

/** The draft as it is kept: a page being read is kept as not read, and asked again on the way back. */
export function draftToKeep(pages: readonly DropPage[], blobs: Record<string, Blob>, doc: TidyScope | null): DropDraft {
  const kept: Record<string, Blob> = {};
  for (const p of pages) {
    const blob = blobs[p.id];
    if (blob) kept[p.id] = blob;
  }
  return { version: 2, pages: [...pages], blobs: kept, doc };
}
