/**
 * Scrivn Scan's exterior capture into the claim's exterior (2026-10-12): Scan's own format,
 * `arcapture-exterior/1`, read as it is - see docs/exterior-import.md for the format and how each
 * key lands.
 *
 * Scan measures in metres, each side's heights from one grade level (its ground estimate where that
 * side was tapped), side by side round the house, and works
 * out its own areas. Scrivn keeps what was measured - lengths, heights, the peak, the band lines,
 * the openings, which corners are inside ones - and works the areas out again itself, so a side
 * typed by hand and a side tapped on the phone are priced by the same arithmetic. Scan's own net
 * area is checked against Scrivn's on the way in and any side that disagrees is named.
 *
 * It arrives either as the file Scan's Export writes (room_<stamp>_exterior.json), through the
 * editor's Import scan, or under an "exterior" key of the capture a phone sends - with the rooms,
 * or alone in a capture with none.
 *
 * Since Scan 0.1.151 each side may carry photos, each with the matrix that lays it on the side's
 * elevation; they are kept with the scan they came with, for lib/exteriorPhoto.ts to square up.
 */

import { formatFeetInches, newSketchId } from "./sketch";
import {
  CLADDING_KINDS,
  type CladdingBand,
  type CladdingKind,
  defaultRoof,
  type Exterior,
  type ExteriorOpening,
  type ExteriorOpeningKind,
  type ExteriorScale,
  type ExteriorShape,
  type ExteriorSide,
  type SidePhoto,
  sideQuantities,
} from "./exterior";
import { applyScanFinish, readScanFinish } from "./exteriorFinish";

export const EXTERIOR_FORMAT = "arcapture-exterior/1";
/**
 * /2 (2026-10-12): each material tapped round as a shape, and the roof's edge as a roofline - the
 * owner's field test on his own gable end, where the stucco runs on over a covered deck.
 */
export const EXTERIOR_FORMAT_2 = "arcapture-exterior/2";
const EXTERIOR_FORMATS: unknown[] = [EXTERIOR_FORMAT, EXTERIOR_FORMAT_2];

const FEET_PER_METRE = 1 / 0.3048;
/** No house side is longer, and no tap higher; past these a number is a slip, not a house. */
const MAX_LENGTH_M = 200;
const MAX_HEIGHT_M = 60;
const MAX_SIDES = 40;
const MAX_OPENINGS = 100;
const MAX_SHAPES = 40;
/** A side photographed in a few stills side by side is a tight side; more than this is a slip. */
const MAX_PHOTOS = 8;
/** Scan numbers a side's photos from 900, under the scan photos' cap of 1000 (lib/scanPhotos.ts). */
const MIN_SIDE_PHOTO = 900;
const MAX_SIDE_PHOTO = 999;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A scan body as an object: the phone may send it parsed or as its JSON text. */
function asObject(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** The exterior a scan body carries: the body itself when it is Scan's exterior file, else its "exterior" key. */
export function scanExteriorPart(input: unknown): Json | null {
  const body = asObject(input);
  if (!isObject(body)) return null;
  if (EXTERIOR_FORMATS.includes(body.format)) return body;
  const inner = body.exterior;
  return isObject(inner) && EXTERIOR_FORMATS.includes(inner.format) ? inner : null;
}

/** Whether a scan body has rooms to draw: a capture's non-empty "rooms", or a one-room file's outline. */
export function scanHasRooms(input: unknown): boolean {
  const body = asObject(input);
  if (!isObject(body) || EXTERIOR_FORMATS.includes(body.format)) return false;
  if (Array.isArray(body.rooms)) return body.rooms.length > 0;
  return true;
}

/** A capture that is ONLY an exterior: Scan's file on its own, or a capture with the key and no rooms. */
export function isExteriorOnlyScan(body: unknown): boolean {
  return scanExteriorPart(body) !== null && !scanHasRooms(body);
}

function claddingOf(raw: unknown): { kind: CladdingKind; label?: string } {
  if (typeof raw === "string" && (CLADDING_KINDS as string[]).includes(raw) && raw !== "other") return { kind: raw as CladdingKind };
  return { kind: "other", label: typeof raw === "string" && raw.trim() ? raw.trim().replace(/_/g, " ") : undefined };
}

function openingKind(raw: unknown): ExteriorOpeningKind {
  return raw === "door" || raw === "garage" ? raw : "window";
}

/** A height in metres within reason, or null. */
function height(v: unknown): number | null {
  const n = num(v);
  return n !== null && n >= -5 && n <= MAX_HEIGHT_M ? n : null;
}

/**
 * A side's photos (Scan 0.1.151): each with its number, its camera, the 3x3 that lays it on the
 * elevation and how much of the side it holds. One that cannot be laid on the wall - no matrix, a
 * number outside Scan's range - is left out, as Scan leaves out a photo of a side with no frame.
 */
function sidePhotos(raw: unknown, scanId: string | null): SidePhoto[] {
  if (!Array.isArray(raw)) return [];
  const photos: SidePhoto[] = [];
  for (const p of raw.slice(0, MAX_PHOTOS)) {
    if (!isObject(p) || !isObject(p.camera)) continue;
    const n = num(p.n);
    const c = p.camera;
    const camera = { width: num(c.width), height: num(c.height), fx: num(c.fx), fy: num(c.fy), cx: num(c.cx), cy: num(c.cy) };
    const toPhoto = Array.isArray(p.to_photo) ? p.to_photo.map(num) : [];
    if (n === null || !Number.isInteger(n) || n < MIN_SIDE_PHOTO || n > MAX_SIDE_PHOTO) continue;
    if (camera.width === null || camera.height === null || camera.width <= 0 || camera.height <= 0) continue;
    if (toPhoto.length !== 9 || toPhoto.some((v) => v === null)) continue;
    const v = p.in_view;
    const from = isObject(v) ? num(v.from_m) : null;
    const to = isObject(v) ? num(v.to_m) : null;
    photos.push({
      n,
      scanId,
      camera: { width: camera.width, height: camera.height, fx: camera.fx ?? 0, fy: camera.fy ?? 0, cx: camera.cx ?? camera.width / 2, cy: camera.cy ?? camera.height / 2 },
      toPhoto: toPhoto as number[],
      inView: isObject(v) && from !== null && to !== null ? { fromM: from, toM: to, leftEnd: v.left_end === true, rightEnd: v.right_end === true, top: v.top === true } : null,
    });
  }
  return photos;
}

/** `scanIndex`: each side's index in Scan's file, by the id Scrivn gave it - what the phone names a side by (lib/exteriorFinish.ts). */
export type ExteriorImportResult = { ok: true; exterior: Exterior; notes: string[]; scanIndex: Record<string, number> } | { ok: false; error: string };

/** Scan's exterior, read into the claim's exterior model. */
export function parseScanExterior(input: unknown, meta: { scanId?: string | null; receivedAt?: string | null } = {}): ExteriorImportResult {
  const part = scanExteriorPart(input);
  if (!part) return { ok: false, error: "This file is not a Scrivn Scan exterior." };
  const rawSides = Array.isArray(part.sides) ? part.sides : [];
  if (rawSides.length === 0) return { ok: false, error: "The exterior has no sides in it." };
  if (rawSides.length > MAX_SIDES) return { ok: false, error: `The exterior has ${rawSides.length} sides, more than a house has.` };

  const walkLeft = part.walk === "left";
  const notes: string[] = [];

  // The corner at each side's RIGHT end (facing it from outside). Walking right, side `from` ends
  // there; walking left, the walk leaves side `from` by its left end, so the corner is `to`'s right.
  const inside = new Set<number>();
  if (Array.isArray(part.corners)) {
    for (const c of part.corners) {
      if (!isObject(c) || c.outside !== false) continue;
      const at = num(walkLeft ? c.to : c.from);
      if (at !== null) inside.add(at);
    }
  }

  const sides: ExteriorSide[] = [];
  /** Each side's id by Scan's index for it: what its tape names. */
  const idByIndex = new Map<number, string>();
  const unmeasured: string[] = [];
  const disagree: string[] = [];
  const uneven: string[] = [];
  const open: string[] = [];
  /** Each side's roofline in metres, for the overhangs and for a roof that runs on past a wall. */
  const rooflines: { name: string; lengthM: number; points: { along: number; up: number; out: number | null; kind: "left_end" | "peak" | "right_end" | "point" | null }[] }[] = [];
  const overlapping: string[] = [];
  let photographed = 0;
  for (let i = 0; i < rawSides.length; i++) {
    const raw = rawSides[i];
    if (!isObject(raw)) return { ok: false, error: `Side ${i + 1} is not a side.` };
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `Side ${i + 1}`;
    const lengthM = num(raw.length_m);
    if (lengthM === null || lengthM <= 0 || lengthM > MAX_LENGTH_M) return { ok: false, error: `${name} has no usable length.` };
    const L = lengthM;

    /*
      Every height on a side is above ONE grade level: Scan's ground estimate where the side was
      tapped (or the lower bottom corner, with "grade": "corners"). Scan does not see the ground
      slope along a wall, so nothing here is moved for one - a band line is at the height tapped,
      wherever along the wall it was tapped. The eave is level, so two eave taps that differ are
      the same line read twice: they are averaged, and a difference worth seeing is said.
    */
    const tappedL = height(raw.eave_left_m);
    const tappedR = height(raw.eave_right_m) ?? tappedL;
    /*
      /2's sides are tapped as shapes, and its eaves are worked out from them: the highest corner over
      each bottom corner, which on a gable whose stucco steps out over a deck really do differ. They
      are kept as they are. /1's were two taps of one eave line, so they are averaged.
    */
    const rawShapes = (Array.isArray(raw.shapes) ? raw.shapes : []).filter(isObject);
    const tappedAsShapes = rawShapes.length > 0;
    const eave = tappedL !== null && tappedR !== null ? (tappedL + tappedR) / 2 : tappedL;
    const eaveLeft = tappedAsShapes ? tappedL : eave;
    const eaveRight = tappedAsShapes ? tappedR : eave;
    if (!tappedAsShapes && tappedL !== null && tappedR !== null && Math.abs(tappedR - tappedL) > 0.025) uneven.push(`${name} (${Math.round(Math.abs(tappedR - tappedL) / 0.0254)} in)`);
    const shapes: ExteriorShape[] = [];
    for (const sh of rawShapes.slice(0, MAX_SHAPES)) {
      const polygon = (Array.isArray(sh.polygon) ? sh.polygon : [])
        .map((pt) => (Array.isArray(pt) ? { x: num(pt[0]), y: height(pt[1]) } : { x: null, y: null }))
        .filter((pt): pt is { x: number; y: number } => pt.x !== null && pt.y !== null && Math.abs(pt.x) <= MAX_LENGTH_M)
        .map((pt) => ({ x: pt.x * FEET_PER_METRE, y: pt.y * FEET_PER_METRE }));
      if (polygon.length < 2) continue;
      const material = sh.material === "parging" ? { kind: "parging" as const } : claddingOf(sh.material);
      const closed = sh.closed !== false && polygon.length >= 3;
      if (!closed) open.push(`${name} (${typeof sh.material === "string" ? sh.material.replace(/_/g, " ") : "a shape"})`);
      shapes.push({ id: newSketchId("shape"), ...material, closed, polygon });
    }
    // Each point says what it is ("left_end", "peak", "right_end") since Scan's 411dc42; earlier files are read by order and height.
    const roofline = (Array.isArray(raw.roofline) ? raw.roofline : [])
      .filter(isObject)
      // "point" (Scan def1456) is a turn in the roof edge between its ends: kept for the drawing, neither end nor peak.
      .map((r) => ({ along: num(r.along_m), up: height(r.up_m), out: num(r.out_m), kind: r.kind === "left_end" || r.kind === "peak" || r.kind === "right_end" || r.kind === "point" ? r.kind : null }))
      .filter((r): r is { along: number; up: number; out: number | null; kind: "left_end" | "peak" | "right_end" | "point" | null } => r.along !== null && r.up !== null && Math.abs(r.along) <= MAX_LENGTH_M)
      .sort((a, b) => a.along - b.along);
    if (roofline.length > 0) rooflines.push({ name, lengthM: L, points: roofline });
    /*
      A pitch under 1.5/12, or a "peak" that does not stand 0.3 m over both eaves, is not a gable -
      Scan's own rules since def1456, kept here too so a file written before them reads the same: on
      the owner's 14:20 walk the long rear's roof edge bowed 3 in at its middle and came out as a
      0.8/12 gable, and the right side's highest corner as 0.06/12.
    */
    const rawPitch = num(raw.pitch_12);
    const pitch12 = rawPitch !== null && rawPitch >= 1.5 && rawPitch <= 24 ? rawPitch : null;
    const bottomL = height(raw.bottom_left_m) ?? 0;
    const bottomR = height(raw.bottom_right_m) ?? bottomL;

    // Bands bottom up; a parging line is the bottom of the cladding, not a cladding.
    const lines = (Array.isArray(raw.bands) ? raw.bands : [])
      .filter(isObject)
      .map((b) => ({ top: height(b.height_m), below: b.below }))
      .filter((b): b is { top: number; below: unknown } => b.top !== null)
      .sort((a, b) => a.top - b.top);
    let baseL = bottomL;
    let baseR = bottomR;
    const bands: CladdingBand[] = [];
    for (const line of lines) {
      if (line.below === "parging") {
        if (Math.max(baseL, baseR) < 0.01) {
          baseL = line.top;
          baseR = line.top;
        }
        continue;
      }
      bands.push({ id: newSketchId("band"), ...claddingOf(line.below), top: line.top * FEET_PER_METRE });
    }
    // A side tapped as shapes keeps one band of its main cladding, for when the shapes are set aside by hand.
    bands.push({ id: newSketchId("band"), ...claddingOf(raw.cladding ?? "stucco"), top: null });

    const openings: ExteriorOpening[] = [];
    for (const o of (Array.isArray(raw.openings) ? raw.openings : []).slice(0, MAX_OPENINGS)) {
      if (!isObject(o)) continue;
      const from = num(o.from_m);
      const width = num(o.width_m);
      const sill = height(o.sill_m);
      const head = height(o.head_m);
      if (from === null || width === null || width <= 0 || sill === null || head === null || head <= sill) continue;
      openings.push({
        id: newSketchId("opening"),
        kind: openingKind(o.kind),
        widthFeet: width * FEET_PER_METRE,
        heightFeet: (head - sill) * FEET_PER_METRE,
        sillFeet: Math.max(0, sill) * FEET_PER_METRE,
        fromLeftFeet: Math.max(0, from) * FEET_PER_METRE,
      });
    }

    let gable: ExteriorSide["gable"] = null;
    if (isObject(raw.peak)) {
      const along = num(raw.peak.along_m);
      const peak = height(raw.peak.height_m);
      const over = Math.max(tappedL ?? -Infinity, tappedR ?? -Infinity);
      const stands = peak !== null && (!Number.isFinite(over) || peak >= over + 0.3);
      if (along !== null && peak !== null && stands && (rawPitch === null || rawPitch >= 1.5)) {
        const from = num(raw.peak.from_m);
        const to = num(raw.peak.to_m);
        gable = {
          peakFeet: peak * FEET_PER_METRE,
          atFeet: along * FEET_PER_METRE,
          ...(from !== null ? { fromFeet: from * FEET_PER_METRE } : {}),
          ...(to !== null ? { toFeet: to * FEET_PER_METRE } : {}),
        };
      }
    }

    const base = Math.max(baseL, baseR) < 0.01 ? "grade" : "parging";
    const photos = sidePhotos(raw.photos, meta.scanId ?? null);
    if (photos.length > 0) photographed++;
    const side: ExteriorSide = {
      id: newSketchId("side"),
      name,
      lengthFeet: L * FEET_PER_METRE,
      turn: inside.has(num(raw.index) ?? i) ? "inside" : "outside",
      base,
      baseLeftFeet: Math.max(0, baseL) * FEET_PER_METRE,
      baseRightFeet: Math.max(0, baseR) * FEET_PER_METRE,
      eaveLeftFeet: eaveLeft === null ? null : eaveLeft * FEET_PER_METRE,
      eaveRightFeet: eaveRight === null ? null : eaveRight * FEET_PER_METRE,
      gable,
      bands,
      openings,
      heightsFrom: "level",
      ...(shapes.length > 0 ? { shapes } : {}),
      ...(roofline.length > 0 ? { roofline: roofline.map((r) => ({ alongFeet: r.along * FEET_PER_METRE, upFeet: r.up * FEET_PER_METRE, outFeet: r.out === null ? null : r.out * FEET_PER_METRE })) } : {}),
      ...(pitch12 !== null ? { pitchMeasured: pitch12 } : {}),
      ...(photos.length > 0 ? { photos } : {}),
    };
    sides.push(side);
    idByIndex.set(num(raw.index) ?? i, side.id);
    const covered = sideQuantities(side).bands.reduce((sum, b) => sum + (b.overlapSquareFeet ?? 0), 0);
    if (covered > 1) overlapping.push(`${name} (${Math.round(covered)} SF)`);

    if (eave === null && shapes.length === 0) unmeasured.push(name);
    /*
      Scan's own area, against Scrivn's own arithmetic. The gable is the measured one or none: the
      roof is not built yet. /2's net_sf counts its parging, which Scrivn does not, so a side tapped
      as shapes is checked against the net of its closed shapes of cladding instead.
    */
    const cladShapes = rawShapes.filter((sh) => sh.material !== "parging" && sh.closed !== false);
    const theirs = tappedAsShapes ? cladShapes.reduce((sum, sh) => sum + (num(sh.net_m2) ?? 0), 0) / (0.3048 * 0.3048) : num(raw.net_sf);
    if (theirs !== null && (eave !== null || tappedAsShapes)) {
      const ours = sideQuantities(side).netSquareFeet;
      if (Math.abs(ours - theirs) > Math.max(2, theirs * 0.02)) disagree.push(`${name} (Scan ${Math.round(theirs)} SF, Scrivn ${Math.round(ours)} SF)`);
    }
  }
  // Walked the other way round: the same ring the other way, the Front still first.
  if (walkLeft) sides.splice(1, sides.length - 1, ...sides.slice(1).reverse());

  const closed = part.closed === true;
  notes.push(`Exterior imported: ${sides.length} side${sides.length === 1 ? "" : "s"} measured on the phone${closed ? "" : ", but the walk did not go all the way round, so there is no footprint or roof until the rest are put in"}.`);
  /*
    The tape (2026-10-15, lib/exteriorScale.ts): Scan has already scaled every length and height by
    it, so the sizes arrive FROM the tape, and the phone's own read of the side is the tape over the
    scale. The editor says so, and flags the two more than 3% apart.
  */
  const rawScale = num(part.scale);
  const factor = rawScale !== null && rawScale > 0.5 && rawScale < 2 ? rawScale : 1;
  const taped = isObject(part.taped) ? part.taped : null;
  const tapedId = taped ? idByIndex.get(num(taped.side) ?? -1) : undefined;
  const tapedM = taped ? num(taped.metres) : null;
  const scale: ExteriorScale =
    tapedId !== undefined && tapedM !== null && tapedM > 0
      ? { from: "tape", factor, tape: { sideId: tapedId, feet: tapedM * FEET_PER_METRE, phoneFeet: (tapedM / factor) * FEET_PER_METRE, by: "scan" } }
      : Math.abs(factor - 1) > 0.0005
        ? { from: "tape", factor }
        : { from: "phone", factor: 1 };
  if (unmeasured.length > 0) notes.push(`No eave was tapped on ${unmeasured.join(", ")}: put it in to count that side.`);
  if (uneven.length > 0) notes.push(`The two eave taps differ on ${uneven.join(", ")}; the eave is level, so the two are averaged.`);
  if (open.length > 0) notes.push(`A shape left open is drawn but not counted: ${open.join(", ")}.`);
  if (overlapping.length > 0) notes.push(`Shapes overlap on ${overlapping.join(", ")}: each overlap is counted once, as the shape tapped later.`);
  /*
    Scrivn takes out of the cladding only the part of an opening inside it. A garage door that runs
    below the stucco's bottom edge - on the owner's 14:20 walk, 5-7 in below it on two sides - is
    taken out whole by a Scan file of that time, which the difference here then shows.
  */
  if (disagree.length > 0) notes.push(`Scan and Scrivn work out different areas for ${disagree.join("; ")}. Scrivn takes out of the cladding only the part of each opening that is in it; check those sides.`);
  if (photographed > 0) {
    const which = `${photographed} side${photographed === 1 ? " was" : "s were"} photographed`;
    notes.push(
      meta.scanId
        ? `${which}: open a side to see its photo squared up behind the elevation, and AI trace it.`
        : `${which}, but a file brings no photos: send the scan from the phone to see them here.`,
    );
  }
  notes.push("Type the pitch, or check the one the gables give, and the overhangs, on Plan & roof.");

  const roof = defaultRoof();
  /*
    The overhangs from the rooflines: how far the roof's edge stands in front of the wall face. On a
    side whose roofline has a peak that is the rake; on one without, the eave. Each where the phone
    read it by depth; the median of the sides, so one odd read does not set the roof.
  */
  // A peak stands 0.3 m over both ends of the roof edge, named or not.
  const hasPeak = (pts: { up: number; kind: string | null }[]) => {
    if (pts.length < 3) return false;
    const ends = Math.max((pts[0] as { up: number }).up, (pts[pts.length - 1] as { up: number }).up);
    const named = pts.some((p) => p.kind !== null);
    return pts.slice(1, -1).some((p) => (!named || p.kind === "peak") && p.up >= ends + 0.3);
  };
  const median = (v: number[]) => {
    const sorted = [...v].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? (sorted[m] as number) : ((sorted[m - 1] as number) + (sorted[m] as number)) / 2;
  };
  const outs = (gable: boolean) => rooflines.filter((r) => hasPeak(r.points) === gable).flatMap((r) => r.points.map((p) => p.out).filter((o): o is number => o !== null && o >= 0 && o < 3));
  const eaveOuts = outs(false);
  const rakeOuts = outs(true);
  // The phone's, not typed: the side photos' reads go over them (2026-10-15, lib/exterior.ts).
  if (eaveOuts.length > 0) {
    roof.eaveOverhangFeet = median(eaveOuts) * FEET_PER_METRE;
    roof.overhangSource = { ...roof.overhangSource, eave: "scan" };
  }
  if (rakeOuts.length > 0) {
    roof.rakeOverhangFeet = median(rakeOuts) * FEET_PER_METRE;
    roof.overhangSource = { ...roof.overhangSource, rake: "scan" };
  }
  const read = [eaveOuts.length > 0 ? `eave ${formatFeetInches(roof.eaveOverhangFeet)}` : null, rakeOuts.length > 0 ? `rake ${formatFeetInches(roof.rakeOverhangFeet)}` : null].filter(Boolean);
  if (read.length > 0) notes.push(`Overhangs from the phone's roofline: ${read.join(", ")}.`);
  /*
    A roof that runs well past a wall - over a deck or a porch - is more than the roof plan draws: it
    is the footprint and one overhang all round. Past a gable side's ends the roof should reach the
    eave overhang, past an eave side's the rake overhang; anything 2 ft beyond that is said.
  */
  for (const r of rooflines) {
    const typical = (hasPeak(r.points) ? roof.eaveOverhangFeet : roof.rakeOverhangFeet) / FEET_PER_METRE;
    // The ends as Scan names them; by order when it does not. A lone end is only its own end.
    const named = r.points.some((p) => p.kind !== null);
    const left = named ? r.points.find((p) => p.kind === "left_end") : r.points[0];
    const right = named ? r.points.find((p) => p.kind === "right_end") : r.points[r.points.length - 1];
    for (const [end, past] of [
      ["left", left ? -left.along : -Infinity],
      ["right", right ? right.along - r.lengthM : -Infinity],
    ] as [string, number][]) {
      if (past > typical + 0.6) notes.push(`The roof runs ${formatFeetInches(past * FEET_PER_METRE)} past ${r.name}'s ${end} end, over a porch or deck: the roof plan does not draw that yet.`);
    }
  }
  if (isObject(part.roof)) {
    const pitch = num(part.roof.pitch_in_12 ?? part.roof.pitch_12);
    const eaveOver = num(part.roof.eave_overhang_m);
    const rakeOver = num(part.roof.rake_overhang_m);
    if (pitch !== null && pitch >= 0 && pitch <= 24) roof.pitch = pitch;
    if (eaveOver !== null && eaveOver >= 0 && eaveOver < 3) {
      roof.eaveOverhangFeet = eaveOver * FEET_PER_METRE;
      roof.overhangSource = { ...roof.overhangSource, eave: "scan" };
    }
    if (rakeOver !== null && rakeOver >= 0 && rakeOver < 3) {
      roof.rakeOverhangFeet = rakeOver * FEET_PER_METRE;
      roof.overhangSource = { ...roof.overhangSource, rake: "scan" };
    }
  }

  /*
    Finish exterior on the phone (2026-10-15, lib/exteriorFinish.ts): the roof read off the side photos
    there, and the pitch and ends the estimator set there, put on as the phone had them - so the claim's
    roof is the one the phone showed, and no photo is traced twice.
  */
  const finish = readScanFinish(part.finish);
  let finishedSides = sides;
  let finishedRoof = roof;
  if (finish) {
    const done = applyScanFinish(sides, roof, finish, idByIndex, factor);
    finishedSides = done.sides;
    finishedRoof = done.roof;
    notes.push(...done.notes);
  }

  const outer = asObject(input);
  const captureId = typeof part.capture_id === "string" ? part.capture_id : isObject(outer) && typeof outer.capture_id === "string" ? outer.capture_id : null;
  return {
    ok: true,
    exterior: {
      sides: finishedSides,
      roof: finishedRoof,
      scale,
      source: {
        kind: "scan",
        captureId,
        scanId: meta.scanId ?? null,
        receivedAt: meta.receivedAt ?? null,
        notes,
        ...(closed ? {} : { walkClosed: false }),
        ...(finish ? { finish: { at: finish.at ?? null, acceptedAt: finish.acceptedAt ?? null, engine: finish.engine ?? null } } : {}),
      },
    },
    notes,
    scanIndex: Object.fromEntries([...idByIndex.entries()].map(([index, id]) => [id, index])),
  };
}

/**
 * Whether a scan's exterior may replace the claim's without asking: when there is none, or the one
 * there came from a scan too and nobody has changed a measurement since. An exterior measured or
 * corrected by hand is the estimator's work and is kept.
 */
export function exteriorReplaceable(current: Exterior | undefined): boolean {
  return current === undefined || (current.source?.kind === "scan" && current.source.edited !== true);
}
