/**
 * Send to Scrivn team (2026-10-17, migration 0016): during the beta a tester can send a house, or another
 * building on the claim, to us to measure from its photos and tapes, instead of measuring it themselves.
 *
 *   THE TESTER  taps "Send to Scrivn team to measure" on the photo route. What goes is which of the claim's
 *               site photos, the route's own inputs as the route keeps them (the shape drawn, the corners
 *               tapped, the tapes) and a note. With photos still waiting to upload it waits for them, on the
 *               phone (lib/exteriorRequestQueue.ts), and the Exterior says so.
 *   WE          pull it (scripts/pull-exterior-request.mjs), measure it on our own machine with the route's
 *               code and a session reading the photos - no API - and send the measured Exterior back
 *               (scripts/return-exterior-request.mjs).
 *   THE TESTER  sees "Measured - Use it" on the Exterior. "Use it" puts it into the house or that building
 *               through the claim's ordinary save, as if they had measured it themselves: everything stays
 *               theirs to change, and the roof check and Check these work as usual. The server never
 *               writes the claim.
 *
 * This file is what both ends share: the request as sent and as listed, the check an Exterior must pass to be
 * returned or used, and how a returned one goes into the claim. Pure, so the browser, the route, the scripts
 * and the tests all run the same code.
 */

import { withBuildingChange, withBuildingsChange, withHouseChange } from "./buildings";
import { exteriorQuantities, type Exterior } from "./exterior";
import type { PhotoRouteState } from "./photoRoute";
import type { Sketch } from "./sketch";

/** The building key for the claim's house (`Sketch.exterior`); any other is a `Sketch.buildings` id. */
export const HOUSE_KEY = "house";

export type ExteriorRequestStatus = "sent" | "measuring" | "ready" | "applied" | "withdrawn";
export const EXTERIOR_REQUEST_STATUSES: readonly ExteriorRequestStatus[] = ["sent", "measuring", "ready", "applied", "withdrawn"];

export const MAX_REQUEST_NOTE_CHARS = 2000;
export const MAX_REQUEST_PHOTOS = 300;
/** The route's inputs as JSON: far past any house (18 photos and 30 taps are about 10 KB). */
export const MAX_REQUEST_ROUTE_BYTES = 512 * 1024;
/** A returned Exterior with its photos laid on its sides: a big house is a few hundred KB. */
export const MAX_RESULT_BYTES = 4 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9:_.-]{1,80}$/;
const PHOTO_ID = /^[A-Za-z0-9:_-]{1,80}$/;

/** Which building an exterior is, as a request names it. */
export function buildingKeyOf(exterior: Pick<Exterior, "id"> | null | undefined): string {
  return exterior?.id || HOUSE_KEY;
}

/** What the browser sends: POST /api/claims/<claim>/exterior-requests. */
export interface ExteriorRequestInput {
  /** Chosen on the device when Send is tapped: sent again after a lost answer, it is the same request. */
  id: string;
  building: string;
  buildingName: string;
  photoIds: string[];
  route: PhotoRouteState | null;
  note: string;
}

/** A request as the claim's Exterior lists it: GET /api/claims/<claim>/exterior-requests. */
export interface ExteriorRequestView {
  id: string;
  building: string;
  buildingName: string;
  status: ExteriorRequestStatus;
  note: string;
  createdAt: string;
  readyAt: string | null;
  /** The measured Exterior, only while it is ready to use. */
  result: Exterior | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The request body, checked before anything is looked up: the route answers 400 with the error. */
export function parseExteriorRequestInput(body: unknown): Parsed<ExteriorRequestInput> {
  if (!body || typeof body !== "object") return { ok: false, error: "Send the request as JSON." };
  const b = body as Record<string, unknown>;
  if (typeof b.id !== "string" || !UUID.test(b.id)) return { ok: false, error: "A request id must be a UUID." };
  const building = typeof b.building === "string" && b.building ? b.building : HOUSE_KEY;
  if (!KEY.test(building)) return { ok: false, error: "That is not a building of a claim." };
  const buildingName = typeof b.buildingName === "string" ? b.buildingName.trim().slice(0, 80) : "";
  if (!Array.isArray(b.photoIds) || b.photoIds.length === 0) return { ok: false, error: "Send the photos to measure from." };
  if (b.photoIds.length > MAX_REQUEST_PHOTOS || !b.photoIds.every((p) => typeof p === "string" && PHOTO_ID.test(p))) {
    return { ok: false, error: "Those are not photos of a claim." };
  }
  const photoIds = [...new Set(b.photoIds as string[])];
  let route: PhotoRouteState | null = null;
  if (b.route !== undefined && b.route !== null) {
    if (typeof b.route !== "object" || Array.isArray(b.route)) return { ok: false, error: "The route's inputs must be an object." };
    if (JSON.stringify(b.route).length > MAX_REQUEST_ROUTE_BYTES) return { ok: false, error: "The route's inputs are too big to send." };
    route = b.route as PhotoRouteState;
  }
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (note.length > MAX_REQUEST_NOTE_CHARS) return { ok: false, error: `Keep the note under ${MAX_REQUEST_NOTE_CHARS} characters.` };
  return { ok: true, value: { id: b.id.toLowerCase(), building, buildingName, photoIds, route, note } };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * An Exterior as it can be returned to a claim and opened there: sides with lengths, a roof, and quantities that
 * work it out without throwing - a measured house that crashed the claim page (as a bad device copy did on 10-15)
 * would be worse than none. `warnings` are what the return script prints; the result carries on regardless.
 */
export function checkTeamResult(value: unknown): Parsed<Exterior> & { warnings?: string[] } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "That is not an exterior." };
  const e = value as Partial<Exterior>;
  if (!Array.isArray(e.sides) || e.sides.length < 3) return { ok: false, error: "An exterior needs its sides: three at least." };
  if (!e.roof || typeof e.roof !== "object") return { ok: false, error: "An exterior needs its roof." };
  const ids = new Set<string>();
  for (const [i, s] of e.sides.entries()) {
    const at = `Side ${i + 1}`;
    if (!s || typeof s !== "object") return { ok: false, error: `${at} is not a side.` };
    if (typeof s.id !== "string" || !s.id) return { ok: false, error: `${at} has no id.` };
    if (ids.has(s.id)) return { ok: false, error: `${at}'s id ${s.id} is used twice.` };
    ids.add(s.id);
    if (typeof s.name !== "string") return { ok: false, error: `${at} has no name.` };
    if (!finite(s.lengthFeet) || s.lengthFeet <= 0 || s.lengthFeet > 1000) return { ok: false, error: `${at} (${s.name}) has no length.` };
    if (!Array.isArray(s.openings) || !Array.isArray(s.bands)) return { ok: false, error: `${at} (${s.name}) is missing its openings or bands.` };
  }
  if (JSON.stringify(value).length > MAX_RESULT_BYTES) return { ok: false, error: "That exterior is too big to return." };
  try {
    exteriorQuantities(e as Exterior);
  } catch (err) {
    return { ok: false, error: `Its quantities cannot be worked out: ${err instanceof Error ? err.message : String(err)}` };
  }
  const warnings: string[] = [];
  const unreadable = e.sides.flatMap((s) => (s.photos ?? []).filter((p) => !p.claimPhotoId && !p.scanId).map((p) => `${s.name} photo ${p.n}`));
  if (unreadable.length) warnings.push(`${unreadable.length} side photo${unreadable.length === 1 ? " is" : "s are"} neither a claim photo nor a scan's, so the claim cannot show ${unreadable.length === 1 ? "it" : "them"}: ${unreadable.join(", ")}.`);
  return { ok: true, value: e as Exterior, warnings };
}

/** The side photos a claim can show: a claim photo's (the photo route) or a scan's. One that is neither is left off. */
function readablePhotos(exterior: Exterior): Exterior {
  const clean = (sides: Exterior["sides"]) =>
    sides.map((s) => {
      if (!s.photos?.some((p) => !p.claimPhotoId && !p.scanId)) return s;
      const photos = s.photos.filter((p) => p.claimPhotoId || p.scanId);
      const { photos: _all, ...rest } = s;
      return photos.length ? { ...rest, photos } : rest;
    });
  return { ...exterior, sides: clean(exterior.sides), ...(exterior.upper ? { upper: { ...exterior.upper, sides: clean(exterior.upper.sides) } } : {}) };
}

/** Said with a returned exterior, wherever its source notes are (the editor, the report). */
export const TEAM_NOTE = "Measured by the Scrivn team from the photos sent.";

/**
 * A returned exterior put into the claim (the "Use it" tap), from the exterior as it is now:
 *
 *   * the measured sides, roof, photos laid on the sides - everything the team measured - as returned;
 *   * what the tester did on their side stays: the parts ticked for the scope (those of sides still there), and
 *     the photo route's inputs - if the team's exterior carries its own route (the photos, the shape, the corners,
 *     the tapes as measured), photos added since are put back on it; if it carries none, the tester's route is
 *     kept with its old measure cleared, so the Photos tab never shows numbers that are not these sides';
 *   * a building keeps its id and name; the house has neither.
 *
 * Nothing is marked edited: from here on it is the estimator's to change, as a measure of their own would be.
 */
export function withTeamMeasure(prev: Exterior | undefined, result: Exterior, at: string): Exterior {
  const team = readablePhotos(result);
  const sideIds = new Set([...team.sides, ...(team.upper?.sides ?? [])].map((s) => s.id));
  const mine = prev?.photoRoute;
  let photoRoute: PhotoRouteState | undefined;
  if (team.photoRoute) {
    const have = new Set(team.photoRoute.photos.map((p) => p.id));
    const added = (mine?.photos ?? []).filter((p) => !have.has(p.id));
    photoRoute = added.length ? { ...team.photoRoute, photos: [...team.photoRoute.photos, ...added] } : team.photoRoute;
  } else if (mine) {
    const { checksClosed: _closed, ...rest } = mine;
    photoRoute = { ...rest, measured: null };
  }
  const source: NonNullable<Exterior["source"]> = team.source
    ? { ...team.source, notes: [...team.source.notes.filter((n) => n !== TEAM_NOTE), TEAM_NOTE], edited: false }
    : { kind: "photos", by: "photos", captureId: null, scanId: null, receivedAt: at, notes: [TEAM_NOTE], walkClosed: true };
  const { id: _id, name: _name, scope: teamScope, photoRoute: _route, source: _source, ...measured } = team;
  const scope = prev?.scope ? { ...prev.scope, sides: prev.scope.sides.filter((x) => sideIds.has(x)) } : teamScope;
  return {
    ...measured,
    ...(prev?.id ? { id: prev.id } : {}),
    ...(prev?.name ? { name: prev.name } : {}),
    ...(scope ? { scope } : {}),
    ...(photoRoute ? { photoRoute } : {}),
    source,
  };
}

/**
 * The sketch with a returned exterior used on the building it was sent for: what the claim page's save gets when
 * the editor's own updater runs (SketchEditor `onHouse`, ExteriorSite `updateBuilding`). A building removed since is
 * left removed: there is nowhere for it to go, and the Exterior no longer offers it.
 */
export function sketchWithTeamMeasure(sketch: Sketch, building: string, result: Exterior, at: string): Sketch {
  const use = (prev: Exterior | undefined) => withTeamMeasure(prev, result, at);
  if (building === HOUSE_KEY) return withHouseChange(sketch, use);
  return withBuildingsChange(sketch, (list) => withBuildingChange(list, building, use));
}

/** Whether a request is still going somewhere: being sent, measured, or waiting to be used. */
export function isOpenRequest(status: ExteriorRequestStatus): boolean {
  return status === "sent" || status === "measuring" || status === "ready";
}

/** A row of the table as the routes and scripts read it, made into the listing. */
export function requestView(row: Record<string, unknown>): ExteriorRequestView {
  const status = EXTERIOR_REQUEST_STATUSES.includes(row.status as ExteriorRequestStatus) ? (row.status as ExteriorRequestStatus) : "sent";
  return {
    id: String(row.id),
    building: typeof row.building === "string" ? row.building : HOUSE_KEY,
    buildingName: typeof row.building_name === "string" ? row.building_name : "",
    status,
    note: typeof row.note === "string" ? row.note : "",
    createdAt: String(row.created_at ?? ""),
    readyAt: typeof row.ready_at === "string" ? row.ready_at : null,
    result: status === "ready" && row.result && typeof row.result === "object" ? (row.result as Exterior) : null,
  };
}
