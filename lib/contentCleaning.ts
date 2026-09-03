/**
 * The "content cleaning" branch of the bric-a-brac contents scope (round 7, simplified round 12) —
 * fully deterministic, no Claude call needed for any of it. Per direct feedback ("we may be correct
 * to not want to import any kind of xactimate code list... instead of assigning the line items
 * codes for the person we are just putting in the description they give for these items into the
 * scope and itll be up to the estimator to sort out the correct code"), this no longer assigns or
 * looks up an actual Xactimate code for box entries — round 7 originally derived one deterministically
 * from family/size/density/intensity and cross-validated it against an imported reference list
 * (`lib/contentLineItems.ts` / `lib/data/contentLineItems.json`), both removed in round 12. The
 * structured family/size/intensity/density selectors stay (still real, useful scope detail
 * independent of any code), but now render as a plain-language description instead of a code
 * lookup. Individually-listed items already worked this way — plain list, "assigned by estimator"
 * note — so both paths are now consistent with each other.
 */
export type BoxCleanFamily = "MISC" | "BRIC_A_BRAC";
export type BoxCleanSize = "SMALL" | "MEDIUM" | "LARGE" | "EXTRA_LARGE";
export type CleanIntensity = "STANDARD" | "LIGHT" | "HEAVY";
export type Density = "STANDARD" | "LOW" | "HIGH";

export const BOX_CLEAN_FAMILY_OPTIONS: { value: BoxCleanFamily; label: string }[] = [
  { value: "MISC", label: "Misc items" },
  { value: "BRIC_A_BRAC", label: "Bric-a-brac" },
];

export const BOX_CLEAN_SIZE_OPTIONS: { value: BoxCleanSize; label: string }[] = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LARGE", label: "Large" },
  { value: "EXTRA_LARGE", label: "Extra Large" },
];

export const CLEAN_INTENSITY_OPTIONS: { value: CleanIntensity; label: string }[] = [
  { value: "STANDARD", label: "Standard" },
  { value: "LIGHT", label: "Light clean" },
  { value: "HEAVY", label: "Heavy clean" },
];

export const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "STANDARD", label: "Standard" },
  { value: "LOW", label: "Low density" },
  { value: "HIGH", label: "High density" },
];

export interface BoxCleaningEntry {
  id: string;
  family: BoxCleanFamily;
  size: BoxCleanSize;
  count: string;
  intensity: CleanIntensity;
  density: Density;
}

export function newId(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyBoxCleaningEntry(id: string): BoxCleaningEntry {
  return { id, family: "MISC", size: "MEDIUM", count: "", intensity: "STANDARD", density: "STANDARD" };
}

export interface ContentCleaning {
  isCleaningContent: boolean;
  isCleaningBoxes: boolean;
  boxEntries: BoxCleaningEntry[];
  /**
   * Free text, one item per line. Pre-filled from the bric-a-brac rooms' "larger unboxable items"
   * lists the first time cleaning is turned on (see app/page.tsx's handleToggleCleaningContent) —
   * per the plan to reuse that list rather than asking the PM to type the same items twice — and
   * freely editable after that.
   */
  individualItemsText: string;
}

export function emptyContentCleaning(): ContentCleaning {
  return { isCleaningContent: false, isCleaningBoxes: false, boxEntries: [], individualItemsText: "" };
}

function parsePositive(value: string): number | null {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Non-empty, trimmed lines — same convention as bricABrac.ts's unboxable-items list. */
export function listLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * The "Content Cleaning" sub-section of bric-a-brac's Contents output. Box entries print a plain
 * description built from the PM's own family/size/intensity/density selections — no code, no
 * lookup. Individually-listed items print as-is. Both get a shared "assigned by estimator" note at
 * the section level rather than repeating it per line. Returns null if cleaning isn't indicated, or
 * is indicated but nothing was actually filled in.
 */
export function buildContentCleaningSection(cleaning: ContentCleaning): string | null {
  if (!cleaning.isCleaningContent) return null;

  const lines: string[] = [];

  if (cleaning.isCleaningBoxes) {
    for (const entry of cleaning.boxEntries) {
      const count = parsePositive(entry.count);
      if (count === null) continue;
      const familyLabel = (BOX_CLEAN_FAMILY_OPTIONS.find((o) => o.value === entry.family)?.label ?? entry.family).toLowerCase();
      const sizeLabel = (BOX_CLEAN_SIZE_OPTIONS.find((o) => o.value === entry.size)?.label ?? entry.size).toLowerCase();
      const plural = count === 1 ? "box" : "boxes";
      // Standard/standard is the common case — only call out intensity/density when the PM actually
      // picked something other than the default, so a plain box doesn't get a cluttered qualifier.
      const qualifiers = [
        entry.intensity !== "STANDARD" ? CLEAN_INTENSITY_LABEL[entry.intensity] : null,
        entry.density !== "STANDARD" ? DENSITY_LABEL[entry.density] : null,
      ].filter((q): q is string => q !== null);
      const qualifierText = qualifiers.length > 0 ? ` – ${qualifiers.join(", ")}` : "";
      lines.push(`    - ${count} ${sizeLabel} ${familyLabel} ${plural}${qualifierText}`);
    }
  }

  const items = listLines(cleaning.individualItemsText);
  if (items.length > 0) {
    lines.push(`    - Items requiring cleaning: ${items.join(", ")}`);
  }

  if (lines.length === 0) return null;

  return ["  Content Cleaning (line items to be assigned by estimator)", ...lines].join("\n");
}

const CLEAN_INTENSITY_LABEL: Record<Exclude<CleanIntensity, "STANDARD">, string> = { LIGHT: "light clean", HEAVY: "heavy clean" };
const DENSITY_LABEL: Record<Exclude<Density, "STANDARD">, string> = { LOW: "low density", HIGH: "high density" };
