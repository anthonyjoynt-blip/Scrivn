/**
 * Runs one scan/taps JSON through the importer and prints what Scrivn would draw.
 *
 *   node test/sketch/importFile.mjs path/to/room_..._taps.json
 *
 * A diagnostic, not a test: the phone writes a file, this says what it becomes — every room that
 * lands (a one-room file's room and its flights; a capture's rooms, in capture order, then every
 * flight), each with its name, where it sits, its wall lengths, and every symbol with its wall,
 * position and size. The rooms go through `withDerivedParents` as the editor's one update does,
 * so a flight prints as nested in its room and two neighbouring rooms print as neighbours — which
 * for a capture is the thing to eyeball: the hall against the family room's wall, not inside it.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const file = process.argv[2];
if (!file) {
  console.error("usage: node test/sketch/importFile.mjs <scan.json>");
  process.exit(2);
}

const outDir = mkdtempSync(join(tmpdir(), "import-file-"));
await build({
  entryPoints: [join(root, "lib", "scanImport.ts"), join(root, "lib", "sketch.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outdir: outDir,
  outExtension: { ".js": ".mjs" },
  logLevel: "silent",
});
const scan = await import(pathToFileURL(join(outDir, "scanImport.mjs")).href);
const sketch = await import(pathToFileURL(join(outDir, "sketch.mjs")).href);
rmSync(outDir, { recursive: true, force: true });

const text = readFileSync(file, "utf8");
const result = scan.importScanRoom(text, { x: 0, y: 0 }, 0);
if (!result.ok) {
  console.log("REFUSED:", result.error);
  process.exit(1);
}
const extent = scan.scanExtentPx(text);
const rooms = sketch.withDerivedParents([result.room, ...result.extraRooms]);
const nameOf = (room) => (room.stairs !== null ? `stairs ${room.name || "(unnamed)"}`.trim() : room.name || "(unnamed room)");
const ftIn = (px) => sketch.formatFeetInches(px / sketch.PIXELS_PER_FOOT);

const roomCount = rooms.filter((r) => r.stairs === null).length;
const flightCount = rooms.length - roomCount;
const counts = [`${roomCount} room${roomCount === 1 ? "" : "s"}`, ...(flightCount > 0 ? [`${flightCount} flight${flightCount === 1 ? "" : "s"}`] : [])].join(", ");
console.log(`${result.kind === "capture" ? "capture" : "one-room file"}: ${counts}${extent ? `, ${ftIn(extent.width)} x ${ftIn(extent.height)} together` : ""}`);
for (const room of rooms) {
  const b = sketch.roomBounds(room);
  const parent = room.parentRoomId === null ? null : rooms.find((r) => r.id === room.parentRoomId);
  const inside = parent ? `, inside ${nameOf(parent)}` : "";
  console.log(`\n${nameOf(room)}: ${room.vertices.length} vertices, ${ftIn(b.width)} x ${ftIn(b.height)} at (${ftIn(b.minX)}, ${ftIn(b.minY)}), ceiling ${sketch.formatFeetInches(room.ceilingHeightFeet)}${inside}`);
  if (room.stairs !== null) {
    console.log(`  flight: ${room.stairs.direction}, travelling ${{ 0: "right", 90: "down", 180: "left", 270: "up" }[room.stairs.orientation]} on the page`);
  }
  for (const w of sketch.wallsOf(room)) {
    console.log(`  wall ${w.index}: ${sketch.formatFeetInches(w.lengthFeet)}`);
  }
  for (const s of room.symbols) {
    const w = sketch.wallById(room, s.wallId);
    const extra =
      s.type === "window"
        ? `, sill ${sketch.formatFeetInches(s.sillFeet)}, height ${sketch.formatFeetInches(s.heightFeet)}`
        : s.type === "door"
          ? `, ${s.doorType}`
          : s.type === "cabinet"
            ? `, ${s.tier}, ${sketch.formatFeetInches(s.depthFeet)} deep`
            : "";
    console.log(`  ${s.type} on wall ${w ? w.index : "?"} at t=${s.t.toFixed(2)}: ${sketch.formatFeetInches(s.widthFeet)}${extra}`);
  }
}
console.log("");
for (const n of result.notes) console.log("  note:", n);
if (result.closetDoorIds.length > 0) console.log(`  ${result.closetDoorIds.length} closet door(s) offered on ${nameOf(result.room)}`);
