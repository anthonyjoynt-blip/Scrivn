"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { type Sketch, type SketchRoom, pointOnWall, wallGripSpan, wallsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * A wall widened into another room's angled wall, through the editor's own drag loop.
 *
 * From the field, with pictures: a room pulled down off a horizontal wall, then its right grip
 * pulled a hair — and on release the room "popped up angled and overlapped the door and existing
 * wall". The reshape itself was right (the side follows the angled wall for a sliver, then drops);
 * what went wrong was the editor's end-of-drag snap, applied by the dragged wall's id, which after
 * the reshape named that sliver. Snapping the sliver to the room's own corners slid it off the
 * angled wall and pulled the top wall up askew with it. The lib suite pins the mechanism; this
 * drives the editor, because the decision to snap is the editor's.
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

/** The pulled room, 7'2" wide, and the neighbour whose angled wall sets off from its top-right corner. */
function seed(): Sketch {
  const pulled = room("pulled", "Room 1", [
    [85, 60],
    [258, 60],
    [258, 305],
    [85, 305],
  ]);
  const neighbour = room("main", "Main", [
    [258, 60],
    [400, 60],
    [400, 130],
    [320, 130],
  ]);
  return { rooms: [pulled, neighbour] };
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

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  results.length = 0;
  const host = document.createElement("div");
  host.id = "wall-drag-snap-host";
  document.body.appendChild(host);

  try {
    createRoot(host).render(createElement(Host));
    await new Promise((r) => setTimeout(r, 600));

    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);

    // Select the pulled room by its body, so its wall grips are out.
    g.tap({ x: 170, y: 180 });
    await new Promise((r) => setTimeout(r, 250));

    const pulled = latestSketch.rooms.find((r) => r.id === "pulled");
    const right = pulled ? wallsOf(pulled)[1] : undefined; // (258,60) -> (258,305)
    const span = pulled && right ? wallGripSpan(pulled, right, latestSketch.rooms) : null;
    check(right !== undefined && span !== null, "the right wall has a grip");
    if (!right || !span) throw new Error("no grip");

    // The report: the right grip pulled a hair — 7px — into the angled wall.
    g.drag(pointOnWall(right, span.t), 7, 0);
    await new Promise((r) => setTimeout(r, 300));

    const after = latestSketch.rooms.find((r) => r.id === "pulled");
    check(after !== undefined, "the room is still there");
    if (!after) throw new Error("room gone");
    const top = wallsOf(after)[0];
    check(top !== undefined && Math.abs(top.y1 - 60) < 0.01 && Math.abs(top.y2 - 60) < 0.01, `the top wall stays level on release (y ${top?.y1.toFixed(1)} -> ${top?.y2.toFixed(1)})`);
    const corners = after.vertices.map((v) => `${Math.round(v.x)},${Math.round(v.y)}`).join(" ");
    check(after.vertices.length === 5, `the side follows the angled wall for a sliver, then drops: five corners (${corners})`);
    // The sliver lies ON the angled wall (258,60)->(320,130), not beside it.
    const onAngled = after.vertices.every((v) => {
      if (v.x < 258.5) return true;
      const expectY = 60 + ((v.x - 258) * 70) / 62;
      return Math.abs(v.y - expectY) < 1 || v.y > 200;
    });
    check(onAngled, `every corner past the old right wall sits on the angled wall or the far side (${corners})`);
    const maxX = Math.max(...after.vertices.map((v) => v.x));
    check(Math.abs(maxX - 265) < 1.5, `and the far side is 7px out, where the finger stopped (max x ${maxX.toFixed(1)})`);
  } catch (err) {
    check(false, `wall-drag snap suite threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    host.remove();
  }

  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
