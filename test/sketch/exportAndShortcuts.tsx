"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { gesturesFor } from "./gestures";
import {
  CABINET_DEFAULT_HEIGHT_FEET,
  CABINET_TIER_LABEL,
  MIN_WALL_PX,
  cappedInset,
  PIXELS_PER_FOOT,
  WALL_THICKNESS_FEET,
  type Sketch,
  type SketchRoom,
  exposedRunAt,
  exposedWallRuns,
  newSymbol,
  roomBounds,
  sketchSummaryText,
  standsOnFloor,
  symbolWidthFeet,
  wallById,
  wallsOf,
  withDerivedParents,
  MAIN_LEVEL,
  defaultUnderlayLevel,
  levelLabel,
  levelsOf,
  roomsOnLevel,
  withWallLength,
} from "@/lib/sketch";
import SketchCanvas from "@/components/sketch/SketchCanvas";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { DEFAULT_QUANTITY_OPTIONS, roomQuantities } from "@/lib/sketchQuantities";
import { renderSketchImage, renderSketchJpeg } from "@/components/sketch/renderSketchImage";
import { surfaceRenderId } from "@/lib/surfaceThumbnails";

/**
 * Typed wall lengths, the keyboard shortcuts, the delete/undo pair, and the exported image.
 *
 * Every check here stands for something that is invisible until it is wrong. A room that answers
 * "20 feet" while being drawn the same size as its 12' neighbour looks perfectly fine on screen and
 * reads correctly in every readout — the lie only shows up in the comparison. A JPEG with an
 * un-composited alpha channel is a black page, but only in the file, never on the screen it was
 * rendered from. And an arrow key that has stopped reaching the flight it used to turn produces no
 * error at all; it just quietly does nothing.
 */

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const ppf = PIXELS_PER_FOOT;

/** Where a top-level room's mark is drawn, in world px at zoom 1 — `WALL_FACE_INSET` in the canvas. */
const WALL_MARK_INSET_PX = 6;

function rect(id: string, name: string, x: number, y: number, wFt: number, hFt: number): SketchRoom {
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
      { id: `${id}-b`, x: x + wFt * ppf, y },
      { id: `${id}-c`, x: x + wFt * ppf, y: y + hFt * ppf },
      { id: `${id}-d`, x, y: y + hFt * ppf },
    ],
  };
}

function seed(): Sketch {
  const room = rect("room-1", "Living Room", 60, 60, 16, 12);
  const stairs: SketchRoom = {
    ...rect("room-2", "Stairs", 60, 260, 11, 3),
    stairs: { orientation: 0, direction: "down", treadDepthFeet: 10.5 / 12, riseFeet: null },
  };
  return { rooms: [room, stairs] };
}

let latestSketch: Sketch = seed();
let latestMoisture: MoistureMap = emptyMoistureMap();

function Host() {
  const [sketch, setSketch] = useState<Sketch>(seed);
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
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

/** A big room with a closet flush into its top-left corner — the shape that hid a mark's handle. */
function NestedHost() {
  const [sketch, setSketch] = useState<Sketch>(() => ({
    rooms: withDerivedParents([rect("big", "Big", 60, 60, 20, 21), rect("closet", "Closet", 60, 60, 7, 5)]),
  }));
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
  return createElement(SketchEditor, {
    sketch,
    knownRoomNames: [],
    moisture,
    onChange: setSketch,
    onMoistureChange: setMoisture,
    onClose: () => {},
  });
}

/** A window on a wall at a stated size — `newSymbol` returns the union, not a window. */
function windowOn(room: SketchRoom, wallId: string, widthFeet: number, heightFeet: number | null) {
  const created = newSymbol("window", wallId, 0.5, room);
  if (created.type !== "window") throw new Error("newSymbol did not make a window");
  return { ...created, widthFeet, heightFeet };
}

/** A door or cased opening on a wall, at a stated size — `newSymbol` returns the union, not a door. */
function doorOn(room: SketchRoom, wallId: string, widthFeet: number, heightFeet: number, doorType: "swing" | "opening") {
  const created = newSymbol("door", wallId, 0.5, room);
  if (created.type !== "door") throw new Error("newSymbol did not make a door");
  return { ...created, doorType, widthFeet, heightFeet };
}

function findButton(label: string): HTMLButtonElement | null {
  return ([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined) ?? null;
}

/** A keydown on `window`, which is where the editor listens. */
function press(key: string, modifiers: { ctrl?: boolean } = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: modifiers.ctrl ?? false, bubbles: true, cancelable: true }));
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

/** Longest run of dark pixels down one image column — the wall, measured off the exported file. */
function darkRuns(data: Uint8ClampedArray, height: number): number[] {
  const runs: number[] = [];
  let start: number | null = null;
  for (let y = 0; y <= height; y += 1) {
    const on = y < height && data[y * 4]! < 120 && data[y * 4 + 1]! < 120 && data[y * 4 + 2]! < 140;
    if (on && start === null) start = y;
    else if (!on && start !== null) {
      runs.push(y - start);
      start = null;
    }
  }
  return runs;
}

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  results.length = 0;
  const host = document.createElement("div");
  host.id = "shortcut-host";
  document.body.appendChild(host);

  try {
    createRoot(host).render(createElement(Host));
    // The canvas arrives through next/dynamic, so the stage does not exist on the first paint.
    await settle(600);

    // ── full screen ──────────────────────────────────────────────────────────────────────────
    const expand = findButton("Full screen");
    check(expand !== null, "the editor offers a full-screen toggle");
    expand?.click();
    await settle();
    check(document.querySelector(".sketch-card-expanded") !== null, "pressing it expands the card");
    // Esc is the way out precisely because Done is hidden while expanded.
    check(findButton("Done") === null, "Done is out of reach while expanded, so it can't close the tool by accident");
    press("Escape");
    await settle();
    check(document.querySelector(".sketch-card-expanded") === null, "Escape leaves full screen");
    check(findButton("Done") !== null, "and Done comes back");

    // ── stairs, by keyboard ──────────────────────────────────────────────────────────────────
    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);

    const flight = () => latestSketch.rooms.find((r) => r.id === "room-2")?.stairs ?? null;
    check(flight()?.orientation === 0, "the flight starts pointing right");

    // Nothing selected yet: the keys must be inert, or a stray press would turn whatever was last
    // touched.
    press("ArrowRight");
    await settle(120);
    check(flight()?.orientation === 0, "an arrow key with nothing selected turns nothing");

    // Tap inside the flight to select it — the same gesture a finger makes.
    g.tap({ x: 60 + 5.5 * ppf, y: 260 + 1.5 * ppf });
    await settle();

    press("ArrowRight");
    await settle(120);
    check(flight()?.orientation === 90, `→ turns the flight a quarter turn clockwise (got ${flight()?.orientation})`);
    press("ArrowLeft");
    press("ArrowLeft");
    await settle(120);
    check(flight()?.orientation === 270, `← turns it back the other way, past zero without going negative (got ${flight()?.orientation})`);

    check(flight()?.direction === "down", "the flight starts descending");
    press("ArrowUp");
    await settle(120);
    check(flight()?.direction === "up", "↑ points it up");
    press("ArrowDown");
    await settle(120);
    check(flight()?.direction === "down", "↓ points it back down");

    // A field must never lose a keystroke to this: backspacing a typo out of the room-name box used
    // to delete whatever was selected.
    const nameField = document.querySelector<HTMLInputElement>("#sketch-room-name");
    check(nameField !== null, "the room name field is on screen");
    nameField?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle(120);
    check(flight()?.orientation === 270, "an arrow key typed into a field does not reach the flight");

    // ── delete and undo ──────────────────────────────────────────────────────────────────────
    const before = latestSketch.rooms.length;
    press("Delete");
    await settle();
    check(latestSketch.rooms.length === before - 1, `Delete removes the selected room (${before} -> ${latestSketch.rooms.length})`);
    check(latestSketch.rooms.every((r) => r.id !== "room-2"), "and it is the room that was selected");
    check(document.querySelector(".sketch-undo") !== null, "an undo appears, which is what makes Delete safe here");

    press("z", { ctrl: true });
    await settle();
    check(latestSketch.rooms.length === before, "Ctrl+Z brings it back");
    const restored = latestSketch.rooms.findIndex((r) => r.id === "room-2");
    check(restored === 1, `restored to its own position in the list, not the end (index ${restored})`);
    check(latestSketch.rooms[restored]?.stairs?.orientation === 270, "with the turn it had when it was deleted");
    check(document.querySelector(".sketch-undo") === null, "and the undo goes away once it is used");

    /*
      ── typing a wall length ────────────────────────────────────────────────────────────────

      This is the one that matters most, and it is checked against the DRAWING, not just the
      readout. The old behaviour passed every "is the wall 20 feet?" question you could ask a
      single room — it simply redefined what a pixel meant to that room, so the number came back
      right and the picture was a lie. Only comparing rooms to each other, and to the constant,
      catches that. Driven through `withWallLength` directly: it is a pure function and this is a
      question about geometry, not about the prompt that calls it.
    */
    const twelveByTwelve = rect("t", "Bedroom", 0, 0, 12, 12);
    const top = () => wallsOf(twelveByTwelve)[0]!;
    const widened = withWallLength(twelveByTwelve, top().id, 20);
    const widenedTop = wallById(widened, top().id)!;

    check(Math.abs(widenedTop.lengthFeet - 20) < 0.01, `typing 20' makes the wall 20' (got ${widenedTop.lengthFeet.toFixed(2)})`);
    check(
      Math.abs(widenedTop.lengthPx - 20 * PIXELS_PER_FOOT) < 0.5,
      `and 20' WIDE on the drawing — the room resizes rather than the scale moving (${widenedTop.lengthPx}px vs ${20 * PIXELS_PER_FOOT})`,
    );

    /*
      The room's top-left corner never moves, whichever wall was typed on.

      Checked on BOTH axes deliberately. Holding the wall's own start corner passes the first of
      these and fails the second: in a clockwise polygon the left wall runs bottom-to-top, so its
      start is the bottom-left, and the room would grow upwards when its height was set from the
      left and downwards when set from the right.
    */
    const origin = (r: SketchRoom) => {
      const b = roomBounds(r);
      return `${Math.round(b.minX)},${Math.round(b.minY)}`;
    };
    const start = origin(twelveByTwelve);
    check(origin(widened) === start, `setting the width holds the top-left corner (${start} -> ${origin(widened)})`);

    const leftId = wallsOf(twelveByTwelve)[3]!.id;
    const taller = withWallLength(twelveByTwelve, leftId, 20);
    check(Math.abs(wallById(taller, leftId)!.lengthFeet - 20) < 0.01, "setting the left wall sets the room's height");
    check(origin(taller) === start, `and holds the top-left corner too — it grows down, not up (${start} -> ${origin(taller)})`);

    // The other axis is untouched: setting a width must not change the depth.
    const leftBefore = wallsOf(twelveByTwelve)[3]!.lengthFeet;
    const leftAfter = wallsOf(widened)[3]!.lengthFeet;
    check(Math.abs(leftAfter - leftBefore) < 0.01, `the perpendicular walls keep their length (${leftBefore} -> ${leftAfter})`);

    // A rectangle's opposite walls share a length. Entering one afterwards corrects both rather
    // than the two fighting — the old code's stated reason for not resizing at all.
    const bottomId = wallsOf(widened)[2]!.id;
    const corrected = withWallLength(widened, bottomId, 14);
    check(
      Math.abs(wallsOf(corrected)[0]!.lengthFeet - 14) < 0.01 && Math.abs(wallsOf(corrected)[2]!.lengthFeet - 14) < 0.01,
      `setting the opposite wall corrects both, last entry winning (${wallsOf(corrected)[0]!.lengthFeet.toFixed(2)})`,
    );

    /*
      The complaint that prompted all this: a closet drawn inside a room.

      Under the old model the closet took its own scale from its own drawn size, so a 4' closet and
      the 12' room around it had no relationship at all — the drawing showed one thing and the
      numbers said another. A third of the room is a third of the room.
    */
    const closet = withWallLength(rect("c", "Closet", 0, 0, 6, 6), wallsOf(rect("c", "Closet", 0, 0, 6, 6))[0]!.id, 4);
    const room12 = withWallLength(rect("r", "Bedroom", 0, 0, 12, 12), wallsOf(rect("r", "Bedroom", 0, 0, 12, 12))[0]!.id, 12);
    const ratio = wallsOf(closet)[0]!.lengthPx / wallsOf(room12)[0]!.lengthPx;
    check(Math.abs(ratio - 4 / 12) < 0.01, `a 4' closet is drawn one third of a 12' room (ratio ${ratio.toFixed(3)})`);

    // Two rooms told the same length come out the same size, which is the whole property.
    const a = withWallLength(rect("a", "A", 0, 0, 5, 5), wallsOf(rect("a", "A", 0, 0, 5, 5))[0]!.id, 10);
    const b = withWallLength(rect("b", "B", 0, 0, 30, 30), wallsOf(rect("b", "B", 0, 0, 30, 30))[0]!.id, 10);
    check(
      Math.abs(wallsOf(a)[0]!.lengthPx - wallsOf(b)[0]!.lengthPx) < 0.5,
      `two rooms both told 10' are drawn the same width (${wallsOf(a)[0]!.lengthPx} vs ${wallsOf(b)[0]!.lengthPx})`,
    );

    // A length that cannot be drawn is refused outright rather than collapsing the room.
    const tooSmall = withWallLength(twelveByTwelve, top().id, MIN_WALL_PX / PIXELS_PER_FOOT / 2);
    check(tooSmall === twelveByTwelve, "a length below the minimum wall is refused, leaving the room untouched");

    // A door keeps its real width when the wall it is on changes length — `reflowContents`.
    const withDoor: SketchRoom = (() => {
      const base = rect("d", "Hall", 0, 0, 12, 12);
      return { ...base, symbols: [newSymbol("door", wallsOf(base)[0]!.id, 0.5, base)] };
    })();
    const doorBefore = symbolWidthFeet(withDoor.symbols[0]!, withDoor);
    const stretched = withWallLength(withDoor, wallsOf(withDoor)[0]!.id, 22);
    const doorAfter = symbolWidthFeet(stretched.symbols[0]!, stretched);
    check(
      doorBefore != null && doorAfter != null && Math.abs(doorAfter - doorBefore) < 0.01,
      `a door stays ${doorBefore?.toFixed(2)}' wide when its wall is stretched (got ${doorAfter?.toFixed(2)}')`,
    );

    /*
      ── a wall a sub-room shares ────────────────────────────────────────────────────────────

      A closet in a bedroom's top-left corner owns part of two of the bedroom's walls. A reading
      taken from the bedroom used to claim the whole of each — so the closet's share was marked
      without anyone marking it, and the closet's own mark had nowhere left to go.
    */
    const bedroom = rect("b", "Bedroom", 0, 0, 14, 15);
    const nested = { ...rect("n1", "Closet", 0, 0, 6, 4), parentRoomId: "b" };
    const withCloset = [bedroom, nested];
    const bWalls = wallsOf(bedroom);

    const topRuns = exposedWallRuns(bedroom, bWalls[0]!.id, withCloset);
    check(topRuns.length === 1, `the top wall has one exposed stretch left (got ${topRuns.length})`);
    check(
      topRuns[0] != null && Math.abs(topRuns[0][0] - 6 / 14) < 0.01 && topRuns[0][1] === 1,
      `and it starts where the closet ends, at 6' of 14' (got ${topRuns[0]?.map((n) => n.toFixed(2)).join("–")})`,
    );

    /*
      The left wall too, and the arithmetic there is the other way round: a clockwise polygon runs
      its left wall bottom-to-top, so the closet at the TOP occupies the END of that wall.
    */
    const leftRuns = exposedWallRuns(bedroom, bWalls[3]!.id, withCloset);
    check(
      leftRuns[0] != null && leftRuns[0][0] === 0 && Math.abs(leftRuns[0][1] - (1 - 4 / 15)) < 0.01,
      `the left wall is exposed from the floor up to the closet (got ${leftRuns[0]?.map((n) => n.toFixed(2)).join("–")})`,
    );

    // The wall the closet does NOT touch is untouched.
    check(
      exposedWallRuns(bedroom, bWalls[2]!.id, withCloset).join() === "0,1",
      "a wall the closet does not reach stays whole",
    );
    check(exposedWallRuns(bedroom, bWalls[0]!.id, [bedroom]).join() === "0,1", "and so does every wall when nothing is nested");

    /*
      Only NESTED rooms occlude. Two rooms drawn against each other share a wall down its whole
      length and it still belongs to both — subtracting there would leave neighbours unmarkable.
    */
    const neighbour = { ...rect("n2", "Bathroom", 14 * ppf, 0, 8, 15), parentRoomId: null };
    check(
      exposedWallRuns(bedroom, bWalls[1]!.id, [bedroom, neighbour]).join() === "0,1",
      "a room alongside is not a sub-room, and takes nothing away",
    );

    // A tap past the closet lands on the exposed stretch; one behind it falls back to the longest.
    check(exposedRunAt(bedroom, bWalls[0]!.id, withCloset, 0.8).join() === topRuns[0]!.join(), "a tap past the closet gets that stretch");
    check(exposedRunAt(bedroom, bWalls[0]!.id, withCloset, 0.1).join() === topRuns[0]!.join(), "a tap behind it falls back to the longest stretch");

    /*
      ── Delete, while mapping ────────────────────────────────────────────────────────────────

      A mark is put down by a single tap and so gets put down by accident. Removing it meant finding
      its card in the panel; the key that removes everything else now removes this too.
    */
    findButton("Moisture")?.click();
    await settle(300);
    const readings = () => Object.values(latestMoisture.rooms).flatMap((r) => r.wallReadings);
    g.tap({ x: 60 + 8 * ppf, y: 60 });
    await settle(300);
    check(readings().length === 1, `tapping a wall while mapping leaves one mark (got ${readings().length})`);

    press("Delete");
    await settle(300);
    check(readings().length === 0, `Delete removes the selected mark (${readings().length} left)`);

    // And it must not have reached the geometry, which mapping freezes.
    check(latestSketch.rooms.length === before, "without touching the room it was on");

    /*
      A mark on a room OTHER than the selected one.

      This is the case that made marks undeletable. A mark's own tap target selected the mark and
      left `selectedRoomId` pointing at whatever was selected before, so the panel went on listing
      the other room's readings and Delete filtered the other room's list — removing nothing, from a
      mark that was plainly there on the plan. Selecting a mark now selects its room with it.
    */
    const ownerOf = (id: string) => Object.entries(latestMoisture.rooms).find(([, d]) => d.wallReadings.some((r) => r.id === id))?.[0];
    // Two marks on two rooms: one on the room's top wall, one on the wall the stair room shares.
    g.tap({ x: 60 + 8 * ppf, y: 60 });
    await settle(300);
    const first = readings()[0];
    check(first != null, "a mark on the first room");

    // Select a DIFFERENT room, so the selection and the mark now disagree. The stair room is the
    // only other one in this fixture, and it sits well clear at y 260.
    g.tap({ x: 60 + 5 * ppf, y: 260 + 1.5 * ppf });
    await settle(250);
    check(document.querySelector(".sketch-panel h3")?.textContent?.includes("Stairs") === true, "the other room is now the selected one");
    // Then tap the mark itself. Its own hit target is drawn above the wall strip, so this is the
    // path that used to select a mark without its room.
    g.tap({ x: 60 + 8 * ppf, y: 60 + WALL_MARK_INSET_PX });
    await settle(250);
    press("Delete");
    await settle(300);
    check(
      first != null && ownerOf(first.id) === undefined,
      "a mark tapped while a different room was selected still deletes",
    );

    /*
      ── the handle where a mark meets a sub-room ─────────────────────────────────────────────

      Rooms draw in order, so a sub-room lands on top of its parent — and a mark that stops where a
      closet begins puts its end handle squarely under the closet's own 20px wall strip. The end
      most in need of dragging was the one that could not be grabbed at all, which is why the
      handles are now drawn after every room rather than inside the room that owns them.

      Asserted by hit-testing the canvas rather than by looking for the handle in the tree: the
      handle was always THERE, it was simply underneath something else.
    */
    const nestedHost = document.createElement("div");
    document.body.appendChild(nestedHost);
    try {
      createRoot(nestedHost).render(createElement(NestedHost));
      await settle(700);
      const nestedStage = Konva.stages[Konva.stages.length - 1];
      check(nestedStage !== undefined, "a second canvas mounted for the nested fixture");
      if (nestedStage) {
        const ng = gesturesFor(nestedStage);
        const nestedButtons = [...nestedHost.querySelectorAll("button")];
        nestedButtons.find((b) => b.textContent?.trim() === "Moisture")?.click();
        await settle(300);

        // Mark the big room's left wall. The closet takes its top 5', so the mark's far end lands
        // exactly on the closet's edge.
        ng.tap({ x: 60, y: 60 + 16 * ppf });
        await settle(300);
        ng.tap({ x: 60 + WALL_MARK_INSET_PX, y: 60 + 16 * ppf });
        await settle(300);

        nestedStage.getLayers().forEach((l) => l.drawHit());
        const container = nestedStage.container().getBoundingClientRect();
        const nodeAt = (world: { x: number; y: number }) => {
          const t = nestedStage.getAbsoluteTransform().copy().point(world);
          const hit = nestedStage.getIntersection({ x: t.x, y: t.y });
          return hit ? { name: hit.className, draggable: hit.draggable() } : null;
        };
        void container;

        // The closet's bottom edge, where the mark now stops.
        const atBoundary = nodeAt({ x: 60 + WALL_MARK_INSET_PX, y: 60 + 5 * ppf + 1 });
        check(
          atBoundary?.name === "Circle" && atBoundary.draggable,
          `the handle at the sub-room's edge is on top and grabbable (found ${atBoundary?.name ?? "nothing"})`,
        );
        // The far end, which never had a problem, must still work.
        const atFarEnd = nodeAt({ x: 60 + WALL_MARK_INSET_PX, y: 60 + 21 * ppf - 6 });
        check(atFarEnd?.name === "Circle" && atFarEnd.draggable, `and so is the other end (found ${atFarEnd?.name ?? "nothing"})`);
      }
    } finally {
      nestedHost.remove();
    }

    /*
      ── how far a mark sits inside a small room ──────────────────────────────────────────────

      The inset is a screen distance divided by zoom, so in WORLD terms it grows without limit as
      the view zooms out. On a 4' closet that put the mark past the middle of the room and
      eventually outside it — it stopped reading as a wall and started reading as a bar across the
      floor. `cappedInset` gives it no more depth than the room has to spare.
    */
    const closetTop = { x1: 0, y1: 0, x2: 6 * ppf, y2: 0 };
    const closetAnchor = { x: 3 * ppf, y: 2 * ppf }; // centre of a 6' x 4' closet
    const inClosetAt = (zoom: number) => cappedInset(closetTop.x1, closetTop.y1, closetTop.x2, closetTop.y2, closetAnchor, 15 / zoom);
    check(Math.abs(inClosetAt(2) - 7.5) < 0.01, `zoomed in, the full inset fits (${inClosetAt(2)})`);
    const zoomedOut = inClosetAt(0.3);
    check(
      zoomedOut <= (2 * ppf) / 2 + 0.01,
      `zoomed out, it is capped at half the depth to the room's middle rather than 50px (got ${zoomedOut})`,
    );
    check(zoomedOut < 4 * ppf * 0.5, `and so never reaches the middle of a 4' closet (${zoomedOut} of ${4 * ppf})`);
    // A big room is never capped: the cap must not quietly pull every mark onto the wall line.
    const bigAnchor = { x: 7 * ppf, y: 7 * ppf };
    check(
      Math.abs(cappedInset(0, 0, 14 * ppf, 0, bigAnchor, 6 / 0.3) - 20) < 0.01,
      "a full-sized room keeps the inset it asked for",
    );

    findButton("Sketch")?.click();
    await settle(200);

    /*
      ── openings ─────────────────────────────────────────────────────────────────────────────

      A cased opening or a missing wall is placed as a DOOR whose type is "opening", so it inherits
      the placement, the drag and the resize rather than duplicating them. What it needs of its own
      is a head height: an opening is described by its width and its height and nothing else.
    */
    const openingTool = findButton("Opening");
    check(openingTool !== null, "the toolbar offers an Opening");
    openingTool?.click();
    await settle(200);
    g.tap({ x: 60 + 4 * ppf, y: 60 });
    await settle(300);

    const placed = latestSketch.rooms.find((r) => r.id === "room-1")?.symbols.at(-1);
    check(placed?.type === "door", "it is placed as a door, which is what gives it drag and resize");
    check(placed?.type === "door" && placed.doorType === "opening", "with its type set to opening, so no leaf is drawn");
    check(
      placed?.type === "door" && Math.abs((placed.widthFeet ?? 0) - 2.5) < 0.01,
      `2'6" wide by default (got ${placed?.type === "door" ? placed.widthFeet : "?"})`,
    );
    check(
      placed?.type === "door" && Math.abs(placed.heightFeet - (6 + 8 / 12)) < 0.01,
      `and 6'8" high (got ${placed?.type === "door" ? placed.heightFeet.toFixed(3) : "?"})`,
    );

    // The height is editable, and an opening's is always stated in the summary — unlike a standard
    // door's, which would just be noise on every line.
    check(/2'6"/.test(sketchSummaryText(latestSketch)), "the summary states the opening's width");
    check(/6'8" high/.test(sketchSummaryText(latestSketch)), "and its head height");
    const withDoor6ft8 = {
      rooms: latestSketch.rooms.map((r) =>
        r.id === "room-1" ? { ...r, symbols: r.symbols.map((s) => (s.type === "door" ? { ...s, doorType: "swing" as const } : s)) } : r,
      ),
    };
    check(
      !/6'8" high/.test(sketchSummaryText(withDoor6ft8)),
      "a plain door at the standard head height does not repeat it on every line",
    );

    /*
      ── openings come out of the wall area ───────────────────────────────────────────────────

      Unconditionally, unlike the cabinetry deductions. Whether the finish behind a cabinet gets
      replaced is a scoping decision and belongs to a toggle; whether there is wall in a doorway is
      not a decision at all.
    */
    const plain = rect("q", "Bare", 0, 0, 10, 10);
    const bareWall = roomQuantities(plain, { rooms: [plain] }, DEFAULT_QUANTITY_OPTIONS);
    check(Math.abs(bareWall.wallArea - 40 * 8) < 0.01, `a bare 10' x 10' room at 8' is 320 SF of wall (got ${bareWall.wallArea})`);

    const doorWall = wallsOf(plain)[0]!.id;
    const withOpening: SketchRoom = { ...plain, symbols: [doorOn(plain, doorWall, 3, 7, "opening")] };
    const opened = roomQuantities(withOpening, { rooms: [withOpening] }, DEFAULT_QUANTITY_OPTIONS);
    check(
      Math.abs(opened.wallArea - (320 - 21)) < 0.01,
      `a 3' x 7' opening takes 21 SF off it (got ${opened.wallArea.toFixed(1)}, expected 299)`,
    );
    check(Math.abs(opened.gross.wallArea - 320) < 0.01, "the gross stays 320, so the panel can show the working");
    check(Math.abs(opened.deductions.openingSquareFeet - 21) < 0.01, "and the 21 SF is itemised as an opening, not lumped in with cabinetry");
    check(opened.deductions.wallSquareFeet === 0, "with the cabinetry deduction still zero — the toggles were never touched");

    // A plain door is a hole in the wall too, and is deducted the same way.
    const withPlainDoor: SketchRoom = { ...plain, symbols: [doorOn(plain, doorWall, 3, 6 + 8 / 12, "swing")] };
    const doored = roomQuantities(withPlainDoor, { rooms: [withPlainDoor] }, DEFAULT_QUANTITY_OPTIONS);
    check(Math.abs(doored.wallArea - (320 - 20)) < 0.01, `a 3' x 6'8" door takes 20 SF off (got ${doored.wallArea.toFixed(1)})`);

    // A window is a hole in the wall too. Its default is 3' x 4'.
    const withWindow: SketchRoom = { ...plain, symbols: [windowOn(plain, doorWall, 4, 5)] };
    check(
      Math.abs(roomQuantities(withWindow, { rooms: [withWindow] }, DEFAULT_QUANTITY_OPTIONS).wallArea - (320 - 20)) < 0.01,
      `a 4' x 5' window takes 20 SF off (got ${roomQuantities(withWindow, { rooms: [withWindow] }, DEFAULT_QUANTITY_OPTIONS).wallArea.toFixed(1)})`,
    );

    // A window with no height is not a measurement, so it contributes nothing rather than a guess.
    const noHeight: SketchRoom = { ...plain, symbols: [windowOn(plain, doorWall, 4, null)] };
    check(
      Math.abs(roomQuantities(noHeight, { rooms: [noHeight] }, DEFAULT_QUANTITY_OPTIONS).wallArea - 320) < 0.01,
      "a window with no height recorded deducts nothing rather than an invented figure",
    );

    /*
      The toggle. On by default — a doorway really is a hole — but switchable, because an estimator
      setting this against a gross figure from elsewhere needs the gross.
    */
    check(DEFAULT_QUANTITY_OPTIONS.deductOpeningsFromWallArea, "the openings deduction starts on, unlike the cabinetry ones");
    check(!DEFAULT_QUANTITY_OPTIONS.deductFromWallArea, "and the cabinetry one still starts off");
    const off = roomQuantities(withOpening, { rooms: [withOpening] }, { ...DEFAULT_QUANTITY_OPTIONS, deductOpeningsFromWallArea: false });
    check(Math.abs(off.wallArea - 320) < 0.01, `switching it off gives the gross back (got ${off.wallArea.toFixed(1)})`);
    check(off.deductions.openingSquareFeet === 0, "and nothing is itemised as deducted");

    // An opening typed taller than the room cannot deduct more wall than the wall has.
    const tooTall: SketchRoom = { ...plain, symbols: [doorOn(plain, doorWall, 3, 20, "opening")] };
    check(
      Math.abs(roomQuantities(tooTall, { rooms: [tooTall] }, DEFAULT_QUANTITY_OPTIONS).wallArea - (320 - 24)) < 0.01,
      "a 20' opening in an 8' room deducts 8' of height, not 20'",
    );

    /*
      ── full-height cabinets ─────────────────────────────────────────────────────────────────

      A pantry stands on the floor exactly as a base run does; the only thing that sets it apart is
      that it keeps going up. Every `tier === "base"` test in the codebase was really asking "does
      this stand on the floor?", and answering it with an equality check would have silently left
      the new tier out of the floor and perimeter deductions — the quiet kind of wrong, since the
      cabinet would still draw and still deduct from the WALL.
    */
    check(CABINET_TIER_LABEL.full === "Full height", "the third tier is offered");
    check(CABINET_DEFAULT_HEIGHT_FEET.full === 6, `and defaults to 6' tall (got ${CABINET_DEFAULT_HEIGHT_FEET.full})`);
    check(standsOnFloor("full") && standsOnFloor("base") && !standsOnFloor("wall"), "it stands on the floor; only a wall cabinet does not");

    const pantryWall = wallsOf(plain)[0]!.id;
    const cabinetOn = (tier: "base" | "wall" | "full") => {
      const created = newSymbol("cabinet", pantryWall, 0.5, plain);
      if (created.type !== "cabinet") throw new Error("newSymbol did not make a cabinet");
      return { ...created, tier, widthFeet: 3, depthFeet: 2, heightFeet: CABINET_DEFAULT_HEIGHT_FEET[tier] };
    };
    const allOn = { ...DEFAULT_QUANTITY_OPTIONS, deductCabinetsFromFloorPerimeter: true, deductFromFloorArea: true, deductFromWallArea: true };

    const withPantry: SketchRoom = { ...plain, symbols: [cabinetOn("full")] };
    const pantryQ = roomQuantities(withPantry, { rooms: [withPantry] }, allOn);
    check(Math.abs(pantryQ.deductions.perimeterFeet - 3) < 0.01, `a pantry takes its 3' out of the floor perimeter (got ${pantryQ.deductions.perimeterFeet})`);
    check(Math.abs(pantryQ.deductions.floorSquareFeet - 6) < 0.01, `and its 3' x 2' footprint out of the floor area (got ${pantryQ.deductions.floorSquareFeet})`);
    check(Math.abs(pantryQ.deductions.wallSquareFeet - 18) < 0.01, `and 3' x 6' of wall behind it (got ${pantryQ.deductions.wallSquareFeet})`);

    // An upper is the one that does none of the floor ones, which is what the tier is FOR.
    const withUpper: SketchRoom = { ...plain, symbols: [cabinetOn("wall")] };
    const upperQ = roomQuantities(withUpper, { rooms: [withUpper] }, allOn);
    check(upperQ.deductions.perimeterFeet === 0 && upperQ.deductions.floorSquareFeet === 0, "an upper takes nothing off the floor or its perimeter");
    check(Math.abs(upperQ.deductions.wallSquareFeet - 3 * 2.5) < 0.01, "but still takes the wall behind it");

    // ── the exported JPEG ────────────────────────────────────────────────────────────────────
    const jpeg = await renderSketchJpeg(latestSketch, emptyMoistureMap(), "clean");
    check(jpeg !== null, "the plan renders to an image");
    check(jpeg?.dataUrl.startsWith("data:image/jpeg") === true, "as a JPEG, which is what an underlay import takes");

    if (jpeg) {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = jpeg.dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0);

      /*
        The corner must be WHITE, not black.

        JPEG has no alpha and the stage is transparent outside a room, so a direct
        toDataURL("image/jpeg") encodes every one of those pixels as black. The plan would still
        look right in the editor and arrive as navy lines on a black field.
      */
      const corner = ctx.getImageData(2, 2, 1, 1).data;
      check(
        corner[0]! > 240 && corner[1]! > 240 && corner[2]! > 240,
        `the background is white, not the black an un-composited alpha gives (got ${corner[0]},${corner[1]},${corner[2]})`,
      );

      /*
        The wall measures a real 4 inches.

        The export's own scale is `PIXELS_PER_FOOT x frame.view.scale x PIXEL_RATIO`; the frame
        scale is 1 here because this fixture is far smaller than the export's maximum.

        Expected is derived from the constants rather than written as 8, and that is the whole
        protection this offers today. At the current 12 px/ft a hard-coded 4-pixel stroke IS a real
        4 inches, so nothing here could tell the two apart — nor is there anything to tell apart,
        since the scale is fixed. What it does catch is the day `PIXELS_PER_FOOT` changes and a
        hard-coded stroke stops meaning 4", which is exactly when it starts to matter.
      */
      const imagePxPerFoot = ppf * 2;
      const expected = Math.round(imagePxPerFoot * WALL_THICKNESS_FEET);

      /*
        Measured as the most common dark run across EVERY column, not by probing one.

        A single column has to be aimed, and an aimed column is a magic number that goes stale the
        moment the fixture moves — the first version of this crossed the room's own label and a
        stair tread and reported them as walls. Every horizontal wall contributes one run of its
        thickness to every column it spans, so across the whole image the walls outvote everything
        else by a wide margin, with no coordinates to get wrong.
      */
      const histogram = new Map<number, number>();
      for (let x = 0; x < canvas.width; x += 1) {
        for (const run of darkRuns(ctx.getImageData(x, 0, 1, canvas.height).data, canvas.height)) {
          histogram.set(run, (histogram.get(run) ?? 0) + 1);
        }
      }
      const ranked = [...histogram.entries()].sort((a, b) => b[1] - a[1]);
      const mode = ranked[0]?.[0];
      // The runner-up goes in the message so a failure says how clear the win was, not just that
      // the mode moved — a mode that squeaks in is a test about to become flaky.
      const top = ranked.slice(0, 3).map(([len, n]) => `${len}px x${n}`).join(", ");
      check(
        mode === expected,
        `walls measure ${expected}px, a true ${Math.round(WALL_THICKNESS_FEET * 12)}" at this scale (runs: ${top})`,
      );

      // The editing grid must not be in the file: a grid line and a wall line are the same thing to
      // trace over, and the estimator's own grid will not agree with it.
      const between = ctx.getImageData(4, Math.round(canvas.height / 2), 40, 1).data;
      let nonWhite = 0;
      for (let i = 0; i < 40; i += 1) if (between[i * 4]! < 250) nonWhite += 1;
      check(nonWhite === 0, `the margin outside the rooms is blank — no grid baked in (${nonWhite} of 40 pixels marked)`);
    }

    /*
      ── Storeys ──────────────────────────────────────────────────────────────────────────────────

      Levels share ONE coordinate space, which is what makes tracing work: an upper floor is drawn
      over the plan of the one below it. That sharing is also the hazard — every piece of geometry
      that asks "is this room inside that one" would say yes across storeys unless it checks.
    */
    {
      const main = { ...twelveByTwelve, id: "L0", level: MAIN_LEVEL };
      /*
        Drawn strictly INSIDE the main room's footprint — a small upper room traced over a larger one
        below, which is what the underlay invites. Coincident outlines would not test this: only a
        room genuinely contained by another is a nesting candidate in the first place.
      */
      const upstairs = {
        ...twelveByTwelve,
        id: "L1",
        name: "Upstairs Bedroom",
        level: 1,
        vertices: [
          { id: "up1", x: 60, y: 60 },
          { id: "up2", x: 108, y: 60 },
          { id: "up3", x: 108, y: 108 },
          { id: "up4", x: 60, y: 108 },
        ],
      };
      const twoStorey = { rooms: withDerivedParents([main, upstairs]) };

      check(levelsOf(twoStorey).join(",") === "0,1", `both storeys are reported, lowest first (got ${levelsOf(twoStorey).join(",")})`);
      check(roomsOnLevel(twoStorey, 1).length === 1, "and each level reports only its own rooms");
      check(levelsOf({ rooms: [] }).join(",") === "0", "an empty sketch still has a main level to draw on");

      /*
        The one that would corrupt real numbers silently: a room traced over the one below it must
        not be adopted as its closet. A sub-room's floor area comes out of its parent's, so a
        swallowed upper bedroom would quietly shrink the room underneath it.
      */
      const adopted = twoStorey.rooms.find((r) => r.id === "L1")?.parentRoomId ?? null;
      check(adopted === null, `a room traced over another storey is not nested inside it (got ${JSON.stringify(adopted)})`);

      // A room genuinely inside another, on the SAME storey, still nests as it always did.
      const closet = {
        ...twelveByTwelve,
        id: "L0c",
        name: "Closet",
        level: MAIN_LEVEL,
        vertices: [
          { id: "c1", x: 60, y: 60 },
          { id: "c2", x: 108, y: 60 },
          { id: "c3", x: 108, y: 108 },
          { id: "c4", x: 60, y: 108 },
        ],
      };
      const sameStorey = withDerivedParents([main, closet]);
      check(
        sameStorey.find((r) => r.id === "L0c")?.parentRoomId === "L0",
        "a closet on the same storey still nests normally",
      );

      // A sketch drawn before levels existed reads as all-main-level rather than as no levels.
      const legacy = { rooms: [{ ...twelveByTwelve, id: "old", level: undefined }] };
      check(levelsOf(legacy).join(",") === "0", "a sketch with no level recorded is the main level");

      /*
        The underlay defaults BELOW, because that is the direction the work goes — a PM drawing an
        upper floor is placing it over rooms already drawn. Above is a fallback rather than nothing.
      */
      check(defaultUnderlayLevel(twoStorey, 1) === 0, `standing on the upper level, the one below is traced (got ${defaultUnderlayLevel(twoStorey, 1)})`);
      check(defaultUnderlayLevel(twoStorey, 0) === 1, "standing on the main level with nothing below, the one above is");
      check(defaultUnderlayLevel({ rooms: [main] }, 0) === null, "and a single storey traces nothing");

      check(levelLabel(0) === "Main level", `the main level is named plainly (got ${levelLabel(0)})`);
      check(levelLabel(-1) === "Level below" && levelLabel(2) === "2 levels above", `and the others by direction (got ${levelLabel(-1)} / ${levelLabel(2)})`);
    }

    /*
      ── The other storey survives being drawn over ───────────────────────────────────────────────

      The bug this covers, reported directly: "if i draw a room on main level and then select trace
      from level above, my sketch overlaps the level above and it disappears." The underlay sat BELOW
      the working layer and a room's fill is opaque white, so the moment your drawing reached the
      other storey it was buried — a reference you lose exactly where your work is.

      Rendered, not reasoned about: this is layer order and fill opacity, which is the sort of thing
      that looks right in the source and wrong on screen.
    */
    {
      const main = { ...twelveByTwelve, id: "OV0", level: MAIN_LEVEL };
      // Same footprint as the room being drawn — the exact overlap that made it vanish.
      const above = {
        ...twelveByTwelve,
        id: "OV1",
        level: 1,
        vertices: twelveByTwelve.vertices.map((v) => ({ ...v, id: `ov-${v.id}` })),
      };

      const overlayHost = document.createElement("div");
      document.body.appendChild(overlayHost);
      const overlayRoot = createRoot(overlayHost);
      try {
        overlayRoot.render(
          createElement(SketchCanvas, {
            rooms: [main],
            underlayRooms: [above],
            width: 700,
            height: 460,
            view: { x: 0, y: 0, scale: 1 },
            tool: "select" as const,
            showSizes: false,
            showGrid: false,
            moisture: emptyMoistureMap(),
            showMoisture: false,
            moistureTool: null,
            paintSurface: "floor" as const,
            selectedReadingId: null,
            selectedRoomId: null,
            selectedSymbolId: null,
            onSelectReading: () => {},
            onResizeReading: () => {},
            onViewChange: () => {},
            onSelectRoom: () => {},
            onSelectSymbol: () => {},
            onMoveRoom: () => {},
            onTapWall: () => {},
            onTapWallForReading: () => {},
            onPaintFloor: () => {},
            onPlaceSymbol: () => {},
            onSplitWall: () => {},
            onDragWall: () => {},
            onDragWallEnd: () => {},
            onRenameRoom: () => {},
            onMoveVertex: () => {},
            onRemoveVertex: () => {},
            onMoveSymbol: () => {},
            onResizeSymbol: () => {},
            onPlaceIsland: () => {},
            onMoveIsland: () => {},
            onResizeIsland: () => {},
          }),
        );
        await settle(600);

        /*
          Found by container, not by position. Earlier tests defer their unmount, so several stages
          are alive at once and "the last one" is whichever happened to be created most recently —
          which is how this check first passed against somebody else's canvas.
        */
        const stage = Konva.stages.find((st) => overlayHost.contains(st.container()));
        check(stage !== undefined, "the overlay fixture mounts");
        if (stage) {
          const layers = stage.getLayers();
          const ghost = layers.find((l) => l.opacity() < 1);
          check(ghost !== undefined, "the other storey has its own faint layer");
          if (ghost) {
            /*
              ON TOP of the working level, which is the whole fix. `getLayers` is in draw order, so a
              higher index is drawn later and therefore over.
            */
            const working = layers.find((l) => l.opacity() === 1 && l.find("Line").length > 0);
            check(
              working !== undefined && layers.indexOf(ghost) > layers.indexOf(working),
              `the other storey draws over the working level, not under it (ghost at ${layers.indexOf(ghost)}, working at ${working ? layers.indexOf(working) : "none"})`,
            );

            // Dashed and unfilled, so it reads as reference rather than as a wall somebody started.
            const ghostLines = ghost.find<Konva.Line>("Line");
            check(ghostLines.length > 0, "and draws its walls");
            check(
              ghostLines.every((l) => (l.dash()?.length ?? 0) > 0),
              "as dashed lines",
            );
            check(ghost.find("Rect").length === 0, "with no filled body to obscure the work beneath");
            // Labels belong to the storey you are on; another one's names among them is noise.
            check(ghost.find("Text").length === 0, "and no room labels from the other storey");
          }
        }
      } finally {
        setTimeout(() => {
          overlayRoot.unmount();
          overlayHost.remove();
        }, 0);
      }
    }

    /*
      ── A surface thumbnail actually draws the highlight ─────────────────────────────────────────

      The derivation is covered by `npm run test:scope`; that says which walls SHOULD be picked out
      and nothing at all about whether the picture shows them. The highlight is Konva prop logic, so
      the only honest check is to render one and look at the pixels — the same reason the white-corner
      check above exists.
    */
    {
      const room = latestSketch.rooms[0];
      const first = room ? wallsOf(room).map((w) => w.id)[0] : undefined;
      if (room && first) {
        const thumbnails = [
          { id: surfaceRenderId(room.id, "walls"), label: "t", roomId: room.id, wallIds: [first], surface: "walls" as const },
        ];
        const plain = await renderSketchImage(latestSketch, emptyMoistureMap(), "clean");
        const lit = await renderSketchImage(latestSketch, emptyMoistureMap(), surfaceRenderId(room.id, "walls"), thumbnails);
        check(lit !== null, "a surface thumbnail renders");

        const pixels = async (dataUrl: string) => {
          const img = new Image();
          await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = dataUrl;
          });
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const cx = c.getContext("2d");
          if (!cx) throw new Error("no 2d context");
          cx.drawImage(img, 0, 0);
          return cx.getImageData(0, 0, c.width, c.height).data;
        };
        /** Pixels reading as the highlight red rather than the wall navy. */
        const reddish = (data: Uint8ClampedArray) => {
          let n = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3]! > 200 && data[i]! > 130 && data[i + 1]! < 100 && data[i + 2]! < 100) n += 1;
          }
          return n;
        };

        if (plain && lit) {
          const before = reddish(await pixels(plain.dataUrl));
          const after = reddish(await pixels(lit.dataUrl));
          check(before === 0, `the plain plan carries no highlight colour (${before} red pixels)`);
          check(after > 50, `the thumbnail draws the picked-out wall in the highlight colour (${after} red pixels)`);
        }
      }
    }

    return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  } finally {
    host.remove();
  }
}
