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
    phaseUncertain: false, padRemoved: null, carpetLiftSF: null, carpetLiftFraction: null, padRemovedSF: null,
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

const FULL_DETAIL = {
  rooms: [
    {
      flooring: [{ carpetStyle: "BERBER" }],
      baseboard: [{ material: "VINYL_PVC_COMPOSITE", mdfProfile: "UNKNOWN" }],
      walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }],
      ceilings: [{ textureStyle: "UNKNOWN", aboveInsulationAffected: "YES", aboveInsulationType: "UNKNOWN" }],
    },
  ],
};

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
  ["one wall too many", { flooring: [{ carpetStyle: "BERBER" }], baseboard: [{ material: "MDF", mdfProfile: "FLAT" }], walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }, { cutHeight: "FULL_WALL", insulationType: "UNKNOWN" }], ceilings: [{ textureStyle: "UNKNOWN", aboveInsulationAffected: "YES", aboveInsulationType: "UNKNOWN" }] }],
  ["a missing flooring entry", { flooring: [], baseboard: [{ material: "MDF", mdfProfile: "FLAT" }], walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }], ceilings: [{ textureStyle: "UNKNOWN", aboveInsulationAffected: "YES", aboveInsulationType: "UNKNOWN" }] }],
  ["no ceilings at all", { flooring: [{ carpetStyle: "BERBER" }], baseboard: [{ material: "MDF", mdfProfile: "FLAT" }], walls: [{ cutHeight: "TWO_FOOT", insulationType: "UNKNOWN" }], ceilings: [] }],
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
const overridden = mergeDetail(alreadyKnown, { rooms: [{ flooring: [{ carpetStyle: "BERBER" }], baseboard: [], walls: [], ceilings: [] }] });
check(
  overridden.rooms[0].flooring[0].carpetStyle === "PILE",
  `the detail pass never overwrites what call 1 already captured (got ${overridden.rooms[0].flooring[0].carpetStyle})`,
);

/* ── When the second call is worth making ──────────────────────────────────────────────────────── */

check(needsDetailPass(tree([BEDROOM])), "a room with carpet, baseboard, walls and a ceiling needs the pass");
check(!needsDetailPass(tree([])), "a claim with no rooms does not");
check(
  !needsDetailPass(tree([room("Utility", { flooring: [flooring("CONCRETE")] })])),
  "and neither does a bare concrete floor with nothing else",
);
check(
  needsDetailPass(tree([room("Hall", { flooring: [flooring("CARPET")] })])),
  "carpet alone is enough, since only carpet has a style",
);
check(
  !needsDetailPass(tree([room("Hall", { flooring: [flooring("CARPET", { carpetStyle: "BERBER" })] })])),
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

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
