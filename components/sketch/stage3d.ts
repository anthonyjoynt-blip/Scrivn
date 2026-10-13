/**
 * What the house's two 3D views stand on (2026-10-13): the inside (Sketch3D.tsx) and the outside
 * (Exterior3D.tsx) are one stage - the same three.js, loaded only when a view opens; the same light,
 * background and camera; the same turn-and-zoom controls - so the two look and handle alike, and a
 * change to how the house is lit or turned is made once.
 */

export type Three = typeof import("three");

export interface ThreeLibs {
  THREE: Three;
  OrbitControls: typeof import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  CSS2DRenderer: typeof import("three/examples/jsm/renderers/CSS2DRenderer.js").CSS2DRenderer;
  CSS2DObject: typeof import("three/examples/jsm/renderers/CSS2DRenderer.js").CSS2DObject;
}

/** three.js and the two add-ons, loaded when a view opens so the claim page never carries them; null when they would not load. */
export async function loadThree(): Promise<ThreeLibs | null> {
  try {
    const THREE = await import("three");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    const { CSS2DRenderer, CSS2DObject } = await import("three/examples/jsm/renderers/CSS2DRenderer.js");
    return { THREE, OrbitControls, CSS2DRenderer, CSS2DObject };
  } catch {
    return null;
  }
}

export const STAGE_BACKGROUND = 0xf3f5f8;
/** The page behind a view, as CSS: the scene's own background. */
export const STAGE_BACKGROUND_CSS = "#f3f5f8";

export interface Stage {
  renderer: import("three").WebGLRenderer;
  /** The layer HTML labels are drawn in, over the scene. */
  labels: import("three/examples/jsm/renderers/CSS2DRenderer.js").CSS2DRenderer;
  scene: import("three").Scene;
  camera: import("three").PerspectiveCamera;
  /** Turn, zoom and pan, as the dollhouse has them. */
  controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
  /** Fits the drawing to [host] as it is now. */
  fit: () => void;
  dispose: () => void;
}

/** The renderer, the label layer, the lit scene, the camera and its controls, in [host]; null when the browser cannot draw WebGL. */
export function createStage(libs: ThreeLibs, host: HTMLElement): Stage | null {
  const { THREE, OrbitControls, CSS2DRenderer } = libs;
  let renderer: import("three").WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
  } catch {
    return null;
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
  scene.background = new THREE.Color(STAGE_BACKGROUND);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xe6e0d4, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(0.6, 1.4, 0.9);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-0.8, 0.7, -0.5);
  scene.add(fill);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 2;
  controls.maxDistance = 2000;
  // Zoom goes where the PM points, not to the middle of the house: a corner can be looked at.
  controls.zoomToCursor = true;

  const fit = () => {
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  return {
    renderer,
    labels,
    scene,
    camera,
    controls,
    fit,
    dispose: () => {
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}

export interface Box3 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/**
 * Where the camera looks at [b] from: to the south-east and above, all of it in view. [aimY] is the
 * height it looks at; [rise] how high it stands for its distance (the dollhouse looks down into the
 * rooms; the outside is looked at more from the side, as from the street); [reach] how far back it
 * stands for the house's size.
 */
export function framingOf(THREE: Three, b: Box3, aimY: number, rise = 0.75, reach = 1.25) {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 10);
  const distance = span * reach + (b.maxY - b.minY);
  return {
    target: new THREE.Vector3(cx, aimY, cz),
    position: new THREE.Vector3(cx + distance * 0.45, aimY + distance * rise, cz + distance * 0.7),
    distance,
  };
}

/** Puts the camera where [f] says, its near and far planes to suit. */
export function applyFraming(stage: Stage, f: ReturnType<typeof framingOf>): void {
  stage.controls.target.copy(f.target);
  stage.camera.position.copy(f.position);
  stage.camera.near = Math.max(0.1, f.distance / 500);
  stage.camera.far = f.distance * 20;
  stage.camera.updateProjectionMatrix();
  stage.controls.update();
}
