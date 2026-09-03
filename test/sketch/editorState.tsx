"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { PIXELS_PER_FOOT, type Sketch, type SketchRoom, wallsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap, roomMoisture } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * The editor driven through its real parent-state loop.
 *
 * The other suites mount `SketchCanvas` directly, which cannot see this class of bug at all: the
 * canvas only calls a prop, and everything that goes wrong here goes wrong in what the editor does
 * with that call and how the parent's state comes back.
 *
 * It exists because of one that shipped. `setNewReadingId` was called from INSIDE the updater handed
 * to `onMoistureChange` — and a state updater is not run when it is handed over, it runs later while
 * React renders the component that owns that state. So it was a setState on the editor during the
 * claim page's render, which React reports as "Cannot update a component while rendering a different
 * component". Nothing threw and nothing looked wrong; it was a console warning found by a person.
 *
 * That specific bug is caught by `stateRules.mjs`, NOT here. Watching `console.error` for the
 * warning was tried first and does not work: React eagerly evaluates an updater inside the event
 * handler when the fiber has no other pending update, so in a harness this small the callback never
 * runs during a render and the warning never fires. Those assertions passed with the bug deliberately
 * reintroduced, which is worse than not having them, so they were removed rather than left to
 * reassure. The rule is syntactic and is checked syntactically.
 *
 * What is left here is the loop itself: a tap on a wall reaching the parent's state and coming back,
 * one reading per wall however many times it is tapped, and a stroke reaching state at all.
 */

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const stairRoom = (): SketchRoom => ({
  id: "room-1",
  name: "Basement",
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: null,
  nestingOptOut: false,
  symbols: [],
  freeCabinets: [],
  vertices: [
    { id: "a", x: 60, y: 60 },
    { id: "b", x: 60 + 16 * PIXELS_PER_FOOT, y: 60 },
    { id: "c", x: 60 + 16 * PIXELS_PER_FOOT, y: 60 + 12 * PIXELS_PER_FOOT },
    { id: "d", x: 60, y: 60 + 12 * PIXELS_PER_FOOT },
  ],
});

/** Stands in for the claim page: it owns both pieces of state, exactly as the real parent does. */
let latestMoisture: MoistureMap = emptyMoistureMap();

function Host() {
  const [sketch, setSketch] = useState<Sketch>({ rooms: [stairRoom()] });
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
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

function findButton(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined
  ) ?? null;
}

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  const host = document.createElement("div");
  host.id = "editor-host";
  document.body.appendChild(host);

  try {
    createRoot(host).render(createElement(Host));
    // The canvas arrives through next/dynamic, so the stage does not exist on the first paint.
    await new Promise((r) => setTimeout(r, 600));

    const moistureButton = findButton("Moisture");
    check(moistureButton !== null, "the editor offers a Moisture mode");
    if (!moistureButton) throw new Error("no Moisture button");

    moistureButton.click();
    await new Promise((r) => setTimeout(r, 250));
    check(findButton("Wall reading") !== null, "switching to Moisture shows the moisture tools");

    // Surface buttons appear only with a brush in hand — a button that visibly does nothing reads
    // as broken. Discoverability comes from the tool being "Highlight", not "Highlight floor".
    check(findButton("Floor") === null && findButton("Ceiling") === null, "no surface buttons before a brush is chosen");

    // The key travels with the sketch, so it has to explain both the wall colours and the surfaces.
    const legend = document.querySelector(".moisture-legend")?.textContent ?? "";
    check(/Affected floor/i.test(legend) && /Affected ceiling/i.test(legend), `the legend distinguishes floor from ceiling (got "${legend.slice(0, 90)}")`);
    check(/dry standard/i.test(legend), "the legend still explains the wall colours");

    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");

    // Tap a wall, which is the gesture that records a reading — and the one that produced the bug.
    const room = stairRoom();
    const wall = wallsOf(room)[0];
    if (!wall) throw new Error("fixture has no walls");
    const g = gesturesFor(stage);

    g.tap({ x: (wall.x1 + wall.x2) / 2, y: wall.y1 });
    await new Promise((r) => setTimeout(r, 250));

    const readings = roomMoisture(latestMoisture, "room-1").wallReadings;
    check(readings.length === 1, `tapping a wall records exactly one reading (got ${readings.length})`);
    check(readings[0]?.wallId === wall.id, "the reading lands on the wall that was tapped");
    check(readings[0]?.dryStandard === 0.75, "a new reading pre-fills the drywall default, which is editable");
    // Assumed wet until measured — but the measurement itself is not invented.
    check(readings[0]?.reading === null, "a new reading starts unmeasured rather than at a made-up number");

    // Tapping the same wall again must select the reading, not stack a second on one wall.
    g.tap({ x: (wall.x1 + wall.x2) / 2 + 10, y: wall.y1 });
    await new Promise((r) => setTimeout(r, 250));
    check(
      roomMoisture(latestMoisture, "room-1").wallReadings.length === 1,
      `tapping the same wall twice leaves one reading (got ${roomMoisture(latestMoisture, "room-1").wallReadings.length})`,
    );

    /*
      Dragging a wall mark's end, repeatedly.

      The first version reset the handle to a position captured from an earlier render, which left
      the node somewhere react-konva did not believe it was — so the next render skipped the update
      as unchanged and the hit pad stayed behind the visible grip. One drag worked and every drag
      after it grabbed nothing, which only a REPEATED drag can catch.
    */
    const runs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const current = roomMoisture(latestMoisture, "room-1").wallReadings[0];
      if (!current) break;
      const at = {
        x: wall.x1 + (wall.x2 - wall.x1) * current.endT,
        y: wall.y1 + (wall.y2 - wall.y1) * current.endT,
      };
      g.drag(at, -24, 0);
      await new Promise((r) => setTimeout(r, 120));
      const after = roomMoisture(latestMoisture, "room-1").wallReadings[0];
      runs.push(after ? after.endT : NaN);
    }
    check(runs.length === 4, "four drags were attempted on the mark's end");
    check(runs[0] !== undefined && runs[0] < 1, `the first drag shortens the mark (endT ${runs[0]?.toFixed(3)})`);
    // Every drag must move it again — the bug was that only the first one did.
    const everyDragMoved = runs.every((v, i) => i === 0 || (v !== undefined && runs[i - 1] !== undefined && v < (runs[i - 1] as number)));
    check(everyDragMoved, `each further drag shortens it again (${runs.map((v) => v?.toFixed(3)).join(" -> ")})`);
    const last = runs[runs.length - 1];
    const first = roomMoisture(latestMoisture, "room-1").wallReadings[0];
    check(first !== undefined && last !== undefined && last >= first.startT, "the end never crosses the start");

    // Painting runs the other updater path, many times per stroke.
    const paintButton = findButton("Highlight");
    check(paintButton !== null, "the editor offers a floor highlighter");
    if (paintButton) {
      paintButton.click();
      await new Promise((r) => setTimeout(r, 150));
      g.drag({ x: 150, y: 140 }, 70, 40);
      await new Promise((r) => setTimeout(r, 250));
      check(findButton("Floor") !== null && findButton("Ceiling") !== null, "choosing Highlight reveals Floor and Ceiling");
      check(
        roomMoisture(latestMoisture, "room-1").floorCells.length > 0,
        `painting reaches the parent's state (${roomMoisture(latestMoisture, "room-1").floorCells.length} cells)`,
      );

      /*
        Both surfaces report their area, and the two readouts stay in step.

        The ceiling had none. It could be highlighted, the square footage was computed, and it fed
        the air-mover count — but nothing on screen said so, so a marked ceiling and an unmarked one
        looked identical in the panel. Nothing failed; the pair had simply drifted apart. Asserting
        against the rendered panel rather than the state is the point: the state was always right.
      */
      const surfaceText = () =>
        [...document.querySelectorAll(".sketch-panel .question")].map((q) => q.textContent ?? "").filter((t) => /Affected (floor|ceiling)/.test(t));
      check(surfaceText().length === 2, `the panel shows a readout for both surfaces (found ${surfaceText().length})`);
      check(
        surfaceText().some((t) => /Affected floor/.test(t) && /SF highlighted/.test(t)),
        "the floor's shows its area once painted",
      );

      findButton("Ceiling")?.click();
      await new Promise((r) => setTimeout(r, 150));
      g.drag({ x: 150, y: 100 }, 70, 30);
      await new Promise((r) => setTimeout(r, 250));
      check(
        roomMoisture(latestMoisture, "room-1").ceilingCells.length > 0,
        `painting the ceiling reaches state too (${roomMoisture(latestMoisture, "room-1").ceilingCells.length} cells)`,
      );
      check(
        surfaceText().some((t) => /Affected ceiling/.test(t) && /SF highlighted/.test(t)),
        `and the ceiling's readout appears with it (got "${surfaceText().find((t) => /ceiling/i.test(t))?.slice(0, 60)}")`,
      );
    }
  } finally {
    host.remove();
  }

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
