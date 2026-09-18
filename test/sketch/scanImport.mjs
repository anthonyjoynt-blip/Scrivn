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
    const { closetDoorIds } = imported();
    assert(Array.isArray(closetDoorIds) && closetDoorIds.length === 0, `a lap scan has no closet doors, got ${JSON.stringify(closetDoorIds)}`);
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
