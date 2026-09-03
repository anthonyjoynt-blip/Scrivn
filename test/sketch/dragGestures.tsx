"use client";

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import Konva from "konva";
import SketchCanvas from "@/components/sketch/SketchCanvas";
import {
  PIXELS_PER_FOOT,
  newStairRoom,
  pointOnWall,
  roomLabelAnchor,
  wallGripSpan,
  wallsOf,
  type SketchRoom,
} from "@/lib/sketch";
import { emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * Regression tests for dragging on the sketch canvas.
 *
 * These drive the REAL `SketchCanvas`, not a stand-in built to look like it. Every bug they cover
 * lived in Konva's event plumbing — which node claims a gesture, what bubbles past it — so a replica
 * of the component's node tree would have kept passing while the component itself broke. The cost is
 * that this needs a browser; see `run.mjs`.
 *
 * What they exist to catch, all three shipped at least once:
 *
 *   1. A shallow room could not be dragged at all. Wall tap-strips are `HIT.wall` (28px) wide, so on
 *      a 3' stair flight (36px deep) the two long walls' strips cover every pixel of the room, and
 *      each one cancelled the gesture. Dragging worked or not depending on where you grabbed.
 *
 *   2. Resizing threw the room off screen. Konva bubbles `dragend`, so releasing a corner also ran
 *      the room group's handler with the CORNER as `e.target`; its coordinates were then read as a
 *      translation and the room leapt by its distance from the origin.
 *
 *   3. A handle both resized and moved at once, when it failed to cancel the bubble.
 *
 * The shape of every assertion is the same: after a gesture, WHICH callbacks fired, and with what.
 * The room fixture is deliberately static — nothing here re-renders in response to a callback — so a
 * repeated gesture must give a repeated result, which is what "sometimes it works" failed to do.
 */

interface Call {
  name: string;
  args: unknown[];
}

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const STAGE_WIDTH = 700;
const STAGE_HEIGHT = 460;

/**
 * Mounts the real canvas with one room and returns a recorder for every callback it fires.
 *
 * The stage is resolved lazily rather than returned: React renders asynchronously, so at the moment
 * this returns, `SketchCanvas` has not created a stage yet.
 */
function mount(room: SketchRoom): { calls: Call[]; stage: () => Konva.Stage; reset: () => void } {
  // Render into the page's own container so its CSS applies — gestures convert world coordinates
  // through the stage's bounding box, so where it sits on the page has to be predictable.
  const host = document.getElementById("stage") ?? document.body.appendChild(document.createElement("div"));

  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };

  const props = {
    rooms: [room],
    width: STAGE_WIDTH,
    height: STAGE_HEIGHT,
    view: { x: 0, y: 0, scale: 1 },
    tool: "select" as const,
    showSizes: false,
    // Moisture mapping is off here: these tests are about the sketching gestures.
    moisture: emptyMoistureMap(),
    showMoisture: false,
    moistureTool: null,
    paintSurface: "floor" as const,
    selectedReadingId: null,
    onTapWallForReading: record("onTapWallForReading"),
    onSelectReading: record("onSelectReading"),
    onResizeReading: record("onResizeReading"),
    onPaintFloor: record("onPaintFloor"),
    selectedRoomId: room.id,
    selectedSymbolId: null,
    onViewChange: record("onViewChange"),
    onSelectRoom: record("onSelectRoom"),
    onSelectSymbol: record("onSelectSymbol"),
    onMoveRoom: record("onMoveRoom"),
    onTapWall: record("onTapWall"),
    onPlaceSymbol: record("onPlaceSymbol"),
    onSplitWall: record("onSplitWall"),
    onDragWall: record("onDragWall"),
    onDragWallEnd: record("onDragWallEnd"),
    onRenameRoom: record("onRenameRoom"),
    onMoveVertex: record("onMoveVertex"),
    onRemoveVertex: record("onRemoveVertex"),
    onMoveSymbol: record("onMoveSymbol"),
    onResizeSymbol: record("onResizeSymbol"),
    onPlaceIsland: record("onPlaceIsland"),
    onMoveIsland: record("onMoveIsland"),
    onResizeIsland: record("onResizeIsland"),
  };

  createRoot(host).render(createElement(SketchCanvas, props));

  return {
    calls,
    stage: () => {
      const stage = Konva.stages[Konva.stages.length - 1];
      if (!stage) throw new Error("SketchCanvas did not create a stage");
      return stage;
    },
    reset: () => (calls.length = 0),
  };
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  // The room that could not be dragged: an 11' x 3' flight, well clear of the stage edges.
  const room = newStairRoom(120, 140);
  const { calls, stage, reset } = mount(room);
  // React renders into the DOM asynchronously; the stage does not exist until it has.
  await new Promise((r) => setTimeout(r, 150));

  const g = gesturesFor(stage());
  const walls = wallsOf(room);
  const anchor = roomLabelAnchor(room);
  const [topLeft, , bottomRight] = room.vertices;
  if (!topLeft || !bottomRight) throw new Error("stair room is not a rectangle");

  // Probe points are DERIVED, never hardcoded, so the tests follow the fixture if it ever changes.
  const longWall = walls.reduce((a, b) => (b.lengthPx > a.lengthPx ? b : a));
  const gripSpan = wallGripSpan(room, longWall);
  const gripPoint = gripSpan ? pointOnWall(longWall, gripSpan.t) : null;
  const mid = { x: (topLeft.x + bottomRight.x) / 2, y: (topLeft.y + bottomRight.y) / 2 };

  const onBody: [string, { x: number; y: number }][] = [
    ["the centre", mid],
    ["the room name", { x: anchor.x - 20, y: anchor.y }],
    ["the top wall", { x: topLeft.x + 30, y: topLeft.y + 1 }],
    ["the bottom wall", { x: bottomRight.x - 30, y: bottomRight.y - 1 }],
    ["the left end", { x: topLeft.x + 6, y: mid.y }],
    ["the right end", { x: bottomRight.x - 6, y: mid.y }],
  ];

  // ── 1. Every part of a shallow room that is not a handle must move it ──────────────────────────
  for (const [label, point] of onBody) {
    reset();
    g.drag(point, 40, 25);
    const moves = named(calls, "onMoveRoom");
    const first = moves[0];
    check(
      moves.length === 1 && Math.round(first?.args[1] as number) === 40 && Math.round(first?.args[2] as number) === 25,
      `drag from ${label} moves the room (got ${JSON.stringify(moves.map((m) => m.args.slice(1)))})`,
    );
  }

  // ── 2. Resizing by a corner must not move the room ─────────────────────────────────────────────
  reset();
  g.drag({ x: bottomRight.x, y: bottomRight.y }, 30, 20);
  check(named(calls, "onMoveVertex").length > 0, "dragging a corner resizes the room");
  check(
    named(calls, "onMoveRoom").length === 0,
    `dragging a corner must not also move the room (got ${JSON.stringify(named(calls, "onMoveRoom").map((m) => m.args.slice(1)))})`,
  );

  // ── 3. A wall grip pulls its wall, and only its wall ───────────────────────────────────────────
  if (gripPoint) {
    reset();
    g.drag(gripPoint, 0, 24);
    check(named(calls, "onDragWall").length > 0, "the wall grip pulls its wall");
    check(named(calls, "onDragWallEnd").length === 1, "the wall drag ends exactly once, so snapping runs once");
    check(
      named(calls, "onMoveRoom").length === 0,
      `the wall grip must not also move the room (got ${JSON.stringify(named(calls, "onMoveRoom").map((m) => m.args.slice(1)))})`,
    );
  } else {
    check(false, "the long wall has no grip span — the fixture or wallGripSpan changed");
  }

  // ── 4. It has to keep working. The original report was "sometimes it works" ────────────────────
  let repeats = 0;
  for (let i = 0; i < 12; i++) {
    const probe = onBody[i % onBody.length];
    if (!probe) continue;
    reset();
    g.drag(probe[1], 40, 25);
    const first = named(calls, "onMoveRoom")[0];
    if (first && Math.round(first.args[1] as number) === 40) repeats++;
  }
  check(repeats === 12, `12 drags in a row all move the room (${repeats}/12)`);

  // ── 5. A resize must not poison the gesture after it ───────────────────────────────────────────
  g.drag({ x: bottomRight.x, y: bottomRight.y }, 30, 20);
  reset();
  const after = onBody[0];
  if (after) {
    g.drag(after[1], 40, 25);
    check(
      named(calls, "onMoveRoom").length === 1,
      `a resize does not disturb the next move (got ${JSON.stringify(named(calls, "onMoveRoom").map((m) => m.args.slice(1)))})`,
    );
  }

  // ── 6. A tap is still a tap — selecting must not be swallowed by the drag ──────────────────────
  reset();
  g.tap({ x: topLeft.x + 30, y: topLeft.y + 1 });
  check(named(calls, "onSelectRoom").length > 0, "tapping a wall still selects the room");
  check(named(calls, "onMoveRoom").length === 0, "a tap with no movement does not move the room");

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
