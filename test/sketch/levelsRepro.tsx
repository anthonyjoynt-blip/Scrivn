/**
 * The editor opened View only on a basement-only sketch — the case reported 2026-09-21, where it
 * opened on an empty main level with the basement traced dashed underneath and no way to switch.
 *
 *   node test/sketch/levelsRepro.mjs        (serves on :4621)
 */

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SketchEditor } from "@/components/sketch/SketchEditor";
import { emptyMoistureMap } from "@/lib/moisture";
import { PIXELS_PER_FOOT, type Sketch, type SketchRoom } from "@/lib/sketch";

const FT = PIXELS_PER_FOOT;

function makeRoom(id: string, name: string, pts: [number, number][], level: number): SketchRoom {
  return {
    id,
    name,
    level,
    vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
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

const basementOnly: Sketch = {
  rooms: [makeRoom("rec", "Rec room", [[0, 0], [16 * FT, 0], [16 * FT, 11 * FT], [0, 11 * FT]], -1)],
  levels: [-1],
};

function App() {
  const [sketch, setSketch] = useState(basementOnly);
  const [moisture, setMoisture] = useState(emptyMoistureMap());
  return (
    <SketchEditor
      sketch={sketch}
      knownRoomNames={[]}
      moisture={moisture}
      onChange={setSketch}
      onMoistureChange={setMoisture}
      onClose={() => undefined}
      startReadOnly
    />
  );
}

createRoot(document.getElementById("root")!).render(<App />);
