/**
 * Runs one scan/taps JSON through the importer and prints what Scrivn would draw.
 *
 *   node test/sketch/importFile.mjs path/to/room_..._taps.json
 *
 * A diagnostic, not a test: the phone writes a file, this says what it becomes — vertices in
 * feet-inches, wall lengths, and every symbol with its wall, position and size.
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

const result = scan.importScanRoom(readFileSync(file, "utf8"), { x: 0, y: 0 }, 0);
if (!result.ok) {
  console.log("REFUSED:", result.error);
  process.exit(1);
}
const { room, notes } = result;
console.log(`${room.vertices.length} vertices, ceiling ${sketch.formatFeetInches(room.ceilingHeightFeet)}`);
for (const w of sketch.wallsOf(room)) {
  console.log(`  wall ${w.index}: ${sketch.formatFeetInches(w.lengthFeet)}`);
}
for (const s of room.symbols) {
  const w = sketch.wallById(room, s.wallId);
  const extra = s.type === "window" ? `, sill ${sketch.formatFeetInches(s.sillFeet)}, height ${sketch.formatFeetInches(s.heightFeet)}` : s.type === "door" ? `, ${s.doorType}` : "";
  console.log(`  ${s.type} on wall ${w.index} at t=${s.t.toFixed(2)}: ${sketch.formatFeetInches(s.widthFeet)}${extra}`);
}
for (const n of notes) console.log("  note:", n);
