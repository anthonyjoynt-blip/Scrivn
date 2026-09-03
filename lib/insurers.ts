/**
 * The insurer field (`ClaimInfo.insurer`) has always been a plain free-text string — that doesn't
 * change here. This file adds a quick-fill list of the common insurers for the intake form's
 * dropdown (see `components/ClaimIntakeForm.tsx`), plus robust detection helpers for the two
 * insurers that need their own business rules elsewhere in the app: DGIG (`documentGenerationPrompt
 * .ts`'s DGIG_SCOPE_RULES + `lib/dgig.ts`) and TD (the Time & Material approval notice on the
 * contents step, `app/page.tsx`).
 *
 * Detection is substring/exact-match against whatever string ended up in `claim.insurer`, not a
 * separate enum field — the PM can either pick a name from the dropdown (which just fills the same
 * text field) or type one by hand, and both paths need to trigger the same downstream rules.
 */
export const KNOWN_INSURERS = ["Aviva", "TD", "DGIG (Desjardins)", "CAA", "AMA", "Allstate", "Co-operators", "Commonwell", "Wawanesa", "Intact"];

/**
 * DGIG and Desjardins are the same company (DGIG = Desjardins General Insurance Group) — the user
 * listed both names, so this matches either, case-insensitively, as a substring (covers "DGIG",
 * "Desjardins", "DGIG (Desjardins)" from the dropdown, or free text like "Desjardins General").
 */
export function isDGIG(insurer: string): boolean {
  const normalized = insurer.trim().toLowerCase();
  return normalized.includes("dgig") || normalized.includes("desjardins");
}

/**
 * Exact match (case-insensitive), not substring — unlike "dgig"/"desjardins", "td" is short enough
 * to false-positive inside unrelated words/names if matched as a substring.
 */
export function isTD(insurer: string): boolean {
  return insurer.trim().toLowerCase() === "td";
}
