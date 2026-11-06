/**
 * A hand sketch's rooms added to a claim (lib/handSketchClaim.ts).
 *
 *   node test/handSketch/claim.mjs
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundlePath = join(mkdtempSync(join(tmpdir(), "hand-sketch-claim-")), "bundle.mjs");
await build({ entryPoints: [join(here, "claim-entry.ts")], bundle: true, format: "esm", platform: "node", outfile: bundlePath, alias: { "@": root }, logLevel: "error" });
const { mergeHandSketch, handSketchRoomsToAdd, parseHandoff, buildFromRead, isPhoneOwned, sketchFingerprint, roomBounds, roomLevel, roomsOnLevel } = await import(pathToFileURL(bundlePath).href);

let passed = 0;
let failed = 0;
const check = (ok, message) => {
  if (ok) passed++;
  else {
    failed++;
    console.log(`  FAIL ${message}`);
  }
};
const rect = (id, name, x, y, w, h, level) => ({
  id, name, ...(level ? { level } : {}),
  vertices: [ { id: `${id}-a`, x, y }, { id: `${id}-b`, x: x + w, y }, { id: `${id}-c`, x: x + w, y: y + h }, { id: `${id}-d`, x, y: y + h } ],
  ceilingHeightFeet: 8, ceilingType: "flat", ceilingPeakFeet: null, stairs: null, parentRoomId: null, nestingOptOut: false, symbols: [], freeCabinets: [],
});
const overlaps = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

const read = JSON.parse(readFileSync(join(here, "fixtures", "bathroom.read.json"), "utf8"));
const built = buildFromRead(read);
const incoming = { rooms: built.rooms };
const newIds = new Set(incoming.rooms.map((r) => r.id));

const claim = {
  rooms: [rect("kitchen", "Kitchen", 0, 0, 144, 120), rect("bath", "Bathroom", 150, 0, 60, 96), rect("up", "Bedroom", 0, 0, 144, 144, 1)],
  levels: [1],
};
const before = JSON.stringify(claim);
const merged = mergeHandSketch(claim, incoming, 0);
check(JSON.stringify(claim) === before, "the claim passed in is not changed");
const added = merged.rooms.filter((r) => newIds.has(r.id));
check(added.length === incoming.rooms.length, `every incoming room is added (${added.length} of ${incoming.rooms.length})`);
const existingMain = claim.rooms.filter((r) => roomLevel(r) === 0).map(roomBounds);
check(added.every((r) => existingMain.every((b) => !overlaps(roomBounds(r), b))), "no new room overlaps the floor's rooms");
check(added.every((r) => roomLevel(r) === 0), "the new rooms are on the chosen floor");
const groupMinX = Math.min(...added.map((r) => roomBounds(r).minX));
const groupMinY = Math.min(...added.map((r) => roomBounds(r).minY));
check(Math.abs(groupMinX - (210 + 36)) < 1e-6 && Math.abs(groupMinY - 0) < 1e-6, `3 ft right of the floor, tops level (at ${groupMinX}, ${groupMinY})`);
check(JSON.stringify(roomsOnLevel(merged, 1)) === JSON.stringify(roomsOnLevel(claim, 1)), "the other floor is untouched");
for (const r of claim.rooms) check(JSON.stringify(merged.rooms.find((m) => m.id === r.id)?.vertices) === JSON.stringify(r.vertices), `${r.name} has not moved`);

const again = mergeHandSketch(merged, incoming, 0);
check(again.rooms.length === merged.rooms.length && JSON.stringify(again) === JSON.stringify(merged), "a second merge adds nothing");
check(handSketchRoomsToAdd(merged, incoming).length === 0, "and nothing is left to add");

const names = merged.rooms.map((r) => r.name.toLowerCase());
check(new Set(names).size === names.length, `no two rooms share a name (${merged.rooms.map((r) => r.name).join(", ")})`);
check(added.some((r) => r.name === "Bathroom 2"), "the drawn bathroom becomes Bathroom 2");

// Parents: a closet drawn inside the incoming room is its sub-room.
const outer = rect("hs-outer", "Den", 0, 0, 120, 120);
const inner = rect("hs-inner", "Closet", 10, 10, 30, 30);
const withCloset = mergeHandSketch(claim, { rooms: [outer, inner] }, 0);
check(withCloset.rooms.find((r) => r.id === "hs-inner")?.parentRoomId === "hs-outer", "parents are derived");

// Empty floor: at the drop; another storey of the drawing goes relative to the chosen one.
const two = mergeHandSketch({ rooms: [] }, { rooms: [rect("m", "Main", 100, 100, 60, 60), rect("u", "Upper", 100, 100, 60, 60, 1)] }, -1);
const m = two.rooms.find((r) => r.id === "m");
const u = two.rooms.find((r) => r.id === "u");
check(roomLevel(m) === -1 && roomLevel(u) === 0 && "level" in u === false, "storeys go relative to the chosen floor");
check(roomBounds(m).minX === 30 && roomBounds(m).minY === 30, "an empty floor gets them at the drop");
check(two.levels?.includes(-1), "the new floor is recorded");

// Id clashes on corners are re-id'd, and symbols follow.
const clashing = rect("hs-x", "Office", 0, 0, 60, 60);
clashing.vertices[0].id = "kitchen-a";
clashing.symbols = [{ id: "kitchen-b", type: "window", wallId: "kitchen-a", t: 0.5, widthFraction: 0.3, widthFeet: 1.5, heightFeet: null, sillFeet: null }];
const reid = mergeHandSketch(claim, { rooms: [clashing] }, 0).rooms.find((r) => r.id === "hs-x");
check(reid.vertices[0].id !== "kitchen-a" && reid.symbols[0].wallId === reid.vertices[0].id && reid.symbols[0].id !== "kitchen-b", "clashing ids are changed and followed");
check(reid.vertices[1].id === "hs-x-b", "ids that do not clash are kept");

// Phone ownership ends.
const owned = { rooms: [rect("scan", "Living Room", 0, 0, 120, 120)] };
owned.scan = { scanId: "s", captureId: null, receivedAt: "2026-11-01T00:00:00Z", level: 0, fingerprint: sketchFingerprint(owned) };
check(isPhoneOwned(owned), "the scanned claim starts phone-owned");
check(!isPhoneOwned(mergeHandSketch(owned, incoming, 0)), "isPhoneOwned is false after the add");

check(parseHandoff({ token: "t", createdAt: "x", claimId: null, sketch: { rooms: incoming.rooms } }, "t") !== null, "a handoff parses");
check(parseHandoff({ token: "t", sketch: { rooms: incoming.rooms } }, "other") === null, "under its own token only");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
