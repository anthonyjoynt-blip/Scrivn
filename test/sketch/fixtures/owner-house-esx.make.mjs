// Builds test/sketch/fixtures/owner-house-esx.json: the owner's kitchen + living and basement with the ESX items.
// Sizes from the 10-21 interior AI-pass test of his house (interior-ai-pass-test/README.md), rounded to what an
// estimator would type.   node test/sketch/fixtures/owner-house-esx.make.mjs   then UPDATE_GOLDEN=1 node test/sketch/esxItems.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FT = 12;
const ft = (feet, inches = 0) => feet + inches / 12;

/** A room from its corners in feet, clockwise; wall ids `${id}-w<i>` start at corner i. */
function room(id, name, level, corners, extra = {}) {
  return {
    id,
    name,
    level,
    vertices: corners.map(([x, y], i) => ({ id: `${id}-w${i}`, x: Math.round(x * FT * 100) / 100, y: Math.round(y * FT * 100) / 100 })),
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
const box = (id, name, level, x, y, w, d, extra) => room(id, name, level, [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], extra);

const DOOR_HEAD = ft(6, 8);
const door = (id, wallId, t, widthFeet, extra = {}) => ({ id, type: "door", wallId, t, widthFraction: 0.1, widthFeet, doorType: "swing", leaves: "single", heightFeet: DOOR_HEAD, flipX: false, flipY: false, ...extra });
const win = (id, wallId, t, widthFeet, heightFeet, sillFeet, extra = {}) => ({ id, type: "window", wallId, t, widthFraction: 0.1, widthFeet, heightFeet, sillFeet, ...extra });
const cab = (id, wallId, t, widthFeet, tier, depthFeet, heightFeet, extra = {}) => ({ id, type: "cabinet", wallId, t, widthFraction: 0.1, widthFeet, label: "", tier, depthFeet, heightFeet, ...extra });
const fix = (id, wallId, t, fixtureType, widthFeet, depthFeet, heightFeet, extra = {}) => ({ id, type: "fixture", wallId, t, widthFraction: 0.1, widthFeet, fixtureType, label: "", depthFeet, heightFeet, showerShape: "rectangular", ...extra });
const blk = (id, x, y, w, d, extra = {}) => ({ id, x: x * FT, y: y * FT, widthPx: w * FT, depthPx: d * FT, widthFeet: w, depthFeet: d, label: "", tier: "base", ...extra });

/* ── Main floor ─────────────────────────────────────────────────────────────────────────────────── */

// Kitchen 14' x 12': W1 the hutch wall (base run, hutch on the counter, triple casement over the sink),
// W2 the tall wall (oven tower, fridge bay, pantry to the ceiling, range under a wood hood box), W3 the deck door,
// W4 open to the living room.
const kitchen = box("kit", "Kitchen", 0, 0, 0, 14, 12, {
  missingWalls: ["kit-w3"],
  ceilingFinish: "drywall",
  symbols: [
    cab("kit-run", "kit-w0", 0.4, 11, "base", 2, 3, { countertop: { material: "granite", backsplashFeet: ft(0, 4) } }),
    cab("kit-hutch", "kit-w0", 0.16, ft(2, 3), "wall", ft(1, 2), ft(2, 3), { label: "Hutch", bottomFeet: 3, doors: "glass" }),
    win("kit-sink-win", "kit-w0", 0.55, 5, ft(3, 6), ft(3, 6), { windowType: "casement", units: 3, grids: false }),
    cab("kit-oven", "kit-w1", 0.13, ft(2, 6), "full", 2, 8, { bay: "wall-oven" }),
    cab("kit-fridge", "kit-w1", 0.36, 3, "full", 2, 8, { bay: "fridge", bayHeightFeet: 6 }),
    cab("kit-pantry", "kit-w1", 0.565, 2, "full", 2, 8, { label: "Pantry" }),
    fix("kit-range", "kit-w1", 0.79, "range", ft(2, 6), ft(2, 6), 3),
    fix("kit-hood", "kit-w1", 0.79, "hood", ft(2, 6), ft(1, 8), ft(2, 6), { hoodType: "custom", bottomFeet: ft(5, 6) }),
    door("kit-deck", "kit-w2", 0.5, 3, { exterior: true, doorStyle: "full-lite", lites: 15 }),
  ],
  // The island: the box the owner tapped, the top 9" past it on the stool side, a waterfall down one end.
  freeCabinets: [blk("kit-island", 4, 5, 6, 3, { label: "Island", heightFeet: 3, countertop: { material: "quartz", overhangFeet: 0.75, waterfallEnds: 1 } })],
});

// Living 16' x 18' left of the kitchen, a partition apart: vaulted 7'7" to 11'7"; W1 (the kitchen side) open;
// the top wall with the two arched pass-throughs, crown and a plant ledge at the vault's spring;
// the bottom wall broken 4' from the kitchen: 4' full height, then 12' of stair rail half wall, wood capped;
// a corner fireplace faced in stone to the ceiling; a picture window on the far wall.
const L = -(16 + 4 / 12);
const living = room("liv", "Living", 0, [[L, 0], [-4 / 12, 0], [-4 / 12, 18], [-4 / 12 - 4, 18], [L, 18]], {
  ceilingHeightFeet: ft(7, 7),
  ceilingType: "vaulted",
  ceilingPeakFeet: ft(11, 7),
  missingWalls: ["liv-w1"],
  wallDetails: {
    "liv-w0": { crown: true, plantLedgeFeet: ft(7, 7) },
    "liv-w3": { heightFeet: ft(3, 2), cap: "wood" },
  },
  symbols: [
    door("liv-arch1", "liv-w0", 0.4, 2, { doorType: "opening", heightFeet: ft(6, 7), sillFeet: ft(3, 2), topShape: "round" }),
    door("liv-arch2", "liv-w0", 0.6, 2, { doorType: "opening", heightFeet: ft(6, 7), sillFeet: ft(3, 2), topShape: "round" }),
    win("liv-picture", "liv-w4", 0.5, 5, 5, 2, { windowType: "picture", grids: false }),
  ],
  freeCabinets: [
    blk("liv-fireplace", 0, 0, ft(3, 9), ft(3, 9), { kind: "fireplace", shape: "triangle", heightFeet: ft(7, 7), fireplace: { finish: "stone", fuel: "gas" } }),
  ],
});

/* ── Basement ───────────────────────────────────────────────────────────────────────────────────── */

const B = 40; // the basement is drawn below the main floor's plan
const rec = box("rec", "Rec room", -1, 0, B, 20, 14, {
  ceilingHeightFeet: ft(8, 4),
  ceilingFinish: "textured",
  symbols: [
    win("rec-win", "rec-w0", 0.3, 4, 2, ft(4, 6), { windowType: "slider" }),
    cab("rec-bar", "rec-w1", 0.5, 8, "base", 2, 3, { label: "Bar", countertop: { backsplashFeet: ft(0, 4) } }),
    cab("rec-shelves", "rec-w1", 0.5, 6, "wall", ft(0, 10), 1, { label: "Bar shelves", bottomFeet: ft(4, 6), doors: "open" }),
    door("rec-door", "rec-w2", 0.85, ft(2, 8), { doorStyle: "panel", exterior: false }),
  ],
  // The beam across the room: 13" wide, 11" down, wall to wall.
  freeCabinets: [blk("rec-beam", 0, 7, 20, ft(1, 1), { kind: "beam", beam: { type: "beam", dropFeet: ft(0, 11) } })],
});

const bedroom = box("bed2", "Bedroom 2", -1, 21, B, 11, 10, {
  ceilingHeightFeet: ft(7, 2),
  wallDetails: { "bed2-w1": { ledge: { heightFeet: ft(3, 5), depthFeet: ft(0, 4) } } },
  symbols: [win("bed2-win", "bed2-w1", 0.5, 4, 2, ft(4, 6), { windowType: "slider" }), door("bed2-door", "bed2-w2", 0.3, ft(2, 8), { doorStyle: "panel", exterior: false })],
});

const bath = box("bath", "Bathroom", -1, 33, B, 5, 8, {
  ceilingHeightFeet: ft(7, 6),
  symbols: [
    fix("bath-tub", "bath-w0", 0.5, "tubShower", 5, ft(2, 8), ft(6, 4), { surround: "one-piece" }),
    cab("bath-vanity", "bath-w1", 0.5, ft(3, 2), "base", ft(1, 9), ft(2, 10), { label: "Vanity", countertop: { material: "granite", backsplashFeet: ft(0, 4) } }),
    fix("bath-toilet", "bath-w3", 0.6, "toilet", ft(1, 8), ft(2, 6), ft(2, 6)),
    door("bath-door", "bath-w2", 0.5, ft(2, 6), { doorStyle: "panel", exterior: false }),
  ],
});

const storage = box("store", "Storage", -1, 39, B, 8, 10, {
  ceilingHeightFeet: ft(7, 3),
  ceilingFinish: "suspended",
  symbols: [door("store-door", "store-w2", 0.5, ft(2, 6), { doorStyle: "slab" })],
});

const utility = box("util", "Utility", -1, 48, B, 10, 10, {
  unfinished: true,
  ceilingFinish: "open-joists",
  symbols: [
    fix("util-furnace", "util-w0", 0.25, "furnace", 2, ft(2, 6), ft(4, 6)),
    fix("util-furnace2", "util-w0", 0.55, "furnace", 2, ft(2, 6), ft(4, 6)),
    fix("util-heater", "util-w1", 0.3, "waterHeater", 2, 2, 5),
    door("util-door", "util-w2", 0.5, ft(2, 8)),
  ],
});

const office = box("office", "Office", -1, 59, B, 12, 11, {
  ceilingHeightFeet: ft(8, 2),
  wallDetails: { "office-w2": { wainscot: { heightFeet: 3, type: "panel" } } },
  symbols: [
    cab("office-tower1", "office-w0", 0.15, 3, "full", ft(1, 4), 7, { label: "Bookcase", doors: "open" }),
    cab("office-tower2", "office-w0", 0.85, 3, "full", ft(1, 4), 7, { label: "Bookcase", doors: "open" }),
    win("office-win", "office-w0", 0.5, 4, 2, ft(4, 6), { windowType: "slider" }),
    cab("office-bridge", "office-w0", 0.5, 6, "wall", ft(1, 4), 1, { label: "Bridge shelf", bottomFeet: ft(6, 8), doors: "open" }),
    door("office-door", "office-w2", 0.2, ft(2, 8), { doorStyle: "panel", exterior: false }),
  ],
});

const sketch = { rooms: [kitchen, living, rec, bedroom, bath, storage, utility, office], levels: [-1], levelNames: { "-1": "Basement" } };
const out = join(repo, "test", "sketch", "fixtures", "owner-house-esx.json");
writeFileSync(out, JSON.stringify(sketch, null, 2) + "\n");
console.log(`wrote ${out}`);
