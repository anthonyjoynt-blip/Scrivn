"use client";

import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import Konva from "konva";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { type Sketch, type SketchRoom, pointOnWall, wallGripSpan, wallsOf } from "@/lib/sketch";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * A wall between two rooms dragged through the editor: the other room's face of the partition goes with it (2026-10-07,
 * the owner: "adjusting the closet only pulls the closet and leaves a gap from the office wall that stays behind"). The
 * office of the walk of 10:16, a closet 50" wide in its top-left corner a partition (4") off the office's step beside it;
 * the closet's right wall dragged toward the closet, then back out past where it began. `junctionWalls` is pinned in rooms.mjs; this
 * drives the editor's own drag loop, which is where the carried wall's obstacles and the end-of-drag snap are decided.
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
  const office = room("office", "Office", [
    [100, 124],
    [154, 124],
    [154, 100],
    [184, 100],
    [220, 136],
    [220, 284],
    [100, 284],
  ]);
  const closet = room("closet", "Closet", [
    [100, 96],
    [150, 96],
    [150, 120],
    [100, 120],
  ]);
  return { rooms: [office, closet] };
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

/** The x of a room's vertical wall between y 100 and 124 nearest [near]. */
function stepX(r: SketchRoom | undefined, near: number): number {
  if (!r) return NaN;
  const xs = wallsOf(r)
    .filter((w) => Math.abs(w.x1 - w.x2) < 0.01 && Math.min(w.y1, w.y2) < 122 && Math.max(w.y1, w.y2) > 98)
    .map((w) => w.x1);
  return xs.sort((a, b) => Math.abs(a - near) - Math.abs(b - near))[0] ?? NaN;
}

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  results.length = 0;
  const host = document.createElement("div");
  host.id = "wall-junction-host";
  document.body.appendChild(host);

  try {
    createRoot(host).render(createElement(Host));
    await new Promise((r) => setTimeout(r, 600));
    const stage = Konva.stages[Konva.stages.length - 1];
    check(stage !== undefined, "the canvas mounted");
    if (!stage) throw new Error("no stage");
    const g = gesturesFor(stage);

    // Select the closet by its body, so its wall grips are out.
    g.tap({ x: 125, y: 108 });
    await new Promise((r) => setTimeout(r, 250));
    const closet = latestSketch.rooms.find((r) => r.id === "closet");
    const right = closet ? wallsOf(closet).find((w) => Math.abs(w.x1 - 150) < 0.01 && Math.abs(w.x2 - 150) < 0.01) : undefined;
    const span = closet && right ? wallGripSpan(closet, right, latestSketch.rooms) : null;
    check(right !== undefined && span !== null, "the closet's right wall has a grip");
    if (!right || !span) throw new Error("no grip");

    // Toward the closet: the office's step follows, the partition stays 4". (How far the drag lands is the gesture's; the
    // carry is what is tested - the travel itself is wallDragSnap's.)
    g.drag(pointOnWall(right, span.t), -6, 0);
    await new Promise((r) => setTimeout(r, 300));
    const cx = stepX(latestSketch.rooms.find((r) => r.id === "closet"), 147);
    const ox = stepX(latestSketch.rooms.find((r) => r.id === "office"), 151);
    check(cx < 149.5, `the closet's wall went toward the closet (x ${cx.toFixed(1)}, from 150)`);
    check(ox < 153.5, `the office's step went with it, no gap left behind (x ${ox.toFixed(1)}, from 154)`);
    check(Math.abs(ox - cx - 4) < 0.5, `the partition is still 4 in (${(ox - cx).toFixed(1)})`);

    // And 10" back out, past where it began: the office's step goes ahead of it, not in its way.
    const closet2 = latestSketch.rooms.find((r) => r.id === "closet");
    const right2 = closet2 ? wallsOf(closet2).find((w) => Math.abs(w.x1 - cx) < 0.01 && Math.abs(w.x2 - cx) < 0.01) : undefined;
    const span2 = closet2 && right2 ? wallGripSpan(closet2, right2, latestSketch.rooms) : null;
    if (right2 && span2) {
      g.drag(pointOnWall(right2, span2.t), 10, 0);
      await new Promise((r) => setTimeout(r, 300));
      const cx2 = stepX(latestSketch.rooms.find((r) => r.id === "closet"), cx + 8);
      const ox2 = stepX(latestSketch.rooms.find((r) => r.id === "office"), cx + 12);
      check(cx2 > 150.5, `out again past where it began (x ${cx2.toFixed(1)})`);
      check(Math.abs(ox2 - cx2 - 4) < 0.5, `and the office's step a partition ahead of it (${(ox2 - cx2).toFixed(1)})`);
    } else {
      check(false, "the closet's moved wall has a grip");
    }
  } catch (err) {
    check(false, `threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    host.remove();
  }
  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results: [...results] };
}
