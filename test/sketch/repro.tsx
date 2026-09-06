/**
 * A visual check of the reported cabinet, side by side with the drawing rule that produced it.
 *
 *   node test/sketch/repro.mjs        (serves on :4620)
 *
 * The placement checks prove the numbers. This proves the CANVAS uses them — a clamp that the
 * component does not read is worth nothing, and a picture is the only thing that can be compared
 * against the screenshot the report came with.
 *
 * Left is what the canvas draws today. Right is the same room and cabinet drawn the old way, from
 * the raw fraction, kept deliberately so the two can be looked at together.
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

/** A 12' x 12' room, and a 10'9" cabinet on its left wall pinned near the bottom corner. */
const room: SketchRoom = {
  id: "r",
  name: "Untitled room",
  vertices: [
    { id: "v0", x: 0, y: 0 },
    { id: "v1", x: 12 * FT, y: 0 },
    { id: "v2", x: 12 * FT, y: 12 * FT },
    { id: "v3", x: 0, y: 12 * FT },
  ],
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: null,
  nestingOptOut: false,
  symbols: [],
  freeCabinets: [],
};

// The left wall runs v3 -> v0, i.e. bottom to top on a clockwise polygon.
const leftWall = wallsOf(room)[3]!;

const cabinet = {
  id: "c",
  wallId: leftWall.id,
  t: 0.9,
  widthFraction: 0.5,
  widthFeet: 10.75,
  type: "cabinet",
  label: "Cabinet",
  tier: "base",
  depthFeet: 2,
  heightFeet: 3,
} as unknown as SketchSymbol;

const SCALE = 2;
const PAD = 30;

function Plan({ title, centrePx }: { title: string; centrePx: number }) {
  const width = symbolWidthPx(cabinet, room);
  const wall = leftWall;
  // The wall runs upward, so distance along it from its start corner goes from the bottom up.
  const along = (d: number) => ({ x: wall.x1, y: wall.y1 + ((wall.y2 - wall.y1) * d) / wall.lengthPx });
  const near = along(centrePx - width / 2);
  const far = along(centrePx + width / 2);
  const top = Math.min(near.y, far.y);
  const height = Math.abs(far.y - near.y);

  return (
    <div>
      <p style={{ font: "13px ui-monospace, monospace", margin: "0 0 6px" }}>{title}</p>
      <Stage width={12 * FT * SCALE + PAD * 2} height={26 * FT * SCALE + PAD * 2}>
        <Layer x={PAD} y={PAD} scaleX={SCALE} scaleY={SCALE}>
          {/* The room. */}
          <Line
            points={room.vertices.flatMap((v) => [v.x, v.y])}
            closed
            fill="#e8eef6"
            stroke="#1b3a5c"
            strokeWidth={3}
          />
          {/* The cabinet, drawn against the left wall and projecting into the room. */}
          <Rect x={wall.x1} y={top} width={2 * FT} height={height} fill="#dbe6f2" stroke="#1b3a5c" strokeWidth={1.5} />
          <Text x={wall.x1 + 4} y={top + 6} text="Cabinet" fontSize={9} fill="#1b3a5c" />
          <Text x={wall.x1 + 4} y={top + 18} text={`10'9" x 2'`} fontSize={8} fill="#5b6472" />
        </Layer>
      </Stage>
    </div>
  );
}

const results = {
  clamped: symbolCentrePx(cabinet, room),
  raw: cabinet.t * leftWall.lengthPx,
  wallLengthPx: leftWall.lengthPx,
  widthPx: symbolWidthPx(cabinet, room),
};
(window as unknown as { __repro: unknown }).__repro = {
  ...results,
  // Positive means it hangs past the corner and out of the room.
  overhangFeetNow: (results.clamped + results.widthPx / 2 - results.wallLengthPx) / FT,
  overhangFeetBefore: (results.raw + results.widthPx / 2 - results.wallLengthPx) / FT,
};

createRoot(document.getElementById("root")!).render(
  <div style={{ display: "flex", gap: 40, alignItems: "flex-start" }}>
    <Plan title="now — clamped to the wall" centrePx={results.clamped} />
    <Plan title="before — raw fraction" centrePx={results.raw} />
  </div>,
);
