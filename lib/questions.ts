/**
 * One outstanding follow-up question. `id` is a stable, structured address (see
 * `gapCheck.ts`'s `applyAnswer`) that identifies exactly which field the answer fills in — the UI
 * never needs to know the shape of `WaterLossExtraction` beyond rendering `prompt` and collecting
 * a value in the shape `kind` describes.
 *
 * `roomName` is null for claim-level questions (asbestos, HVAC, and the "Claim Info" group from
 * `claimInfo.ts`); every other question belongs to a room, and the UI groups by `roomName` in
 * room-mention order.
 *
 * Ported from the Android app's `model/waterloss/GapCheckQuestion.kt`.
 */
export interface GapCheckQuestion {
  id: string;
  roomName: string | null;
  prompt: string;
  kind: GapCheckQuestionKind;
  /**
   * A value already worked out, offered pre-filled for the PM to confirm or overwrite.
   *
   * Used where the moisture map has measured the thing being asked for. It is a DEFAULT, not an
   * answer: it seeds the input and counts as answered while untouched, so confirming costs nothing
   * and changing it is one edit. Nothing writes it into the tree until the answer is applied, so a
   * question the PM never reaches leaves no trace.
   */
  defaultValue?: string;
}

export type GapCheckQuestionKind =
  | { type: "yesNo"; yesLabel?: string; noLabel?: string }
  | { type: "choice"; options: string[] }
  | { type: "text" }
  | { type: "wholeNumber" }
  | { type: "decimal" }
  /**
   * Confirm what was stated, or adopt what the calculation suggests. Never a blank to fill in.
   *
   * The only question shape here that starts from an answer the PM has already given. It exists
   * because a moisture map lets the tool compute a recommendation, and a recommendation that
   * silently overwrote a PM's own count would be the tool overruling the person on site. Both
   * numbers are shown, and keeping the stated one is a first-class outcome that changes nothing.
   */
  | { type: "confirmOrSuggest"; stated: number; suggested: number; unit: string }
  /**
   * How much equipment, when the moisture map already has an opinion and the PM has not said.
   *
   * Replaces the bare "how many?" for a mapped room. Asking for a number when the calculation
   * already has one makes the PM do arithmetic the tool has done; the two answers that actually
   * matter are "that is right" and "none is needed here", so both are one tap. A number field stays
   * for the third case, because a recommendation is not a decision.
   *
   * The answer is the number as a string, or the literal "none".
   */
  | { type: "equipmentPlan"; suggested: number; unit: string }
  /**
   * A count against each of several fixed buckets, entered in one go.
   *
   * For facts that are a tally rather than a single value — how many windows of each size. Asking
   * for a count and then one size forced every window in the room into the same band, which is
   * wrong often enough to matter for pricing, and asking a size per window is N questions for a
   * thing the PM can see at a glance.
   *
   * The answer is `key:count` pairs joined by commas, e.g. `SF_3_9:1,SF_21_40:2`. Omitted buckets
   * are zero. `parseBucketCounts` is the only thing that should read it.
   */
  | { type: "bucketCounts"; buckets: { key: string; label: string }[]; unit: string }
  /**
   * Any number of the options, tapped on and off; or `none`, which clears the rest.
   *
   * For a list the PM picks from rather than one answer (owner, 2026-11-10: "I say all appliances
   * but not whats there, should be able to select fridge, range - electric or gas, dishwasher").
   * `none` is its own button so "nothing here" is a decision rather than a blank, which is
   * unanswered. The answer is the chosen labels joined by `|` — `parseMultiChoice` and
   * `formatMultiChoice` are the only things that should read or write it.
   */
  | { type: "multiChoice"; options: string[]; none: string };

/**
 * Reads a `bucketCounts` answer. Unknown keys and unparseable counts are dropped rather than
 * guessed at, and a negative is treated as absent — a tally cannot go below zero.
 */
export function parseBucketCounts(answer: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of answer.split(",")) {
    const [key, raw] = pair.split(":");
    if (key === undefined || raw === undefined) continue;
    const n = Number(raw.trim());
    if (!Number.isInteger(n) || n < 0) continue;
    out[key.trim()] = n;
  }
  return out;
}

/** The inverse, so the UI and the tests write the format in exactly one place. */
export function formatBucketCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .filter(([, n]) => Number.isInteger(n) && n > 0)
    .map(([key, n]) => `${key}:${n}`)
    .join(",");
}

/** The labels a `multiChoice` answer chose, in the order given, blanks and repeats gone. */
export function parseMultiChoice(answer: string): string[] {
  return Array.from(new Set(answer.split("|").map((part) => part.trim()).filter((part) => part !== "")));
}

/** The inverse, so the UI and the tests write the format in exactly one place. */
export function formatMultiChoice(chosen: string[]): string {
  return chosen.join("|");
}

/**
 * Whether `value` is an acceptable answer for `question` — what gates the "Continue" button.
 *
 * Every number the engine asks for is a count or a size, so none can be below zero (owner,
 * 2026-11-10: the floor-register arrows went negative). A negative is not an answer, so the question
 * stays open rather than recording one — and `applyAnswer` refuses one too, for any path that skips
 * this check.
 */
export function isQuestionAnswered(question: GapCheckQuestion, rawValue: string | undefined): boolean {
  // An untouched pre-filled question is answered: confirming a derived value is doing nothing.
  const value = rawValue ?? question.defaultValue;
  /*
    A tally answered entirely in zeroes is a real answer — "none of any size" — and its formatted
    form is the empty string, which the blank check above would otherwise reject for ever. The
    presence of the key in the answers map is what separates "typed all zeroes" from "not touched".
  */
  if (question.kind.type === "bucketCounts") return rawValue !== undefined;
  if (value === undefined || value.trim() === "") return false;
  const n = Number(value);
  if (question.kind.type === "wholeNumber") return Number.isInteger(n) && n >= 0;
  if (question.kind.type === "decimal") return Number.isFinite(n) && n >= 0;
  // A plan is the literal "none" or a count.
  if (question.kind.type === "equipmentPlan") return value === "none" || (Number.isInteger(n) && n >= 0);
  // At least one real option, or the none button.
  if (question.kind.type === "multiChoice") {
    const allowed = new Set([...question.kind.options, question.kind.none]);
    const chosen = parseMultiChoice(value);
    return chosen.length > 0 && chosen.every((c) => allowed.has(c));
  }
  return true;
}

/**
 * Everything the gap-check engine can compute in one pass over the current tree.
 *
 * `questions` is the pending list, and it is authoritative: every question on it applies, right now,
 * to the tree as it currently stands. `isComplete` is simply whether it is empty, which is what
 * makes that invariant load-bearing — a question queued before anyone could know whether it applied
 * does not merely clutter the screen, it holds the whole flow open. There is deliberately no
 * mechanism for marking a queued question skippable or optional: a question that might not apply
 * must not be generated in the first place, and `test/gapcheck/run.mjs` enforces exactly that.
 */
export interface GapCheckResult {
  isComplete: boolean;
  /** Claim-level questions first, then per-room in mention order. */
  questions: GapCheckQuestion[];
}

/* ── Answering one room for the whole property ─────────────────────────────────────────────────── */

/**
 * Questions whose answer is usually the same in every room of a building.
 *
 * Baseboard height is the clearest case — a property is very often trimmed at one height throughout,
 * so a PM answering it room by room is typing the same number five times. The same holds for what
 * the trim is made of, and for how high a flood cut runs, which is a decision made for the job
 * rather than per room.
 *
 * Deliberately NOT here: anything that genuinely varies by room. Flooring type, contents size and
 * room dimensions differ room to room as a matter of course, and offering to copy them across would
 * invite a wrong answer in four rooms to save typing in one.
 *
 * This only ever OFFERS. Nothing is copied unless the PM asks for it, every copy lands as an ordinary
 * answer they can change, and declining costs nothing — see `siblingQuestionIds`.
 */
const UNIFORM_ACROSS_ROOMS = [
  /^room:\d+:baseboard:\d+:heightIn$/,
  /^room:\d+:baseboard:\d+:material$/,
  // Both forms: the record-level action, and the one asked in the baseboard-absence chain before a
  // record exists. Missing the record-level one meant the offer never appeared on a real claim.
  /^room:\d+:baseboard:\d+:action$/,
  /^room:\d+:baseboard:action$/,
  /^room:\d+:wall:\d+:cutHeight$/,
  /^room:\d+:ceiling:\d+:finish$/,
];

export function canApplyToAllRooms(questionId: string): boolean {
  return UNIFORM_ACROSS_ROOMS.some((pattern) => pattern.test(questionId));
}

/**
 * The same question in every OTHER room, by id.
 *
 * Ids are structured and positional (`room:1:baseboard:0:heightIn`), so "the same question elsewhere"
 * is the same id with different numbers in it. Blanking every number is therefore the whole match —
 * and it deliberately spans record indices too, since a property trimmed at one height is trimmed at
 * that height on every run of baseboard, not just the first one in each room.
 */
export function siblingQuestionIds(questionId: string, round: GapCheckQuestion[]): string[] {
  if (!canApplyToAllRooms(questionId)) return [];
  const shape = (id: string) => id.replace(/\d+/g, "#");
  const target = shape(questionId);
  return round.filter((q) => q.id !== questionId && shape(q.id) === target).map((q) => q.id);
}
