/**
 * The walk-through's water-drop tags on a made-up claim (2026-10-12, lib/moistureTags.ts): a kitchen and a living room
 * with a door between, wet walls, a wet floor and a wet ceiling, and a 360 spot in each room. The spots' stills are
 * drawn here from the same model, by three.js's own camera, with every wet area painted blue on them - so each drop
 * the 3D view pins should sit on blue paint.
 *
 *   node test/sketch/wetTagsRepro.mjs        (serves on :4623)
 *
 * `window.__wetTags` reports what the page did: how many stills were drawn, and the drops on the screen.
 */

import { createRoot } from "react-dom/client";
import * as THREE from "three";
import Sketch3D from "@/components/sketch/Sketch3D";
import { cellCentreWorld, cellSizePx, emptyMoistureMap, parseCellKey, type MoistureMap } from "@/lib/moisture";
import { PIXELS_PER_FOOT, wallById, type Sketch, type SketchRoom, type WalkPhoto } from "@/lib/sketch";
import { ceilingModel, houseModel } from "@/lib/sketch3d";
import { viewpoints } from "@/lib/walkView";

const FT = PIXELS_PER_FOOT;

function makeRoom(id: string, name: string, pts: [number, number][], extra: Partial<SketchRoom> = {}): SketchRoom {
  return {
    id,
    name,
    vertices: pts.map(([x, y], i) => ({ id: `${id}-v${i}`, x, y })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    ...extra,
  } as SketchRoom;
}

/** Every "col,row" in a block of cells. */
function block(c0: number, r0: number, cols: number, rows: number): string[] {
  const out: string[] = [];
  for (let c = c0; c < c0 + cols; c++) for (let r = r0; r < r0 + rows; r++) out.push(`${c},${r}`);
  return out;
}

// A kitchen 14' x 12', and a living room 16' x 12' a partition (4.5 in) to its right, a door between them.
const P = 4.5;
const kitchen = makeRoom("k", "Kitchen", [[0, 0], [14 * FT, 0], [14 * FT, 12 * FT], [0, 12 * FT]]);
kitchen.symbols = [
  { id: "d1", type: "door", wallId: "k-v1", t: 0.5, widthFraction: 0.25, widthFeet: 3, doorType: "swing", leaves: "single", heightFeet: 6 + 8 / 12, flipX: false, flipY: false } as never,
];
const living = makeRoom("l", "Living room", [[14 * FT + P, 0], [30 * FT + P, 0], [30 * FT + P, 12 * FT], [14 * FT + P, 12 * FT]]);

const camera = { width: 960, height: 1280, fx: 914, fy: 914, cx: 480, cy: 640 };

/** A spot's stills at (x, y) feet on the page: a level ring of 12, one looking down of 6, one looking up of 6. */
function spotFrames(n0: number, x: number, y: number): WalkPhoto[] {
  const out: WalkPhoto[] = [];
  const ring = (count: number, pitchDeg: number, from: number) => {
    for (let k = 0; k < count; k++) {
      const h = ((from + (360 / count) * k) * Math.PI) / 180;
      const p = (pitchDeg * Math.PI) / 180;
      out.push({
        n: n0 + out.length,
        tS: out.length,
        x: x * FT,
        y: y * FT,
        heightFeet: 5,
        headingDeg: (h * 180) / Math.PI,
        pitchDeg,
        forward: [Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), Math.sin(p)],
        up: [-Math.sin(p) * Math.cos(h), -Math.sin(p) * Math.sin(h), Math.cos(p)],
      });
    }
  };
  ring(12, 0, -90);
  ring(6, -45, -90);
  ring(6, 35, -90);
  return out;
}

// ?photos: the same stills as a walk of plain photos, no 360 spots - walk mode hangs them in the model.
const params = new URLSearchParams(window.location.search);
const sketch: Sketch = {
  rooms: [kitchen, living],
  walks: [
    params.has("photos")
      ? { scanId: "scan-wet", level: 0, camera, photos: [...spotFrames(500, 7, 6).slice(0, 12), ...spotFrames(600, 22, 6).slice(0, 12)] }
      : {
          scanId: "scan-wet",
          level: 0,
          photos: [],
          camera,
          spots: [
            { spot: 1, camera, frames: spotFrames(500, 7, 6) },
            { spot: 2, camera, frames: spotFrames(600, 22, 6) },
          ],
        },
  ],
};

const moisture: MoistureMap = {
  ...emptyMoistureMap(),
  rooms: {
    k: {
      // The top wall's middle stretch, 2' up; the left wall's lower end, 1' up.
      wallReadings: [
        { id: "w1", wallId: "k-v0", startT: 0.3, endT: 0.7, affectedHeightFeet: 2, material: "drywall", reading: 3.2, dryStandard: 0.75 },
        { id: "w2", wallId: "k-v3", startT: 0, endT: 0.4, affectedHeightFeet: 1, material: "paneling", reading: null, dryStandard: 9 },
      ],
      // A patch of floor near the bottom right.
      floorCells: block(36, 28, 14, 12),
      ceilingCells: [],
      insetsOver18Inches: 0,
    },
    l: {
      wallReadings: [{ id: "w3", wallId: "l-v1", startT: 0.2, endT: 0.6, affectedHeightFeet: 3, material: "drywall", reading: 1.4, dryStandard: 0.75 }],
      floorCells: [],
      // A stain on the ceiling over the middle of the room.
      ceilingCells: block(24, 16, 16, 12),
      insetsOver18Inches: 0,
    },
  },
};

/**
 * Every still of the walk, drawn from the model by three.js's camera at the still's place, with the wet areas in blue:
 * as data links by photo number.
 */
function drawStills(): Record<number, string> {
  const model = houseModel(sketch);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd8dde3);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8579, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(0.4, 1, 0.7);
  scene.add(sun);
  const wallMat = new THREE.MeshLambertMaterial({ color: 0xf1ebe0 });
  const floorMat = new THREE.MeshLambertMaterial({ color: 0xb08a5f, side: THREE.DoubleSide });
  const ceilingMat = new THREE.MeshLambertMaterial({ color: 0xfafafa, side: THREE.DoubleSide });
  const wetMat = new THREE.MeshBasicMaterial({ color: 0x1e7fd8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
  for (const prism of model.prisms) {
    if (prism.kind !== "wall") continue;
    const shape = new THREE.Shape(prism.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: prism.y1 - prism.y0, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, prism.y0, 0);
    scene.add(new THREE.Mesh(g, wallMat));
    // The edges, so the corners read.
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: 0x7a7468 })));
  }
  for (const floor of model.floors) {
    const g = new THREE.ShapeGeometry(new THREE.Shape(floor.points.map((p) => new THREE.Vector2(p.x, -p.z))));
    g.rotateX(-Math.PI / 2);
    g.translate(0, floor.y, 0);
    scene.add(new THREE.Mesh(g, floorMat));
  }
  for (const c of model.ceilings) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(c.positions, 3));
    g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, ceilingMat));
  }
  // The wet: each stretch of wall as a panel just off its face, each painted cell as a square just off the floor or ceiling.
  for (const room of sketch.rooms) {
    const data = moisture.rooms[room.id];
    if (!data) continue;
    for (const r of data.wallReadings) {
      const wall = wallById(room, r.wallId);
      if (!wall) continue;
      const ax = wall.x1 + (wall.x2 - wall.x1) * r.startT;
      const ay = wall.y1 + (wall.y2 - wall.y1) * r.startT;
      const bx = wall.x1 + (wall.x2 - wall.x1) * r.endT;
      const by = wall.y1 + (wall.y2 - wall.y1) * r.endT;
      const len = Math.hypot(bx - ax, by - ay) / FT;
      const g = new THREE.PlaneGeometry(len, r.affectedHeightFeet);
      const mesh = new THREE.Mesh(g, wetMat);
      const nx = -(wall.y2 - wall.y1) / wall.lengthPx;
      const ny = (wall.x2 - wall.x1) / wall.lengthPx;
      mesh.position.set((ax + bx) / 2 / FT + nx * 0.02, r.affectedHeightFeet / 2, (ay + by) / 2 / FT + ny * 0.02);
      mesh.rotation.y = -Math.atan2(by - ay, bx - ax);
      scene.add(mesh);
    }
    const size = cellSizePx() / FT;
    const ceiling = ceilingModel(room).low;
    for (const [cells, y] of [[data.floorCells, 0.02], [data.ceilingCells, ceiling - 0.02]] as const) {
      for (const key of cells) {
        const c = parseCellKey(key);
        if (!c) continue;
        const at = cellCentreWorld(room, c.col, c.row);
        const g = new THREE.PlaneGeometry(size, size);
        g.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(g, wetMat);
        mesh.position.set(at.x / FT, y, at.y / FT);
        scene.add(mesh);
      }
    }
  }
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(camera.width, camera.height, false);
  const cam = new THREE.PerspectiveCamera((2 * Math.atan(camera.height / 2 / camera.fy) * 180) / Math.PI, camera.width / camera.height, 0.05, 200);
  const out: Record<number, string> = {};
  for (const v of viewpoints(sketch.walks ?? [], () => 0)) {
    for (const f of v.frames ?? [v]) {
      cam.position.set(...f.position);
      cam.up.set(...f.up);
      cam.lookAt(f.position[0] + f.forward[0], f.position[1] + f.forward[1], f.position[2] + f.forward[2]);
      renderer.render(scene, cam);
      out[f.n] = renderer.domElement.toDataURL("image/jpeg", 0.85);
    }
  }
  renderer.dispose();
  return out;
}

const stills = drawStills();
const report = { stills: Object.keys(stills).length };
(window as unknown as { __wetTags: typeof report }).__wetTags = report;

// The 3D view asks the server for the scan's photo links; here they are the stills just drawn.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/scans/scan-wet/photos")) {
    return new Response(JSON.stringify({ photos: Object.entries(stills).map(([n, href]) => ({ n: Number(n), url: href })) }), {
      headers: { "content-type": "application/json" },
    });
  }
  return realFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(
  <Sketch3D sketch={sketch} moisture={params.has("dry") ? emptyMoistureMap() : moisture} onClose={() => undefined} />,
);
