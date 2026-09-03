import { type DisposalType, DISPOSAL_OPTIONS } from "./contentsTM";

export type { DisposalType };
export { DISPOSAL_OPTIONS };

/**
 * DGIG-specific Emergency scoping, plus how its data feeds Repair (round 10, reworked round 11,
 * fields tuned round 12) — this one insurer bills Emergency work almost entirely in labor hours
 * rather than the item-based format every other insurer uses (per direct feedback: "Emergency for
 * this insurer is really broken out in labor hours").
 *
 * Filled in FIRST, before any transcript/dictation (round 11, per direct feedback: "i dont want to
 * dictate the scope, extract that and then do the hours and room section. that should happen
 * first.") — see app/page.tsx's "dgig" step, first thing after intake.
 *
 * Each room's `tearOutDescription` ("what was torn out") does double duty: it's rendered verbatim
 * as an F9 note on that room's Emergency tear-out line (see documentGenerationPrompt.ts's
 * DGIG_SCOPE_RULES), AND it's what app/page.tsx's handleContinueFromDGIGForm sends to /api/extract
 * in place of a dictated transcript — the normal extraction/gap-check pipeline then runs on it
 * exactly as it would on any transcript, producing real structured flooring/baseboard/wall/etc.
 * data. That data drives the Repair section (using the standard per-category derivation, same as
 * any non-DGIG claim) and the inspection report's MATERIALS DAMAGE/AREAS DAMAGED.
 *
 * Every field here is optional, same "skip what doesn't apply" convention as contentsTM.ts/
 * bricABrac.ts — a PM might only have tear-out hours for one room and nothing else.
 */
export type DryingClass = "1" | "2" | "3" | "4";

export const DRYING_CLASS_OPTIONS: { value: DryingClass; label: string; description: string }[] = [
  { value: "1", label: "Class 1", description: "Minimal equipment needed, e.g. drying after full tear-outs on a Cat 3 loss." },
  { value: "2", label: "Class 2", description: "Less equipment needed — applies to floors and/or lower walls less than 2' high." },
  { value: "3", label: "Class 3", description: "Moderate equipment needed — water damage to walls over 2' high and/or ceilings, i.e. water travelled from one floor to another." },
  { value: "4", label: "Class 4", description: "Specialized equipment needed, with difficult-to-dry materials such as hardwoods, ceramics, and plaster." },
];

/** Qualitative alternative to antimicrobialSF — same "exact number or qualitative extent" idea as the SF-or-fraction fields elsewhere in this app (wall cut run, carpet lift, ceiling replacement), just with the two extents that actually apply to a floor-level antimicrobial application rather than the wall/ceiling quarter/half/three-quarters scale. */
export type AntimicrobialExtent = "FULL_FLOOR" | "PARTIAL_FLOOR";

export const ANTIMICROBIAL_EXTENT_OPTIONS: { value: AntimicrobialExtent; label: string }[] = [
  { value: "FULL_FLOOR", label: "Full floor" },
  { value: "PARTIAL_FLOOR", label: "Partial area of the floor" },
];

export interface DGIGRoom {
  /** Client-generated, for React keys and removal — never sent anywhere, not part of the generated document. */
  id: string;
  roomName: string;
  tearOutHours: string;
  /** What was torn out — rendered verbatim as an F9 note on the Emergency tear-out line, AND (round 11) the source text for this room in the synthetic "transcript" sent to /api/extract in place of a dictated walkthrough — see buildDGIGSyntheticTranscript below and this file's doc comment. */
  tearOutDescription: string;
  contentManipulationHours: string;
  waterExtractionHours: string;
  cleaningHours: string;
  dryingClass: DryingClass | null;
  antimicrobial: boolean;
  /** Real SF, when a number was given — mutually exclusive with antimicrobialExtent (filling in one clears the other, same convention as bric-a-brac's disposal-type single-select). */
  antimicrobialSF: string;
  antimicrobialExtent: AntimicrobialExtent | null;
  /** Discretionary catch-all — "anything else not captured above" — pulled into the scope verbatim. */
  otherNotes: string;
}

export interface DGIGData {
  pmInspectionHours: string;
  travelHours: string;
  equipmentMonitoringHours: string;
  disposalType: DisposalType | null;
  rooms: DGIGRoom[];
}

export function newDGIGRoomId(): string {
  return Math.random().toString(36).slice(2);
}

export function emptyDGIGRoom(id: string): DGIGRoom {
  return {
    id,
    roomName: "",
    tearOutHours: "",
    tearOutDescription: "",
    contentManipulationHours: "",
    waterExtractionHours: "",
    cleaningHours: "",
    dryingClass: null,
    antimicrobial: false,
    antimicrobialSF: "",
    antimicrobialExtent: null,
    otherNotes: "",
  };
}

/** Starts with one empty room already present — same reasoning as bric-a-brac's emptyBricABracData: friendlier than an empty list the user has to add to before seeing what a room looks like. */
export function emptyDGIGData(): DGIGData {
  return { pmInspectionHours: "", travelHours: "", equipmentMonitoringHours: "", disposalType: null, rooms: [emptyDGIGRoom(newDGIGRoomId())] };
}

/**
 * The synthetic "transcript" sent to /api/extract in place of a dictated walkthrough (round 11) —
 * one line per room that has both a name and a tear-out description, "{roomName}: tear out and
 * dispose of {description}." The explicit "tear out and dispose of" framing matters: a bare
 * "{roomName}: {description}" (e.g. "Kitchen: vinyl flooring, baseboards") reads as ambiguous to
 * the extraction model about whether removal is actually happening, so disposition/action can come
 * back unset and Repair ends up empty even though the PM's intent (this field is literally labeled
 * "what was torn out") was clearly removal. Spelling out the removal verb here, once, means the PM
 * doesn't have to restate it in every room's description themselves. Rooms missing either a name or
 * a description are skipped (nothing meaningful to extract from a blank description, and a
 * description with no room name has nowhere to attach). An empty result means no room has any
 * tear-out to speak of — app/page.tsx treats that as "nothing to extract" and skips the
 * extraction/gap-check pipeline entirely rather than calling it with nothing to work from.
 */
export function buildDGIGSyntheticTranscript(data: DGIGData): string {
  return data.rooms
    .filter((r) => r.roomName.trim() !== "" && r.tearOutDescription.trim() !== "")
    .map((r) => `${r.roomName.trim()}: tear out and dispose of ${r.tearOutDescription.trim()}.`)
    .join("\n");
}

/**
 * Whether any field anywhere in `data` is actually filled in. Gates whether `dgigData` gets sent to
 * the generation call at all (see app/page.tsx) — sending an all-blank object would tell Claude to
 * suppress the standard Emergency derivation (per DGIG_SCOPE_RULES) in favor of DGIG's format,
 * producing an empty Emergency section for a DGIG claim where the PM simply hadn't filled this step
 * in yet. Falling back to the standard derivation in that case is strictly safer than an empty
 * section — though in practice this step is mandatory and first for a DGIG claim now, so this
 * mostly guards the edge case of clicking through it with nothing entered.
 */
export function hasDGIGContent(data: DGIGData): boolean {
  if (data.pmInspectionHours.trim() !== "" || data.travelHours.trim() !== "" || data.equipmentMonitoringHours.trim() !== "" || data.disposalType !== null) return true;
  return data.rooms.some(
    (r) =>
      r.tearOutHours.trim() !== "" ||
      r.tearOutDescription.trim() !== "" ||
      r.contentManipulationHours.trim() !== "" ||
      r.waterExtractionHours.trim() !== "" ||
      r.cleaningHours.trim() !== "" ||
      r.dryingClass !== null ||
      r.antimicrobial ||
      r.antimicrobialSF.trim() !== "" ||
      r.antimicrobialExtent !== null ||
      r.otherNotes.trim() !== "",
  );
}
