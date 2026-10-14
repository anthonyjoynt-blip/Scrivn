import type { ClaimInfo } from "./claimInfo";
import { type EquipmentSuggestions, isConsolidatedEquipmentQuestion, normaliseRoomName, UNNAMED_ROOM_PLACEHOLDER } from "./gapCheck";
import type { GapCheckQuestion } from "./questions";
import { nextQuestions } from "./questionRound";
import { type ContentsManipulation, type EquipmentRecord, type Room, type WaterLossExtraction, withDerivedFields } from "./types";

/**
 * Answers already given, carried from the tree a fresh read replaces onto the tree replacing it
 * (2026-10-14).
 *
 * ── Why ───────────────────────────────────────────────────────────────────────────────────────────
 *
 * Every gap-check answer is folded into the extraction tree as it is committed — see
 * `lib/questionRound.ts`. Reading the walkthrough again (Update scope with new photo notes, or an
 * edited transcript) produces a whole new tree, and the answers went with the old one: every
 * question the new read could not settle on its own was asked again, cut heights and baseboard
 * materials the estimator had already given included. Update scope exists so a job takes fewer
 * steps; asking the same thing twice undoes it.
 *
 * ── What is carried, and what never is ────────────────────────────────────────────────────────────
 *
 * Driven by the questions, not by the fields. The engine is run on the new tree and each question
 * it asks is looked up in the old tree: if the same room's same record already has the answer, it
 * is copied in, and the engine is run again for whatever that reveals. So nothing is carried that
 * the new tree would not have asked for, and every condition a question waits on is the engine's
 * own — there is no second copy of the gating to drift.
 *
 * A value landing on the wrong record — a cut height on the wrong wall — is worse than being asked
 * again, so every match is conservative and an uncertain one carries nothing:
 *
 *   - Rooms pair by name (`normaliseRoomName`), one to one. Two rooms of one name on either side, or
 *     the "Unnamed Room" placeholder, pair with nothing.
 *   - Records pair within a room by what identifies them — a floor's material, a wall's material, a
 *     door's or cabinet's location, a fixture's type, an equipment type — and only when exactly one
 *     record on each side has it. Never by position: a record the new read inserts would otherwise
 *     take its neighbour's answers. Baseboard and countertops say nothing about themselves, so they
 *     pair only as the room's one record of the kind on both sides.
 *   - A new record that does not say what it is (a floor of no stated material) pairs only as the
 *     room's one record of the kind on both sides, and only where nothing stated on both disagrees.
 *   - Only fields the new read left empty are filled; nothing it states is ever overwritten. A value
 *     is copied only where the fields its question depends on read the same in both trees — a
 *     texture style needs the same finish, a shoe-mold answer the same baseboard action.
 *
 * Not carried, so still asked: a room named by answering "What room does this work belong to?" (the
 * new read is back to the placeholder, which pairs with nothing), a cabinet answered "It's a vanity"
 * (the old tree has it as a plumbing fixture, not as a cabinet to pair with), and the dormant kinds
 * extraction never produces (toe kicks, wall tile, outlets, light fixtures, panel, stairs).
 */

type Fields = Record<string, unknown>;

/** One question's worth of carrying. */
interface Carry {
  /**
   * The fields the answer wrote, copied together — an area and its fraction, a baseboard action and
   * the disposition it implies. The first is the one the question asks for: unset in the old tree,
   * there is no answer to carry. `either` accepts any of them, for a quantity given as a fraction.
   */
  copy: string[];
  either?: true;
  /** Fields the question is conditional on, which must read the same in both trees. */
  same?: string[];
  /** A looser condition, where reading the same is stricter than the question needs. */
  agree?: (old: Fields, now: Fields) => boolean;
}

interface RecordKind {
  list: (room: Room) => Fields[];
  set: (room: Room, list: Fields[]) => Room;
  /** What tells this record from others of its kind in a room; null when this one does not say. "" for a kind that never says. */
  key: (record: Fields) => string | null;
  /** By the field segment of the question id — `room:N:<kind>:<i>:<field>`. */
  fields: Record<string, Carry>;
}

function recordKind(list: keyof Room, key: RecordKind["key"], fields: Record<string, Carry>): RecordKind {
  return {
    list: (room) => (room[list] as unknown as Fields[] | undefined) ?? [],
    set: (room, records) => ({ ...room, [list]: records }) as Room,
    key,
    fields,
  };
}

/** Free text as it identifies something: case, spacing and a leading article are not a difference. */
function textKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^(the|a|an) /, "");
}

function enumKey(...values: unknown[]): string | null {
  return values.some((v) => v === null || v === undefined) ? null : values.join("|");
}

const REMOVAL = new Set(["REMOVE_AND_DISPOSE", "REMOVE_AND_ASSESS"]);

/** By the id segment, which is not always the list's name (`wall` → `walls`). */
const KINDS: Record<string, RecordKind> = {
  flooring: recordKind("flooring", (r) => enumKey(r.type), {
    type: { copy: ["type"] },
    disposition: { copy: ["disposition"], same: ["type"] },
    hardwoodConstruction: { copy: ["hardwoodConstruction"], same: ["type"] },
    hardwoodConstructionOther: { copy: ["hardwoodConstructionOther"], same: ["type", "hardwoodConstruction"] },
    hardwoodInstallation: { copy: ["hardwoodInstallation"], same: ["type"] },
    vinylSubtype: { copy: ["vinylSubtype"], same: ["type"] },
    vinylInstallation: { copy: ["vinylInstallation"], same: ["type", "vinylSubtype"] },
    padPresent: { copy: ["padPresent"], same: ["type", "disposition"] },
    padRemoved: { copy: ["padRemoved"], same: ["type", "disposition", "padPresent"] },
    carpetLiftSF: { copy: ["carpetLiftSF", "carpetLiftFraction"], either: true, same: ["type", "disposition", "padRemoved"] },
    padRemovedSF: { copy: ["padRemovedSF", "padRemovedFraction"], either: true, same: ["type", "disposition", "padRemoved"] },
    /*
      The area coming out is the same floor whether its replacement is decided yet or not — a photo
      note saying "replace it" moves the disposition from assess to dispose, and the area stays.
    */
    removalSF: {
      copy: ["removalSF", "removalFraction"], either: true, same: ["type"],
      agree: (old, now) => REMOVAL.has(String(old.disposition)) && REMOVAL.has(String(now.disposition)),
    },
    phase: { copy: ["phase"], same: ["type", "disposition"] },
  }),
  baseboard: recordKind("baseboard", () => "", {
    action: { copy: ["action", "disposition", "shoeMold"] },
    // The same field asks two things: coming off with a removal, or its own coat on a finish-only visit.
    shoeMold: { copy: ["shoeMold"], same: ["action"] },
    material: { copy: ["material", "mdfProfile"] },
    heightIn: { copy: ["heightIn"], same: ["action"] },
    phase: { copy: ["phase"], same: ["action"] },
  }),
  wall: recordKind("walls", (r) => enumKey(r.wallMaterial, r.drywallBeingRemoved), {
    insulationAffected: { copy: ["insulationAffected"] },
    insulationType: { copy: ["insulationType"], same: ["insulationAffected"] },
    insulationRValue: { copy: ["insulationRValue"], same: ["insulationAffected", "insulationType"] },
    cutHeight: { copy: ["cutHeight"] },
    cutRunFt: { copy: ["cutRunFt", "cutRunFraction"], either: true, same: ["cutHeight"] },
  }),
  door: recordKind("doors", (r) => textKey(r.location), {
    slabOnly: { copy: ["slabOnly"], same: ["action"] },
    doorType: { copy: ["doorType"], same: ["action"] },
    doorStyle: { copy: ["doorStyle"], same: ["action"] },
    // Worded by the style: a bifold's "panels only" and a swing door's "slab only" are one value, asked differently.
    unitType: { copy: ["unitType"], same: ["action", "doorStyle"] },
    saveHardware: { copy: ["saveHardware"], same: ["action"] },
  }),
  cabinetry: recordKind("cabinetry", (r) => textKey(r.location), {
    extent: { copy: ["extent"] },
    grade: { copy: ["grade"], same: ["action"] },
    shoringRequired: { copy: ["shoringRequired"] },
  }),
  countertop: recordKind("countertops", () => "", {
    material: { copy: ["material"] },
  }),
  ceiling: recordKind("ceilings", (r) => enumKey(r.type, r.action), {
    finish: { copy: ["finish"] },
    textureStyle: { copy: ["textureStyle"], same: ["finish"] },
    aboveInsulationAffected: { copy: ["aboveInsulationAffected"] },
    aboveInsulationType: { copy: ["aboveInsulationType"], same: ["aboveInsulationAffected"] },
    aboveInsulationRValue: { copy: ["aboveInsulationRValue"], same: ["aboveInsulationAffected", "aboveInsulationType"] },
    replaceSF: { copy: ["replaceSF", "replaceFraction"], either: true },
    detachScope: { copy: ["detachScope"] },
    tileSize: { copy: ["tileSize"] },
    mountMethod: { copy: ["mountMethod"] },
  }),
  plumbing: recordKind("plumbingFixtures", (r) => enumKey(r.fixtureType, r.action), {
    basinCount: { copy: ["basinCount"] },
    mount: { copy: ["mount"] },
    topDetached: { copy: ["topDetached"] },
    topKept: { copy: ["topKept"] },
    topMaterial: { copy: ["topMaterial"], same: ["topDetached", "topKept"] },
    includesSurround: { copy: ["includesSurround"] },
    surroundMaterial: { copy: ["surroundMaterial"], same: ["includesSurround"] },
  }),
  trim: recordKind("trim", (r) => `${r.kind}|${textKey(r.location)}`, { action: { copy: ["action"] } }),
  windowCovering: recordKind("windowCoverings", (r) => `${r.type}|${textKey(r.location)}`, { action: { copy: ["action"] } }),
  cabinetHardware: recordKind("cabinetHardware", (r) => textKey(r.location), { action: { copy: ["action"] } }),
  appliance: recordKind("appliances", (r) => enumKey(r.type), { action: { copy: ["action"] } }),
  subfloor: recordKind("subfloor", (r) => enumKey(r.type), {
    type: { copy: ["type"] },
    disposition: { copy: ["disposition"], same: ["type"] },
    removalSF: { copy: ["removalSF"], same: ["type", "disposition"] },
  }),
  // The estimator's words as extraction heard them; a re-read that words it differently is a new item.
  unscoped: recordKind("unscoped", (r) => textKey(r.description), { disposition: { copy: ["disposition"] } }),
  /*
    The plan question asks for the same count as the bare one, offered against the moisture map's
    suggestion. "Suggest" is NOT here: it is asked of a count already stated, and whether it was
    answered is `resolvedSuggestions`' business — see `carriedSuggestions`.
  */
  equipment: recordKind("equipment", (r) => textKey(r.type), {
    quantity: { copy: ["quantity"] },
    plan: { copy: ["quantity"] },
    holeCount: { copy: ["holeCount"] },
  }),
};

/** Room-level questions, by the id after `room:N:`. The four that create or settle a list are handled apart — see `carryRoomAnswer`. */
const ROOM_FIELDS: Record<string, Carry> = {
  "waterExtraction:required": { copy: ["waterExtractionRequired"] },
  "waterExtraction:sf": { copy: ["waterExtractionSF", "waterExtractionFraction"], either: true, same: ["waterExtractionRequired"] },
  "containment:sf": { copy: ["containmentSF"], same: ["containmentRequired"] },
  floorRegistersDetached: { copy: ["floorRegistersDetached"] },
  "ceilingLightFixtures:present": { copy: ["ceilingLightFixturesPresent"] },
  "ceilingLightFixtures:type": { copy: ["ceilingLightFixtureType"], same: ["ceilingLightFixturesPresent"] },
  "ceilingLightFixtures:count": { copy: ["ceilingLightFixtureCount"], same: ["ceilingLightFixturesPresent"] },
  otherCeilingFixtures: { copy: ["otherCeilingFixtures"] },
  "ceilingFixtures:inRemovalArea": { copy: ["ceilingFixturesInRemovalArea"], same: ["ceilingLightFixturesPresent", "otherCeilingFixtures"] },
  "windowCleaning:counts": { copy: ["windowCleaningCounts"], same: ["windowCleaningAsked"] },
};

/** The claim-wide ones. One loss per claim, so nothing to pair. */
const LOSS_FIELDS: Record<string, Carry> = {
  "asbestos:taken": { copy: ["asbestosSamplesTaken"] },
  "asbestos:count": { copy: ["asbestosSampleCount"], same: ["asbestosSamplesTaken"] },
  "loss:hvacInspectionRequired": { copy: ["hvacInspectionRequired"] },
};

/** Belt and braces: each pass either fills something or ends the loop. */
const MAX_PASSES = 40;

export interface CarriedAnswers {
  extraction: WaterLossExtraction;
  /** The questions the old tree answered, by their id in the new tree, in the order they were filled. */
  carried: string[];
}

/**
 * The new read with every answer the old tree can safely give it — see this file's header.
 *
 * `before` is the tree as answered so far (the page folds the answers on screen into it first);
 * `after` is the new read. `suggestions` should be the moisture map's with nothing retired, so a
 * planned equipment count is offered here whether or not its suggestion was answered.
 */
export function carryAnswers(
  claim: ClaimInfo,
  before: WaterLossExtraction,
  after: WaterLossExtraction,
  suggestions?: EquipmentSuggestions,
): CarriedAnswers {
  const old = withDerivedFields(before);
  const rooms = roomPairs(old, after);
  let tree = withDerivedFields(after);
  const carried: string[] = [];

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const open = nextQuestions(claim, tree, suggestions);
    let progressed = false;

    /*
      The job-wide equipment counts are one answer across every room, so they are carried together
      rather than question by question — see `carryConsolidated` for what is left to ask.
    */
    const consolidated = open.filter((q) => isConsolidatedEquipmentQuestion(q.id));
    if (consolidated.length > 0) {
      const next = carryConsolidated(tree, old, rooms, consolidated);
      if (next) {
        tree = next;
        carried.push(...consolidated.map((q) => q.id));
        progressed = true;
      }
    }

    // In the engine's order and against the tree as it stands, so a field filled earlier in the
    // pass is what a later one in the same pass compares its conditions against.
    for (const q of open) {
      if (isConsolidatedEquipmentQuestion(q.id)) continue;
      const next = carryAnswer(tree, old, rooms, q.id);
      if (!next) continue;
      tree = next;
      carried.push(q.id);
      progressed = true;
    }

    if (!progressed) break;
    tree = withDerivedFields(tree);
  }

  return { extraction: tree, carried };
}

/**
 * Which equipment suggestions stay answered on the new tree.
 *
 * A suggestion is retired once answered (`equipmentSuggestionKey`), and the retirement belonged to
 * the count it was weighed against. It stays only where that count is still the count: the same
 * room, one record of that type on each side, the same number. Anywhere else the new tree's own
 * count must be checked against the map again, or it would stand with nobody told.
 */
export function carriedSuggestions(before: WaterLossExtraction, after: WaterLossExtraction, resolved: string[]): string[] {
  const rooms = roomPairs(before, after);
  return resolved.filter((key) => {
    const at = key.lastIndexOf("::");
    if (at === -1) return false;
    const roomKey = key.slice(0, at);
    const type = key.slice(at + 2);
    const matches = [...rooms].filter(([now]) => normaliseRoomName(after.rooms[now]!.roomName ?? "") === roomKey);
    if (matches.length !== 1) return false;
    const [now, was] = matches[0]!;
    const counts = (room: Room) => room.equipment.filter((e) => e.type === type);
    const nowCounts = counts(after.rooms[now]!);
    const wasCounts = counts(before.rooms[was]!);
    return nowCounts.length === 1 && wasCounts.length === 1 && nowCounts[0]!.quantity !== null && nowCounts[0]!.quantity === wasCounts[0]!.quantity;
  });
}

/** New room index → old room index, for names that occur exactly once on each side. */
function roomPairs(before: WaterLossExtraction, after: WaterLossExtraction): Map<number, number> {
  const placeholder = normaliseRoomName(UNNAMED_ROOM_PLACEHOLDER);
  const indexByName = (rooms: Room[]) => {
    const seen = new Map<string, number[]>();
    rooms.forEach((room, i) => {
      const name = normaliseRoomName(room.roomName ?? "");
      seen.set(name, [...(seen.get(name) ?? []), i]);
    });
    return seen;
  };
  const was = indexByName(before.rooms);
  const pairs = new Map<number, number>();
  for (const [name, now] of indexByName(after.rooms)) {
    const old = was.get(name);
    if (name === "" || name === placeholder || now.length !== 1 || old?.length !== 1) continue;
    pairs.set(now[0]!, old[0]!);
  }
  return pairs;
}

/** The old record that is unmistakably this one, or null. */
function pairedRecord(kind: RecordKind, nowRoom: Room, oldRoom: Room, index: number): Fields | null {
  const now = kind.list(nowRoom);
  const old = kind.list(oldRoom);
  const record = now[index];
  if (!record) return null;
  const key = kind.key(record);

  if (key === null) {
    // It does not say what it is: only as the room's one record of the kind, and only where nothing stated on both disagrees.
    if (now.length !== 1 || old.length !== 1) return null;
    return disagrees(kind, record, old[0]!) ? null : old[0]!;
  }

  // A record on either side that does not say what it is could be this one too, so it counts against.
  const like = (list: Fields[]) => list.filter((r) => {
    const k = kind.key(r);
    return k === key || k === null;
  });
  const nowLike = like(now);
  const oldLike = like(old);
  if (nowLike.length !== 1 || oldLike.length !== 1) return null;
  return kind.key(oldLike[0]!) === key ? oldLike[0]! : null;
}

/** Whether two records state different things anywhere both state something. */
function disagrees(kind: RecordKind, a: Fields, b: Fields): boolean {
  const fields = new Set(Object.values(kind.fields).flatMap((c) => [...c.copy, ...(c.same ?? [])]));
  return [...fields].some((f) => isSet(a[f]) && isSet(b[f]) && !sameValue(a[f], b[f]));
}

/** The record with the old answer copied in, or null when there is none to carry safely. */
function carried(now: Fields, old: Fields, rule: Carry): Fields | null {
  const answered = rule.either ? rule.copy.some((f) => isSet(old[f])) : isSet(old[rule.copy[0]!]);
  if (!answered) return null;
  if (!(rule.same ?? []).every((f) => sameValue(old[f], now[f]))) return null;
  if (rule.agree && !rule.agree(old, now)) return null;
  // Never over anything the new read says: each field is still empty there, or already agrees.
  if (rule.copy.some((f) => isSet(now[f]) && !sameValue(now[f], old[f]))) return null;
  const next = { ...now };
  let changed = false;
  for (const f of rule.copy) {
    if (!isSet(now[f]) && isSet(old[f])) {
      next[f] = old[f];
      changed = true;
    }
  }
  return changed ? next : null;
}

function carryAnswer(tree: WaterLossExtraction, old: WaterLossExtraction, rooms: Map<number, number>, id: string): WaterLossExtraction | null {
  const loss = LOSS_FIELDS[id];
  if (loss) {
    const next = carried(tree.loss as unknown as Fields, old.loss as unknown as Fields, loss);
    return next ? { ...tree, loss: next as unknown as WaterLossExtraction["loss"] } : null;
  }

  const parts = id.split(":");
  if (parts[0] !== "room") return null;
  const n = Number(parts[1]);
  const o = rooms.get(n);
  if (o === undefined) return null;
  const nowRoom = tree.rooms[n]!;
  const oldRoom = old.rooms[o]!;

  // A record's question: `room:N:<kind>:<i>:<field>[:…]`.
  if (parts.length >= 5 && /^\d+$/.test(parts[3]!)) {
    const kind = KINDS[parts[2]!];
    const rule = kind?.fields[parts[4]!];
    if (!kind || !rule) return null;
    const index = Number(parts[3]);
    const was = pairedRecord(kind, nowRoom, oldRoom, index);
    if (!was) return null;
    const next = carried(kind.list(nowRoom)[index]!, was, rule);
    if (!next) return null;
    return withRoom(tree, n, kind.set(nowRoom, kind.list(nowRoom).map((r, i) => (i === index ? next : r))));
  }

  const room = carryRoomAnswer(nowRoom, oldRoom, parts.slice(2).join(":"));
  return room ? withRoom(tree, n, room) : null;
}

/** A room-level question, answered from the same room in the old tree. */
function carryRoomAnswer(now: Room, old: Room, field: string): Room | null {
  switch (field) {
    /*
      "What is happening with the baseboards in this room?" — asked of a room with none recorded.
      The old room's answer is its list: none ("No baseboard in this area"), or the records it has.
      The new room has none, so there is nothing to put them out of step with.
    */
    case "baseboard:action":
      if (now.baseboard.length > 0 || now.baseboardConfirmedAbsent) return null;
      if (old.baseboardConfirmedAbsent) return { ...now, baseboardConfirmedAbsent: true };
      return old.baseboard.length > 0 ? { ...now, baseboard: old.baseboard.map((b) => ({ ...b })) } : null;

    // "Was drying equipment used in this room?" — the same, for a room with no equipment recorded.
    case "equipment:used":
      if (now.equipment.length > 0 || now.equipmentAsked) return null;
      if (old.equipment.length > 0) return { ...now, equipment: old.equipment.map((e) => ({ ...e })), equipmentAsked: old.equipmentAsked };
      return old.equipmentAsked ? { ...now, equipmentAsked: true } : null;

    // Presence and the tally together: a "no" is recorded as the asked flag and an empty tally.
    case "windowCleaning:present":
      if (now.windowCleaningAsked || !old.windowCleaningAsked) return null;
      return { ...now, windowCleaningAsked: true, windowCleaningCounts: now.windowCleaningCounts ?? old.windowCleaningCounts };

    // "None — nothing to move" is recorded as manipulation declined, any other answer as a size.
    case "contents:size": {
      const was = old.contents;
      if (!was || now.contents?.manipulationDeclined === true || now.contents?.size != null) return null;
      const base: ContentsManipulation = now.contents ?? { size: null, manipulationDeclined: false, affected: false, packOutRequired: null };
      if (was.manipulationDeclined) return { ...now, contents: { ...base, manipulationDeclined: true, size: null } };
      return was.size !== null ? { ...now, contents: { ...base, size: was.size, manipulationDeclined: false } } : null;
    }

    default: {
      const rule = ROOM_FIELDS[field];
      if (!rule) return null;
      const next = carried(now as unknown as Fields, old as unknown as Fields, rule);
      return next ? (next as unknown as Room) : null;
    }
  }
}

/**
 * The job-wide equipment questions, answered room by room from the old tree.
 *
 * Each question lists the rooms with work in them (its buckets are room indices). A room's count is
 * carried when its old self says how many of the type it got: a record of the type with a count, or
 * — where the new read gives the room none of the type — no record and the old room recorded as
 * asked (it was given none).
 *
 * Any count carried states a count, which turns the job-wide questions off and the room-by-room ones
 * on, so a room left uncarried must be one those still reach: a record of the type with no count is
 * asked "how many", and a room with no equipment at all is asked whether any was used. A room with
 * other equipment but none of this type, and no old answer for it, would be reached by neither — so
 * one of those keeps every job-wide question as it is, and nothing is carried.
 */
function carryConsolidated(
  tree: WaterLossExtraction,
  old: WaterLossExtraction,
  rooms: Map<number, number>,
  questions: GapCheckQuestion[],
): WaterLossExtraction | null {
  const next = tree.rooms.map((room) => ({ ...room, equipment: [...room.equipment] }));
  let changed = false;
  for (const q of questions) {
    if (q.kind.type !== "bucketCounts") return null;
    const type = q.kind.unit;
    for (const bucket of q.kind.buckets) {
      const n = Number(bucket.key);
      const room = next[n];
      if (!room) return null;
      const o = rooms.get(n);
      const was = o === undefined ? undefined : old.rooms[o];
      const nowOfType = room.equipment.filter((e) => e.type === type);
      const oldOfType = was ? was.equipment.filter((e) => e.type === type) : [];
      if (nowOfType.length > 1 || oldOfType.length > 1) return null;
      const oldCount = oldOfType[0]?.quantity ?? null;

      if (nowOfType.length === 1) {
        // Uncarried, it is asked "how many" of its own.
        if (oldCount === null) continue;
        room.equipment = room.equipment.map((e) => (e.type === type ? { ...e, quantity: oldCount } : e));
        changed = true;
      } else if (oldCount !== null) {
        if (oldCount > 0) {
          room.equipment = [...room.equipment, { ...(oldOfType[0] as EquipmentRecord) }];
          changed = true;
        }
      } else if (!was || oldOfType.length > 0 || !was.equipmentAsked) {
        // Uncarried with nothing at all, it is asked whether any was used; with something else, it would not be asked.
        if (room.equipment.length > 0) return null;
        continue;
      }
      // Asked and answered, as the job-wide answer records every room it lists — "none" included.
      if (!room.equipmentAsked) changed = true;
      room.equipmentAsked = true;
    }
  }
  return changed ? { ...tree, rooms: next } : null;
}

function withRoom(tree: WaterLossExtraction, index: number, room: Room): WaterLossExtraction {
  return { ...tree, rooms: tree.rooms.map((r, i) => (i === index ? room : r)) };
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Plain values, and the window tally's small map — compared by content, not by key order. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isSet(a) || !isSet(b)) return !isSet(a) && !isSet(b);
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameValue((a as Fields)[k], (b as Fields)[k]));
}
