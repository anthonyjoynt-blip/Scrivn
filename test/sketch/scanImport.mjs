/**
 * A scanned room becomes a sketch room with the right walls, the right door, and nothing invented.
 *
 *   node test/sketch/scanImport.mjs        (also runs as part of npm run test:sketch)
 *
 * The fixture is a real scan: the office the ARCore prototype was built against, walked on
 * 2026-09-17 and tape-measured at 10' x 13' to the closet face with an 8'6" ceiling and a 4'3" door
 * opening in the top-right corner. The scanner read it as 10'0" x 13'3" x 8'7" with a 3'11" door,
 * and found one stretch of the left wall hidden behind the desk — which must come through as wall,
 * not as a hole. Pure geometry, so it runs in Node like the placement and dimension checks.
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "scan-import-tests-"));
  const outfile = join(outDir, "scanImport.mjs");
  await build({
    entryPoints: [join(root, "lib", "scanImport.ts"), join(root, "lib", "sketch.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outdir: outDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "silent",
  });
  const scan = await import(pathToFileURL(outfile).href);
  const sketch = await import(pathToFileURL(join(outDir, "sketch.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return { scan, sketch };
}

const office = readFileSync(join(here, "fixtures", "scan-office.json"), "utf8");
// The same room as the phone itself writes it (RoomSketchJson.kt, replayed through the JVM test):
// the live fit without offline registration, so 9'10" x 13'1" and no ceiling.
const officeFromPhone = readFileSync(join(here, "fixtures", "scan-office-phone.json"), "utf8");
// Hand-written from the tape, with the outline the fitter's post-pass writes since 2026-09-17
// (evening): the far-right corner cut at 45 degrees with 3'0" legs and the 4'3" door in the cut
// (so 15'0" deep, right wall 12'0"), and separately the closet notch, 4'2" wide and 2'1" deep in
// the far-left corner (13'0" to its face, 15'1" to the far wall).
const officeChamfer = readFileSync(join(here, "fixtures", "scan-office-chamfer.json"), "utf8");
const officeNotch = readFileSync(join(here, "fixtures", "scan-office-notch.json"), "utf8");
// Scan 16 (room_20260917_133442) as the phone's fitter writes it, replayed through the JVM test
// RoomOutlineTest.scan16_exportsItsOutline: 9'10" x 13'0" to the closet face, the notch found, the
// chamfer refused (three tracking losses smeared that corner), no ceiling.
const officeScan16 = readFileSync(join(here, "fixtures", "scan-office-16.json"), "utf8");
// The office as tap-to-measure writes it (2026-09-17, night), hand-written from the tape: every
// corner tapped, so the notch and the chamfer are both there — 10'0" x 15'0", the 4'2" x 2'1"
// closet notch in the far-left corner, the 45 degree chamfer with 3'0" legs and the 4'3" door in
// it in the far-right, and the 6'0" window with a 3'0" sill and a 7'0" head on the near wall.
// No walls[] at all: the outline is the room and the openings are named against its edges.
const officeTaps = readFileSync(join(here, "fixtures", "scan-taps-office.json"), "utf8");
// Synthetic, to the 2026-09-19 contract: a 5 m x 4 m room with a hall partition jutting 1.5 m up
// from the near wall (its end written as two corners 0.115 m apart — the tapped face and the far
// face), a 1.8 m base cabinet run on the right wall (edge 2), a 3 m x 0.9 m flight tapped in the
// room climbing up the page, and a door on the far wall. The ring starts at the bottom-left going
// up, so the right wall is edge 2; the importer does not care where a ring starts.
const basementTaps = readFileSync(join(here, "fixtures", "scan-taps-basement.json"), "utf8");

export async function runScanImportChecks() {
  const { scan, sketch } = await load();
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

  const near = (actual, expected, message, tolerance) => {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}\n      expected ~${expected}\n      actual    ${actual}`);
    }
  };

  const imported = () => {
    const result = scan.importScanRoom(office, { x: 40, y: 40 }, 0);
    assert(result.ok, `import failed: ${result.ok ? "" : result.error}`);
    return result;
  };

  test("the office comes in as a four-wall room of the size the scanner measured", () => {
    const { room } = imported();
    assert(room.vertices.length === 4, `expected 4 vertices, got ${room.vertices.length}`);
    const walls = sketch.wallsOf(room);
    // The scanner's own numbers: 3.05 m by 4.05 m. Whole-inch rounding is allowed for.
    near(walls[0].lengthFeet, 13.29, "top wall (13'3\")", 1 / 12);
    near(walls[1].lengthFeet, 10.01, "right wall (10'0\")", 1 / 12);
    near(walls[2].lengthFeet, walls[0].lengthFeet, "bottom wall matches top", 1e-9);
    near(walls[3].lengthFeet, walls[1].lengthFeet, "left wall matches right", 1e-9);
    // Clockwise is the invariant every glyph relies on; a reversed ring would have been accepted
    // silently and every door would swing out through its wall.
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    assert(room.vertices[0].x === 40 && room.vertices[0].y === 40, "room did not land at the requested corner");
  });

  test("the ceiling height is carried over", () => {
    const { room } = imported();
    near(room.ceilingHeightFeet, 8 + 7 / 12, "ceiling 8'7\"", 1e-9);
  });

  test("the door is on the right wall, at the right place, at the width the scanner saw", () => {
    const { room } = imported();
    const doors = room.symbols.filter((s) => s.type === "door");
    assert(doors.length === 1, `expected 1 door, got ${doors.length}`);
    const door = doors[0];
    near(door.widthFeet, 3 + 11 / 12, "door 3'11\"", 1e-9);
    assert(door.doorType === "swing", `a scanner door is a swing door until the PM says otherwise, got ${door.doorType}`);
    // The scan puts the door on the `along` wall at U = +1.37 — the high U wall, which is the RIGHT
    // wall of the sketch (wall 1), running top to bottom. It starts 1.4 m from the low end of the
    // wall's V span (V = -0.27), so its centre is 1.4 + 0.6 = 2.0 m down the wall out of 3.05 m,
    // and the right wall runs with V, so t = 2.0 / 3.05.
    const wall = sketch.wallById(room, door.wallId);
    assert(wall.index === 1, `door should be on the right wall (1), got wall ${wall.index}`);
    near(door.t, 2.0 / 3.05, "door position along the right wall", 0.01);
  });

  test("the stretch hidden behind the desk stays wall", () => {
    const { room, notes } = imported();
    const onTop = room.symbols.filter((s) => sketch.wallById(room, s.wallId).index === 0);
    assert(onTop.length === 0, `nothing should be drawn on the desk wall, found ${onTop.length}`);
    assert(room.symbols.length === 1, `only the door should be imported, got ${room.symbols.length} symbols`);
    assert(notes.some((n) => /\d unclassified gaps? left as wall/.test(n)), `expected a note about the hidden gaps, got ${JSON.stringify(notes)}`);
    // A lap scan never writes "closet_door", so there is nothing to offer a closet behind.
    const { closetDoorIds, extraRooms } = imported();
    assert(Array.isArray(closetDoorIds) && closetDoorIds.length === 0, `a lap scan has no closet doors, got ${JSON.stringify(closetDoorIds)}`);
    // Nor stairs, so nothing comes in beside the room.
    assert(Array.isArray(extraRooms) && extraRooms.length === 0, `a lap scan brings no extra rooms, got ${extraRooms.length}`);
  });

  test("a window and a wide opening are told apart from a door", () => {
    const fixture = JSON.parse(office);
    // Put a window on the far across wall (high V = bottom of the sketch) and turn the door into
    // a cased opening. Walls are found by what they are, not by their position in the file.
    const farAcross = fixture.walls.filter((w) => w.axis === "across").sort((a, b) => a.offset_m - b.offset_m)[1];
    const doorWall = fixture.walls.find((w) => w.openings.some((o) => o.kind === "door"));
    farAcross.openings = [{ kind: "window?", from_m: 1.0, width_m: 1.5 }];
    doorWall.openings = [{ kind: "opening", from_m: 0.5, width_m: 1.8 }];
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    const windows = result.room.symbols.filter((s) => s.type === "window");
    const doors = result.room.symbols.filter((s) => s.type === "door");
    assert(windows.length === 1, `expected 1 window, got ${windows.length}`);
    near(windows[0].widthFeet, 4 + 11 / 12, "window 4'11\"", 1e-9);
    assert(sketch.wallById(result.room, windows[0].wallId).index === 2, "window should be on the bottom wall");
    // Bottom wall runs right to left, so a window 1.0 m from the low end sits at t = 1 - 1.75/4.05.
    near(windows[0].t, 1 - 1.75 / 4.05, "window position", 0.01);
    assert(doors.length === 1 && doors[0].doorType === "opening", "a wide floor-open gap is a cased opening");
  });

  test("a scan without four walls is refused in words, not with a broken room", () => {
    const fixture = JSON.parse(office);
    fixture.walls = fixture.walls.slice(0, 3);
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(!result.ok, "a three-wall scan should not import");
    assert(/two facing walls/.test(result.error), `unexpected message: ${result.error}`);
    const junk = scan.importScanRoom("{ not json", { x: 0, y: 0 }, 0);
    assert(!junk.ok && /not valid JSON/.test(junk.error), "junk should be refused as not JSON");
    const other = scan.importScanRoom(JSON.stringify({ rooms: [] }), { x: 0, y: 0 }, 0);
    assert(!other.ok && /no walls/.test(other.error), "a sketch file is not a scan");
  });

  test("a scan that never saw the ceiling assumes 8' and says so", () => {
    const fixture = JSON.parse(office);
    fixture.ceiling_m = null;
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    assert(result.room.ceilingHeightFeet === 8, `expected 8', got ${result.room.ceilingHeightFeet}`);
    assert(result.notes.some((n) => n.includes("ceiling")), "expected a ceiling note");
  });

  test("the file the phone writes imports too, door and all", () => {
    const result = scan.importScanRoom(officeFromPhone, { x: 0, y: 0 }, 0);
    assert(result.ok, `import failed: ${result.ok ? "" : result.error}`);
    const walls = sketch.wallsOf(result.room);
    // In the phone's file the `along` pair is 3.0 m apart, so the top wall runs the 3.0 m and the
    // side walls the 4.0 m — the room comes in turned 90 degrees from the analysis script's
    // version, which is fine: a scan has no north.
    near(walls[0].lengthFeet, 9.84, "top wall (9'10\")", 1 / 12);
    near(walls[1].lengthFeet, 13.12, "right wall (13'1\")", 1 / 12);
    const doors = result.room.symbols.filter((s) => s.type === "door");
    assert(doors.length === 1, `expected 1 door, got ${doors.length}`);
    near(doors[0].widthFeet, 2 + 2 / 12, "door 2'2\" as the live fit saw it", 1e-9);
    assert(result.room.ceilingHeightFeet === 8, "no ceiling in the file means the 8' default");
    assert(result.notes.some((n) => n.includes("ceiling")), "and a note saying so");
  });

  test("the room joins the storey it was imported on", () => {
    const result = scan.importScanRoom(office, { x: 0, y: 0 }, 1);
    assert(result.ok && result.room.level === 1, "room should be on level 1");
  });

  const importedOutline = (text) => {
    const result = scan.importScanRoom(text, { x: 60, y: 60 }, 0);
    assert(result.ok, `import failed: ${result.ok ? "" : result.error}`);
    return result;
  };

  test("a chamfered corner comes in as five vertices with the door on the angled wall", () => {
    const { room, notes } = importedOutline(officeChamfer);
    assert(room.vertices.length === 5, `expected 5 vertices, got ${room.vertices.length}`);
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    const walls = sketch.wallsOf(room);
    const diagonal = walls.filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2);
    assert(diagonal.length === 1, `expected one angled wall, got ${diagonal.length}`);
    // 3'0" legs at 45 degrees: 4'3" across, give or take the inch each leg was rounded to.
    near(diagonal[0].lengthFeet, 4.24, "angled wall 4'3\"", 1.5 / 12);
    // The two legs it replaced: the far wall is 7'0" (10' - 3') and the right wall 12'0" (15' - 3').
    const lengths = walls.map((w) => Math.round(w.lengthFeet * 12));
    assert(lengths.includes(84) && lengths.includes(144), `expected 7'0" and 12'0" legs, got ${lengths}`);
    // The door was reported on the right wall past the end of the edge that wall became; it
    // belongs on the chamfer, and at 4'3" it fills it.
    const doors = room.symbols.filter((s) => s.type === "door");
    assert(doors.length === 1, `expected 1 door, got ${doors.length}`);
    assert(doors[0].wallId === diagonal[0].id, "door should sit on the angled wall");
    near(doors[0].t, 0.5, "door centred on the angled wall it fills", 0.02);
    near(doors[0].widthFeet, 4.25, "door 4'3\"", 1e-9);
    // The window on the near wall is placed as it always was: 1'0" wide edge run, reversed ring.
    const windows = room.symbols.filter((s) => s.type === "window");
    assert(windows.length === 1, `expected 1 window, got ${windows.length}`);
    const nearWall = sketch.wallById(room, windows[0].wallId);
    assert(nearWall.y1 === nearWall.y2 && nearWall.y1 === Math.max(...room.vertices.map((v) => v.y)), "window should be on the near (bottom) wall");
    near(windows[0].t, 1 - (0.61 + 1.829 / 2) / 3.048, "window position along the near wall", 0.01);
    assert(notes.some((n) => /5 corners/.test(n)), `expected a note about the corners, got ${JSON.stringify(notes)}`);
  });

  test("a closet notch comes in as six vertices, 4'2\" by 2'1\"", () => {
    const { room } = importedOutline(officeNotch);
    assert(room.vertices.length === 6, `expected 6 vertices, got ${room.vertices.length}`);
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    const walls = sketch.wallsOf(room);
    // The step: a 2'1" edge (closet depth) between the closet face (4'2") and the far wall (5'10").
    const depth = walls.findIndex((w) => Math.abs(w.lengthFeet - 2 - 1 / 12) <= 1 / 12);
    assert(depth >= 0, `no 2'1\" edge in ${walls.map((w) => w.lengthFeet.toFixed(2))}`);
    const beside = [walls[(depth + 1) % 6], walls[(depth + 5) % 6]].map((w) => w.lengthFeet);
    assert(beside.some((l) => Math.abs(l - 4 - 2 / 12) <= 1 / 12), `closet face 4'2\" not beside the step: ${beside}`);
    assert(beside.some((l) => Math.abs(l - 5 - 10 / 12) <= 1 / 12), `far wall 5'10\" not beside the step: ${beside}`);
    // Overall: 10'0" wide, 13'0" to the closet face, 15'1" to the far wall.
    const xs = room.vertices.map((v) => v.x);
    const ys = room.vertices.map((v) => v.y);
    near((Math.max(...xs) - Math.min(...xs)) / 12, 10, "width 10'0\"", 1 / 12);
    near((Math.max(...ys) - Math.min(...ys)) / 12, 15 + 1 / 12, "depth to the far wall 15'1\"", 1 / 12);
    const horizontal = walls.filter((w) => w.y1 === w.y2).map((w) => w.y1).sort((a, b) => a - b);
    near((horizontal[2] - horizontal[1]) / 12, 13, "depth to the closet face 13'0\"", 1 / 12);
    // The window on the near wall still lands on the near wall.
    const windows = room.symbols.filter((s) => s.type === "window");
    assert(windows.length === 1 && sketch.wallById(room, windows[0].wallId).y1 === Math.max(...ys), "window on the near wall");
  });

  test("a four-point outline is the rectangle, vertex for vertex and door for door", () => {
    const fixture = JSON.parse(office);
    const along = fixture.walls.filter((w) => w.axis === "along").sort((a, b) => a.offset_m - b.offset_m);
    const across = fixture.walls.filter((w) => w.axis === "across").sort((a, b) => a.offset_m - b.offset_m);
    const [u0, u1] = along.map((w) => w.offset_m);
    const [v0, v1] = across.map((w) => w.offset_m);
    fixture.outline = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const plain = scan.importScanRoom(office, { x: 40, y: 40 }, 0);
    const withOutline = scan.importScanRoom(JSON.stringify(fixture), { x: 40, y: 40 }, 0);
    assert(plain.ok && withOutline.ok, "both imports should succeed");
    const shape = (r) => r.room.vertices.map((v) => `${v.x},${v.y}`).join(" ");
    assert(shape(plain) === shape(withOutline), `vertices differ:\n      ${shape(plain)}\n      ${shape(withOutline)}`);
    const doors = (r) => r.room.symbols.map((s) => `${s.type}@${sketch.wallById(r.room, s.wallId).index}:${s.t.toFixed(6)}:${s.widthFeet}`).join(" ");
    assert(doors(plain) === doors(withOutline), `symbols differ:\n      ${doors(plain)}\n      ${doors(withOutline)}`);
    assert(plain.notes.join("|") === withOutline.notes.join("|"), "notes differ");
    // A malformed outline is ignored, not fatal: the rectangle still comes in.
    fixture.outline = [[0, 0], ["x", 1], [1, 1], [0, 1]];
    const broken = scan.importScanRoom(JSON.stringify(fixture), { x: 40, y: 40 }, 0);
    assert(broken.ok && shape(broken) === shape(plain), "a malformed outline should fall back to the rectangle");
  });

  test("scan 16 as the phone writes it: the closet notch, 10'0\" x 13'0\" to its face", () => {
    const { room, notes } = importedOutline(officeScan16);
    assert(room.vertices.length === 6, `expected 6 vertices (one notch, no chamfer), got ${room.vertices.length}`);
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    const walls = sketch.wallsOf(room);
    const xs = room.vertices.map((v) => v.x);
    const ys = room.vertices.map((v) => v.y);
    near((Math.max(...xs) - Math.min(...xs)) / 12, 10, "width 10'0\"", 2 / 12);
    const horizontal = walls.filter((w) => w.y1 === w.y2).map((w) => w.y1).sort((a, b) => a - b);
    assert(horizontal.length === 3, `expected three across edges, got ${horizontal.length}`);
    near((horizontal[2] - horizontal[1]) / 12, 13, "depth to the closet face 13'0\"", 2 / 12);
    // The notch itself: 2'2" deep in this scan (tape 2'1"), 4'7" wide (tape 4'2").
    near((horizontal[1] - horizontal[0]) / 12, 2 + 1 / 12, "closet depth", 2 / 12);
    assert(room.symbols.length === 0, "the only gap in the file is unclassified and stays wall");
    assert(notes.some((n) => /6 corners/.test(n)) && notes.some((n) => n.includes("ceiling")), `notes: ${JSON.stringify(notes)}`);
    // The fitter's own `outline_notes` ("notch on low-V edge: near wall at -4.06 covers 1.40 m...")
    // are its diagnostics, not the PM's; the corner-count note above is what the PM gets.
    assert(!notes.some((n) => /low-V edge/.test(n)), `a lap's fitter notes are not passed on, got ${JSON.stringify(notes)}`);
  });

  test("a tapped office comes in as seven walls, 10'0\" x 15'0\", notch and chamfer both", () => {
    const { room, notes } = importedOutline(officeTaps);
    assert(room.vertices.length === 7, `expected 7 vertices, got ${room.vertices.length}`);
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    const walls = sketch.wallsOf(room);
    const xs = room.vertices.map((v) => v.x);
    const ys = room.vertices.map((v) => v.y);
    near((Math.max(...xs) - Math.min(...xs)) / 12, 10, "width 10'0\"", 1 / 12);
    near((Math.max(...ys) - Math.min(...ys)) / 12, 15, "depth to the far wall 15'0\"", 1 / 12);
    // The notch: a 4'2" closet face, a 2'1" step, then 2'10" of far wall before the chamfer.
    const inches = walls.map((w) => Math.round(w.lengthFeet * 12));
    assert(inches[0] === 50 && inches[1] === 25 && inches[2] === 34, `expected 4'2\", 2'1\", 2'10\" then the chamfer, got ${inches}`);
    // The chamfer: the one angled wall, 4'3" across, with the 12'0" right wall after it.
    const diagonal = walls.filter((w) => w.x1 !== w.x2 && w.y1 !== w.y2);
    assert(diagonal.length === 1 && diagonal[0].index === 3, `expected the angled wall at edge 3, got ${diagonal.map((w) => w.index)}`);
    near(diagonal[0].lengthFeet, 4.24, "angled wall 4'3\"", 1.5 / 12);
    assert(inches[4] === 144 && inches[5] === 120, `expected 12'0\" right wall and 10'0\" near wall, got ${inches}`);
    near(room.ceilingHeightFeet, 8.5, "ceiling 8'6\"", 1e-9);
    assert(room.vertices[0].x === 60 && Math.min(...ys) === 60, "room did not land at the requested corner");
    assert(notes.some((n) => /Measured by tapping; 7 walls/.test(n)), `expected the taps note, got ${JSON.stringify(notes)}`);
    assert(!notes.some((n) => /corners/.test(n)), `a tapped corner needs no second look, got ${JSON.stringify(notes)}`);
  });

  test("a tapped door lands on the chamfer edge it was tapped on, at its width", () => {
    const { room } = importedOutline(officeTaps);
    const doors = room.symbols.filter((s) => s.type === "door");
    assert(doors.length === 1, `expected 1 door, got ${doors.length}`);
    const wall = sketch.wallById(room, doors[0].wallId);
    assert(wall.index === 3 && wall.x1 !== wall.x2 && wall.y1 !== wall.y2, `door should sit on the angled wall (3), got wall ${wall.index}`);
    near(doors[0].widthFeet, 4.25, "door 4'3\"", 1e-9);
    assert(doors[0].doorType === "swing", `a tapped door is a swing door, got ${doors[0].doorType}`);
    // from 0 with a width that fills the edge: centred, once the clamp has had its say.
    near(doors[0].t, 0.5, "door centred on the angled wall it fills", 0.02);
  });

  test("a tapped window carries its sill and its height, on the edge it was tapped on", () => {
    const { room } = importedOutline(officeTaps);
    const windows = room.symbols.filter((s) => s.type === "window");
    assert(windows.length === 1, `expected 1 window, got ${windows.length}`);
    const wall = sketch.wallById(room, windows[0].wallId);
    assert(wall.index === 5 && wall.y1 === wall.y2 && wall.y1 === Math.max(...room.vertices.map((v) => v.y)), `window should be on the near wall (5), got wall ${wall.index}`);
    near(windows[0].widthFeet, 6, "window 6'0\"", 1e-9);
    near(windows[0].sillFeet, 3, "sill 3'0\"", 1e-9);
    near(windows[0].heightFeet, 4, "7'0\" head less 3'0\" sill is 4'0\" of glass", 1e-9);
    // 1.0 m from the edge's start, 1.829 m wide: centre at 1.9145 m of 3.048 m along the near wall.
    near(windows[0].t, (1.0 + 1.829 / 2) / 3.048, "window position along the near wall", 0.01);
  });

  test("empty walls[] is accepted when the outline is the room; nothing without either", () => {
    const fixture = JSON.parse(officeTaps);
    assert(Array.isArray(fixture.walls) && fixture.walls.length === 0, "fixture should carry an empty walls[]");
    const withEmpty = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(withEmpty.ok, `empty walls[] should import: ${withEmpty.ok ? "" : withEmpty.error}`);
    delete fixture.walls;
    const withoutWalls = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(withoutWalls.ok && withoutWalls.room.vertices.length === 7, "an outline with no walls key at all is the same room");
    // A tapped room can be a triangle; the lap's fitter never writes one, but the parser must not
    // throw it back.
    fixture.outline = [[0, 0], [3, 0], [0, 4]];
    fixture.outline_openings = [];
    const triangle = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(triangle.ok && triangle.room.vertices.length === 3, `three tapped corners should import: ${triangle.ok ? "" : triangle.error}`);
    // Without an outline the old rule still stands.
    delete fixture.outline;
    const nothing = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(!nothing.ok && /no walls/.test(nothing.error), `no outline and no walls is not a scan: ${nothing.ok ? "ok" : nothing.error}`);
    fixture.walls = [];
    const emptyOnly = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(!emptyOnly.ok && /two facing walls/.test(emptyOnly.error), `empty walls[] with no outline is still refused: ${emptyOnly.ok ? "ok" : emptyOnly.error}`);
  });

  test("a tapped opening on an edge the outline does not have is skipped with a note", () => {
    const fixture = JSON.parse(officeTaps);
    fixture.outline_openings.push({ edge: 7, from_m: 0.5, width_m: 0.9, kind: "door", sill_m: null, head_m: null });
    fixture.outline_openings.push({ edge: -1, from_m: 0.5, width_m: 0.9, kind: "window", sill_m: null, head_m: null });
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    assert(result.room.symbols.length === 2, `only the door and the window on real edges should come in, got ${result.room.symbols.length}`);
    assert(result.notes.some((n) => /2 openings named a wall the outline does not have; skipped/.test(n)), `expected a note about the stray openings, got ${JSON.stringify(result.notes)}`);
  });

  test("tapped kinds: closet_door is a swing door, opening is cased, a window without heights takes the defaults", () => {
    const fixture = JSON.parse(officeTaps);
    fixture.outline_openings = [
      { edge: 0, from_m: 0.1, width_m: 0.762, kind: "closet_door", sill_m: null, head_m: null },
      { edge: 4, from_m: 1.0, width_m: 1.8, kind: "opening", sill_m: null, head_m: 2.1 },
      { edge: 6, from_m: 1.0, width_m: 1.2, kind: "window", sill_m: 0.9, head_m: null },
      { edge: 6, from_m: 2.5, width_m: 0.4, kind: "something else", sill_m: null, head_m: null },
    ];
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    const byEdge = (i) => result.room.symbols.filter((s) => sketch.wallById(result.room, s.wallId).index === i);
    const closet = byEdge(0);
    assert(closet.length === 1 && closet[0].type === "door" && closet[0].doorType === "swing", "closet_door should be a swing door on the closet face");
    near(closet[0].widthFeet, 2.5, "closet door 2'6\"", 1e-9);
    // The symbol is an ordinary door; the result still says which one was the closet door.
    assert(
      result.closetDoorIds.length === 1 && result.closetDoorIds[0] === closet[0].id,
      `closetDoorIds should name the closet door alone, got ${JSON.stringify(result.closetDoorIds)}`,
    );
    const cased = byEdge(4);
    assert(cased.length === 1 && cased[0].type === "door" && cased[0].doorType === "opening", "opening should be a cased opening on the right wall");
    const win = byEdge(6);
    assert(win.length === 1 && win[0].type === "window", "one window on the left wall; the unclassified tap stays wall");
    assert(win[0].sillFeet === 3 && win[0].heightFeet === 4, `a window with only a sill takes the defaults, got sill ${win[0].sillFeet} height ${win[0].heightFeet}`);
    assert(result.room.symbols.length === 3, `expected 3 symbols, got ${result.room.symbols.length}`);
    assert(result.notes.some((n) => /1 unclassified gap left as wall/.test(n)), `expected the unclassified note, got ${JSON.stringify(result.notes)}`);
  });

  test("a tapped outline written the wrong way round still puts each opening on its own edge", () => {
    const fixture = JSON.parse(officeTaps);
    // Reverse the ring: edge i of the file is now from reversed vertex i to i+1, and the sketch
    // will wind it back clockwise. The door must still land on the chamfer and the window on the
    // near wall, at the same place along each.
    const n = fixture.outline.length;
    const reversed = [...fixture.outline].reverse();
    fixture.outline = reversed;
    // Edge i in the original (v[i] -> v[i+1]) is edge n-2-i in the reversed ring, running backwards.
    const edgeLength = (i) => Math.hypot(reversed[(i + 1) % n][0] - reversed[i][0], reversed[(i + 1) % n][1] - reversed[i][1]);
    fixture.outline_openings = fixture.outline_openings.map((o) => {
      const edge = (n - 2 - o.edge + n) % n;
      return { ...o, edge, from_m: edgeLength(edge) - o.from_m - o.width_m };
    });
    const forward = importedOutline(officeTaps);
    const backward = importedOutline(JSON.stringify(fixture));
    const shape = (r) => r.room.vertices.map((v) => `${v.x},${v.y}`).join(" ");
    assert(shape(forward) === shape(backward), `vertices differ:\n      ${shape(forward)}\n      ${shape(backward)}`);
    const placed = (r) => r.room.symbols.map((s) => `${s.type}@${sketch.wallById(r.room, s.wallId).index}:${s.t.toFixed(3)}:${s.widthFeet}`).join(" ");
    assert(placed(forward) === placed(backward), `symbols differ:\n      ${placed(forward)}\n      ${placed(backward)}`);
  });

  test("a window whose jambs were tapped at the same height takes the defaults, not a 1\" sliver", () => {
    const fixture = JSON.parse(officeTaps);
    // Both jambs tapped at chest height: the phone writes the lower z as the sill and the higher
    // as the head, two centimetres apart. That is no measurement of the glass at all.
    const win = fixture.outline_openings.find((o) => o.kind === "window");
    win.sill_m = 1.19;
    win.head_m = 1.21;
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    const windows = result.room.symbols.filter((s) => s.type === "window");
    assert(windows.length === 1, `expected 1 window, got ${windows.length}`);
    assert(windows[0].sillFeet === 3 && windows[0].heightFeet === 4, `expected the 3' sill and 4' height defaults, got sill ${windows[0].sillFeet} height ${windows[0].heightFeet}`);
    near(windows[0].widthFeet, 6, "the width is still the tapped 6'0\"", 1e-9);
    assert(result.notes.some((n) => /1 window's sill and head were tapped at the same height; defaults used/.test(n)), `expected a note about the flat window, got ${JSON.stringify(result.notes)}`);
    // Half a millimetre apart passes a plain head > sill check and rounds to a height of 0.
    win.sill_m = 1.2;
    win.head_m = 1.205;
    const hairline = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(hairline.ok, "import failed");
    const thin = hairline.room.symbols.find((s) => s.type === "window");
    assert(thin.sillFeet === 3 && thin.heightFeet === 4, `a hairline window takes the defaults too, got sill ${thin.sillFeet} height ${thin.heightFeet}`);
    // The well-separated pair is still believed, and there is no note about it.
    win.sill_m = 0.914;
    win.head_m = 2.134;
    const real = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    const glass = real.room.symbols.find((s) => s.type === "window");
    assert(glass.sillFeet === 3 && glass.heightFeet === 4 && !real.notes.some((n) => /same height/.test(n)), "a measured window keeps its measurement");
  });

  test("an opening of no width — the same jamb tapped twice — is dropped, on an outline edge or a wall", () => {
    const fixture = JSON.parse(officeTaps);
    fixture.outline_openings.push({ edge: 5, from_m: 0.5, width_m: 0, kind: "door", sill_m: null, head_m: null });
    fixture.outline_openings.push({ edge: 4, from_m: 0.5, width_m: -0.9, kind: "window", sill_m: null, head_m: null });
    const result = scan.importScanRoom(JSON.stringify(fixture), { x: 0, y: 0 }, 0);
    assert(result.ok, "import failed");
    assert(result.room.symbols.length === 2, `only the real door and window should come in, got ${result.room.symbols.length}`);
    assert(result.room.symbols.every((s) => s.widthFeet > 0), "no symbol should have zero or negative width");
    // The wall path gets the same guard.
    const lap = JSON.parse(office);
    const doorWall = lap.walls.find((w) => w.openings.some((o) => o.kind === "door"));
    doorWall.openings.push({ kind: "door", from_m: 0.2, width_m: 0 });
    doorWall.openings.push({ kind: "window", from_m: 0.2, width_m: -1 });
    const lapResult = scan.importScanRoom(JSON.stringify(lap), { x: 0, y: 0 }, 0);
    assert(lapResult.ok, "import failed");
    assert(lapResult.room.symbols.length === 1 && lapResult.room.symbols[0].widthFeet > 0, `only the real door should come in, got ${lapResult.room.symbols.length}`);
  });

  test("a closed ring or a repeated corner does not make a wall of no length", () => {
    const fixture = JSON.parse(officeTaps);
    const plain = importedOutline(officeTaps);
    const shape = (r) => r.room.vertices.map((v) => `${v.x},${v.y}`).join(" ");
    const placed = (r) => r.room.symbols.map((s) => `${s.type}@${sketch.wallById(r.room, s.wallId).index}:${s.t.toFixed(3)}`).join(" ");
    // GeoJSON-style: the first point written again at the end.
    fixture.outline = [...fixture.outline, [...fixture.outline[0]]];
    const closed = importedOutline(JSON.stringify(fixture));
    assert(closed.room.vertices.length === 7, `a closed ring should still be 7 walls, got ${closed.room.vertices.length}`);
    assert(shape(closed) === shape(plain) && placed(closed) === placed(plain), "a closed ring should import exactly as the unclosed one");
    // The same corner tapped twice, in the middle of the ring: the openings after it keep their
    // edge numbers because the duplicate never became an edge.
    const doubled = JSON.parse(officeTaps);
    doubled.outline = [...doubled.outline.slice(0, 2), [...doubled.outline[1]], ...doubled.outline.slice(2)];
    const dup = importedOutline(JSON.stringify(doubled));
    assert(dup.room.vertices.length === 7, `a repeated corner should collapse to 7 walls, got ${dup.room.vertices.length}`);
    assert(sketch.wallsOf(dup.room).every((w) => w.lengthPx > 0), "no wall should be zero length");
    assert(shape(dup) === shape(plain) && placed(dup) === placed(plain), "a repeated corner should import exactly as the plain ring");
    assert(dup.notes.some((n) => /Measured by tapping; 7 walls/.test(n)), `the note should count 7 walls, got ${JSON.stringify(dup.notes)}`);
  });

  const importedBasement = () => importedOutline(basementTaps);

  test("a partition end comes in as two corners 4½\" apart, and the editor treats it as the wall it is", () => {
    const { room, notes } = importedBasement();
    // Eight corners: four of the room, four of the partition — the two faces where they leave the
    // near wall and the two ends of the wall's thickness. Nothing merged the close pair.
    assert(room.vertices.length === 8, `expected 8 vertices, got ${room.vertices.length}`);
    assert(sketch.ensureClockwise(room.vertices) === room.vertices, "room is not wound clockwise");
    const walls = sketch.wallsOf(room);
    assert(walls.every((w) => w.lengthPx > 0), "no wall should be zero length");
    // 0.115 m is 4.53 px; each corner rounds to a whole pixel, so the end is 4 or 5 px.
    const end = walls.find((w) => Math.abs(w.lengthPx - 4.5) <= 0.5);
    assert(end !== undefined, `no 4½\" edge in ${walls.map((w) => w.lengthPx.toFixed(1))}`);
    assert(end.index === 5, `the partition end should be edge 5, got ${end.index}`);
    // Its two faces are the walls either side of it, running the 1.5 m in and back out.
    near(walls[4].lengthFeet, 1.5 / 0.3048, "partition right face 4'11\"", 1.5 / 12);
    near(walls[6].lengthFeet, 1.5 / 0.3048, "partition left face 4'11\"", 1.5 / 12);
    assert(notes.some((n) => /Measured by tapping; 8 walls/.test(n)), `expected the taps note, got ${JSON.stringify(notes)}`);

    // What the editor does on load: derive parents, and test the outline as the drag rules do.
    // A short wall is only ever refused when a drag makes it SHORTER — see `collapsesAWall`.
    assert(!sketch.isDegenerate(room.vertices), "the room is not degenerate");
    assert(!sketch.collapsesAWall(room, room), "an unmoved room collapses nothing");
    assert(sketch.withDerivedParents([room]).length === 1, "the room loads");
    // Deselecting prunes collinear corners; the partition's are all right angles and stay.
    assert(sketch.pruneCollinearVertices(room).vertices.length === 8, "no partition corner is collinear");

    // The first drag. A far corner moves (no propagation on an eight-corner room, and nothing
    // near enough to snap to); the far wall slides.
    const farCorner = room.vertices[2];
    const movedCorner = sketch.moveVertex(room, farCorner.id, farCorner.x + 20, farCorner.y - 20);
    assert(movedCorner !== room, "dragging a far corner should not be refused");
    const moved = movedCorner.vertices.find((v) => v.id === farCorner.id);
    assert(moved.x === farCorner.x + 20 && moved.y === farCorner.y - 20, `far corner should land where it was dragged, got ${moved.x},${moved.y}`);
    const slidWall = sketch.dragWall(room, walls[1].id, 0, -20);
    assert(slidWall !== room, "dragging the far wall should not be refused");
    // The partition's own face: pulled AWAY from the other face the end grows and the drag takes;
    // pushed towards it the end would shrink below the 4½" it arrived at, and that is refused —
    // the editor's own rule, that a short wall may not be made shorter.
    const face = walls[4];
    const thicker = sketch.dragWall(room, face.id, 10, 0);
    assert(thicker !== room, "pulling a partition face outward should not be refused");
    const grown = sketch.wallsOf(thicker).find((w) => w.id === end.id);
    near(grown.lengthPx, end.lengthPx + 10, "the end grows by what the face was pulled", 1e-6);
    const thinner = sketch.dragWall(room, face.id, -3, 0);
    assert(thinner === room, "pushing a partition face into the other face is refused, as any short wall is");
  });

  test("a tapped cabinet run lands on the wall behind it as a base cabinet, at its width", () => {
    const { room } = importedBasement();
    const cabinets = room.symbols.filter((s) => s.type === "cabinet");
    assert(cabinets.length === 1, `expected 1 cabinet, got ${cabinets.length}`);
    const cabinet = cabinets[0];
    const wall = sketch.wallById(room, cabinet.wallId);
    // Edge 2 of the file is the right wall: x constant at the room's far right, running down.
    assert(wall.index === 2, `cabinet should be on the right wall (2), got wall ${wall.index}`);
    assert(wall.x1 === wall.x2 && wall.x1 === Math.max(...room.vertices.map((v) => v.x)), "the right wall is the one at the far right");
    assert(cabinet.tier === "base", `tier should be base, got ${cabinet.tier}`);
    assert(cabinet.label === "Cabinet", `label should be Cabinet, got ${cabinet.label}`);
    // 1.8 m is 5'10.9", to the inch 5'11"; the depth is the phone's 0.61 m, which is the 24" of a
    // base run; the height is the tier's 36".
    near(cabinet.widthFeet, 5 + 11 / 12, "cabinet 5'11\"", 1e-9);
    near(cabinet.depthFeet, 2, "base depth 2'0\"", 1e-9);
    near(cabinet.heightFeet, 3, "base height 3'0\"", 1e-9);
    // 1.0 m from the edge's start, 1.8 m wide: centre at 1.9 m of 4 m down the right wall.
    near(cabinet.t, 1.9 / 4, "cabinet position along the right wall", 0.01);
    // The whole run is on the wall: neither end past a corner.
    const half = sketch.symbolWidthPx(cabinet, room) / 2;
    assert(cabinet.t * wall.lengthPx - half >= -1e-9 && cabinet.t * wall.lengthPx + half <= wall.lengthPx + 1e-9, "the run should sit within its wall");
    // The door on the far wall came in beside it; nothing else was invented.
    assert(room.symbols.length === 2 && room.symbols.some((s) => s.type === "door"), `expected the door and the cabinet, got ${room.symbols.map((s) => s.type)}`);

    // Tier defaults: a wall cabinet with no depth in the file takes the tier's 12", and a full-height
    // run its 24" and 6' tall.
    const fixture = JSON.parse(basementTaps);
    fixture.cabinets = [
      { edge: 2, from_m: 1.0, width_m: 1.8, tier: "wall" },
      { edge: 6, from_m: 0.2, width_m: 0.9, tier: "full", depth_m: 0.61 },
    ];
    const tiers = importedOutline(JSON.stringify(fixture));
    const upper = tiers.room.symbols.find((s) => s.type === "cabinet" && s.tier === "wall");
    const tall = tiers.room.symbols.find((s) => s.type === "cabinet" && s.tier === "full");
    assert(upper && upper.depthFeet === 1 && upper.heightFeet === 2.5, `an upper without a depth takes 12\" and 30\", got ${JSON.stringify(upper)}`);
    assert(tall && tall.depthFeet === 2 && tall.heightFeet === 6, `a full-height run is 24\" deep and 6' tall, got ${JSON.stringify(tall)}`);
  });

  test("a tapped flight of stairs comes in as a stair room where it was tapped, climbing up the page", () => {
    const { room, extraRooms, notes } = importedBasement();
    assert(extraRooms.length === 1, `expected 1 extra room, got ${extraRooms.length}`);
    const stairs = extraRooms[0];
    assert(stairs.name === "Stairs", `name should be Stairs, got ${stairs.name}`);
    assert(stairs.vertices.length === 4, `expected 4 corners, got ${stairs.vertices.length}`);
    assert(sketch.ensureClockwise(stairs.vertices) === stairs.vertices, "stair room is not wound clockwise");
    assert(stairs.stairs !== null, "the room should be a flight");
    assert(stairs.stairs.orientation === 270, `a flight tapped up the page travels up (270), got ${stairs.stairs.orientation}`);
    assert(stairs.stairs.direction === "up", `direction should be up, got ${stairs.stairs.direction}`);
    assert(stairs.stairs.riseFeet === null, "the rise is the standard storey until measured");
    near(stairs.stairs.treadDepthFeet, sketch.STAIRS_DEFAULT.treadDepthFeet, "tread depth default", 1e-9);
    assert(stairs.ceilingType === "sloped", `a stairwell ceiling is sloped, got ${stairs.ceilingType}`);
    assert(stairs.level === room.level, `the flight joins the room's storey, got ${stairs.level} vs ${room.level}`);
    assert(stairs.id !== room.id, "the flight is its own room");
    // Where it landed: the bottom riser's midpoint is (0.95, 3.8) m from the outline's corner, and
    // the room's corner is at (60, 60). Every corner rounds to a whole pixel, so within one.
    const pxPerM = 12 / 0.3048;
    const maxY = Math.max(...stairs.vertices.map((v) => v.y));
    const bottomRiser = stairs.vertices.filter((v) => v.y === maxY);
    assert(bottomRiser.length === 2, `the bottom riser should be the two lowest corners, got ${bottomRiser.length}`);
    const midX = (bottomRiser[0].x + bottomRiser[1].x) / 2;
    near(midX, 60 + 0.95 * pxPerM, "bottom riser midpoint x", 1);
    near(maxY, 60 + 3.8 * pxPerM, "bottom riser y", 1);
    // The flight measures itself from its corners: 3 m long, 0.9 m wide.
    const flight = sketch.stairFlight(stairs);
    near(flight.runFeet, 3 / 0.3048, "run 9'10\"", 1.5 / 12);
    near(flight.widthFeet, 0.9 / 0.3048, "width 2'11\"", 1.5 / 12);
    // The editor adds room and flight in one update, and the flight nests in the room it stands in.
    const together = sketch.withDerivedParents([room, ...extraRooms]);
    assert(together[1].parentRoomId === room.id, "the flight should nest in the room it was tapped in");
    assert(together[0].parentRoomId === null, "the room itself is nobody's child");
    assert(notes.some((n) => /1 flight of stairs placed/.test(n)), `expected the stairs note, got ${JSON.stringify(notes)}`);
    // A flight in open floor, 0.5 m off the nearest wall, is not pulled anywhere: it lands on the
    // taps, to the pixel the rectangle rounds to.
    near(Math.min(...stairs.vertices.map((v) => v.x)), 60 + 0.5 * pxPerM, "left side where it was tapped", 1);
  });

  test("a flight tapped against a wall, an inch outside it, is put flush and nests in the room", () => {
    // The phone reads to an inch or three; a flight tapped along the left wall lands a little
    // outside it as often as inside. Outside, `isRoomInside` said the flight was not in the room,
    // so it did not nest and stayed behind when the room was dragged into place.
    const pxPerM = 12 / 0.3048;
    const nested = (u) => {
      const fixture = JSON.parse(basementTaps);
      fixture.stairs = [{ corners: [[u, 3.8], [u + 0.9, 3.8], [u + 0.9, 0.8], [u, 0.8]], run_m: 3.0, width_m: 0.9, direction: "up" }];
      const result = importedOutline(JSON.stringify(fixture));
      assert(result.extraRooms.length === 1, `expected the flight at u=${u}`);
      const flight = result.extraRooms[0];
      const together = sketch.withDerivedParents([result.room, flight]);
      return { flight, bounds: sketch.roomBounds(flight), nests: together[1].parentRoomId === result.room.id };
    };
    for (const u of [-0.013, -0.02, -0.05, 0, 0.02, 0.05]) {
      const { flight, bounds, nests } = nested(u);
      assert(nests, `a flight tapped ${u} m from the left wall should nest in the room`);
      assert(bounds.minX === 60, `its left side should be flush on the wall at 60, got ${bounds.minX} (u=${u})`);
      // It slid, it did not shrink: the phone's width is kept when only one wall is near.
      near(bounds.width, 0.9 * pxPerM, `width kept at 2'11\" (u=${u})`, 1);
      const measured = sketch.stairFlight(flight);
      near(measured.widthFeet, 0.9 / 0.3048, `stairFlight width (u=${u})`, 1.5 / 12);
      near(measured.runFeet, 3 / 0.3048, `stairFlight run (u=${u})`, 1.5 / 12);
    }
    // Further out than the noise is a flight that really leaves the room — out through a doorway
    // in the wall, say — and it stays where it was tapped, outside, unnested.
    const away = nested(-0.2);
    assert(!away.nests, "a flight 8\" outside the wall is not in the room and must not be dragged into it");
    near(away.bounds.minX, 60 - 0.2 * pxPerM, "it stays where it was tapped", 1);
    // Both walls near — a stairwell the flight's own width, corners tapped an inch out on each
    // side — and both sides go flush, at the stairwell's width. Made by tapping the flight across
    // the room's near-right corner region: right wall at 5.0 m, near wall at 4.0 m.
    const well = JSON.parse(basementTaps);
    well.stairs = [{ corners: [[4.08, 4.02], [5.02, 4.02], [5.02, 1.0], [4.08, 1.0]], run_m: 3.0, width_m: 0.94, direction: "up" }];
    const wellResult = importedOutline(JSON.stringify(well));
    const wellFlight = wellResult.extraRooms[0];
    const wb = sketch.roomBounds(wellFlight);
    assert(wb.maxX === 60 + Math.round(5.0 * pxPerM), `right side flush on the right wall, got ${wb.maxX}`);
    assert(wb.maxY === 60 + Math.round(4.0 * pxPerM), `bottom riser flush on the near wall, got ${wb.maxY}`);
    assert(sketch.withDerivedParents([wellResult.room, wellFlight])[1].parentRoomId === wellResult.room.id, "the flight in the corner nests");
  });

  test("a flight's four taps come in as the rectangle they describe, not the quadrilateral they are", () => {
    // Inch-level noise on each tap of the fixture's flight. Traced as tapped it was a skewed
    // quadrilateral: the first corner drag made a trapezoid (moveVertex only carries a neighbour
    // along when it shares the axis to half a pixel), the treads were drawn across a bounding box
    // that poked past the outline, and stairFlight read the width an inch wider than the risers.
    const fixture = JSON.parse(basementTaps);
    fixture.stairs = [{ corners: [[0.512, 3.803], [1.417, 3.781], [1.402, 0.812], [0.498, 0.831]], direction: "up" }];
    const { room, extraRooms } = importedOutline(JSON.stringify(fixture));
    assert(extraRooms.length === 1, "the flight comes in");
    const stairs = extraRooms[0];
    assert(stairs.vertices.length === 4, `expected 4 corners, got ${stairs.vertices.length}`);
    assert(sketch.ensureClockwise(stairs.vertices) === stairs.vertices, "stair room is not wound clockwise");
    assert(stairs.vertices.every((v) => Number.isInteger(v.x) && Number.isInteger(v.y)), "corners are whole pixels");
    // Axis-aligned: every wall is exactly vertical or exactly horizontal.
    const walls = sketch.wallsOf(stairs);
    assert(walls.every((w) => w.x1 === w.x2 || w.y1 === w.y2), `expected a rectangle, got ${stairs.vertices.map((v) => `${v.x},${v.y}`).join(" ")}`);
    assert(stairs.stairs.orientation === 270, `still climbs up the page, got ${stairs.stairs.orientation}`);
    // Sized by the phone's own definition: run the mean of |s1-s4| and |s2-s3| (2.971 m), width the
    // mean of |s1-s2| and |s3-s4| (0.905 m), each to the inch.
    const pxPerM = 12 / 0.3048;
    const flight = sketch.stairFlight(stairs);
    near(flight.runFeet, 2.971 / 0.3048, "run 9'9\"", 1 / 12);
    near(flight.widthFeet, 0.905 / 0.3048, "width 3'0\"", 1 / 12);
    // Placed on the taps: the bottom riser's midpoint is where the two bottom taps' midpoint was.
    const maxY = Math.max(...stairs.vertices.map((v) => v.y));
    const riser = stairs.vertices.filter((v) => v.y === maxY);
    near((riser[0].x + riser[1].x) / 2, 60 + ((0.512 + 1.417) / 2) * pxPerM, "bottom riser midpoint x", 1);
    near(maxY, 60 + ((3.803 + 3.781) / 2) * pxPerM, "bottom riser y", 1);
    // And it behaves as a hand-drawn flight does: dragging one corner keeps it a rectangle.
    const corner = stairs.vertices[0];
    const dragged = sketch.moveVertex(stairs, corner.id, corner.x, corner.y - 24);
    assert(dragged !== stairs, "the drag is accepted");
    const draggedWalls = sketch.wallsOf(dragged);
    assert(draggedWalls.every((w) => w.x1 === w.x2 || w.y1 === w.y2), `a dragged corner should keep the flight square, got ${dragged.vertices.map((v) => `${v.x},${v.y}`).join(" ")}`);
    near(sketch.roomBounds(dragged).height, sketch.roomBounds(stairs).height + 24, "the run grew by the drag", 1e-9);
    // It still nests in the room.
    assert(sketch.withDerivedParents([room, stairs])[1].parentRoomId === room.id, "the squared flight nests in the room");
    // Askew to the room — tapped at 30 degrees, in open floor clear of every wall — it comes in
    // square to the page along the nearer axis, which is the only way the sketch draws a flight;
    // run and width are still the taps'.
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const turn = ([u, v]) => [1.5 + u * c - v * s, 2.0 + u * s + v * c];
    fixture.stairs = [{ corners: [[-0.45, 1.5], [0.45, 1.5], [0.45, -1.5], [-0.45, -1.5]].map(turn), direction: "up" }];
    const askew = importedOutline(JSON.stringify(fixture));
    assert(askew.extraRooms.length === 1, "the askew flight comes in");
    const askewWalls = sketch.wallsOf(askew.extraRooms[0]);
    assert(askewWalls.every((w) => w.x1 === w.x2 || w.y1 === w.y2), "an askew flight is drawn square");
    assert(askew.extraRooms[0].stairs.orientation === 270, `30 degrees off up the page is still up, got ${askew.extraRooms[0].stairs.orientation}`);
    near(sketch.stairFlight(askew.extraRooms[0]).runFeet, 3 / 0.3048, "askew run", 1.5 / 12);
    near(sketch.stairFlight(askew.extraRooms[0]).widthFeet, 0.9 / 0.3048, "askew width", 1.5 / 12);
  });

  test("the direction of travel is read from the risers, whichever way the flight was tapped", () => {
    // s1..s4 are bottom-left, bottom-right, top-right, top-left facing up the flight, so the same
    // 3 m x 0.9 m flight tapped facing each way of the page names each orientation.
    const flights = [
      { corners: [[0.5, 1.0], [0.5, 1.9], [3.5, 1.9], [3.5, 1.0]], orientation: 0 },
      { corners: [[1.4, 0.8], [0.5, 0.8], [0.5, 3.8], [1.4, 3.8]], orientation: 90 },
      { corners: [[3.5, 1.9], [3.5, 1.0], [0.5, 1.0], [0.5, 1.9]], orientation: 180 },
      { corners: [[0.5, 3.8], [1.4, 3.8], [1.4, 0.8], [0.5, 0.8]], orientation: 270 },
    ];
    for (const { corners, orientation } of flights) {
      const fixture = JSON.parse(basementTaps);
      fixture.stairs = [{ corners, run_m: 3.0, width_m: 0.9, direction: "up" }];
      const result = importedOutline(JSON.stringify(fixture));
      assert(result.extraRooms.length === 1, `expected 1 flight for orientation ${orientation}`);
      const stairs = result.extraRooms[0];
      assert(stairs.stairs.orientation === orientation, `expected orientation ${orientation}, got ${stairs.stairs.orientation}`);
      assert(sketch.ensureClockwise(stairs.vertices) === stairs.vertices, `flight at ${orientation} is not wound clockwise`);
      const flight = sketch.stairFlight(stairs);
      near(flight.runFeet, 3 / 0.3048, `run at ${orientation}`, 1.5 / 12);
      near(flight.widthFeet, 0.9 / 0.3048, `width at ${orientation}`, 1.5 / 12);
    }
    // A flight going down from this room keeps that too.
    const fixture = JSON.parse(basementTaps);
    fixture.stairs[0].direction = "down";
    const down = importedOutline(JSON.stringify(fixture));
    assert(down.extraRooms[0].stairs.direction === "down", "a flight tapped as going down goes down");
  });

  test("a cabinet or a flight the file got wrong is skipped with a note, never fatal", () => {
    const fixture = JSON.parse(basementTaps);
    fixture.cabinets = [
      { edge: 2, from_m: 1.0, width_m: 1.8, tier: "base", depth_m: 0.61 },
      { edge: 2, from_m: 1.0, width_m: 1.8, tier: "island" },
      { edge: 3, from_m: 0.1, width_m: 0 },
      { edge: 9, from_m: 0.1, width_m: 0.6, tier: "wall" },
      "not a cabinet",
    ];
    fixture.stairs = [
      { corners: [[0.5, 3.8], [1.4, 3.8], [1.4, 0.8], [0.5, 0.8]], direction: "up" },
      { corners: [[0.5, 3.8], [1.4, 3.8], [1.4, 0.8]], direction: "up" },
      { corners: [[2.0, 2.0], [2.0, 2.0], [2.0, 2.0], [2.0, 2.0]], direction: "up" },
      null,
    ];
    // What the phone itself could not place it names in `outline_notes`, in its own words, and
    // those reach the PM as written: a run that was tapped and is not on the sketch is exactly what
    // the notice is for. Anything in the list that is not a sentence is ignored.
    fixture.outline_notes = ["Cabinet 2 sits 1.95 m (6'5\") off every wall – unplaced", "", 42, null, "  Opening 3 sits 0.7 m (2'4\") off every wall – unplaced  "];
    const result = importedOutline(JSON.stringify(fixture));
    assert(result.notes.includes("Cabinet 2 sits 1.95 m (6'5\") off every wall – unplaced"), `expected the phone's cabinet note word for word, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.includes("Opening 3 sits 0.7 m (2'4\") off every wall – unplaced"), `expected the phone's opening note, trimmed, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.length === result.notes.filter((n) => typeof n === "string" && n !== "").length, "no empty or non-string note");
    // The phone's word comes before this side's complaints about the file.
    assert(result.notes.indexOf("Cabinet 2 sits 1.95 m (6'5\") off every wall – unplaced") < result.notes.findIndex((n) => /could not be read/.test(n)), `phone first, then the importer, got ${JSON.stringify(result.notes)}`);
    // The one good cabinet and the one good flight come in; the room is untouched by the rest.
    assert(result.room.vertices.length === 8, "the room still imports");
    assert(result.room.symbols.filter((s) => s.type === "cabinet").length === 1, `only the well-formed cabinet should come in, got ${result.room.symbols.filter((s) => s.type === "cabinet").length}`);
    assert(result.extraRooms.length === 1, `only the well-formed flight should come in, got ${result.extraRooms.length}`);
    assert(result.notes.some((n) => /3 cabinets in the file could not be read; skipped/.test(n)), `expected a note about the unreadable cabinets, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.some((n) => /1 cabinet named a wall the outline does not have; skipped/.test(n)), `expected a note about the stray cabinet, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.some((n) => /2 flights of stairs in the file could not be read; skipped/.test(n)), `expected a note about the unreadable flights, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.some((n) => /1 flight of stairs had corners that enclose nothing; skipped/.test(n)), `expected a note about the flat flight, got ${JSON.stringify(result.notes)}`);
    assert(result.notes.some((n) => /1 flight of stairs placed/.test(n)), `the good flight is still counted, got ${JSON.stringify(result.notes)}`);
    // Absent altogether is simply none: no notes, nothing extra, the office as it always was.
    const office = importedOutline(officeTaps);
    assert(office.extraRooms.length === 0 && !office.room.symbols.some((s) => s.type === "cabinet"), "a file without the new fields has neither");
    assert(!office.notes.some((n) => /cabinet|stairs/.test(n)), `no note about what was never there, got ${JSON.stringify(office.notes)}`);
  });

  return { passed, failures };
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const { passed, failures } = await runScanImportChecks();
  for (const name of passed) console.log(`  ✓ ${name}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.log(`\n  ${passed.length} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
}
