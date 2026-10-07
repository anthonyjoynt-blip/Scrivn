/**
 * What Import scan makes of a capture file, without the editor: each room's corners in feet and its doors, the importer's
 * notes, any spaces it would offer and the closets it would ask for. For checking a hand-built or replayed capture
 * before it goes into a claim.
 *
 *   node scripts/check-scan-import.mjs path/to/capture_taps.json
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(join(tmpdir(), "check-scan-import-"));
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

const text = readFileSync(process.argv[2], "utf8");
const r = scan.importScanRoom(text, { x: 0, y: 0 }, 0);
if (!r.ok) {
  console.log("refused:", r.error);
  process.exit(1);
}
const ft = (px) => (px / sketch.PIXELS_PER_FOOT).toFixed(2);
const rooms = [r.room, ...r.extraRooms];
const minX = Math.min(...rooms.flatMap((room) => room.vertices.map((v) => v.x)));
const minY = Math.min(...rooms.flatMap((room) => room.vertices.map((v) => v.y)));
for (const room of rooms) {
  const corners = room.vertices.map((v) => `(${ft(v.x - minX)},${ft(v.y - minY)})`).join(" ");
  const doors = room.symbols.map((s) => `${s.type}`).join(", ");
  console.log(`${room.name}: ${corners}${doors ? `\n    ${doors}` : ""}`);
}
console.log("notes:", JSON.stringify(r.notes, null, 1));
const owed = sketch.closetsOwed({ rooms }, r.closetDoors ?? []);
console.log("spaces offered:", (r.spaces ?? []).length, " closet doors:", (r.closetDoors ?? []).length, " of them still owed a closet (the editor would ask):", owed.length);
