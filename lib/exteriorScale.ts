/**
 * What a scanned exterior's sizes are from (2026-10-15): the phone's own measure (Scrivn Scan's AR),
 * one side's length on a tape, or a door of a size doors are sold in that the AI trace found on a
 * side's photo. The owner, 10-14: the app names its scale reference, flags two references more than
 * 3% apart, and Scrivn says which one the sizes came from.
 *
 * Every reference is a FACTOR on the phone's own measure: a side the phone read 33'5" and the tape
 * says is 34'2" is 1.022; a garage door the phone read 15'8" x 6'10", taken for a 16' x 7', is 1.022.
 * The house's sizes are the phone's times the factor of the reference they are from
 * (`Exterior.scale`), so taking them from another scales every length and height once, by the new
 * factor over the old, and everything after - the footprint, the roof, the quantities, the
 * documents - is worked from the sizes as they then are.
 *
 * What scales is what the phone measured or was drawn on top of it: the sides (lengths, heights,
 * openings, shapes, rooflines), the photos laid on them, the overhangs read by the phone or the
 * photos, an upper floor, and the porches and gables put on the plan. A roof total or an overhang
 * TYPED is the estimator's own measure and stays as typed; a pitch is a ratio and stays too.
 *
 * A door is the weakest of the three. The trace's edges are good to about 1/2" (the owner's test of
 * 10-12), 1.4% of a 36" leaf, and a leaf stands back in its frame, so it reads a little small. A
 * garage door's 16' is the best of the doors. Each one is the estimator's to keep, size and all.
 */

import { allSides, type Exterior, type ExteriorScale, type ExteriorSide, type SidePhoto, type SizeDoor } from "./exterior";
import type { ProposedOpening } from "./exteriorTrace";
import { scaledRoofRead } from "./roofPhotoShapes";
import { formatFeetInches, newSketchId } from "./sketch";

/** A scanned house scaled to nothing - no tape, no door - said plainly on the phone and in the report (2026-10-15). */
export const NOT_SCALED = "Not scaled to a tape – sizes are the phone's own.";

/** Two references further apart than this are flagged (the owner, 10-14). */
export const SCALE_AGREE = 0.03;

export type DoorKind = SizeDoor["kind"];

/** A size doors are sold in, feet. */
export interface StandardDoor {
  widthFeet: number;
  heightFeet: number;
}

/** Garage doors, the door itself: 8' to 20' wide, 7' or 8' high. */
const GARAGE_SIZES: StandardDoor[] = [8, 9, 10, 12, 16, 18, 20].flatMap((w) => [7, 8].map((h) => ({ widthFeet: w, heightFeet: h })));
/** A door's leaf: 30" to 36" wide; 6'8", 7' or 8' high. */
const DOOR_SIZES: StandardDoor[] = [30, 32, 34, 36].flatMap((w) => [80, 84, 96].map((h) => ({ widthFeet: w / 12, heightFeet: h / 12 })));

export function standardDoors(kind: DoorKind): StandardDoor[] {
  return kind === "garage" ? GARAGE_SIZES : DOOR_SIZES;
}

/** A door further than this from a size, either way, is not taken for it: the phone is never this far out. */
const DOOR_WITHIN = 0.12;
/** Its width and height must say the same scale within this: a door read 8'6" x 7' is neither a 9' x 7' nor an 8' x 7'. */
const DOOR_SQUARE = 0.04;

/** "16' × 7' garage door", "36" × 80" door". */
export function doorLabel(kind: DoorKind, size: StandardDoor): string {
  if (kind === "garage") return `${formatFeetInches(size.widthFeet)} × ${formatFeetInches(size.heightFeet)} garage door`;
  return `${Math.round(size.widthFeet * 12)}" × ${Math.round(size.heightFeet * 12)}" door`;
}

/** A door's factor: its size over the phone's read, width and height together, so the longer counts for more. */
export function doorFactor(d: Pick<SizeDoor, "widthFeet" | "heightFeet" | "phone">): number {
  return (d.widthFeet + d.heightFeet) / (d.phone.widthFeet + d.phone.heightFeet);
}

/**
 * The sizes a door the phone read at [phoneWidth] x [phoneHeight] could be, the one whose factor is
 * nearest [near] first - the house's scale as it stands, the likeliest - each with its factor.
 */
export function standardMatches(kind: DoorKind, phoneWidthFeet: number, phoneHeightFeet: number, near = 1): { size: StandardDoor; factor: number }[] {
  if (!(phoneWidthFeet > 0 && phoneHeightFeet > 0)) return [];
  return standardDoors(kind)
    .map((size) => {
      const kw = size.widthFeet / phoneWidthFeet;
      const kh = size.heightFeet / phoneHeightFeet;
      return { size, kw, kh, factor: (size.widthFeet + size.heightFeet) / (phoneWidthFeet + phoneHeightFeet) };
    })
    .filter((m) => Math.abs(m.kw - 1) <= DOOR_WITHIN && Math.abs(m.kh - 1) <= DOOR_WITHIN && Math.abs(m.kw / m.kh - 1) <= DOOR_SQUARE)
    .sort((a, b) => Math.abs(Math.log(a.factor / near)) - Math.abs(Math.log(b.factor / near)))
    .map(({ size, factor }) => ({ size, factor }));
}

/** A door a trace found that can check the sizes: as the phone measured it, where it is, and the sizes it could be. */
export interface DoorCandidate {
  /** Its opening's key among the trace's proposals. */
  key: string;
  kind: DoorKind;
  phone: SizeDoor["phone"];
  matches: { size: StandardDoor; factor: number }[];
}

/**
 * The trace's doors that can check the sizes: a garage door traced to the door itself, and a door
 * whose leaf was traced - each read back to the phone's own measure (the sizes over the house's
 * [factor]). One no size doors are sold in fits is left out. A trace from before 2026-10-15 has none.
 */
export function doorCandidates(openings: ProposedOpening[], factor: number): DoorCandidate[] {
  const out: DoorCandidate[] = [];
  for (const o of openings) {
    const garage = o.traced === "garage door" && o.measuredTo === "door itself";
    const box = garage ? o.box : o.traced === "door" ? o.leaf : null;
    if (!box || !(factor > 0)) continue;
    const kind: DoorKind = garage ? "garage" : "door";
    const phone = { widthFeet: (box.x1 - box.x0) / factor, heightFeet: (box.y1 - box.y0) / factor, middleFeet: (box.x0 + box.x1) / 2 / factor };
    const matches = standardMatches(kind, phone.widthFeet, phone.heightFeet, factor);
    if (matches.length > 0) out.push({ key: o.key, kind, phone, matches });
  }
  return out;
}

/**
 * Doors kept as size checks onto [side]: each one in place of a door of its kind kept there before
 * within a foot of it (a side traced again), keeping that one's id, so the sizes taken from it still are.
 */
export function withSizeDoors(side: ExteriorSide, doors: Omit<SizeDoor, "id">[]): ExteriorSide {
  if (doors.length === 0) return side;
  const kept = [...(side.sizeDoors ?? [])];
  for (const d of doors) {
    const at = kept.findIndex((k) => k.kind === d.kind && Math.abs(k.phone.middleFeet - d.phone.middleFeet) < 1);
    if (at >= 0) kept[at] = { ...d, id: (kept[at] as SizeDoor).id };
    else kept.push({ ...d, id: newSketchId("door") });
  }
  return { ...side, sizeDoors: kept };
}

/** The door [doorId] no longer kept. The one the sizes are from stays: take them from another first. */
export function withoutSizeDoor(exterior: Exterior, doorId: string): Exterior {
  if (exterior.scale?.from === "door" && exterior.scale.doorId === doorId) return exterior;
  const drop = (sides: ExteriorSide[]) =>
    sides.map((s) => {
      if (!(s.sizeDoors ?? []).some((d) => d.id === doorId)) return s;
      const rest = (s.sizeDoors ?? []).filter((d) => d.id !== doorId);
      const next: ExteriorSide = { ...s, sizeDoors: rest };
      if (rest.length === 0) delete next.sizeDoors;
      return next;
    });
  return { ...exterior, sides: drop(exterior.sides), ...(exterior.upper ? { upper: { ...exterior.upper, sides: drop(exterior.upper.sides) } } : {}) };
}

// ---------------------------------------------------------------------------------------------
// The references, and which the sizes are from
// ---------------------------------------------------------------------------------------------

/** The note a Scan file read before 2026-10-15 kept its tape in. */
const OLD_TAPE_NOTE = /^Scaled to a tape by the phone \(x(\d+(?:\.\d+)?)\)\.?$/;

/** Whether a note is that old one: the sizes line says it now. */
export function isOldTapeNote(note: string): boolean {
  return OLD_TAPE_NOTE.test(note.trim());
}

/**
 * What the house's sizes are from: as kept, or for a scanned exterior read before 2026-10-15 the
 * phone's own measure, or Scan's tape where its note says so. Null for an exterior not scanned:
 * typed and drawn by hand, its sizes are the estimator's own.
 */
export function scaleOf(exterior: Exterior): ExteriorScale | null {
  if (exterior.scale) return exterior.scale;
  if (exterior.source?.kind !== "scan") return null;
  for (const note of exterior.source.notes) {
    const k = Number(OLD_TAPE_NOTE.exec(note.trim())?.[1]);
    if (Number.isFinite(k) && k > 0) return { from: "tape", factor: k };
  }
  return { from: "phone", factor: 1 };
}

/** One thing the sizes can be from, as a factor on the phone's own measure. */
export interface ScaleRef {
  /** "phone", "tape", or "door:<id>". */
  key: string;
  kind: "phone" | "tape" | "door";
  /** As said: "the phone's own measure", "the tape on the Front (34'2")", "the 16' × 7' garage door on the Front". */
  label: string;
  factor: number;
  sideId?: string;
  doorId?: string;
}

/** "on the Front", "on Side 3". */
function onSide(name: string): string {
  return /^side\s*\d/i.test(name) ? `on ${name}` : `on the ${name}`;
}

const nameOf = (side: ExteriorSide | undefined) => side?.name.trim() || "Side";

/** Every reference the house has: the phone's own measure, the tape kept, each door kept. None for an exterior not scanned. */
export function scaleRefs(exterior: Exterior): ScaleRef[] {
  const scale = scaleOf(exterior);
  if (!scale) return [];
  const sides = allSides(exterior);
  const refs: ScaleRef[] = [{ key: "phone", kind: "phone", label: "the phone's own measure", factor: 1 }];
  const tape = scale.tape;
  if (tape && tape.phoneFeet > 0 && tape.feet > 0) {
    const side = sides.find((s) => s.id === tape.sideId);
    refs.push({ key: "tape", kind: "tape", label: `the tape ${onSide(nameOf(side))} (${formatFeetInches(tape.feet)})`, factor: tape.feet / tape.phoneFeet, sideId: tape.sideId });
  } else if (scale.from === "tape") {
    refs.push({ key: "tape", kind: "tape", label: "the tape typed on the phone", factor: scale.factor });
  }
  for (const side of sides) {
    for (const d of side.sizeDoors ?? []) {
      refs.push({ key: `door:${d.id}`, kind: "door", label: `the ${doorLabel(d.kind, d)} ${onSide(nameOf(side))}`, factor: doorFactor(d), sideId: side.id, doorId: d.id });
    }
  }
  return refs;
}

/** The reference the sizes are from: null when it is a door no longer kept. */
export function currentRef(exterior: Exterior): ScaleRef | null {
  const scale = scaleOf(exterior);
  if (!scale) return null;
  const refs = scaleRefs(exterior);
  if (scale.from === "door") return refs.find((r) => r.doorId === scale.doorId) ?? null;
  return refs.find((r) => r.kind === scale.from) ?? null;
}

/** "+2.2%", "-4.5%". */
export function signedPercent(v: number): string {
  return `${v < 0 ? "-" : "+"}${Math.abs(v * 100).toFixed(1)}%`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Two references further apart than 3%, with what to check. */
export interface ScaleFlag {
  a: ScaleRef;
  b: ScaleRef;
  /** The larger factor over the smaller, less one. */
  apart: number;
  text: string;
}

/** What to check when [a] and [b] disagree, the sizes being from [now]. */
function advice(a: ScaleRef, b: ScaleRef, now: ScaleRef | null): string {
  const kinds = new Set([a.kind, b.kind]);
  if (kinds.has("phone") && kinds.has("tape")) {
    return now?.kind === "tape" ? "check the tape; if it holds, the phone read this house off, and the sizes stay from the tape" : "check the tape; if it holds, take the sizes from it";
  }
  if (kinds.has("phone")) return "check the door's size; a tape on one side settles it";
  if (kinds.has("tape")) return "check the tape, and the door's size";
  return "check both doors' sizes; a tape on one side settles it";
}

/** Every two references further apart than 3% (the owner, 10-14), each said once. */
export function scaleFlags(exterior: Exterior): ScaleFlag[] {
  const refs = scaleRefs(exterior);
  const now = currentRef(exterior);
  const flags: ScaleFlag[] = [];
  for (let i = 0; i < refs.length; i++) {
    for (let j = i + 1; j < refs.length; j++) {
      const a = refs[i] as ScaleRef;
      const b = refs[j] as ScaleRef;
      const apart = Math.max(a.factor, b.factor) / Math.min(a.factor, b.factor) - 1;
      if (!(apart > SCALE_AGREE)) continue;
      flags.push({ a, b, apart, text: `${capital(a.label)} and ${b.label} are ${(apart * 100).toFixed(1)}% apart: ${advice(a, b, now)}.` });
    }
  }
  return flags;
}

/** What the sizes are from, for a document: "the tape on the Front (34'2")". Null for an exterior not scanned. */
export function sizesFrom(exterior: Exterior): string | null {
  const scale = scaleOf(exterior);
  if (!scale) return null;
  const ref = currentRef(exterior);
  if (ref) return ref.kind === "phone" ? "the phone's own measure (Scrivn Scan)" : ref.label;
  return scale.from === "door" ? "a door no longer kept" : "a tape";
}

/** What the sizes are from, for the screen: "Sizes from the tape on the Front (34'2"), +2.2% on the phone's own measure." */
export function sizesLine(exterior: Exterior): string | null {
  const scale = scaleOf(exterior);
  const from = sizesFrom(exterior);
  if (!scale || from === null) return null;
  if (scale.from === "phone") return "Sizes from the phone's own measure.";
  return `Sizes from ${from}${Math.abs(scale.factor - 1) < 0.0005 ? ", the same as the phone's own measure" : `, ${signedPercent(scale.factor - 1)} on the phone's own measure`}.`;
}

// ---------------------------------------------------------------------------------------------
// Scaling the house
// ---------------------------------------------------------------------------------------------

/** A photo laid on a side scaled by [k]: the side's point (a, u) is where (a/k, u/k) was, so `to_photo` takes them over k. */
function scalePhoto(p: SidePhoto, k: number): SidePhoto {
  const h = p.toPhoto;
  const at = (i: number) => h[i] as number;
  return {
    ...p,
    toPhoto: [at(0) / k, at(1) / k, at(2), at(3) / k, at(4) / k, at(5), at(6) / k, at(7) / k, at(8)],
    inView: p.inView ? { ...p.inView, fromM: p.inView.fromM * k, toM: p.inView.toM * k } : null,
  };
}

function scaleSide(side: ExteriorSide, k: number): ExteriorSide {
  const out: ExteriorSide = {
    ...side,
    lengthFeet: side.lengthFeet * k,
    baseLeftFeet: side.baseLeftFeet * k,
    baseRightFeet: side.baseRightFeet * k,
    eaveLeftFeet: side.eaveLeftFeet === null ? null : side.eaveLeftFeet * k,
    eaveRightFeet: side.eaveRightFeet === null ? null : side.eaveRightFeet * k,
    gable: side.gable
      ? {
          ...side.gable,
          peakFeet: side.gable.peakFeet * k,
          atFeet: side.gable.atFeet * k,
          ...(side.gable.fromFeet !== undefined ? { fromFeet: side.gable.fromFeet * k } : {}),
          ...(side.gable.toFeet !== undefined ? { toFeet: side.gable.toFeet * k } : {}),
        }
      : null,
    bands: side.bands.map((b) => (typeof b.top === "number" ? { ...b, top: b.top * k } : b)),
    openings: side.openings.map((o) => ({ ...o, widthFeet: o.widthFeet * k, heightFeet: o.heightFeet * k, sillFeet: o.sillFeet * k, fromLeftFeet: o.fromLeftFeet * k })),
  };
  if (side.shapes) out.shapes = side.shapes.map((s) => ({ ...s, polygon: s.polygon.map((p) => ({ x: p.x * k, y: p.y * k })) }));
  if (side.roofline) out.roofline = side.roofline.map((r) => ({ alongFeet: r.alongFeet * k, upFeet: r.upFeet * k, outFeet: r.outFeet === null ? null : r.outFeet * k }));
  if (side.roofRead) {
    // Its dormers and turrets, and a floor line, scale with it too (2026-10-15).
    const r = scaledRoofRead(side.roofRead, k);
    if (typeof r.rakeOverhangFeet === "number") r.rakeOverhangFeet *= k;
    if (typeof r.eaveOverhangFeet === "number") r.eaveOverhangFeet *= k;
    out.roofRead = r;
  }
  if (side.photos) out.photos = side.photos.map((p) => scalePhoto(p, k));
  return out;
}

/**
 * Every length and height the phone measured, or that was drawn on top of it, times [k]: see the
 * top of the file for what that is. The scale's factor goes with it; what it is from does not change.
 */
export function rescaleExterior(exterior: Exterior, k: number): Exterior {
  if (!(k > 0) || !Number.isFinite(k)) return exterior;
  const roof = exterior.roof;
  const read = (which: "eave" | "rake") => roof.overhangSource?.[which] === "scan";
  const out: Exterior = {
    ...exterior,
    sides: exterior.sides.map((s) => scaleSide(s, k)),
    roof: {
      ...roof,
      ...(read("eave") ? { eaveOverhangFeet: roof.eaveOverhangFeet * k } : {}),
      ...(read("rake") ? { rakeOverhangFeet: roof.rakeOverhangFeet * k } : {}),
      ...(roof.additions
        ? { additions: roof.additions.map((a) => ({ ...a, fromFeet: a.fromFeet * k, toFeet: a.toFeet * k, ...(a.depthFeet !== undefined ? { depthFeet: a.depthFeet * k } : {}) })) }
        : {}),
    },
  };
  if (exterior.upper) out.upper = { ...exterior.upper, sides: exterior.upper.sides.map((s) => scaleSide(s, k)), at: { ...exterior.upper.at, dx: exterior.upper.at.dx * k, dy: exterior.upper.at.dy * k } };
  const scale = scaleOf(exterior);
  if (scale) out.scale = { ...scale, factor: scale.factor * k };
  return out;
}

/** What to take the sizes from: the phone, a tape typed here (a side and its length) or the tape kept, a door kept. */
export type ScaleChoice = { from: "phone" } | { from: "tape"; sideId?: string; feet?: number } | { from: "door"; doorId: string };

/**
 * The house's sizes taken from [choice]: every length and height scaled once, by its factor over the
 * one they are from now. A tape typed here is kept as THE tape, in place of any before it. Unchanged
 * when the choice is not there to take - no tape kept, a door gone - or the exterior was not scanned.
 */
export function withScaleFrom(exterior: Exterior, choice: ScaleChoice): Exterior {
  const scale = scaleOf(exterior);
  if (!scale) return exterior;
  let target: number;
  let next: ExteriorScale;
  if (choice.from === "phone") {
    target = 1;
    next = { ...scale, from: "phone" };
  } else if (choice.from === "tape" && choice.sideId !== undefined && choice.feet !== undefined) {
    const side = allSides(exterior).find((s) => s.id === choice.sideId);
    if (!side || !(choice.feet > 0) || !(side.lengthFeet > 0)) return exterior;
    const phoneFeet = side.lengthFeet / scale.factor;
    target = choice.feet / phoneFeet;
    next = { ...scale, from: "tape", tape: { sideId: side.id, feet: choice.feet, phoneFeet, by: "scrivn" } };
  } else if (choice.from === "tape") {
    const ref = scaleRefs(exterior).find((r) => r.kind === "tape");
    if (!ref) return exterior;
    target = ref.factor;
    next = { ...scale, from: "tape" };
  } else {
    const ref = scaleRefs(exterior).find((r) => r.doorId === choice.doorId);
    if (!ref) return exterior;
    target = ref.factor;
    next = { ...scale, from: "door", doorId: choice.doorId };
  }
  if (next.from !== "door") delete next.doorId;
  const k = target / scale.factor;
  const scaled = Math.abs(k - 1) < 1e-12 ? exterior : rescaleExterior(exterior, k);
  return { ...scaled, scale: { ...next, factor: target } };
}
