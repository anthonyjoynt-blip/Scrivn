/**
 * The editor at phone size, with a sketch worth looking at: the bottom bar, More, and the
 * properties sheet — see the phone layout in `lib/sketchTouch.ts` and `.sketch-card-phone`.
 *
 *   node test/sketch/touchRepro.mjs        (serves on :4622)
 *
 * Seeded with the kitchen's leaning jog from room_20260922_201320 as well, which is the case
 * Square up exists for — see lib/sketchSquare.ts.
 *
 * Held open at 375 x 812 with a coarse pointer, which is what `PHONE_LAYOUT_QUERY` asks about.
 */

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { emptyMoistureMap } from "@/lib/moisture";
import { PIXELS_PER_FOOT, type Sketch, type SketchRoom } from "@/lib/sketch";

const FT = PIXELS_PER_FOOT;

function makeRoom(id: string, name: string, x: number, y: number, w: number, h: number, level: number): SketchRoom {
  const pts: [number, number][] = [
    [x, y],
    [x + w * FT, y],
    [x + w * FT, y + h * FT],
    [x, y + h * FT],
  ];
  return {
    id,
    name,
    level,
    vertices: pts.map(([vx, vy], i) => ({ id: `${id}-v${i}`, x: vx, y: vy })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
  };
}

/** A base run of [widthFeet] whose middle sits at [t] along wall [wall] of [room]. */
function cabinet(id: string, room: SketchRoom, wall: number, t: number, widthFeet: number) {
  return {
    id,
    wallId: room.vertices[wall]!.id,
    t,
    widthFraction: 0.3,
    widthFeet,
    type: "cabinet" as const,
    label: "Cabinet",
    tier: "base" as const,
    depthFeet: 2,
    heightFeet: 3,
  };
}

/**
 * The kitchen's jog from room_20260922_201320, to scale: two parallel walls joined by a diagonal
 * that should be perpendicular. Square up is the fix — see lib/sketchSquare.ts.
 */
const M = 39.3701;
const jog: SketchRoom = {
  id: "jog",
  name: "Kitchen",
  level: 0,
  vertices: ([
    [-3.12, -0.79],
    [-0.57, -0.79],
    [0.02, -2.89],
    [4.85, -2.89],
    [4.85, 1.5],
    [-3.12, 1.5],
  ] as [number, number][]).map(([x, y], i) => ({ id: `jog-v${i}`, x: 260 + x * M, y: 220 + y * M })),
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: null,
  nestingOptOut: false,
  symbols: [],
  freeCabinets: [],
};

const seeded: Sketch = {
  rooms: [
    jog,
    // Marked as a scan that read no ceiling, so the panel's "Not measured" note is on screen here.
    (() => {
      // Two base runs meeting at the Kitchen's top-right corner: the 8' one keeps it and the 6'
      // one stops short by its depth, so the drawing mitres — see cornerYieldPx in lib/sketch.ts.
      const kitchen = { ...makeRoom("kitchen", "Kitchen", 30, 30, 14, 11, 0), ceilingMeasured: false };
      kitchen.symbols = [
        cabinet("run-top", kitchen, 0, 1 - 4 / 14, 8),
        cabinet("run-right", kitchen, 1, 3 / 11, 6),
      ];
      return kitchen;
    })(),
    makeRoom("hall", "Hall", 30 + 14 * FT, 30, 4, 11, 0),
    makeRoom("rec", "Rec room", 30, 30, 16, 11, -1),
  ],
  levels: [-1],
};

function App() {
  const [sketch, setSketch] = useState(seeded);
  const [moisture, setMoisture] = useState(emptyMoistureMap());
  return (
    <SketchEditor
      sketch={sketch}
      knownRoomNames={["Kitchen", "Hall", "Rec room"]}
      moisture={moisture}
      onChange={setSketch}
      onMoistureChange={setMoisture}
      onClose={() => undefined}
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
