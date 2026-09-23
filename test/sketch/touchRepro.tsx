/**
 * The editor at phone size, with a sketch worth looking at: the bottom bar, More, and the
 * properties sheet — see the phone layout in `lib/sketchTouch.ts` and `.sketch-card-phone`.
 *
 *   node test/sketch/touchRepro.mjs        (serves on :4622)
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

const seeded: Sketch = {
  rooms: [
    makeRoom("kitchen", "Kitchen", 30, 30, 14, 11, 0),
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
