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

const { mergeDetail, needsDetailPass, extractionDetailUserMessage } = await import(pathToFileURL(bundlePath).href);

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
    phaseUncertain: false, padRemoved: null, removalSF: null, removalFraction: null,
    carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null,
    padRemovedFraction: null, ...overrides,
  };
}
function baseboard(overrides = {}) {
  return { material: null, heightIn: null, wallRunFt: null, action: null, disposition: null, phase: null, phaseUncertain: false, mdfProfile: null, ...overrides };
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
  return { roomName: name, flooring: [], baseboard: [], walls: [], ceilings: [], doors: [], cabinetry: [], toeKicks: [], countertops: [], wallTile: [], outlets: [], lightFixtures: [], electricalPanel: null, plumbingFixtures: [], stairs: null, floorRegistersDetached: null, contents: null, equipment: [], ...overrides };
}
const tree = (rooms) => ({ loss: {}, rooms });

const BEDROOM = room("Bedroom", {
  flooring: [flooring("CARPET")],
  baseboard: [baseboard()],
  walls: [wall()],
  ceilings: [ceiling()],
});

/** A detail entry for a room with one of each record — the shape call 2 is asked to return. */
function detailRoom(overrides = {}) {
  return {
    flooring: [{ carpetStyle: "BERBER", hardwoodConstruction: "UNKNOWN", hardwoodInstallation: "UNKNOWN", vinylInstallation: "UNKNOWN", removalSF: -1 }],
    baseboard: [{ material: "VINYL_PVC_COMPOSITE", mdfProfile: "UNKNOWN" }],
    walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }],
    ceilings: [{ textureStyle: "UNKNOWN", aboveInsulationAffected: "YES", aboveInsulationType: "UNKNOWN" }],
    doors: [],
    cabinetry: [],
    lightFixturesPresent: "UNKNOWN",
    lightFixtureCount: -1,
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
  !needsDetailPass(tree([room("Kitchen", { flooring: [flooring("VINYL", { vinylSubtype: "SHEET", removalSF: 48 })] })])),
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
  !needsDetailPass(tree([room("Utility", { flooring: [flooring("CONCRETE", { removalSF: 120 })] })])),
  "and neither does a bare concrete floor whose area is already known",
);
check(
  needsDetailPass(tree([room("Hall", { flooring: [flooring("CARPET")] })])),
  "carpet alone is enough, since only carpet has a style",
);
check(
  !needsDetailPass(tree([room("Hall", { flooring: [flooring("CARPET", { carpetStyle: "BERBER", removalSF: 200 })] })])),
  "but not once that style is already known",
);
check(
  !needsDetailPass(tree([room("Store", { walls: [wall({ drywallBeingRemoved: false })] })])),
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
  doors: [{ location: "Closet", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, unitType: null, saveHardware: null }],
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
check(needsDetailPass(tree([room("D", { doors: [{ location: "x", action: "REMOVE_AND_REPLACE", slabOnly: null, doorType: null, unitType: null, saveHardware: null }] })])), "as does a door with no spec");

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
