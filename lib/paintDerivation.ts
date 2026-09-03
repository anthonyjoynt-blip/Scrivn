import type { BaseboardRecord, CeilingRecord, WallRecord } from "./types";

/**
 * The single source of truth for painting/finishing derivation — priming quantity by wall cut
 * height, and baseboard finish treatment by material and action.
 *
 * WHY THIS FILE EXISTS. These rules are needed in two very different forms:
 *
 *  1. As *instructions to a model*, inside `documentGenerationPrompt.ts`, which produces the scope
 *     document's Repair section.
 *  2. As *executable code*, here, because the Painting work order is rendered client-side from
 *     already-extracted data with no API call.
 *
 * Two expressions of one rule set is exactly how the scope document and the original mitigation
 * work order drifted apart once before. The fix is that the prompt no longer states these
 * multipliers and phrases in its own words — it interpolates the exported constants below, so the
 * numbers and wording physically cannot disagree between the two outputs.
 *
 * HONEST LIMIT OF THAT GUARANTEE: what's shared is the values and the phrasing. The *structural*
 * conditions ("fires once per room", "only when the baseboard has a Repair portion") still live in
 * the prompt's prose and in the functions here. Changing WHEN a rule fires still means changing two
 * places — so if you touch that, change both, and prefer moving any newly-shared decision into this
 * file rather than restating it.
 */

/**
 * Square feet of priming per linear foot of wall run, by cut height. A 2' cut primes a taller band
 * than the cut itself (feathering above the seam), which is why these aren't simply 2 and 4.
 * BASE is deliberately absent: a base-height cut is covered by the baseboard and left unfinished.
 */
export const PRIMING_SF_PER_LF = { TWO_FOOT: 3, FOUR_FOOT: 5 } as const;

/** Human labels for the cut heights that produce a drywall replacement line. */
export const CUT_HEIGHT_LABEL = { BASE: 'base height (up to 4")', TWO_FOOT: "2'", FOUR_FOOT: "4'", FULL_WALL: "full wall" } as const;

/** The exact finish treatment per baseboard material + action. Empty string = no line at all. */
export const BASEBOARD_FINISH_PHRASE = {
  MDF_REMOVE_AND_REPLACE: "Paint baseboards x2 coats",
  MDF_DETACH_AND_RESET: "Paint baseboards x1 coat",
  SOLID_WOOD_REMOVE_AND_REPLACE: "Stain & finish baseboards",
  SOLID_WOOD_DETACH_AND_RESET: "Finish baseboards x1 coat urethane",
} as const;

/** Rendered qualitative share, e.g. "half". Mirrors how AreaFraction reads in every other document. */
export function fractionLabel(fraction: string | null): string | null {
  switch (fraction) {
    case "QUARTER":
      return "a quarter";
    case "HALF":
      return "half";
    case "THREE_QUARTERS":
      return "three quarters";
    case "FULL":
      return "all";
    default:
      return null;
  }
}

/**
 * The priming line for one wall record, or null when the rule doesn't fire.
 *
 * Null cases, all deliberate and matching the scope document: the wall isn't being cut at all; the
 * cut is BASE (baseboard covers the seam — left unfinished); or the height is still unknown, which
 * is treated as BASE rather than guessed.
 */
export function primingLine(wall: WallRecord, markedWallSquareFeet?: number | null): string | null {
  if (!wall.drywallBeingRemoved) return null;

  /*
    A wall marked out on the sketch is measured, not estimated.

    The per-linear-foot figures below are a rule of thumb for how far a patch feathers out. Once the
    PM has pointed at the actual walls, the real answer is their full length times the room's ceiling
    height — because a wall that has been opened and patched gets finished corner to corner, or the
    repair reads as a stripe across it. The caller passes null for a base-height cut, where the patch
    hides behind the baseboard and the wall is not repainted, and the rule of thumb still applies.
  */
  if (markedWallSquareFeet != null && markedWallSquareFeet > 0) {
    return `Prime & paint – full walls – ${Math.round(markedWallSquareFeet)} SF`;
  }

  if (wall.cutHeight !== "TWO_FOOT" && wall.cutHeight !== "FOUR_FOOT") {
    // FULL_WALL primes exactly what the drywall bullet covers, qualitatively.
    return wall.cutHeight === "FULL_WALL" ? "Prime & paint – full wall" : null;
  }

  if (wall.cutRunFt !== null) {
    const sf = wall.cutRunFt * PRIMING_SF_PER_LF[wall.cutHeight];
    /*
      Names the surface, like every other line here does — "full walls", "the wall run", "full wall".
      This branch was the one exception, and it is the one that produces a bare square footage, so it
      was the only priming line an estimator could not tell from a ceiling's by reading it.
    */
    return `Prime & paint walls – ${sf} SF`;
  }
  const fraction = fractionLabel(wall.cutRunFraction);
  // Never invent a number from a fraction — state it qualitatively instead.
  return fraction ? `Prime & paint – ${fraction} of the wall run` : "Prime & paint – wall run";
}

/**
 * The finish line for one baseboard record, or null when the rule doesn't fire.
 *
 * Null cases: SHOE_MOLD_ONLY (no Repair portion to finish), vinyl/PVC composite (never painted),
 * and an unknown material (guessing a finish would put the wrong product on a crew's sheet).
 */
export function baseboardFinishLine(baseboard: BaseboardRecord): string | null {
  const { material, action } = baseboard;
  if (action !== "REMOVE_AND_REPLACE" && action !== "DETACH_AND_RESET") return null;
  if (material !== "MDF" && material !== "SOLID_WOOD") return null;
  return BASEBOARD_FINISH_PHRASE[`${material}_${action}` as keyof typeof BASEBOARD_FINISH_PHRASE] ?? null;
}

/**
 * The prime-and-paint line for one ceiling record, or null when the rule doesn't fire.
 *
 * A replaced ceiling gets primed and painted, and nothing was saying so — not the scope document,
 * not the Painting work order, which covered walls and baseboard and skipped ceilings entirely. So a
 * ceiling could be torn out and reinstalled across a whole claim with no finishing line anywhere,
 * which reads to an estimator as a ceiling that does not need painting rather than one nobody
 * costed. Reported directly: "priming and painting is also not populating for this drywall work."
 *
 * TEXTURE is deliberately null. Those ceilings already carry their own finishing bullet — "prime and
 * spray new texture" / "prime and apply new knockdown texture" — so a second line here would bill
 * the priming twice. Only the smooth case had nothing.
 *
 * The quantity says "of ceiling" for the same reason `ceilingQuantity` does: a bare SF figure on a
 * line that does not name its surface is the one an estimator has to go back and ask about.
 */
export function ceilingPaintLine(ceiling: CeilingRecord): string | null {
  if (ceiling.type !== "DRYWALL_PLASTER" || ceiling.action !== "REMOVE_AND_REPLACE") return null;
  if (ceiling.finish !== "SMOOTH") return null;
  return `Prime & paint ceiling – ${ceilingQuantity(ceiling)}`;
}

/**
 * How much ceiling, in the words the scope uses.
 *
 * "of ceiling" is carried on the SF branch as well as the fraction one. The fraction branch always
 * read "half of the ceiling" while a real measurement rendered as a bare "120 SF", so the two halves
 * of the same field described themselves differently and the measured one — the precise one — was
 * the one that did not say what it was measuring.
 */
export function ceilingQuantity(ceiling: CeilingRecord): string {
  if (ceiling.replaceSF !== null) return `${ceiling.replaceSF} SF of ceiling`;
  const fraction = fractionLabel(ceiling.replaceFraction);
  return fraction ? `${fraction} of the ceiling` : "ceiling";
}
