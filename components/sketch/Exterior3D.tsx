"use client";

/**
 * The outside of the house in 3D (2026-10-13): "once roof and siding are captured, could Scrivn render
 * a 3D view" (the owner). The model is lib/exterior3d.ts - the sides as measured, standing on the
 * footprint they close into, up to the underside of the roof `buildRoof` works out - and this draws
 * it on the same stage as the inside's 3D view (stage3d.ts): turn it, zoom it, pan it.
 *
 * Each wall is painted with its cladding as the elevation draws it - each shape or band in its
 * material's colour, a later shape over an earlier one - and its windows, doors and garage doors are
 * set into it: the opening cut through, the pane or panel a few inches back. "Lines" shows the roof's
 * ridges, hips and valleys in the roof plan's colours, and each slope's letter. "Photos" lays each side's
 * photos from Scrivn Scan on its wall, squared up as the elevation has them (SidePhotos.tsx), where the
 * side has any; the cladding shows wherever no photo does.
 *
 * The inside's rooms are not drawn in this shell: a scan of the outside and a scan of the rooms are two
 * walks of the phone, each in its own frame, and nothing yet says how one sits in the other.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Exterior, RoofMaterial } from "@/lib/exterior";
import { exteriorModel, POST_SIZE_FEET, type Wall3D } from "@/lib/exterior3d";
import type { SquareFrame } from "@/lib/exteriorPhoto";
import type { Pt } from "@/lib/roof";
import { CLADDING_FILL, LINE_STYLE } from "./exteriorDrawings";
import { squaredWallPhoto } from "./SidePhotos";
import { applyFraming, createStage, framingOf, loadThree, STAGE_BACKGROUND_CSS, type Three } from "./stage3d";

interface Props {
  exterior: Exterior;
  onClose: () => void;
}

const COLORS = {
  /** Wall a side tapped as shapes has no shape over: not counted, so not given a cladding. */
  unclad: "#f1f0ec",
  parging: "#c9ccd1",
  /** Wall below the ground a side was measured from, where the ground round it dips lower. */
  foundation: "#b4b7bb",
  outline: "rgba(55, 65, 81, 0.35)",
  ground: 0xdfe5d4,
  soffit: 0xf2f0eb,
  fascia: 0xf7f6f3,
  reveal: 0xe2e0db,
  frame: 0xf8f8f6,
  glass: 0x50677b,
  door: 0x8f735a,
  garage: 0xeeede9,
  groove: 0xbdbcb7,
  post: 0xf4f3ef,
};

/** The roof's colour by its material; muted, as the cladding is. */
const ROOF_COLOR: Record<RoofMaterial | "unknown", number> = {
  three_tab: 0x5e6266,
  composite: 0x5a5e63,
  metal: 0x7f8b96,
  tile: 0xa5735c,
  cedar_shake: 0x86684c,
  unknown: 0x62666b,
};

/** How far a pane or a door stands back from the face of its wall. */
const RECESS_FEET = 0.33;
const FRAME_FEET = 0.12;
/** The most a wall's painting is across, so a long wall stays light on a phone. */
const MAX_PAINT_PX = 1024;

/** Siding laid in courses: its lap lines, a course apart. */
const COURSE_FEET: Partial<Record<keyof typeof CLADDING_FILL, number>> = { vinyl: 0.5, wood: 0.55, fibre_cement: 0.6, metal: 0.75, wood_shake: 0.6, brick: 0.25 };

/** One wall's cladding as a picture: what its texture is, and its scale (pixels a foot, v at its top) for laying a photo on it. */
function paintWall(wall: Wall3D): { canvas: HTMLCanvasElement; minV: number; maxV: number; height: number; ppf: number } {
  const ys = wall.outline.map((p) => p.y);
  const minV = Math.min(...ys);
  const maxV = Math.max(...ys);
  const height = Math.max(0.5, maxV - minV);
  const ppf = Math.max(4, Math.min(24, MAX_PAINT_PX / Math.max(wall.length, height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.ceil(wall.length * ppf));
  canvas.height = Math.max(2, Math.ceil(height * ppf));
  const g = canvas.getContext("2d");
  if (!g) return { canvas, minV, maxV, height, ppf };
  const X = (u: number) => u * ppf;
  const Y = (v: number) => (maxV - v) * ppf;
  const path = (poly: Pt[]) => {
    g.beginPath();
    poly.forEach((p, i) => (i === 0 ? g.moveTo(X(p.x), Y(p.y)) : g.lineTo(X(p.x), Y(p.y))));
    g.closePath();
  };
  g.fillStyle = wall.background === "unclad" ? COLORS.unclad : CLADDING_FILL[wall.background];
  g.fillRect(0, 0, canvas.width, canvas.height);
  // Under the ground it was measured from, the foundation: shown only where the ground round the house is lower.
  if (wall.grade && wall.grade.length >= 2) {
    path([...wall.grade, { x: wall.length, y: minV - 1 }, { x: 0, y: minV - 1 }]);
    g.fillStyle = COLORS.foundation;
    g.fill();
  }
  for (const f of wall.faces) {
    if (f.poly.length < 3) continue;
    path(f.poly);
    g.fillStyle = f.kind === "parging" ? COLORS.parging : CLADDING_FILL[f.kind];
    g.fill();
    const course = f.kind === "parging" ? undefined : COURSE_FEET[f.kind];
    if (course && course * ppf >= 4) {
      g.save();
      path(f.poly);
      g.clip();
      g.strokeStyle = "rgba(40, 45, 55, 0.13)";
      g.lineWidth = 1;
      g.beginPath();
      for (let v = Math.floor(minV / course) * course; v <= maxV; v += course) {
        g.moveTo(0, Y(v));
        g.lineTo(canvas.width, Y(v));
      }
      g.stroke();
      g.restore();
    }
    path(f.poly);
    g.strokeStyle = COLORS.outline;
    g.lineWidth = 1;
    g.stroke();
  }
  return { canvas, minV, maxV, height, ppf };
}

const FEET_PER_METRE = 1 / 0.3048;

/** The wall's painting with its side's squared photo laid over it, where the photo shows the wall. */
function withPhoto(wall: Wall3D, paint: ReturnType<typeof paintWall>, photo: { frame: SquareFrame; canvas: HTMLCanvasElement }): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = paint.canvas.width;
  canvas.height = paint.canvas.height;
  const g = canvas.getContext("2d");
  if (!g) return paint.canvas;
  g.drawImage(paint.canvas, 0, 0);
  // The photo's frame is in the side's own metres: along from its left end, up from its zero (v = frameV).
  const f = photo.frame;
  const left = f.alongMinM * FEET_PER_METRE * paint.ppf;
  const top = (paint.maxV - (wall.frameV + f.upMaxM * FEET_PER_METRE)) * paint.ppf;
  g.drawImage(photo.canvas, left, top, (f.alongMaxM - f.alongMinM) * FEET_PER_METRE * paint.ppf, (f.upMaxM - f.upMinM) * FEET_PER_METRE * paint.ppf);
  return canvas;
}

/** The wall's top over [x0, x1]: the lowest of its outline's top there. */
function topOver(wall: Wall3D, x0: number, x1: number): number {
  const top = wall.outline.slice(2);
  let low = Infinity;
  for (let i = 0; i + 1 < top.length; i++) {
    const p = top[i] as Pt;
    const q = top[i + 1] as Pt;
    const a = Math.min(p.x, q.x);
    const b = Math.max(p.x, q.x);
    if (b < x0 || a > x1) continue;
    const at = (x: number) => (Math.abs(q.x - p.x) < 1e-9 ? Math.min(p.y, q.y) : p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x));
    low = Math.min(low, at(Math.max(a, x0)), at(Math.min(b, x1)));
  }
  return low;
}

/** Each opening as it can be cut: inside its wall, and not over one already cut. */
function cuttable(wall: Wall3D) {
  const bottom = Math.min(...wall.outline.map((p) => p.y));
  const kept: { kind: Wall3D["openings"][number]["kind"]; x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const o of wall.openings) {
    const x0 = Math.max(o.x0, 0.05);
    const x1 = Math.min(o.x1, wall.length - 0.05);
    const y0 = Math.max(o.y0, bottom + 0.05);
    const y1 = Math.min(o.y1, topOver(wall, x0, x1) - 0.05);
    if (x1 - x0 < 0.2 || y1 - y0 < 0.2) continue;
    if (kept.some((k) => x0 < k.x1 + 0.02 && x1 > k.x0 - 0.02 && y0 < k.y1 + 0.02 && y1 > k.y0 - 0.02)) continue;
    kept.push({ kind: o.kind, x0, x1, y0, y1 });
  }
  return kept;
}

/** Triangles for what goes in the openings, by what each piece is made of. */
type Parts = Record<"reveal" | "glass" | "door" | "garage" | "frame" | "groove", number[]>;

function openingParts(wall: Wall3D, cut: ReturnType<typeof cuttable>, parts: Parts) {
  const w3 = (u: number, v: number, w: number) => [
    wall.origin[0] + wall.along[0] * u + wall.out[0] * w,
    v,
    wall.origin[2] + wall.along[2] * u + wall.out[2] * w,
  ];
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...a, ...c, ...d);
  const flat = (out: number[], x0: number, y0: number, x1: number, y1: number, w: number) => quad(out, w3(x0, y0, w), w3(x1, y0, w), w3(x1, y1, w), w3(x0, y1, w));
  const D = RECESS_FEET;
  for (const o of cut) {
    const { x0, x1, y0, y1 } = o;
    // The reveal: jambs, head and sill, from the face back to the pane.
    quad(parts.reveal, w3(x0, y0, 0), w3(x0, y1, 0), w3(x0, y1, -D), w3(x0, y0, -D));
    quad(parts.reveal, w3(x1, y0, 0), w3(x1, y0, -D), w3(x1, y1, -D), w3(x1, y1, 0));
    quad(parts.reveal, w3(x0, y1, 0), w3(x1, y1, 0), w3(x1, y1, -D), w3(x0, y1, -D));
    quad(parts.reveal, w3(x0, y0, 0), w3(x0, y0, -D), w3(x1, y0, -D), w3(x1, y0, 0));
    const pane = o.kind === "window" ? parts.glass : o.kind === "door" ? parts.door : parts.garage;
    flat(pane, x0, y0, x1, y1, -D);
    const w = -D + 0.02;
    if (o.kind === "garage") {
      // Four sections, a groove between each.
      for (let k = 1; k < 4; k++) {
        const y = y0 + ((y1 - y0) * k) / 4;
        flat(parts.groove, x0, y - 0.03, x1, y + 0.03, w);
      }
      continue;
    }
    const F = Math.min(FRAME_FEET, (x1 - x0) / 4, (y1 - y0) / 4);
    flat(parts.frame, x0, y0, x1, y0 + F, w);
    flat(parts.frame, x0, y1 - F, x1, y1, w);
    flat(parts.frame, x0, y0, x0 + F, y1, w);
    flat(parts.frame, x1 - F, y0, x1, y1, w);
  }
}

export default function Exterior3D({ exterior, onClose }: Props) {
  const result = useMemo(() => exteriorModel(exterior), [exterior]);
  const model = result.ok ? result.model : null;
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [showLines, setShowLines] = useState(false);
  const showLinesRef = useRef(showLines);
  showLinesRef.current = showLines;
  const [showPhotos, setShowPhotos] = useState(false);
  const showPhotosRef = useRef(showPhotos);
  showPhotosRef.current = showPhotos;
  // The sides whose photos could not be laid on, and why, while Photos is on.
  const [photoTrouble, setPhotoTrouble] = useState<string | null>(null);
  const hasPhotos = !!model?.walls.some((w) => w.photos.some((p) => p.scanId));
  const api = useRef<{ frame: () => void; lines: (on: boolean) => void; photos: (on: boolean) => void } | null>(null);

  useEffect(() => {
    const host = mountRef.current;
    if (!host || !model) return;
    let disposed = false;
    let teardown: (() => void) | null = null;
    (async () => {
      const libs = await loadThree();
      if (!libs) {
        if (!disposed) setStatus("failed");
        return;
      }
      if (disposed) return;
      const { THREE, CSS2DObject } = libs;
      const stage = createStage(libs, host);
      if (!stage) {
        setStatus("failed");
        return;
      }
      const { renderer, labels, scene, camera, controls } = stage;
      const geometries: import("three").BufferGeometry[] = [];
      const materials: import("three").Material[] = [];
      const textures: import("three").Texture[] = [];
      const standard = (color: number, extra: Record<string, unknown> = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, ...extra });
        materials.push(m);
        return m;
      };
      const mesh = (positions: number[], material: import("three").Material) => {
        if (positions.length === 0) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        g.computeVertexNormals();
        geometries.push(g);
        const m = new THREE.Mesh(g, material);
        scene.add(m);
        return m;
      };

      // ---- The walls, each painted with its cladding, its openings cut through -------------------
      const parts: Parts = { reveal: [], glass: [], door: [], garage: [], frame: [], groove: [] };
      const photographed: { wall: Wall3D; paint: ReturnType<typeof paintWall>; texture: import("three").CanvasTexture }[] = [];
      for (const wall of model.walls) {
        if (wall.outline.length < 3 || wall.length < 0.05) continue;
        const cut = cuttable(wall);
        const shape = new THREE.Shape(wall.outline.map((p) => new THREE.Vector2(p.x, p.y)));
        for (const o of cut) {
          shape.holes.push(new THREE.Path([new THREE.Vector2(o.x0, o.y0), new THREE.Vector2(o.x1, o.y0), new THREE.Vector2(o.x1, o.y1), new THREE.Vector2(o.x0, o.y1)]));
        }
        const geometry = new THREE.ShapeGeometry(shape);
        const paint = paintWall(wall);
        const uv = geometry.getAttribute("uv");
        const pos = geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / wall.length, (pos.getY(i) - paint.minV) / paint.height);
        uv.needsUpdate = true;
        const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...wall.along), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...wall.out));
        basis.setPosition(...wall.origin);
        geometry.applyMatrix4(basis);
        geometries.push(geometry);
        const texture = new THREE.CanvasTexture(paint.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        textures.push(texture);
        scene.add(new THREE.Mesh(geometry, standard(0xffffff, { map: texture })));
        openingParts(wall, cut, parts);
        if (wall.photos.some((p) => p.scanId)) photographed.push({ wall, paint, texture });
      }
      mesh(parts.reveal, standard(COLORS.reveal));
      mesh(parts.glass, standard(COLORS.glass, { roughness: 0.18, metalness: 0.35 }));
      mesh(parts.door, standard(COLORS.door));
      mesh(parts.garage, standard(COLORS.garage));
      mesh(parts.frame, standard(COLORS.frame));
      mesh(parts.groove, standard(COLORS.groove));

      // ---- The roof ------------------------------------------------------------------------------
      const roof = model.roof;
      const lineGroup = new THREE.Group();
      const letters: { obj: import("three").Object3D; normal: import("three").Vector3 }[] = [];
      if (roof) {
        mesh(roof.top, standard(ROOF_COLOR[exterior.roof.material ?? "unknown"], { roughness: 0.85 }));
        mesh(roof.under, standard(COLORS.soffit));
        mesh(roof.fascia, standard(COLORS.fascia));
        const siding = standard(0xffffff, { color: CLADDING_FILL[mainKind(model.walls)] });
        mesh(roof.gables, siding);
        mesh(roof.steps, siding);
        // Ridges, hips and valleys, a little proud of the slopes, and the slopes' letters.
        for (const l of roof.lines) {
          const a = new THREE.Vector3(...l.a);
          const b = new THREE.Vector3(...l.b);
          const len = a.distanceTo(b);
          if (len < 1e-3) continue;
          const g = new THREE.CylinderGeometry(0.09, 0.09, len, 6);
          geometries.push(g);
          const m = new THREE.MeshBasicMaterial({ color: LINE_STYLE[l.kind].stroke });
          materials.push(m);
          const rod = new THREE.Mesh(g, m);
          rod.position.copy(a).add(b).multiplyScalar(0.5);
          rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          lineGroup.add(rod);
        }
        for (const l of roof.labels) {
          const div = document.createElement("div");
          div.textContent = l.text;
          div.style.cssText =
            "font: 700 12px/1.2 var(--font-ui), system-ui, sans-serif; color: #1b3a5c; background: rgba(255,255,255,0.92);" +
            "padding: 1px 6px; border-radius: 999px; box-shadow: 0 1px 3px rgba(18,40,65,0.25);";
          const label = new CSS2DObject(div);
          label.position.set(...l.at);
          lineGroup.add(label);
          letters.push({ obj: label, normal: new THREE.Vector3(...l.normal) });
        }
      }
      lineGroup.visible = showLinesRef.current;
      scene.add(lineGroup);
      mesh(model.ceilings, standard(COLORS.soffit));
      // Posts: square, from the ground to the roof.
      for (const p of model.posts) {
        const h = p.y1 - p.y0;
        if (!(h > 0.1)) continue;
        const g = new THREE.BoxGeometry(POST_SIZE_FEET, h, POST_SIZE_FEET);
        g.translate(p.x, p.y0 + h / 2, p.z);
        geometries.push(g);
        scene.add(new THREE.Mesh(g, standard(COLORS.post)));
      }

      // ---- The ground, through each side's ground line, fading out at its edge ---------------------
      scene.add(groundMesh(THREE, model.ground, geometries, materials));

      const b = model.bounds;
      // From the street at the front right, a little above the eaves, the whole house in view - on a phone held upright
      // too, whose view is narrower across than it is high: further back for it.
      const frame = () => applyFraming(stage, framingOf(THREE, b, (b.minY + b.maxY) / 2, 0.35, 1.15 * Math.max(1, 1.5 / camera.aspect)));
      const observer = new ResizeObserver(stage.fit);
      observer.observe(host);
      stage.fit();
      frame();

      let raf = 0;
      const toCamera = new THREE.Vector3();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        controls.update();
        // A slope's letter only from the side it is on: one on a slope facing away would show through the roof.
        if (lineGroup.visible) for (const l of letters) l.obj.visible = toCamera.subVectors(camera.position, l.obj.position).dot(l.normal) > 0;
        renderer.render(scene, camera);
        labels.render(scene, camera);
      };
      loop();
      api.current = {
        frame,
        // The label layer hides the letters with the group they are in.
        lines: (on) => {
          lineGroup.visible = on;
        },
        photos: (on) => {
          const trouble: string[] = [];
          let waiting = 0;
          for (const p of photographed) {
            const side = exterior.sides.find((s) => s.id === p.wall.sideId);
            const job = on && side ? squaredWallPhoto(side) : null;
            if (!job) {
              p.texture.image = p.paint.canvas;
              p.texture.needsUpdate = true;
              continue;
            }
            waiting += 1;
            job.then(
              (photo) => {
                if (disposed || !showPhotosRef.current) return;
                p.texture.image = withPhoto(p.wall, p.paint, photo);
                p.texture.needsUpdate = true;
              },
              (err: unknown) => {
                if (disposed || !showPhotosRef.current) return;
                trouble.push(`${p.wall.name}: ${err instanceof Error ? err.message : "its photo could not be laid on."}`);
                setPhotoTrouble(trouble.join(" "));
              },
            );
          }
          if (!on || waiting === 0) setPhotoTrouble(null);
        },
      };
      api.current.lines(showLinesRef.current);
      if (showPhotosRef.current) api.current.photos(true);
      setStatus("ready");
      teardown = () => {
        cancelAnimationFrame(raf);
        observer.disconnect();
        for (const g of geometries) g.dispose();
        for (const m of materials) m.dispose();
        for (const t of textures) t.dispose();
        stage.dispose();
        api.current = null;
      };
    })();
    return () => {
      disposed = true;
      teardown?.();
    };
  }, [model, exterior.roof.material, exterior.sides]);

  useEffect(() => {
    api.current?.lines(showLines);
  }, [showLines]);

  useEffect(() => {
    api.current?.photos(showPhotos);
  }, [showPhotos]);

  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="3D view of the outside of the house"
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: STAGE_BACKGROUND_CSS, display: "flex", flexDirection: "column" }}
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
        {model?.roof && (
          <button
            type="button"
            className={`option-btn${showLines ? " selected" : ""}`}
            aria-pressed={showLines}
            onClick={() => setShowLines((v) => !v)}
            title={showLines ? "Hide the roof's lines and letters" : "Show the ridges, hips and valleys, and each slope's letter"}
          >
            Lines
          </button>
        )}
        {hasPhotos && (
          <button
            type="button"
            className={`option-btn${showPhotos ? " selected" : ""}`}
            aria-pressed={showPhotos}
            onClick={() => setShowPhotos((v) => !v)}
            title={showPhotos ? "Show the cladding as measured" : "Lay each side's photos from Scrivn Scan on its wall"}
          >
            Photos
          </button>
        )}
        <span style={{ flex: 1 }} />
        {model && (
          <button type="button" className="option-btn" onClick={() => api.current?.frame()} disabled={status !== "ready"}>
            Reset view
          </button>
        )}
        <button type="button" className="option-btn" onClick={close}>
          Close
        </button>
      </div>
      <div ref={mountRef} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", touchAction: "none" }}>
        {(!model || status !== "ready") && (
          <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", margin: 0, padding: "0 24px", textAlign: "center", color: "#5b6472" }}>
            {!result.ok
              ? `Nothing to stand up yet. ${result.reason}`
              : status === "loading"
                ? "Building the house in 3D…"
                : "This browser can't draw 3D here. Try Chrome or Safari on a recent device."}
          </p>
        )}
      </div>
      <p className="field-note" style={{ margin: 0, padding: "8px 16px", paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))", background: "#fff", borderTop: "1px solid var(--border, #e1e5ea)" }}>
        Drag to turn · scroll or pinch to zoom · right-drag or two fingers to pan
        {model && model.notes.length > 0 ? ` · ${model.notes.join(" ")}` : ""}
        {showPhotos && photoTrouble ? ` · ${photoTrouble}` : ""}
      </p>
    </div>
  );
}

/** The cladding most of the house is in, for the faces of siding the roof brings. */
function mainKind(walls: Wall3D[]): keyof typeof CLADDING_FILL {
  const area = new Map<keyof typeof CLADDING_FILL, number>();
  for (const w of walls) {
    for (const f of w.faces) {
      if (f.kind === "parging" || f.poly.length < 3) continue;
      let a = 0;
      for (let i = 0; i < f.poly.length; i++) {
        const p = f.poly[i] as Pt;
        const q = f.poly[(i + 1) % f.poly.length] as Pt;
        a += p.x * q.y - q.x * p.y;
      }
      area.set(f.kind, (area.get(f.kind) ?? 0) + Math.abs(a) / 2);
    }
  }
  let best: keyof typeof CLADDING_FILL = "stucco";
  for (const [k, a] of area) if (a > (area.get(best) ?? 0)) best = k;
  return best;
}

/** The ground as a mesh: the model's grid of heights, solid round the house and fading into the background at its edge. */
function groundMesh(THREE: Three, ground: { x0: number; z0: number; step: number; nx: number; nz: number; heights: number[] }, geometries: import("three").BufferGeometry[], materials: import("three").Material[]) {
  const { x0, z0, step, nx, nz, heights } = ground;
  const positions: number[] = [];
  const colors: number[] = [];
  const c = new THREE.Color(COLORS.ground);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      positions.push(x0 + i * step, heights[j * nx + i] as number, z0 + j * step);
      // Solid over the middle half each way, then fading to nothing at the edge.
      const edge = Math.min(i, nx - 1 - i, j, nz - 1 - j) / (Math.min(nx, nz) / 4);
      const alpha = Math.max(0, Math.min(1, edge));
      colors.push(c.r, c.g, c.b, alpha * alpha * (3 - 2 * alpha));
    }
  }
  const index: number[] = [];
  for (let j = 0; j + 1 < nz; j++) {
    for (let i = 0; i + 1 < nx; i++) {
      const a = j * nx + i;
      // Wound to face up: x across, z toward the view.
      index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
  g.setIndex(index);
  g.computeVertexNormals();
  geometries.push(g);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, transparent: true, roughness: 1, metalness: 0 });
  materials.push(m);
  return new THREE.Mesh(g, m);
}
