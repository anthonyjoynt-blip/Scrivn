"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { type Sketch, type SketchRoom, blockCorners, blockWallContacts, roomCentroid, roomFrameDeg, withDerivedParents } from "@/lib/sketch";
import { type MoistureMap, cellKey, emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * The turn buttons, through the editor (2026-09-30).
 *
 * "give me a rotate button in scrivn on the sketch pad. similar to door flip so when i select a room
 * or block i can rotate it. in 15 degree increments or something". The geometry is pinned in
 * turn.mjs; this drives what the PM touches — the ↺ ↻ buttons that float over the canvas beside the
 * door's flips, and R / Shift+R — and checks each lands on the thing selected: the room with its
 * closet and island, the island alone, a flight by quarters. And that the paint on a turned floor is
 * carried by the editor, which is where the sketch and the moisture map meet.
 */

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const FT = 12;

function rect(id: string, name: string, x: number, y: number, wFt: number, hFt: number, extra: Partial<SketchRoom> = {}): SketchRoom {
  return {
    id,
    name,
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    vertices: [
      { id: `${id}-a`, x, y },
      { id: `${id}-b`, x: x + wFt * FT, y },
      { id: `${id}-c`, x: x + wFt * FT, y: y + hFt * FT },
      { id: `${id}-d`, x, y: y + hFt * FT },
    ],
    ...extra,
  };
}

/**
 * A 16' x 12' bedroom with a door, a 6' x 3' island, a 4' x 2' peninsula flush on its bottom wall and
 * a closet in its corner; a flight below it.
 */
function seed(): Sketch {
  const bed = rect("bed", "Bedroom", 60, 60, 16, 12, {
    symbols: [
      { id: "door", type: "door", wallId: "bed-a", t: 0.7, widthFraction: 0.2, widthFeet: 3, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: true, flipY: false },
    ],
    freeCabinets: [
      { id: "isl", x: 7 * FT, y: 5 * FT, widthPx: 6 * FT, depthPx: 3 * FT, widthFeet: 6, depthFeet: 3, label: "Island", tier: "base" },
      { id: "pen", x: 10 * FT, y: 10 * FT, widthPx: 4 * FT, depthPx: 2 * FT, widthFeet: 4, depthFeet: 2, label: "Peninsula", tier: "base" },
    ],
  });
  const closet = rect("closet", "Closet", 60, 60, 4, 3);
  const stairs = rect("stairs", "Stairs", 60, 300, 11, 3, { stairs: { orientation: 0, direction: "up", treadDepthFeet: 10.5 / 12, riseFeet: null } });
  return { rooms: withDerivedParents([bed, closet, stairs]) };
}

/** A painted patch in the bedroom's far corner, so the carry of the paint can be seen. */
function seedMoisture(): MoistureMap {
  const cells: string[] = [];
  for (let col = 44; col < 56; col++) for (let row = 30; row < 38; row++) cells.push(cellKey(col, row));
  return { ...emptyMoistureMap(), rooms: { bed: { wallReadings: [], floorCells: cells, ceilingCells: [], insetsOver18Inches: 0 } } };
}

let latestSketch: Sketch = seed();
let latestMoisture: MoistureMap = seedMoisture();

function Host() {
  const [sketch, setSketch] = useState<Sketch>(seed);
  const [moisture, setMoisture] = useState<MoistureMap>(seedMoisture);
  latestSketch = sketch;
  latestMoisture = moisture;
  return createElement(SketchEditor, {
    sketch,
    knownRoomNames: [],
    moisture,
    onChange: setSketch,
    onMoistureChange: setMoisture,
    onClose: () => {},
  });
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  results.length = 0;
  const host = document.createElement("div");
  host.id = "turn-buttons-host";
  document.body.appendChild(host);

  const button = (label: string): HTMLButtonElement | null =>
    ([...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined) ?? null;
  const bar = (): string | null => host.querySelector(".sketch-direction")?.getAttribute("aria-label") ?? null;
  const roomOf = (id: string) => latestSketch.rooms.find((r) => r.id === id);
  const press = (key: string, shift = false) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true }));
  const sameCorners = (a: SketchRoom | undefined, b: SketchRoom | undefined) =>
    !!a && !!b && a.vertices.every((v, i) => Math.abs(v.x - (b.vertices[i]?.x ?? NaN)) < 1e-6 && Math.abs(v.y - (b.vertices[i]?.y ?? NaN)) < 1e-6);

  try {
    createRoot(host).render(createElement(Host));
    await settle(600);
    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);
    const original = seed();

    // ── nothing selected: nothing to turn ────────────────────────────────────────────────────
    check(button("↻ 15°") === null && bar() === null, "with nothing selected there are no turn buttons");

    // ── the room ─────────────────────────────────────────────────────────────────────────────
    g.tap({ x: 100, y: 170 }); // bedroom floor, clear of the island and the closet
    await settle();
    check(bar() === "Room", `selecting the room brings up its turn buttons (bar: ${bar()})`);
    const clockwise = button("↻ 15°");
    const anticlockwise = button("↺ 15°");
    check(clockwise !== null && anticlockwise !== null, "↺ 15° and ↻ 15°, like the door's flips");

    const centreBefore = roomCentroid(roomOf("bed") as SketchRoom);
    const paintBefore = latestMoisture.rooms.bed?.floorCells ?? [];
    clockwise?.click();
    await settle();
    const bed = roomOf("bed");
    check(bed !== undefined && Math.abs(roomFrameDeg(bed) - 15) < 1e-6, `↻ turns the room 15° clockwise (frame ${bed ? roomFrameDeg(bed).toFixed(3) : "?"})`);
    const centreAfter = bed ? roomCentroid(bed) : { x: NaN, y: NaN };
    check(Math.hypot(centreAfter.x - centreBefore.x, centreAfter.y - centreBefore.y) < 1e-6, "about the middle of its floor, which stays put");
    const closet = roomOf("closet");
    check(closet !== undefined && Math.abs(roomFrameDeg(closet) - 15) < 1e-6 && closet.parentRoomId === "bed", "its closet turned with it and is still its closet");
    check(bed?.freeCabinets[0]?.angleDeg === 15, `its island turned with it (${bed?.freeCabinets[0]?.angleDeg})`);
    check(bed?.symbols[0]?.wallId === "bed-a" && bed?.symbols[0]?.t === 0.7, "its door is still on the same wall, at the same place");
    check(sameCorners(roomOf("stairs"), original.rooms[2]), "the flight, which is not in it, did not move");
    const paintAfter = latestMoisture.rooms.bed?.floorCells ?? [];
    check(
      paintAfter.length > paintBefore.length * 0.85 && paintAfter.length < paintBefore.length * 1.15 && paintAfter.join() !== paintBefore.join(),
      `the paint on its floor went round with it (${paintBefore.length} cells -> ${paintAfter.length})`,
    );

    anticlockwise?.click();
    await settle();
    check(sameCorners(roomOf("bed"), original.rooms[0]) && sameCorners(roomOf("closet"), original.rooms[1]), "↺ turns it back to exactly where it was, closet and all");
    check(roomOf("bed")?.freeCabinets[0]?.angleDeg === 0, "and the island square again");

    press("r");
    await settle();
    check(Math.abs(roomFrameDeg(roomOf("bed") as SketchRoom) - 15) < 1e-6, "R turns it clockwise too");
    press("R", true);
    await settle();
    check(sameCorners(roomOf("bed"), original.rooms[0]), "and Shift+R back");

    // Two presses before the first is drawn — a held key — are two turns, not one.
    press("r");
    press("r");
    await settle();
    check(Math.abs(roomFrameDeg(roomOf("bed") as SketchRoom) - 30) < 1e-6, `two presses in one frame turn it twice (frame ${roomFrameDeg(roomOf("bed") as SketchRoom).toFixed(3)})`);
    press("R", true);
    press("R", true);
    await settle();
    check(sameCorners(roomOf("bed"), original.rooms[0]) && sameCorners(roomOf("closet"), original.rooms[1]), "and two back bring it, and its closet, back exactly");

    // ── the island on its own ────────────────────────────────────────────────────────────────
    g.tap({ x: 60 + 10 * FT, y: 60 + 6.5 * FT }); // the island's middle
    await settle();
    check(bar() === "Block", `selecting the island brings up the block's turn buttons (bar: ${bar()})`);
    const before = roomOf("bed")?.freeCabinets[0];
    button("↻ 15°")?.click();
    await settle();
    const after = roomOf("bed")?.freeCabinets[0];
    check(after?.angleDeg === 15, `↻ turns the island 15° (${after?.angleDeg})`);
    check(sameCorners(roomOf("bed"), original.rooms[0]), "and only the island: the room stays where it is");
    const room = roomOf("bed");
    if (before && after && room) {
      const mid = (pts: { x: number; y: number }[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
      const m0 = mid(blockCorners(before, room));
      const m1 = mid(blockCorners(after, room));
      check(Math.hypot(m1.x - m0.x, m1.y - m0.y) < 1e-6, "about its own middle");
    }
    press("R", true);
    await settle();
    check(roomOf("bed")?.freeCabinets[0]?.angleDeg === 0, "Shift+R turns it back");
    press("r");
    press("r");
    await settle();
    check(roomOf("bed")?.freeCabinets[0]?.angleDeg === 30, `two presses in one frame turn it twice (${roomOf("bed")?.freeCabinets[0]?.angleDeg})`);
    press("R", true);
    press("R", true);
    await settle();
    check(roomOf("bed")?.freeCabinets[0]?.angleDeg === 0, "and two back square it again");

    // ── a peninsula against a wall: the other button takes a press back ─────────────────────────
    // The review of 2026-09-30: R then Shift+R left a peninsula 9" off the wall it had been flush on.
    g.tap({ x: 60 + 12 * FT, y: 60 + 11 * FT }); // the peninsula's middle
    await settle();
    check(bar() === "Block", `selecting the peninsula brings up the block's turn buttons (bar: ${bar()})`);
    const penOf = () => roomOf("bed")?.freeCabinets.find((c) => c.id === "pen");
    // As it stands now, after the room's own turns above have carried it round and back.
    const seededPen = penOf();
    const flushOnBottom = () => {
      const pen = penOf();
      const bedNow = roomOf("bed");
      return !!pen && !!bedNow && JSON.stringify(blockWallContacts(pen, bedNow)) === JSON.stringify([{ wallId: "bed-c", feet: 4 }]);
    };
    check(flushOnBottom(), "the peninsula starts flush on the bottom wall");
    press("r");
    await settle();
    check(penOf()?.angleDeg === 15, `R turns it 15 (${penOf()?.angleDeg})`);
    press("R", true);
    await settle();
    check(penOf()?.x === seededPen?.x && penOf()?.y === seededPen?.y && flushOnBottom(), `Shift+R puts it back flush, where it stood (${penOf()?.x}, ${penOf()?.y})`);
    press("r");
    press("r");
    press("r");
    await settle();
    check(penOf()?.angleDeg === 45, `three presses turn it 45 (${penOf()?.angleDeg})`);
    press("R", true);
    press("R", true);
    press("R", true);
    await settle();
    check(penOf()?.x === seededPen?.x && penOf()?.y === seededPen?.y && flushOnBottom(), `and three back, flush again (${penOf()?.x}, ${penOf()?.y})`);

    // ── a flight: by quarters ────────────────────────────────────────────────────────────────
    g.tap({ x: 60 + 5.5 * FT, y: 300 + 1.5 * FT });
    await settle();
    check(bar() === "Stairs", `selecting the flight brings up its buttons (bar: ${bar()})`);
    check(button("↻ 15°") === null && button("↻ 90°") !== null && button("↺ 90°") !== null, "a flight turns by quarters, and says so");
    check(button("↑ Up") !== null, "and keeps its climb button");
    button("↻ 90°")?.click();
    await settle();
    check(roomOf("stairs")?.stairs?.orientation === 90, `↻ 90° turns it a quarter clockwise (${roomOf("stairs")?.stairs?.orientation})`);
    button("↺ 90°")?.click();
    await settle();
    check(roomOf("stairs")?.stairs?.orientation === 0 && sameCorners(roomOf("stairs"), original.rooms[2]), "↺ 90° turns it back exactly");
  } catch (err) {
    check(false, `turn buttons suite threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    host.remove();
  }

  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
