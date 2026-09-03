import type { ClaimInfo } from "./claimInfo";
import { buildScopeDocumentHeaderLines } from "./claimInfo";

/**
 * Time & Material contents scope — the fully-known-up-front alternative to the (larger, still
 * unbuilt) bric-a-brac contents pipeline; see the round-7 discussion. Every field here is
 * something the user types directly — nothing needs inferring from a transcript — so this is
 * formatted straight into text client-side. No gap-check, no Claude call at all: same reasoning
 * already applied to Job Information (see `lib/jobInformation.ts`'s doc comment).
 *
 * Every field is optional/skippable by design, per the user's own framing ("walk the user through
 * what's needed with options to skip or not include anything along the way") —
 * `buildContentsScopeSection` omits any subheading with nothing under it entirely, rather than
 * printing an empty one. On-Site Manipulation in particular gets its own subheading only when
 * used — a claim with no on-site manipulation hours jumps straight to Pack Out, no empty heading
 * in between (direct feedback, round 7).
 */
export interface ContentsTM {
  onSiteManipulationHours: string;
  packOutHours: string;
  packBackHours: string;
  /** Keyed by `ConsumableItem.id` — see `CONSUMABLE_ITEMS`. */
  consumables: Record<string, string>;
  truckChargeCount: string;
  disposalType: DisposalType | null;
  /** Free text — sub-trade items or anything else not covered above, dropped into the scope verbatim. */
  otherAdditions: string;
}

export type DisposalType = "PICK_UP" | "DUMP_TRAILER" | "DUMPSTER_12YD" | "DUMPSTER_20YD" | "DUMPSTER_40YD";

export const DISPOSAL_OPTIONS: { value: DisposalType; label: string }[] = [
  { value: "PICK_UP", label: "Pick up" },
  { value: "DUMP_TRAILER", label: "Dump trailer" },
  { value: "DUMPSTER_12YD", label: "Dumpster – 12 yd" },
  { value: "DUMPSTER_20YD", label: "Dumpster – 20 yd" },
  { value: "DUMPSTER_40YD", label: "Dumpster – 40 yd" },
];

export interface ConsumableItem {
  id: string;
  label: string;
  unit: string;
}

/**
 * Matches the user's own line-item list verbatim (round 7) — order preserved so the form reads the
 * same way — plus mattress bags/boxes (round 8, a standard consumable the original list missed).
 */
export const CONSUMABLE_ITEMS: ConsumableItem[] = [
  { id: "smallBoxes", label: "Small boxes (1.25–1.6 cu ft)", unit: "boxes" },
  { id: "mediumBoxes", label: "Medium boxes (1.7–3.5 cu ft)", unit: "boxes" },
  { id: "largeBoxes", label: "Large boxes (3.3–4.5 cu ft)", unit: "boxes" },
  { id: "extraLargeBoxes", label: "Extra large boxes (4.6–6.25 cu ft)", unit: "boxes" },
  { id: "wardrobeBoxesSmall", label: "Wardrobe boxes, small", unit: "boxes" },
  { id: "wardrobeBoxesMedium", label: "Wardrobe boxes, medium", unit: "boxes" },
  { id: "wardrobeBoxesLarge", label: "Wardrobe boxes, large", unit: "boxes" },
  { id: "mattressBagSingle", label: "Mattress bag/box, single", unit: "boxes" },
  { id: "mattressBagDouble", label: "Mattress bag/box, double", unit: "boxes" },
  { id: "mattressBagQueen", label: "Mattress bag/box, queen", unit: "boxes" },
  { id: "mattressBagKing", label: "Mattress bag/box, king", unit: "boxes" },
  { id: "garbageBags", label: "Garbage bags", unit: "bags" },
  { id: "clearLaundryBags", label: "Clear/laundry bags", unit: "bags" },
  { id: "bubbleWrap", label: "Bubble wrap", unit: "LF" },
  { id: "shrinkWrap5x1000", label: "Shrink wrap, 5\" × 1000' roll", unit: "EA" },
  { id: "shrinkWrap20x1000", label: "Shrink wrap, 20\" × 1000' roll", unit: "EA" },
  { id: "poly", label: "Poly to protect/drape contents", unit: "SF" },
];

export function emptyContentsTM(): ContentsTM {
  const consumables: Record<string, string> = {};
  for (const item of CONSUMABLE_ITEMS) consumables[item.id] = "";
  return {
    onSiteManipulationHours: "",
    packOutHours: "",
    packBackHours: "",
    consumables,
    truckChargeCount: "",
    disposalType: null,
    otherAdditions: "",
  };
}

/** A positive number if `value` parses to one, else null. Every ContentsTM field is skippable, so blank or zero always means "leave this out," never "zero of this." */
function parsePositive(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * The "Contents" section of the scope document, as its own top-level heading with activity-based
 * subheadings (not phase-based — see the round-7 discussion: contents doesn't get nested under
 * Emergency/Repair the way structural work does). Returns "" if nothing was filled in at all, so
 * callers can skip adding it rather than appending a header with nothing under it.
 */
export function buildContentsScopeSection(tm: ContentsTM): string {
  const lines: string[] = ["Contents"];

  const manipHours = parsePositive(tm.onSiteManipulationHours);
  if (manipHours !== null) {
    lines.push("  On-Site Manipulation");
    lines.push(`    - Labor hours – on-site manipulation – ${manipHours} hrs`);
  }

  const packOutHours = parsePositive(tm.packOutHours);
  const consumableLines = CONSUMABLE_ITEMS.map((item) => {
    const qty = parsePositive(tm.consumables[item.id] ?? "");
    return qty !== null ? `    - ${item.label} – ${qty} ${item.unit}` : null;
  }).filter((line): line is string => line !== null);
  if (packOutHours !== null || consumableLines.length > 0) {
    lines.push("  Pack Out");
    if (packOutHours !== null) lines.push(`    - Labor hours – pack out – ${packOutHours} hrs`);
    lines.push(...consumableLines);
  }

  const packBackHours = parsePositive(tm.packBackHours);
  if (packBackHours !== null) {
    lines.push("  Pack Back");
    lines.push(`    - Labor hours – pack back – ${packBackHours} hrs`);
  }

  const truckCount = parsePositive(tm.truckChargeCount);
  const disposalOption = DISPOSAL_OPTIONS.find((o) => o.value === tm.disposalType);
  if (truckCount !== null || disposalOption) {
    lines.push("  Equipment");
    if (truckCount !== null) lines.push(`    - Moving van/truck charge – ${truckCount}`);
    if (disposalOption) lines.push(`    - Disposal – ${disposalOption.label}`);
  }

  if (tm.otherAdditions.trim() !== "") {
    lines.push("  Other");
    lines.push(`    - ${tm.otherAdditions.trim()}`);
  }

  // Only the "Contents" header itself made it in — nothing was actually filled in.
  if (lines.length === 1) return "";

  return lines.join("\n");
}

/**
 * A complete scope document for a Contents-only claim (see claimInfo.ts's `isContentsOnly`) — this
 * never touches the transcript/extraction/gap-check pipeline at all (a pure contents assignment has
 * no rooms or structural damage to describe), so there's no Claude call anywhere in
 * this path either. The header line mirrors documentGenerationPrompt.ts's SCOPE_DOCUMENT_SECTION
 * template exactly, built from claim state instead of generated, for the same reason
 * lib/jobInformation.ts exists.
 */
export function buildContentsOnlyScopeDocument(claim: ClaimInfo, tm: ContentsTM): string {
  const header = buildScopeDocumentHeaderLines(claim).join("\n");
  const contentsSection = buildContentsScopeSection(tm);
  return contentsSection ? `${header}\n\n${contentsSection}` : header;
}
