import type { ClaimInfo } from "./claimInfo";
import { buildScopeDocumentHeaderLines } from "./claimInfo";
import { CONSUMABLE_ITEMS, DISPOSAL_OPTIONS, type DisposalType } from "./contentsTM";
import { type ContentCleaning, buildContentCleaningSection, emptyContentCleaning } from "./contentCleaning";

/**
 * Bric-a-brac contents scope — the alternative to Time & Material (see contentsTM.ts) for claims
 * needing more granular per-room detail. Same "Contents" top-level heading and no-Claude-call
 * philosophy as T&M for this base form (per direct feedback: "we can build that part out much the
 * same as the time and material approach with the Q&A style approach") — the two are alternate
 * ways of filling in the same Contents section, not additive (a claim picks one, via
 * `contentsApproach` in app/page.tsx).
 *
 * Content cleaning (the box-based "clean and repack" shortcut, plus individually-listed items) is
 * a claim-level add-on to this, not per-room — see `lib/contentCleaning.ts` for that whole branch;
 * this file just holds it on `BricABracData.cleaning` and inserts its section into the output.
 */
export type ContentSize = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE";

export const CONTENT_SIZE_OPTIONS: { value: ContentSize; label: string }[] = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LARGE", label: "Large" },
  { value: "EXTRA_LARGE", label: "Extra Large" },
];

/** Just the box-type consumables (small/medium/large/XL + wardrobe S/M/L) — bric-a-brac's per-room "boxes used" field is specifically box counts, not the wrap/bags/poly the rest of T&M's consumables list covers. */
export const BOX_ITEMS = CONSUMABLE_ITEMS.filter((item) => item.unit === "boxes");

export interface BricABracRoom {
  /** Client-generated, for React keys and removal — never sent anywhere, not part of the generated document. */
  id: string;
  roomName: string;
  contentSize: ContentSize | null;
  /** One item per line — the count comes from the list itself (direct feedback: "providing the list does both"), no separate "how many" field. */
  unboxableItems: string;
  /** Keyed by `BOX_ITEMS[].id`. */
  boxes: Record<string, string>;
  /** Free text — anything consumable-related not covered by the fixed BOX_ITEMS list (round 8), carried into the scope verbatim. Same "discretionary catch-all" idea as contentsTM.ts's otherAdditions, scoped per room here since the rest of this consumables list already is. */
  otherConsumables: string;
  movingBlankets: string;
}

export interface BricABracData {
  rooms: BricABracRoom[];
  cleaning: ContentCleaning;
  /** Number of non-restorable items — claim-level, not per room (matches how the user originally framed it, alongside the other general charges). */
  nonRestorableCount: string;
  truckChargeCount: string;
  disposalType: DisposalType | null;
}

export function newRoomId(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyBricABracRoom(id: string): BricABracRoom {
  const boxes: Record<string, string> = {};
  for (const item of BOX_ITEMS) boxes[item.id] = "";
  return { id, roomName: "", contentSize: null, unboxableItems: "", boxes, otherConsumables: "", movingBlankets: "" };
}

/** Starts with one empty room already present — friendlier than an empty list the user has to add to before seeing what a room looks like. */
export function emptyBricABracData(): BricABracData {
  return { rooms: [emptyBricABracRoom(newRoomId())], cleaning: emptyContentCleaning(), nonRestorableCount: "", truckChargeCount: "", disposalType: null };
}

/** A positive number if `value` parses to one, else null — every field here is skippable, same convention as contentsTM.ts. */
function parsePositive(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Non-empty, trimmed lines — the list IS the count. */
function listLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function buildRoomSection(room: BricABracRoom): string | null {
  const lines: string[] = [];

  const sizeLabel = CONTENT_SIZE_OPTIONS.find((o) => o.value === room.contentSize)?.label;
  if (sizeLabel) lines.push(`    - Content size – ${sizeLabel}`);

  const items = listLines(room.unboxableItems);
  if (items.length > 0) lines.push(`    - Unboxable items – ${items.length}: ${items.join(", ")}`);

  const boxLines = BOX_ITEMS.map((item) => {
    const qty = parsePositive(room.boxes[item.id] ?? "");
    return qty !== null ? `${qty} ${item.label}` : null;
  }).filter((line): line is string => line !== null);
  if (boxLines.length > 0) lines.push(`    - Boxes – ${boxLines.join(", ")}`);

  if (room.otherConsumables.trim() !== "") lines.push(`    - Other consumables – ${room.otherConsumables.trim()}`);

  const blankets = parsePositive(room.movingBlankets);
  if (blankets !== null) lines.push(`    - Moving blankets – ${blankets}`);

  if (lines.length === 0) return null;

  const roomName = room.roomName.trim() || "Room";
  return [`  ${roomName}`, ...lines].join("\n");
}

/** The "Contents" section built from bric-a-brac data — same top-level heading as the Time & Material path, structured per-room instead of by activity. Returns "" if nothing was filled in at all. */
export function buildBricABracScopeSection(data: BricABracData): string {
  const lines: string[] = ["Contents"];

  for (const room of data.rooms) {
    const section = buildRoomSection(room);
    if (section) lines.push(section);
  }

  // `?? emptyContentCleaning()` guards the same stale-state edge case as BricABracForm.tsx's doc
  // comment describes — belt-and-suspenders on the generation path too.
  const cleaningSection = buildContentCleaningSection(data.cleaning ?? emptyContentCleaning());
  if (cleaningSection) lines.push(cleaningSection);

  const nrCount = parsePositive(data.nonRestorableCount);
  if (nrCount !== null) {
    lines.push("  Non-Restorable Content");
    lines.push(`    - ${nrCount} items`);
  }

  const truckCount = parsePositive(data.truckChargeCount);
  const disposalOption = DISPOSAL_OPTIONS.find((o) => o.value === data.disposalType);
  if (truckCount !== null || disposalOption) {
    lines.push("  Equipment");
    if (truckCount !== null) lines.push(`    - Moving van/truck charge – ${truckCount}`);
    if (disposalOption) lines.push(`    - Disposal – ${disposalOption.label}`);
  }

  // Only the "Contents" header itself made it in — nothing was actually filled in.
  if (lines.length === 1) return "";

  return lines.join("\n");
}

/** A complete scope document for a CONTENTS-only claim using the bric-a-brac approach — mirrors contentsTM.ts's buildContentsOnlyScopeDocument exactly (same header, no Claude call). */
export function buildBricABracOnlyScopeDocument(claim: ClaimInfo, data: BricABracData): string {
  const header = buildScopeDocumentHeaderLines(claim).join("\n");
  const section = buildBricABracScopeSection(data);
  return section ? `${header}\n\n${section}` : header;
}
