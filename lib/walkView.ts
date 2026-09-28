/**
 * Walk mode's geometry (2026-09-28): the view from inside the house, standing where each photo of
 * the walk was taken. Asked for from the field - "all those little pointers to click on to get around
 * is not the greatest user interface... i suppose more of a matterport type build".
 *
 * A VIEWPOINT is a photo's camera in the model's space: where the phone stood, which way it looked,
 * which way the top of the picture pointed, and the lens (`WalkCamera`). Seen from there through that
 * lens, the photo lies exactly over the model, so walk mode stands the view at a viewpoint and hangs the
 * photo in front of it (`photoPlane`); looking away from it shows the model around it.
 *
 * Moving is Matterport's: tap the floor and go to the viewpoint nearest the spot tapped
 * (`destinationFor`), keeping roughly the way the view faces; the arrow keys step forward and back
 * (`stepFrom`). The renderer (components/sketch/Sketch3D.tsx) only draws what these decide.
 *
 * UNITS are the model's (lib/sketch3d.ts): feet, x across the page, y up, z down the page. The page's
 * (x, y) are world pixels, 12 to the foot.
 */

import { PIXELS_PER_FOOT, type SketchWalk, type WalkCamera } from "./sketch";

export type Vec3 = [number, number, number];

/**
 * The lens for a walk whose file did not name one (every scan sent before 2026-09-28): the phone's
 * 640 x 480 camera image stood upright, about 66 degrees top to bottom - the ARCore image on the
 * phones this runs on. A wrong guess makes the photo a little too big or small over the model; the
 * files carry the real one now.
 */
export const DEFAULT_WALK_CAMERA: WalkCamera = { width: 480, height: 640, fx: 495, fy: 495, cx: 240, cy: 320 };

/** How high the phone was when the file does not say: 5', about where it is held to look through. */
export const DEFAULT_PHOTO_HEIGHT_FEET = 5;

export interface ViewpointKey {
  walk: number;
  photo: number;
}

export interface Viewpoint {
  key: ViewpointKey;
  level: number;
  /** Where the camera was. */
  position: Vec3;
  /** The camera's axes, unit: the way it looked, the photo's top edge, and its right edge. */
  forward: Vec3;
  up: Vec3;
  right: Vec3;
  camera: WalkCamera;
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]);
  return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** An angle in radians, brought into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x <= -Math.PI) x += 2 * Math.PI;
  if (x > Math.PI) x -= 2 * Math.PI;
  return x;
}

/**
 * The view's turn and tilt for looking along [forward], as the renderer's camera takes them (turn
 * about up, then tilt; a camera at no turn looks down -z): radians.
 */
export function yawPitchOf(forward: Vec3): { yaw: number; pitch: number } {
  const f = norm(forward);
  return { yaw: Math.atan2(-f[0], -f[2]), pitch: Math.asin(Math.max(-1, Math.min(1, f[1]))) };
}

/** The way a view at [yaw] and [pitch] looks. */
export function directionOf(yaw: number, pitch: number): Vec3 {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

/**
 * Every photo of every walk as a viewpoint, in the walk's order. [baseOf] is a storey's floor height.
 *
 * A photo from a file with the camera's own axes (`forward`, `up`) takes them as they are, turned
 * from the page's (across, down, up) into the model's (x, y up, z down the page). An older one has
 * only a heading and a pitch: it looks that way with its top edge as near straight up as a camera
 * looking that way can have it.
 */
export function viewpoints(walks: SketchWalk[], baseOf: (level: number) => number): Viewpoint[] {
  const out: Viewpoint[] = [];
  walks.forEach((walk, wi) => {
    const camera = walk.camera ?? DEFAULT_WALK_CAMERA;
    const base = baseOf(walk.level);
    walk.photos.forEach((photo, pi) => {
      const position: Vec3 = [photo.x / PIXELS_PER_FOOT, base + (photo.heightFeet ?? DEFAULT_PHOTO_HEIGHT_FEET), photo.y / PIXELS_PER_FOOT];
      let forward: Vec3;
      let up: Vec3;
      if (photo.forward && photo.up) {
        forward = norm([photo.forward[0], photo.forward[2], photo.forward[1]]);
        const u: Vec3 = [photo.up[0], photo.up[2], photo.up[1]];
        up = norm(add(u, forward, -dot(u, forward)));
      } else {
        const h = (photo.headingDeg * Math.PI) / 180;
        const p = ((photo.pitchDeg ?? 0) * Math.PI) / 180;
        forward = [Math.cos(p) * Math.cos(h), Math.sin(p), Math.cos(p) * Math.sin(h)];
        const world: Vec3 = [0, 1, 0];
        up = norm(add(world, forward, -dot(world, forward)));
      }
      if (up[0] === 0 && up[1] === 0 && up[2] === 0) return;
      out.push({ key: { walk: wi, photo: pi }, level: walk.level, position, forward, up, right: norm(cross(forward, up)), camera });
    });
  });
  return out;
}

/**
 * Where the photo hangs, [distance] in front of its camera: the middle of the picture and its size.
 * Seen from the viewpoint it covers exactly what the camera saw, whatever the distance; the distance
 * only matters to a view from elsewhere, so it is best put at the wall the camera faced.
 */
export function photoPlane(v: Viewpoint, distance: number): { center: Vec3; width: number; height: number } {
  const c = v.camera;
  let center = add(v.position, v.forward, distance);
  center = add(center, v.right, ((c.width / 2 - c.cx) / c.fx) * distance);
  center = add(center, v.up, ((c.cy - c.height / 2) / c.fy) * distance);
  return { center, width: (c.width / c.fx) * distance, height: (c.height / c.fy) * distance };
}

/**
 * The view's field of view, top to bottom in degrees, that shows the whole of a photo taken through
 * [camera] in a viewport [aspect] wide to tall - a photo taller than the screen is fitted by its
 * height, one wider by its width - and a little more, so its soft edges show.
 */
export function fitFovDeg(camera: WalkCamera, aspect: number, margin = 1.06): number {
  const tanH = camera.height / 2 / camera.fy;
  const tanW = camera.width / 2 / camera.fx;
  const t = Math.max(tanH, tanW / Math.max(aspect, 1e-3)) * margin;
  return Math.min(110, Math.max(20, (2 * Math.atan(t) * 180) / Math.PI));
}

/** How much a viewpoint facing away from the view counts against it, in feet per radian: 45 degrees is 2 1/2'. */
const TURN_COST_FEET = 3.2;

/**
 * Where a tap on the floor at (x, z) goes: the viewpoint on [level] nearest the spot, a viewpoint
 * facing the way the view does ([yaw]) preferred to one a little nearer facing another way, so the
 * view carries on looking where it was. Null with no viewpoint on the storey.
 */
export function destinationFor(points: Viewpoint[], level: number, x: number, z: number, yaw: number | null): Viewpoint | null {
  let best: { v: Viewpoint; score: number } | null = null;
  for (const v of points) {
    if (v.level !== level) continue;
    let score = Math.hypot(v.position[0] - x, v.position[2] - z);
    if (yaw != null) score += TURN_COST_FEET * Math.abs(wrapAngle(yawPitchOf(v.forward).yaw - yaw));
    if (!best || score < best.score) best = { v, score };
  }
  return best?.v ?? null;
}

/** A step is at least this far - nearer is the same spot - and at most this far: 1' and 15'. */
const MIN_STEP_FEET = 1;
const MAX_STEP_FEET = 15;
/** How far off the way the view is going a step may lie: 50 degrees. */
const STEP_CONE = (50 * Math.PI) / 180;

/**
 * The step forward ([direction] 1) or back (-1) from [from] with the view at [yaw]: the nearest
 * viewpoint on the same storey lying that way, within a cone about it, facing the way the view does
 * if it can. Null when there is nowhere to go.
 */
export function stepFrom(points: Viewpoint[], from: Viewpoint, yaw: number, direction: 1 | -1): Viewpoint | null {
  const going = direction === 1 ? yaw : wrapAngle(yaw + Math.PI);
  let best: { v: Viewpoint; score: number } | null = null;
  for (const v of points) {
    if (v === from || v.level !== from.level) continue;
    const dx = v.position[0] - from.position[0];
    const dz = v.position[2] - from.position[2];
    const d = Math.hypot(dx, dz);
    if (d < MIN_STEP_FEET || d > MAX_STEP_FEET) continue;
    // The bearing of the step, in the view's own terms (a view at yaw 0 looks down -z).
    const off = Math.abs(wrapAngle(Math.atan2(-dx, -dz) - going));
    if (off > STEP_CONE) continue;
    const facing = Math.abs(wrapAngle(yawPitchOf(v.forward).yaw - yaw));
    const score = d * (1 + off) + TURN_COST_FEET * facing;
    if (!best || score < best.score) best = { v, score };
  }
  return best?.v ?? null;
}

/**
 * The viewpoints to mark on the floor: none closer than [minFeet] to one already marked, taken in
 * walk order. The walk takes a photo every step or so, and a ring at each would be the clutter walk
 * mode replaces; a tap goes to the nearest of all of them regardless.
 */
export function spacedOut(points: Viewpoint[], minFeet: number): Viewpoint[] {
  const out: Viewpoint[] = [];
  for (const v of points) {
    if (out.some((o) => o.level === v.level && Math.hypot(o.position[0] - v.position[0], o.position[2] - v.position[2]) < minFeet)) continue;
    out.push(v);
  }
  return out;
}
