/**
 * The roof check (2026-10-16): the roof's parts as the outline and the photos propose them, and the
 * few taps that settle what they can't.
 *
 * The owner's house came in off photos alone with its footprint right and its roof "very wrong": one
 * 72' ridge down the east strip, no lower garage, a hip over the French-door wall. lib/roof.ts could
 * always build his roof - the 10-13 test claim did, by hand - but from a footprint it can't tell a
 * covered deck from a corner of the yard, nor a garage that ties in lower from one that runs into the
 * house's roof. His word: "id be fine having some user input if necessary for accuracy and efficiency
 * of the build". So the roof is PROPOSED from what is known, drawn, and the estimator taps only what
 * the picture shows wrong. Nothing waits on it: a part not answered is built as proposed.
 *
 * What is proposed, part by part, each only where there is something to go on:
 *   * a NOTCH the roof carries over (a covered deck in a corner of the house): when leaving it open
 *     makes some part of the roof sit lower because it has to - the roof doesn't frame as one round
 *     an open corner there - and covering it doesn't. Only a deck's or porch's depth, 4' to 12'.
 *   * a GARAGE that sits LOWER and stops at the wall: a part with a garage door whose eave, where one
 *     of its walls meets one of the house's at a corner, reads a foot or more under the house's - both
 *     above the same ground there. Standing on the house's slope it is under a GABLE of it - the
 *     owner's garage, siding between: a roof a garage wide can't sit under an eave.
 *     Only a corner they share: each side's height is above its own ground, and on the owner's lot,
 *     falling 6'5" to the back, the house's rear walls read 15'11" against the garage's 9'6" - the
 *     check said the garage was 5'4" lower, and the drawings put it there (the owner, 10-16: "It is
 *     reading the garage too low, the gap between the roofs is too great"). His garage is 1'6"-2' lower.
 *     Only a garage: on a sloping lot one wall read off a photo can put a bump-out "lower" than a
 *     house it really ties into (session A's route, 10-16).
 *
 * How much LOWER (`wingDrop`): typed on the check; else as measured at such a corner; else 1'6",
 * said to be assumed. The 3D model and every whole-house elevation set a lower roof's eave that much
 * under the eave of the roof it meets (lib/exterior3d.ts): one level for the house's roofs, not each
 * roof at the middle of what its own walls read from their own ground.
 *   * each END gable or hip: off the photos, as before (lib/exterior.ts `resolvedEnds`); a level wall
 *     top on a photo makes a hip only of an end over most of that side (lib/roof.ts `eaveSides`).
 * Porches and cross gables are the estimator's to put on (one tap on the side, its depth typed): the
 * photos read no posts yet.
 *
 * A part answered - on the check or the plan - is the three lists on the roof (`lowerWings`,
 * `wingGables`, `coveredNotches`) and its key in `answered`; one not answered takes the proposal. An
 * exterior from before the check (lists set, nothing `answered`) is left as it was: nothing proposed.
 */

import type { ExteriorRoof } from "./exterior";
import { type Pt, type RoofEndKind, type RoofInput, roofNotches, type RoofNotch, type RoofPlan, type RoofSection, roofSections } from "./roof";
import { formatFeetInches } from "./sketch";

/** A notch less deep than this either way is no deck or porch anyone stands under (the step beside a garage bay). */
export const MIN_COVERED_NOTCH_FEET = 4;
/**
 * Deeper than this both ways, a notch is a corner of the yard, not a deck under the roof, and is never
 * proposed covered: the owner's front corner, 22' x 25' between the house and the garage, would have
 * been with his deck said to be open.
 */
export const MAX_COVERED_NOTCH_DEPTH_FEET = 12;
/** A garage whose eave reads this much under the house's, where their walls meet, is proposed lower. */
export const WING_STEP_FEET = 1;
/** How far a lower roof's eave is under the eave of the roof it meets when nothing measured it: said to be assumed. */
export const DEFAULT_WING_DROP_FEET = 1.5;
/** A drop measured at a corner outside this is no garage set lower - a reading off a deck or a slope - and is not used. */
export const MIN_MEASURED_DROP_FEET = 0.5;
export const MAX_MEASURED_DROP_FEET = 6;

/** A lower roof's eave under the eave of the roof it meets, and where that came from. */
export interface WingDrop {
  feet: number;
  source: "typed" | "walls" | "assumed";
}

export type WingHow = "tie" | "lower" | "gable";
export type NotchHow = "open" | "covered";

export const wingKey = (sideId: string) => `wing:${sideId}`;
export const notchKey = (sideId: string) => `notch:${sideId}`;

/** What the proposal goes on beyond the outline: each side's eave at its ends as measured, and what is answered. */
export interface RoofEvidence {
  /**
   * Each side's eave above the ground under each of its ends, left and right, feet: where two walls meet
   * at a corner the ground under them is one, so their eaves compare there. A side with none measured is left out.
   */
  ends: Record<string, [number, number]>;
  /** The sides with a garage door on them: what makes a part a garage, the one part proposed lower. */
  garageSides: string[];
  /** Part keys answered (`ExteriorRoof.answered`). */
  answered: string[];
}

/** One part proposed other than the outline's own way: a notch covered, a wing lower. */
export interface PartProposal {
  key: string;
  value: WingHow | NotchHow;
  /** Why, in words, for the check. */
  why: string;
}

export interface RoofProposal {
  /** The roof's lists as built: what is answered, and what is proposed for the rest. */
  coveredNotches: string[];
  lowerWings: string[];
  wingGables: string[];
  proposed: PartProposal[];
}

const listWords = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/** The parts that had to sit lower - the roof doesn't frame as one there - or null when the outline doesn't come apart at all. */
function forcedOf(input: RoofInput): string[] | null {
  const built = roofSections(input);
  return built ? built.wings.filter((w) => w.forced).map((w) => w.sideId) : null;
}

/** Fewer is better; an outline that doesn't come apart is worst. */
const badness = (forced: string[] | null) => (forced === null ? Number.POSITIVE_INFINITY : forced.length);

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/**
 * The sides a section's walls are, each wholly along one of its walls - not the wall it stands on its
 * parent by (`root`), and not a side that runs on past it (one long wall under the garage and the house
 * alike says nothing of either's height).
 */
function sidesOf(input: RoofInput, w: { x0: number; x1: number; y0: number; y1: number }, root: { vertical: boolean; at: number } | null): string[] {
  const out: string[] = [];
  const n = input.corners.length;
  for (let i = 0; i < n; i++) {
    const p = input.corners[i] as Pt;
    const q = input.corners[(i + 1) % n] as Pt;
    const id = input.sideIds[i];
    if (!id) continue;
    const vertical = near(p.x, q.x);
    const at = vertical ? p.x : p.y;
    const lo = vertical ? Math.min(p.y, q.y) : Math.min(p.x, q.x);
    const hi = vertical ? Math.max(p.y, q.y) : Math.max(p.x, q.x);
    if (root && root.vertical === vertical && near(root.at, at)) continue;
    const onEdge = vertical ? near(at, w.x0) || near(at, w.x1) : near(at, w.y0) || near(at, w.y1);
    const within = vertical ? lo >= w.y0 - 1e-6 && hi <= w.y1 + 1e-6 : lo >= w.x0 - 1e-6 && hi <= w.x1 + 1e-6;
    if (onEdge && within) out.push(id);
  }
  return out;
}

/** A wing's own section, the line it stands on its parent by, and that parent. */
function wingAndParent(sections: RoofSection[], sideId: string): { wing: RoofSection; root: { vertical: boolean; at: number }; parent: RoofSection } | null {
  const wing = sections.find((s) => s.key === `wing:${sideId}` && s.wall);
  if (!wing?.wall) return null;
  const w = wing.wall;
  const joinedLo = wing.lo === "tie" || wing.lo === "wall";
  // A ridge along y stands on its parent by a wall along x (y = at), and the other way round.
  const root = wing.axis === "y" ? { vertical: false, at: joinedLo ? w.y0 : w.y1 } : { vertical: true, at: joinedLo ? w.x0 : w.x1 };
  const parent = sections.find((s) => {
    if (s === wing || !s.wall || (s.role !== "main" && s.role !== "wing")) return false;
    const P = s.wall;
    return root.vertical
      ? (near(P.x0, root.at) || near(P.x1, root.at)) && Math.min(P.y1, w.y1) - Math.max(P.y0, w.y0) > 1e-6
      : (near(P.y0, root.at) || near(P.y1, root.at)) && Math.min(P.x1, w.x1) - Math.max(P.x0, w.x0) > 1e-6;
  });
  return parent ? { wing, root, parent } : null;
}

/**
 * The roof's parts as proposed over what is said [said]: the notches to cover, then the wings to set
 * lower and the gables over them, on the roof those notches make. Each part answered stays as said.
 */
export function proposeRoof(said: RoofInput, evidence: RoofEvidence): RoofProposal {
  const answered = new Set(evidence.answered);
  const nameOf = (id: string) => said.sideNames?.[id] || "that side";
  const proposed: PartProposal[] = [];
  let input: RoofInput = said;

  // Notches: the one that most lets the roof frame as one, covered, until none helps. Judged on the outline's own
  // roof, every wing tied in: a garage said to sit lower lets an open corner frame too, round a roof that is wrong.
  const outline = (i: RoofInput): RoofInput => ({ ...i, lowerWings: [], wingGables: [] });
  for (;;) {
    const now = forcedOf(outline(input));
    if (badness(now) === 0) break;
    const covered = input.coveredNotches ?? [];
    const depth = (k: RoofNotch) => Math.min(k.x1 - k.x0, k.y1 - k.y0);
    const open = roofNotches(input).filter(
      (k) => !k.covered && !k.sideIds.some((id) => answered.has(notchKey(id))) && depth(k) >= MIN_COVERED_NOTCH_FEET - 1e-9 && depth(k) <= MAX_COVERED_NOTCH_DEPTH_FEET + 1e-9,
    );
    let best: { k: RoofNotch; input: RoofInput; forced: string[] | null } | null = null;
    for (const k of open) {
      const trial = { ...input, coveredNotches: [...covered, k.sideId] };
      const forced = forcedOf(outline(trial));
      if (badness(forced) < badness(best ? best.forced : now)) best = { k, input: trial, forced };
    }
    if (!best) break;
    input = best.input;
    const why =
      now === null
        ? "Left open, the outline doesn't come apart into parts of a roof that meet."
        : `Left open, the roof doesn't frame as one round this corner: ${now.length === 1 ? "a part of it" : `${now.length} parts of it`} would have to sit lower.`;
    proposed.push({ key: notchKey(best.k.sideId), value: "covered", why });
  }

  // Garages: lower where, at a corner their walls share with the house's, their eave reads under the house's.
  const built = roofSections(input);
  const lower = [...(input.lowerWings ?? [])];
  const gables = [...(input.wingGables ?? [])];
  for (const w of built?.wings ?? []) {
    if (w.forced || lower.includes(w.sideId) || answered.has(wingKey(w.sideId))) continue;
    const found = wingAndParent(built?.sections ?? [], w.sideId);
    if (!found) continue;
    if (!sidesOf(input, found.wing.wall as NonNullable<RoofSection["wall"]>, found.root).some((id) => evidence.garageSides.includes(id))) continue;
    const drop = measuredDrop(input, w.sideId, evidence);
    if (drop === null || drop < WING_STEP_FEET - 1e-9) continue;
    // On the other roof's slope, under a gable of it; on its end there is no gable to be under.
    const gable = w.onSlope;
    lower.push(w.sideId);
    if (gable) gables.push(w.sideId);
    const parentWords = found.parent.role === "main" ? "the house's" : `the part out to ${nameOf(found.parent.key.slice("wing:".length))}'s`;
    proposed.push({
      key: wingKey(w.sideId),
      value: gable ? "gable" : "lower",
      why: `A garage: where its walls meet ${parentWords}, its eave reads ${formatFeetInches(drop)} under theirs${gable ? `. Set lower, under a gable of the roof it meets - a roof that wide can't sit under its eave` : ""}.`,
    });
  }
  return { coveredNotches: [...(input.coveredNotches ?? [])], lowerWings: lower, wingGables: gables, proposed };
}

/**
 * How far [sideId]'s wing has its eave under the eave of the roof it meets, as the walls measure it: at
 * each corner where one of its walls meets one of that roof's, the two eaves above the one ground there,
 * the middle of them. Null where they meet at no corner with both measured.
 */
export function measuredDrop(input: RoofInput, sideId: string, evidence: Pick<RoofEvidence, "ends">): number | null {
  const built = roofSections(input);
  const found = wingAndParent(built?.sections ?? [], sideId);
  if (!found) return null;
  const { wing, root, parent } = found;
  const parentRoot = parent.role === "main" ? null : (wingAndParent(built?.sections ?? [], parent.key.slice("wing:".length))?.root ?? null);
  const own = new Set(sidesOf(input, wing.wall as NonNullable<RoofSection["wall"]>, root));
  const theirs = new Set(sidesOf(input, parent.wall as NonNullable<RoofSection["wall"]>, parentRoot));
  const n = input.sideIds.length;
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    // Side a's right end meets side b's left end.
    const a = input.sideIds[i] as string;
    const b = input.sideIds[(i + 1) % n] as string;
    const ea = evidence.ends[a];
    const eb = evidence.ends[b];
    if (!ea || !eb) continue;
    if (own.has(a) && theirs.has(b)) samples.push(eb[0] - ea[1]);
    if (theirs.has(a) && own.has(b)) samples.push(ea[1] - eb[0]);
  }
  return median(samples);
}

/**
 * Each lower roof's eave under the eave of the roof it meets [plan] - one said or proposed lower, not one
 * that has to be: typed [typed]; else as measured where their walls meet, when that is a garage's drop
 * (`MIN_MEASURED_DROP_FEET` to `MAX_MEASURED_DROP_FEET`); else `DEFAULT_WING_DROP_FEET`, assumed.
 */
export function wingDrops(input: RoofInput, plan: RoofPlan, evidence: Pick<RoofEvidence, "ends">, typed: Record<string, number>): Record<string, WingDrop> {
  const out: Record<string, WingDrop> = {};
  for (const w of plan.wings) {
    if (!w.lower || w.forced) continue;
    const said = typed[w.sideId];
    if (typeof said === "number" && Number.isFinite(said) && said >= 0) {
      out[w.sideId] = { feet: said, source: "typed" };
      continue;
    }
    const m = measuredDrop(input, w.sideId, evidence);
    out[w.sideId] = m !== null && m >= MIN_MEASURED_DROP_FEET - 1e-9 && m <= MAX_MEASURED_DROP_FEET + 1e-9 ? { feet: m, source: "walls" } : { feet: DEFAULT_WING_DROP_FEET, source: "assumed" };
  }
  return out;
}

/** A lower roof's drop typed on the check, or cleared (null) back to what the walls measure or the assumed 1'6". */
export function withWingDrop(roof: ExteriorRoof, sideId: string, feet: number | null): ExteriorRoof {
  const drops = { ...(roof.wingDrops ?? {}) };
  if (feet === null) delete drops[sideId];
  else drops[sideId] = feet;
  return { ...roof, wingDrops: drops };
}

/**
 * The layer a lower roof stands under: the roof whose wall it stops at - the main or a wing, a layer below
 * its own. Null when no roof's wall is where it stops.
 */
export function parentLayerOf(sections: RoofSection[], wing: RoofSection): number | null {
  const edge = wing.wallEdges[0];
  if (!edge) return null;
  const parent = sections.find((s) => {
    if (s === wing || !s.wall || (s.role !== "main" && s.role !== "wing") || s.layer >= wing.layer) return false;
    const P = s.wall;
    return edge.vertical
      ? (near(P.x0, edge.at) || near(P.x1, edge.at)) && Math.min(P.y1, edge.to) - Math.max(P.y0, edge.from) > 1e-6
      : (near(P.y0, edge.at) || near(P.y1, edge.at)) && Math.min(P.x1, edge.to) - Math.max(P.x0, edge.from) > 1e-6;
  });
  return parent ? parent.layer : null;
}

// ---------------------------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------------------------

/** A roof from before the check: its lists set by hand, nothing answered - all it says is in the lists. */
export function isLegacyRoof(roof: ExteriorRoof): boolean {
  return roof.answered === undefined && ((roof.lowerWings?.length ?? 0) > 0 || (roof.wingGables?.length ?? 0) > 0 || (roof.coveredNotches?.length ?? 0) > 0);
}

/** Every part of the roof as built, answered as it is: the lists the plan shows, every key in `answered`. */
function frozen(roof: ExteriorRoof, plan: RoofPlan): ExteriorRoof {
  const keys = [...plan.wings.map((w) => wingKey(w.sideId)), ...plan.notches.map((k) => notchKey(k.sideId))];
  return {
    ...roof,
    // A wing that has to sit lower is built so whatever is said: it isn't listed.
    lowerWings: plan.wings.filter((w) => w.lower && !w.forced).map((w) => w.sideId),
    wingGables: plan.wings.filter((w) => w.gable).map((w) => w.sideId),
    coveredNotches: plan.notches.filter((k) => k.covered).map((k) => k.sideId),
    answered: [...new Set([...(roof.answered ?? []), ...keys])],
  };
}

/** The first answer on a roof from before the check keeps all it says: every part answered as it is built. */
function answering(roof: ExteriorRoof, plan: RoofPlan): ExteriorRoof {
  return isLegacyRoof(roof) ? frozen(roof, plan) : roof;
}

/** A wing answered: into the roof it meets, lower under its eave, or lower under a gable of it. */
export function withWingAnswer(roof: ExteriorRoof, plan: RoofPlan, sideId: string, how: WingHow): ExteriorRoof {
  const r = answering(roof, plan);
  return {
    ...r,
    lowerWings: [...(r.lowerWings ?? []).filter((id) => id !== sideId), ...(how === "tie" ? [] : [sideId])],
    wingGables: [...(r.wingGables ?? []).filter((id) => id !== sideId), ...(how === "gable" ? [sideId] : [])],
    answered: [...new Set([...(r.answered ?? []), wingKey(sideId)])],
  };
}

/** A notch answered: open, or under the roof. Named by any of its walls, it is answered by all of them. */
export function withNotchAnswer(roof: ExteriorRoof, plan: RoofPlan, notch: Pick<RoofNotch, "sideId" | "sideIds">, how: NotchHow): ExteriorRoof {
  const r = answering(roof, plan);
  return {
    ...r,
    coveredNotches: [...(r.coveredNotches ?? []).filter((id) => !notch.sideIds.includes(id)), ...(how === "covered" ? [notch.sideId] : [])],
    answered: [...new Set([...(r.answered ?? []).filter((k) => !notch.sideIds.some((id) => k === notchKey(id))), notchKey(notch.sideId)])],
  };
}

/**
 * "Looks right" on the check: every part answered as it is built, each end nothing set or read made the
 * estimator's as it is drawn (it was a guess; now it is said), each lower roof's drop [drops] kept as it
 * stands, and when.
 */
export function withRoofChecked(roof: ExteriorRoof, plan: RoofPlan, guessedEnds: string[], at: string, drops: Record<string, WingDrop> = {}): ExteriorRoof {
  const r = frozen(roof, plan);
  const ends: Record<string, RoofEndKind> = { ...r.ends };
  for (const e of plan.ends) if (guessedEnds.includes(e.sideId) && !(e.sideId in ends)) ends[e.sideId] = e.kind;
  const kept = Object.fromEntries(Object.entries(drops).filter(([id]) => plan.wings.some((w) => w.sideId === id && w.lower)).map(([id, d]) => [id, d.feet]));
  return { ...r, ends, ...(Object.keys(kept).length > 0 ? { wingDrops: { ...kept, ...(r.wingDrops ?? {}) } } : {}), checkedAt: at };
}

// ---------------------------------------------------------------------------------------------
// The check's rows
// ---------------------------------------------------------------------------------------------

export interface CheckRow<T extends string> {
  key: string;
  label: string;
  value: T;
  options: [T, string][];
  /** Proposed, not answered: the why, in words. */
  proposed: string | null;
  /** It has to be as it is (a wing that can only sit lower): shown, not offered. */
  fixed: string | null;
}

export interface CheckRows {
  notches: (CheckRow<NotchHow> & { notch: RoofNotch })[];
  /** Each wing, and a lower one's drop under the roof it meets. */
  wings: (CheckRow<WingHow> & { sideId: string; drop: WingDrop | null })[];
}

/**
 * The notches and wings of the roof as built, each with its choices, and what was proposed for it. On the check
 * [decksOnly], only the corners a deck or porch could be (4' to 12' deep) and any already under the roof.
 */
export function checkRows(plan: RoofPlan, roof: ExteriorRoof, proposal: RoofProposal | null, nameOf: (id: string) => string, decksOnly = false, drops: Record<string, WingDrop> = {}): CheckRows {
  const answered = new Set(roof.answered ?? []);
  const proposedFor = (keys: string[]) => (proposal?.proposed ?? []).find((p) => keys.includes(p.key) && !answered.has(p.key)) ?? null;
  const depth = (k: RoofNotch) => Math.min(k.x1 - k.x0, k.y1 - k.y0);
  const notches = plan.notches
    .filter((k) => k.covered || !decksOnly || (depth(k) >= MIN_COVERED_NOTCH_FEET - 1e-9 && depth(k) <= MAX_COVERED_NOTCH_DEPTH_FEET + 1e-9))
    .map((k) => ({
      key: notchKey(k.sideId),
      notch: k,
      label: `${formatFeetInches(k.x1 - k.x0)} × ${formatFeetInches(k.y1 - k.y0)} at ${listWords(k.sideIds.map(nameOf))}`,
      value: (k.covered ? "covered" : "open") as NotchHow,
      options: [
        ["open", "Open"],
        ["covered", "Under the roof"],
      ] as [NotchHow, string][],
      proposed: proposedFor(k.sideIds.map(notchKey))?.why ?? null,
      fixed: null,
    }));
  const wings = plan.wings.map((w) => ({
    key: wingKey(w.sideId),
    sideId: w.sideId,
    label: `The part out to ${nameOf(w.sideId)}`,
    value: (w.gable ? "gable" : w.lower ? "lower" : "tie") as WingHow,
    options: [["tie", "Into the roof it meets"], ["lower", "Lower, under its eave"], ...(w.onSlope && !w.forced ? [["gable", "Lower, under a gable"]] : [])] as [WingHow, string][],
    proposed: w.forced ? null : (proposedFor([wingKey(w.sideId)])?.why ?? null),
    fixed: w.forced ? "It has to sit lower: the note under the plan says why." : null,
    drop: drops[w.sideId] ?? null,
  }));
  return { notches, wings };
}
