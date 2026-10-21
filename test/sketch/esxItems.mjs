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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      `export { pullRoomFromWall } from "${p("lib", "roomPlacement.ts")}";`,
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

  test("a round arch takes out the half circle, not the square round it", () => {
    const pass = door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 + 2 / 12, topShape: "round-arch" });
    // Up to the spring (6'8" less 1') is 2 x 2.5 = 5; the half circle of radius 1 is pi/2.
    near(s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [pass] })), 5 + Math.PI / 2, "rectangle plus half circle");
    near(s.openingSpringFeet(pass, 2), 5 + 8 / 12, "it springs half its width below the top");
  });

  test("a flat arch's segment is less than a round arch and more than nothing", () => {
    const arch = door("p", "a-v0", 0.5, 3, { doorType: "opening", topShape: "flat-arch", springFeet: 6 + 2 / 12 });
    const face = s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [arch] }));
    const square = 3 * (6 + 8 / 12);
    const below = 3 * (6 + 2 / 12);
    // A 3' chord with a 6" rise: r = 2.5', the segment about 1.02 SF.
    near(face - below, 1.0217, "the segment over the spring line", 0.002);
    assert(face < square && face > below, "between the spring and the square top");
    near(s.openingSpringFeet({ ...arch, springFeet: null }, 3), 6 + 8 / 12 - 0.5, "unsaid, a flat arch rises a sixth of its width");
  });

  test("arches are openings' alone: a door or a window with one stored is square", () => {
    const swing = door("d", "a-v0", 0.5, 3, { topShape: "round-arch" });
    near(s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [swing] })), 3 * (6 + 8 / 12), "the door, width by height");
    const win = windowAt("w", "a-v1", 0.5, 3, { topShape: "round-arch" });
    near(s.openingSquareFeet(room("a", 0, 0, 12, 10, { symbols: [win] })), 12, "the window, width by height");
    const out = s.sketchOutput({ rooms: [room("a", 0, 0, 12, 10, { symbols: [swing, win] })] })[0].symbols;
    assert(!("topShape" in out[0]) && !("topShape" in out[1]), JSON.stringify(out));
  });

  test("the day-old names read across: arch is a flat arch, round a round arch, flat square", () => {
    const at = (topShape) => s.openingTop(door("p", "a-v0", 0.5, 2, { doorType: "opening", topShape }));
    assert(at("arch") === "flat-arch" && at("round") === "round-arch" && at("flat") === "square" && at(undefined) === "square", "mapped");
    const old = door("p", "a-v0", 0.5, 2, { doorType: "opening", topShape: "round" });
    assert(s.sketchOutput({ rooms: [room("a", 0, 0, 12, 10, { symbols: [old] })] })[0].symbols[0].topShape === "round-arch", "and saved out under its new name");
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
      room("a", 0, 0, 12, 10, { symbols: [door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3 + 2 / 12, topShape: "flat-arch" })] }),
      "a-v2",
      { heightFeet: 3, cap: "wood" },
    );
    const text = s.sketchSummaryText({ rooms: [r] });
    assert(/Pass-through \(no door\).*sill 3'2", flat arch from 6'4"/.test(text), text);
    assert(/Wall 3 — 12', half wall 3' high, wood cap/.test(text), text);
  });

  test("everything new survives a save and a load", () => {
    const r = s.withWallDetail(room("a", 0, 0, 12, 10, { symbols: [door("p", "a-v0", 0.5, 2, { doorType: "opening", sillFeet: 3, topShape: "round-arch", springFeet: 5.5 })] }), "a-v1", { heightFeet: 3 });
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

  /* ── trim and finish ──────────────────────────────────────────────────────────────────────────── */

  test("crown runs the walls that have it, and stops at a half wall", () => {
    let r = room("l", 0, 0, 16, 12);
    for (const w of s.wallsOf(r)) r = s.withWallDetail(r, w.id, { crown: true });
    r = s.withWallDetail(r, "l-v2", { heightFeet: 3 });
    near(q({ rooms: [r] }, r).details.crownFeet, 56 - 16, "56' round, less the 16' half wall");
  });

  test("wainscot stops at a door, and at a window whose sill is below its top", () => {
    const r = s.withWallDetail(
      room("o", 0, 0, 12, 10, { symbols: [door("d", "o-v0", 0.25, 3), windowAt("w1", "o-v0", 0.7, 3, { sillFeet: 2, heightFeet: 4 }), windowAt("w2", "o-v1", 0.5, 3, { sillFeet: 4 })] }),
      "o-v0",
      { wainscot: { heightFeet: 3, type: "panel" } },
    );
    const w = s.wainscotOnWall(r, "o-v0", [r]);
    // 12' less the 3' door and the 3' window: 6 LF. 12 x 3 less the door's 3 x 3 and the window's 3 x 1.
    near(w.feet, 6, "6 LF");
    near(w.squareFeet, 36 - 9 - 3, "24 SF");
    const d = q({ rooms: [r] }, r).details;
    near(d.wainscotFeet, 6, "and in the details");
    assert(s.sketchOutput({ rooms: [r] })[0].walls[0].wainscot?.type === "panel", "its type in the output");
  });

  test("a ledge, a plant ledge and an unfinished wall are measured, and W stays the surface", () => {
    let r = room("b", 0, 0, 12, 10, { ceilingHeightFeet: 7 + 2 / 12 });
    const plainW = q({ rooms: [r] }, r).wallArea;
    r = s.withWallDetail(r, "b-v0", { ledge: { heightFeet: 3 + 5 / 12, depthFeet: 4 / 12 } });
    r = s.withWallDetail(r, "b-v1", { plantLedgeFeet: 8 });
    r = { ...r, unfinished: true };
    r = s.withWallDetail(r, "b-v3", { unfinished: false });
    const qq = q({ rooms: [r] }, r);
    near(qq.details.ledgeFeet, 12, "12 LF of ledge");
    near(qq.details.ledgeTopSquareFeet, 4, "and 4 SF of its top");
    near(qq.details.plantLedgeFeet, 10, "10 LF of plant ledge");
    near(qq.details.unfinishedWallSquareFeet, (12 + 10 + 12) * (7 + 2 / 12), "three walls unfinished, the fourth said finished");
    near(qq.wallArea, plainW, "W is the wall's surface either way");
  });

  test("a ceiling finish is said with its square feet; none is never assumed", () => {
    const r = room("s", 0, 0, 10, 8, { ceilingFinish: "suspended" });
    const d = q({ rooms: [r] }, r).details;
    assert(d.ceilingFinish === "suspended", "suspended");
    near(d.ceilingFinishSquareFeet, 80, "over its 80 SF");
    assert(q({ rooms: [room("t", 0, 0, 10, 8)] }, room("t", 0, 0, 10, 8)).details.ceilingFinish === null, "and a room that says nothing has none");
    assert(s.roomDetailLines(d).some((l) => /Ceiling, Suspended \(T-bar\) 80.0 SF/.test(l)), JSON.stringify(s.roomDetailLines(d)));
  });

  /* ── beams: a header over a missing wall, or a ceiling area ───────────────────────────────────── */
  /*
    The owner, 10-21: "the beam here is better off being drawn as a missing wall, so its just the top
    of the opening. so opening height would change. if its wide enough itd become a small subroom
    with a different ceiling height. thats how id draw it in xactimate myself."
  */

  // Two rooms a partition apart: the left's right wall (l-v1) faces the right's left wall (r-v3).
  const pair = (left = {}, right = {}) => [room("l", 0, 0, 12, 10, left), room("r", 12 + 4 / 12, 0, 10, 10, right)];

  test("a missing wall with no opening height is what it always was", () => {
    const [l, r] = pair({ missingWalls: ["l-v1"] });
    const before = q({ rooms: [l, r] }, l);
    near(before.details.headerFeet, 0, "no header");
    near(before.wallArea, 34 * 8, "three walls of wall");
    near(before.perimeterCeiling, 34, "and their ceiling line");
  });

  test("a beam over a missing wall: the strip above the opening is wall on both faces", () => {
    const [l0, r] = pair({ missingWalls: ["l-v1"] });
    const l = s.withWallDetail(l0, "l-v1", { openingHeightFeet: 7 });
    const ql = q({ rooms: [l, r] }, l);
    const qr = q({ rooms: [l, r] }, r);
    near(ql.details.headerFeet, 10, "10 LF of header");
    near(ql.details.headerSquareFeet, 10, "10' x 1' on its own face");
    near(ql.wallArea, 34 * 8 + 10, "in W");
    near(ql.perimeterCeiling, 34 + 10, "it meets the ceiling");
    near(ql.perimeterFloor, 34, "and has no base");
    near(qr.details.headerSquareFeet, 10, "the room across counts its own face, set from the other side");
    assert(s.missingWallHeaders(r, "r-v3", [l, r])[0]?.openingHeightFeet === 7, "one opening, seen from both rooms");
  });

  test("one missing wall has one opening: it is held by the wall that was made missing", () => {
    const [l, r] = pair({ missingWalls: ["l-v1"] });
    const fromRight = s.missingWallMarker(r, "r-v3", [l, r]);
    assert(fromRight?.roomId === "l" && fromRight.wallId === "l-v1", `from the other side it is the left room's (${JSON.stringify(fromRight)})`);
    assert(s.missingWallMarker(l, "l-v1", [l, r])?.roomId === "l", "and from its own side");
    assert(s.missingWallMarker(l, "l-v0", [l, r]) === null, "a standing wall has none");
  });

  test("under a header the step between two ceilings is not counted twice", () => {
    const [l0, r] = pair({ missingWalls: ["l-v1"], ceilingHeightFeet: 9 }, { ceilingHeightFeet: 8 });
    const stepOnly = q({ rooms: [l0, r] }, l0);
    near(stepOnly.ceilingSteps.faceSquareFeet, 10, "without a header: the 1' step, in the higher room");
    const l = s.withWallDetail(l0, "l-v1", { openingHeightFeet: 7 });
    const ql = q({ rooms: [l, r] }, l);
    const qr = q({ rooms: [l, r] }, r);
    near(ql.ceilingSteps.faceSquareFeet, 0, "the step is part of the header now");
    near(ql.details.headerSquareFeet, 20, "the higher room's face: 9' down to 7'");
    near(qr.details.headerSquareFeet, 10, "the lower room's: 8' down to 7'");
  });

  test("a header is drawn in 3D from the opening up to the higher ceiling, once", () => {
    const [l0, r] = pair({ missingWalls: ["l-v1"] });
    const l = s.withWallDetail(l0, "l-v1", { openingHeightFeet: 7 });
    const beams = s.houseModel({ rooms: [l, r] }).prisms.filter((pr) => pr.kind === "wall" && Math.abs(pr.y0 - 7) < 1e-6);
    assert(beams.length === 1 && Math.abs(beams[0].y1 - 8) < 1e-6, `one header 7' to 8' (${JSON.stringify(beams.map((b) => [b.y0, b.y1]))})`);
  });

  test("a header is said in the output and the summary", () => {
    const [l0, r] = pair({ missingWalls: ["l-v1"] });
    const l = s.withWallDetail(l0, "l-v1", { openingHeightFeet: 7 + 5 / 12 });
    const wall = s.sketchOutput({ rooms: [l, r] })[0].walls[1];
    assert(wall.header?.[0]?.openingHeightFeet === 7.42 && wall.header[0].feet === 10, JSON.stringify(wall));
    assert(/Wall 2 — 10', missing wall, opening 7'5" high under a header/.test(s.sketchSummaryText({ rooms: [l, r] })), s.sketchSummaryText({ rooms: [l, r] }));
    assert(s.roomDetailLines(q({ rooms: [l, r] }, l).details).some((line) => /^Header over an opening 10.0 LF, 5.8 SF of W$/.test(line)), "and in the Details");
  });

  test("a wide beam or a bulkhead is a ceiling area: pulled in off the wall, ticked, its ceiling lowered", () => {
    const rec = room("rec", 0, 0, 20, 14);
    // Pull room, dragged 2' in off the top wall: a strip along it, a sub-room of the rec room by where it lies.
    const pulled = s.pullRoomFromWall(rec, "rec-v0", -24, { obstacles: [], rooms: [rec] });
    assert(pulled, "the pull lands");
    const rooms = s.withDerivedParents([rec, { ...pulled, name: "Bulkhead", ceilingZone: true, ceilingHeightFeet: 7 }]);
    const zone = rooms[1];
    assert(zone.parentRoomId === "rec" && s.isCeilingZone(zone, rooms), "a ceiling area of the rec room");
    const qRec = s.roomQuantities(rooms[0], { rooms }, OPTIONS);
    near(qRec.ceilingSteps.faceSquareFeet, 20 * 1, "its long face, 20' by the 1' step, is wall in the rec room");
    const areas = s.roomAreasForEstimate({ rooms }, (n) => n.toLowerCase());
    near(areas.rec.floorSquareFeet, 280, "and the estimate keeps the rec room's whole floor");
    assert(!("bulkhead" in areas), "the bulkhead is not a room of its own in the estimate");
  });

  /* ── fireplaces ───────────────────────────────────────────────────────────────────────────────── */

  const block = (id, xFt, yFt, wFt, dFt, extra = {}) => ({ id, x: xFt * FT, y: yFt * FT, widthPx: wFt * FT, depthPx: dFt * FT, widthFeet: wFt, depthFeet: dFt, label: "", tier: "base", ...extra });

  test("a block stored as a beam reads as a cabinet: a beam is a header or a ceiling area now", () => {
    const old = block("bm", 0, 6, 20, 1.1, { kind: "beam", beam: { dropFeet: 0.9 } });
    assert(s.blockKind(old) === "cabinet" && s.blockDefaultLabel(old) === "Island", "a cabinet");
  });

  test("a corner fireplace: its surround is the long face by its height, and it stands on the floor", () => {
    const fp = block("fp", 0, 0, 3.5, 3.5, { kind: "fireplace", shape: "triangle", angleDeg: 0, heightFeet: 8, fireplace: { finish: "stone", fuel: "gas" } });
    const r = room("liv", 0, 0, 16, 14, { freeCabinets: [fp] });
    const qd = s.roomQuantities(r, { rooms: [r] }, DEDUCT);
    near(qd.details.fireplaceSurroundSquareFeet, Math.hypot(3.5, 3.5) * 8, "the hypotenuse by 8'");
    near(qd.details.fireplaces, 1, "one fireplace");
    near(qd.deductions.floorSquareFeet, (3.5 * 3.5) / 2, "its triangle of floor");
    const out = s.sketchOutput({ rooms: [r] })[0].freeCabinets[0];
    assert(out.kind === "fireplace" && out.fireplace.finish === "stone" && out.heightFeet === 8 && out.label === "Fireplace", JSON.stringify(out));
    assert(/Fireplace — fireplace, .*stone surround, gas, 8' high/.test(s.sketchSummaryText({ rooms: [r] })), s.sketchSummaryText({ rooms: [r] }));
  });

  test("a fireplace on a wall, a furnace and a water heater are fixtures of their own", () => {
    const r = room("u", 0, 0, 12, 10, {
      symbols: [
        fixture("fp", "u-v0", 0.5, "fireplace", { heightFeet: 4.5, fireplace: { finish: "brick" } }),
        fixture("fu", "u-v1", 0.3, "furnace"),
        fixture("wh", "u-v1", 0.7, "waterHeater"),
      ],
    });
    const qd = s.roomQuantities(r, { rooms: [r] }, DEDUCT);
    near(qd.details.fireplaceSurroundSquareFeet, 5 * 4.5, "5' wide by 4'6\"");
    near(qd.deductions.floorSquareFeet, 5 * 1.5, "only the fireplace's hearth comes off the floor");
    const labels = s.sketchOutput({ rooms: [r] })[0].symbols.map((x) => x.label);
    assert(JSON.stringify(labels) === JSON.stringify(["Fireplace", "Furnace", "Water heater"]), JSON.stringify(labels));
  });

  /* ── the owner's house: the golden sketch ──────────────────────────────────────────────────────── */
  /*
    His kitchen + living and his basement with every item from the 10-21 list, sized from the
    interior test (fixtures/owner-house-esx.json, made by fixtures/owner-house-esx.make.mjs). The
    numbers below are worked by hand; the golden file pins the whole output, so any change to what
    the export would read shows up here. UPDATE_GOLDEN=1 rewrites it - only when the change is meant.
  */
  const house = JSON.parse(readFileSync(join(here, "fixtures", "owner-house-esx.json"), "utf8"));
  const byName = (name) => house.rooms.find((r) => r.name === name);
  const detailsOf = (name) => q(house, byName(name)).details;

  test("the owner's house holds every item on the list", () => {
    const text = JSON.stringify(house);
    for (const field of [
      '"sillFeet":3.1666', '"topShape":"round-arch"', '"exterior":true', '"doorStyle":"full-lite"', '"lites":15', '"windowType":"casement"', '"units":3',
      '"heightFeet":3.1666', '"cap":"wood"', '"crown":true', '"plantLedgeFeet"', '"wainscot"', '"ledge"', '"unfinished":true',
      '"bottomFeet":3', '"doors":"glass"', '"doors":"open"', '"bay":"fridge"', '"bay":"wall-oven"', '"countertop"', '"waterfallEnds":1', '"overhangFeet":0.75',
      '"fixtureType":"hood"', '"hoodType":"custom"', '"fixtureType":"tubShower"', '"surround":"one-piece"', '"kind":"fireplace"', '"finish":"stone"',
      '"openingHeightFeet"', '"ceilingFinish":"suspended"', '"ceilingFinish":"open-joists"', '"fixtureType":"furnace"', '"fixtureType":"waterHeater"',
    ]) {
      assert(text.includes(field), `the sketch carries ${field}`);
    }
  });

  test("the kitchen: countertops on the run and the island, backsplash, and the bays", () => {
    const d = detailsOf("Kitchen");
    // The run 11' x 2'1", stopping short of the tall wall's corner (a run tapped into it is drawn and priced
    // to it - the corner fill of 2026-09-24); the island 6' x 3'9" with one waterfall end 3'9" x 3'.
    const run = s.symbolWidthFeet(byName("Kitchen").symbols[0], byName("Kitchen"), house.rooms);
    near(run, 11, "the run as drawn");
    near(d.countertopSquareFeet, 11 * (2 + 1 / 12) + 6 * 3.75 + 3.75 * 3, "56.7 SF of top");
    near(d.countertopFeet, 17, "17 LF");
    near(d.backsplashSquareFeet, 11 * (4 / 12), "a 4\" splash along the run");
    const out = s.sketchOutput(house).find((r) => r.name === "Kitchen");
    const labels = out.symbols.map((x) => x.label);
    assert(labels.includes("Wall oven") && labels.includes("Fridge bay") && labels.includes("Range hood") && labels.includes("Hutch"), JSON.stringify(labels));
  });

  test("the living room: two arched pass-throughs, the stair rail half wall, crown, plant ledge and the corner fireplace", () => {
    const liv = byName("Living");
    // Each 2' x (6'7" - 3'2"): 2' to its spring 1' under the top, then a half circle of 1' radius.
    near(s.openingSquareFeetOnWall(liv, "liv-w0", house.rooms), 2 * (2 * (6 + 7 / 12 - 3 - 2 / 12 - 1) + Math.PI / 2), "the two holes, not the wall under them");
    const d = detailsOf("Living");
    near(d.halfWallFeet, 12, "12' of half wall");
    near(d.crownFeet, 16, "crown along the 16' wall");
    near(d.plantLedgeFeet, 16, "and the plant ledge");
    near(d.fireplaceSurroundSquareFeet, Math.hypot(3.75, 3.75) * (7 + 7 / 12), "the fireplace's face to the ceiling");
  });

  test("the basement: the beam, the ledge, the tub/shower, the T-bar, the unfinished utility room, the office", () => {
    // The beam is the missing wall between the rec room and its play area, the opening 11" under the 8'4" ceiling.
    near(detailsOf("Rec room").headerSquareFeet, 12 * (11 / 12), "the header's face in the rec room, 12' long");
    near(detailsOf("Play area").headerSquareFeet, 12 * (11 / 12), "and in the play area");
    near(detailsOf("Rec room").countertopFeet, 8, "the bar top");
    near(detailsOf("Bedroom 2").ledgeTopSquareFeet, 10 * (4 / 12), "the foundation ledge's top");
    const bath = s.roomQuantities(byName("Bathroom"), house, DEDUCT);
    near(bath.deductions.wallSquareFeet, 5 * (6 + 4 / 12) + (3 + 2 / 12) * (2 + 10 / 12), "the tub/shower's surround and the vanity behind them");
    assert(detailsOf("Storage").ceilingFinish === "suspended", "the storage room's T-bar");
    near(detailsOf("Utility").unfinishedWallSquareFeet, 40 * 8 - (2 + 8 / 12) * (6 + 8 / 12), "every wall of the utility room, less its door");
    near(detailsOf("Office").wainscotSquareFeet, 12 * 3 - (2 + 8 / 12) * 3, "wainscot along the door wall, less the door");
  });

  test("the owner's house reads exactly as the golden file says", () => {
    const actual = JSON.parse(
      JSON.stringify({
        output: s.sketchOutput(house),
        quantities: Object.fromEntries(house.rooms.map((r) => [r.name, roundAll(q(house, r))])),
        summary: s.sketchSummaryText(house).split("\n"),
      }),
    );
    const path = join(here, "fixtures", "owner-house-esx.expected.json");
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(path, JSON.stringify(actual, null, 2) + "\n");
    const expected = JSON.parse(readFileSync(path, "utf8"));
    const a = JSON.stringify(actual, null, 1).split("\n");
    const e = JSON.stringify(expected, null, 1).split("\n");
    const first = a.findIndex((line, i) => line !== e[i]);
    assert(first < 0 && a.length === e.length, `differs from the golden file at line ${first + 1}:\n      expected ${e[first]}\n      actual   ${a[first]}`);
  });

  test("a sketch saved before any of this loads to the same output and numbers", () => {
    // The golden house with every 2026-10-21 field taken off is a sketch from before: it must read as one.
    const NEW = ["sillFeet", "topShape", "springFeet", "exterior", "doorStyle", "lites", "windowType", "units", "grids", "wallDetails", "ceilingFinish", "unfinished",
      "bottomFeet", "doors", "bay", "bayHeightFeet", "countertop", "surround", "hoodType", "fireplace", "kind"];
    const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !NEW.includes(k)).map(([k, x]) => [k, strip(x)])) : v);
    const old = strip(house);
    // Doors' sills were never stored before; windows always had one - put theirs back.
    for (const r of old.rooms) for (const sym of r.symbols) if (sym.type === "window") sym.sillFeet = house.rooms.find((h) => h.id === r.id).symbols.find((x) => x.id === sym.id).sillFeet;
    for (const r of old.rooms) {
      const qq = q(old, r);
      assert(JSON.stringify(qq.details) === JSON.stringify(s.emptyDetailQuantities()), `${r.name} has no details`);
      // Only what could have been drawn before: the fixture kinds from 2026-10-21 are new themselves.
      const NEW_KINDS = ["Range hood", "Tub/shower", "Fireplace", "Furnace", "Water heater"];
      for (const sym of s.sketchOutput(old).find((o) => o.name === r.name).symbols.filter((x) => !NEW_KINDS.includes(x.label))) {
        for (const key of ["topShape", "springFeet", "exterior", "doorStyle", "lites", "windowType", "units", "grids", "bottomFeet", "doors", "bay", "bayHeightFeet", "countertop", "surround", "hoodType", "fireplace"]) {
          assert(!(key in sym), `${r.name}: ${sym.label} says nothing of ${key}`);
        }
      }
    }
  });

  return { passed, failures };
}

/** Every number in a quantities object to two places, so the golden file is not at the mercy of the last bit of a float. */
function roundAll(value) {
  if (typeof value === "number") return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(roundAll);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundAll(v)]));
  return value;
}

/* ── standalone ─────────────────────────────────────────────────────────────────────────────────── */

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { passed, failures } = await runEsxItemChecks();
  console.log(`\n  ${passed.length} passed, ${failures.length} failed\n`);
  for (const failure of failures) console.log(`  ✗ ${failure}\n`);
  process.exit(failures.length === 0 ? 0 : 1);
}
