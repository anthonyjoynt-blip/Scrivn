/**
 * A 360° spot seen ONE STILL AT A TIME (2026-10-05). After a week of stitching a spot's stills into one
 * panorama - door jambs bent where two stills met, a pet bed doubled, the floor a blurred cap - the
 * owner's call: "instead of trying to stitch everything together into one panoramic image we just click
 * through the photos taken, left/right or up/down. we will accomplish the same thing getting a full 360
 * view but we wont be needlessly distorting anything to stitch them together. id just want the user to
 * be able to zoom in/out in specific spots on each still frame to get closer views of things".
 *
 * So a spot's stills are sorted into RINGS by how far up or down they look - level, down at the floor,
 * up at the ceiling (the main lens's spots had all three; the ultra-wide's have level and down) - each
 * ring in the order of a turn to the right. Left and right go round a ring; up and down go to the ring
 * above or below, to its still facing nearest the same way. The viewer (components/sketch/SpotStills.tsx)
 * shows the still as the phone took it, and zooms it.
 *
 * UNITS are walk mode's (lib/walkView.ts): a still's yaw is the view's turn, radians, and turning LEFT
 * is a larger yaw, as the 3D view takes it.
 */

import { wrapAngle, yawPitchOf, type Viewpoint } from "./walkView";

export type RingKind = "up" | "level" | "down";

export interface StillRing {
  kind: RingKind;
  /** The ring's stills, in the order of a turn to the right. */
  stills: Viewpoint[];
}

/** A still looking further up than this is the ceiling's ring, further down the floor's: degrees. The rings the phone takes stand at about +28 / -40 (main lens) and -55 (ultra-wide); a level still leans a few degrees at most. */
const UP_FROM_DEG = 15;
const DOWN_FROM_DEG = -20;

const yawOf = (v: Viewpoint) => yawPitchOf(v.forward).yaw;

/** Which ring a still belongs to, by how far it looks up or down. */
export function ringKindOf(still: Viewpoint): RingKind {
  const pitch = (yawPitchOf(still.forward).pitch * 180) / Math.PI;
  return pitch > UP_FROM_DEG ? "up" : pitch < DOWN_FROM_DEG ? "down" : "level";
}

/**
 * A spot's stills as its rings, top to bottom (up, level, down; a ring the spot has no still for is left
 * out), each in the order of a turn to the right starting from the spot's first still of that ring. A
 * photo, not a spot, is one ring of itself.
 */
export function stillRings(spot: Viewpoint): StillRing[] {
  const stills = spot.frames ?? [spot];
  const order: RingKind[] = ["up", "level", "down"];
  const rings: StillRing[] = [];
  for (const kind of order) {
    const mine = stills.filter((s) => ringKindOf(s) === kind);
    if (mine.length === 0) continue;
    const y0 = yawOf(mine[0] as Viewpoint);
    // How far right of the ring's first still each one faces, [0, 2pi): turning right is a smaller yaw.
    const rightOf = (s: Viewpoint) => {
      const d = wrapAngle(y0 - yawOf(s));
      return d < 0 ? d + 2 * Math.PI : d;
    };
    rings.push({ kind, stills: [...mine].sort((a, b) => rightOf(a) - rightOf(b)) });
  }
  return rings;
}

/** The still [by] places round [ring] from [index]: positive to the right, wrapping all the way round. */
export function turnIndex(ring: StillRing, index: number, by: number): number {
  const n = ring.stills.length;
  if (n === 0) return 0;
  return (((index + by) % n) + n) % n;
}

/** The still of [ring] facing nearest [yaw] (radians, the view's turn). */
export function nearestStill(ring: StillRing, yaw: number): number {
  let best = 0;
  let bestOff = Infinity;
  ring.stills.forEach((s, i) => {
    const off = Math.abs(wrapAngle(yawOf(s) - yaw));
    if (off < bestOff) {
      bestOff = off;
      best = i;
    }
  });
  return best;
}

/** The ring to show for [kind] on [rings]: that one when the spot has it, else its level ring, else its first. */
export function ringFor(rings: StillRing[], kind: RingKind): number {
  const same = rings.findIndex((r) => r.kind === kind);
  if (same >= 0) return same;
  const level = rings.findIndex((r) => r.kind === "level");
  return level >= 0 ? level : 0;
}

/** Where a still looks: the view's turn and tilt, radians. */
export function lookOfStill(still: Viewpoint): { yaw: number; pitch: number } {
  return yawPitchOf(still.forward);
}

// ---- Zoom -------------------------------------------------------------------------------------------

/**
 * How a still sits on the stage: its middle [tx, ty] pixels from the middle of the box it is fitted into,
 * at [scale] times its fitted size (1 = the whole still in view).
 */
export interface StillZoom {
  scale: number;
  tx: number;
  ty: number;
}

/** The stage a still is drawn on, CSS pixels: its size, and the box within it the still is fitted to at a zoom of 1. */
export interface Stage {
  width: number;
  height: number;
  fit: { left: number; top: number; width: number; height: number };
}

export const FIT: StillZoom = { scale: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 8;

/** The still's size on the stage at a zoom of 1, CSS pixels: all of it in view in the fit box, never larger than the box. */
export function fittedSize(stage: Stage, imageWidth: number, imageHeight: number): { width: number; height: number } {
  const k = Math.min(stage.fit.width / Math.max(1, imageWidth), stage.fit.height / Math.max(1, imageHeight));
  return { width: imageWidth * k, height: imageHeight * k };
}

/** Where the still's box lands on the stage at [zoom]: CSS pixels from the stage's top left. */
export function placeStill(stage: Stage, imageWidth: number, imageHeight: number, zoom: StillZoom): { left: number; top: number; width: number; height: number } {
  const base = fittedSize(stage, imageWidth, imageHeight);
  const width = base.width * zoom.scale;
  const height = base.height * zoom.scale;
  const cx = stage.fit.left + stage.fit.width / 2 + zoom.tx;
  const cy = stage.fit.top + stage.fit.height / 2 + zoom.ty;
  return { left: cx - width / 2, top: cy - height / 2, width, height };
}

/**
 * [zoom] kept to what makes sense: no smaller than the fit, no larger than [MAX_ZOOM], and moved only as far
 * as the still still covers the stage that way - a still narrower than the stage stays in the middle of its
 * fit box, one wider can be moved until its edge meets the stage's.
 */
export function clampZoom(stage: Stage, imageWidth: number, imageHeight: number, zoom: StillZoom): StillZoom {
  const scale = Math.min(MAX_ZOOM, Math.max(1, zoom.scale));
  const base = fittedSize(stage, imageWidth, imageHeight);
  const axis = (t: number, size: number, stageSize: number, fitStart: number, fitSize: number) => {
    const middle = fitStart + fitSize / 2;
    if (size <= stageSize) {
      // All of it fits across the stage: no further than its edges stay on it.
      const lo = size / 2 - middle;
      const hi = stageSize - size / 2 - middle;
      return scale <= 1 ? 0 : Math.min(hi, Math.max(lo, t));
    }
    // Larger than the stage: its edges no further in than the stage's.
    const lo = stageSize - size / 2 - middle;
    const hi = size / 2 - middle;
    return Math.min(hi, Math.max(lo, t));
  };
  return {
    scale,
    tx: axis(zoom.tx, base.width * scale, stage.width, stage.fit.left, stage.fit.width),
    ty: axis(zoom.ty, base.height * scale, stage.height, stage.fit.top, stage.fit.height),
  };
}

/**
 * [zoom] taken to [scale] about the stage point (px, py): what was under that point stays under it. Clamped.
 */
export function zoomAbout(stage: Stage, imageWidth: number, imageHeight: number, zoom: StillZoom, scale: number, px: number, py: number): StillZoom {
  const next = Math.min(MAX_ZOOM, Math.max(1, scale));
  const cx = stage.fit.left + stage.fit.width / 2;
  const cy = stage.fit.top + stage.fit.height / 2;
  // The point, from the still's middle, in the still's own fitted pixels.
  const ux = (px - cx - zoom.tx) / zoom.scale;
  const uy = (py - cy - zoom.ty) / zoom.scale;
  return clampZoom(stage, imageWidth, imageHeight, { scale: next, tx: px - cx - ux * next, ty: py - cy - uy * next });
}
