/**
 * A picture of the two reported cabinets, each drawn the old way beside the new one.
 *
 *   node test/sketch/repro.mjs        (serves on :4620)
 *
 * The placement checks prove the numbers. This proves the numbers are the ones being DRAWN, and it
 * is the only thing that can be held up against the screenshots the reports came with. Three rounds
 * on this bug is enough to stop trusting a green suite on its own.
 *
 * Left of each pair is the drawing today. Right is the same room and cabinet placed the way the old
 * code placed it, which is what the reports show.
 */

import { createRoot } from "react-dom/client";
import { Stage, Layer, Line, Rect, Text } from "react-konva";
import {
  PIXELS_PER_FOOT,
  symbolCentrePx,
  symbolWidthPx,
  wallsOf,
  type SketchRoom,
  type SketchSymbol,
} from "@/lib/sketch";

const FT = PIXELS_PER_FOOT;
const SCALE = 1.6;
const PAD = 26;

function makeRoom(id: string, name: string, pts: [number, number][], parentRoomId: string | null = null): SketchRoom {
  return {
    id,
    name,
    vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
}

function makeCabinet(wallId: string, widthFeet: number, t: number): SketchSymbol {
  return {
    id: "c",
    wallId,
    t,
    widthFraction: 0.5,
    widthFeet,
    type: "cabinet",
    label: "Cabinet",
    tier: "base",
    depthFeet: 2,
    heightFeet: 3,
  } as unknown as SketchSymbol;
}

/* ── case 1: a wide cabinet pinned near a corner ──────────────────────────────────────────────── */

const plainRoom = makeRoom("plain", "Untitled room", [
  [0, 0],
  [12 * FT, 0],
  [12 * FT, 12 * FT],
  [0, 12 * FT],
]);
const plainWall = wallsOf(plainRoom)[3]!; // the left wall, running bottom to top
const wideCabinet = makeCabinet(plainWall.id, 10.75, 0.9);

/* ── case 2: a cabinet on a wall a sub-room is standing on ────────────────────────────────────── */

const parent = makeRoom("parent", "Untitled room", [
  [0, 0],
  [20 * FT, 0],
  [20 * FT, 20 * FT],
  [0, 20 * FT],
]);
const closet = makeRoom("closet", "Untitled room", [[0, 0], [8 * FT, 0], [8 * FT, 5 * FT], [0, 5 * FT]], "parent");
const parentWall = wallsOf(parent)[3]!;
// 10' of cabinet aimed at the top of the wall, where the closet is.
const closetCabinet = makeCabinet(parentWall.id, 10, 0.85);

/* ── drawing ──────────────────────────────────────────────────────────────────────────────────── */

function Plan({
  title,
  room,
  sub,
  symbol,
  centrePx,
  widthPx,
  size,
}: {
  title: string;
  room: SketchRoom;
  sub: SketchRoom | null;
  symbol: SketchSymbol;
  centrePx: number;
  widthPx: number;
  size: number;
}) {
  const wall = wallsOf(room).find((w) => w.id === symbol.wallId)!;
  // The wall runs upward, so distance from its start goes from the bottom of the drawing up.
  const at = (d: number) => wall.y1 + ((wall.y2 - wall.y1) * d) / wall.lengthPx;
  const a = at(centrePx - widthPx / 2);
  const b = at(centrePx + widthPx / 2);

  return (
    <div>
      <p style={{ font: "12px ui-monospace, monospace", margin: "0 0 6px", color: "#1b3a5c" }}>{title}</p>
      <Stage width={size * SCALE + PAD * 2} height={size * SCALE + PAD * 2}>
        <Layer x={PAD} y={PAD} scaleX={SCALE} scaleY={SCALE}>
          <Line points={room.vertices.flatMap((v) => [v.x, v.y])} closed fill="#eef2f6" stroke="#1b3a5c" strokeWidth={3} />
          {/* The cabinet, against the wall and projecting into the room. */}
          <Rect x={wall.x1} y={Math.min(a, b)} width={2 * FT} height={Math.abs(b - a)} fill="#dbe6f2" stroke="#1b3a5c" strokeWidth={1.5} />
          <Text x={wall.x1 + 4} y={Math.min(a, b) + 5} text="Cabinet" fontSize={8} fill="#1b3a5c" />
          {/*
            The sub-room LAST, exactly as the canvas draws it — after its parent, so it covers
            whatever is underneath. That painting order is why the old bug was invisible rather than
            merely wrong: the part of the cabinet inside the closet simply was not there to see.
          */}
          {sub && (
            <>
              <Line points={sub.vertices.flatMap((v) => [v.x, v.y])} closed fill="#e3e9f1" stroke="#1b3a5c" strokeWidth={3} />
              <Text x={sub.vertices[0]!.x + 8} y={sub.vertices[0]!.y + 20} text="Closet" fontSize={9} fill="#1b3a5c" />
            </>
          )}
        </Layer>
      </Stage>
    </div>
  );
}

const measured = {
  wideCabinet: {
    now: symbolCentrePx(wideCabinet, plainRoom),
    before: wideCabinet.t * plainWall.lengthPx,
    widthNow: symbolWidthPx(wideCabinet, plainRoom),
  },
  closetCabinet: {
    now: symbolCentrePx(closetCabinet, parent, [parent, closet]),
    widthNow: symbolWidthPx(closetCabinet, parent, [parent, closet]),
    before: closetCabinet.t * parentWall.lengthPx,
    widthBefore: closetCabinet.widthFeet! * FT,
  },
};

(window as unknown as { __repro: unknown }).__repro = {
  // Feet of cabinet outside the room, past the far corner.
  case1OverhangFeetBefore:
    (measured.wideCabinet.before + measured.wideCabinet.widthNow / 2 - plainWall.lengthPx) / FT,
  case1OverhangFeetNow: (measured.wideCabinet.now + measured.wideCabinet.widthNow / 2 - plainWall.lengthPx) / FT,
  // Feet of cabinet hidden behind the closet, which covers the last 5' of a 20' wall.
  case2HiddenFeetBefore: Math.max(
    0,
    measured.closetCabinet.before + measured.closetCabinet.widthBefore / 2 - (20 - 5) * FT,
  ) / FT,
  case2HiddenFeetNow: Math.max(0, measured.closetCabinet.now + measured.closetCabinet.widthNow / 2 - (20 - 5) * FT) / FT,
};

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "grid", gap: 28, font: "13px ui-monospace, monospace" }}>
    <div>
      <h2 style={{ font: "600 13px ui-monospace, monospace", margin: "0 0 10px" }}>
        1. a 10&#39;9&quot; cabinet pinned near the corner of a 12&#39; wall
      </h2>
      <div style={{ display: "flex", gap: 30 }}>
        <Plan title="now" room={plainRoom} sub={null} symbol={wideCabinet} centrePx={measured.wideCabinet.now} widthPx={measured.wideCabinet.widthNow} size={12 * FT} />
        <Plan title="before" room={plainRoom} sub={null} symbol={wideCabinet} centrePx={measured.wideCabinet.before} widthPx={measured.wideCabinet.widthNow} size={12 * FT} />
      </div>
    </div>
    <div>
      <h2 style={{ font: "600 13px ui-monospace, monospace", margin: "0 0 10px" }}>
        2. a 10&#39; cabinet on a wall a closet is standing on
      </h2>
      <div style={{ display: "flex", gap: 30 }}>
        <Plan title="now" room={parent} sub={closet} symbol={closetCabinet} centrePx={measured.closetCabinet.now} widthPx={measured.closetCabinet.widthNow} size={20 * FT} />
        <Plan title="before" room={parent} sub={closet} symbol={closetCabinet} centrePx={measured.closetCabinet.before} widthPx={measured.closetCabinet.widthBefore} size={20 * FT} />
      </div>
    </div>
  </div>,
);
