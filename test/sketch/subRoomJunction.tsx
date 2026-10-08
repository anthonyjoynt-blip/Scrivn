"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { type Sketch, type SketchRoom, pointOnWall, wallGripSpan, wallsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * A sub-room built in a room through the editor (2026-10-08, the owner: "trying to build a sub room with dragging walls is
 * still so painful. we need the walls to just snap and join together and move together as one wall"). The family room of
 * their pictures: its right-hand end a bump 12'4" x 10'11", and its bottom wall stepping 3" down 8" along from where the
 * bump begins. A sub-room is pulled down off the bump's top past its bottom, then its walls and corner are dragged.
 * `junctionWalls`, `cornerJunctionWalls` and the pull are pinned in rooms.mjs; this drives the editor's own gestures,
 * which is where the grip under the sub-room and the drag loops are. Travel-agnostic: how far a gesture lands is the
 * pane's, what goes with it is what is tested.
 */

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const room = (id: string, name: string, corners: [number, number][]): SketchRoom => ({
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
  vertices: corners.map(([x, y], i) => ({ id: `${id}-${i}`, x, y })),
});

function seed(): Sketch {
  return {
    rooms: [
      room("fam", "Family", [
        [0, 30],
        [180, 30],
        [180, 0],
        [328, 0],
        [328, 131],
        [188, 131],
        [188, 134],
        [0, 134],
      ]),
    ],
  };
}

let latestSketch: Sketch = seed();

function Host() {
  const [sketch, setSketch] = useState<Sketch>(seed);
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
  latestSketch = sketch;
  return createElement(SketchEditor, {
    sketch,
    knownRoomNames: [],
    moisture,
    onChange: setSketch,
    onMoistureChange: setMoisture,
    onClose: () => {},
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const byId = (id: string) => latestSketch.rooms.find((r) => r.id === id);
/** The x of a room's vertical walls right of x 300, one per wall. */
const rightXs = (r: SketchRoom | undefined) => (r ? wallsOf(r).filter((w) => Math.abs(w.x1 - w.x2) < 0.01 && w.x1 > 300).map((w) => w.x1) : []);

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  results.length = 0;
  const host = document.createElement("div");
  host.id = "sub-room-junction-host";
  document.body.appendChild(host);

  try {
    createRoot(host).render(createElement(Host));
    await wait(600);
    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);
    const scale = stage.scaleX();

    // Pull down off the bump's top, past its bottom: a rectangle, not the family room's 8" x 3" pocket traced.
    const pull = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Pull room");
    check(pull !== undefined, "the Pull room button is there");
    pull?.click();
    await wait(250);
    g.drag({ x: 254, y: 0 }, 0, 150 * scale);
    await wait(400);
    const sub = latestSketch.rooms.find((r) => r.id !== "fam");
    check(sub !== undefined && sub.vertices.length === 4, `the pulled sub-room is a rectangle (${sub?.vertices.length} corners)`);
    if (!sub) throw new Error("no sub-room");

    // Its right side dragged out: the family room's right wall goes with it.
    const subRight = wallsOf(sub).find((w) => Math.abs(w.x1 - 328) < 0.01 && Math.abs(w.x2 - 328) < 0.01);
    const span = subRight ? wallGripSpan(sub, subRight, latestSketch.rooms, scale) : null;
    check(span !== null, "the sub-room's right side has a grip");
    if (!subRight || !span) throw new Error("no grip");
    g.drag(pointOnWall(subRight, span.t), 12 * scale, 0);
    await wait(300);
    const [sx] = rightXs(byId(sub.id));
    const famXs = rightXs(byId("fam"));
    check(sx !== undefined && sx > 328.5, `the sub-room's side went out (x ${sx?.toFixed(1)})`);
    check(famXs.length === 1 && Math.abs((famXs[0] ?? NaN) - (sx ?? NaN)) < 0.5, `the family room's wall with it, one wall (x ${famXs.map((x) => x.toFixed(1)).join(", ")})`);

    // The family room's own grip on that wall stands clear of the sub-room drawn over it - covered end to end, it has
    // none. Its corner dragged, the family room's two walls go with it square.
    const fam = byId("fam");
    const famRight = fam ? wallsOf(fam).find((w) => Math.abs(w.x1 - w.x2) < 0.01 && w.x1 > 300) : undefined;
    check(!!fam && !!famRight && wallGripSpan(fam, famRight, latestSketch.rooms, scale) === null, "covered end to end by the sub-room, the family room's wall has no grip of its own to lose");
    const subNow = byId(sub.id);
    const corner = subNow?.vertices.find((v) => v.y < 1 && v.x > 300);
    if (corner) {
      g.tap({ x: 254, y: 65 });
      await wait(200);
      g.drag({ x: corner.x, y: corner.y }, 8 * scale, -6 * scale);
      await wait(300);
      const famAfter = byId("fam");
      const xs = rightXs(famAfter);
      const subXs = rightXs(byId(sub.id));
      const top = famAfter ? Math.min(...famAfter.vertices.map((v) => v.y)) : NaN;
      const subTop = Math.min(...(byId(sub.id)?.vertices.map((v) => v.y) ?? [NaN]));
      check(xs.length === 1 && subXs.length === 1 && Math.abs((xs[0] ?? NaN) - (subXs[0] ?? NaN)) < 0.5 && (xs[0] ?? 0) > (sx ?? Infinity) + 0.5, `the corner drag took the family room's right wall out square with the sub-room's (x ${xs.join(", ")} / ${subXs.join(", ")})`);
      check(top < -0.5 && Math.abs(top - subTop) < 0.5, `and its top up with the sub-room's (y ${top.toFixed(1)} / ${subTop.toFixed(1)})`);
    } else {
      check(false, "the sub-room has a top-right corner");
    }
  } catch (err) {
    check(false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    host.remove();
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results: [...results] };
}
