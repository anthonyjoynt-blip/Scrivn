/**
 * A stand-in PM: answers whatever gap-check asks, without a human and without an API call.
 *
 * Two requirements pull against each other here.
 *
 * REPRODUCIBLE — running the batch twice must produce the same answers, or the reports cannot be
 * diffed and a change in the documents cannot be attributed to a change in the code. So every answer
 * is derived from a hash of the question's id and the claim's name. No randomness, no clock, no
 * model call.
 *
 * VARIED — answering "yes" and "the first option" to everything would exercise one path through
 * rules that branch heavily on the answer, and would quietly stop testing most of them. A texture
 * answer of "smooth" and one of "texture" lead to completely different documents. So the hash picks
 * from a pool of plausible values per question, which means different rooms in one claim and
 * different claims in the batch take different branches, while any single question stays fixed.
 *
 * Every value is one a real PM could give. That matters more than it sounds: a nonsense answer that
 * parses still produces a document nobody can review by eye, and reviewing by eye is the point.
 */

/** FNV-1a. Small, dependency-free, and stable across runs and platforms — which is all that is asked of it. */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One of `options`, chosen by the seed — the same seed always lands on the same option. */
function pick(seed, options) {
  return options[hash(seed) % options.length];
}

/*
  Pools of plausible answers, by what the question is actually about.

  Keyed off the prompt rather than the id because the prompt is what a PM reads, and because a pool
  matched to the wrong question is the one failure mode here that produces a believable-looking
  report full of nonsense. Anything unmatched falls through to the kind-based defaults below, which
  are deliberately dull rather than clever.
*/
/*
  Room-sized on purpose. An early run answered a whole rec room's carpet with "6 x 8" — 48 SF, which
  parses fine and reads as nonsense on a scope, and a report full of nonsense is a report nobody
  finishes reviewing. Most floor removals land between 90 and 350 SF, so the pool does too, with one
  dimension pair kept so that path stays exercised.
*/
const AREA_ANSWERS = ["140", "half", "220", "three quarters", "320", "10 x 12", "full", "180", "quarter", "95"];
const LINEAR_ANSWERS = ["31", "half", "18", "three quarters", "44", "quarter"];
const BASEBOARD_HEIGHTS = ["3.25", "4", "5.25", "7"];
const SMALL_COUNTS = ["1", "2", "3", "0", "4"];

/**
 * The answer for one question, as a string in whatever format `applyAnswer` expects for that kind.
 *
 * `seed` should identify the claim as well as the question, so the same question in two different
 * claims can take different branches — that is where most of the variety comes from.
 */
export function answerFor(question, claimName) {
  const seed = `${claimName}::${question.id}`;
  const prompt = question.prompt.toLowerCase();
  const kind = question.kind;

  switch (kind.type) {
    case "yesNo": {
      /*
        Biased, not balanced. "Is the insulation affected" answered no in every room would never
        exercise the insulation rules at all, and answered yes in every room would never exercise
        their absence — so the pool leans yes about two thirds of the time and the seed decides.
      */
      return pick(seed, ["yes", "yes", "no"]);
    }

    case "choice": {
      // Every option is a real one the engine offered, so any of them is a valid PM answer.
      return pick(seed, kind.options);
    }

    case "wholeNumber":
      return pick(seed, SMALL_COUNTS);

    case "decimal":
      // The only decimal questions are baseboard heights; a height of "2" would be odd on a scope.
      return pick(seed, BASEBOARD_HEIGHTS);

    case "confirmOrSuggest":
      // Both outcomes are first-class: keeping the PM's own number is not a fallback.
      return pick(seed, ["keep", "adopt"]);

    case "equipmentPlan":
      // "none" is a decision the rules treat differently from a count, so it belongs in the pool.
      return pick(seed, [String(kind.suggested), "none", "3", String(kind.suggested)]);

    case "bucketCounts": {
      /*
        A tally across one or two buckets rather than all of them — a room does not usually have a
        window of every size, and spreading a count across every bucket would produce a scope no
        estimator would recognise. Counts are keyed by bucket id; see `formatBucketCounts`.
      */
      const buckets = kind.buckets;
      if (buckets.length === 0) return "";
      const first = buckets[hash(seed) % buckets.length];
      const second = buckets[hash(seed + ":2") % buckets.length];
      const counts = { [first.key]: 1 + (hash(seed + ":n") % 3) };
      if (second.key !== first.key && hash(seed + ":both") % 3 === 0) counts[second.key] = 1;
      return Object.entries(counts).map(([k, n]) => `${k}:${n}`).join(",");
    }

    case "text": {
      // A linear run and an area both arrive as free text; only the prompt distinguishes them.
      if (prompt.includes("linear feet") || prompt.includes("wall run")) return pick(seed, LINEAR_ANSWERS);
      if (prompt.includes("square feet of barrier") || prompt.includes("containment")) return pick(seed, ["8 x 10", "60", "12 x 8"]);
      if (prompt.includes("sf number") || prompt.includes("how much")) return pick(seed, AREA_ANSWERS);
      if (prompt.includes("height")) return pick(seed, BASEBOARD_HEIGHTS);
      /*
        The open-ended ones. "None" is the answer a PM gives most of the time and is explicitly
        offered by the prompt, so it belongs in the pool — but only naming something exercises the
        rule that puts the PM's own words on the scope line verbatim.
      */
      if (prompt.includes("none")) return pick(seed, ["None", "None", "Ceiling fan", "None"]);
      if (prompt.includes("construction")) return pick(seed, ["Reclaimed fir", "Bamboo"]);
      return pick(seed, ["None", "Not stated"]);
    }

    default:
      // A kind added later reaches this and is answered with something harmless rather than crashing
      // the batch; the report shows the empty answer, which is what makes it noticeable.
      return "";
  }
}
