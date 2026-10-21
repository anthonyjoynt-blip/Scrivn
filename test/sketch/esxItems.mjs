/**
 * The interior details a future Xactimate ESX export needs (2026-10-21), checked as data and as
 * numbers: pass-throughs and shaped tops, half walls, door and window styles - and that a sketch
 * saved before any of them loads, draws and measures exactly as it did.
 *
 *   node test/sketch/esxItems.mjs        (also runs as part of npm run test:sketch)
 *
 * The owner, 10-21: "we will want to be able to capture and get the structured data from to turn
 * into an xactimate esx at some point in the future". The list came from the interior AI-pass test
 * of his own house (interior-ai-pass-test/README.md, the last table). Pure data and arithmetic, so
 * this runs in Node.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "esx-item-tests-"));
  const entry = join(outDir, "entry.ts");
  const p = (...parts) => join(root, ...parts).split("\\").join("/");
  writeFileSync(
    entry,
    [
      `export * from "${p("lib", "sketch.ts")}";`,
      `export * from "${p("lib", "sketchQuantities.ts")}";`,
      `export * from "${p("lib", "sketch3d.ts")}";`,
      `export * from "${p("lib", "scopeMarks.ts")}";`,
    ].join("\n"),
  );
  const outfile = join(outDir, "sketch.mjs");
  await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "silent" });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const FT = 12;

/** A w' x d' room at (x, y) feet, clockwise, with its walls' ids `${id}-v0`.. (top, right, bottom, left). */
function room(id, x, y, w, d, extra = {}) {
  return {
    id,
    name: id,
    vertices: [
      { id: `${id}-v0`, x: x * FT, y: y * FT },
      { id: `${id}-v1`, x: (x + w) * FT, y: y * FT },
      { id: `${id}-v2`, x: (x + w) * FT, y: (y + d) * FT },
      { id: `${id}-v3`, x: x * FT, y: (y + d) * FT },
    ],
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    ...extra,
  };
}

function door(id, wallId, t, widthFeet, extra = {}) {
  return { id, type: "door", wallId, t, widthFraction: 0.1, widthFeet, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false, ...extra };
}

function windowAt(id, wallId, t, widthFeet, extra = {}) {
  return { id, type: "window", wallId, t, widthFraction: 0.1, widthFeet, heightFeet: 4, sillFeet: 3, ...extra };
}

export async function runEsxItemChecks() {
  const s = await load();
  const OPTIONS = s.DEFAULT_QUANTITY_OPTIONS;
  const passed = [];
  const failures = [];
  const test = (name, run) => {
    try {
      run();
      passed.push(name);
    } catch (err) {
      failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const assert = (ok, message) => {
    if (!ok) throw new Error(message);
  };
  const near = (actual, expected, message, tolerance = 0.01) => {
    if (!(Math.abs(actual - expected) <= tolerance)) throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
  };
  const q = (sketch, r) => s.roomQuantities(r, sketch, OPTIONS);

  console.log("\n  ESX items\n");

  /* ── a sketch from before keeps every number ─────────────────────────────────────────────────── */

  test("a plain door and window take out width by height, exactly as before", () => {
    const r = room("a", 0, 0, 12, 10, { symbols: [door("d", "a-v0", 0.3, 3), windowAt("w", "a-v1", 0.5, 4)] });
    // 3 x 6'8" + 4 x 4 = 20 + 16.
    near(s.openingSquareFeet(r), 36, "the openings", 1e-9);
    near(q({ rooms: [r] }, r).wallArea, 44 * 8 - 36, "the wall area", 1e-9);
    assert(JSON.stringify(q({ rooms: [r] }, r).details) === JSON.stringify(s.emptyDetailQuantities()), "and no details at all");
  });

  test("a window taller than the room is still capped at the ceiling, as before", () => {
    const r = room("a", 0, 0, 12, 10, { symbols: [windowAt("w", "a-v1", 0.5, 4, { heightFeet: 10, sillFeet: 1 })] });
    near(s.openingSquareFeet(r), 4 * 8, "four feet wide, eight high", 1e-9);
  });

  /* ── openings: pass-throughs and shaped tops ──────────────────────────────────────────────────── */

  test("a pass-through leaves the wall under its sill", () => {
    const pass = door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 + 2 / 12 });
    const r = room("a", 0, 0, 12, 10, { symbols: [pass] });
    // 2' x (6'8" - 3'2") = 7 SF, not 13.33.
    near(s.openingSquareFeet(r), 7, "the hole only", 1e-9);
    near(q({ rooms: [r] }, r).wallArea, 44 * 8 - 7, "W keeps the wall under it", 1e-9);
  });

  test("a half-round top takes out the half circle, not the square round it", () => {
    const pass = door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 + 2 / 12, topShape: "round" });
    // Up to the spring (6'8" less 1') is 2 x 2.5 = 5; the half circle of radius 1 is pi/2.
    near(s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [pass] })), 5 + Math.PI / 2, "rectangle plus half circle");
    near(s.openingSpringFeet(pass, 2), 5 + 8 / 12, "it springs half its width below the top");
  });

  test("an arch's segment is less than a half round and more than nothing", () => {
    const arch = door("p", "a-v0", 0.5, 3, { doorType: "opening", topShape: "arch", springFeet: 6 + 2 / 12 });
    const face = s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [arch] }));
    const square = 3 * (6 + 8 / 12);
    const below = 3 * (6 + 2 / 12);
    // A 3' chord with a 6" rise: r = 2.5', the segment about 1.02 SF.
    near(face - below, 1.0217, "the segment over the spring line", 0.002);
    assert(face < square && face > below, "between the spring and the square top");
  });

  test("a window's shaped top counts from its sill up its height", () => {
    const w = windowAt("w", "a-v1", 0.5, 3, { heightFeet: 5, sillFeet: 2, topShape: "round" });
    // 3 x (5 - 1.5) + pi * 3 * 1.5 / 4.
    near(s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [w] })), 3 * 3.5 + (Math.PI * 3 * 1.5) / 4, "rectangle plus half circle");
  });

  test("the 3D wall stands under a pass-through's sill", () => {
    const pass = door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 });
    const m = s.houseModel({ rooms: [room("a", 0, 0, 12, 10, { symbols: [pass] })] });
    const under = m.prisms.filter((p) => p.kind === "wall" && Math.abs(p.y0) < 1e-6 && Math.abs(p.y1 - 3) < 1e-6);
    assert(under.length === 1, `one piece of wall 3' high under it (got ${under.length})`);
  });

  /* ── half walls ───────────────────────────────────────────────────────────────────────────────── */

  test("a half wall's face stops at its top, and no ceiling line runs along it", () => {
    const plain = room("a", 0, 0, 12, 10);
    const half = s.withWallDetail(plain, "a-v0", { heightFeet: 3 + 2 / 12, cap: "wood" });
    const before = q({ rooms: [plain] }, plain);
    const after = q({ rooms: [half] }, half);
    near(before.wallArea - after.wallArea, 12 * (8 - (3 + 2 / 12)), "twelve feet of wall 4'10\" shorter");
    near(before.perimeterCeiling - after.perimeterCeiling, 12, "the ceiling line loses the 12'");
    near(after.perimeterFloor, before.perimeterFloor, "the base still runs along it");
    near(after.details.halfWallFeet, 12, "12 LF of half wall, and of cap");
  });

  test("a half wall is one wall: the room across a partition sees it the same height", () => {
    const left = s.withWallDetail(room("l", 0, 0, 12, 10), "l-v1", { heightFeet: 3.5 });
    // Its left wall runs bottom to top along x = 12' 4", a partition from the left room's right wall.
    const right = room("r", 12 + 4 / 12, 0, 10, 10);
    const runs = s.halfWallRuns(right, "r-v3", [left, right]);
    assert(runs.length === 1 && Math.abs(runs[0].heightFeet - 3.5) < 1e-9, `the right room's left wall is half (${JSON.stringify(runs)})`);
    near(q({ rooms: [left, right] }, right).details.halfWallFeet, 10, "and counted in that room too");
  });

  test("Break carries a wall's details onto both halves, and joining keeps the first", () => {
    const half = s.withWallDetail(room("a", 0, 0, 12, 10), "a-v0", { heightFeet: 3 });
    const broken = s.insertVertexOnWall(half, "a-v0", 0.75);
    const added = broken.vertices[1].id;
    assert(broken.wallDetails[added]?.heightFeet === 3, "the second half is a half wall too");
    const full = s.withWallDetail(broken, added, { heightFeet: null });
    near(q({ rooms: [full] }, full).details.halfWallFeet, 9, "nine feet half, the last three full height");
    const joined = s.removeVertex(full, added);
    assert(joined.wallDetails["a-v0"]?.heightFeet === 3 && !(added in joined.wallDetails), "joined, the wall is the first half's");
  });

  test("a wall put back to plain leaves nothing saved", () => {
    const r = room("a", 0, 0, 12, 10);
    const back = s.withWallDetail(s.withWallDetail(r, "a-v0", { heightFeet: 3, cap: "wood" }), "a-v0", { heightFeet: null, cap: undefined });
    assert(!("wallDetails" in back), `no wallDetails field (${JSON.stringify(back.wallDetails)})`);
  });

  test("a marked half wall is painted to its own top", () => {
    const r = s.withWallDetail(room("a", 0, 0, 12, 10), "a-v0", { heightFeet: 4 });
    const mark = { walls: [{ roomId: "a", wallId: "a-v0", startT: 0, endT: 1 }], floorCells: {} };
    near(s.fullWallSquareFeet(mark, { rooms: [r] }), 48, "12' x 4'");
  });

  test("the 3D wall stops at a half wall's top", () => {
    const r = s.withWallDetail(room("a", 0, 0, 12, 10), "a-v0", { heightFeet: 3.5 });
    const m = s.houseModel({ rooms: [r] });
    assert(m.prisms.some((p) => p.kind === "wall" && Math.abs(p.y1 - 3.5) < 1e-6), "a wall piece 3'6\" high");
  });

  /* ── styles as data ───────────────────────────────────────────────────────────────────────────── */

  test("door and window styles reach the output, and nothing unsaid does", () => {
    const r = room("a", 0, 0, 12, 10, {
      symbols: [
        door("d1", "a-v0", 0.3, 3, { exterior: true, doorStyle: "full-lite", lites: 15 }),
        door("d2", "a-v2", 0.5, 2.5),
        windowAt("w1", "a-v1", 0.5, 6, { windowType: "casement", units: 3, grids: false }),
      ],
    });
    const out = s.sketchOutput({ rooms: [r] })[0].symbols;
    const [d1, d2, w1] = out;
    assert(d1.exterior === true && d1.doorStyle === "full-lite" && d1.lites === 15, `the patio door (${JSON.stringify(d1)})`);
    assert(!("exterior" in d2) && !("doorStyle" in d2) && !("lites" in d2) && !("topShape" in d2), `a plain door says nothing more (${JSON.stringify(d2)})`);
    assert(w1.windowType === "casement" && w1.units === 3 && w1.grids === false && w1.label === "Casement window", `the triple casement (${JSON.stringify(w1)})`);
    const text = s.sketchSummaryText({ rooms: [r] });
    assert(/full-lite, 15 lites, exterior/.test(text) && /Casement window .*3 units, no grids/.test(text), text);
  });

  test("a pass-through and a half wall are said in the summary", () => {
    const r = s.withWallDetail(
      room("a", 0, 0, 12, 10, { symbols: [door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 + 2 / 12, topShape: "arch" })] }),
      "a-v2",
      { heightFeet: 3, cap: "wood" },
    );
    const text = s.sketchSummaryText({ rooms: [r] });
    assert(/Pass-through \(no door\).*sill 3'2", arch top/.test(text), text);
    assert(/Wall 3 — 12', half wall 3' high, wood cap/.test(text), text);
  });

  test("everything new survives a save and a load", () => {
    const r = s.withWallDetail(room("a", 0, 0, 12, 10, { symbols: [door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3, topShape: "round", springFeet: 5.5 })] }), "a-v1", { heightFeet: 3 });
    const back = JSON.parse(JSON.stringify({ rooms: [r] }));
    near(q(back, back.rooms[0]).wallArea, q({ rooms: [r] }, r).wallArea, "the same wall area", 1e-9);
  });

  /* ── cabinets: mount height, doors, bays ─────────────────────────────────────────────────────── */

  const cabinet = (id, wallId, t, widthFeet, tier, extra = {}) => ({
    id, type: "cabinet", wallId, t, widthFraction: 0.1, widthFeet, label: "", tier,
    depthFeet: s.CABINET_DEFAULT_DEPTH_FEET[tier], heightFeet: s.CABINET_DEFAULT_HEIGHT_FEET[tier], ...extra,
  });
  const DEDUCT = { deductCabinetsFromFloorPerimeter: true, deductFromFloorArea: true, deductFromWallArea: true, deductOpeningsFromWallArea: true };

  test("a cabinet drawn before reads as it did: nothing new in its output", () => {
    const r = room("k", 0, 0, 12, 10, { symbols: [cabinet("c", "k-v0", 0.5, 6, "base")] });
    const out = s.sketchOutput({ rooms: [r] })[0].symbols[0];
    assert(JSON.stringify(Object.keys(out).sort()) === JSON.stringify(["depthFeet", "label", "offsetFeet", "tier", "type", "wall", "widthFeet"]), JSON.stringify(out));
  });

  test("an upper sitting on the counter says so, and stands there in 3D", () => {
    const hutch = cabinet("h", "k-v0", 0.3, 3, "wall", { bottomFeet: 3, heightFeet: 3.5, doors: "glass" });
    const r = room("k", 0, 0, 12, 10, { symbols: [hutch] });
    const out = s.sketchOutput({ rooms: [r] })[0].symbols[0];
    assert(out.bottomFeet === 3 && out.heightFeet === 3.5 && out.doors === "glass", JSON.stringify(out));
    const box = s.houseModel({ rooms: [r] }).prisms.find((p) => p.kind === "cabinet");
    near(box.y0, 3, "its bottom on the counter");
    near(box.y1, 6.5, "and its top 3'6\" over it");
    assert(/3'6" high from 3', glass doors/.test(s.sketchSummaryText({ rooms: [r] })), s.sketchSummaryText({ rooms: [r] }));
  });

  test("a fridge bay is the box over the fridge: no floor, no base, only the wall behind the box", () => {
    const bay = cabinet("f", "k-v0", 0.5, 3, "full", { heightFeet: 7.5, bay: "fridge" });
    const pantry = cabinet("p", "k-v0", 0.5, 3, "full", { heightFeet: 7.5 });
    const qBay = s.roomQuantities(room("k", 0, 0, 12, 10, { symbols: [bay] }), { rooms: [] }, DEDUCT);
    const qPantry = s.roomQuantities(room("k", 0, 0, 12, 10, { symbols: [pantry] }), { rooms: [] }, DEDUCT);
    near(qPantry.deductions.floorSquareFeet, 6, "a pantry takes 3' x 2' of floor");
    near(qBay.deductions.floorSquareFeet, 0, "the fridge bay takes none");
    near(qBay.deductions.perimeterFeet, 0, "nor any base");
    near(qBay.deductions.wallSquareFeet, 3 * 1.5, "and 3' x 1'6\" of wall, over a 6' opening");
    const box = s.houseModel({ rooms: [room("k", 0, 0, 12, 10, { symbols: [bay] })] }).prisms.find((p) => p.kind === "cabinet");
    near(box.y0, 6, "in 3D the box starts over the opening");
  });

  test("a wall oven stays in its tower: a pantry's deductions", () => {
    const oven = cabinet("o", "k-v0", 0.5, 2.5, "full", { heightFeet: 7, bay: "wall-oven" });
    const q1 = s.roomQuantities(room("k", 0, 0, 12, 10, { symbols: [oven] }), { rooms: [] }, DEDUCT);
    near(q1.deductions.floorSquareFeet, 2.5 * 2, "its floor");
    near(q1.deductions.wallSquareFeet, 2.5 * 7, "its wall");
    assert(s.sketchOutput({ rooms: [room("k", 0, 0, 12, 10, { symbols: [oven] })] })[0].symbols[0].label === "Wall oven", "named for the oven");
  });

  /* ── countertops ──────────────────────────────────────────────────────────────────────────────── */

  test("a run's countertop: its length, its depth with the nosing, its backsplash", () => {
    const run = cabinet("b", "k-v0", 0.5, 10, "base", { countertop: { material: "granite", backsplashFeet: 4 / 12 } });
    const r = room("k", 0, 0, 12, 10, { symbols: [run] });
    const d = q({ rooms: [r] }, r).details;
    near(d.countertopFeet, 10, "10 LF of top");
    near(d.countertopSquareFeet, 10 * (2 + 1 / 12), "10' x 2'1\"");
    near(d.backsplashFeet, 10, "10 LF of backsplash");
    near(d.backsplashSquareFeet, 10 * (4 / 12), "4\" high");
    const top = s.sketchOutput({ rooms: [r] })[0].symbols[0].countertop;
    assert(top.material === "granite" && top.depthFeet === 2.08 && top.squareFeet === 20.83, JSON.stringify(top));
  });

  test("an island's top: the stool overhang and two waterfall ends, and no backsplash off the walls", () => {
    const island = {
      id: "i", x: 4 * FT, y: 4 * FT, widthPx: 6 * FT, depthPx: 3 * FT, widthFeet: 6, depthFeet: 3, label: "Island", tier: "base", heightFeet: 3,
      countertop: { material: "quartz", overhangFeet: 0.75, waterfallEnds: 2, backsplashFeet: 0.5 },
    };
    const r = room("k", 0, 0, 14, 12, { freeCabinets: [island] });
    const d = q({ rooms: [r] }, r).details;
    near(d.countertopSquareFeet, 6 * 3.75 + 2 * 3.75 * 3, "6' x 3'9\" of top and two ends 3' down");
    near(d.backsplashFeet, 0, "no wall to splash");
    const text = s.sketchSummaryText({ rooms: [r] });
    assert(/Countertop — quartz, 6' x 3'9", 2 waterfall ends, 45.0 SF/.test(text), text);
  });

  test("a top on a run reaches past the box in 3D", () => {
    const run = cabinet("b", "k-v0", 0.5, 4, "base", { countertop: { overhangFeet: 1 } });
    const slabs = s.houseModel({ rooms: [room("k", 0, 0, 12, 10, { symbols: [run] })] }).prisms.filter((p) => p.kind === "cabinet");
    assert(slabs.length === 2, `the box and its top (${slabs.length})`);
    near(slabs[1].y0, 3, "the top on the box");
    const depthOf = (p) => Math.max(...p.points.map((v) => v.z)) - Math.min(...p.points.map((v) => v.z));
    near(depthOf(slabs[1]), 3, "3' deep: the box and a 1' overhang");
  });

  /* ── hood and tub/shower ─────────────────────────────────────────────────────────────────────── */

  const fixture = (id, wallId, t, fixtureType, extra = {}) => ({
    id, type: "fixture", wallId, t, widthFraction: 0.1, widthFeet: s.FIXTURE_DEFAULT_FEET[fixtureType].width, fixtureType, label: "",
    depthFeet: s.FIXTURE_DEFAULT_FEET[fixtureType].depth, heightFeet: s.FIXTURE_DEFAULT_HEIGHT_FEET[fixtureType], showerShape: "rectangular", ...extra,
  });

  test("a range hood is data, and takes nothing off the floor or the wall", () => {
    const hood = fixture("h", "k-v0", 0.5, "hood", { hoodType: "custom", heightFeet: 2.5, bottomFeet: 5.5 });
    const r = room("k", 0, 0, 12, 10, { symbols: [hood] });
    const qd = s.roomQuantities(r, { rooms: [r] }, DEDUCT);
    near(qd.deductions.floorSquareFeet + qd.deductions.wallSquareFeet, 0, "nothing deducted");
    const out = s.sketchOutput({ rooms: [r] })[0].symbols[0];
    assert(out.hoodType === "custom" && out.bottomFeet === 5.5 && out.heightFeet === 2.5 && out.label === "Range hood", JSON.stringify(out));
    const sink = s.withFixtureType(hood, r, "sink");
    assert(!("hoodType" in sink) && !("bottomFeet" in sink), "made a sink, it is no longer a hood");
  });

  test("a one-piece tub/shower deducts its surround's height and says what it is", () => {
    const combo = fixture("t", "k-v0", 0.5, "tubShower", { surround: "one-piece" });
    const r = room("b", 0, 0, 8, 6, { symbols: [combo] });
    const qd = s.roomQuantities(r, { rooms: [r] }, DEDUCT);
    near(qd.deductions.wallSquareFeet, 5 * 6, "5' wide, 6' up");
    near(qd.deductions.floorSquareFeet, 5 * 2.5, "and its floor");
    const out = s.sketchOutput({ rooms: [r] })[0].symbols[0];
    assert(out.surround === "one-piece" && out.heightFeet === 6 && out.label === "Tub/shower", JSON.stringify(out));
    assert(/Tub\/shower .*one-piece unit surround, 6' high/.test(s.sketchSummaryText({ rooms: [r] })), s.sketchSummaryText({ rooms: [r] }));
  });

  return { passed, failures };
}

/* ── standalone ─────────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runEsxItemChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
