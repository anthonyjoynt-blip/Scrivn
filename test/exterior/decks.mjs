/**
 * Decks and porches (2026-10-20, lib/decks.ts, lib/deckPhotos.ts): the owner's "we may also want to build in decks. capture
 * on the exterior photos like everything else".
 *
 *   npm run test:exterior:decks
 *   SCRIVN_REPORT_OUT=<dir> npm run test:exterior:decks     also keeps his house's report with its decks, and the drawings
 *
 * NO PAID CALL, no server, no key. What is checked:
 *   * a deck typed in the quick-deck box: its outline back to the wall, its railings round its stairs, its risers from its
 *     height, its posts, its ledger worked out from the walls; one typed wider than its wall fills the covered corner beside it
 *   * the roof: a covered deck is under the roof's squares, never added to them, and nothing of the roof or the walls moves
 *   * its lines, only when ticked, named for a building; "Check these" and "To check" for what no photo shows
 *   * the report, the 3D model, the four views and each side's drawing; a house with no deck is as it always was
 *   * the trace's deck words through off_wall, put on the deck at its own distance out
 *   * his house: both decks read off his photos with the photo route's own cameras (fixtures/decks/), against his tapes
 */

import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const lib = (name) => join(root, name).replace(/\\/g, "/");

async function load() {
  const outDir = mkdtempSync(join(tmpdir(), "decks-"));
  const entry = join(outDir, "entry.ts");
  const outfile = join(outDir, "entry.mjs");
  writeFileSync(
    entry,
    [
      `export * from "${lib("lib/exterior.ts")}";`,
      `export * from "${lib("lib/decks.ts")}";`,
      `export * from "${lib("lib/deckPhotos.ts")}";`,
      `export { parseScanExterior } from "${lib("lib/exteriorImport.ts")}";`,
      `export { withAddition } from "${lib("lib/exteriorPlan.ts")}";`,
      `export { withRoofChecked, withWingAnswer } from "${lib("lib/roofCheck.ts")}";`,
      `export { exteriorReport } from "${lib("lib/exteriorReport.ts")}";`,
      `export { exteriorReportBytes } from "${lib("lib/exteriorReportPdf.ts")}";`,
      `export { asBuilding, buildingScopeLines, siteReport, siteScopeLines } from "${lib("lib/buildings.ts")}";`,
      `export { exteriorModel } from "${lib("lib/exterior3d.ts")}";`,
      `export { decksOnSide, houseView, VIEWS } from "${lib("lib/exteriorViews.ts")}";`,
      `export { checkNotes, exteriorChecks, openChecks, withChecksClosed } from "${lib("lib/exteriorCheck.ts")}";`,
      `export { traceProposals } from "${lib("lib/exteriorTrace.ts")}";`,
      `export { parseSavedClaimState } from "${lib("lib/claimState.ts")}";`,
      `export { formatFeetInches } from "${lib("lib/sketch.ts")}";`,
      `export { ElevationDrawing, FootprintDrawing, HouseElevationDrawing, RoofPlanDrawing } from "${lib("components/sketch/exteriorDrawings.tsx")}";`,
      `export { DeckPlanDrawing } from "${lib("components/sketch/deckDrawings.tsx")}";`,
      `export { renderToStaticMarkup } from "react-dom/server.browser";`,
      `export { createElement } from "react";`,
    ].join("\n"),
  );
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    jsx: "automatic",
    alias: { "@": root, "server-only": join(root, "node_modules", "server-only", "empty.js") },
    nodePaths: [join(root, "node_modules")],
    logLevel: "silent",
  });
  const mod = await import(pathToFileURL(outfile).href);
  rmSync(outDir, { recursive: true, force: true });
  return mod;
}

const x = await load();

let passed = 0;
const failures = [];
async function test(name, run) {
  try {
    await run();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err instanceof Error ? err.stack?.split("\n").slice(0, 4).join("\n      ") : String(err)}`);
  }
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function near(a, b, message, tol = 1e-6) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`${message}: ${a} against ${b} (within ${tol})`);
}
const ft = (feet, inches = 0) => feet + inches / 12;
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const META = { title: "Decks", date: "Oct 20, 2026", madeWith: "Scrivn" };
const svgOf = (el) => x.renderToStaticMarkup(el);
const strip = (v) => JSON.stringify(v, (k, val) => (k === "id" || k === "deckId" ? undefined : val));

/** A 40' × 30' box house, 9' walls, a 6/12 gable. */
function boxHouse() {
  const e = x.rectangleExterior(40, 30, 9);
  return { ...e, roof: { ...e.roof, pitch: 6 } };
}
const sideOf = (e, name) => e.sides.find((s) => s.name === name || s.name.startsWith(name));

// ---------------------------------------------------------------------------------------------
console.log("\nA deck typed in the quick-deck box");
// ---------------------------------------------------------------------------------------------

await test("12' × 16' on the rear wall, 6' up, glass, a 4' stair off its outer edge: its area, ledger, rim, railings round the stair, 10 risers, posts", () => {
  const house = boxHouse();
  const rear = sideOf(house, "Rear");
  const deck = x.quickDeck(house, { name: "Deck", sideId: rear.id, widthFeet: 16, depthFeet: 12, heightFeet: 6, decking: "composite", railing: "glass", stairs: { widthFeet: 4, where: "outer" } });
  const e = { ...house, decks: [deck] };
  const q = x.deckQuantities(e, deck);
  near(q.areaSquareFeet, 192, "area");
  near(q.ledgerFeet, 16, "the ledger is its wall's stretch");
  near(q.rimFeet, 40, "the rim round its three open edges");
  // Railings: the outer edge less the stair (16 - 4), both ends; the stair's two sides down its slope.
  const glass = q.railingByKind.find((r) => r.kind === "glass");
  assert(glass, "a glass railing");
  const stair = q.stairs[0];
  assert(stair.stair.risers === 10, `6' at 7¾" at most is 10 risers (${stair.stair.risers})`);
  near(stair.riseFeet, 0.6, "each rise", 1e-9);
  near(stair.totalRunFeet, 9 * (10 / 12), "9 treads at 10\"", 1e-9);
  near(glass.feet, 12 + 12 + 12 + 2 * Math.hypot(7.5, 6), "the deck's own 36' and the stair's two sides", 1e-6);
  near(glass.stairFeet, 2 * Math.hypot(7.5, 6), "on the stairs", 1e-6);
  // Posts under its outer beam: a post at each outer corner and between, 8' apart or less.
  assert(q.posts.count === 3, `posts: ${q.posts.count}`);
  // Under the roof: only the strip the eave's overhang reaches over.
  const roofed = x.deckQuantities(e, deck, x.exteriorQuantities(e).roof);
  near(roofed.coveredSquareFeet, 16 * x.DEFAULT_EAVE_OVERHANG_FEET, "the eave's overhang over it", 1e-4);
});

await test("its lines, as the brief has them, named for the deck", () => {
  const house = boxHouse();
  const deck = x.quickDeck(house, { name: "Deck", sideId: sideOf(house, "Rear").id, widthFeet: 20, depthFeet: 12, heightFeet: 4, decking: "composite", railing: "aluminum", stairs: { widthFeet: 4, where: "outer" } });
  const lines = x.deckLines(x.deckQuantities({ ...house, decks: [deck] }, deck));
  assert(lines[0] === "Deck – composite decking – 240.0 SF", lines[0]);
  assert(lines.some((l) => /^Deck – aluminum picket railing – \d+\.\d LF \(incl\. \d+\.\d LF on the stairs, 3'6" high\)$/.test(l)), lines.join("\n"));
  assert(lines.includes(`Deck – stairs – 7 risers, 4' wide (4' rise, 5' run)`), lines.join("\n"));
  assert(lines.some((l) => /^Deck – posts – \d+ \(6×6, about 4' each\)$/.test(l)), lines.join("\n"));
  assert(lines.includes("Deck – ledger – 20.0 LF"), lines.join("\n"));
});

await test("a deck typed wider than its wall runs into the covered corner beside it, back to the walls there: its ledger along all three", () => {
  // An L: the notch at the rear right is 10' × 8'. Facing the 30' rear wall from behind, the notch is past its left end.
  const house = { ...x.lShapeExterior(40, 30, 10, 8, 9), roof: { ...x.defaultRoof(), pitch: 5 } };
  const rear = sideOf(house, "Rear");
  const deck = x.quickDeck(house, { name: "Deck", sideId: rear.id, fromLeftFeet: -10, widthFeet: 40, depthFeet: 6, heightFeet: 3, decking: "wood", railing: "wood", stairs: null });
  const e = { ...house, decks: [deck] };
  const q = x.deckQuantities(e, deck, x.exteriorQuantities(e).roof);
  near(q.areaSquareFeet, 40 * 6 + 10 * 8, "the strip and the notch", 1e-6);
  const against = q.geometry.edges.flatMap((g) => g.against.map((a) => `${a.name} ${(a.toFeet - a.fromFeet).toFixed(1)}`)).sort();
  assert(JSON.stringify(against) === JSON.stringify(["Inside right 8.0", "Rear 30.0", "Right rear 10.0"]), against.join(", "));
  near(q.ledgerFeet, 48, "its ledger along all three", 1e-6);
  // Railed on its three open edges: the outer 40', its left end 6' + 8' down the notch's open side, its right end 6'.
  const wood = q.railingByKind.find((r) => r.kind === "wood");
  near(wood.feet, 40 + 14 + 6, "railings", 1e-6);
});

await test("a covered notch's deck: under the roof, its area in the roof's squares and not added again - and the roof doesn't move", () => {
  const house = { ...x.lShapeExterior(40, 30, 12, 10, 9), roof: { ...x.defaultRoof(), pitch: 5 } };
  const inside = sideOf(house, "Inside right");
  const covered = { ...house, roof: { ...house.roof, coveredNotches: [inside.id], answered: [`notch:${inside.id}`] } };
  const rearRight = sideOf(house, "Right rear");
  // The deck in the notch, against its back wall (the "Right rear" side, 12' long), 10' out: the notch whole.
  const deck = x.quickDeck(covered, { name: "Deck", sideId: rearRight.id, fromLeftFeet: 0, widthFeet: 12, depthFeet: 10, heightFeet: 2, decking: "composite", railing: "none", stairs: null });
  const before = x.exteriorQuantities(covered);
  const withDeck = { ...covered, decks: [deck] };
  const after = x.exteriorQuantities(withDeck);
  assert(strip(after.roofing) === strip(before.roofing), "the roof's quantities are the same with the deck");
  assert(strip(after.sides) === strip(before.sides), "and the walls'");
  const q = x.deckQuantities(withDeck, deck, after.roof);
  near(q.areaSquareFeet, 120, "the notch's 12' × 10'", 1e-6);
  near(q.coveredSquareFeet, 120, "all of it under the roof", 1e-6);
  near(q.ledgerFeet, 12 + 10, "against the notch's two walls", 1e-6);
  assert(x.deckLines(q)[0] === "Deck – composite decking – 120.0 SF (all of it under the house's roof)", x.deckLines(q)[0]);
});

await test("its lines go on the scope only when ticked; a building's are named for it", () => {
  const house = boxHouse();
  const deck = x.quickDeck(house, { name: "Deck", sideId: sideOf(house, "Front").id, widthFeet: 10, depthFeet: 6, heightFeet: 2, decking: "wood", railing: "wood", stairs: null });
  const e = { ...house, decks: [deck] };
  assert(x.siteScopeLines(e, []).siding.length === 0, "nothing ticked, no line");
  const ticked = { ...e, scope: { ...x.emptyScope(), decks: [deck.id] } };
  const lines = x.siteScopeLines(ticked, []).siding;
  assert(lines[0] === "Deck – wood decking – 60.0 SF", lines.join("\n"));
  const shed = x.asBuilding(ticked, "Shed", "building-shed");
  const named = x.siteScopeLines(undefined, [shed]).siding;
  assert(named[0] === "Shed – Deck – wood decking – 60.0 SF", named[0]);
  // Taken away, it is off the scope too.
  const gone = x.withDeckChange(ticked, deck.id, () => undefined);
  assert(!gone.decks && gone.scope.decks.length === 0, "taken off the scope with it");
});

await test("a wall taken away: the deck against it keeps its place on the plan, free-standing", () => {
  const house = boxHouse();
  const rear = sideOf(house, "Rear");
  const deck = x.quickDeck(house, { name: "Deck", sideId: rear.id, widthFeet: 10, depthFeet: 6, heightFeet: 2, decking: "wood", railing: "none", stairs: null });
  const e = { ...house, decks: [deck] };
  const plan = x.deckGeometry(e, deck).plan;
  const kept = x.decksWithoutSide(e, rear.id)[0];
  assert(kept.sideId === null, "free-standing now");
  const again = x.deckGeometry({ ...e, decks: [kept] }, kept).plan;
  plan.forEach((p, i) => near(Math.hypot(p.x - again[i].x, p.y - again[i].y), 0, "the same place", 1e-9));
});

await test("decks saved half-right are skipped, not crashed on; a claim with decks round-trips", () => {
  const house = boxHouse();
  const deck = x.quickDeck(house, { name: "Deck", sideId: sideOf(house, "Rear").id, widthFeet: 10, depthFeet: 6, heightFeet: 2, decking: "wood", railing: "none", stairs: null });
  const list = x.decksOf({ decks: [deck, null, { id: "d", outline: [{ x: 0, y: 0 }] }, { id: "e", outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }] });
  assert(list.length === 1 && list[0].id === deck.id, `kept ${list.length}`);
  const saved = x.parseSavedClaimState({ sketch: { rooms: [], exterior: { ...house, decks: [deck] } } });
  assert(saved.sketch.exterior.decks[0].id === deck.id, "the deck comes back");
});

// ---------------------------------------------------------------------------------------------
console.log("\nWhat no photo shows: Check these and To check");
// ---------------------------------------------------------------------------------------------

await test("a deck off the photos asks its framing, its posts behind skirting and what was read unsure; answered, it isn't asked; a typed one asks nothing", () => {
  const house = boxHouse();
  const base = x.quickDeck(house, { name: "Porch", sideId: sideOf(house, "Front").id, widthFeet: 10, depthFeet: 6, heightFeet: 3, decking: "wood", railing: "aluminum", stairs: null });
  assert(x.deckChecks({ ...house, decks: [base] }).length === 0, "a typed deck asks nothing");
  const photo = { ...base, from: "photos", screens: [{ id: "s", kind: "skirting", edge: 0, heightFeet: 3, material: "lattice" }], posts: { count: 2 } };
  const e = { ...house, decks: [photo] };
  const items = x.deckChecks(e).map((r) => r.item);
  assert(items.includes("framing") && items.includes("posts"), items.join(", "));
  const q = x.exteriorQuantities(e);
  assert(x.exteriorChecks(e, q).some((r) => r.kind === "deck" && r.item === "posts"), "on Check these");
  assert(x.checkNotes(e, q).some((n) => n.startsWith("Porch: its framing:")), x.checkNotes(e, q).join("\n"));
  const counted = x.withDeckAnswer(e, photo.id, "posts", 4);
  assert(counted.decks[0].posts.count === 4 && !x.deckChecks(counted).some((r) => r.item === "posts"), "counted, no longer asked");
});

await test("a door up off the ground with a deck at its foot is not asked about", () => {
  const house = boxHouse();
  const front = sideOf(house, "Front");
  const withDoor = { ...house, source: { kind: "photos", by: "photos", captureId: null, scanId: null, receivedAt: null, notes: [] }, sides: house.sides.map((s) => (s.id === front.id ? { ...s, openings: [{ id: "door-1", kind: "door", widthFeet: 3, heightFeet: 6.67, sillFeet: 4, fromLeftFeet: 18 }] } : s)) };
  const q0 = x.exteriorQuantities(withDoor);
  assert(x.exteriorChecks(withDoor, q0).some((r) => r.kind === "opening" && r.why === "off_ground"), "asked with nothing at its foot");
  const deck = x.quickDeck(withDoor, { name: "Deck", sideId: front.id, widthFeet: 12, depthFeet: 6, heightFeet: 4, decking: "wood", railing: "none", stairs: null });
  const e = { ...withDoor, decks: [deck] };
  assert(!x.exteriorChecks(e, x.exteriorQuantities(e)).some((r) => r.kind === "opening"), "a deck at its foot: not asked");
});

// ---------------------------------------------------------------------------------------------
console.log("\nThe trace's deck words, put on the deck");
// ---------------------------------------------------------------------------------------------

await test("off_wall boxes starting deck, railing, gate, stair, post, privacy screen read as the deck's; anything else stays in front of the wall", () => {
  const frame = { width: 1200, height: 800, ppm: 40, alongMinM: 0, upMaxM: 6 };
  const box = (along0, up0, along1, up1) => [along0 * 40, (6 - up1) * 40, along1 * 40, (6 - up0) * 40];
  const p = x.traceProposals(
    {
      materials: [],
      openings: [],
      wall_top: [],
      off_wall: [
        { what: "deck, composite", box: box(0, 2.0, 8, 2.3) },
        { what: "railing, glass", box: box(0, 2.3, 3, 3.4) },
        { what: "railing, glass, partly hidden by a planter", box: box(4.2, 2.3, 8, 3.4) },
        { what: "gate", box: box(3, 2.3, 3.5, 3.3) },
        { what: "stair, 8 risers", box: box(3, 0, 4.2, 2.3) },
        { what: "post", box: box(7.8, 0, 8, 2) },
        { what: "AC unit", box: box(9, 0, 10, 1) },
      ],
      notes: "",
    },
    frame,
    10 / 0.3048,
  );
  const d = p.deck;
  assert(d && d.decking === "composite" && d.railings.length === 2 && d.railings.every((r) => r.kind === "glass"), JSON.stringify(d));
  assert(d.railings[1].hiddenBy === "a planter" && d.stairs[0].risers === 8 && d.posts.length === 1 && d.gates === 1, JSON.stringify(d));
  assert(p.offWall.length === 7, "every box kept in front of the wall, as before");
});

await test("the read put on the deck against that side: railings by kind and height on its outer edge, the stair's risers and gate, its posts", () => {
  const house = boxHouse();
  const rear = sideOf(house, "Rear");
  const deck = x.quickDeck(house, { name: "Deck", sideId: rear.id, fromLeftFeet: 10, widthFeet: 20, depthFeet: 6, heightFeet: 6, decking: "wood", railing: "wood", stairs: null });
  const e = { ...house, decks: [deck] };
  const read = {
    rim: { x0: 10, x1: 30, y0: 5.2, y1: 6 },
    decking: "composite",
    railings: [
      { kind: "glass", box: { x0: 10, x1: 18, y0: 6, y1: 9.5 } },
      { kind: "glass", box: { x0: 22, x1: 30, y0: 6, y1: 9.5 } },
    ],
    gates: 1,
    stairs: [{ risers: 10, box: { x0: 18, x1: 22, y0: 0, y1: 6 } }],
    posts: [{ x0: 10, x1: 10.5, y0: 0, y1: 5 }],
    screens: [],
    from: [0, 1, 2, 3, 4],
  };
  const { exterior: out, words } = x.withDeckRead(e, rear.id, read, null);
  const d = out.decks[0];
  assert(d.decking === "composite" && d.railings.filter((r) => r.kind === "glass").length === 2, JSON.stringify(d.railings));
  assert(d.railings.every((r) => r.edge !== 0 || r.kind === "glass"), "the outer edge's railings are the read's");
  assert(d.stairs.length === 1 && d.stairs[0].risers === 10 && d.stairs[0].gate === true, JSON.stringify(d.stairs));
  near(d.stairs[0].widthFeet, 4, "its width", 1e-9);
  near(d.railings.find((r) => r.kind === "glass").heightFeet, 3.5, "3'6\" high", 1e-9);
  assert(words.length >= 2, words.join(", "));
  // Wood still on its two ends: the read was only of the edge along the side.
  assert(d.railings.some((r) => r.kind === "wood"), "the ends' railings stay");
});

// ---------------------------------------------------------------------------------------------
console.log("\nHis house: the rear deck and the front porch off his photos (no API)");
// ---------------------------------------------------------------------------------------------

/** His house as the runner measured it with his four tapes in (the bump-out's 6'0" among them), its reads, roof answers and trim. */
const house = fixture("decks/owner-1020-house.json").exterior;
const route = house.photoRoute.measured;
const reads = fixture("decks/owner-1016-decks.json");
const cams = new Map(x.placedCameras(route).map((c) => [c.photo, c]));
const C = route.corners;
const cross = (taps) =>
  x.crossBearings(
    taps.map(([p, px, py]) => {
      const cam = cams.get(p);
      return { at: cam.at, dir: x.pixelRay(cam, px, py).dir };
    }),
  );
const height = ([, p, tx, ty, fx, fy], at) => x.heightOver(cams.get(p), at, { x: tx, y: ty }, { x: fx, y: fy });
const sideFeet = (i) => Math.hypot(C[(i + 1) % C.length].x - C[i].x, C[(i + 1) % C.length].y - C[i].y);
// The rear wall C7-C8, the covered corner's side C8-C9 and back wall C9-C10, the bump-out's west side C6-C7 (his 6'0").
const rearFeet = sideFeet(6);
const coveredFeet = sideFeet(7);
const backFeet = sideFeet(8);
const bumpOutFeet = sideFeet(5);

await test("the cameras: the house's corners land on its corners in photo #8 - the covered corner's far end, the bump-out's at its downspout", () => {
  const cam = cams.get("p8");
  near(x.projectPoint(cam, C[9], 7.5).x, 1407, "C10 at the covered back wall's west end", 25);
  near(x.projectPoint(cam, C[5], 0).x, 60, "C6 at the bump-out's downspout", 25);
});

await test("the rear deck: its outer-west corner on the left gable wall's line and on the bump-out's back face - 6'0\" out, as he says", () => {
  near(bumpOutFeet, 6, "his tape on the bump-out", 1e-3);
  const corner = cross(reads.taps.rear.outerWestCornerEdge).at;
  near(corner.x, C[9].x, "flush with the left gable wall", 0.3);
  near(corner.y - C[6].y, 6, "out from the rear wall to the bump-out's face", 2 / 12);
  // The post on its west edge, three photos within 4".
  const post = cross(reads.taps.rear.postOnWestEdge);
  assert(post.spreadFeet < 0.4, `spread ${post.spreadFeet}`);
  near(post.at.x, C[9].x, "on the west edge, set in from it", 0.6);
});

await test("the rear deck from his taps, as the photo route makes it: its west end on the gable wall's line, the covered corner filled; its rim at its corner post's foot, 4\" in, so its depth is asked", () => {
  const { deck, why } = x.deckFromPhotos(route, 6, reads.decks[0].taps, null, { id: "deck-rear", name: "Rear deck" });
  assert(deck, why.join(" "));
  const xs = deck.outline.map((p) => p.x);
  near(Math.max(...xs), rearFeet + backFeet, "to the left gable wall's line", 1e-3);
  // Its east end a weak crossing (#8 and #9 taken close together), by the bump-out's side.
  near(Math.min(...xs), 0, "by the bump-out's side", 1.1);
  const ys = deck.outline.map((p) => p.y);
  near(Math.max(...ys), bumpOutFeet, "its rim by the bump-out's face", 0.4);
  near(Math.min(...ys), -coveredFeet, "back to the covered corner's back wall", 1e-6);
  assert(x.deckChecks({ ...house, decks: [deck] }).some((r) => r.item === "depth"), "its depth asked");
  // Its height over the lawn at the outer corner: 4'5" to 5'2" - the walls stand 7'6" over the low ground by the house.
  assert(deck.heightFeet > 4.4 && deck.heightFeet < 5.2, `height ${deck.heightFeet}`);
});

await test("the rear deck's height: 4'5\"-5'2\" over the lawn at its outer posts, the glass 3'5\"-4' high", () => {
  // The privacy screen's reads scatter on this measure (#6 stands 7' from where the first put it): its 5'8" is the first's.
  const [top, postTop, , rail] = reads.taps.rear.heights;
  const corner = cross(reads.taps.rear.outerWestCornerPost).at;
  const h = height(top, corner);
  assert(h > 4.4 && h < 5.2, `at the outer corner ${h}`);
  const post = cross(reads.taps.rear.postOnWestEdge).at;
  const h2 = height(postTop, post);
  assert(h2 > 4.2 && h2 < 5.2, `over the west edge's post ${h2}`);
  const r = height(rail, corner);
  assert(r > 3.4 && r < 4.1, `glass ${r}`);
});

await test("the porch: its west corner column on the front wall's line at the corner; its columns 4'6\"-5'2\" out; 263\" from the keystone wall to the west column's inside face", () => {
  const col = cross(reads.taps.porch.westCornerColumn).at;
  const wallY = C[10].y;
  near(col.y, wallY, "on the front wall's line", 0.3);
  near(col.x, C[10].x, "at the corner", 0.4);
  for (const k of ["leftColumn", "rightColumn"]) {
    const c = cross(reads.taps.porch[k]).at;
    const out = wallY - c.y;
    assert(out > 4.5 && out < 5.2, `${k} ${out.toFixed(2)}' out`);
  }
  const post = cross(reads.taps.porch.frontWestPost).at;
  assert(wallY - post.y > 4.3 && wallY - post.y < 4.9, `its front-west post ${(wallY - post.y).toFixed(2)}' out`);
  // The column is 11" square: its inside face 5½" in from its middle. His tape: 263".
  const inside = col.x + 5.5 / 12;
  const inches = (C[11].x - inside) * 12;
  near(inches, 263, "keystone wall to the west column's inside face, inches", 263 * 0.02);
});

await test("the porch's height: 3'5\"-4'1\" over the walk at its columns", () => {
  for (const t of reads.taps.porch.heights.filter((h) => h[0].startsWith("top"))) {
    const at = cross(reads.taps.porch[t[0].includes("Left") ? "leftColumn" : "rightColumn"]).at;
    const h = height(t, at);
    assert(h > 3.4 && h < 4.1, `${t[0]} on ${t[1]}: ${h}`);
  }
});

/** His two decks as read (fixtures/decks/owner-1016-decks.json) on the house: each against its wall, back to the walls behind it. */
function withHisDecks(house) {
  const decks = reads.decks.map(({ sideName, fromLeftFeet, toFeet, depthFeet, ...d }) => {
    const side = sideOf(house, sideName);
    const ring = x.ringInSideFrame(house, side.id);
    return { ...d, sideId: side.id, outline: x.outlineToWalls(ring, fromLeftFeet, toFeet, depthFeet) };
  });
  return { ...house, decks, scope: { ...(house.scope ?? x.emptyScope()), decks: decks.map((d) => d.id) } };
}

const decked = withHisDecks(house);

await test("on his house the decks change nothing of the roof or the walls", () => {
  const a = x.exteriorQuantities(house);
  const b = x.exteriorQuantities(decked);
  assert(strip(a.roofing) === strip(b.roofing), "roof");
  assert(strip(a.sides) === strip(b.sides), "walls");
  near(b.roofing.squares, a.roofing.squares, "squares", 1e-12);
});

await test("the rear deck squared off with the bump-out: its rim on the bump-out's face across to the gable wall's line, the covered corner in it, its ledger on four walls", () => {
  const q = x.decksQuantities(decked, x.exteriorQuantities(decked).roof);
  const rear = q.find((d) => d.name === "Rear deck");
  const g = rear.geometry;
  // The house's own sides (the route's corners within 0.003' of them).
  const [bumpOutFeet, rearFeet, coveredFeet, backFeet] = ["Bump-out left side", "Rear wall", "Covered-deck side", "Covered-deck back wall"].map((n) => sideOf(house, n).lengthFeet);
  near(Math.max(...rear.deck.outline.map((p) => p.y)), bumpOutFeet, "its rim on the bump-out's face", 1e-3);
  near(g.edges[0].lengthFeet, rearFeet + backFeet, "its rim: the rear wall and the covered corner's back wall", 1e-6);
  near(rear.areaSquareFeet, (rearFeet + backFeet) * 6 + backFeet * coveredFeet, "the strip 6'0\" out and the covered corner", 1e-4);
  const names = g.edges.flatMap((e) => e.against.map((a) => a.name)).sort();
  assert(JSON.stringify(names) === JSON.stringify(["Bump-out left side", "Covered-deck back wall", "Covered-deck side", "Rear wall"]), names.join(", "));
  near(rear.ledgerFeet, 6 + rearFeet + coveredFeet + backFeet, "its ledger: 6'0\" of the bump-out's side and the rest", 1e-4);
  // Glass: its rim less the stair, and its west edge from the rim to the roof's post; the screen from the post to the wall.
  const glass = rear.railingByKind.find((r) => r.kind === "glass");
  near(glass.feet, rearFeet + backFeet - (14.31 - 10.98) + 4.9, "glass railing", 1e-6);
  near(rear.screens[0].lengthFeet, 6 + coveredFeet - 4.9, "privacy screen", 1e-6);
  // Under the roof: the covered corner and the eave's overhang over the strip.
  assert(rear.coveredSquareFeet > backFeet * coveredFeet && rear.coveredSquareFeet < backFeet * coveredFeet + (rearFeet + backFeet) * 2.5, `covered ${rear.coveredSquareFeet}`);
  const stair = rear.stairs[0];
  assert(stair.stair.risers === 8, "8 risers");
  near(stair.totalRiseFeet, 4.8, "its rise, over the lawn", 1e-6);
});

await test("the porch: the whole front wall behind it (his 263\" tape), 4'9\" out, under its roof whole", () => {
  const q = x.decksQuantities(decked, x.exteriorQuantities(decked).roof);
  const porch = q.find((d) => d.name === "Front porch");
  near(porch.geometry.edges[0].lengthFeet, 263 / 12, "along the house", 0.01);
  near(porch.areaSquareFeet, (263 / 12) * 4.75, "area", 0.1);
  near(porch.coveredSquareFeet, porch.areaSquareFeet, "the porch roof covers it", 0.5);
  assert(porch.stairs[0].stair.risers === 5, "5 risers");
  assert(porch.screens.length === 3, "skirting round it");
  // Its three runs of skirting one line; the rear deck's posts from the lawn at its edge to the low ground under the roof.
  const skirt = x.deckLines(porch).filter((l) => l.includes("skirting"));
  assert(skirt.length === 1 && /skirting – wood – 66\.5 SF \(22'2" × 3'\)$/.test(skirt[0]), `one skirting line: ${skirt}`);
  const rear = q.find((d) => d.name === "Rear deck");
  assert(x.deckLines(rear).some((l) => l.endsWith(`(6×6 aluminum-wrapped, 4'10" to 7')`)), x.deckLines(rear).filter((l) => l.includes("posts")).join(" / "));
  assert(x.riseWords(rear.stairs[0].riseFeet) === `7¼"`, x.riseWords(rear.stairs[0].riseFeet));
});

await test("his decks' lines", () => {
  const lines = x.siteScopeLines(decked, []).siding;
  const expect = [
    "Rear deck – composite decking – 262.4 SF (",
    "Rear deck – glass railing",
    "Rear deck – aluminum picket railing",
    "Rear deck – stairs – 8 risers, 3'4\" wide",
    "Rear deck – posts – 3 (6×6 aluminum-wrapped",
    "Rear deck – privacy screen – wood – ",
    "Rear deck – ledger – ",
    "Front porch – wood decking – 104.1 SF (all of it under the house's roof)",
    "Front porch – aluminum picket railing – ",
    "Front porch – stairs – 5 risers, 4'6\" wide",
    "Front porch – skirting – wood – ",
  ];
  for (const e of expect) assert(lines.some((l) => l.startsWith(e)), `${e} in:\n${lines.join("\n")}`);
  assert(!lines.some((l) => l.startsWith("Front porch – posts")), "the porch's posts are behind its skirting: none counted");
});

await test("what the photos couldn't see is on Check these and the report's To check", () => {
  const q = x.exteriorQuantities(decked);
  const rows = x.exteriorChecks(decked, q).filter((r) => r.kind === "deck");
  const keys = rows.map((r) => `${r.deckId}:${r.item}`);
  for (const k of ["deck-rear:framing", "deck-rear:posts", "deck-porch:framing", "deck-porch:posts", "deck-porch:decking", "deck-porch:stair:stair-porch"]) assert(keys.includes(k), `${k} in ${keys}`);
  const report = x.exteriorReport(decked, META);
  assert(report.notes.some((n) => n.startsWith("Rear deck: its framing: The joists, beams and footings can't be seen")), report.notes.join("\n"));
});

await test("the rear deck's depth is his word, not asked; the porch's is: typed, its outer edge moves to it and it isn't asked", () => {
  const q = x.exteriorQuantities(decked);
  const asks = x.exteriorChecks(decked, q).filter((r) => r.kind === "deck" && r.item === "depth");
  assert(asks.length === 1 && asks[0].deckId === "deck-porch", JSON.stringify(asks));
  assert(asks[0].title === "Front porch: 4'9\" out from the Front wall behind the porch" && /tape it from the Front wall behind the porch to the outer face of its rim/.test(asks[0].words), JSON.stringify(asks[0]));
  const taped = x.withDeckDepth(decked, "deck-porch", 5);
  const porch = x.decksQuantities(taped, x.exteriorQuantities(taped).roof).find((d) => d.name === "Front porch");
  near(Math.max(...porch.deck.outline.map((p) => p.y)), 5, "its outer edge at the tape", 1e-9);
  near(porch.areaSquareFeet, (263 / 12) * 5, "its area with it", 0.1);
  assert(!x.deckChecks(taped).some((r) => r.item === "depth"), "no longer asked");
  assert(x.deckChecks(taped).some((r) => r.deckId === "deck-porch" && r.item === "framing"), "the rest still asked");
});

await test("the report: a Decks fact, a section with each deck's plan and facts and its own tables; without decks, as it always was", () => {
  const plain = x.exteriorReport(house, META);
  assert(!("decks" in plain), "no decks key without decks");
  const r = x.exteriorReport(decked, META);
  const fact = r.facts.find((f) => f.label === "Decks");
  assert(fact && /^Rear deck 262 SF, 7'6" up at the wall, 4'10" at its outer edge, \d+ SF of it under the roof · Front porch 104 SF, 3'9" up, under the roof$/.test(fact.value), fact?.value);
  assert(r.decks.list.length === 2 && r.decks.tables.map((t) => t.caption).join("|") === "Decks|Deck railings|Deck stairs|Under the decks|Deck lines", r.decks.tables.map((t) => t.caption).join("|"));
  const rearSide = r.sides.find((s) => s.side.name === "Rear wall");
  assert(rearSide.dims.some((d) => d.startsWith("Rear deck against it: 14'6\" of ledger")), rearSide.dims.join("\n"));
  // The walls' own words are unchanged but for that line.
  const before = plain.sides.find((s) => s.side.name === "Rear wall");
  assert(JSON.stringify(rearSide.dims.filter((d) => !d.includes("deck"))) === JSON.stringify(before.dims), "the rear wall's own words");
});

await test("in 3D and in the drawings: its pieces, the four views, the rear wall's own drawing and each deck's plan", () => {
  const m = x.exteriorModel(decked);
  assert(m.ok && m.model.decks.length > 50, `pieces ${m.model.decks?.length}`);
  const plain = x.exteriorModel(house);
  assert(!("decks" in plain.model), "none without");
  const kinds = new Set(m.model.decks.map((p) => p.kind));
  for (const k of ["top", "rim", "post", "glass", "pickets", "rail", "railPost", "tread", "riser", "stringer", "screen", "skirting"]) assert(kinds.has(k), `${k} in ${[...kinds]}`);
  // From the back the rear deck's glass and pickets and risers show; from the front the porch's pickets.
  const back = x.houseView(m.model, "back", 16);
  assert(back.pieces.some((p) => p.type === "deck" && p.kind === "glass") && back.pieces.some((p) => p.type === "deck" && p.kind === "riser"), "back view");
  const front = x.houseView(m.model, "front", 16);
  assert(front.pieces.some((p) => p.type === "deck" && p.kind === "pickets"), "front view");
  const rear = sideOf(decked, "Rear wall");
  const onRear = x.decksOnSide(m.model, rear.id);
  assert(onRear.some((p) => p.kind === "glass") && onRear.some((p) => p.kind === "riser"), "the rear wall's drawing");
  const svg = svgOf(x.createElement(x.ElevationDrawing, { side: rear, rise: x.exteriorQuantities(decked).rises[rear.id] ?? null, decks: onRear }));
  assert(svg.includes("<svg") && svg.length > 2000, "drawn");
  const r = x.exteriorReport(decked, META);
  for (const d of r.decks.list) assert(svgOf(x.createElement(x.DeckPlanDrawing, { footprint: r.q.footprint, shape: d.shape })).includes("ledger"), `${d.q.name}'s plan`);
});

await test("his house's report with its decks and the shed: a PDF, the Decks pages in it", async () => {
  const shed = fixture("shed-1017.json");
  const site = x.siteReport(decked, [shed], { title: "The owner's house and shed, with its decks", date: "Oct 20, 2026", madeWith: "Scrivn" });
  const bytes = x.exteriorReportBytes({ report: site.house, buildings: site.buildings.map((b) => ({ name: b.name, report: b.report })), totals: site.totals, svgOf, footer: "Scrivn" });
  const text = Buffer.from(bytes).toString("latin1");
  assert(bytes.length > 100000 && text.includes("Decks") && text.includes("Deck railings"), `${bytes.length} bytes`);
  const out = process.env.SCRIVN_REPORT_OUT;
  if (out) {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "Exterior report - house with decks.pdf"), bytes);
    const m = x.exteriorModel(decked).model;
    for (const v of site.house.views) writeFileSync(join(out, `view-${v.view.from}.svg`), svgOf(x.createElement(x.HouseElevationDrawing, { view: v.view, roof: decked.roof.material ?? null })));
    for (const name of ["Rear wall", "Front wall behind the porch"]) {
      const s = sideOf(decked, name);
      const rs = site.house.sides.find((q) => q.side.id === s.id);
      writeFileSync(join(out, `side-${name.replace(/\W+/g, "-")}.svg`), svgOf(x.createElement(x.ElevationDrawing, { side: s, rise: rs.rise, base: rs.base, decks: x.decksOnSide(m, s.id) })));
    }
    for (const d of site.house.decks.list) writeFileSync(join(out, `plan-${d.q.name.replace(/\W+/g, "-")}.svg`), svgOf(x.createElement(x.DeckPlanDrawing, { footprint: site.house.q.footprint, shape: d.shape })));
    writeFileSync(join(out, "footprint.svg"), svgOf(x.createElement(x.FootprintDrawing, { footprint: site.house.q.footprint, nameOf: (id) => decked.sides.find((s) => s.id === id)?.name ?? "Side", decks: site.house.decks.list.map((d) => d.shape) })));
    console.log(`      kept in ${out}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
