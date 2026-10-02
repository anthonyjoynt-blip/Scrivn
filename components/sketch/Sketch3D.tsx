"use client";

/**
 * The house in 3D (2026-09-27): "Viewable in scrivn". A model of the sketch - every room on every
 * storey, walls standing where the plan draws them, doorways cut through, stairs as steps, walls
 * rising to a sloped or vaulted ceiling - built by `houseModel` (lib/sketch3d.ts).
 *
 * TWO WAYS TO SEE IT (2026-09-28). The first cut pinned every photo of the phone's walk onto the model
 * as a pin with a cone, and the owner's verdict was "all those little pointers to click on to get
 * around is not the greatest user interface... i suppose more of a matterport type build". So:
 *
 * WALK MODE is the view from inside, standing where a photo was taken, looking the way the phone did,
 * through the lens it did (lib/walkView.ts). The photo hangs in front of the view exactly over what it
 * shows, its edges fading into the model, and the model carries on past them when the view is turned.
 * Drag to look round; tap the floor to go to the photo taken nearest there; the arrow keys step
 * forward and back, and on through the walk in the order it was taken. A plan of the storey in the
 * corner shows where the view is standing and which way it looks. The claim opens in walk mode when
 * its scan brought a walk.
 *
 * SPOTS ONLY, EACH ONE PICTURE (2026-10-02). "unless im exactly where the scan happened i will only see
 * a small slice and not the full room... we will want to clean it up a little bit if possible so it all
 * blends together looking nice and cohesive rather than the fragmentation and ghost walls" (the owner).
 * On a storey with 360° spots, walk mode goes only to them (lib/walkView.ts `navigable`) - the rings, a
 * tap, the arrow keys, the plan in the corner - and a spot is no longer 28 pictures hung over the model:
 * its frames are stitched into one panorama round it (components/sketch/panoBake.ts, lib/panorama.ts),
 * drawn on a sphere the view stands in, the model under it drawn for depth alone so the rings still sit
 * on its floor. A step between two spots crossfades their panoramas. The frames hang as before only
 * until the panorama is ready, and on a graphics card that cannot stitch.
 *
 * THE DOLLHOUSE is the model from above, to turn and zoom, with a ring on the floor wherever the walk
 * can be joined; tapping near one flies down into it. "Low walls" cuts every wall at 4' there.
 *
 * three.js is loaded only when the view opens (dynamic imports), so the claim page never carries it.
 * The photos are fetched by scan (`/api/scans/<id>/photos`, signed links) and drawn as textures; one
 * the browser will not draw is shown as a plain picture instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { levelLabel, PIXELS_PER_FOOT, roomLevel, type Sketch } from "@/lib/sketch";
import { houseModel, type HouseModel, type PrismKind } from "@/lib/sketch3d";
import {
  destinationFor,
  fitFovDeg,
  navigable,
  photoPlane,
  spacedOut,
  stepFrom,
  viewpointId,
  viewpoints,
  wrapAngle,
  yawPitchOf,
  type Viewpoint,
  type ViewpointKey,
} from "@/lib/walkView";
import { alignFrames, cross as crossV, warpThrough, type PanoFrame, type V3 } from "@/lib/panorama";
import { grayOf, PanoBaker, panoMaterial, type DistanceMap } from "./panoBake";

interface Props {
  sketch: Sketch;
  onClose: () => void;
}

const COLORS = {
  background: 0xf3f5f8,
  wallSide: 0xfbf9f5,
  wallTop: 0x1b3a5c,
  floors: [0xe9e2d6, 0xe4e8ec, 0xece6dc, 0xe2e8e1, 0xebe4e8, 0xe7e3da],
  cabinetSide: 0xb8936b,
  cabinetTop: 0xdcd6cc,
  step: 0xd2c2aa,
  glass: 0x9cc3e4,
  ceiling: 0xf7f6f3,
  ring: 0xffffff,
  cursor: 0xf0a93e,
};

/** How high "Low walls" leaves a wall standing, above its own floor. */
const LOW_WALL_FEET = 4;
/** Photos closer together than this share one ring on the floor. */
const RING_SPACING_FEET = 4;
/** A step from one photo to the next, and the flight down from the dollhouse. */
const STEP_MS = 750;
const FLY_MS = 1300;
/** A tap in the dollhouse joins the walk only this near one of its photos. */
const JOIN_REACH_FEET = 8;

type Mode = "walk" | "dollhouse";
const keyOf = viewpointId;
/** A picture - a photo, or one frame of a spot - by its scan and number: what its texture is kept under. */
const pictureId = (v: Viewpoint) => `${v.scanId}:${v.n}`;
/** The pictures standing at [v]: a photo's own, or every frame of a spot. */
const picturesAt = (v: Viewpoint): Viewpoint[] => v.frames ?? [v];
/** A picture larger than this, either way, is drawn smaller: a spot's frames are the camera's full size, and a phone holds a turn of them. */
const MAX_PICTURE_PX = 1280;
/** Pictures kept on the graphics card at once; the least lately seen go first. */
const MAX_PICTURES = 60;
/** How wide the view is at a spot, top to bottom: a spot is for looking round, not at one photo. */
const SPOT_FOV_DEG = 72;
/**
 * A spot's panorama is drawn on a sphere this big round it (2026-10-02): bigger than any step between
 * two spots, so the view never leaves the one it is fading out of, and about a room's size, so the step
 * still looks like moving forward into it.
 */
const PANO_RADIUS_FEET = 40;
/** Panoramas kept on the graphics card at once (32 MB each at 4096): the least lately seen go, and are stitched again on a return - a moment, the lining up being kept. */
const MAX_PANOS = 4;

/** Where a spot's lined-up frames are kept on this device, so the lining up is done once. */
const alignedKey = (scanId: string, spot: number) => `scrivn.pano.v1.${scanId}.${spot}`;
function loadAligned(scanId: string, spot: number, n: number): { forward: V3; up: V3 }[] | null {
  try {
    const raw = window.localStorage.getItem(alignedKey(scanId, spot));
    if (!raw) return null;
    const list = JSON.parse(raw) as number[][];
    if (!Array.isArray(list) || list.length !== n || !list.every((a) => Array.isArray(a) && a.length === 6 && a.every(Number.isFinite))) return null;
    return list.map((a) => ({ forward: [a[0], a[1], a[2]] as V3, up: [a[3], a[4], a[5]] as V3 }));
  } catch {
    return null;
  }
}
function saveAligned(scanId: string, spot: number, frames: PanoFrame[]) {
  try {
    const r = (x: number) => Math.round(x * 1e6) / 1e6;
    window.localStorage.setItem(alignedKey(scanId, spot), JSON.stringify(frames.map((f) => [...f.forward.map(r), ...f.up.map(r)])));
  } catch {
    // Private mode or full: lined up again next time.
  }
}

/**
 * A prism whose top is not level - a wall under a sloped ceiling - built by hand, since an extrusion
 * has one height. The same two groups as an extrusion, caps then sides, so it takes the same [top,
 * side] materials; wound so every face looks outward whichever way round the footprint came.
 */
function slopedPrism(
  THREE: typeof import("three"),
  points: { x: number; z: number }[],
  y0: number,
  tops: number[],
): import("three").BufferGeometry {
  const n = points.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i] as { x: number; z: number };
    const q = points[(i + 1) % n] as { x: number; z: number };
    area += p.x * q.z - q.x * p.z;
  }
  // Built for a footprint wound clockwise in (x, z); the other way, every triangle is turned over.
  const flip = area > 0;
  const positions: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => positions.push(...a, ...(flip ? c : b), ...(flip ? b : c));
  const top = (i: number) => [(points[i] as { x: number }).x, tops[i] as number, (points[i] as { z: number }).z];
  const bottom = (i: number) => [(points[i] as { x: number }).x, y0, (points[i] as { z: number }).z];
  for (let i = 1; i + 1 < n; i++) {
    tri(top(0), top(i), top(i + 1));
    tri(bottom(0), bottom(i + 1), bottom(i));
  }
  const caps = positions.length / 3;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tri(bottom(i), bottom(j), top(j));
    tri(bottom(i), top(j), top(i));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, caps, 0);
  geometry.addGroup(caps, positions.length / 3 - caps, 1);
  geometry.computeVertexNormals();
  return geometry;
}

/** A soft edge for a photo: opaque in the middle, fading out over its outer tenth. */
function featherTexture(THREE: typeof import("three")): import("three").Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const img = g.createImageData(size, size);
    const edge = 0.1;
    const ramp = (t: number) => {
      const s = Math.min(1, Math.max(0, t / edge));
      return s * s * (3 - 2 * s);
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const v = (y + 0.5) / size;
        const a = ramp(Math.min(u, 1 - u)) * ramp(Math.min(v, 1 - v));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.round(a * 255);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }
  return new THREE.CanvasTexture(canvas);
}

type Bounds = NonNullable<HouseModel["bounds"]>;
type View = { position: [number, number, number]; target: [number, number, number] };

/** The bounds of what is drawn on [level] (all storeys when "all"). */
function boundsOf(model: HouseModel, level: number | "all"): Bounds | null {
  if (level === "all") return model.bounds;
  let b: Bounds | null = null;
  const grow = (x: number, y: number, z: number) => {
    if (!b) b = { minX: x, maxX: x, minY: y, maxY: y, minZ: z, maxZ: z };
    else {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
      b.minZ = Math.min(b.minZ, z);
      b.maxZ = Math.max(b.maxZ, z);
    }
  };
  for (const p of model.prisms) if (p.level === level) for (const q of p.points) {
    grow(q.x, p.y0, q.z);
    grow(q.x, p.y1, q.z);
  }
  for (const f of model.floors) if (f.level === level) for (const q of f.points) grow(q.x, f.y, q.z);
  return b;
}

/** What the scene lets the controls outside it do, once it is built. */
interface SceneApi {
  show: (level: number | "all") => void;
  frame: (level: number | "all") => void;
  goTo: (key: ViewpointKey) => void;
  step: (direction: 1 | -1) => void;
  dollhouse: () => void;
  refreshPhotos: () => void;
}

/** Where the view stands and looks, for the plan in the corner: feet and radians. */
interface Pose {
  x: number;
  z: number;
  yaw: number;
  fov: number;
}

export default function Sketch3D({ sketch, onClose }: Props) {
  const model = useMemo(() => houseModel(sketch), [sketch]);
  const walks = useMemo(() => sketch.walks ?? [], [sketch]);
  const points = useMemo(() => viewpoints(walks, (lvl) => model.levels.find((l) => l.level === lvl)?.baseY ?? 0), [walks, model]);
  // Where walk mode goes: a storey's 360° spots when it has any, its photos when not (2026-10-02).
  const navPoints = useMemo(() => navigable(points), [points]);
  const levels = useMemo(() => [...new Set([...model.floors.map((f) => f.level), ...model.prisms.map((p) => p.level)])].sort((a, b) => b - a), [model]);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [level, setLevel] = useState<number | "all">("all");
  const [low, setLow] = useState(false);
  const [mode, setMode] = useState<Mode>(points.length > 0 ? "walk" : "dollhouse");
  // A walk with 360° spots opens at the first of them; one without, at its first photo.
  const [at, setAt] = useState<ViewpointKey | null>((points.find((p) => p.frames) ?? points[0])?.key ?? null);
  // A spot whose panorama is still being stitched, for the line that says so.
  const [stitching, setStitching] = useState(false);
  // Signed links to each scan's photos, by scan id then photo number.
  const [urls, setUrls] = useState<Record<string, Record<number, string>>>({});
  // Pictures the browser would not draw as a texture (pictureId), shown as a plain picture instead.
  const [failed, setFailed] = useState<Record<string, true>>({});
  const urlsRef = useRef(urls);
  urlsRef.current = urls;
  const levelRef = useRef<number | "all">("all");
  const modeRef = useRef<Mode>(mode);
  const atRef = useRef<ViewpointKey | null>(at);
  // Where the dollhouse camera was when the scene was last torn down, so "Low walls" does not throw the view away.
  const viewRef = useRef<View | null>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  // The plan in the corner: its marker is moved by the render loop, not by React.
  const markerRef = useRef<SVGGElement>(null);
  const poseRef = useRef<Pose | null>(null);

  const arrive = useCallback((key: ViewpointKey) => {
    atRef.current = key;
    setAt(key);
  }, []);
  const enterMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;
    let disposed = false;
    let teardown: (() => void) | null = null;
    (async () => {
      let THREE: typeof import("three");
      let OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
      let CSS2DRenderer: typeof import("three/examples/jsm/renderers/CSS2DRenderer.js").CSS2DRenderer;
      let CSS2DObject: typeof import("three/examples/jsm/renderers/CSS2DRenderer.js").CSS2DObject;
      try {
        THREE = await import("three");
        ({ OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js"));
        ({ CSS2DRenderer, CSS2DObject } = await import("three/examples/jsm/renderers/CSS2DRenderer.js"));
      } catch {
        if (!disposed) setStatus("failed");
        return;
      }
      if (disposed) return;

      let renderer: import("three").WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true });
      } catch {
        setStatus("failed");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.style.display = "block";
      host.appendChild(renderer.domElement);

      const labels = new CSS2DRenderer();
      labels.domElement.style.position = "absolute";
      labels.domElement.style.inset = "0";
      labels.domElement.style.pointerEvents = "none";
      host.appendChild(labels.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(COLORS.background);
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e0d4, 2.1));
      const sun = new THREE.DirectionalLight(0xffffff, 1.1);
      sun.position.set(0.6, 1.4, 0.9);
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xffffff, 0.6);
      fill.position.set(-0.8, 0.7, -0.5);
      scene.add(fill);

      const materials: import("three").Material[] = [];
      const standard = (color: number, extra: Record<string, unknown> = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, ...extra });
        materials.push(m);
        return m;
      };
      const byKind: Record<PrismKind, [import("three").Material, import("three").Material]> = {
        wall: [standard(COLORS.wallTop), standard(COLORS.wallSide)],
        cabinet: [standard(COLORS.cabinetTop), standard(COLORS.cabinetSide)],
        step: [standard(COLORS.step), standard(COLORS.step)],
        glass: (() => {
          const g = standard(COLORS.glass, { transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false });
          return [g, g] as [import("three").Material, import("three").Material];
        })(),
      };
      const floorMaterials = COLORS.floors.map((c) => standard(c, { side: THREE.DoubleSide }));
      const ceilingMaterial = standard(COLORS.ceiling, { side: THREE.DoubleSide });

      const geometries: import("three").BufferGeometry[] = [];
      const textures: import("three").Texture[] = [];
      const groups = new Map<number, import("three").Group>();
      const groupFor = (lvl: number) => {
        let g = groups.get(lvl);
        if (!g) {
          g = new THREE.Group();
          groups.set(lvl, g);
          scene.add(g);
        }
        return g;
      };
      const baseOf = (lvl: number) => model.levels.find((l) => l.level === lvl)?.baseY ?? 0;
      // What a tap can land on, storey by storey: the floors, and the solids in front of them.
      const floorsOf = new Map<number, import("three").Mesh[]>();
      const solidsOf = new Map<number, import("three").Mesh[]>();
      const keep = (map: Map<number, import("three").Mesh[]>, lvl: number, mesh: import("three").Mesh) => {
        const list = map.get(lvl) ?? [];
        list.push(mesh);
        map.set(lvl, list);
      };

      // Every prism: its footprint extruded from y0 to y1. The shape is drawn in (x, -z) so that,
      // stood up by a quarter turn about x, its extrusion runs up and its y lands back on z.
      for (const prism of model.prisms) {
        if (prism.tops) {
          // A wall under a sloped ceiling: its top is each point's own.
          const cut = baseOf(prism.level) + LOW_WALL_FEET;
          const tops = low ? prism.tops.map((t) => Math.min(t, cut)) : prism.tops;
          if (prism.points.length < 3 || Math.max(...tops) - prism.y0 < 1e-3) continue;
          const geometry = slopedPrism(THREE, prism.points, prism.y0, tops);
          geometries.push(geometry);
          const mesh = new THREE.Mesh(geometry, byKind[prism.kind]);
          groupFor(prism.level).add(mesh);
          keep(solidsOf, prism.level, mesh);
          continue;
        }
        let y1 = prism.y1;
        if (low) {
          const cut = baseOf(prism.level) + LOW_WALL_FEET;
          if (prism.kind === "wall" || prism.kind === "glass") y1 = Math.min(y1, cut);
          else if (prism.kind === "cabinet" && prism.y0 >= cut) continue;
        }
        if (prism.points.length < 3 || y1 - prism.y0 < 1e-3) continue;
        const shape = new THREE.Shape(prism.points.map((p) => new THREE.Vector2(p.x, -p.z)));
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: y1 - prism.y0, bevelEnabled: false });
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, prism.y0, 0);
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, byKind[prism.kind]);
        if (prism.kind === "glass") mesh.renderOrder = 1;
        else keep(solidsOf, prism.level, mesh);
        groupFor(prism.level).add(mesh);
      }
      const nameLabels: import("three").Object3D[] = [];
      model.floors.forEach((floor, i) => {
        if (floor.points.length < 3) return;
        const shape = new THREE.Shape(floor.points.map((p) => new THREE.Vector2(p.x, -p.z)));
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, floor.y, 0);
        geometries.push(geometry);
        const group = groupFor(floor.level);
        const mesh = new THREE.Mesh(geometry, floorMaterials[i % floorMaterials.length]);
        group.add(mesh);
        keep(floorsOf, floor.level, mesh);
        if (floor.name.trim() !== "") {
          const div = document.createElement("div");
          div.textContent = floor.name;
          div.style.cssText =
            "font: 600 12px/1.2 var(--font-ui), system-ui, sans-serif; color: #1b3a5c; background: rgba(255,255,255,0.9);" +
            "padding: 2px 7px; border-radius: 999px; box-shadow: 0 1px 3px rgba(18,40,65,0.25); white-space: nowrap;";
          const label = new CSS2DObject(div);
          label.position.set(floor.labelAt.x, floor.labelAt.y, floor.labelAt.z);
          group.add(label);
          nameLabels.push(label);
        }
      });
      // Ceilings, for standing inside: walk mode shows them, the dollhouse does not.
      const ceilings: import("three").Mesh[] = [];
      // The ceilings by storey, for hanging a spot's upward frames on (they raycast hidden or not).
      const overheadOf = new Map<number, import("three").Mesh[]>();
      for (const c of model.ceilings) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(c.positions, 3));
        geometry.computeVertexNormals();
        geometries.push(geometry);
        const mesh = new THREE.Mesh(geometry, ceilingMaterial);
        mesh.visible = false;
        groupFor(c.level).add(mesh);
        ceilings.push(mesh);
        keep(overheadOf, c.level, mesh);
      }

      // ---- The walk ------------------------------------------------------------------------------
      const byKey = new Map(points.map((v) => [keyOf(v.key), v] as const));
      const vec = (v: readonly [number, number, number]) => new THREE.Vector3(v[0], v[1], v[2]);

      // A ring on the floor wherever the walk can be joined, a few feet apart: at the spots alone on a storey that has them.
      const ringMaterial = new THREE.MeshBasicMaterial({ color: COLORS.ring, transparent: true, opacity: 0.85, depthWrite: false });
      materials.push(ringMaterial);
      const ringGeometry = new THREE.RingGeometry(0.42, 0.62, 40);
      ringGeometry.rotateX(-Math.PI / 2);
      geometries.push(ringGeometry);
      const spotRingGeometry = new THREE.RingGeometry(0.62, 0.95, 48);
      spotRingGeometry.rotateX(-Math.PI / 2);
      geometries.push(spotRingGeometry);
      const rings = new Map<string, import("three").Mesh>();
      for (const v of spacedOut(navPoints, RING_SPACING_FEET)) {
        const ring = new THREE.Mesh(v.frames ? spotRingGeometry : ringGeometry, ringMaterial);
        ring.position.set(v.position[0], baseOf(v.level) + 0.03, v.position[2]);
        ring.renderOrder = 2;
        groupFor(v.level).add(ring);
        rings.set(keyOf(v.key), ring);
      }
      // Where a tap would go, under the pointer.
      const cursorMaterial = new THREE.MeshBasicMaterial({ color: COLORS.cursor, transparent: true, opacity: 0.9, depthWrite: false });
      materials.push(cursorMaterial);
      const cursor = new THREE.Mesh(ringGeometry, cursorMaterial);
      cursor.visible = false;
      cursor.renderOrder = 3;
      scene.add(cursor);

      // The pictures, each hung in front of its camera, loaded when first needed.
      const feather = featherTexture(THREE);
      textures.push(feather);
      const planeGeometry = new THREE.PlaneGeometry(1, 1);
      geometries.push(planeGeometry);
      const pictureMeshes = new Map<string, import("three").Mesh<import("three").PlaneGeometry, import("three").MeshBasicMaterial>>();
      const pictureState = new Map<string, "loading" | "ready" | "failed">();
      // When each picture was last wanted, for letting the oldest go.
      const pictureUsed = new Map<string, number>();
      const raycaster = new THREE.Raycaster();
      /**
       * How far ahead the picture hangs: at what the camera faced - a wall, or for a spot's frames aimed
       * up and down, the ceiling or the floor - which is where its picture is.
       */
      const photoDistance = (v: Viewpoint) => {
        raycaster.set(vec(v.position), vec(v.forward));
        raycaster.near = 0.5;
        raycaster.far = 80;
        const targets = [...(solidsOf.get(v.level) ?? []), ...(floorsOf.get(v.level) ?? []), ...(overheadOf.get(v.level) ?? [])];
        const hit = raycaster.intersectObjects(targets, false)[0];
        return hit ? Math.min(40, Math.max(2, hit.distance - 0.1)) : 10;
      };
      /** A picture from [url] as a texture, no larger than [MAX_PICTURE_PX] either way. */
      const loadPicture = (url: string, done: (t: import("three").Texture) => void, failed: () => void) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const scale = Math.min(1, MAX_PICTURE_PX / Math.max(w, h, 1));
          let texture: import("three").Texture;
          if (scale < 1) {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
            texture = new THREE.CanvasTexture(canvas);
          } else {
            texture = new THREE.Texture(img);
          }
          texture.needsUpdate = true;
          done(texture);
        };
        img.onerror = failed;
        img.src = url;
      };
      /** Lets go of the pictures least lately wanted, past [MAX_PICTURES], never one in [keepIds]. */
      const trimPictures = (keepIds: Set<string>) => {
        if (pictureMeshes.size <= MAX_PICTURES) return;
        const byAge = [...pictureMeshes.keys()].filter((id) => !keepIds.has(id)).sort((a, b) => (pictureUsed.get(a) ?? 0) - (pictureUsed.get(b) ?? 0));
        for (const id of byAge.slice(0, pictureMeshes.size - MAX_PICTURES)) {
          const mesh = pictureMeshes.get(id);
          if (!mesh) continue;
          mesh.parent?.remove(mesh);
          mesh.material.map?.dispose();
          mesh.material.dispose();
          pictureMeshes.delete(id);
          pictureState.delete(id);
        }
      };
      const ensurePicture = (f: Viewpoint) => {
        const id = pictureId(f);
        pictureUsed.set(id, performance.now());
        if (pictureState.has(id)) return;
        const url = urlsRef.current[f.scanId]?.[f.n];
        if (!url) return;
        pictureState.set(id, "loading");
        loadPicture(
          url,
          (texture) => {
            if (disposed) {
              texture.dispose();
              return;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.MeshBasicMaterial({
              map: texture,
              alphaMap: feather,
              transparent: true,
              opacity: 0,
              depthTest: false,
              depthWrite: false,
              side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(planeGeometry, material);
            const plane = photoPlane(f, photoDistance(f));
            mesh.position.set(...plane.center);
            mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(vec(f.right), vec(f.up), vec(f.forward).negate()));
            mesh.scale.set(plane.width, plane.height, 1);
            mesh.renderOrder = 10;
            mesh.visible = false;
            groupFor(f.level).add(mesh);
            pictureMeshes.set(id, mesh);
            pictureState.set(id, "ready");
            trimPictures(new Set([...(current ? picturesAt(current) : []), ...(transition?.target ? picturesAt(transition.target) : [])].map(pictureId)));
          },
          () => {
            pictureState.set(id, "failed");
            if (!disposed) setFailed((prev) => ({ ...prev, [id]: true }));
          },
        );
      };
      const ensurePhoto = (v: Viewpoint | null | undefined) => {
        if (v) for (const f of picturesAt(v)) ensurePicture(f);
      };
      /** The pictures a step or two away, so they are there when the view arrives. */
      const prefetch = (v: Viewpoint, yaw: number) => {
        ensurePhoto(v);
        if (!v.frames) {
          ensurePhoto(byKey.get(keyOf({ walk: v.key.walk, photo: v.key.photo + 1 })));
          ensurePhoto(byKey.get(keyOf({ walk: v.key.walk, photo: v.key.photo - 1 })));
        }
        ensurePhoto(stepFrom(navPoints, v, yaw, 1));
        ensurePhoto(stepFrom(navPoints, v, yaw, -1));
      };
      /** Disposed with the scene: every picture still held. */
      const disposePictures = () => {
        for (const mesh of pictureMeshes.values()) {
          mesh.material.map?.dispose();
          mesh.material.dispose();
        }
      };

      // ---- A spot's panorama (2026-10-02): its frames stitched into one picture round it -----------
      // Made once the spot's frames have all arrived: first straight from the sensor's turns (a moment),
      // then again once the frames are lined up against each other (a few seconds, once per device).
      // Until then, and on a card that cannot do it, the frames hang as pictures as they always did.
      const baker = PanoBaker.supported(renderer) ? new PanoBaker(THREE, renderer) : null;
      const panoWidth = Math.min(renderer.capabilities.maxTextureSize, window.matchMedia?.("(pointer: coarse)").matches ? 3072 : 4096);
      const panoGeometry = new THREE.SphereGeometry(PANO_RADIUS_FEET, 96, 48);
      geometries.push(panoGeometry);
      type Pano = {
        state: "baking" | "ready" | "failed";
        mesh: import("three").Mesh<import("three").SphereGeometry, import("three").ShaderMaterial> | null;
        texture: import("three").Texture | null;
        dist: DistanceMap | null;
        usedAt: number;
      };
      const panos = new Map<string, Pano>();
      const dropPano = (key: string) => {
        const p = panos.get(key);
        if (!p) return;
        if (p.texture) PanoBaker.release(p.texture);
        if (p.mesh) {
          scene.remove(p.mesh);
          p.mesh.material.dispose();
        }
        p.dist?.dispose();
        p.state = "failed"; // so an alignment still running for it lets go
        panos.delete(key);
      };
      /** Lets the least lately seen panoramas go, past [MAX_PANOS], never one in [keep]. */
      const trimPanos = (keep: Set<string>) => {
        if (panos.size <= MAX_PANOS) return;
        const byAge = [...panos.entries()].filter(([k, p]) => !keep.has(k) && p.state !== "baking").sort((a, b) => a[1].usedAt - b[1].usedAt);
        for (const [k] of byAge.slice(0, panos.size - MAX_PANOS)) dropPano(k);
      };
      /** The model a spot's panorama is laid through: what stands on its storey. */
      const proxyOf = (lvl: number) => [...(solidsOf.get(lvl) ?? []), ...(floorsOf.get(lvl) ?? []), ...(overheadOf.get(lvl) ?? [])];
      const panoFramesOf = (v: Viewpoint): PanoFrame[] =>
        picturesAt(v).map((f) => ({
          forward: f.forward,
          up: f.up,
          right: f.right,
          offset: [f.position[0] - v.position[0], f.position[1] - v.position[1], f.position[2] - v.position[2]] as V3,
          camera: f.camera,
        }));
      const panoReady = (v: Viewpoint | null | undefined) => !!v?.frames && panos.get(keyOf(v.key))?.state === "ready";
      const ensurePano = (v: Viewpoint | null | undefined) => {
        if (!baker || !v?.frames) return;
        const key = keyOf(v.key);
        const had = panos.get(key);
        if (had) {
          had.usedAt = performance.now();
          return;
        }
        const textures = picturesAt(v).map((f) => (pictureState.get(pictureId(f)) === "ready" ? pictureMeshes.get(pictureId(f))?.material.map ?? null : null));
        if (textures.some((t) => t == null)) return;
        const tex = textures as import("three").Texture[];
        const pano: Pano = { state: "baking", mesh: null, texture: null, dist: null, usedAt: performance.now() };
        panos.set(key, pano);
        const spot = v.key.spot as number;
        // Off the frame being drawn: the bake takes the graphics card for a moment.
        setTimeout(() => {
          if (disposed) return;
          try {
            const started = performance.now();
            const dist = baker.distanceMap(proxyOf(v.level), v.position);
            pano.dist = dist;
            const sensor = panoFramesOf(v);
            const kept = loadAligned(v.scanId, spot, sensor.length);
            const frames0 = kept
              ? sensor.map((f, k) => {
                  const a = kept[k] as { forward: V3; up: V3 };
                  return { ...f, forward: a.forward, up: a.up, right: crossV(a.forward, a.up) };
                })
              : sensor;
            const texture = baker.bake(frames0, tex, dist, baker.gains(frames0, tex, dist), panoWidth);
            const mesh = new THREE.Mesh(panoGeometry, panoMaterial(THREE, texture));
            mesh.position.set(...v.position);
            mesh.frustumCulled = false;
            mesh.visible = false;
            scene.add(mesh);
            pano.mesh = mesh;
            pano.texture = texture;
            pano.state = "ready";
            trimPanos(new Set([key, ...(current ? [keyOf(current.key)] : []), ...(transition?.target ? [keyOf(transition.target.key)] : [])]));
            console.info(`[walk] spot ${spot}: stitched ${frames0.length} frames ${kept ? "(lined up before)" : "(as the sensor turned them)"} in ${Math.round(performance.now() - started)} ms`);
            if (kept) return;
            // Then lined up against each other, and stitched again.
            const grays = tex.map((t, k) => grayOf(t.image as CanvasImageSource & { width: number; height: number }, (sensor[k] as PanoFrame).camera.width));
            if (grays.some((g) => g == null)) return;
            const t0 = performance.now();
            void alignFrames(sensor, grays as NonNullable<(typeof grays)[number]>[], warpThrough(dist.distanceOf), { cancelled: () => disposed }).then((out) => {
              const m = pano.mesh;
              if (!out || disposed || pano.state !== "ready" || !m) return;
              const lined = out.frames;
              const next = baker.bake(lined, tex, dist, baker.gains(lined, tex, dist), panoWidth);
              const old = pano.texture;
              (m.material.uniforms.pano as { value: import("three").Texture | null }).value = next;
              pano.texture = next;
              if (old) PanoBaker.release(old);
              saveAligned(v.scanId, spot, lined);
              console.info(`[walk] spot ${spot}: lined up ${out.used} overlaps, ${out.before.toFixed(2)} -> ${out.after.toFixed(2)} degrees, in ${Math.round(performance.now() - t0)} ms`);
            });
          } catch (err) {
            pano.state = "failed";
            console.warn(`[walk] spot ${spot}: could not be stitched; its frames hang as pictures`, err);
          }
        }, 0);
      };
      const disposePanos = () => {
        for (const key of [...panos.keys()]) dropPano(key);
        baker?.dispose();
      };
      /** The model's own materials: drawn only for depth while the view stands in a panorama, so rings sit on its floor. */
      const modelMaterials = [...byKind.wall, ...byKind.cabinet, ...byKind.step, ...floorMaterials, ceilingMaterial];
      let modelHidden = false;
      const hideModel = (hide: boolean) => {
        if (hide === modelHidden) return;
        modelHidden = hide;
        for (const m of modelMaterials) m.colorWrite = !hide;
        for (const m of byKind.glass) m.visible = !hide;
      };

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 2;
      controls.maxDistance = 2000;
      // Zoom goes where the PM points, not to the middle of the house: a corner can be looked at.
      controls.zoomToCursor = true;

      /** Where the dollhouse looks at [lvl]'s storey (or the whole house) from: above and to the south-east, all of it in view. */
      const framing = (lvl: number | "all") => {
        const b = boundsOf(model, lvl);
        if (!b) return null;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const cy = lvl === "all" ? (b.minY + b.maxY) / 2 : b.minY + 2;
        const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 10);
        const distance = span * 1.25 + (b.maxY - b.minY);
        return {
          target: new THREE.Vector3(cx, cy, cz),
          position: new THREE.Vector3(cx + distance * 0.45, cy + distance * 0.75, cz + distance * 0.7),
          distance,
        };
      };
      const frame = (lvl: number | "all") => {
        const f = framing(lvl);
        if (!f) return;
        controls.target.copy(f.target);
        camera.position.copy(f.position);
        camera.near = Math.max(0.1, f.distance / 500);
        camera.far = f.distance * 20;
        camera.updateProjectionMatrix();
        controls.update();
      };
      const show = (lvl: number | "all") => {
        for (const [key, group] of groups) group.visible = lvl === "all" || key === lvl;
      };

      // ---- Walk mode's view -----------------------------------------------------------------------
      type Look = { pos: import("three").Vector3; yaw: number; pitch: number; fov: number };
      const view: Look = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, fov: 60 };
      let current: Viewpoint | null = null;
      let zoomed = false;
      let transition: {
        from: Look;
        to: Look;
        start: number;
        ms: number;
        fromKey: string | null;
        target: Viewpoint | null;
        /** Where the view ends up: at a photo, or handed to the dollhouse. */
        then: Mode;
      } | null = null;
      const lookOf = (v: Viewpoint, keepYaw?: number): Look => {
        if (v.frames) {
          // A spot faces every way: the view keeps looking where it was, level.
          return { pos: vec(v.position), yaw: keepYaw ?? yawPitchOf(v.forward).yaw, pitch: 0, fov: SPOT_FOV_DEG };
        }
        const o = yawPitchOf(v.forward);
        return { pos: vec(v.position), yaw: o.yaw, pitch: o.pitch, fov: fitFovDeg(v.camera, camera.aspect) };
      };
      const cameraLook = (): Look => {
        const d = new THREE.Vector3();
        camera.getWorldDirection(d);
        const o = yawPitchOf([d.x, d.y, d.z]);
        return { pos: camera.position.clone(), yaw: o.yaw, pitch: o.pitch, fov: camera.fov };
      };
      /** Everything that is only for standing inside: the ceilings on, the names and the dollhouse's controls off. */
      const inside = (on: boolean, lvl: number) => {
        for (const c of ceilings) c.visible = on;
        for (const l of nameLabels) l.visible = !on;
        controls.enabled = !on;
        show(on ? lvl : levelRef.current);
        camera.near = on ? 0.1 : camera.near;
        camera.far = on ? 400 : camera.far;
        camera.updateProjectionMatrix();
      };
      const goTo = (v: Viewpoint, ms = STEP_MS) => {
        const fromDollhouse = modeRef.current !== "walk";
        const to = lookOf(v, fromDollhouse ? cameraLook().yaw : view.yaw);
        prefetch(v, to.yaw);
        // From wherever the view is right now - part way through another step, if it is.
        const from = !fromDollhouse && !transition ? { ...view, pos: view.pos.clone() } : cameraLook();
        // Where a rebuild of the scene (the walls made whole again) starts it.
        atRef.current = v.key;
        if (fromDollhouse) {
          // Down from the dollhouse: the storey the photo is on, and a moment longer.
          controls.enabled = false;
          for (const l of nameLabels) l.visible = false;
          show(v.level);
          enterMode("walk");
        }
        transition = { from, to, start: performance.now(), ms: fromDollhouse ? FLY_MS : ms, fromKey: current ? keyOf(current.key) : null, target: v, then: "walk" };
        zoomed = false;
      };
      const toDollhouse = () => {
        const f = framing(levelRef.current);
        if (!f) return;
        const d = f.target.clone().sub(f.position);
        const o = yawPitchOf([d.x, d.y, d.z]);
        for (const c of ceilings) c.visible = false;
        transition = {
          from: modeRef.current === "walk" ? { ...view, pos: view.pos.clone() } : cameraLook(),
          to: { pos: f.position, yaw: o.yaw, pitch: o.pitch, fov: 45 },
          start: performance.now(),
          ms: FLY_MS,
          fromKey: current ? keyOf(current.key) : null,
          target: null,
          then: "dollhouse",
        };
      };

      // ---- Pointer: drag to look round (walk) or turn the model (dollhouse); tap to go ------------
      let drag: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;
      const floorHit = (clientX: number, clientY: number) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        raycaster.near = 0.1;
        raycaster.far = Infinity;
        const walking = modeRef.current === "walk";
        const lvls = walking && current ? [current.level] : [...groups.keys()].filter((l) => groups.get(l)?.visible !== false);
        const targets: import("three").Mesh[] = [];
        for (const l of lvls) targets.push(...(floorsOf.get(l) ?? []), ...(solidsOf.get(l) ?? []));
        const hit = raycaster.intersectObjects(targets, false)[0];
        if (!hit) return null;
        const lvl = lvls.find((l) => (floorsOf.get(l) ?? []).includes(hit.object as import("three").Mesh) || (solidsOf.get(l) ?? []).includes(hit.object as import("three").Mesh));
        if (lvl === undefined) return null;
        const onFloor = (floorsOf.get(lvl) ?? []).includes(hit.object as import("three").Mesh);
        let { x, z } = hit.point;
        if (!onFloor) {
          // A wall or a cabinet: the floor a step back from it, towards the view.
          const back = new THREE.Vector3(camera.position.x - x, 0, camera.position.z - z);
          if (back.lengthSq() > 1e-6) back.normalize().multiplyScalar(1.5);
          x += back.x;
          z += back.z;
        }
        return { x, z, level: lvl, y: baseOf(lvl) };
      };
      const onDown = (e: PointerEvent) => {
        drag = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
        if (modeRef.current === "walk") renderer.domElement.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (drag && e.buttons !== 0) {
          if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
          if (modeRef.current === "walk" && !transition) {
            // Grab the scene: it follows the pointer, so the view turns the other way.
            const k = ((view.fov * Math.PI) / 180) / Math.max(1, host.clientHeight);
            view.yaw = wrapAngle(view.yaw + (e.clientX - drag.lastX) * k);
            view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + (e.clientY - drag.lastY) * k));
          }
          drag.lastX = e.clientX;
          drag.lastY = e.clientY;
          cursor.visible = false;
          return;
        }
        if (e.pointerType === "touch" || transition) {
          cursor.visible = false;
          return;
        }
        const hit = floorHit(e.clientX, e.clientY);
        cursor.visible = hit != null && (modeRef.current === "walk" || navPoints.some((v) => v.level === hit.level));
        if (hit) cursor.position.set(hit.x, hit.y + 0.04, hit.z);
      };
      const onUp = (e: PointerEvent) => {
        const tap = drag && !drag.moved;
        drag = null;
        if (renderer.domElement.hasPointerCapture(e.pointerId)) renderer.domElement.releasePointerCapture(e.pointerId);
        if (!tap || transition) return;
        const hit = floorHit(e.clientX, e.clientY);
        if (!hit) return;
        if (modeRef.current === "walk") {
          const v = destinationFor(navPoints, hit.level, hit.x, hit.z, view.yaw);
          if (v && v !== current) goTo(v);
        } else {
          const v = destinationFor(navPoints, hit.level, hit.x, hit.z, null);
          if (v && Math.hypot(v.position[0] - hit.x, v.position[2] - hit.z) <= JOIN_REACH_FEET) goTo(v);
        }
      };
      const onLeave = () => {
        cursor.visible = false;
      };
      const onWheel = (e: WheelEvent) => {
        if (modeRef.current !== "walk") return;
        e.preventDefault();
        view.fov = Math.min(100, Math.max(25, view.fov * Math.exp(e.deltaY * 0.001)));
        zoomed = true;
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointerleave", onLeave);
      renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

      const resize = () => {
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        renderer.setSize(w, h);
        labels.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        if (current && !zoomed && modeRef.current === "walk" && !transition) view.fov = fitFovDeg(current.camera, camera.aspect);
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      // Where the view starts: at the photo it was at, or the first; the dollhouse when there is none.
      const start = atRef.current ? byKey.get(keyOf(atRef.current)) ?? null : null;
      if (modeRef.current === "walk" && start) {
        current = start;
        Object.assign(view, lookOf(start));
        prefetch(start, view.yaw);
        inside(true, start.level);
      } else {
        if (modeRef.current === "walk") enterMode("dollhouse");
        show(levelRef.current);
        const kept = viewRef.current;
        if (kept) {
          const b = model.bounds;
          const span = b ? Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 10) : 50;
          camera.position.set(...kept.position);
          controls.target.set(...kept.target);
          camera.near = 0.1;
          camera.far = span * 60;
          camera.updateProjectionMatrix();
          controls.update();
        } else {
          frame(levelRef.current);
        }
      }

      const lookDir = new THREE.Vector3();
      const facingDir = new THREE.Vector3();
      const smooth = (a: number, b: number, t: number) => {
        const s = Math.min(1, Math.max(0, (t - a) / (b - a)));
        return s * s * (3 - 2 * s);
      };
      let raf = 0;
      let lastStitching = false;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        let fromFade = 0;
        let toFade = 0;
        let stepT = 0;
        if (transition) {
          const tr = transition;
          const t = Math.min(1, (performance.now() - tr.start) / tr.ms);
          stepT = t;
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          view.pos.lerpVectors(tr.from.pos, tr.to.pos, e);
          view.yaw = wrapAngle(tr.from.yaw + wrapAngle(tr.to.yaw - tr.from.yaw) * e);
          view.pitch = tr.from.pitch + (tr.to.pitch - tr.from.pitch) * e;
          view.fov = tr.from.fov + (tr.to.fov - tr.from.fov) * e;
          fromFade = 1 - smooth(0, 0.5, t);
          toFade = smooth(0.55, 1, t);
          if (tr.then === "walk" && t > 0.85) for (const c of ceilings) c.visible = true;
          if (t >= 1) {
            transition = null;
            if (tr.then === "walk" && tr.target) {
              current = tr.target;
              inside(true, tr.target.level);
              arrive(tr.target.key);
            } else {
              // Handed to the dollhouse, looking at the storey from where the flight ended.
              current = null;
              const f = framing(levelRef.current);
              inside(false, 0);
              if (f) {
                controls.target.copy(f.target);
                camera.near = Math.max(0.1, f.distance / 500);
                camera.far = f.distance * 20;
              }
              camera.fov = 45;
              camera.updateProjectionMatrix();
              enterMode("dollhouse");
            }
          }
        }
        const walking = transition != null || modeRef.current === "walk";
        if (walking) {
          camera.position.copy(view.pos);
          camera.rotation.set(view.pitch, view.yaw, 0, "YXZ");
          if (Math.abs(camera.fov - view.fov) > 1e-3) {
            camera.fov = view.fov;
            camera.updateProjectionMatrix();
          }
        } else {
          controls.update();
        }
        // The spots' panoramas (2026-10-02): where the view stands, and on a step the one it leaves and the
        // one it goes to. Standing in one - or stepping between two - the model is drawn for depth alone,
        // under the panorama, so the rings still sit on its floor and go behind its walls; to and from the
        // dollhouse the panorama fades over the model instead.
        const fromV = transition?.fromKey ? byKey.get(transition.fromKey) ?? null : null;
        const toV = transition?.target ?? null;
        const hereV = !transition && modeRef.current === "walk" ? current : null;
        ensurePano(hereV);
        ensurePano(toV);
        ensurePano(fromV);
        const inPanos = walking && (hereV ? panoReady(hereV) : transition != null && transition.then === "walk" && panoReady(fromV) && panoReady(toV));
        hideModel(inPanos);
        const stepIn = smooth(0.15, 0.85, stepT);
        for (const [key, p] of panos) {
          const m = p.mesh;
          if (!m) continue;
          let o = 0;
          let order = inPanos ? -10 : 50;
          if (hereV && key === keyOf(hereV.key)) o = 1;
          else if (toV && key === keyOf(toV.key)) {
            o = inPanos ? stepIn : toFade;
            order += 1;
          } else if (fromV && key === keyOf(fromV.key)) o = inPanos ? 1 : fromFade;
          m.visible = o > 0.005;
          (m.material.uniforms.opacity as { value: number }).value = o;
          m.renderOrder = order;
        }
        const stitchingNow = !!(hereV?.frames && baker && !panoReady(hereV) && panos.get(keyOf(hereV.key))?.state !== "failed");
        if (stitchingNow !== lastStitching) {
          lastStitching = stitchingNow;
          setStitching(stitchingNow);
        }
        // The pictures: the ones where the view stands, crossfading to the next place's on a step - not a
        // spot's, once its panorama shows them all.
        const hung = (v: Viewpoint | null | undefined) => (v && !panoReady(v) ? picturesAt(v).map(pictureId) : []);
        const fromSet = new Set(hung(fromV));
        const toSet = new Set(hung(toV));
        const hereSet = new Set(hung(hereV));
        camera.getWorldDirection(lookDir);
        const shown: { mesh: (typeof pictureMeshes extends Map<string, infer M> ? M : never); facing: number }[] = [];
        for (const [id, mesh] of pictureMeshes) {
          const o = hereSet.has(id) ? 1 : transition ? Math.max(toSet.has(id) ? toFade : 0, fromSet.has(id) ? fromFade : 0) : 0;
          mesh.material.opacity = o;
          mesh.visible = o > 0.01;
          if (mesh.visible) {
            // The plane's normal points back at its camera; the picture faces the view as much as it faces away from it.
            facingDir.set(0, 0, -1).applyQuaternion(mesh.quaternion);
            shown.push({ mesh, facing: facingDir.dot(lookDir) });
          }
        }
        // Where a spot's frames overlap, the one the view looks most straight into is drawn last, on top.
        shown.sort((a, b) => a.facing - b.facing);
        shown.forEach((s, i) => {
          s.mesh.renderOrder = 10 + i;
        });
        // The rings: not under the view's own feet, and only for the storey being walked.
        for (const [k, ring] of rings) ring.visible = !(walking && current && k === keyOf(current.key));
        renderer.render(scene, camera);
        labels.render(scene, camera);
        // The plan in the corner follows the view.
        if (walking) poseRef.current = { x: view.pos.x, z: view.pos.z, yaw: view.yaw, fov: view.fov };
        const marker = markerRef.current;
        const pose = poseRef.current;
        if (marker && pose) marker.setAttribute("data-pose", `${pose.x.toFixed(2)},${pose.z.toFixed(2)},${pose.yaw.toFixed(3)}`);
      };
      loop();

      sceneApi.current = {
        show,
        frame,
        goTo: (key) => {
          const v = byKey.get(keyOf(key));
          if (v) goTo(v);
        },
        step: (direction) => {
          if (!current || transition) return;
          const v = stepFrom(navPoints, current, view.yaw, direction);
          if (v) goTo(v);
        },
        dollhouse: () => {
          if (modeRef.current === "walk" && !transition) toDollhouse();
        },
        refreshPhotos: () => {
          if (current) prefetch(current, view.yaw);
          else for (const v of points.slice(0, 1)) ensurePhoto(v);
        },
      };
      setStatus("ready");
      teardown = () => {
        if (modeRef.current === "dollhouse") {
          viewRef.current = {
            position: [camera.position.x, camera.position.y, camera.position.z],
            target: [controls.target.x, controls.target.y, controls.target.z],
          };
        }
        cancelAnimationFrame(raf);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointerleave", onLeave);
        renderer.domElement.removeEventListener("wheel", onWheel);
        controls.dispose();
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
        for (const t of textures) t.dispose();
        disposePictures();
        disposePanos();
        renderer.dispose();
        renderer.domElement.remove();
        labels.domElement.remove();
        sceneApi.current = null;
      };
    })();

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [model, low, walks, points, navPoints, arrive, enterMode]);

  // The pictures, one request per scan, when the view opens.
  useEffect(() => {
    let cancelled = false;
    for (const scanId of new Set(walks.map((w) => w.scanId))) {
      fetch(`/api/scans/${scanId}/photos`)
        .then((r) => (r.ok ? r.json() : { photos: [] }))
        .then((body: { photos?: { n: number; url: string }[] }) => {
          if (cancelled) return;
          const byN: Record<number, string> = {};
          for (const p of body.photos ?? []) byN[p.n] = p.url;
          setUrls((prev) => ({ ...prev, [scanId]: byN }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [walks]);

  useEffect(() => {
    sceneApi.current?.refreshPhotos();
  }, [urls, status]);

  useEffect(() => {
    levelRef.current = level;
    if (modeRef.current === "dollhouse") {
      sceneApi.current?.show(level);
      sceneApi.current?.frame(level);
    }
  }, [level]);

  // The dollhouse's own tool; standing inside, every wall is whole.
  useEffect(() => {
    if (mode === "walk" && low) setLow(false);
  }, [mode, low]);

  const currentWalk = at ? walks[at.walk] ?? null : null;
  const current = at && !at.spot ? currentWalk?.photos[at.photo] ?? null : null;
  const spots = currentWalk?.spots ?? [];
  const spotIndex = at?.spot ? spots.findIndex((s) => s.spot === at.spot) : -1;
  // Undefined while the scan's links are still on their way; then the photo's, or null when the phone never sent it.
  const scanUrls = currentWalk ? urls[currentWalk.scanId] : undefined;
  const currentUrl = current && scanUrls ? scanUrls[current.n] ?? null : null;
  const stepAlong = useCallback(
    (by: number) => {
      const k = atRef.current;
      if (!k) return;
      const walk = walks[k.walk];
      if (!walk) return;
      if (k.spot) {
        // At a spot, on to the walk's next spot.
        const list = walk.spots ?? [];
        const next = list[list.findIndex((s) => s.spot === k.spot) + by];
        if (next) sceneApi.current?.goTo({ walk: k.walk, photo: -1, spot: next.spot });
        return;
      }
      const next = k.photo + by;
      if (next < 0 || next >= walk.photos.length) return;
      sceneApi.current?.goTo({ walk: k.walk, photo: next });
    },
    [walks],
  );
  /** From a photo, to the 360° spot nearest where the view stands. */
  const toNearestSpot = useCallback(() => {
    const pose = poseRef.current;
    const k = atRef.current;
    const walk = k ? walks[k.walk] : undefined;
    const spotPoints = points.filter((p) => p.frames && (!walk || p.level === walk.level));
    if (spotPoints.length === 0) return;
    const best = pose ? destinationFor(spotPoints, spotPoints[0]!.level, pose.x, pose.z, null) : spotPoints[0];
    if (best) sceneApi.current?.goTo(best.key);
  }, [points, walks]);
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modeRef.current === "walk" && points.length > 0) sceneApi.current?.dollhouse();
        else onClose();
        return;
      }
      if (modeRef.current !== "walk") return;
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") sceneApi.current?.step(1);
      else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") sceneApi.current?.step(-1);
      else if (e.key === "ArrowRight") stepAlong(1);
      else if (e.key === "ArrowLeft") stepAlong(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, points, stepAlong]);

  const walkLevel = at ? walks[at.walk]?.level ?? 0 : 0;
  // A finger has no arrow keys: the hint says what a phone can do.
  const [coarse] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="3D view of the sketch"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#f3f5f8", display: "flex", flexDirection: "column" }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          paddingTop: "calc(10px + env(safe-area-inset-top, 0px))",
          borderBottom: "1px solid var(--border, #e1e5ea)",
          background: "#fff",
        }}
      >
        <strong style={{ fontSize: 16, color: "#1b3a5c", marginRight: 8 }}>3D view</strong>
        {points.length > 0 && (
          <div className="option-group" role="group" aria-label="How to look at it">
            <button
              type="button"
              className={`option-btn${mode === "walk" ? " selected" : ""}`}
              aria-pressed={mode === "walk"}
              onClick={() => {
                const key = atRef.current ?? navPoints[0]?.key;
                if (key) sceneApi.current?.goTo(key);
              }}
              disabled={status !== "ready"}
            >
              Walk through
            </button>
            <button
              type="button"
              className={`option-btn${mode === "dollhouse" ? " selected" : ""}`}
              aria-pressed={mode === "dollhouse"}
              onClick={() => sceneApi.current?.dollhouse()}
              disabled={status !== "ready"}
            >
              Dollhouse
            </button>
          </div>
        )}
        {mode === "dollhouse" && levels.length > 1 && (
          <div className="option-group" role="group" aria-label="Storey">
            <button type="button" className={`option-btn${level === "all" ? " selected" : ""}`} aria-pressed={level === "all"} onClick={() => setLevel("all")}>
              Whole house
            </button>
            {levels.map((l) => (
              <button key={l} type="button" className={`option-btn${level === l ? " selected" : ""}`} aria-pressed={level === l} onClick={() => setLevel(l)}>
                {levelLabel(l)}
              </button>
            ))}
          </div>
        )}
        {mode === "dollhouse" && (
          <button type="button" className={`option-btn${low ? " selected" : ""}`} aria-pressed={low} onClick={() => setLow((v) => !v)} title="Cut every wall at 4' to see into the rooms">
            Low walls
          </button>
        )}
        <span style={{ flex: 1 }} />
        {mode === "dollhouse" && (
          <button type="button" className="option-btn" onClick={() => sceneApi.current?.frame(level)} disabled={status !== "ready"}>
            Reset view
          </button>
        )}
        <button type="button" className="option-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <div ref={mountRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", touchAction: "none" }}>
        {status !== "ready" && (
          <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", margin: 0, color: "#5b6472" }}>
            {status === "loading" ? "Building the house in 3D…" : "This browser can't draw 3D here. Try Chrome or Safari on a recent device."}
          </p>
        )}
        {mode === "walk" && status === "ready" && (
          <FloorPlan
            sketch={sketch}
            level={walkLevel}
            points={navPoints}
            at={at}
            markerRef={markerRef}
            onPick={(x, z) => {
              const pose = poseRef.current;
              const v = destinationFor(navPoints, walkLevel, x, z, pose ? pose.yaw : null);
              if (v) sceneApi.current?.goTo(v.key);
            }}
          />
        )}
        {mode === "walk" && at?.spot != null && currentWalk && spotIndex >= 0 && (
          <div
            role="region"
            aria-label="Where you are on the walk"
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              transform: "translateX(-50%)",
              width: "min(560px, calc(100% - 24px))",
              background: "rgba(255,255,255,0.94)",
              borderRadius: 12,
              boxShadow: "0 6px 24px rgba(18,40,65,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontSize: 13, color: "#5b6472", flex: 1, minWidth: 160 }}>
              360° spot {spotIndex + 1} of {spots.length} · {stitching ? "stitching its photos together…" : "drag to look all the way round"}
              {walks.length > 1 ? ` · ${levelLabel(currentWalk.level)}` : ""}
            </span>
            <button type="button" className="option-btn" onClick={() => stepAlong(-1)} disabled={spotIndex === 0}>
              Previous
            </button>
            <button type="button" className="option-btn" onClick={() => stepAlong(1)} disabled={spotIndex + 1 >= spots.length}>
              Next
            </button>
          </div>
        )}
        {mode === "walk" && current && currentWalk && at && (
          <div
            role="region"
            aria-label="Where you are on the walk"
            style={{
              position: "absolute",
              left: "50%",
              bottom: 12,
              transform: "translateX(-50%)",
              width: "min(560px, calc(100% - 24px))",
              background: "rgba(255,255,255,0.94)",
              borderRadius: 12,
              boxShadow: "0 6px 24px rgba(18,40,65,0.22)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              flexWrap: "wrap",
            }}
          >
            {failed[`${at.walk}:${at.photo}`] && currentUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentUrl} alt={`Photo ${at.photo + 1} of the walk`} style={{ width: 72, height: 96, objectFit: "cover", borderRadius: 6 }} />
            )}
            <span style={{ fontSize: 13, color: "#5b6472", flex: 1, minWidth: 160 }}>
              Photo {at.photo + 1} of {currentWalk.photos.length} · {clock(current.tS)} into the walk
              {walks.length > 1 ? ` · ${levelLabel(currentWalk.level)}` : ""}
              {scanUrls && !currentUrl ? " · this photo hasn't arrived from the phone yet" : ""}
            </span>
            <button type="button" className="option-btn" onClick={() => stepAlong(-1)} disabled={at.photo === 0}>
              Previous
            </button>
            <button type="button" className="option-btn" onClick={() => stepAlong(1)} disabled={at.photo + 1 >= currentWalk.photos.length}>
              Next
            </button>
            {spots.length > 0 && (
              <button type="button" className="option-btn" onClick={toNearestSpot} title="Go to the nearest 360° spot">
                360°
              </button>
            )}
          </div>
        )}
      </div>
      <p className="field-note" style={{ margin: 0, padding: "8px 16px", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))", background: "#fff", borderTop: "1px solid var(--border, #e1e5ea)" }}>
        {mode === "walk"
          ? coarse
            ? "Drag to look around · tap the floor to go there · Previous and Next go through the walk in order"
            : "Drag to look around · tap the floor to go there · ↑ ↓ step forward and back · ← → through the walk in order · Esc for the dollhouse"
          : `Drag to turn · scroll or pinch to zoom · right-drag or two fingers to pan${points.length > 0 ? " · tap a ring on the floor to walk in from there" : ""}`}
      </p>
    </div>
  );
}

/**
 * The storey's plan in the corner of walk mode: its rooms, a dot for every photo, and where the view
 * stands with a wedge for which way it looks - moved by the render loop through [markerRef]'s
 * `data-pose`, read here on every animation frame. Tapping it goes to the photo nearest there.
 */
function FloorPlan({
  sketch,
  level,
  points,
  at,
  markerRef,
  onPick,
}: {
  sketch: Sketch;
  level: number;
  points: Viewpoint[];
  at: ViewpointKey | null;
  markerRef: React.RefObject<SVGGElement | null>;
  onPick: (x: number, z: number) => void;
}) {
  const rooms = useMemo(() => sketch.rooms.filter((r) => !r.stairs && roomLevel(r) === level && r.vertices.length >= 3), [sketch, level]);
  const box = useMemo(() => {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const r of rooms) for (const v of r.vertices) {
      minX = Math.min(minX, v.x / PIXELS_PER_FOOT);
      maxX = Math.max(maxX, v.x / PIXELS_PER_FOOT);
      minZ = Math.min(minZ, v.y / PIXELS_PER_FOOT);
      maxZ = Math.max(maxZ, v.y / PIXELS_PER_FOOT);
    }
    for (const p of points) if (p.level === level) {
      minX = Math.min(minX, p.position[0]);
      maxX = Math.max(maxX, p.position[0]);
      minZ = Math.min(minZ, p.position[2]);
      maxZ = Math.max(maxZ, p.position[2]);
    }
    if (!Number.isFinite(minX)) return null;
    const pad = 2;
    return { minX: minX - pad, minZ: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2 };
  }, [rooms, points, level]);
  const [pose, setPose] = useState<{ x: number; z: number; yaw: number } | null>(null);
  // Follow the view: the render loop writes where it stands on the marker, this reads it each frame.
  useEffect(() => {
    let raf = 0;
    let last = "";
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = markerRef.current?.getAttribute("data-pose") ?? "";
      if (s && s !== last) {
        last = s;
        const [x, z, yaw] = s.split(",").map(Number) as [number, number, number];
        setPose({ x, z, yaw });
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [markerRef]);
  if (!box) return null;
  const size = 190;
  const scale = size / Math.max(box.w, box.h);
  const W = box.w * scale;
  const H = box.h * scale;
  const sx = (x: number) => (x - box.minX) * scale;
  const sy = (z: number) => (z - box.minZ) * scale;
  // The view looks down its -z at yaw 0; on the plan that is up the page, and turning left is anticlockwise.
  const wedge = pose ? (-pose.yaw * 180) / Math.PI : 0;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Plan of this storey: where you are standing"
      onClick={(e) => {
        // Drawn smaller than its own size on a narrow screen: back to the plan's pixels first.
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const k = W / Math.max(1, rect.width);
        onPick(((e.clientX - rect.left) * k) / scale + box.minX, ((e.clientY - rect.top) * k) / scale + box.minZ);
      }}
      style={{
        position: "absolute",
        left: 12,
        top: 12,
        width: `min(${Math.round(W)}px, 30vw)`,
        height: "auto",
        background: "rgba(255,255,255,0.92)",
        borderRadius: 10,
        boxShadow: "0 4px 16px rgba(18,40,65,0.2)",
        cursor: "pointer",
      }}
    >
      {rooms.map((r) => (
        <polygon
          key={r.id}
          points={r.vertices.map((v) => `${sx(v.x / PIXELS_PER_FOOT)},${sy(v.y / PIXELS_PER_FOOT)}`).join(" ")}
          fill="#eef1f5"
          stroke="#1b3a5c"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      ))}
      {points
        .filter((p) => p.level === level)
        .map((p) => {
          const here = at != null && viewpointId(at) === viewpointId(p.key);
          return p.frames ? (
            <circle key={viewpointId(p.key)} cx={sx(p.position[0])} cy={sy(p.position[2])} r={here ? 0 : 4} fill="#fff" stroke="#1b3a5c" strokeWidth={1.5} />
          ) : (
            <circle key={viewpointId(p.key)} cx={sx(p.position[0])} cy={sy(p.position[2])} r={here ? 0 : 1.6} fill="#8a97a8" />
          );
        })}
      <g ref={markerRef}>
        {pose && (
          <g transform={`translate(${sx(pose.x)} ${sy(pose.z)}) rotate(${wedge})`}>
            <path d="M0 0 L-9 -22 A 24 24 0 0 1 9 -22 Z" fill="rgba(240,169,62,0.45)" />
            <circle r={4.5} fill="#f0a93e" stroke="#fff" strokeWidth={1.5} />
          </g>
        )}
      </g>
    </svg>
  );
}
