/**
 * The phone layout's tool lists — see `lib/sketchTouch.ts`.
 *
 * The rule worth a test is coverage: the editor draws the bottom bar from one list and the More
 * sheet from the other, so a tool missing from both is simply unreachable on a phone, and a tool in
 * both is two buttons that disagree about which is selected. Neither shows up anywhere else.
 *
 *   node test/sketch/touch.mjs
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "touch-"));
  const outfile = join(outDir, "touch.mjs");
  await build({
    entryPoints: [join(root, "lib", "sketchTouch.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const failures = [];
const passed = [];
function test(name, run) {
  try {
    run();
    passed.push(name);
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function sameSet(a, b, message) {
  const left = [...a].sort().join(",");
  const right = [...b].sort().join(",");
  assert(left === right, `${message}\n      bar+sheet: ${left}\n      all:       ${right}`);
}

const t = await load();

console.log("\n  the phone's tool lists\n");

test("the bar and the sheet cover every sketch tool exactly once", () => {
  const more = t.sketchMoreKeys();
  const both = [...t.SKETCH_BAR_KEYS, ...more];
  assert(new Set(both).size === both.length, "a tool is on the bar AND in the sheet");
  sameSet(both, t.SKETCH_TOOL_KEYS, "a sketch tool is unreachable on a phone");
});

test("the desktop row still holds every tool but Select", () => {
  const desktop = [...t.SKETCH_DESKTOP_LEADING, ...t.SKETCH_PLACEMENT_KEYS, ...t.SKETCH_DESKTOP_TRAILING];
  assert(new Set(desktop).size === desktop.length, "a tool is drawn twice on the desktop row");
  sameSet(desktop, t.SKETCH_TOOL_KEYS.filter((key) => key !== "select"), "the desktop row lost a tool");
  assert(!desktop.includes("select"), "Select is the phone bar's way back from a tool, not a desktop button");
});

test("Wall and Door are on the bar, and Wall is there for an empty sketch", () => {
  assert(t.SKETCH_BAR_KEYS.includes("wall"), "Wall carries an empty sketch — it must be one tap");
  assert(t.SKETCH_BAR_KEYS.includes("door"), "Door is the opening tapped most on a walk-through");
  assert(t.SKETCH_BAR_KEYS.includes("select"), "and the way back from either");
  assert(t.SKETCH_BAR_KEYS.length <= 3, "a fourth chip pushes More off a 360px bar");
});

test("the brush's surface follows the brush onto the bar", () => {
  for (const tool of ["paint", "erase"]) {
    const { bar, more } = t.moistureKeys(tool);
    assert(bar.includes("floor") && bar.includes("ceiling"), `${tool}: the surface is one tap`);
    sameSet([...bar, ...more], ["read", "paint", "erase", "floor", "ceiling", "showMoisture"], `${tool}: a moisture tool is unreachable`);
  }
});

test("with no brush in hand the surface is in neither list", () => {
  const { bar, more } = t.moistureKeys("read");
  const both = [...bar, ...more];
  assert(!both.includes("floor") && !both.includes("ceiling"), "a surface button that paints nothing reads as broken");
  sameSet(both, ["read", "paint", "erase", "showMoisture"], "the reading tools changed");
});

test("no moisture tool is on the bar and in the sheet at once", () => {
  for (const tool of ["read", "paint", "erase"]) {
    const { bar, more } = t.moistureKeys(tool);
    const both = [...bar, ...more];
    assert(new Set(both).size === both.length, `${tool}: a tool is in both places`);
  }
});

/*
  Two source rules about the cascade, in the spirit of `stateRules.mjs`.

  The phone layout reuses `.sketch-card-expanded`, so every rule written for that card at a narrow
  width also matches the phone — including two that are exactly wrong there. Both shipped in the
  first cut of this layout and neither was visible in a screenshot: the sheet looked right and
  simply would not scroll, and the moisture sheet looked empty. A computed-style test would need a
  browser; the mistake itself is in the source, so check the source.
*/
const css = readFileSync(join(root, "app", "globals.css"), "utf8");

test("the properties sheet's own scrolling is restored after the rule that turns it off", () => {
  // Whitespace collapsed, so the checks read as the rules do rather than as the file wraps them.
  const flat = css.replace(/\s+/g, " ");
  const off = flat.indexOf(".sketch-card-expanded .sketch-side { width: auto; overflow-y: visible;");
  assert(off !== -1, "the 900px block no longer reads as expected — check that rule still exists");
  const on = flat.indexOf(".sketch-card-phone .sketch-side {");
  assert(on !== -1, "the phone layout must say `overflow-y: auto` for the sheet itself");
  assert(on > off, "and it must come AFTER: both are two classes, so source order is all that decides");
  assert(/overflow-y: auto/.test(flat.slice(on, on + 160)), "the sheet rises over a fixed card, so it is the only thing that can scroll");
});

test("the full-screen layout hides the toolbar's hint, not the one standing in for a panel", () => {
  assert(
    !/\.sketch-card-expanded \.sketch-hint \{/.test(css),
    "hiding every .sketch-hint also hides \"Tap a room to record its moisture readings\", which is the only thing in the sheet with nothing selected",
  );
  assert(
    /\.sketch-card-expanded \.sketch-stage > \.sketch-hint \{/.test(css),
    "scope it to the stage's own hint",
  );
});

test("the phone query asks about room and about pointers, not about the make of phone", () => {
  assert(/max-width/.test(t.PHONE_LAYOUT_QUERY), "it is about how much room there is");
  assert(/pointer: coarse/.test(t.PHONE_LAYOUT_QUERY), "and whether there is a mouse");
  assert(!/iphone|android|mobile/i.test(t.PHONE_LAYOUT_QUERY), "never a user-agent sniff");
});

console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
