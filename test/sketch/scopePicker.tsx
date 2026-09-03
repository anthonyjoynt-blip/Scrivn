"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { ScopeMarkPicker } from "@/components/sketch/ScopeMarkPicker";
import { PIXELS_PER_FOOT, type Sketch, type SketchRoom, wallsOf } from "@/lib/sketch";
import { type ScopeMark, emptyScopeMark, scopeWallRunFeet } from "@/lib/scopeMarks";
import { gesturesFor } from "./gestures";

/**
 * The add-from-sketch picker, driven end to end.
 *
 * What matters here is that pointing at walls produces the right NUMBER, since that number goes
 * into a scope and gets ordered against. The measurement is pure and tested elsewhere; these tests
 * cover the part that is not — that a tap reaches the right wall, that tapping again removes it,
 * and that the total shown is the total handed back.
 */

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

/** 20' x 15' at 12px/ft, so its walls are 20, 15, 20 and 15 feet. */
const testRoom = (): SketchRoom => ({
  id: "r1",
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
    { id: "a", x: 40, y: 40 },
    { id: "b", x: 40 + 20 * PIXELS_PER_FOOT, y: 40 },
    { id: "c", x: 40 + 20 * PIXELS_PER_FOOT, y: 40 + 15 * PIXELS_PER_FOOT },
    { id: "d", x: 40, y: 40 + 15 * PIXELS_PER_FOOT },
  ],
});

/**
 * The same 20' x 15' room with a 6' closet built into the top-left corner, against the 20' wall.
 *
 * The closet's own top wall lies on the parent's top wall for 6 of its 20 feet, so 14 feet of that
 * wall is exposed and 6 belongs to the closet.
 */
const CLOSET_FEET = 6;
const closetInRoom = (): SketchRoom => ({
  id: "r2",
  name: "Closet",
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: "r1",
  nestingOptOut: false,
  symbols: [],
  freeCabinets: [],
  vertices: [
    { id: "e", x: 40, y: 40 },
    { id: "f", x: 40 + CLOSET_FEET * PIXELS_PER_FOOT, y: 40 },
    { id: "g", x: 40 + CLOSET_FEET * PIXELS_PER_FOOT, y: 40 + CLOSET_FEET * PIXELS_PER_FOOT },
    { id: "h", x: 40, y: 40 + CLOSET_FEET * PIXELS_PER_FOOT },
  ],
});

let used: { mark: ScopeMark; value: string } | null = null;
let cancelled = false;

function Host({ sketch, measure }: { sketch: Sketch; measure: "wallRun" | "floorArea" }) {
  const [initial] = useState<ScopeMark>(emptyScopeMark);
  return createElement(ScopeMarkPicker, {
    sketch,
    measure,
    title: "How much of the wall run is being cut?",
    initial,
    onCancel: () => {
      cancelled = true;
    },
    onUse: (mark: ScopeMark, value: string) => {
      used = { mark, value };
    },
  });
}

const findButton = (test: (text: string) => boolean): HTMLButtonElement | null =>
  ([...document.querySelectorAll("button")].find((b) => test(b.textContent?.trim() ?? "")) as HTMLButtonElement | undefined) ?? null;

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);

  try {
    const sketch: Sketch = { rooms: [testRoom()] };
    root.render(createElement(Host, { sketch, measure: "wallRun" }));
    await new Promise((r) => setTimeout(r, 700));

    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the picker mounts a canvas");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);

    const room = testRoom();
    const walls = wallsOf(room);
    const long = walls.find((w) => Math.round(w.lengthFeet ?? 0) === 20);
    const short = walls.find((w) => Math.round(w.lengthFeet ?? 0) === 15);
    check(long !== undefined && short !== undefined, "the fixture has a 20' and a 15' wall");
    if (!long || !short) throw new Error("fixture walls missing");

    const midOf = (w: typeof long) => ({ x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 });

    // Nothing marked yet: the Use button must not offer a number.
    check(findButton((t) => /^Use /.test(t)) === null || findButton((t) => /^Use /.test(t))?.disabled === true,
      "with nothing marked, Use is unavailable");

    g.tap(midOf(long));
    await new Promise((r) => setTimeout(r, 200));
    check(findButton((t) => t === "Use 20 LF") !== null, `tapping the 20' wall totals 20 LF (saw "${findButton((t) => /^Use /.test(t))?.textContent?.trim()}")`);

    g.tap(midOf(short));
    await new Promise((r) => setTimeout(r, 200));
    check(findButton((t) => t === "Use 35 LF") !== null, `adding the 15' wall totals 35 LF (saw "${findButton((t) => /^Use /.test(t))?.textContent?.trim()}")`);

    // Tapping a marked wall again removes it — the same gesture both ways.
    g.tap(midOf(short));
    await new Promise((r) => setTimeout(r, 200));
    check(findButton((t) => t === "Use 20 LF") !== null, `tapping it again removes it, back to 20 LF (saw "${findButton((t) => /^Use /.test(t))?.textContent?.trim()}")`);

    // Take the value.
    const useButton = findButton((t) => t === "Use 20 LF");
    useButton?.click();
    await new Promise((r) => setTimeout(r, 200));
    check(used !== null, "using the marking calls back");
    check(used?.value === "20 LF", `with the value in the question's own unit (got ${JSON.stringify(used?.value)})`);
    check(used?.mark.walls.length === 1, "and the marking itself, so it can be reopened");
    check(used ? Math.abs(scopeWallRunFeet(used.mark, sketch) - 20) < 0.01 : false, "the marking re-measures to the same number");
    check(!cancelled, "using is not cancelling");

    /*
      A wall a closet is built against measures the EXPOSED stretch, not the whole wall.

      Reported directly: "selecting a back wall that shares with the closet gives me the measurement
      of the full wall including the closet, not just the wall up to the closet which is what i
      selected." The moisture editor had always clipped the tapped run; this picker marked [0, 1]
      whatever was tapped, so the identical gesture measured two different things depending on which
      screen the PM was on — and this is the screen whose number goes straight into a scope quantity.
    */
    root.unmount();
    host.remove();

    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const root2 = createRoot(host2);
    try {
      const nested: Sketch = { rooms: [testRoom(), closetInRoom()] };
      used = null;
      root2.render(createElement(Host, { sketch: nested, measure: "wallRun" }));
      await new Promise((r) => setTimeout(r, 700));

      const stage2 = Konva.stages[Konva.stages.length - 1];
      if (!stage2) throw new Error("no stage for the nested case");
      const g2 = gesturesFor(stage2);

      // Tap the exposed end of the shared wall — past the closet, which occupies the first 6 feet.
      const sharedWall = wallsOf(testRoom()).find((w) => Math.round(w.lengthFeet ?? 0) === 20)!;
      const exposedPoint = {
        x: sharedWall.x1 + (sharedWall.x2 - sharedWall.x1) * 0.8,
        y: sharedWall.y1 + (sharedWall.y2 - sharedWall.y1) * 0.8,
      };
      g2.tap(exposedPoint);
      await new Promise((r) => setTimeout(r, 250));

      const shown = findButton((t) => /^Use /.test(t))?.textContent?.trim();
      check(
        findButton((t) => t === "Use 14 LF") !== null,
        `tapping past a 6' closet on a 20' wall measures the 14' that is exposed, not the full 20 (saw "${shown}")`,
      );
    } finally {
      setTimeout(() => {
        root2.unmount();
        host2.remove();
      }, 0);
    }
  } finally {
    setTimeout(() => {
      root.unmount();
      host.remove();
    }, 0);
  }

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
