/**
 * Sanity checks on a house measured from photos (2026-10-20): what to look at, never a block. Two blind runs of a
 * test house came out with the depth well off and two photos solved to places nobody stood; the things that gave
 * them away are checked here, each naming the corner or the photo to look at:
 *
 *   * the eaves either side of an outside corner disagreeing by more than a foot (one wall's photo placed wrong, or
 *     read wrong): an eave runs round an outside corner at one height;
 *   * a door, garage door or window far from the usual size (a front door reading 5'0");
 *   * a camera solved where nobody could have stood: inside the house, under the ground or high in the air, in the
 *     neighbour's home, or seeing a corner through a wall;
 *   * a camera turned well off its own level lines to fit its corners (2026-10-21, a blind run: a photo turned degrees, and
 *     a long side swung by feet when one more corner was tapped on it): a corner on it is on the wrong
 *     edge - a post, a pilaster or a downspout beside the corner - or is hidden;
 *   * an outline that won't close square: a side solved to nothing, or the wrong way round from the shape drawn;
 *   * the depth only as drawn: no tape and too few photos tying the back of the house to its front;
 *   * a side the measure puts further from what was estimated on site than the estimate's ± (2026-10-21, `RouteEstimate`
 *     use "check"): one of the two is wrong, and a tape settles which;
 *   * a measurement whose ends are on a close-up laid on its wall (2026-10-23, `closeUpsOnSides`) further than 5% from what
 *     the wall as measured makes it: its ends are off, or the wall is sized wrong by about as much.
 *
 * From the exterior alone (the route's measure kept on it), so the app and the test-house runner say the same.
 */

import { type Exterior, type ExteriorOpeningKind, type ExteriorSide, OPENING_LABEL } from "./exterior";
import { castRayToSides, estimateDisagreement, inNeighbour, PHOTO_ROUTE_FORMAT } from "./photoRoute";
import { closeUpsOnSides } from "./photoRouteExterior";
import { checkOnWall, DETAIL_CHECK_PCT } from "./photoRouteMatch";
import { feetInchesEighths, measureWords } from "./photoRouteWalk";
import type { Pt } from "./roof";
import { formatFeetInches } from "./sketch";

export type SanityKind = "eaves" | "opening" | "camera" | "outline" | "depth" | "estimate" | "closeup";

export interface SanityFlag {
  key: string;
  kind: SanityKind;
  /** What to look at: the photo (its id), the corner (outline index), the side (outline index). */
  photo?: string;
  corner?: number;
  side?: number;
  words: string;
}

/** Eaves either side of an outside corner further apart than this disagree. */
const EAVE_AGREE_FEET = 1;
/** A camera this low or this high over the ground at the corners tapped on it is not where a hand held it. */
const CAMERA_FEET: [number, number] = [1, 12];
/**
 * A photo's turn on top of its vanishing points past this, degrees, to fit its corners: three times what the solve allows a
 * photo levelled from its own straight edges (lib/photoRoute.ts, YAW_SD_DEG 1).
 */
const CAMERA_TURN_DEG = 3;
/** A side solved shorter than this, drawn three feet or more, has come out to nothing. */
const SIDE_GONE_FEET = 1;
/** The depth's ± over this, untaped: the back is hardly tied to the front. */
const DEPTH_LOOSE_PCT = 10;

/** The sizes doors, garage doors and windows come in, roughly: outside them a size is worth a look. */
const SIZES: Record<ExteriorOpeningKind, { height: [number, number]; width: [number, number] }> = {
  door: { height: [6 + 2 / 12, 8.5], width: [2, 6.5] },
  garage: { height: [6.5, 10], width: [7, 19] },
  window: { height: [0.8, 9], width: [0.8, 16] },
  rollup: { height: [6, 14], width: [5, 16] },
};

const segLen = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/** Left turn at corner k of a counter-clockwise ring: an outside corner. */
function isOutside(ring: Pt[], k: number): boolean {
  const n = ring.length;
  const a = ring[(k - 1 + n) % n] as Pt;
  const b = ring[k] as Pt;
  const c = ring[(k + 1) % n] as Pt;
  return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0;
}

export function routeSanity(exterior: Exterior): SanityFlag[] {
  const route = exterior.photoRoute;
  const m = route?.measured;
  if (!route || route.format !== PHOTO_ROUTE_FORMAT || !m) return [];
  const building = route.buildings.find((b) => b.id === m.building);
  if (!building) return [];
  const ring = m.corners;
  const n = ring.length;
  const ids = m.sideIds ?? [];
  const sideOf = (i: number): ExteriorSide | undefined => exterior.sides.find((s) => s.id === ids[i]);
  const photoNo = (id: string) => {
    const k = route.photos.findIndex((p) => p.id === id);
    return k >= 0 ? `photo ${k + 1}` : "a photo";
  };
  const wallWords = (i: number) => {
    const name = sideOf(i)?.name?.trim();
    // A name that is a wall already ("Right side wall") takes no second "wall".
    return name ? `the ${name}${/\bwall$/i.test(name) ? "" : " wall"}` : `the wall from corner ${i + 1} to ${((i + 1) % n) + 1}`;
  };
  const photosOf = (i: number) => [...new Set((sideOf(i)?.photos ?? []).map((p) => p.claimPhotoId).filter((x): x is string => !!x))];
  const shared = new Set(building.shared ?? []);
  const flags: SanityFlag[] = [];

  // Eaves round each outside corner: the same height, give or take a foot. A corner at the route's default (10' both, not read) says nothing.
  for (let k = 0; k < n; k++) {
    const before = (k - 1 + n) % n;
    if (!isOutside(ring, k) || shared.has(before) || shared.has(k)) continue;
    const a = sideOf(before)?.eaveRightFeet;
    const b = sideOf(k)?.eaveLeftFeet;
    if (a == null || b == null || (a === 10 && b === 10)) continue;
    if (Math.abs(a - b) <= EAVE_AGREE_FEET) continue;
    const look = [...photosOf(before), ...photosOf(k)].map(photoNo);
    flags.push({
      key: `eaves:${k}`,
      kind: "eaves",
      corner: k,
      words: `Corner ${k + 1}: the eaves either side disagree by ${formatFeetInches(Math.abs(a - b))} (${formatFeetInches(a)} on ${wallWords(before)}, ${formatFeetInches(b)} on ${wallWords(k)}). One of the photos is placed or read wrong${look.length ? `: look at ${[...new Set(look)].join(" and ")}` : ""}.`,
    });
  }

  // Doors, garage doors and windows far from the usual size.
  for (let i = 0; i < n; i++) {
    const side = sideOf(i);
    if (!side || shared.has(i)) continue;
    for (const o of side.openings) {
      const usual = SIZES[o.kind];
      const tall = o.heightFeet < usual.height[0] || o.heightFeet > usual.height[1];
      const wide = o.widthFeet < usual.width[0] || o.widthFeet > usual.width[1];
      if (!tall && !wide) continue;
      const look = photosOf(i).map(photoNo);
      flags.push({
        key: `opening:${o.id}`,
        kind: "opening",
        side: i,
        words: `${OPENING_LABEL[o.kind]} on ${wallWords(i)} reads ${formatFeetInches(o.widthFeet)} wide by ${formatFeetInches(o.heightFeet)} tall: ${o.kind === "door" ? "a door is about 6'8\" tall" : o.kind === "garage" ? "a garage door is about 7' or 8' tall, 8' to 9' or 16' wide" : o.kind === "rollup" ? "that is no usual roll-up door" : "that is no usual window"}. Check the wall's photo is placed right${look.length ? ` (${[...new Set(look)].join(", ")})` : ""}, and the read.`,
      });
    }
  }

  // Cameras where nobody could have stood.
  const tapsOf = (photo: string) => building.corners.filter((c) => c.photo === photo && !c.proposed && c.corner >= 0 && c.corner < n);
  for (const c of m.cameras) {
    const C = { x: c.at[0], y: c.at[1] };
    const name = photoNo(c.photo);
    if (insideOutline(C, ring)) {
      flags.push({ key: `camera:inside:${c.photo}`, kind: "camera", photo: c.photo, words: `${cap(name)} works out to have been taken from inside the house: check the corners tapped on it and their numbers.` });
      continue;
    }
    if (shared.size && inNeighbour(C, ring, shared)) {
      flags.push({ key: `camera:neighbour:${c.photo}`, kind: "camera", photo: c.photo, words: `${cap(name)} works out to have been taken from inside the neighbour's home: check the corners tapped on it.` });
      continue;
    }
    if (c.heightFeet != null && (c.heightFeet < CAMERA_FEET[0] || c.heightFeet > CAMERA_FEET[1])) {
      flags.push({
        key: `camera:height:${c.photo}`,
        kind: "camera",
        photo: c.photo,
        words: `${cap(name)} works out ${c.heightFeet < 0 ? `${formatFeetInches(-c.heightFeet)} under the ground` : `${formatFeetInches(c.heightFeet)} ${c.heightFeet < CAMERA_FEET[0] ? "off" : "up off"} the ground`} at the corners tapped on it: check each is tapped where the corner meets the ground (not on a deck or a step), and where it was placed.`,
      });
    }
    if (Math.abs(c.yawTweakDeg) > CAMERA_TURN_DEG) {
      const on = tapsOf(c.photo).map((t) => t.corner + 1).sort((a, b) => a - b);
      flags.push({
        key: `camera:turn:${c.photo}`,
        kind: "camera",
        photo: c.photo,
        words: `${cap(name)} had to be turned ${Math.round(Math.abs(c.yawTweakDeg))}° off its own level lines to fit its corners${on.length ? ` (${on.map((k) => `corner ${k}`).join(", ")})` : ""}: one of them is likely on the wrong edge - a post, a pilaster or a downspout beside the corner - or hidden behind something. Check each, or leave the doubtful one out.`,
      });
    }
    // Each corner tapped on it the first thing of the house its line of sight meets.
    for (const t of tapsOf(c.photo)) {
      const P = ring[t.corner] as Pt;
      const dist = segLen(C, P);
      if (dist < 1) continue;
      const hit = castRayToSides(C, [(P.x - C.x) / dist, (P.y - C.y) / dist], ring);
      if (hit && hit.t < dist - 1) {
        flags.push({ key: `camera:through:${c.photo}:${t.corner}`, kind: "camera", photo: c.photo, corner: t.corner, words: `${cap(name)} works out to see corner ${t.corner + 1} through a wall: check that corner's number on it, and where it was placed.` });
        break;
      }
    }
  }

  // The outline: no side solved to nothing, none the wrong way round from the shape drawn.
  const drawn = building.outline;
  if (drawn.length === n) {
    for (let i = 0; i < n; i++) {
      const A = ring[i] as Pt;
      const B = ring[(i + 1) % n] as Pt;
      const a = drawn[i] as Pt;
      const b = drawn[(i + 1) % n] as Pt;
      const drawnLen = segLen(a, b);
      const dot = (B.x - A.x) * (b.x - a.x) + (B.y - A.y) * (b.y - a.y);
      const gone = segLen(A, B) < SIDE_GONE_FEET && drawnLen >= 3;
      if (!gone && dot >= 0) continue;
      const look = [...new Set(building.corners.filter((t) => !t.proposed && (t.corner === i || t.corner === (i + 1) % n)).map((t) => photoNo(t.photo)))];
      flags.push({
        key: `outline:${i}`,
        kind: "outline",
        side: i,
        words: `The outline won't close square at ${wallWords(i)}: it came out ${gone ? "to nothing" : "the wrong way round"}. Check the numbers of corners ${i + 1} and ${((i + 1) % n) + 1}${look.length ? ` on ${look.join(", ")}` : ""}.`,
      });
    }
  }

  // The depth: untaped and hardly tied, back to front.
  const runsBack = (i: number) => {
    const A = ring[i] as Pt;
    const B = ring[(i + 1) % n] as Pt;
    return Math.abs(B.x - A.x) < Math.abs(B.y - A.y);
  };
  const back = m.sides.filter((s) => runsBack(s.from) && !shared.has(s.from));
  const longest = back.reduce<(typeof back)[number] | null>((a, s) => (!a || s.lengthFeet > a.lengthFeet ? s : a), null);
  const tapedBack = m.sides.some((s) => runsBack(s.from) && s.taped);
  if (longest && !tapedBack && (longest.plusMinusPct ?? 0) > DEPTH_LOOSE_PCT) {
    flags.push({
      key: "depth",
      kind: "depth",
      side: longest.from,
      words: `The house's depth is only good to ±${longest.plusMinusPct}% (${wallWords(longest.from)}, ${formatFeetInches(longest.lengthFeet)}): too little ties its back to its front. One tape of that side wall, front corner to back corner, measures it; or tap its far corners on the photos that show them.`,
    });
  }

  // Sizes estimated on site that the measure disagrees with: the measure is not moved, a tape is asked for.
  for (const s of m.sides) {
    if (s.taped || shared.has(s.from) || !s.estimateCheck?.disagrees) continue;
    flags.push({ key: `estimate:${s.from}`, kind: "estimate", side: s.from, words: `${cap(wallWords(s.from))} was ${estimateDisagreement(s.lengthFeet, s.estimateCheck)}` });
  }

  // A measurement on a close-up laid on its wall: as long on the wall as measured, within 5%. It sized nothing, so it checks
  // the wall's scale - or its ends are off.
  const lines = building.tapes.filter((t): t is Extract<(typeof building.tapes)[number], { kind: "line" }> => t.kind === "line");
  if (lines.length && (m.matches ?? []).length) {
    const { laid } = closeUpsOnSides(route, m);
    for (const t of lines) {
      const c = laid.find((l) => l.photo === t.photo);
      if (!c || shared.has(c.side)) continue;
      const chk = checkOnWall(c.sp, t.a, t.b, t.feet);
      if (!chk || chk.agrees) continue;
      const on = photoNo(t.photo);
      flags.push({
        key: `closeup:${t.id}`,
        kind: "closeup",
        photo: t.photo,
        side: c.side,
        words: `${measureWords(t)} on ${on}, a close-up laid on ${wallWords(c.side)}: the wall as measured makes it ${feetInchesEighths(chk.feet)}, ${Math.round(Math.abs(chk.offPct))}% ${chk.offPct > 0 ? "longer" : "shorter"} (more than ${DETAIL_CHECK_PCT}%). Check its ends on ${on} are where the tape's were; if they are, ${wallWords(c.side)} is sized ${chk.offPct > 0 ? "large" : "small"} by about that much - a tape along it settles it.`,
      });
    }
  }
  return flags;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function insideOutline(p: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Pt;
    const b = ring[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
