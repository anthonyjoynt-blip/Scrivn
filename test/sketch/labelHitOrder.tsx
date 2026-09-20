"use client";

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import Konva from "konva";
import SketchCanvas from "@/components/sketch/SketchCanvas";
import {
  PIXELS_PER_FOOT,
  ensureClockwise,
  newSymbol,
  pointOnWall,
  rectangleVertices,
  roomLabelAnchor,
  wallGripSpan,
  wallsOf,
  type SketchRoom,
  type SketchSymbol,
} from "@/lib/sketch";
import { emptyMoistureMap } from "@/lib/moisture";
import { gesturesFor } from "./gestures";

/**
 * Regression tests for the room name's place in the PAINT order versus its place in the HIT order.
 *
 * The name is drawn in a label pass after every room, so it reads over a tub or a door swing; the
 * source rule in labelRules.mjs holds that. But the first version of that pass took the name's tap
 * target — an invisible 120px x 22px rect — up with it, and Konva hit-tests topmost-first, so the
 * rect then sat over everything the name covers and took its taps: the tub's edge, a vanity's front,
 * a kitchen island, and on a hall narrower than 120px the selected room's own wall grips. Pulling a
 * hall's wall in from 4'11" to 3'2" moved the hall instead. The rect belongs back inside RoomShape,
 * under all of those, and this suite is what says so.
 *
 * Two rooms from the field, at their taped sizes: a 3'2" x 3'9" hall — narrower than the rect, so
 * both side-wall grips fall inside the name band — and an 8'3" x 5' bathroom with a tub on the long
 * wall, whose inner edge runs exactly through the name's anchor. Both sit inside the name band that
 * a hoisted rect would have owned. Every assertion is the same shape as dragGestures: after a
 * gesture, WHICH callbacks fired.
 */

interface Call {
  name: string;
  args: unknown[];
}

const results: { ok: boolean; message: string }[] = [];
function check(ok: boolean, message: string) {
  results.push({ ok, message });
}

const named = (calls: Call[], name: string) => calls.filter((c) => c.name === name);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A rectangular room at its taped size, in feet, with the full shape a saved room carries. */
function taped(id: string, name: string, x: number, y: number, widthFt: number, depthFt: number, extra: Partial<SketchRoom> = {}): SketchRoom {
  return {
    id,
    name,
    vertices: ensureClockwise(rectangleVertices(x, y, widthFt * PIXELS_PER_FOOT, depthFt * PIXELS_PER_FOOT)),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    ...extra,
  };
}

/** Mounts the real canvas with these rooms, one selected, and records every callback it fires. */
function mount(rooms: SketchRoom[], selectedRoomId: string) {
  const host = document.getElementById("stage") ?? document.body.appendChild(document.createElement("div"));
  const calls: Call[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
    };

  createRoot(host).render(
    createElement(SketchCanvas, {
      rooms,
      width: 700,
      height: 460,
      view: { x: 0, y: 0, scale: 1 },
      tool: "select" as const,
      showSizes: false,
      moisture: emptyMoistureMap(),
      showMoisture: false,
      moistureTool: null,
      paintSurface: "floor" as const,
      selectedReadingId: null,
      onTapWallForReading: record("onTapWallForReading"),
      onSelectReading: record("onSelectReading"),
      onResizeReading: record("onResizeReading"),
      onPaintFloor: record("onPaintFloor"),
      selectedRoomId,
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
    }),
  );

  return {
    calls,
    // Resolved lazily: React renders asynchronously, so no stage exists at the moment this returns.
    stage: () => {
      const stage = Konva.stages[Konva.stages.length - 1];
      if (!stage) throw new Error("SketchCanvas did not create a stage");
      return stage;
    },
    reset: () => (calls.length = 0),
  };
}

/**
 * Every node of the stage in the order Konva paints it: depth first, children after their parent.
 *
 * Not `getAbsoluteZIndex()`, which counts level by level and so cannot rank two nodes at different
 * depths against each other — and a name in the label pass is shallower than a tub's pad inside its
 * wall group.
 */
function paintOrder(stage: Konva.Stage): Konva.Node[] {
  const out: Konva.Node[] = [];
  const walk = (node: Konva.Node) => {
    out.push(node);
    if (node instanceof Konva.Container) node.getChildren().forEach(walk);
  };
  walk(stage);
  return out;
}

/** The topmost listening shape under a world point, after the hit canvas is brought up to date. */
function topShapeAt(stage: Konva.Stage, world: { x: number; y: number }): Konva.Shape | null {
  // The page may be hidden while these run, and Konva repaints in requestAnimationFrame — see the
  // note in gestures.ts. drawHit is synchronous.
  stage.getLayers().forEach((layer) => layer.drawHit());
  const screen = stage.getAbsoluteTransform().copy().point(world);
  return stage.getIntersection(screen);
}

export async function run(): Promise<{ passed: number; failed: number; results: typeof results }> {
  // The hall, as taped: 3'2" x 3'9", selected so its grips are out. 38px wide against a 120px band.
  const hall = taped("hall", "Hall", 100, 100, 3 + 2 / 12, 3 + 9 / 12);

  // The bathroom, as taped: 8'3" x 5', with a 5' tub against the long top wall. The tub is 2'6"
  // deep, so its inner edge runs through the very middle of the room — where the name is.
  const bathShell = taped("bath", "Bathroom", 300, 100, 8 + 3 / 12, 5);
  const topWall = wallsOf(bathShell).reduce((a, b) => (b.lengthPx > a.lengthPx ? b : a));
  const placed = newSymbol("fixture", topWall.id, 0.5, bathShell);
  if (placed.type !== "fixture") throw new Error("newSymbol did not make a fixture");
  const tub: SketchSymbol = { ...placed, id: "tub", fixtureType: "tub", widthFeet: 5, depthFeet: 2.5 };
  const bath: SketchRoom = { ...bathShell, symbols: [tub] };

  const { calls, stage, reset } = mount([hall, bath], hall.id);
  await sleep(150);

  const g = gesturesFor(stage());
  const hallAnchor = roomLabelAnchor(hall);
  const bathAnchor = roomLabelAnchor(bath);

  // The probe over the tub: 5px above the anchor, so inside the 22px name band and inside the tub's
  // pad, but off the tub's inner edge, which runs exactly through the anchor.
  const onTub = { x: bathAnchor.x, y: bathAnchor.y - 5 };

  // ── 1. The name is painted above the tub, whatever the hit order says ───────────────────────────
  const nameNode = stage()
    .find("Text")
    .find((n) => (n as Konva.Text).text() === "Bathroom");
  const tubPad = stage()
    .find("Rect")
    .filter((n) => n.opacity() === 0 && n.draggable())
    .find((n) => {
      const box = n.getClientRect();
      return box.x < onTub.x && box.x + box.width > onTub.x && box.y < onTub.y && box.y + box.height > onTub.y;
    });
  check(nameNode !== undefined, "the bathroom's name is drawn");
  check(tubPad !== undefined, "the tub's hit pad reaches into the name band — the fixture really is under the name");
  const order = paintOrder(stage());
  check(
    nameNode !== undefined && tubPad !== undefined && order.indexOf(nameNode) > order.indexOf(tubPad),
    "the name paints ABOVE the tub (label pass after the rooms)",
  );

  // ── 2. ...but a tap on the tub, inside the name band, is still a tap on the tub ─────────────────
  const under = topShapeAt(stage(), onTub);
  check(under !== null && under.draggable(), `the topmost shape under the name band over the tub is the tub's pad (got ${under?.className ?? "nothing"}, draggable=${under?.draggable()})`);
  reset();
  g.tap(onTub);
  check(
    named(calls, "onSelectSymbol").length === 1 && named(calls, "onSelectSymbol")[0]?.args[0] === "tub",
    `tapping the tub under the name selects the tub (onSelectSymbol got ${JSON.stringify(named(calls, "onSelectSymbol").map((c) => c.args))})`,
  );

  // ── 3. A hall narrower than the name band keeps both side-wall grips ───────────────────────────
  const hallWalls = wallsOf(hall);
  const sideWalls = hallWalls.filter((w) => Math.abs(w.x1 - w.x2) < 0.5);
  check(sideWalls.length === 2, "the hall has two vertical side walls");
  for (const wall of sideWalls) {
    const span = wallGripSpan(hall, wall, [hall, bath]);
    if (!span) {
      check(false, "a hall side wall has no grip span — the fixture or wallGripSpan changed");
      continue;
    }
    const grip = pointOnWall(wall, span.t);
    const side = wall.x1 < hallAnchor.x ? "left" : "right";
    check(
      Math.abs(grip.y - hallAnchor.y) < 11,
      `the ${side} grip sits inside the name band (${Math.abs(grip.y - hallAnchor.y).toFixed(1)}px off the anchor)`,
    );
    const top = topShapeAt(stage(), grip);
    check(top?.className === "Circle", `the topmost shape at the ${side} wall grip is the grip itself (got ${top?.className ?? "nothing"})`);

    reset();
    g.drag(grip, side === "left" ? -12 : 12, 0);
    check(named(calls, "onDragWall").length > 0, `pulling the ${side} grip pulls the wall`);
    check(
      named(calls, "onMoveRoom").length === 0,
      `pulling the ${side} grip must not move the hall (got ${JSON.stringify(named(calls, "onMoveRoom").map((m) => m.args.slice(1)))})`,
    );
  }

  // ── 4. The name band itself still does what it did: select on one tap, move on a drag ──────────
  reset();
  g.tap(hallAnchor);
  check(named(calls, "onSelectRoom").some((c) => c.args[0] === "hall"), "a tap on the hall's name selects the hall");
  check(named(calls, "onSelectSymbol").length === 0, "a tap on the hall's name selects no symbol");

  reset();
  g.drag(hallAnchor, 40, 25);
  const moves = named(calls, "onMoveRoom");
  check(
    moves.length === 1 && Math.round(moves[0]?.args[1] as number) === 40 && Math.round(moves[0]?.args[2] as number) === 25,
    `a drag from the hall's name moves the hall once, by the drag (got ${JSON.stringify(moves.map((m) => m.args.slice(1)))})`,
  );
  check(named(calls, "onDragWall").length === 0, "a drag from the name pulls no wall");

  // ── 5. Two taps on the name still rename it ────────────────────────────────────────────────────
  // Konva makes the double-click itself from two taps inside dblClickWindow on the same shape, so
  // first let the window from the taps above close.
  await sleep(Konva.dblClickWindow + 50);
  reset();
  g.tap(hallAnchor);
  g.tap(hallAnchor);
  check(named(calls, "onRenameRoom").length === 1 && named(calls, "onRenameRoom")[0]?.args[0] === "hall", "two taps on the hall's name open the rename");

  // ── 6. A hidden name keeps its tap target ──────────────────────────────────────────────────────
  const shy = mount([{ ...hall, id: "shy", name: "Hall", labelHidden: true }], "shy");
  await sleep(150);
  const shyStage = shy.stage();
  const drawn = shyStage.find("Text").some((n) => (n as Konva.Text).text() === "Hall");
  check(!drawn, "a hidden name is not drawn");
  const gs = gesturesFor(shyStage);
  await sleep(Konva.dblClickWindow + 50);
  shy.reset();
  gs.tap(hallAnchor);
  check(named(shy.calls, "onSelectRoom").some((c) => c.args[0] === "shy"), "a tap where the hidden name was still selects the room");
  gs.tap(hallAnchor);
  check(named(shy.calls, "onRenameRoom").length === 1, "a second tap where the hidden name was still opens the rename");

  const failed = results.filter((r) => !r.ok).length;
  return { passed: results.length - failed, failed, results };
}
