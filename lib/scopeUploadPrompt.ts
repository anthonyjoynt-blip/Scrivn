import type { ScopeItem, ScopePageKind, ScopePageRead } from "./scopeUpload";

/**
 * Reading an uploaded scope (2026-11-06): what Claude is told, the shape of its answer, and the answer turned into a
 * ScopePageRead (lib/scopeUpload.ts). One call reads one photo of a page, or one PDF with all its pages.
 *
 * The answer's shape follows the hand-sketch read (lib/handSketchPrompt.ts): no unions, an empty string where a
 * value is missing, and `readFromWire` turning those back into nulls.
 */

const PAGE_KINDS: ScopePageKind[] = ["handwritten", "printed", "estimate", "other"];

export const SCOPE_READ_SYSTEM = `You read photos and PDFs of water-damage restoration scopes for Scrivn, an app that builds scope documents and inspection reports for restoration companies. A scope here is the estimator's own list of the work for a loss: usually handwritten on site, sometimes typed, sometimes a printed estimate (Xactimate or similar). Your reading goes into the claim's notes, where the estimator checks it before Scrivn uses it. So read exactly what is there, add nothing, and say plainly where you are not sure. The page may be photographed at an angle or sideways; read it the right way up.

Return:
- pageKind: "handwritten", "printed" (typed), "estimate" (a printed estimate with line items and prices), or "other".
- rooms: each room or area the scope names, in the order written. name: the room as written, with abbreviations spelled out ("Bsmt bdrm" is "Basement bedroom", "Kit" is "Kitchen"). level: the level when the scope gives one ("Basement", "Main floor", "Upper floor"), else "".
- items, under each room: one per line of work, in order. Work includes what is removed, torn out, replaced, cleaned, treated or sprayed, how high walls are cut, the equipment set in that room, and what the estimator noted about the room's damage ("wet 2 ft up", "subfloor soft").
  - written: the line exactly as written, abbreviations, symbols and numbers as they are.
  - plain: the same line in plain words, with the abbreviations spelled out. Only expand an abbreviation you are confident of in restoration use; otherwise keep it as written. Never add work that is not written.
  - quantity: the quantity as written with its unit ("140 SF", "48 LF", "2", "2 ft"), else "".
  - unsure: true when part of the line could not be read with confidence.
- continuing: lines at the very top of the page, before any room heading, that carry on a room from an earlier page. Empty when the page starts with a room heading, or names no rooms.
- general: work for the whole job rather than one room: equipment totals, containment, contents handling, testing, cleaning the whole area. Same fields as items.
- notes: lines that are not work, copied as written: the cause of loss, dates, names, claim or job numbers, the address, the insurer. On a printed estimate, leave out prices, totals, tax and page furniture.
- unreadable: anything you could not read at all, saying where it is ("the second line under Kitchen, after R&R").

A scope is often written on the same page as a hand-drawn sketch of the rooms. Then:
- Lines of work written beside or inside a room on the sketch belong to that room, with or without a heading. When the page names only one room, every line of work on it is that room's: put them under the room, never in general.
- The sketch's own markings are not work: wall lengths, a window's or door's size along a wall, door swings, a room's dimensions. Never list them as items, and never use a wall length as a line's quantity.
- What the sketch says about a room that the scope may need goes in notes, saying it is from the sketch: the ceiling height ("8'C" or "8' C" is an 8 ft ceiling), and the windows and doors written on it ("2x4 window on the 10'4 wall").
- A room drawn inside another (a closet, a bathroom) with no name of its own is part of the named room it is drawn in: do not make it a room.

Restoration shorthand you will meet (expand only where it fits): R&R remove and replace; D&R detach and reset; Rmv remove; Repl replace; AM or fans air movers; DH or dehu dehumidifier; AFD or NAM air scrubber (negative air machine); LF linear feet; SF square feet; BB or base baseboard; DW drywall; cpt carpet; LVP luxury vinyl plank; LVT luxury vinyl tile; HW hardwood; insul insulation; flood cut or FC with a height (FC 2', 2' cut) drywall cut that high up the wall; antimicrobial or anti-micro antimicrobial treatment; clean & dis clean and disinfect; Bed or bdrm bedroom; PO and PB pack-out and pack-back; manip contents manipulation; HEPA HEPA vacuuming; poly or containment plastic sheeting containment.

Numbers matter most. If a digit is unclear, write what you see and mark the line unsure; never guess a number.`;

const item = {
  type: "object",
  additionalProperties: false,
  required: ["written", "plain", "quantity", "unsure"],
  properties: {
    written: { type: "string" },
    plain: { type: "string" },
    quantity: { type: "string" },
    unsure: { type: "boolean" },
  },
};

export const SCOPE_READ_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["pageKind", "continuing", "rooms", "general", "notes", "unreadable"],
  properties: {
    pageKind: { type: "string", enum: PAGE_KINDS },
    continuing: { type: "array", items: item },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "level", "items"],
        properties: {
          name: { type: "string" },
          level: { type: "string" },
          items: { type: "array", items: item },
        },
      },
    },
    general: { type: "array", items: item },
    notes: { type: "array", items: { type: "string" } },
    unreadable: { type: "array", items: { type: "string" } },
  },
};

interface ItemWire {
  written: string;
  plain: string;
  quantity: string;
  unsure: boolean;
}

export interface ScopeReadWire {
  pageKind: ScopePageKind;
  continuing: ItemWire[];
  rooms: { name: string; level: string; items: ItemWire[] }[];
  general: ItemWire[];
  notes: string[];
  unreadable: string[];
}

/** What the call is asked, beside the page itself. */
export function scopeReadUserMessage(kind: "photo" | "pdf", page: number, pages: number): string {
  const where = pages > 1 ? ` It is page ${page} of the ${pages} the estimator uploaded together, in order.` : "";
  return kind === "pdf" ? `Read the scope in this PDF.${where}` : `Read the scope on this page.${where}`;
}

const text = (s: string | null | undefined) => (s ?? "").trim();

function itemFromWire(w: ItemWire): ScopeItem | null {
  const written = text(w.written);
  const plain = text(w.plain);
  if (!written && !plain) return null;
  return { written: written || plain, plain: plain || written, quantity: text(w.quantity) || null, unsure: !!w.unsure };
}

const items = (list: ItemWire[] | null | undefined) => (list ?? []).map(itemFromWire).filter((i): i is ScopeItem => i !== null);

/** The answer as a page read: empty strings back to nulls, empty lines and rooms dropped. */
export function scopeReadFromWire(wire: ScopeReadWire): ScopePageRead {
  return {
    version: 1,
    pageKind: PAGE_KINDS.includes(wire.pageKind) ? wire.pageKind : "other",
    continuing: items(wire.continuing),
    rooms: (wire.rooms ?? [])
      .map((r) => ({ name: text(r.name) || "Room not named", level: text(r.level) || null, items: items(r.items) }))
      .filter((r) => r.items.length > 0),
    general: items(wire.general),
    notes: (wire.notes ?? []).map(text).filter(Boolean),
    unreadable: (wire.unreadable ?? []).map(text).filter(Boolean),
  };
}

/** Why a read is no use, or null: nothing at all was read off the page. */
export function scopeReadProblem(read: ScopePageRead): string | null {
  const lines = read.continuing.length + read.general.length + read.rooms.reduce((s, r) => s + r.items.length, 0);
  return lines === 0 && read.notes.length === 0 ? "no scope found on it" : null;
}
