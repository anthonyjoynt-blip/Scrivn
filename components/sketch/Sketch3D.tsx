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
 *
 * THE WALK'S PHOTOS (`sketch.walks`, placed when the scan was adopted) stand as pins where the phone
 * was, each with a cone for the way it faced. Tapping one opens its photo; Previous and Next step
 * through the walk in the order it was taken, the view following the pin. The pictures are fetched by
 * scan when the view opens (`/api/scans/<id>/photos`); a pin whose photo has not arrived from the
 * phone says so.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { levelLabel, PIXELS_PER_FOOT, type Sketch } from "@/lib/sketch";
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
/** Where a pin stands when the phone did not know how high it was: eye level. */
const PIN_HEIGHT_FEET = 5;
const PIN_COLOR = 0x1b3a5c;
const PIN_SELECTED = 0xf0a93e;
/** A tap this close to a pin, in screen pixels, opens it: a pin is a few pixels across seen from the door, and a finger is not. */
const PICK_RADIUS_PX = 18;

/** One photo of one walk: [walk] indexes `sketch.walks`, [photo] its photos (in the order taken). */
type PhotoKey = { walk: number; photo: number };
const keyOf = (k: PhotoKey) => `${k.walk}:${k.photo}`;

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
  const walks = useMemo(() => sketch.walks ?? [], [sketch]);
  const [selected, setSelected] = useState<PhotoKey | null>(null);
  // Signed links to each scan's photos, by scan id then photo number.
  const [urls, setUrls] = useState<Record<string, Record<number, string>>>({});
  const levelRef = useRef<number | "all">("all");
  // Where the camera was when the scene was last torn down, so "Low walls" does not throw the view away.
  const viewRef = useRef<View | null>(null);
  // What the scene exposes to the controls outside it, once it is built.
  const sceneApi = useRef<{
    show: (level: number | "all") => void;
    frame: (level: number | "all") => void;
    highlight: (key: PhotoKey | null) => void;
    focus: (key: PhotoKey) => void;
  } | null>(null);
  const selectedRef = useRef<PhotoKey | null>(null);

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

      // The walk's photos: a pin where the phone stood, a cone the way it faced.
      const pinMaterial = standard(PIN_COLOR, { roughness: 0.5 });
      const pinSelected = standard(PIN_SELECTED, { roughness: 0.5 });
      const pins = new Map<string, import("three").Mesh[]>();
      const spots: { key: PhotoKey; at: import("three").Vector3; level: number }[] = [];
      const pinPosition = (k: PhotoKey) => {
        const walk = walks[k.walk];
        const photo = walk?.photos[k.photo];
        if (!walk || !photo) return null;
        return new THREE.Vector3(photo.x / PIXELS_PER_FOOT, baseOf(walk.level) + (photo.heightFeet ?? PIN_HEIGHT_FEET), photo.y / PIXELS_PER_FOOT);
      };
      const sphereGeometry = new THREE.SphereGeometry(0.4, 16, 12);
      const coneGeometry = new THREE.ConeGeometry(0.22, 0.9, 12);
      // The cone's point is its +y; turned to +x it is the page's heading 0.
      coneGeometry.rotateZ(-Math.PI / 2);
      coneGeometry.translate(0.75, 0, 0);
      geometries.push(sphereGeometry, coneGeometry);
      walks.forEach((walk, wi) => {
        walk.photos.forEach((photo, pi) => {
          const key: PhotoKey = { walk: wi, photo: pi };
          const at = pinPosition(key);
          if (!at) return;
          const pin = new THREE.Group();
          pin.position.copy(at);
          const ball = new THREE.Mesh(sphereGeometry, pinMaterial);
          const cone = new THREE.Mesh(coneGeometry, pinMaterial);
          // Heading on the page (0 right, 90 down) is a turn about up that takes +x to +z.
          cone.rotation.set(0, -(photo.headingDeg * Math.PI) / 180, ((photo.pitchDeg ?? 0) * Math.PI) / 180, "YZX");
          spots.push({ key, at, level: walk.level });
          pin.add(ball, cone);
          pins.set(keyOf(key), [ball, cone]);
          groupFor(walk.level).add(pin);
        });
      });
      const highlight = (key: PhotoKey | null) => {
        for (const [k, meshes] of pins) for (const m of meshes) m.material = key && k === keyOf(key) ? pinSelected : pinMaterial;
      };

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
      let glide: { from: import("three").Vector3; to: import("three").Vector3; start: number } | null = null;
      const focus = (key: PhotoKey) => {
        const at = pinPosition(key);
        if (!at) return;
        glide = { from: controls.target.clone(), to: at, start: performance.now() };
      };

      // A tap near a pin opens its photo - the nearest on screen, on a storey in view; a drag is the camera's.
      let down: { x: number; y: number } | null = null;
      const onDown = (e: PointerEvent) => {
        down = { x: e.clientX, y: e.clientY };
      };
      const onUp = (e: PointerEvent) => {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
          down = null;
          return;
        }
        down = null;
        const rect = renderer.domElement.getBoundingClientRect();
        let best: { key: PhotoKey; d: number } | null = null;
        for (const spot of spots) {
          if (groups.get(spot.level)?.visible === false) continue;
          const ndc = spot.at.clone().project(camera);
          if (ndc.z < -1 || ndc.z > 1) continue;
          const sx = rect.left + ((ndc.x + 1) / 2) * rect.width;
          const sy = rect.top + ((1 - ndc.y) / 2) * rect.height;
          const d = Math.hypot(sx - e.clientX, sy - e.clientY);
          if (d <= PICK_RADIUS_PX && (!best || d < best.d)) best = { key: spot.key, d };
        }
        if (best) setSelected(best.key);
      };
      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointerup", onUp);

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
        if (glide) {
          const t = Math.min(1, (performance.now() - glide.start) / 350);
          const ease = t * (2 - t);
          const next = glide.from.clone().lerp(glide.to, ease);
          camera.position.add(next.clone().sub(controls.target));
          controls.target.copy(next);
          if (t >= 1) glide = null;
        }
        controls.update();
        renderer.render(scene, camera);
        labels.render(scene, camera);
      };
      loop();

      sceneApi.current = { show, frame, highlight, focus };
      highlight(selectedRef.current);
      setStatus("ready");

      teardown = () => {
        viewRef.current = {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        };
        cancelAnimationFrame(raf);
        observer.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointerup", onUp);
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
  }, [model, low, walks]);

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
    selectedRef.current = selected;
    sceneApi.current?.highlight(selected);
    if (selected) sceneApi.current?.focus(selected);
  }, [selected]);

  const photoCount = walks.reduce((n, w) => n + w.photos.length, 0);
  const current = selected ? walks[selected.walk]?.photos[selected.photo] ?? null : null;
  const currentWalk = selected ? walks[selected.walk] ?? null : null;
  const currentUrl = current && currentWalk ? urls[currentWalk.scanId]?.[current.n] ?? null : null;
  const step = (by: number) => {
    if (!selected || !currentWalk) return;
    const next = selected.photo + by;
    if (next < 0 || next >= currentWalk.photos.length) return;
    setSelected({ walk: selected.walk, photo: next });
  };
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  useEffect(() => {
    levelRef.current = level;
    sceneApi.current?.show(level);
    sceneApi.current?.frame(level);
  }, [level]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedRef.current) setSelected(null);
        else onClose();
      } else if (e.key === "ArrowRight" && selectedRef.current) {
        const k = selectedRef.current;
        setSelected((prev) => (prev && k.photo + 1 < (walks[k.walk]?.photos.length ?? 0) ? { walk: k.walk, photo: k.photo + 1 } : prev));
      } else if (e.key === "ArrowLeft" && selectedRef.current) {
        const k = selectedRef.current;
        setSelected((prev) => (prev && k.photo > 0 ? { walk: k.walk, photo: k.photo - 1 } : prev));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, walks]);

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
        {current && currentWalk && selected && (
          <div
            role="region"
            aria-label="Photo from the walk"
            style={{
              position: "absolute",
              right: 12,
              bottom: 12,
              width: "min(420px, calc(100% - 24px))",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 6px 24px rgba(18,40,65,0.25)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ background: "#122841", aspectRatio: "4 / 3", display: "grid", placeItems: "center" }}>
              {currentUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={currentUrl} alt={`Photo ${selected.photo + 1} of the walk`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
              ) : (
                <p style={{ color: "#dce4ee", margin: 16, textAlign: "center" }}>This photo hasn't arrived from the phone yet.</p>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#5b6472", flex: 1, minWidth: 140 }}>
                Photo {selected.photo + 1} of {currentWalk.photos.length} · {clock(current.tS)} into the walk
                {walks.length > 1 ? ` · ${levelLabel(currentWalk.level)}` : ""}
              </span>
              <button type="button" className="option-btn" onClick={() => step(-1)} disabled={selected.photo === 0}>
                Previous
              </button>
              <button type="button" className="option-btn" onClick={() => step(1)} disabled={selected.photo + 1 >= currentWalk.photos.length}>
                Next
              </button>
              <button type="button" className="option-btn" onClick={() => setSelected(null)} aria-label="Close the photo">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="field-note" style={{ margin: 0, padding: "8px 16px", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))", background: "#fff", borderTop: "1px solid var(--border, #e1e5ea)" }}>
        Drag to turn · scroll or pinch to zoom · right-drag or two fingers to pan
        {photoCount > 0 ? ` · tap a pin to see the photo taken there (${photoCount} on this walk${walks.length > 1 ? "s" : ""})` : ""}
      </p>
    </div>
  );
}
