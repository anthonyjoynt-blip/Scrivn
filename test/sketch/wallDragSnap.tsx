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
 *
 * The same host then takes the other two wall gestures that live in the canvas and land in the
 * editor: a pull INTO a room (a closet off a wall, the finger going in), and placing a door by a
 * tap (standard width) or by a drag along the wall (as wide as the drag); and a pull OUT of a
 * room, which starts a wall beyond the wall and ends under the finger, the outline shown while the
 * finger is down being the room that lands.
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

function findButton(label: string): HTMLButtonElement | null {
  return ([...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined) ?? null;
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

    // ── Pulling INTO a room: a closet off its bottom wall, the finger going up ───────────────
    const pullButton = findButton("Pull room");
    check(pullButton !== null, "the editor offers the pull tool");
    pullButton?.click();
    await new Promise((r) => setTimeout(r, 200));
    const before = latestSketch.rooms.length;
    g.drag({ x: 170, y: 305 }, 0, -40); // the room's bottom wall, dragged up into the room
    await new Promise((r) => setTimeout(r, 300));
    const closet = latestSketch.rooms.find((r) => !["pulled", "main"].includes(r.id));
    check(latestSketch.rooms.length === before + 1 && closet !== undefined, "an inward pull makes a room");
    if (closet) {
      const xs = closet.vertices.map((v) => v.x);
      const ys = closet.vertices.map((v) => v.y);
      const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      check(Math.abs(box.maxY - 305) < 0.5 && Math.abs(box.minY - 265) < 1.5 && Math.abs(box.minX - 85) < 0.5 && Math.abs(box.maxX - 265) < 1.5, `inside the room, 40px deep off its bottom wall (${JSON.stringify(box)})`);
      check(closet.parentRoomId === "pulled", `and the room's sub-room at once (parent ${closet.parentRoomId})`);
      check(closet.name === "Room 2", `named on from the plan (${closet.name})`);
    }

    // ── Placing a door: a tap drops the standard width, a drag along the wall draws the width ──
    const roomNow = latestSketch.rooms.find((r) => r.id === "pulled");
    const left = roomNow ? wallsOf(roomNow).find((w) => Math.abs(w.x1 - 85) < 0.5 && Math.abs(w.x2 - 85) < 0.5) : undefined;
    check(left !== undefined, "the room's left wall is there to put doors in");
    if (left) {
      findButton("Door")?.click();
      await new Promise((r) => setTimeout(r, 200));
      g.tap({ x: 85, y: 150 });
      await new Promise((r) => setTimeout(r, 300));
      const tapped = latestSketch.rooms.find((r) => r.id === "pulled")?.symbols ?? [];
      check(tapped.length === 1 && tapped[0]?.type === "door", `a tap on the wall drops a door (${tapped.length} symbols)`);
      check(tapped[0] !== undefined && Math.abs((tapped[0].widthFeet ?? 0) - 2.5) < 0.01, `at the standard width (${tapped[0]?.widthFeet}')`);
      const tappedAt = tapped[0] ? pointOnWall(left, tapped[0].t) : null;
      check(tappedAt !== null && Math.abs(tappedAt.y - 150) < 1, `where the finger was (y ${tappedAt?.y.toFixed(1)})`);

      findButton("Door")?.click();
      await new Promise((r) => setTimeout(r, 200));
      g.drag({ x: 85, y: 200 }, 0, 48); // along the wall, 4'
      await new Promise((r) => setTimeout(r, 300));
      const symbols = latestSketch.rooms.find((r) => r.id === "pulled")?.symbols ?? [];
      const drawn = symbols[1];
      check(symbols.length === 2 && drawn?.type === "door", `a drag along the wall drops a second door (${symbols.length} symbols)`);
      check(drawn !== undefined && Math.abs((drawn.widthFeet ?? 0) - 4) < 0.05, `as wide as the drag: 4' (${drawn?.widthFeet}')`);
      const drawnAt = drawn ? pointOnWall(left, drawn.t) : null;
      check(drawnAt !== null && Math.abs(drawnAt.y - 224) < 1.5, `centred on the drag (y ${drawnAt?.y.toFixed(1)})`);
    }

    // ── Pulling OUT of a room: the next room over, a wall beyond the wall ────────────────────
    // Up off the room's top wall (y 60), the finger 64 above it. Pulled flush, as it was until
    // 2026-09-26, the wall between the two rooms was drawn over the new one's floor: "Pulling a
    // room off a wall still creates it flush." Now the room starts a wall (4px) above the wall and
    // ends under the finger - and the outline followed on the way is that room, corner for corner.
    findButton("Pull room")?.click();
    await new Promise((r) => setTimeout(r, 200));
    const count = latestSketch.rooms.length;
    const release = g.hold({ x: 170, y: 60 }, 0, -64);
    const fingerY = stage.getRelativePointerPosition()?.y ?? Number.NaN;
    const outline = stage.find("Line").find((node) => {
      const line = node as Konva.Line;
      return line.closed() && line.dash().length > 0 && line.points().length >= 6;
    }) as Konva.Line | undefined;
    const shown = outline ? outline.points() : [];
    release();
    await new Promise((r) => setTimeout(r, 300));
    const out = latestSketch.rooms.find((r) => !["pulled", "main"].includes(r.id) && r.id !== closet?.id);
    check(latestSketch.rooms.length === count + 1 && out !== undefined, "an outward pull makes a room");
    if (out) {
      const xs = out.vertices.map((v) => v.x);
      const ys = out.vertices.map((v) => v.y);
      const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
      check(Math.abs(box.maxY - 56) < 0.01 && Math.abs(box.minX - 85) < 0.01 && Math.abs(box.maxX - 258) < 0.01, `a wall above the top wall, its whole length (${JSON.stringify(box)})`);
      check(Math.abs(box.minY - fingerY) < 0.5, `and up to the finger (y ${box.minY.toFixed(1)}, finger ${fingerY.toFixed(1)})`);
      const corners = (points: number[]) => {
        const list: string[] = [];
        for (let i = 0; i + 1 < points.length; i += 2) list.push(`${(points[i] as number).toFixed(1)},${(points[i + 1] as number).toFixed(1)}`);
        return list.sort().join(" ");
      };
      const made = corners(out.vertices.flatMap((v) => [v.x, v.y]));
      check(corners(shown) === made, `the outline shown while pulling is the room made (${corners(shown)} / ${made})`);
    }
  } catch (err) {
    check(false, `wall-drag snap suite threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    host.remove();
  }

  return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
