import {
  defaultDryStandard,
  dryStandardSource,
  hasRoomMoisture,
  MATERIAL_LABEL,
  MATERIAL_ORDER,
  type MoistureMap,
  type MoistureMaterial,
} from "./moisture";
import { levelName, levelsOf, roomLevel, wallsOf, type Sketch } from "./sketch";
import { psychrometrics, roundTo } from "./psychrometrics";

/**
 * The drying log: what was read at each visit, until the building is dry (2026-10-13).
 *
 * ── Why this is its own object, beside the moisture map ──────────────────────────────────────────
 * `lib/moisture.ts` says in its first paragraphs that the map records what is wet NOW, with "no
 * timestamp, no reading history, no visit number", and that a second set of readings "would be a
 * different feature with a different shape". This is that feature. The map is untouched: it stays
 * the picture of the loss on the day it was drawn, and still sizes the equipment. The log is a
 * separate record that refers to it.
 *
 * What it refers to: the dry standards. A dry standard is measured once for the building and the
 * material (`MoistureMap.reference`), so the log reads it live rather than copying it, and a standard
 * corrected on day two reaches every visit's judgement at once. A point can carry its own standard,
 * which wins, for the odd wall that has a reason to differ.
 *
 * ── What is typed and what is worked out ─────────────────────────────────────────────────────────
 * Typed: dates, who, the meter, temperature and humidity, a reading per point, equipment counts, notes.
 * Worked out, never stored: GPP and dew point (`psychrometrics`), whether a point is at its goal, the
 * trend, the day number, the summary. A stored copy of any of those could disagree with what it was
 * made from, and the log goes out as a document.
 *
 * ── What a reading is judged against ─────────────────────────────────────────────────────────────
 * A point is at its goal when the reading is at or below the dry standard plus a variance. IICRC S500
 * (V5, 2021) is cited, by restoration software that implements it, as recommending a goal within 10%
 * of the dry standard, so 10% is the default. It is a setting on the log, shown wherever the goal is
 * shown, because the standard publishes no number per material and a firm is entitled to its own. A
 * reading with no standard to compare against is "no standard", never "dry": silence is not a result.
 *
 * ── Saved with the claim ─────────────────────────────────────────────────────────────────────────
 * `SavedClaimState.dryingLog`, one top-level key, normalised by `normalizeDryingLog` on every load:
 * `parseSavedClaimState` merges a key at a time, so a field added here later would never be filled in
 * on a claim saved before it. Every visit and point has its own id, so two copies of a log that
 * drifted apart (a phone in a basement, an office laptop) can be put together by id one day.
 */

export const GOAL_MARGIN_DEFAULT_PERCENT = 10;
export const DRYING_LOG_VERSION = 1;

export type TempUnit = "F" | "C";

/** Which kind of surface a point is on. Only the label and the default material depend on it. */
export type PointSurface = "wall" | "floor" | "ceiling" | "other";

export interface DryingPoint {
  id: string;
  /** What the tech sees: "Kitchen, Wall 2". */
  label: string;
  roomId: string | null;
  surface: PointSurface;
  material: MoistureMaterial;
  /**
   * Where the point came from. "wall:<reading id>", "floor:<room id>" or "ceiling:<room id>" for a point
   * taken from the moisture map (so asking for the map's points again adds only the ones that are new),
   * "added" for one the tech made.
   */
  origin: string;
  /** A dry standard for THIS point alone. Null follows the job's reference for the material. */
  standard: number | null;
  /** False once the tech has stopped reading it, because it reached its goal. It stays in the history. */
  active: boolean;
}

/**
 * One meter reading at one point. `value` is the number; the rest is reserved for meters that report
 * more than a number (a photo of the screen, a Bluetooth link) and is carried through untouched.
 */
export interface PointReading {
  value: number | null;
  mode?: "pin" | "pinless" | "rh";
  scale?: string;
  meter?: string;
  source?: "typed" | "photo" | "bluetooth";
}

/** A dry-bulb temperature and a relative humidity: the two things a thermo-hygrometer shows. */
export interface AirReading {
  /** Always deg F, whatever unit the log shows. See `TempUnit`. */
  tempF: number | null;
  rh: number | null;
}

export interface VisitAir {
  outside: AirReading;
  /** Dry, unaffected space in the same building: what the affected air is being dried toward. */
  unaffected: AirReading;
  /** The affected area, the drying chamber. */
  affected: AirReading;
}

export interface VisitEquipment {
  airMovers: number | null;
  dehumidifiers: number | null;
  notes: string;
}

export interface DryingVisit {
  id: string;
  /** Local date and time, "YYYY-MM-DDTHH:mm", exactly what a datetime-local field holds. */
  at: string;
  /** Who took the readings. */
  by: string;
  /** The meter used, make and model. A dry standard is only comparable to readings from the same meter. */
  meter: string;
  air: VisitAir;
  /** By point id. A point with no entry was not read at this visit. */
  readings: Record<string, PointReading>;
  equipment: VisitEquipment;
  notes: string;
}

export interface DryingLog {
  version: typeof DRYING_LOG_VERSION;
  /** A point is at its goal at or below its dry standard times (1 + this / 100). */
  goalMarginPercent: number;
  /** What the log shows and takes. Storage is deg F, so changing it changes no reading. */
  tempUnit: TempUnit;
  points: DryingPoint[];
  /** Oldest first. */
  visits: DryingVisit[];
}

/* ── Blank things ───────────────────────────────────────────────────────────────────────────────── */

export function emptyDryingLog(): DryingLog {
  return { version: DRYING_LOG_VERSION, goalMarginPercent: GOAL_MARGIN_DEFAULT_PERCENT, tempUnit: "F", points: [], visits: [] };
}

export function emptyAir(): VisitAir {
  const blank = (): AirReading => ({ tempF: null, rh: null });
  return { outside: blank(), unaffected: blank(), affected: blank() };
}

export function emptyEquipment(): VisitEquipment {
  return { airMovers: null, dehumidifiers: null, notes: "" };
}

export function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Whether there is anything to keep or to print. */
export function hasDryingLogContent(log: DryingLog): boolean {
  return log.visits.length > 0 || log.points.length > 0;
}

/* ── Loading ────────────────────────────────────────────────────────────────────────────────────── */

const VISIT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAirReading(value: unknown): AirReading {
  const v = isRecord(value) ? value : {};
  return { tempF: asNumber(v.tempF), rh: asNumber(v.rh) };
}

function normalizePoint(value: unknown): DryingPoint | null {
  if (!isRecord(value)) return null;
  const material = MATERIAL_ORDER.includes(value.material as MoistureMaterial) ? (value.material as MoistureMaterial) : "drywall";
  const surface = (["wall", "floor", "ceiling", "other"] as const).includes(value.surface as PointSurface) ? (value.surface as PointSurface) : "other";
  return {
    id: asString(value.id) || newId("pt"),
    label: asString(value.label).trim() || "Point",
    roomId: typeof value.roomId === "string" ? value.roomId : null,
    surface,
    material,
    origin: asString(value.origin) || "added",
    standard: asNumber(value.standard),
    active: value.active !== false,
  };
}

function normalizeReading(value: unknown): PointReading {
  const v = isRecord(value) ? value : {};
  const out: PointReading = { value: asNumber(v.value) };
  if (v.mode === "pin" || v.mode === "pinless" || v.mode === "rh") out.mode = v.mode;
  if (v.source === "typed" || v.source === "photo" || v.source === "bluetooth") out.source = v.source;
  if (typeof v.scale === "string" && v.scale) out.scale = v.scale;
  if (typeof v.meter === "string" && v.meter) out.meter = v.meter;
  return out;
}

/**
 * A stored log, made safe to render.
 *
 * Takes anything. Missing fields get today's defaults, numbers that are not numbers become empty,
 * readings for a point that no longer exists are dropped, and visits come back oldest first. A claim
 * saved before the log existed arrives as `undefined` and comes back as an empty log.
 */
export function normalizeDryingLog(raw: unknown): DryingLog {
  const base = emptyDryingLog();
  if (!isRecord(raw)) return base;

  const margin = asNumber(raw.goalMarginPercent);
  const points: DryingPoint[] = [];
  const seenPoints = new Set<string>();
  for (const p of Array.isArray(raw.points) ? raw.points : []) {
    const point = normalizePoint(p);
    if (!point || seenPoints.has(point.id)) continue;
    seenPoints.add(point.id);
    points.push(point);
  }

  const visits: DryingVisit[] = [];
  const seenVisits = new Set<string>();
  for (const v of Array.isArray(raw.visits) ? raw.visits : []) {
    if (!isRecord(v)) continue;
    const id = asString(v.id) || newId("visit");
    if (seenVisits.has(id)) continue;
    seenVisits.add(id);
    const air = isRecord(v.air) ? v.air : {};
    const readings: Record<string, PointReading> = {};
    if (isRecord(v.readings)) {
      for (const [pointId, reading] of Object.entries(v.readings)) {
        if (seenPoints.has(pointId)) readings[pointId] = normalizeReading(reading);
      }
    }
    const equipment = isRecord(v.equipment) ? v.equipment : {};
    visits.push({
      id,
      at: VISIT_TIME.test(asString(v.at)) ? asString(v.at).slice(0, 16) : "",
      by: asString(v.by),
      meter: asString(v.meter),
      air: { outside: normalizeAirReading(air.outside), unaffected: normalizeAirReading(air.unaffected), affected: normalizeAirReading(air.affected) },
      readings,
      equipment: { airMovers: asNumber(equipment.airMovers), dehumidifiers: asNumber(equipment.dehumidifiers), notes: asString(equipment.notes) },
      notes: asString(v.notes),
    });
  }
  // A visit with no usable date sorts last rather than being thrown away: it was typed by somebody.
  visits.sort((a, b) => (a.at === "" ? 1 : b.at === "" ? -1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    version: DRYING_LOG_VERSION,
    goalMarginPercent: margin !== null && margin >= 0 && margin <= 100 ? margin : GOAL_MARGIN_DEFAULT_PERCENT,
    tempUnit: raw.tempUnit === "C" ? "C" : "F",
    points,
    visits,
  };
}

/* ── Dates ──────────────────────────────────────────────────────────────────────────────────────── */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateParts(at: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(at);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** "Oct 13": the day, without the year and without anything that depends on the reader's locale. */
export function formatVisitDate(at: string): string {
  const p = dateParts(at);
  if (!p || p.m < 1 || p.m > 12) return "No date";
  return `${MONTHS[p.m - 1]} ${p.d}`;
}

/** "2:15 PM". */
export function formatVisitTime(at: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(at);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${suffix}`;
}

/** "Oct 13, 2026", for a document. */
export function formatVisitDateLong(at: string): string {
  const p = dateParts(at);
  if (!p || p.m < 1 || p.m > 12) return "No date";
  return `${MONTHS[p.m - 1]} ${p.d}, ${p.y}`;
}

/** The local date and time now, as a datetime-local field holds it. */
export function localNow(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/** Calendar days from one date to another, by date alone: a visit at 11 pm and one at 7 am next day are a day apart. */
function daysBetween(fromAt: string, toAt: string): number | null {
  const a = dateParts(fromAt);
  const b = dateParts(toAt);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

/**
 * The day of the job a visit falls on: the first visit is Day 1, and a visit three calendar days later
 * is Day 4, whatever the number of visits between. That is what "day 4" means on a drying job. Null for
 * a visit with no date.
 */
export function dayNumber(log: DryingLog, visit: DryingVisit): number | null {
  const first = log.visits.find((v) => v.at !== "");
  if (!first || visit.at === "") return null;
  const days = daysBetween(first.at, visit.at);
  return days === null ? null : Math.max(0, days) + 1;
}

/* ── Standards and goals ────────────────────────────────────────────────────────────────────────── */

/**
 * Where the number a reading is judged against came from, in the order a firm would trust them:
 *   point     - typed for this point
 *   reference - metered on unaffected material in this building (what a dry standard is)
 *   guide     - the published starting range, which knows nothing about this building
 *   unset     - nothing, so nothing can be said about the reading
 */
export type StandardFrom = "point" | "reference" | "guide" | "unset";

export interface PointStandard {
  value: number | null;
  from: StandardFrom;
}

export function standardFor(point: DryingPoint, map: MoistureMap): PointStandard {
  if (point.standard !== null) return { value: point.standard, from: "point" };
  const reference = map.reference?.[point.material];
  if (reference !== undefined && reference !== null) return { value: reference, from: "reference" };
  const guide = defaultDryStandard(point.material);
  return guide === null ? { value: null, from: "unset" } : { value: guide, from: "guide" };
}

export const STANDARD_FROM_LABEL: Record<StandardFrom, string> = {
  point: "typed for this point",
  reference: "measured on unaffected material",
  guide: "published range, not measured",
  unset: "not set",
};

/** The highest reading that still counts as dry: the dry standard plus the variance. */
export function goalLimit(standard: number, marginPercent: number): number {
  return standard * (1 + marginPercent / 100);
}

export type PointState = "dry" | "wet" | "no-standard" | "unread";

/** Dry at or below the goal, wet above it, and honest when it cannot say. */
export function pointState(value: number | null, standard: number | null, marginPercent: number): PointState {
  if (value === null) return "unread";
  if (standard === null) return "no-standard";
  // The small allowance is for floating point: 0.75 x 1.1 is 0.8250000000000001 and must still hold 0.825.
  return value <= goalLimit(standard, marginPercent) + 1e-9 ? "dry" : "wet";
}

/* ── Reading a log ──────────────────────────────────────────────────────────────────────────────── */

export function readingValue(visit: DryingVisit, pointId: string): number | null {
  return visit.readings[pointId]?.value ?? null;
}

/** The reading before this visit's, at the same point: the last one actually taken. */
export function previousReading(log: DryingLog, visitId: string, pointId: string): { value: number; visit: DryingVisit } | null {
  let found: { value: number; visit: DryingVisit } | null = null;
  for (const visit of log.visits) {
    if (visit.id === visitId) break;
    const value = readingValue(visit, pointId);
    if (value !== null) found = { value, visit };
  }
  return found;
}

export interface Trend {
  direction: "down" | "up" | "same";
  /** Current minus previous, to the hundredth: the finest a typed reading goes (0.85 is a real reading on drywall). */
  delta: number;
}

export function trend(previous: number | null, current: number | null): Trend | null {
  if (previous === null || current === null) return null;
  // Not to the tenth: drywall reads in hundredths of a percent, and 0.9 falling to 0.85 is a wall drying, not "no change".
  const delta = roundTo(current - previous, 2);
  return { direction: delta < 0 ? "down" : delta > 0 ? "up" : "same", delta };
}

export interface LogStatus {
  visitCount: number;
  latest: DryingVisit | null;
  /** The latest visit's day of the job. */
  day: number | null;
  /** Points still being read. */
  activePoints: number;
  /** Of those, at their goal in the latest visit. */
  atGoal: number;
  /** Of those, read and above their goal. */
  wet: number;
  /** Of those, not read in the latest visit. */
  unread: number;
  /** Of those, read but with nothing to compare to. */
  noStandard: number;
  /** Every point still being read was read at the latest visit and is at its goal. */
  complete: boolean;
}

/**
 * Where the job stands, from the latest visit alone.
 *
 * "Complete" is deliberately hard to reach by accident: every point still being read has to have a
 * reading in the LATEST visit, and every one has to be at its goal. A point somebody skipped is unread,
 * not dry, so a half-filled visit cannot tell the office the job is finished.
 */
export function logStatus(log: DryingLog, map: MoistureMap): LogStatus {
  const latest = log.visits.length > 0 ? (log.visits[log.visits.length - 1] as DryingVisit) : null;
  const active = log.points.filter((p) => p.active);
  let atGoal = 0;
  let wet = 0;
  let unread = 0;
  let noStandard = 0;
  for (const point of active) {
    const state = latest ? pointState(readingValue(latest, point.id), standardFor(point, map).value, log.goalMarginPercent) : "unread";
    if (state === "dry") atGoal += 1;
    else if (state === "wet") wet += 1;
    else if (state === "no-standard") noStandard += 1;
    else unread += 1;
  }
  return {
    visitCount: log.visits.length,
    latest,
    day: latest ? dayNumber(log, latest) : null,
    activePoints: active.length,
    atGoal,
    wet,
    unread,
    noStandard,
    complete: latest !== null && active.length > 0 && atGoal === active.length,
  };
}

/** One point's row across every visit: the matrix a summary and a printed log are drawn from. */
export interface MatrixRow {
  point: DryingPoint;
  standard: PointStandard;
  cells: { visitId: string; value: number | null; state: PointState }[];
  /** The day of the job on which a reading first came in at the goal, or null if none has. */
  dryOnDay: number | null;
}

export function readingMatrix(log: DryingLog, map: MoistureMap): MatrixRow[] {
  return log.points.map((point) => {
    const standard = standardFor(point, map);
    const cells = log.visits.map((visit) => {
      const value = readingValue(visit, point.id);
      return { visitId: visit.id, value, state: pointState(value, standard.value, log.goalMarginPercent) };
    });
    const firstDry = log.visits.find((visit, i) => cells[i]?.state === "dry");
    return { point, standard, cells, dryOnDay: firstDry ? dayNumber(log, firstDry) : null };
  });
}

/** Only the readings the standard cannot stand behind: points whose standard was never measured on this job. */
export function pointsOnGuidedStandard(log: DryingLog, map: MoistureMap): DryingPoint[] {
  return log.points.filter((p) => {
    const from = standardFor(p, map).from;
    return from === "guide" || from === "unset";
  });
}

/* ── The air ────────────────────────────────────────────────────────────────────────────────────── */

export interface AirFigures {
  tempF: number;
  rh: number;
  gpp: number;
  dewPointF: number;
}

/** GPP and dew point for one air reading, or null while either number is missing or impossible. */
export function airFigures(air: AirReading): AirFigures | null {
  const r = psychrometrics(air.tempF, air.rh);
  if (r === null || air.tempF === null || air.rh === null) return null;
  return { tempF: air.tempF, rh: air.rh, gpp: r.gpp, dewPointF: r.dewPointF };
}

/**
 * How much more moisture the affected air holds than the unaffected air, in grains per pound.
 * The affected air is being dried toward the unaffected, so this is the gap still to close. Null
 * unless both were read.
 */
export function gppGap(air: VisitAir): number | null {
  const affected = airFigures(air.affected);
  const unaffected = airFigures(air.unaffected);
  return affected && unaffected ? roundTo(affected.gpp - unaffected.gpp, 0) : null;
}

/* ── Making a log ───────────────────────────────────────────────────────────────────────────────── */

export interface EquipmentCounts {
  airMovers: number | null;
  dehumidifiers: number | null;
}

/**
 * The map's points that the log does not have yet.
 *
 * One point per wet stretch of wall (named by the room and the same wall number the moisture panel
 * shows), and one each for a room's painted floor and painted ceiling. Painted areas have no reading in
 * the map, so their points start empty; a tech reads them at each visit like any other.
 */
export function pointsFromMoisture(sketch: Sketch, map: MoistureMap, existing: readonly DryingPoint[] = []): DryingPoint[] {
  const have = new Set(existing.map((p) => p.origin));
  const manyLevels = levelsOf(sketch).length > 1;
  const out: DryingPoint[] = [];

  for (const room of sketch.rooms) {
    if (!hasRoomMoisture(map, room.id)) continue;
    const data = map.rooms[room.id];
    if (!data) continue;
    const name = room.name.trim() || "Unnamed room";
    const where = manyLevels ? `${name} (${levelName(sketch, roomLevel(room))})` : name;
    const wallNumber = new Map(wallsOf(room).map((w, i) => [w.id, i + 1]));

    for (const reading of data.wallReadings) {
      const origin = `wall:${reading.id}`;
      if (have.has(origin)) continue;
      out.push({
        id: newId("pt"),
        label: `${where}, Wall ${wallNumber.get(reading.wallId) ?? "?"}`,
        roomId: room.id,
        surface: "wall",
        material: reading.material,
        origin,
        // A standard typed for this wall in the moisture panel stays with it; one that is just the job's
        // reference or the guide is followed live, so correcting the reference corrects the point.
        standard: dryStandardSource(map.reference, reading.material, reading.dryStandard) === "wall" ? reading.dryStandard : null,
        active: true,
      });
    }
    if (data.floorCells.length > 0 && !have.has(`floor:${room.id}`)) {
      out.push({ id: newId("pt"), label: `${where}, Floor`, roomId: room.id, surface: "floor", material: "subfloor", origin: `floor:${room.id}`, standard: null, active: true });
    }
    if (data.ceilingCells.length > 0 && !have.has(`ceiling:${room.id}`)) {
      out.push({ id: newId("pt"), label: `${where}, Ceiling`, roomId: room.id, surface: "ceiling", material: "drywall", origin: `ceiling:${room.id}`, standard: null, active: true });
    }
  }
  return out;
}

/** The map's own readings for the points that came from it: what Day 1's visit starts with. */
export function readingsFromMoisture(map: MoistureMap, points: readonly DryingPoint[]): Record<string, PointReading> {
  const byId = new Map<string, number | null>();
  for (const data of Object.values(map.rooms)) for (const r of data.wallReadings) byId.set(`wall:${r.id}`, r.reading);
  const out: Record<string, PointReading> = {};
  for (const point of points) {
    const value = byId.get(point.origin);
    if (value !== undefined && value !== null) out[point.id] = { value, source: "typed" };
  }
  return out;
}

/** A visit, empty except for what carries over from the last one: who, the meter, the equipment counts. */
export function newVisit(log: DryingLog, args: { now: string; by: string; equipment?: EquipmentCounts | null }): DryingVisit {
  const last = log.visits.length > 0 ? (log.visits[log.visits.length - 1] as DryingVisit) : null;
  return {
    id: newId("visit"),
    at: args.now,
    by: args.by || last?.by || "",
    meter: last?.meter ?? "",
    air: emptyAir(),
    readings: {},
    // Equipment is a count of what is standing there, not a measurement, so yesterday's is a fair start;
    // the first visit takes the drying plan's. Air and readings are never copied: a stale number is worse than a blank.
    equipment: {
      airMovers: last ? last.equipment.airMovers : (args.equipment?.airMovers ?? null),
      dehumidifiers: last ? last.equipment.dehumidifiers : (args.equipment?.dehumidifiers ?? null),
      notes: "",
    },
    notes: "",
  };
}

/**
 * A new log: the map's points, Day 1 holding the map's readings, the equipment the plan calls for.
 * Works without a map too (no points, an empty first visit), because a log is useful before anyone has
 * drawn a sketch.
 *
 * `existing` is a log with points and settings but no visits (the tech deleted the only visit, or added points
 * before the first one): its points, names and settings are kept, and only the map's points that are not
 * in it already are added. Starting must never throw away work the tech did.
 */
export function startDryingLog(args: {
  sketch: Sketch;
  map: MoistureMap;
  now: string;
  by: string;
  equipment?: EquipmentCounts | null;
  existing?: DryingLog;
}): DryingLog {
  const base = args.existing ?? emptyDryingLog();
  const points = [...base.points, ...pointsFromMoisture(args.sketch, args.map, base.points)];
  const visit = newVisit({ ...base, visits: [] }, { now: args.now, by: args.by, equipment: args.equipment });
  visit.readings = readingsFromMoisture(args.map, points);
  return { ...base, points, visits: [visit] };
}

/* ── Changing a log ─────────────────────────────────────────────────────────────────────────────── */

function sortVisits(visits: DryingVisit[]): DryingVisit[] {
  return [...visits].sort((a, b) => (a.at === "" ? 1 : b.at === "" ? -1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Add a visit, or replace the one with the same id, keeping the visits in date order. */
export function withVisit(log: DryingLog, visit: DryingVisit): DryingLog {
  const rest = log.visits.filter((v) => v.id !== visit.id);
  return { ...log, visits: sortVisits([...rest, visit]) };
}

export function withoutVisit(log: DryingLog, visitId: string): DryingLog {
  return { ...log, visits: log.visits.filter((v) => v.id !== visitId) };
}

export function withPoint(log: DryingLog, point: DryingPoint): DryingLog {
  const exists = log.points.some((p) => p.id === point.id);
  return { ...log, points: exists ? log.points.map((p) => (p.id === point.id ? point : p)) : [...log.points, point] };
}

/** Remove a point and every reading taken at it. */
export function withoutPoint(log: DryingLog, pointId: string): DryingLog {
  return {
    ...log,
    points: log.points.filter((p) => p.id !== pointId),
    visits: log.visits.map((v) => {
      if (!(pointId in v.readings)) return v;
      const readings = { ...v.readings };
      delete readings[pointId];
      return { ...v, readings };
    }),
  };
}

/**
 * A reading typed or cleared. An empty entry is removed, so "not read" and "read as nothing" are one state.
 * A number typed over one read from a photo is the tech's own: it is "typed" again, keeping the mode and
 * scale the screen showed (a corrected digit does not change what the meter was set to).
 */
export function withReading(visit: DryingVisit, pointId: string, value: number | null): DryingVisit {
  const readings = { ...visit.readings };
  const had = readings[pointId];
  if (value === null) delete readings[pointId];
  else if (had && had.value === value) return visit;
  else readings[pointId] = { ...had, value, source: "typed" };
  return { ...visit, readings };
}

/** A reading taken from a photo of the meter's screen (lib/meterPhoto.ts), replacing whatever was there. */
export function withPhotoReading(
  visit: DryingVisit,
  pointId: string,
  read: { value: number; mode?: PointReading["mode"]; scale?: string; meter?: string },
): DryingVisit {
  const reading: PointReading = { value: read.value, source: "photo" };
  if (read.mode) reading.mode = read.mode;
  if (read.scale) reading.scale = read.scale;
  if (read.meter) reading.meter = read.meter;
  return { ...visit, readings: { ...visit.readings, [pointId]: reading } };
}

/**
 * The mode a reading was taken in, against the last reading at the same point, when both are known and
 * differ: a pinless number and a pin number are on different scales, so the trend between them means
 * nothing. Null when they match or either is unknown (a typed reading says no mode).
 */
export function modeChange(log: DryingLog, visit: DryingVisit, pointId: string): { was: NonNullable<PointReading["mode"]>; now: NonNullable<PointReading["mode"]> } | null {
  const now = visit.readings[pointId];
  if (!now?.mode || now.value === null) return null;
  let was: PointReading | undefined;
  for (const v of log.visits) {
    if (v.id === visit.id) break;
    const r = v.readings[pointId];
    if (r && r.value !== null) was = r;
  }
  return was?.mode && was.mode !== now.mode ? { was: was.mode, now: now.mode } : null;
}

export const MODE_LABEL: Record<NonNullable<PointReading["mode"]>, string> = { pin: "pin", pinless: "pinless", rh: "RH probe" };

/** A point of the tech's own, for something the map does not have. */
export function newPoint(args: { label: string; material: MoistureMaterial; surface?: PointSurface }): DryingPoint {
  return {
    id: newId("pt"),
    label: args.label.trim() || MATERIAL_LABEL[args.material],
    roomId: null,
    surface: args.surface ?? "other",
    material: args.material,
    origin: "added",
    standard: null,
    active: true,
  };
}

/* ── Units ──────────────────────────────────────────────────────────────────────────────────────── */

export function tempForDisplay(tempF: number | null, unit: TempUnit): number | null {
  if (tempF === null) return null;
  return unit === "F" ? tempF : roundTo(((tempF - 32) * 5) / 9, 1);
}

export function tempFromEntry(entry: number | null, unit: TempUnit): number | null {
  if (entry === null) return null;
  return unit === "F" ? entry : roundTo((entry * 9) / 5 + 32, 2);
}

export function tempLabel(unit: TempUnit): string {
  return unit === "F" ? "°F" : "°C";
}

/** A number to the precision a meter shows, without a trailing zero: 11.0 shows as 11, 0.75 as 0.75. */
export function trimNumber(value: number, decimals: number): string {
  return String(roundTo(value, decimals));
}
