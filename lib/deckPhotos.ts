/**
 * A deck placed off the same photos as the house (2026-10-20, lib/decks.ts): the photo route's own cameras, as its last
 * measure placed them (`RouteMeasured`), read the deck's outer corners and its height from a few taps.
 *
 *   * its OUTER CORNERS, tapped where each meets the ground - a post's foot, or under the corner of the rim - on every
 *     photo that shows them: two photos or more cross their bearings on the plan; one alone sends its ray to the ground,
 *     the camera's height over it known from the house's corners;
 *   * its TOP over a corner, tapped on a photo that shows the corner's foot too: the two pixels on the one plumb line, at
 *     the corner's distance, are its height;
 *   * the rest of it is the house's: from its outer edge back to the walls behind it (`deckOutlineToHouse`), so a deck
 *     that runs into a covered corner fills it, and its ledger is wherever it meets them.
 *
 * Nothing here changes the route's own files: a camera is read as lib/photoRouteExterior.ts lays a photo on a side.
 * Plan feet in the route's frame (x east, y north, the street at the bottom); each camera's height is over the ground
 * at the house's corners tapped in it.
 */

import { type Deck, outlineToWalls } from "./decks";
import { lensUndistort } from "./exteriorPhoto";
import type { RouteMeasured } from "./photoRoute";
import type { Pt } from "./roof";

const GDIR: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/** A camera of the route's last measure, as a deck is read off its photo. */
export interface PlacedCamera {
  photo: string;
  at: Pt;
  /** Over the ground at the house's corners tapped in it, feet; null when none was. */
  heightFeet: number | null;
  f: number;
  k: number;
  /** Its turn: the level frame (X, up, Z) to the camera's own. */
  R: number[];
  width: number;
  height: number;
  quadrant: number;
  yaw: number;
}

export function placedCameras(m: RouteMeasured): PlacedCamera[] {
  return m.cameras.flatMap((c) => {
    const lens = m.lenses[c.photo];
    if (!lens) return [];
    return [{ photo: c.photo, at: { x: c.at[0], y: c.at[1] }, heightFeet: c.heightFeet, f: lens.f, k: lens.k, R: lens.R, width: lens.width, height: lens.height, quadrant: c.quadrant, yaw: (c.yawTweakDeg * Math.PI) / 180 }];
  });
}

/** The camera's level frame: a plan direction as its (X, Z), and back. */
function frameAxes(cam: PlacedCamera): { X: Pt; Z: Pt; c: number; s: number } {
  const z = GDIR[((cam.quadrant % 4) + 4) % 4] as [number, number];
  return { Z: { x: z[0], y: z[1] }, X: { x: z[1], y: -z[0] }, c: Math.cos(cam.yaw), s: Math.sin(cam.yaw) };
}

function toLocal(cam: PlacedCamera, v: Pt): Pt {
  const { X, Z, c, s } = frameAxes(cam);
  const d = { x: c * v.x - s * v.y, y: s * v.x + c * v.y };
  return { x: d.x * X.x + d.y * X.y, y: d.x * Z.x + d.y * Z.y };
}

function fromLocal(cam: PlacedCamera, l: Pt): Pt {
  const { X, Z, c, s } = frameAxes(cam);
  const d = { x: l.x * X.x + l.y * Z.x, y: l.x * X.y + l.y * Z.y };
  return { x: c * d.x + s * d.y, y: -s * d.x + c * d.y };
}

const lensOf = (cam: PlacedCamera) => ({ camera: { width: cam.width, cx: cam.width / 2, cy: cam.height / 2, k: cam.k } });

/**
 * Where a point of the plan at a height over the camera's ground falls in its photo, in its pixels as taken (the lens's
 * radial term on); null behind the camera or with no height for the camera.
 */
export function projectPoint(cam: PlacedCamera, p: Pt, upFeet: number): Pt | null {
  const h = cam.heightFeet ?? 5;
  const l = toLocal(cam, { x: p.x - cam.at.x, y: p.y - cam.at.y });
  const v = [l.x, upFeet - h, l.y];
  const R = cam.R;
  const c = [0, 1, 2].map((i) => (R[i * 3] as number) * (v[0] as number) + (R[i * 3 + 1] as number) * (v[1] as number) + (R[i * 3 + 2] as number) * (v[2] as number)) as [number, number, number];
  if (!(c[2] > 1e-6)) return null;
  const x = (cam.f * c[0]) / c[2] + cam.width / 2;
  const y = (cam.f * c[1]) / c[2] + cam.height / 2;
  // The pinhole pixel, moved out by the lens as the photo has it.
  const L = lensOf(cam).camera;
  const ux = x - L.cx;
  const uy = y - L.cy;
  let dx = ux;
  let dy = uy;
  for (let i = 0; i < 5; i++) {
    const s = 1 + (L.k * (dx * dx + dy * dy)) / (L.width * L.width);
    dx = ux / s;
    dy = uy / s;
  }
  return { x: L.cx + dx, y: L.cy + dy };
}

/** A pixel's ray: its way on the plan, and how far it climbs per foot along it. Null for a ray that points straight up or down. */
export function pixelRay(cam: PlacedCamera, x: number, y: number): { dir: Pt; climb: number } | null {
  const u = lensUndistort(lensOf(cam), x, y);
  const d = [(u.x - cam.width / 2) / cam.f, (u.y - cam.height / 2) / cam.f, 1];
  const R = cam.R;
  // Rᵀ d: back into the level frame (X, up, Z).
  const l = [0, 1, 2].map((j) => (R[j] as number) * (d[0] as number) + (R[3 + j] as number) * (d[1] as number) + (R[6 + j] as number) * (d[2] as number)) as [number, number, number];
  const flat = Math.hypot(l[0], l[2]);
  if (!(flat > 1e-9)) return null;
  const dir = fromLocal(cam, { x: l[0] / flat, y: l[2] / flat });
  return { dir, climb: l[1] / flat };
}

/** Where bearings from several cameras cross on the plan, least squares; with its spread (feet). Null under two. */
export function crossBearings(rays: { at: Pt; dir: Pt }[]): { at: Pt; spreadFeet: number } | null {
  if (rays.length < 2) return null;
  // Minimise the squared distance to each line: Σ (I - d dᵀ) (p - a) = 0.
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const r of rays) {
    const n11 = 1 - r.dir.x * r.dir.x;
    const n12 = -r.dir.x * r.dir.y;
    const n22 = 1 - r.dir.y * r.dir.y;
    a11 += n11;
    a12 += n12;
    a22 += n22;
    b1 += n11 * r.at.x + n12 * r.at.y;
    b2 += n12 * r.at.x + n22 * r.at.y;
  }
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return null;
  const at = { x: (a22 * b1 - a12 * b2) / det, y: (a11 * b2 - a12 * b1) / det };
  // Each ray must see it in front.
  if (rays.some((r) => (at.x - r.at.x) * r.dir.x + (at.y - r.at.y) * r.dir.y < 0)) return null;
  const off = rays.map((r) => Math.abs((at.x - r.at.x) * r.dir.y - (at.y - r.at.y) * r.dir.x));
  return { at, spreadFeet: Math.sqrt(off.reduce((s, v) => s + v * v, 0) / off.length) };
}

/** A pixel at the ground, sent down its ray to the camera's ground: null with no height for the camera, or a ray that doesn't come down. */
export function groundPoint(cam: PlacedCamera, x: number, y: number): Pt | null {
  const r = pixelRay(cam, x, y);
  if (!r || cam.heightFeet === null || !(r.climb < -1e-3)) return null;
  const d = cam.heightFeet / -r.climb;
  return { x: cam.at.x + r.dir.x * d, y: cam.at.y + r.dir.y * d };
}

/** How far up the top pixel is from the foot pixel, both on the plumb line over [at]: each ray at the point's distance along it. */
export function heightOver(cam: PlacedCamera, at: Pt, top: Pt, foot: Pt): number | null {
  const t = pixelRay(cam, top.x, top.y);
  const f = pixelRay(cam, foot.x, foot.y);
  if (!t || !f) return null;
  const dt = (at.x - cam.at.x) * t.dir.x + (at.y - cam.at.y) * t.dir.y;
  const df = (at.x - cam.at.x) * f.dir.x + (at.y - cam.at.y) * f.dir.y;
  if (!(dt > 0.5 && df > 0.5)) return null;
  return t.climb * dt - f.climb * df;
}

/** A tap on a deck photo: which point, where. */
export interface DeckPhotoTap {
  photo: string;
  /** "corner:<k>" an outer corner at the ground, "top:<k>" the decking's edge over it. */
  point: string;
  x: number;
  y: number;
}

export interface PlacedDeckPoint {
  point: string;
  at: Pt;
  /** By two photos' bearings or more, else one photo's ray to the ground. */
  by: "bearings" | "ground";
  photos: number;
  spreadFeet: number;
  /** Its bearings cross at less than `WEAK_CROSSING_DEG`: two photos taken close together, sure across and not in depth. */
  weak?: true;
  /** Each tap's ray, kept to place it again on the deck's outer edge once that is known. */
  rays: { at: Pt; dir: Pt }[];
}

/** Bearings crossing at less than this say little of how far away a point is. */
export const WEAK_CROSSING_DEG = 15;

/** The widest angle between any two of the rays, degrees. */
function crossingDeg(rays: { dir: Pt }[]): number {
  let most = 0;
  for (let i = 0; i < rays.length; i++)
    for (let j = i + 1; j < rays.length; j++) {
      const a = rays[i] as { dir: Pt };
      const b = rays[j] as { dir: Pt };
      most = Math.max(most, (Math.acos(Math.max(-1, Math.min(1, a.dir.x * b.dir.x + a.dir.y * b.dir.y))) * 180) / Math.PI);
    }
  return most;
}

export interface DeckPlacing {
  corners: PlacedDeckPoint[];
  /** The deck's top over the ground, each read; their middle. */
  heights: { point: string; photo: string; feet: number }[];
  heightFeet: number | null;
  /** What it couldn't do, in plain words. */
  why: string[];
}

/** A deck's outer corner this close to the line of a wall running out from the house is on it: a deck flush with the house's end. */
export const SNAP_TO_WALL_FEET = 0.6;

/**
 * A deck off the photos, against outline side [side] of the route's last measure: its outer corners placed by the taps, its
 * outer edge their mean distance out, its ends where they are - or on the line of a wall running out from the house within
 * 7", where it is flush - and from that edge back to the walls behind it. Its height off its top's taps, else [prev]'s.
 * What it can't do is said; a deck kept from before stays as it was.
 */
export function deckFromPhotos(m: RouteMeasured, side: number, taps: DeckPhotoTap[], prev: Deck | null, make: { id: string; name: string }): { deck: Deck | null; placing: DeckPlacing; why: string[] } {
  const placing = placeDeckPoints(m, taps);
  const ring = m.corners;
  const n = ring.length;
  const why = [...placing.why];
  const a = ring[side];
  const b = ring[(side + 1) % n];
  if (!a || !b || n < 3) return { deck: null, placing, why: [...why, "Measure the house first: the deck is placed by the same photos."] };
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  // The route's ring goes counter-clockwise: out is to the right of the way along, as on the exterior.
  const nrm = { x: u.y, y: -u.x };
  const local = (p: Pt): Pt => ({ x: (p.x - a.x) * u.x + (p.y - a.y) * u.y, y: (p.x - a.x) * nrm.x + (p.y - a.y) * nrm.y });
  if (placing.corners.length < 2) return { deck: null, placing, why: [...why, "Tap both of the deck's outer corners where they meet the ground, each on two photos."] };
  // How far out its outer edge is: off the corners whose bearings cross well; a corner seen only from close together (or by one
  // photo) is then put on that edge, where its rays meet it - sure across, where it was not sure in depth.
  const strong = placing.corners.filter((c) => !c.weak);
  const depth = (strong.length > 0 ? strong : placing.corners).reduce((s, c) => s + local(c.at).y, 0) / (strong.length > 0 ? strong : placing.corners).length;
  const onEdge = (c: PlacedDeckPoint): Pt => {
    if (!c.weak || strong.length === 0) return local(c.at);
    // Each ray met with the line `depth` out from the wall, along the wall.
    const xs = c.rays.flatMap((r) => {
      const o = local(r.at);
      const d = { x: r.dir.x * u.x + r.dir.y * u.y, y: r.dir.x * nrm.x + r.dir.y * nrm.y };
      if (Math.abs(d.y) < 1e-6) return [];
      const t = (depth - o.y) / d.y;
      return t > 0 ? [o.x + d.x * t] : [];
    });
    return xs.length > 0 ? { x: xs.reduce((s, v) => s + v, 0) / xs.length, y: depth } : local(c.at);
  };
  const corners = placing.corners.map(onEdge);
  if (!(depth > 0.5)) return { deck: null, placing, why: [...why, "The corners tapped come out at the wall, not in front of it: check which wall the deck is against."] };
  const ringLocal = ring.map(local);
  // Each end on a wall's line where it is that close: the walls running out from the house, the side's own ends among them.
  const lines = [...new Set(ringLocal.map((p) => Math.round(p.x * 1e4) / 1e4))];
  const snap = (x: number) => {
    const near = lines.filter((l) => Math.abs(l - x) <= SNAP_TO_WALL_FEET).sort((p, q) => Math.abs(p - x) - Math.abs(q - x))[0];
    return near ?? x;
  };
  const xs = corners.map((p) => p.x);
  const x0 = snap(Math.min(...xs));
  const x1 = snap(Math.max(...xs));
  const outline = outlineToWalls(ringLocal, x0, x1, depth);
  if (outline.length < 3) return { deck: null, placing, why: [...why, "The deck's corners don't make an outline: tap them again."] };
  const sideId = m.sideIds?.[side] ?? null;
  const deck: Deck = {
    ...(prev ?? { railings: [], stairs: [], posts: null, screens: [], decking: "composite" as const }),
    id: prev?.id ?? make.id,
    name: prev?.name ?? make.name,
    sideId,
    outline,
    heightFeet: placing.heightFeet ?? prev?.heightFeet ?? 0,
    from: "photos",
    taps: taps.map((t) => ({ ...t })),
  };
  if (placing.heightFeet === null && !prev) why.push("Its height is 0 until its top is tapped over a corner.");
  return { deck, placing, why };
}

/** The outer corners and the height from the taps: what lib/decks.ts makes the deck from. */
export function placeDeckPoints(m: RouteMeasured, taps: DeckPhotoTap[]): DeckPlacing {
  const cams = new Map(placedCameras(m).map((c) => [c.photo, c]));
  const why: string[] = [];
  const corners: PlacedDeckPoint[] = [];
  const names = [...new Set(taps.filter((t) => t.point.startsWith("corner:")).map((t) => t.point))];
  for (const point of names) {
    const mine = taps.filter((t) => t.point === point && cams.has(t.photo));
    const rays = mine.flatMap((t) => {
      const cam = cams.get(t.photo) as PlacedCamera;
      const r = pixelRay(cam, t.x, t.y);
      return r ? [{ at: cam.at, dir: r.dir, cam, t }] : [];
    });
    const crossed = crossBearings(rays);
    const kept = rays.map((r) => ({ at: r.at, dir: r.dir }));
    if (crossed) {
      corners.push({ point, at: crossed.at, by: "bearings", photos: rays.length, spreadFeet: crossed.spreadFeet, rays: kept, ...(crossingDeg(rays) < WEAK_CROSSING_DEG ? { weak: true as const } : {}) });
      continue;
    }
    // One photo: its ray down to the ground.
    const one = rays[0];
    const g = one ? groundPoint(one.cam, one.t.x, one.t.y) : null;
    if (g) corners.push({ point, at: g, by: "ground", photos: 1, spreadFeet: 0, rays: kept, weak: true });
    else if (one) corners.push({ point, at: { x: one.at.x + one.dir.x * 20, y: one.at.y + one.dir.y * 20 }, by: "ground", photos: 1, spreadFeet: 0, rays: kept, weak: true });
    else why.push(`The deck's ${point.replace(":", " ")} isn't on a photo the measure placed: tap it on two of them.`);
  }
  const heights: DeckPlacing["heights"] = [];
  for (const t of taps.filter((x) => x.point.startsWith("top:"))) {
    const cam = cams.get(t.photo);
    const k = t.point.slice("top:".length);
    const c = corners.find((x) => x.point === `corner:${k}`);
    if (!cam || !c) continue;
    const foot = taps.find((x) => x.photo === t.photo && x.point === `corner:${k}`);
    // Its foot on the same photo: the two pixels on one plumb line. Else the camera's own height over the ground.
    const h = foot ? heightOver(cam, c.at, t, foot) : (() => {
      const r = pixelRay(cam, t.x, t.y);
      if (!r || cam.heightFeet === null) return null;
      const d = (c.at.x - cam.at.x) * r.dir.x + (c.at.y - cam.at.y) * r.dir.y;
      return d > 0.5 ? cam.heightFeet + r.climb * d : null;
    })();
    if (h !== null && h > 0) heights.push({ point: t.point, photo: t.photo, feet: h });
  }
  const sorted = heights.map((h) => h.feet).sort((a, b) => a - b);
  const heightFeet = sorted.length > 0 ? (sorted.length % 2 ? (sorted[(sorted.length - 1) / 2] as number) : ((sorted[sorted.length / 2 - 1] as number) + (sorted[sorted.length / 2] as number)) / 2) : null;
  if (heightFeet === null) why.push("Nothing gave its height: tap the deck's top over a corner whose foot is tapped on the same photo.");
  return { corners, heights, heightFeet, why };
}
