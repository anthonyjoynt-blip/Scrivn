/**
 * The extraction detail pass.
 *
 *   npm run test:extraction
 *
 * Extraction is two calls now — structure, then detail — because the main schema hit Anthropic's
 * compiled-grammar ceiling and could not take one more field of any size. See `schema.ts`.
 *
 * The second call returns a PARALLEL ARRAY, matched to the first call's tree by position. That is
 * what keeps its grammar small enough to compile, and it is also the whole risk: if the two ever
 * disagree about shape, position means nothing and detail lands on the wrong record. A cut height on
 * the wrong wall is a wrong number in an insurer's scope that nobody will re-check, because nothing
 * about it looks wrong. A missing one gets asked by gap-check half a minute later.
 *
 * So most of what is below is about refusing to guess.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "extraction-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});

const { mergeDetail, needsDetailPass, extractionDetailUserMessage, normalizeStoredExtraction, mergeUnscoped, needsUnscopedPass, capturedSummary, extractionUnscopedUserMessage, mergeSupplement, needsSupplementPass, extractionSupplementUserMessage } = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}

/* ── Fixtures ──────────────────────────────────────────────────────────────────────────────────── */

function flooring(type, overrides = {}) {
  return {
    type, carpetStyle: null, padPresent: null, vinylSubtype: null, vinylInstallation: null, vinylSubstrate: null,
    hardwoodConstruction: null, hardwoodInstallation: null, disposition: "REMOVE_AND_DISPOSE", phase: null,
    phaseUncertain: false, padRemoved: null, removalSF: null, removalFraction: null, cleaningRequired: null,
    carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null,
    padRemovedFraction: null, ...overrides,
  };
}
function baseboard(overrides = {}) {
  return { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, shoeMold: null, phase: null, phaseUncertain: false, mdfProfile: null, ...overrides };
}
function wall(overrides = {}) {
  return { wallMaterial: "DRYWALL", drywallBeingRemoved: true, insulationAffected: null, insulationType: null, insulationRValue: null, floodCutHeightIn: null, cutHeight: null, cutRunFt: null, cutRunFraction: null, ...overrides };
}
function ceiling(overrides = {}) {
  return {
    type: "DRYWALL_PLASTER", action: "REMOVE_AND_REPLACE", finish: null, textureStyle: null, spaceAboveHasInsulation: false,
    aboveInsulationAffected: null, aboveInsulationType: null, aboveInsulationRValue: null, detachScope: null, tileSize: null,
    mountMethod: null, replaceSF: null, replaceFraction: null, ...overrides,
  };
}
function room(name, overrides = {}) {
  return { roomName: name, antimicrobialApplied: null, containmentRequired: null, containmentSF: null, hepaVacuumingRequired: null, temporaryPowerRequired: null, appliances: [], trim: [], windowCoverings: [], cabinetHardware: [], subfloor: [], unscoped: [], waterExtractionRequired: null, waterExtractionSF: null, waterExtractionFraction: null, flooring: [], baseboard: [], walls: [], ceilings: [], doors: [], cabinetry: [], toeKicks: [], countertops: [], wallTile: [], outlets: [], lightFixtures: [], electricalPanel: null, plumbingFixtures: [], stairs: null, floorRegistersDetached: null, contents: null, equipment: [], ...overrides };
}
const tree = (rooms) => ({ loss: {}, rooms });

/*
  Antimicrobial is room-level with no record to key off, so "is it worth a second call" is true for
  every room until it has been asked once — which is correct, and does mean the pass now runs for
  essentially every claim that has rooms at all. The assertions below each test ONE trigger, so they
  settle the always-on ones first; otherwise they would all pass for the wrong reason.
*/
const settled = (r) => ({
  ...r,
  antimicrobialApplied: false,
  hepaVacuumingRequired: false,
  containmentRequired: false,
  flooring: (r.flooring ?? []).map((f) => ({ ...f, cleaningRequired: f.cleaningRequired ?? false })),
});

const BEDROOM = room("Bedroom", {
  flooring: [flooring("CARPET")],
  baseboard: [baseboard()],
  walls: [wall()],
  ceilings: [ceiling()],
});

/** A detail entry for a room with one of each record — the shape call 2 is asked to return. */
function detailRoom(overrides = {}) {
  return {
    flooring: [{ carpetStyle: "BERBER", hardwoodConstruction: "UNKNOWN", hardwoodInstallation: "UNKNOWN", vinylInstallation: "UNKNOWN", removalSF: -1, cleaningRequired: "UNKNOWN" }],
    baseboard: [{ material: "VINYL_PVC_COMPOSITE", mdfProfile: "UNKNOWN", shoeMold: "UNKNOWN" }],
    walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }],
    ceilings: [{ textureStyle: "UNKNOWN", aboveInsulationAffected: "YES", aboveInsulationType: "UNKNOWN" }],
    doors: [],
    cabinetry: [],
    lightFixturesPresent: "UNKNOWN",
    lightFixtureCount: -1,
    antimicrobialApplied: "UNKNOWN",
    containmentRequired: "UNKNOWN",
    containmentSF: -1,
    hepaVacuumingRequired: "UNKNOWN",
    temporaryPowerRequired: "UNKNOWN",
    appliances: [],
    trim: [],
    windowCoverings: [],
    cabinetHardware: [],
    subfloor: [],
    unscoped: [],
    ...overrides,
  };
}

const FULL_DETAIL = { rooms: [detailRoom()] };


/* ── How much floor is coming out ──────────────────────────────────────────────────────────────── */

/*
  Reported: "6 by 8 feet" of vinyl plank — a real 48 SF — rendered in the scope as "small area at the
  dishwasher". Flooring carried no removal quantity at all, so an exact figure the PM stated had
  nowhere to land and generation used the qualitative fallback it reaches for when nothing is known.
*/
const removalRoom = tree([room("Kitchen", { flooring: [flooring("VINYL")] })]);
const withArea = mergeDetail(removalRoom, { rooms: [detailRoom({ flooring: [{ ...detailRoom().flooring[0], removalSF: 48 }], baseboard: [], walls: [], ceilings: [] })] });
check(withArea.rooms[0].flooring[0].removalSF === 48, `a stated area lands on the record (got ${withArea.rooms[0].flooring[0].removalSF})`);

const sentinel = mergeDetail(removalRoom, { rooms: [detailRoom({ flooring: [{ ...detailRoom().flooring[0], removalSF: -1 }], baseboard: [], walls: [], ceilings: [] })] });
check(sentinel.rooms[0].flooring[0].removalSF === null, "the not-stated sentinel stays null, so gap-check asks rather than scoping -1 SF");

/*
  Zero is rejected with the sentinel. A floor being removed has an area, so "0 SF" is the model
  failing to state one — and "Remove vinyl – 0 SF" on a scope reads as a decision rather than a gap,
  which means nobody ever asks about it.
*/
const zero = mergeDetail(removalRoom, { rooms: [detailRoom({ flooring: [{ ...detailRoom().flooring[0], removalSF: 0 }], baseboard: [], walls: [], ceilings: [] })] });
check(zero.rooms[0].flooring[0].removalSF === null, "zero is treated as not-stated, not as a measured nothing");

/*
  A removal area landing on a floor being lifted and reinstalled would put a tear-out figure on a
  floor that is being saved — the kind of wrong number that reads as deliberate.
*/
const liftRoom = tree([room("Lounge", { flooring: [flooring("CARPET", { disposition: "LIFT_AND_REINSTALL" })] })]);
const onLift = mergeDetail(liftRoom, { rooms: [detailRoom({ flooring: [{ ...detailRoom().flooring[0], removalSF: 48 }], baseboard: [], walls: [], ceilings: [] })] });
check(onLift.rooms[0].flooring[0].removalSF === null, "a removal area is refused on a lift-and-reinstall record");

// And the detail pass has to be worth making for a claim whose only gap is this.
check(
  needsDetailPass(tree([room("Kitchen", { flooring: [flooring("VINYL", { vinylSubtype: "SHEET" })] })])),
  "a plain vinyl tear-out with no area now triggers the detail pass",
);
check(
  !needsDetailPass(tree([settled(room("Kitchen", { flooring: [flooring("VINYL", { vinylSubtype: "SHEET", removalSF: 48 })] }))])),
  "and one whose area is already known does not",
);

/* ── The detail actually lands ─────────────────────────────────────────────────────────────────── */

const merged = mergeDetail(tree([BEDROOM]), FULL_DETAIL);
const r = merged.rooms[0];
check(r.flooring[0].carpetStyle === "BERBER", `carpet style merges (got ${r.flooring[0].carpetStyle})`);
check(r.baseboard[0].material === "VINYL_PVC_COMPOSITE", `baseboard material merges (got ${r.baseboard[0].material})`);
check(r.walls[0].cutHeight === "TWO_FOOT", `cut height merges (got ${r.walls[0].cutHeight})`);
check(r.ceilings[0].aboveInsulationAffected === true, `insulation above merges (got ${r.ceilings[0].aboveInsulationAffected})`);
// UNKNOWN is "the transcript did not say", which must stay null rather than becoming the string.
check(r.walls[0].insulationType === null, `an UNKNOWN stays null rather than being recorded (got ${r.walls[0].insulationType})`);
check(r.baseboard[0].mdfProfile === null, `and so does an UNKNOWN profile (got ${r.baseboard[0].mdfProfile})`);

/* ── Misalignment is discarded, never guessed at ───────────────────────────────────────────────── */

/*
  The single most damaging failure available here: detail applied to the wrong record. Every one of
  these hands back a shape that does not match, and every one must leave the room untouched.
*/
const misaligned = [
  ["one wall too many", detailRoom({ walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }, { cutHeight: "FULL_WALL", insulationType: "UNKNOWN" }] })],
  ["a missing flooring entry", detailRoom({ flooring: [] })],
  ["no ceilings at all", detailRoom({ ceilings: [] })],
  // Doors and cabinetry joined the detail pass later; a mismatch in either must discard the room
  // exactly as one in the original four does.
  ["an extra door", detailRoom({ doors: [{ doorType: "COLONIAL", unitType: "PRE_HUNG" }] })],
  ["an extra cabinetry run", detailRoom({ cabinetry: [{ extent: "UPPERS" }] })],
];
for (const [label, roomDetail] of misaligned) {
  const out = mergeDetail(tree([BEDROOM]), { rooms: [roomDetail] }).rooms[0];
  const untouched =
    out.flooring[0].carpetStyle === null &&
    out.baseboard[0].material === null &&
    out.walls[0].cutHeight === null &&
    out.ceilings[0].aboveInsulationAffected === null;
  check(untouched, `${label}: the whole room is left alone rather than partly merged`);
}

// A short rooms array leaves the rooms it does not cover alone, rather than shifting up into them.
const twoRooms = tree([BEDROOM, room("Closet", { flooring: [flooring("CARPET")] })]);
const shortMerge = mergeDetail(twoRooms, FULL_DETAIL);
check(shortMerge.rooms[0].flooring[0].carpetStyle === "BERBER", "a covered room still merges");
check(shortMerge.rooms[1].flooring[0].carpetStyle === null, "and an uncovered room is untouched, not shifted into");

// Nothing at all, and garbage, both have to be survivable — this pass can never fail the extraction.
for (const [label, detail] of [["an empty response", { rooms: [] }], ["a missing rooms array", {}]]) {
  const out = mergeDetail(tree([BEDROOM]), detail).rooms[0];
  check(out.walls[0].cutHeight === null && out.flooring[0].carpetStyle === null, `${label} leaves the tree intact`);
}

/* ── Call 1 always wins where the two overlap ──────────────────────────────────────────────────── */

const alreadyKnown = tree([room("Bedroom", { flooring: [flooring("CARPET", { carpetStyle: "PILE" })], baseboard: [], walls: [], ceilings: [] })]);
const overridden = mergeDetail(alreadyKnown, {
  rooms: [detailRoom({ flooring: [{ carpetStyle: "BERBER", hardwoodConstruction: "UNKNOWN", hardwoodInstallation: "UNKNOWN", vinylInstallation: "UNKNOWN" }], baseboard: [], walls: [], ceilings: [] })],
});
check(
  overridden.rooms[0].flooring[0].carpetStyle === "PILE",
  `the detail pass never overwrites what call 1 already captured (got ${overridden.rooms[0].flooring[0].carpetStyle})`,
);


/* ── Antimicrobial and floor cleaning ──────────────────────────────────────────────────────────── */

/*
  Reported: a transcript saying "antimicrobial throughout both spaces" produced an inspection report
  that said so and a scope with no antimicrobial line in either room. Same for a concrete floor the
  PM said to clean and treat. Both facts had no home in the tree at all — antimicrobial existed only
  on DGIG's Emergency form — and the report is written with the transcript in hand while the scope's
  line rules see only this tree. That asymmetry is the whole bug, and it is the third instance of it
  (drying equipment was the first).
*/
const bareRoom = room("Storage", { flooring: [flooring("CONCRETE", { disposition: "DRY_IN_PLACE", removalSF: 120 })] });
check(needsDetailPass(tree([bareRoom])), "a room that has never been asked about antimicrobial needs the pass");
check(
  needsDetailPass(tree([{ ...bareRoom, antimicrobialApplied: false }])),
  "and a floor that stays still needs asking whether it is being cleaned",
);

const detailWith = (over) => ({ rooms: [detailRoom({ flooring: [{ ...detailRoom().flooring[0], ...over.flooring }], baseboard: [], walls: [], ceilings: [], ...over.room })] });
const withAntimicrobial = mergeDetail(tree([room("Storage", { flooring: [flooring("CONCRETE")] })]), detailWith({ room: { antimicrobialApplied: "YES" } }));
check(withAntimicrobial.rooms[0].antimicrobialApplied === true, "antimicrobial merges onto the room");
const withoutAntimicrobial = mergeDetail(tree([room("Storage", { flooring: [flooring("CONCRETE")] })]), detailWith({ room: { antimicrobialApplied: "UNKNOWN" } }));
check(withoutAntimicrobial.rooms[0].antimicrobialApplied === null, "and an unstated one stays null rather than becoming a false");

const cleaned = mergeDetail(tree([room("Storage", { flooring: [flooring("CONCRETE")] })]), detailWith({ flooring: { cleaningRequired: "YES" } }));
check(cleaned.rooms[0].flooring[0].cleaningRequired === true, "a floor being cleaned merges onto the record");

/* ── When the second call is worth making ──────────────────────────────────────────────────────── */

check(needsDetailPass(tree([BEDROOM])), "a room with carpet, baseboard, walls and a ceiling needs the pass");
check(!needsDetailPass(tree([])), "a claim with no rooms does not");
/*
  `removalSF` is set on both fixtures below on purpose. Every floor coming out now has an area worth
  asking for, whatever it is made of, so a bare tear-out is no longer a claim with nothing to ask —
  these two still test what they always tested (the call is skipped when there is genuinely nothing
  left), they just have to say so with the area already known.
*/
check(
  !needsDetailPass(tree([settled(room("Utility", { flooring: [flooring("CONCRETE", { removalSF: 120 })] }))])),
  "and neither does a bare concrete floor whose area is already known",
);
check(
  needsDetailPass(tree([room("Hall", { flooring: [flooring("CARPET")] })])),
  "carpet alone is enough, since only carpet has a style",
);
check(
  !needsDetailPass(tree([settled(room("Hall", { flooring: [flooring("CARPET", { carpetStyle: "BERBER", removalSF: 200 })] }))])),
  "but not once that style is already known",
);
check(
  !needsDetailPass(tree([settled(room("Store", { walls: [wall({ drywallBeingRemoved: false })] }))])),
  "a wall with no drywall coming off has no cut height to ask about",
);
check(
  needsDetailPass(tree([room("Store", { walls: [wall({ drywallBeingRemoved: true })] })])),
  "one that does, does",
);

/* ── The prompt states the shape it expects back ───────────────────────────────────────────────── */

/*
  The counts in the message are the only thing telling the model what shape to return, and the merge
  discards anything that comes back different — so a message that failed to state them would degrade
  silently into "the detail pass never works" rather than into an error.
*/
const message = extractionDetailUserMessage("some transcript", tree([BEDROOM, room("Closet", { flooring: [flooring("CARPET")] })]));
check(message.includes("1. Bedroom — 1 flooring, 1 baseboard, 1 wall, 1 ceiling"), `the message states the first room's counts:\n${message.slice(0, 300)}`);
check(message.includes("2. Closet — 1 flooring, 0 baseboard, 0 wall, 0 ceiling"), "and the second room's, zeroes included");
check(message.includes("some transcript"), "and carries the transcript");


/* ── The fields added after three separate bug reports ─────────────────────────────────────────── */

/*
  Hardwood installation, door spec, cabinetry extent and light-fixture presence were all being ASKED
  of PMs who had already stated them — the transcript said so, but the fact had nowhere to live in
  the tree, so gap-check could not see it. Each of these is that gap closed.
*/
const SPEC_ROOM = room("Spec", {
  flooring: [flooring("HARDWOOD")],
  doors: [{ location: "Closet", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, doorStyle: null, unitType: null, saveHardware: null }],
  cabinetry: [{ location: "Upper run", action: "REMOVE_AND_REPLACE", extent: null, grade: null }],
});
const specDetail = {
  rooms: [{
    flooring: [{ carpetStyle: "UNKNOWN", hardwoodConstruction: "ENGINEERED", hardwoodInstallation: "GLUED", vinylInstallation: "UNKNOWN" }],
    baseboard: [], walls: [], ceilings: [],
    doors: [{ doorType: "HOLLOW_CORE", unitType: "SLAB_ONLY" }],
    cabinetry: [{ extent: "UPPERS" }],
    lightFixturesPresent: "YES",
    lightFixtureCount: 1,
  }],
};
const spec = mergeDetail(tree([SPEC_ROOM]), specDetail).rooms[0];
check(spec.flooring[0].hardwoodInstallation === "GLUED", `"glued down" reaches the tree (got ${spec.flooring[0].hardwoodInstallation})`);
check(spec.flooring[0].hardwoodConstruction === "ENGINEERED", `and so does the construction (got ${spec.flooring[0].hardwoodConstruction})`);
check(spec.doors[0].doorType === "HOLLOW_CORE" && spec.doors[0].unitType === "SLAB_ONLY", "door type and unit type merge");
check(spec.cabinetry[0].extent === "UPPERS", `cabinetry extent merges (got ${spec.cabinetry[0].extent})`);
check(spec.ceilingLightFixturesPresent === true, `light fixtures are known present without being asked (got ${spec.ceilingLightFixturesPresent})`);
check(spec.ceilingLightFixtureCount === 1, `and counted (got ${spec.ceilingLightFixtureCount})`);

// The sentinel for "no number stated" must not become a count of -1 in somebody's scope.
const noCount = mergeDetail(tree([SPEC_ROOM]), { rooms: [{ ...specDetail.rooms[0], lightFixtureCount: -1 }] }).rooms[0];
check(noCount.ceilingLightFixtureCount === null, `an unstated count stays null, never -1 (got ${noCount.ceilingLightFixtureCount})`);

// These are the reason the pass fires at all now — a hardwood floor alone should trigger it.
check(needsDetailPass(tree([room("H", { flooring: [flooring("HARDWOOD")] })])), "a hardwood floor alone warrants the detail pass");
check(needsDetailPass(tree([room("D", { doors: [{ location: "x", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, doorStyle: null, unitType: null, saveHardware: null }] })])), "as does a door with no spec");

/* ── Shoe mold ───────────────────────────────────────────────────────────────────────────────────

  Whether the quarter round comes off with the baseboard. In call 2 because call 1's `action` enum
  could not hold the combination and call 1 has no grammar to spare for a second field — so "both
  the baseboard and the shoe mold" produced a record identical to a room with no shoe mold at all.
*/
const SHOE_ROOM = room("Living Room", { baseboard: [baseboard({ action: "REMOVE_AND_REPLACE" })] });
const shoeDetail = (shoeMold) => ({
  rooms: [{ ...detailRoom(), flooring: [], walls: [], ceilings: [], baseboard: [{ material: "SOLID_WOOD", mdfProfile: "UNKNOWN", shoeMold }] }],
});

check(mergeDetail(tree([SHOE_ROOM]), shoeDetail("YES")).rooms[0].baseboard[0].shoeMold === true, "a stated shoe mold lands on the record");
check(mergeDetail(tree([SHOE_ROOM]), shoeDetail("NO")).rooms[0].baseboard[0].shoeMold === false, "and so does a stated absence — it is not the same as nobody asking");
check(
  mergeDetail(tree([SHOE_ROOM]), shoeDetail("UNKNOWN")).rooms[0].baseboard[0].shoeMold === null,
  "an unstated one stays null so gap-check asks, rather than a shoe appearing that nobody mentioned",
);
check(
  needsDetailPass(tree([settled(room("B", { baseboard: [baseboard({ action: "REMOVE_AND_REPLACE", material: "MDF" })] }))])),
  "a baseboard coming off with no shoe answer warrants the pass, even once everything else is settled",
);
check(
  !needsDetailPass(tree([settled(room("B", { baseboard: [baseboard({ action: "SHOE_MOLD_ONLY", material: "MDF" })] }))])),
  "but a shoe-mold-only job does not — the shoe IS the job, so there is nothing to ask",
);

/* ── Trim ────────────────────────────────────────────────────────────────────────────────────────

  Trim is the second list call 2 produces outright, and it exists because a batch of test
  transcripts lost every casing, jamb, sill and return — one of them by turning a warped jamb into a
  whole pre-hung door. So the assertions below are less about the merge mechanics than about the two
  things that make the category worth having: it arrives at all, and it never becomes something else.
*/
const TRIM_ROOM = room("Hall");
const trimDetail = (trim) => ({ rooms: [{ ...detailRoom(), flooring: [], baseboard: [], walls: [], ceilings: [], trim }] });

const withTrim = mergeDetail(tree([TRIM_ROOM]), trimDetail([
  { kind: "WINDOW_SILL", location: "front window", action: "REMOVE_AND_REPLACE" },
  { kind: "DOOR_CASING", location: "closet door", action: "DETACH_AND_RESET" },
])).rooms[0];
check(withTrim.trim.length === 2, `both trim entries survive the merge (got ${withTrim.trim.length})`);
check(withTrim.trim[0]?.kind === "WINDOW_SILL" && withTrim.trim[0]?.action === "REMOVE_AND_REPLACE", "a rotted sill comes through as a replacement");
check(withTrim.trim[1]?.location === "closet door", "the location survives, since it is what tells two casings apart");
check(withTrim.doors.length === 0, "and nothing about trim creates a door — the whole point of the category");

const unknownAction = mergeDetail(tree([TRIM_ROOM]), trimDetail([{ kind: "WINDOW_CASING", location: "", action: "UNKNOWN" }])).rooms[0];
check(unknownAction.trim[0]?.action === null, "an unstated action stays null so gap-check asks, rather than guessing a direction");

const badKind = mergeDetail(tree([TRIM_ROOM]), trimDetail([{ kind: "SKIRTING", location: "x", action: "DETACH_AND_RESET" }])).rooms[0];
check(badKind.trim.length === 0, "a kind that is not in the enum is dropped, never kept with a guessed one");

/* ── Unscoped work: the third call ─────────────────────────────────────────────────────────────────

  The catch-all. The auditor's control transcript dictates tile and outlets, neither of which has a
  schema slot, and both vanished with nothing in the trace to say they were ever heard. This is the
  trace: the PM's words, kept as written, arriving with no disposition so a person decides.

  A call of its own, not a list on the detail pass — one string array there was enough to put call
  2 over the compiled-grammar ceiling, and the pass failed soft into a claim with no detail at all.
*/
const UNSCOPED_ROOM = room("Basement bathroom");
const sweep = (unscoped) => ({ rooms: [{ unscoped }] });

const heard = mergeUnscoped(tree([UNSCOPED_ROOM]), sweep([
  "Remove tub-surround tile and the soaked backer board behind it",
  "replace two outlets on the wet wall",
])).rooms[0];
check(heard.unscoped.length === 2, `both items arrive (got ${heard.unscoped.length})`);
check(heard.unscoped[0]?.description === "Remove tub-surround tile and the soaked backer board behind it", "in the PM's words, untouched");
check(heard.unscoped[1]?.description === "replace two outlets on the wet wall", "including their case — the app does not rewrite these");
check(heard.unscoped.every((u) => u.disposition === null), "and every one arrives undecided, so the gap-check asks the PM about each");

const untidy = mergeUnscoped(tree([UNSCOPED_ROOM]), sweep(["  Remove   tile ", "", "   ", "Remove tile", "Replace outlets", 42])).rooms[0];
check(untidy.unscoped.length === 2, `blanks, non-strings and duplicates are dropped — the same job twice is the same job on the document twice (got ${untidy.unscoped.map((u) => u.description).join(" | ")})`);
check(untidy.unscoped[0]?.description === "Remove tile", "with whitespace tidied, which is the one edit allowed");

check(mergeUnscoped(tree([UNSCOPED_ROOM]), sweep([])).rooms[0].unscoped.length === 0, "an empty list is the common case and stays empty");
check(mergeUnscoped(tree([UNSCOPED_ROOM]), { rooms: [{}] }).rooms[0].unscoped.length === 0, "and a reply that omitted the field is not a crash");
check(mergeUnscoped(tree([UNSCOPED_ROOM]), null).rooms[0].unscoped.length === 0, "nor is no reply at all");

const already = mergeUnscoped(tree([room("Basement bathroom", { unscoped: [{ description: "kept from a saved claim", disposition: "REPAIR" }] })]), sweep(["something new"])).rooms[0];
check(already.unscoped.length === 1 && already.unscoped[0]?.disposition === "REPAIR", "a room that already carries placed items keeps them — a re-run never resets a decision");

const twoRoomSweep = tree([room("Kitchen"), room("Hall")]);
const sweepMisaligned = mergeUnscoped(twoRoomSweep, sweep(["Replace outlets"]));
check(sweepMisaligned.rooms.every((r) => r.unscoped.length === 0), "a reply with the wrong number of rooms is discarded whole, never attached to the wrong room");
const aligned = mergeUnscoped(twoRoomSweep, { rooms: [{ unscoped: [] }, { unscoped: ["Sand the stair treads"] }] });
check(aligned.rooms[0].unscoped.length === 0 && aligned.rooms[1].unscoped[0]?.description === "Sand the stair treads", "and a matching reply lands each list on its own room");

check(needsUnscopedPass(tree([room("Anything")])) === true && needsUnscopedPass(tree([])) === false, "the pass runs for any claim with rooms and not for one without");

/*
  What the call is shown: everything the first two passes captured, by name, so "do not duplicate"
  is a matter of reading a list rather than of judgement. Every kind of record a room can hold must
  appear here — a kind left out of the summary is a kind the sweep will faithfully report as missing.
*/
const full = room("Kitchen", {
  flooring: [{ type: "VINYL", disposition: "REMOVE_AND_DISPOSE", cleaningRequired: null }],
  subfloor: [{ type: "SLEEPER_SYSTEM", disposition: "REMOVE_AND_REPLACE", removalSF: null }],
  baseboard: [{ material: "MDF", action: "REMOVE_AND_REPLACE", shoeMold: true }],
  walls: [{ drywallBeingRemoved: true, insulationAffected: true }],
  ceilings: [{ type: "DRYWALL_PLASTER", action: "REMOVE_AND_REPLACE", aboveInsulationAffected: false }],
  doors: [{ location: "closet", doorStyle: "BIFOLD", action: "REMOVE_AND_REPLACE", saveHardware: true }],
  trim: [{ kind: "WINDOW_SILL", location: "front window", action: "REMOVE_AND_REPLACE" }],
  cabinetry: [{ location: "sink run", action: "REMOVE_AND_REPLACE", shoringRequired: true }],
  cabinetHardware: [{ location: "sink run", action: "DETACH_AND_RESET" }],
  countertops: [{ material: "LAMINATE", action: "DETACH_AND_RESET" }],
  toeKicks: [{ action: "REMOVE_AND_REPLACE" }],
  plumbingFixtures: [{ fixtureType: "BATHROOM_VANITY", action: "DETACH_AND_RESET", topDetached: true, sinkFaucetSaved: true, includesSurround: false }],
  windowCoverings: [{ type: "BLIND", location: "front window", action: "DETACH_AND_RESET" }],
  appliances: [{ type: "FRIDGE", action: "DETACH_AND_RESET" }],
  equipment: [{ type: "air movers", quantity: 3, holeCount: null }, { type: "injecti-dry units", quantity: 1, holeCount: 12 }],
  floorRegistersDetached: 2,
  windowCleaningCounts: { SMALL: 2 },
  ceilingLightFixturesPresent: true,
  contents: { size: null, manipulationDeclined: false, affected: true },
  waterExtractionRequired: true,
  antimicrobialApplied: true,
  containmentRequired: true,
  hepaVacuumingRequired: true,
  temporaryPowerRequired: true,
});
const summary = capturedSummary(full).join("\n");
for (const [kind, hint] of [
  ["flooring", "vinyl"], ["subfloor", "sleeper"], ["baseboard", "mdf"], ["wall", "drywall coming out"], ["ceiling", "drywall plaster"],
  ["door", "bifold"], ["trim", "window sill"], ["cabinetry", "shoring"], ["cabinet hardware", "sink run"], ["countertop", "laminate"],
  ["toe kick", "remove and replace"], ["plumbing fixture", "bathroom vanity"], ["window covering", "blind"], ["appliance", "fridge"], ["equipment", "air movers"],
  ["floor registers", "× 2"], ["ceiling light fixtures", ""], ["contents", "moved"], ["water extraction", ""], ["antimicrobial", ""],
  ["containment", ""], ["HEPA vacuuming", ""], ["temporary power", ""],
  // The work-like details on a record, each of which the sweep reported as missing until it was named here.
  ["hardware saved and reset", ""], ["12 injection holes drilled and filled", ""], ["countertop detached and reset", ""], ["sink and faucet saved", ""],
  ["windows cleaned after drywall work", ""],
]) {
  check(summary.includes(kind) && summary.includes(hint), `the captured summary names ${kind}${hint ? ` (${hint})` : ""} — a kind left out is one the sweep would report as missing (got:\n${summary})`);
}
check(summary.includes("insulation affected") && summary.includes("with shoe mold"), "and the details that are their own line items — insulation, shoe mold — are named too");
check(capturedSummary(room("Bare")).length === 0, "a room with nothing captured has an empty summary");

const sweepMessage = extractionUnscopedUserMessage("the transcript", tree([room("Kitchen", { equipment: [{ type: "air movers", quantity: 3, holeCount: null }] }), room("Hall")]));
check(sweepMessage.includes("Return exactly 2 entries"), "the message states the room count, since the reply is positional");
check(sweepMessage.indexOf("1. Kitchen") < sweepMessage.indexOf("2. Hall"), "rooms in order");
check(sweepMessage.includes("- equipment — air movers — × 3"), `each room lists what it holds (got:\n${sweepMessage.split("Transcript:")[0]})`);
check(sweepMessage.includes("(nothing captured for this room)"), "and says so for a room holding nothing, rather than leaving a gap the model might read as an error");
check(sweepMessage.trim().endsWith("the transcript"), "with the transcript last, after the list it is to be read against");

/* ── The supplement: the fourth call ────────────────────────────────────────────────────────────────

  The second detail pass, born of call 2 being proved full twice in a day. Two ASKED_ANYWAY findings
  from the control transcript: "how much vinyl?" after "the whole room", and "was water extracted?"
  after "we extracted standing water off the whole floor". A number goes in the SF field, words in
  the fraction, never both — which is what AreaFraction has always meant.
*/
const VINYL_OUT = room("Basement bathroom", { flooring: [flooring("VINYL", { disposition: "REMOVE_AND_DISPOSE" })] });
const supp = (rooms) => ({ rooms });
const roomSupp = (over = {}) => ({ flooring: [{ removalFraction: "UNKNOWN" }], waterExtractionRequired: "UNKNOWN", waterExtractionSF: -1, waterExtractionFraction: "UNKNOWN", ...over });

const wholeRoom = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }] })])).rooms[0];
check(wholeRoom.flooring[0]?.removalFraction === "FULL", `"the whole room" lands as FULL on the floor being removed (got ${wholeRoom.flooring[0]?.removalFraction})`);
check(wholeRoom.flooring[0]?.removalSF === null, "and leaves the SF empty — exactly one of the pair is ever set");

const numbered = mergeSupplement(tree([room("Basement bathroom", { flooring: [flooring("VINYL", { disposition: "REMOVE_AND_DISPOSE", removalSF: 120 })] })]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }] })])).rooms[0];
check(numbered.flooring[0]?.removalFraction === null && numbered.flooring[0]?.removalSF === 120, "a floor that already has a number keeps the number and takes no fraction — the number is the one an estimator can use");

const kept = mergeSupplement(tree([room("Basement bathroom", { flooring: [flooring("VINYL", { disposition: "REMOVE_AND_DISPOSE", removalFraction: "HALF" })] })]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }] })])).rooms[0];
check(kept.flooring[0]?.removalFraction === "HALF", "a fraction already on the record is never overwritten");

const staying = mergeSupplement(tree([room("Basement bathroom", { flooring: [flooring("CARPET", { disposition: "LIFT_AND_REINSTALL" })] })]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }] })])).rooms[0];
check(staying.flooring[0]?.removalFraction === null, "no removal extent lands on a floor that is being saved, whatever the model said");

check(mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ flooring: [{ removalFraction: "MOST" }] })])).rooms[0].flooring[0]?.removalFraction === null, "a value outside the enum is dropped, never trusted");

const extracted = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ waterExtractionRequired: "YES", waterExtractionFraction: "FULL" })])).rooms[0];
check(extracted.waterExtractionRequired === true && extracted.waterExtractionFraction === "FULL" && extracted.waterExtractionSF === null, `"extracted standing water off the whole floor" lands as required + FULL (got ${extracted.waterExtractionRequired} / ${extracted.waterExtractionFraction})`);

const measured = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ waterExtractionRequired: "YES", waterExtractionSF: 200, waterExtractionFraction: "FULL" })])).rooms[0];
check(measured.waterExtractionSF === 200 && measured.waterExtractionFraction === null, "a stated area wins over a stated fraction for extraction too");

const noneNeeded = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ waterExtractionRequired: "NO", waterExtractionFraction: "FULL" })])).rooms[0];
check(noneNeeded.waterExtractionRequired === false && noneNeeded.waterExtractionFraction === null, "\"nothing to extract\" is recorded as a no, and no extent lands on extraction that did not happen");

const unmentioned = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ waterExtractionFraction: "FULL" })])).rooms[0];
check(unmentioned.waterExtractionRequired === null && unmentioned.waterExtractionFraction === null, "extraction never mentioned stays open for the gap-check to ask, and an extent without a yes is ignored");

const answered = mergeSupplement(tree([room("Basement bathroom", { waterExtractionRequired: false })]), supp([roomSupp({ flooring: [], waterExtractionRequired: "YES", waterExtractionFraction: "FULL" })])).rooms[0];
check(answered.waterExtractionRequired === false, "a value the PM has already given is never overwritten");

const wrongRooms = mergeSupplement(tree([VINYL_OUT, room("Hall")]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }] })]));
check(wrongRooms.rooms[0].flooring[0]?.removalFraction === null, "a reply with the wrong number of rooms is discarded whole");
const wrongFloors = mergeSupplement(tree([VINYL_OUT]), supp([roomSupp({ flooring: [{ removalFraction: "FULL" }, { removalFraction: "HALF" }], waterExtractionRequired: "YES" })])).rooms[0];
check(wrongFloors.flooring[0]?.removalFraction === null && wrongFloors.waterExtractionRequired === null, "and a room whose flooring count came back wrong is left exactly as it was, water extraction included — nothing positional is trusted once the position is doubtful");
check(mergeSupplement(tree([VINYL_OUT]), null).rooms[0].flooring[0]?.removalFraction === null, "no reply at all is not a crash");

check(needsSupplementPass(tree([room("Anything")])) === true && needsSupplementPass(tree([])) === false, "the pass runs for any claim with rooms and not for one without");

const suppMessage = extractionSupplementUserMessage("the transcript", tree([room("Kitchen", { flooring: [flooring("VINYL"), flooring("CARPET")] }), room("Hall")]));
check(suppMessage.includes("1. Kitchen — 2 flooring") && suppMessage.includes("2. Hall — 0 flooring"), `the message states each room's flooring count, since the reply is positional at two levels (got:\n${suppMessage.split("Transcript:")[0]})`);
check(suppMessage.trim().endsWith("the transcript"), "with the transcript last");

/*
  The pass MUST run for any claim with rooms, and this is the assertion that protects it.

  Trim and appliances have no call-1 counterpart, so nothing in call 1's output can signal that they
  might be there — they ride along on triggers that belong to other fields. `antimicrobialApplied`,
  `hepaVacuumingRequired` and `containmentRequired` live only in call 2's schema, so they are always
  null after call 1 and the pass always fires. Move any of them into call 1 and both categories stop
  being extracted, silently, on every claim.
*/
check(needsDetailPass(tree([room("Bare")])), "a room with nothing in it still warrants the pass — trim and appliances depend on it");

/* ── A claim saved before a Room field existed ───────────────────────────────────────────────────

  `trim` is the first field added to Room since claims became saveable (appliances landed a commit
  earlier). Every read of it is `room.trim.forEach(...)`, so a stored claim without the key throws
  on open rather than degrading — and the same is true of whatever gets added next.
*/
const stored = { loss: {}, rooms: [{ roomName: "Old", flooring: [], baseboard: [] }] };
const brought = normalizeStoredExtraction(stored);
check(Array.isArray(brought.rooms[0]?.trim), "a room saved before trim existed comes back with it");
check(Array.isArray(brought.rooms[0]?.appliances), "and with every other list the older version had no concept of");
check(brought.rooms[0]?.roomName === "Old", "while keeping what was actually saved");

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
