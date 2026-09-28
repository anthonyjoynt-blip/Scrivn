"use client";

/**
 * The house in 3D (2026-09-27), the first half of the walk-through: "Viewable in scrivn". A model of
 * the sketch the PM can turn and zoom - every room on every storey, walls standing where the plan
 * draws them, doorways cut through, stairs as steps - built by `houseModel` (lib/sketch3d.ts). The
 * photos the phone takes on its walk are pinned onto it next, where each was taken.
 *
 * three.js is loaded only when the view opens (dynamic imports), so the claim page never carries it.
 * Walls are drawn with navy tops: seen from above, the tops draw the plan the PM already knows.
 * "Low walls" cuts every wall at 4' above its floor - the dollhouse view, where the near walls stop
 * hiding the rooms and the doorways show as gaps.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { levelLabel, type Sketch } from "@/lib/sketch";
import { houseModel, type HouseModel, type PrismKind } from "@/lib/sketch3d";

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
};

/** How high "Low walls" leaves a wall standing, above its own floor. */
const LOW_WALL_FEET = 4;

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

export default function Sketch3D({ sketch, onClose }: Props) {
  const model = useMemo(() => houseModel(sketch), [sketch]);
  const levels = useMemo(() => [...new Set([...model.floors.map((f) => f.level), ...model.prisms.map((p) => p.level)])].sort((a, b) => b - a), [model]);
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [level, setLevel] = useState<number | "all">("all");
  const [low, setLow] = useState(false);
  const levelRef = useRef<number | "all">("all");
  // Where the camera was when the scene was last torn down, so "Low walls" does not throw the view away.
  const viewRef = useRef<View | null>(null);
  // What the scene exposes to the controls outside it, once it is built.
  const sceneApi = useRef<{ show: (level: number | "all") => void; frame: (level: number | "all") => void } | null>(null);

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

      const geometries: import("three").BufferGeometry[] = [];
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

      // Every prism: its footprint extruded from y0 to y1. The shape is drawn in (x, -z) so that,
      // stood up by a quarter turn about x, its extrusion runs up and its y lands back on z.
      for (const prism of model.prisms) {
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
        groupFor(prism.level).add(mesh);
      }
      model.floors.forEach((floor, i) => {
        if (floor.points.length < 3) return;
        const shape = new THREE.Shape(floor.points.map((p) => new THREE.Vector2(p.x, -p.z)));
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, floor.y, 0);
        geometries.push(geometry);
        const group = groupFor(floor.level);
        group.add(new THREE.Mesh(geometry, floorMaterials[i % floorMaterials.length]));
        if (floor.name.trim() !== "") {
          const div = document.createElement("div");
          div.textContent = floor.name;
          div.style.cssText =
            "font: 600 12px/1.2 var(--font-ui), system-ui, sans-serif; color: #1b3a5c; background: rgba(255,255,255,0.9);" +
            "padding: 2px 7px; border-radius: 999px; box-shadow: 0 1px 3px rgba(18,40,65,0.25); white-space: nowrap;";
          const label = new CSS2DObject(div);
          label.position.set(floor.labelAt.x, floor.labelAt.y, floor.labelAt.z);
          group.add(label);
        }
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 2;
      controls.maxDistance = 2000;
      // Zoom goes where the PM points, not to the middle of the house: a corner can be looked at.
      controls.zoomToCursor = true;

      /** Looks at [lvl]'s storey (or the whole house) from above and to the south-east, all of it in view. */
      const frame = (lvl: number | "all") => {
        const b = boundsOf(model, lvl);
        if (!b) return;
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const cy = lvl === "all" ? (b.minY + b.maxY) / 2 : b.minY + 2;
        const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 10);
        const distance = span * 1.25 + (b.maxY - b.minY);
        controls.target.set(cx, cy, cz);
        camera.position.set(cx + distance * 0.45, cy + distance * 0.75, cz + distance * 0.7);
        camera.near = Math.max(0.1, distance / 500);
        camera.far = distance * 20;
        camera.updateProjectionMatrix();
        controls.update();
      };
      const show = (lvl: number | "all") => {
        for (const [key, group] of groups) group.visible = lvl === "all" || key === lvl;
      };

      const resize = () => {
        const w = Math.max(1, host.clientWidth);
        const h = Math.max(1, host.clientHeight);
        renderer.setSize(w, h);
        labels.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);
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

      let raf = 0;
      const loop = () => {
        raf = requestAnimationFrame(loop);
        controls.update();
        renderer.render(scene, camera);
        labels.render(scene, camera);
      };
      loop();

      sceneApi.current = { show, frame };
      setStatus("ready");

      teardown = () => {
        viewRef.current = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
        cancelAnimationFrame(raf);
        observer.disconnect();
        controls.dispose();
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
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
  }, [model, low]);

  useEffect(() => {
    levelRef.current = level;
    sceneApi.current?.show(level);
    sceneApi.current?.frame(level);
  }, [level]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        {levels.length > 1 && (
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
        <button type="button" className={`option-btn${low ? " selected" : ""}`} aria-pressed={low} onClick={() => setLow((v) => !v)} title="Cut every wall at 4' to see into the rooms">
          Low walls
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="option-btn" onClick={() => sceneApi.current?.frame(level)} disabled={status !== "ready"}>
          Reset view
        </button>
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
      </div>
      <p className="field-note" style={{ margin: 0, padding: "8px 16px", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))", background: "#fff", borderTop: "1px solid var(--border, #e1e5ea)" }}>
        Drag to turn · scroll or pinch to zoom · right-drag or two fingers to pan
      </p>
    </div>
  );
}
