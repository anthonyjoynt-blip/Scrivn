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

/** A plain rectangular room, its top-left corner at (x, y) in world pixels. */
const rectRoom = (id: string, name: string, x: number, y: number, widthFeet: number, depthFeet: number): SketchRoom => ({
  ...testRoom(),
  id,
  name,
  vertices: [
    { id: `${id}a`, x, y },
    { id: `${id}b`, x: x + widthFeet * PIXELS_PER_FOOT, y },
    { id: `${id}c`, x: x + widthFeet * PIXELS_PER_FOOT, y: y + depthFeet * PIXELS_PER_FOOT },
    { id: `${id}d`, x, y: y + depthFeet * PIXELS_PER_FOOT },
  ],
});

/**
 * A basement drawn Rec Room first, so a picker that opens on the first room opens on the wrong one
 * for anything asked about the Mechanical Room beside it.
 */
const REC = { x: 40, y: 40, w: 20, d: 15 };
const MECH = { x: 40 + 20 * PIXELS_PER_FOOT, y: 40, w: 10, d: 8 };
const basement = (): Sketch => ({
  rooms: [
    rectRoom("rec", "Rec Room", REC.x, REC.y, REC.w, REC.d),
    rectRoom("mech", "Mechanical Room", MECH.x, MECH.y, MECH.w, MECH.d),
  ],
});

/** A point well inside a room, clear of its walls' tap strips and of its name's tap target. */
const insideOf = (r: { x: number; y: number; w: number; d: number }) => ({
  x: r.x + r.w * PIXELS_PER_FOOT * 0.25,
  y: r.y + r.d * PIXELS_PER_FOOT * 0.75,
});

/** Whether a room is the selected one: its floor is outlined in the selection amber (`COLORS.selected`). */
function isSelectedAt(stage: Konva.Stage, world: { x: number; y: number }): boolean {
  stage.getLayers().forEach((layer) => layer.drawHit());
  const hit = stage.getIntersection(stage.getAbsoluteTransform().copy().point(world));
  return hit?.stroke() === "#c97a0e";
}

let used: { mark: ScopeMark; value: string } | null = null;
let cancelled = false;

function Host({ sketch, measure, roomName = null }: { sketch: Sketch; measure: "wallRun" | "floorArea"; roomName?: string | null }) {
  const [initial] = useState<ScopeMark>(emptyScopeMark);
  return createElement(ScopeMarkPicker, {
    sketch,
    measure,
    title: "How much of the wall run is being cut?",
    roomName,
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

    /*
      The picker opens on the room the question is about.

      It used to open on the sketch's first room whatever was asked: from a demo run on a basement,
      "Add from sketch" on a Mechanical Room extraction question came up with the Rec Room tinted.
      The question's room is found the way its moisture map is (`matchRoomName`) and framed; a name
      the sketch does not have opens on the first room and the whole plan, as before.
    */
    await new Promise((r) => setTimeout(r, 50));
    const openOn = async (roomName: string) => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const r = createRoot(el);
      r.render(createElement(Host, { sketch: basement(), measure: "wallRun", roomName }));
      await new Promise((done) => setTimeout(done, 700));
      const s = Konva.stages[Konva.stages.length - 1];
      if (!s) throw new Error(`no stage for "${roomName}"`);
      return {
        stage: s,
        close: () => {
          r.unmount();
          el.remove();
        },
      };
    };

    const mech = await openOn("Mechanical Room");
    try {
      check(isSelectedAt(mech.stage, insideOf(MECH)), "a Mechanical Room question opens with the Mechanical Room selected");
      check(!isSelectedAt(mech.stage, insideOf(REC)), "and not the Rec Room drawn before it");

      const centre = mech.stage.getAbsoluteTransform().copy().point({
        x: MECH.x + (MECH.w * PIXELS_PER_FOOT) / 2,
        y: MECH.y + (MECH.d * PIXELS_PER_FOOT) / 2,
      });
      check(
        Math.abs(centre.x - mech.stage.width() / 2) < 1 && Math.abs(centre.y - mech.stage.height() / 2) < 1,
        `and framed on it: its centre at the canvas's (${Math.round(centre.x)}, ${Math.round(centre.y)} of ${mech.stage.width()} x ${mech.stage.height()})`,
      );

      // Zoomed in on, it still measures: its 10' top wall.
      used = null;
      gesturesFor(mech.stage).tap({ x: MECH.x + (MECH.w * PIXELS_PER_FOOT) / 2, y: MECH.y });
      await new Promise((r) => setTimeout(r, 200));
      check(findButton((t) => t === "Use 10 LF") !== null, `tapping its 10' wall totals 10 LF (saw "${findButton((t) => /^Use /.test(t))?.textContent?.trim()}")`);
    } finally {
      mech.close();
    }

    const garage = await openOn("Garage");
    try {
      check(isSelectedAt(garage.stage, insideOf(REC)), "a room the sketch does not have opens on the first room, as before");
      check(!isSelectedAt(garage.stage, insideOf(MECH)), "with nothing else selected");
      const corner = garage.stage.getAbsoluteTransform().copy().point({ x: REC.x, y: REC.y });
      check(Math.abs(corner.x - 30) < 1 && Math.abs(corner.y - 30) < 1, `and the whole plan framed from its top-left corner, as before (at ${Math.round(corner.x)}, ${Math.round(corner.y)})`);
    } finally {
      garage.close();
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
