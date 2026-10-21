/**
 * Decks and porches on the outside of a house (2026-10-20, the owner: "we may also want to build in decks. capture on the
 * exterior photos like everything else. will need to build in decks into scrivn as well in that case").
 *
 * A deck is kept on its building's exterior (`Exterior.decks`), each building its own, and is measured the way the house
 * is: off the same photos (lib/deckPhotos.ts places its outer corners and its height with the photo route's own
 * cameras), or typed in the quick-deck box. What it is:
 *
 *   * WHERE: the wall it stands against (`sideId`); its outline is in that wall's frame - feet along the wall from its
 *     left end as you face it from outside, and feet out from its face (in past it, into a covered notch, is negative).
 *     So it moves with its wall when a length is retyped or the house is measured again. Free-standing: none, and its
 *     outline is on the footprint's plan. Its LEDGER is worked out, never typed: every stretch of its edge that lies
 *     along a wall of the house;
 *   * THE PLATFORM: its outline, its area, its height above the ground (a step down to the far side allowed), and how
 *     much of it the house's roof covers - worked out from the roof's drip line, so a covered deck is never roofed
 *     twice, and its decking is never counted as wall;
 *   * DECKING, RAILINGS (each run along an edge, its kind and height, its gates), STAIRS (each flight's width, risers,
 *     a landing, its railing), and UNDERNEATH: posts, beams if seen, and skirting or a privacy screen by area.
 *
 * What a photo can't see - the joists, the footings, posts behind skirting - is asked on "Check these" and listed on the
 * report's "To check" (`deckChecks`, `deckNotes`). Its lines go on the scope only when it is ticked (`deckScopeLines`).
 *
 * Feet throughout; feet-and-inches is display.
 */

import { allSides, clipRect, type Exterior, exteriorFootprint, type ExteriorSide, type Footprint, groundAt } from "./exterior";
import type { FeetBox, ProposedDeck } from "./exteriorTrace";
import type { Pt, RoofPlan } from "./roof";
import { type CameraAt, unswell } from "./roofPhotoRead";
import { formatFeetInches, newSketchId } from "./sketch";

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export type DeckingKind = "composite" | "wood" | "membrane" | "other";

export const DECKING_KINDS: DeckingKind[] = ["composite", "wood", "membrane", "other"];

/** As the scope line says it: "composite decking". */
export const DECKING_LABEL: Record<DeckingKind, string> = { composite: "Composite decking", wood: "Wood decking", membrane: "Vinyl membrane", other: "Other decking" };

export type RailingKind = "glass" | "aluminum" | "wood" | "cable" | "other";

export const RAILING_KINDS: RailingKind[] = ["glass", "aluminum", "wood", "cable", "other"];

/** As the scope line says it: "glass railing", "aluminum picket railing". */
export const RAILING_LABEL: Record<RailingKind, string> = { glass: "Glass railing", aluminum: "Aluminum picket railing", wood: "Wood railing", cable: "Cable railing", other: "Other railing" };

/** On a one-tap choice. */
export const RAILING_SHORT: Record<RailingKind, string> = { glass: "Glass", aluminum: "Aluminum pickets", wood: "Wood", cable: "Cable", other: "Other" };

export type ScreenKind = "privacy" | "skirting";

export const SCREEN_LABEL: Record<ScreenKind, string> = { privacy: "Privacy screen", skirting: "Skirting" };

export type ScreenMaterial = "wood" | "vinyl" | "lattice" | "composite" | "aluminum" | "other";

export const SCREEN_MATERIALS: ScreenMaterial[] = ["wood", "vinyl", "lattice", "composite", "aluminum", "other"];

export const SCREEN_MATERIAL_LABEL: Record<ScreenMaterial, string> = { wood: "Wood", vinyl: "Vinyl", lattice: "Lattice", composite: "Composite", aluminum: "Aluminum", other: "Other" };

export type PostMaterial = "wood" | "aluminum" | "steel" | "concrete" | "other";

export const POST_MATERIAL_LABEL: Record<PostMaterial, string> = { wood: "Wood", aluminum: "Aluminum-wrapped", steel: "Steel", concrete: "Concrete", other: "Other" };

/** Read off a photo, and why it is unsure, and whether the estimator kept it: what each part of a deck can carry. */
interface Read {
  from?: "photo";
  /** Why the read is unsure, in words: asked on "Check these" until kept. */
  unsure?: string;
  confirmed?: true;
}

/** A run of railing along one edge of the deck. */
export interface DeckRailing extends Read {
  id: string;
  /** The edge it runs along: from outline corner `edge` to the next. */
  edge: number;
  /** Where it starts and stops, feet along the edge from its start; absent: the whole edge. */
  fromFeet?: number;
  toFeet?: number;
  kind: RailingKind;
  /** What "other" is. */
  label?: string;
  heightFeet: number;
  /** Gates in it. */
  gates?: number;
}

/** A straight flight of stairs off one edge, running straight out from it. */
export interface DeckStair extends Read {
  id: string;
  edge: number;
  /** Its middle, feet along the edge from its start. */
  atFeet: number;
  widthFeet: number;
  risers: number;
  /** Each tread's going, front to back; absent 10". */
  runFeet?: number;
  /** A landing part way down: after this many risers from the top, this deep, the stair's width. */
  landing?: { afterRisers: number; depthFeet: number } | null;
  /** Its railing: one side, both, or none. */
  railing: { kind: RailingKind; sides: 0 | 1 | 2; label?: string } | null;
  /** A gate across its top. */
  gate?: boolean;
}

/** The posts it stands on. */
export interface DeckPosts extends Read {
  count: number;
  /** Across, inches: 6 for a 6×6. */
  sizeInches?: number;
  material?: PostMaterial;
  /** Where they stand, in the deck's own frame (as its outline), when read or placed; absent: spread along its open edges. */
  at?: Pt[];
}

export interface DeckBeam {
  id: string;
  lengthFeet: number;
  /** "2-2×10", as seen. */
  size?: string;
}

/** A privacy screen standing on the deck, or skirting round its underside, along one edge. */
export interface DeckScreen extends Read {
  id: string;
  kind: ScreenKind;
  edge: number;
  fromFeet?: number;
  toFeet?: number;
  /** A privacy screen: up from the decking. Skirting: from the ground up to the deck. */
  heightFeet: number;
  material: ScreenMaterial;
  label?: string;
}

/** A tap on a photo the deck was placed from (lib/deckPhotos.ts): an outer corner where it meets the ground, or the deck's top over one. */
export interface DeckTap {
  photo: string;
  /** Which point: "corner:<outline index>" at the ground (a post's foot), or "top:<outline index>", the decking's edge over it. */
  point: string;
  x: number;
  y: number;
}

export interface Deck {
  id: string;
  /** "Rear deck", "Front porch": what its lines and its part of the report are called. */
  name: string;
  /** The side it stands against, its outline in that side's frame; null: free-standing, its outline on the footprint's plan. */
  sideId: string | null;
  /** Its corners in order round it. Against a side: x along from the side's left end as you face it from outside, y out from its face. */
  outline: Pt[];
  /** Its top - the decking - above the ground under it, at the wall. */
  heightFeet: number;
  /** Where the ground steps or falls away under it: its height above the ground at its outer edge. Absent: as at the wall. */
  heightOutFeet?: number;
  /**
   * Its top on the wall's own elevation, feet up from the side's level - 0 for a porch whose wall was measured from the
   * porch itself, as the owner's front wall was. Absent: the ground at the wall plus its height.
   */
  topOnWallFeet?: number;
  decking: DeckingKind;
  /** What "other" is. */
  deckingLabel?: string;
  /** Unsure or kept, as a read is: the decking's material off a photo that saw it from below, say. */
  deckingRead?: Read;
  railings: DeckRailing[];
  stairs: DeckStair[];
  posts: DeckPosts | null;
  beams?: DeckBeam[];
  screens: DeckScreen[];
  /** How it was measured: off the photos (its corners placed by the photo route's cameras), the quick-deck box, or by hand. */
  from?: "photos" | "quick" | "hand";
  /** The taps it was placed from (lib/deckPhotos.ts). */
  taps?: DeckTap[];
  /** "Check these" rows answered for it, by item ("framing", "posts", ...). */
  confirmed?: string[];
}

/** A railing's usual height: 42", over 5'11" up; 36" will do lower down, so it is the estimator's to type. */
export const DEFAULT_RAILING_FEET = 3.5;
/** A tread's usual going, nosing to nosing. */
export const DEFAULT_RUN_FEET = 10 / 12;
/** The most a riser may rise: 7¾" (200 mm). */
export const MAX_RISE_FEET = 7.75 / 12;
/** Posts under a deck's outer beam, at most this far apart. */
export const POST_SPACING_FEET = 8;
/** A post's usual size, inches. */
export const DEFAULT_POST_INCHES = 6;
/** Railing posts between glass panels or picket sections, at most this far apart, for the drawings. */
export const RAIL_POST_SPACING_FEET = 6;
/** An edge this close to a wall's line, running along it, is against it: its ledger. */
const AGAINST_FEET = 0.4;
const EPS = 1e-6;

/** The risers a stair needs for [riseFeet]: each no more than 7¾". */
export function risersFor(riseFeet: number): number {
  return Math.max(1, Math.ceil(riseFeet / MAX_RISE_FEET - 1e-9));
}

/**
 * The decks on an exterior, for one saved before there were any as much as for one made today, and for a device copy that
 * got one half-right: only those with an outline of three corners at least and a height are kept.
 */
export function decksOf(exterior: Pick<Exterior, "decks"> | undefined): Deck[] {
  const list = exterior?.decks;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (d): d is Deck =>
      !!d &&
      typeof d === "object" &&
      typeof d.id === "string" &&
      Array.isArray(d.outline) &&
      d.outline.length >= 3 &&
      d.outline.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) &&
      Number.isFinite(d.heightFeet),
  );
}

/** A deck's name as shown: as typed, else "Deck". */
export function deckName(d: Pick<Deck, "name">): string {
  return d.name?.trim() || "Deck";
}

// ---------------------------------------------------------------------------------------------
// Where it is on the plan
// ---------------------------------------------------------------------------------------------

/** Its frame: a point of its outline on the plan, and back. */
export interface DeckFrame {
  /** Its side's left end, the way along it and the way out of it (the footprint's plan); identity for a free-standing deck. */
  origin: Pt;
  u: Pt;
  n: Pt;
  side: ExteriorSide | null;
  /** The side's length on the footprint. */
  sideFeet: number;
}

export function deckFrame(exterior: Exterior, deck: Deck, fp: Footprint = exteriorFootprint(exterior)): DeckFrame | null {
  if (deck.sideId === null) return { origin: { x: 0, y: 0 }, u: { x: 1, y: 0 }, n: { x: 0, y: 1 }, side: null, sideFeet: 0 };
  if (!fp.closes) return null;
  const i = fp.sideIds.indexOf(deck.sideId);
  if (i < 0) return null;
  const a = fp.corners[i] as Pt;
  const b = fp.corners[(i + 1) % fp.corners.length] as Pt;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(L > EPS)) return null;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  // The footprint goes counter-clockwise, so out is to the right of the way along.
  const n = { x: u.y, y: -u.x };
  return { origin: a, u, n, side: exterior.sides.find((s) => s.id === deck.sideId) ?? null, sideFeet: L };
}

export const toPlan = (f: DeckFrame, p: Pt): Pt => ({ x: f.origin.x + p.x * f.u.x + p.y * f.n.x, y: f.origin.y + p.x * f.u.y + p.y * f.n.y });
export const fromPlan = (f: DeckFrame, q: Pt): Pt => {
  const d = { x: q.x - f.origin.x, y: q.y - f.origin.y };
  return { x: d.x * f.u.x + d.y * f.u.y, y: d.x * f.n.x + d.y * f.n.y };
};

function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Pt;
    const q = poly[(i + 1) % poly.length] as Pt;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function insidePoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** One edge of a deck on the plan. */
export interface DeckEdge {
  index: number;
  a: Pt;
  b: Pt;
  lengthFeet: number;
  /** Away from the deck, on the plan. */
  out: Pt;
  /** The walls of the house it runs along, and how far: its ledger there. */
  against: { sideId: string; name: string; fromFeet: number; toFeet: number }[];
  ledgerFeet: number;
  /** "the outer edge", "the left end", "against the Rear wall": what it is called in the report. */
  name: string;
}

export interface DeckGeometry {
  frame: DeckFrame;
  /** Its corners on the footprint's plan, in its outline's order. */
  plan: Pt[];
  edges: DeckEdge[];
  areaSquareFeet: number;
  perimeterFeet: number;
  ledgerFeet: number;
  /** Its open edges' length: the rim, round all but the ledger. */
  rimFeet: number;
}

/** The deck on the plan: its corners, each edge with what it stands against. Null when its wall isn't on a closed footprint. */
export function deckGeometry(exterior: Exterior, deck: Deck, fp: Footprint = exteriorFootprint(exterior)): DeckGeometry | null {
  const frame = deckFrame(exterior, deck, fp);
  if (!frame) return null;
  const plan = deck.outline.map((p) => toPlan(frame, p));
  const area = signedArea(plan);
  if (Math.abs(area) < EPS) return null;
  const ccw = area > 0;
  const walls = fp.closes ? fp.sideIds.map((id, i) => ({ id, a: fp.corners[i] as Pt, b: fp.corners[(i + 1) % fp.corners.length] as Pt })) : [];
  const nameOf = (id: string) => allSides(exterior).find((s) => s.id === id)?.name.trim() || "Side";
  const edges: DeckEdge[] = plan.map((a, i) => {
    const b = plan[(i + 1) % plan.length] as Pt;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = len > EPS ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
    // The interior is to the left of a counter-clockwise ring: out is to its right.
    const out = ccw ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x };
    const against: DeckEdge["against"] = [];
    for (const w of walls) {
      const wl = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);
      if (wl < EPS || len < EPS) continue;
      const wt = { x: (w.b.x - w.a.x) / wl, y: (w.b.y - w.a.y) / wl };
      if (Math.abs(wt.x * t.y - wt.y * t.x) > 0.02) continue;
      const off = (p: Pt) => Math.abs((p.x - w.a.x) * wt.y - (p.y - w.a.y) * wt.x);
      if (off(a) > AGAINST_FEET || off(b) > AGAINST_FEET) continue;
      // Along the edge, the stretch the wall covers.
      const s0 = (w.a.x - a.x) * t.x + (w.a.y - a.y) * t.y;
      const s1 = (w.b.x - a.x) * t.x + (w.b.y - a.y) * t.y;
      const from = Math.max(0, Math.min(s0, s1));
      const to = Math.min(len, Math.max(s0, s1));
      if (to - from < 0.1) continue;
      // The deck is on the wall's outside: just off the edge's middle, into the deck, is not in the house.
      const mid = (from + to) / 2;
      const probe = { x: a.x + t.x * mid - out.x * 0.5, y: a.y + t.y * mid - out.y * 0.5 };
      if (fp.closes && insidePoly(fp.corners, probe)) continue;
      against.push({ sideId: w.id, name: nameOf(w.id), fromFeet: from, toFeet: to });
    }
    const ledgerFeet = against.reduce((s, g) => s + (g.toFeet - g.fromFeet), 0);
    return { index: i, a, b, lengthFeet: len, out, against, ledgerFeet, name: "" };
  });
  nameEdges(deck, frame, edges);
  const perimeterFeet = edges.reduce((s, e) => s + e.lengthFeet, 0);
  const ledgerFeet = edges.reduce((s, e) => s + e.ledgerFeet, 0);
  return { frame, plan, edges, areaSquareFeet: Math.abs(area), perimeterFeet, ledgerFeet, rimFeet: perimeterFeet - ledgerFeet };
}

/**
 * Each edge's name in plain words, as you face the wall the deck stands against from outside: against a wall it is that
 * wall's; out from the wall, its left or right end; along it, the outer edge (the farthest out) or an edge.
 */
function nameEdges(deck: Deck, frame: DeckFrame, edges: DeckEdge[]): void {
  const local = deck.outline;
  const ys = local.map((p) => p.y);
  const xs = local.map((p) => p.x);
  const maxY = Math.max(...ys);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const words: string[] = edges.map((e) => {
    const p = local[e.index] as Pt;
    const q = local[(e.index + 1) % local.length] as Pt;
    if (e.ledgerFeet > 0.5 * e.lengthFeet && e.against[0]) return `against the ${e.against[0].name}`;
    if (frame.side === null) return "";
    const along = Math.abs(q.x - p.x) > Math.abs(q.y - p.y);
    if (along) return Math.abs((p.y + q.y) / 2 - maxY) < 0.25 ? "the outer edge" : "an edge";
    const x = (p.x + q.x) / 2;
    return Math.abs(x - minX) < 0.25 ? "the left end" : Math.abs(x - maxX) < 0.25 ? "the right end" : "a step in its edge";
  });
  // A name twice, or none: by its number round the deck.
  edges.forEach((e, i) => {
    const w = words[i] as string;
    e.name = w && words.filter((x) => x === w).length === 1 ? w : `edge ${i + 1}`;
  });
}

// ---------------------------------------------------------------------------------------------
// Its parts on the plan
// ---------------------------------------------------------------------------------------------

/** A stretch along an edge, as a fraction pair clipped to it. */
function span(e: DeckEdge, from?: number, to?: number): { from: number; to: number } {
  const f = Math.max(0, Math.min(e.lengthFeet, from ?? 0));
  const t = Math.max(f, Math.min(e.lengthFeet, to ?? e.lengthFeet));
  return { from: f, to: t };
}

const along = (e: DeckEdge, s: number): Pt => {
  const k = e.lengthFeet > EPS ? s / e.lengthFeet : 0;
  return { x: e.a.x + (e.b.x - e.a.x) * k, y: e.a.y + (e.b.y - e.a.y) * k };
};

export interface RailingRun {
  id: string;
  kind: RailingKind;
  label: string;
  heightFeet: number;
  gates: number;
  a: Pt;
  b: Pt;
  lengthFeet: number;
  /** On a stair: its slope and how far it drops, end a to end b. */
  stairId?: string;
  dropFeet?: number;
  edge: number;
}

export interface StairGeometry {
  stair: DeckStair;
  /** Where its top meets the deck's edge, left and right as you go down it. */
  top: [Pt, Pt];
  /** The way down it, on the plan. */
  dir: Pt;
  riseFeet: number;
  totalRiseFeet: number;
  runFeet: number;
  /** Nosing to nosing, top to foot, landing included. */
  totalRunFeet: number;
  /** Along its slope, for its railing and stringers. */
  slopeFeet: number;
  /** Where its foot meets the ground. */
  foot: [Pt, Pt];
  landingSquareFeet: number;
}

/** Whether a deck stands in front of a side at [alongFeet] (from its left end): a foot out from the wall there is on a deck. */
export function deckInFront(exterior: Exterior, sideId: string, alongFeet: number, fp: Footprint = exteriorFootprint(exterior)): boolean {
  const decks = decksOf(exterior);
  if (decks.length === 0 || !fp.closes) return false;
  const i = fp.sideIds.indexOf(sideId);
  if (i < 0) return false;
  const a = fp.corners[i] as Pt;
  const b = fp.corners[(i + 1) % fp.corners.length] as Pt;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(L > EPS)) return false;
  const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  const probe = { x: a.x + u.x * alongFeet + u.y * 1, y: a.y + u.y * alongFeet - u.x * 1 };
  return decks.some((d) => {
    const g = deckGeometry(exterior, d, fp);
    return !!g && insidePoly(g.plan, probe);
  });
}

/** The height of the deck's top above the ground at a point of its edge: at the wall, else its outer height. */
function heightAt(deck: Deck, geom: DeckGeometry, p: Pt): number {
  if (deck.heightOutFeet === undefined || Math.abs(deck.heightOutFeet - deck.heightFeet) < EPS) return deck.heightFeet;
  const local = fromPlan(geom.frame, p);
  const ys = deck.outline.map((q) => q.y);
  const lo = Math.max(0, Math.min(...ys));
  const hi = Math.max(...ys);
  const k = hi - lo > EPS ? Math.max(0, Math.min(1, (local.y - lo) / (hi - lo))) : 1;
  return deck.heightFeet + (deck.heightOutFeet - deck.heightFeet) * k;
}

export function stairGeometry(deck: Deck, geom: DeckGeometry, stair: DeckStair): StairGeometry | null {
  const e = geom.edges[stair.edge];
  if (!e || e.lengthFeet < EPS) return null;
  const half = stair.widthFeet / 2;
  const s0 = Math.max(0, stair.atFeet - half);
  const s1 = Math.min(e.lengthFeet, stair.atFeet + half);
  const left = along(e, s0);
  const right = along(e, s1);
  const total = heightAt(deck, geom, along(e, stair.atFeet));
  const risers = Math.max(1, Math.round(stair.risers));
  const rise = total / risers;
  const run = stair.runFeet ?? DEFAULT_RUN_FEET;
  const landing = stair.landing && stair.landing.afterRisers > 0 && stair.landing.afterRisers < risers ? stair.landing : null;
  // The deck is the top tread: one tread fewer than risers, a landing in place of one.
  const treads = risers - 1 - (landing ? 1 : 0);
  const totalRun = treads * run + (landing ? landing.depthFeet : 0);
  const d = e.out;
  return {
    stair,
    top: [right, left],
    dir: d,
    riseFeet: rise,
    totalRiseFeet: total,
    runFeet: run,
    totalRunFeet: totalRun,
    slopeFeet: Math.hypot(totalRun - (landing ? landing.depthFeet : 0), total) + (landing ? landing.depthFeet : 0),
    foot: [
      { x: right.x + d.x * totalRun, y: right.y + d.y * totalRun },
      { x: left.x + d.x * totalRun, y: left.y + d.y * totalRun },
    ],
    landingSquareFeet: landing ? landing.depthFeet * (s1 - s0) : 0,
  };
}

/** Every railing run on the plan: the deck's own along its edges, then each stair's down its sides. */
export function railingRuns(deck: Deck, geom: DeckGeometry): RailingRun[] {
  const runs: RailingRun[] = [];
  for (const r of deck.railings) {
    const e = geom.edges[r.edge];
    if (!e) continue;
    const { from, to } = span(e, r.fromFeet, r.toFeet);
    if (to - from < 0.05) continue;
    runs.push({ id: r.id, kind: r.kind, label: railingWords(r.kind, r.label), heightFeet: r.heightFeet, gates: Math.max(0, Math.round(r.gates ?? 0)), a: along(e, from), b: along(e, to), lengthFeet: to - from, edge: r.edge });
  }
  for (const s of deck.stairs) {
    const g = stairGeometry(deck, geom, s);
    if (!g) continue;
    const kind = s.railing?.kind ?? deck.railings[0]?.kind ?? "aluminum";
    if (!s.railing || s.railing.sides === 0) {
      // A gate across its top with no railing down it is still a gate.
      if (s.gate) runs.push({ id: `${s.id}:gate`, kind, label: railingWords(kind, s.railing?.label), heightFeet: DEFAULT_RAILING_FEET, gates: 1, a: g.top[0], b: g.top[0], lengthFeet: 0, stairId: s.id, edge: s.edge });
      continue;
    }
    const sides = s.railing.sides === 2 ? [0, 1] : [1];
    for (const k of sides) {
      const top = g.top[k] as Pt;
      const foot = g.foot[k] as Pt;
      runs.push({
        id: `${s.id}:${k}`,
        kind: s.railing.kind,
        label: railingWords(s.railing.kind, s.railing.label),
        heightFeet: DEFAULT_RAILING_FEET,
        gates: k === 1 && s.gate ? 1 : 0,
        a: top,
        b: foot,
        lengthFeet: g.slopeFeet,
        stairId: s.id,
        dropFeet: g.totalRiseFeet,
        edge: s.edge,
      });
    }
  }
  return runs;
}

/** "glass railing", or what an "other" one is. */
export function railingWords(kind: RailingKind, label?: string): string {
  return kind === "other" && label?.trim() ? `${label.trim().toLowerCase()} railing` : RAILING_LABEL[kind].toLowerCase();
}

/** Where its posts stand on the plan: as read or placed, else spread along its open edges, a post at each open corner. */
export function postPositions(deck: Deck, geom: DeckGeometry): Pt[] {
  if (deck.posts?.at && deck.posts.at.length > 0) return deck.posts.at.map((p) => toPlan(geom.frame, p));
  const inset = ((deck.posts?.sizeInches ?? DEFAULT_POST_INCHES) / 12) * 0.5;
  // Under its beams: against a wall, the open edges running along the wall (its joists span from the ledger out to them);
  // free-standing, every edge. A post at each of their corners not on a wall, and between every 8' or less.
  const alongWall = (e: DeckEdge) => {
    if (!geom.frame.side) return true;
    const d = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
    return Math.abs(d.x * geom.frame.u.x + d.y * geom.frame.u.y) > 0.7 * e.lengthFeet;
  };
  const free = geom.edges.filter((e) => e.ledgerFeet < 0.5 * e.lengthFeet && alongWall(e));
  const onWall = (p: Pt) => geom.edges.some((e) => e.ledgerFeet >= 0.5 * e.lengthFeet && (dist(p, e.a) < 0.05 || dist(p, e.b) < 0.05));
  const out: Pt[] = [];
  const push = (p: Pt) => {
    if (!out.some((q) => dist(p, q) < 0.5)) out.push(p);
  };
  const inward = (p: Pt) => {
    const c = centroid(geom.plan);
    const d = dist(p, c);
    return d > EPS ? { x: p.x + ((c.x - p.x) / d) * inset * 1.4, y: p.y + ((c.y - p.y) / d) * inset * 1.4 } : p;
  };
  for (const e of free) {
    const n = Math.max(1, Math.ceil(e.lengthFeet / POST_SPACING_FEET - 1e-9));
    for (let k = 0; k <= n; k++) {
      const p = along(e, (e.lengthFeet * k) / n);
      if (onWall(p)) continue;
      push(inward(p));
    }
  }
  const want = deck.posts?.count;
  if (want === undefined || want === out.length || out.length === 0) return out;
  // A count read or typed that isn't the default: spread that many along the open edges' chain.
  return spreadAlong(free, want).map(inward);
}

function spreadAlong(edges: DeckEdge[], count: number): Pt[] {
  const total = edges.reduce((s, e) => s + e.lengthFeet, 0);
  if (count <= 0 || total < EPS) return [];
  const out: Pt[] = [];
  for (let k = 0; k < count; k++) {
    let s = count === 1 ? total / 2 : (total * k) / (count - 1);
    for (const e of edges) {
      if (s <= e.lengthFeet + 1e-9) {
        out.push(along(e, Math.min(s, e.lengthFeet)));
        break;
      }
      s -= e.lengthFeet;
    }
  }
  return out;
}

const dist = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.y - q.y);
const centroid = (poly: Pt[]): Pt => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

/**
 * How much of it is under the house's roof, plan square feet: its outline against the roof's drip line, each piece of
 * which is counted once. So a covered deck is never roofed twice: the roof over it is the house's, already in its squares.
 */
export function coveredSquareFeet(plan: Pt[], roof: RoofPlan | null): number {
  if (!roof || roof.outlineRects.length === 0) return 0;
  // The drip line's rectangles made into pieces that don't overlap: strip by strip across x.
  const xs = [...new Set(roof.outlineRects.flatMap((r) => [r.x0, r.x1]))].sort((a, b) => a - b);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i] as number;
    const x1 = xs[i + 1] as number;
    if (x1 - x0 < EPS) continue;
    const spans = roof.outlineRects
      .filter((r) => r.x0 <= x0 + EPS && r.x1 >= x1 - EPS)
      .map((r) => [r.y0, r.y1] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]);
      else merged.push([s[0], s[1]]);
    }
    for (const [y0, y1] of merged) {
      const piece = clipRect(plan, x0, x1, y0, y1);
      if (piece.length >= 3) total += Math.abs(signedArea(piece));
    }
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------------------------

export interface DeckQuantities {
  deck: Deck;
  name: string;
  geometry: DeckGeometry | null;
  areaSquareFeet: number;
  /** Under the house's roof, and open to the sky. */
  coveredSquareFeet: number;
  openSquareFeet: number;
  ledgerFeet: number;
  /** Its open edges: the rim board and its fascia. */
  rimFeet: number;
  heightFeet: number;
  railings: RailingRun[];
  /** Railing by kind: the deck's runs and the stairs' together, how much of it is on the stairs, and the gates. */
  railingByKind: { kind: RailingKind; label: string; feet: number; stairFeet: number; gates: number; heights: number[] }[];
  stairs: StairGeometry[];
  posts: { count: number; sizeInches: number; material: PostMaterial | null; heightFeet: number; at: Pt[] };
  beams: DeckBeam[];
  screens: { screen: DeckScreen; lengthFeet: number; squareFeet: number; a: Pt; b: Pt }[];
}

export function deckQuantities(exterior: Exterior, deck: Deck, roof: RoofPlan | null = null, fp: Footprint = exteriorFootprint(exterior)): DeckQuantities {
  const geom = deckGeometry(exterior, deck, fp);
  const area = geom?.areaSquareFeet ?? Math.abs(signedArea(deck.outline));
  const covered = geom ? Math.min(area, coveredSquareFeet(geom.plan, roof)) : 0;
  const railings = geom ? railingRuns(deck, geom) : [];
  const byKind = new Map<string, DeckQuantities["railingByKind"][number]>();
  for (const r of railings) {
    const key = `${r.kind}:${r.label}`;
    const g = byKind.get(key) ?? { kind: r.kind, label: r.label, feet: 0, stairFeet: 0, gates: 0, heights: [] };
    g.feet += r.lengthFeet;
    if (r.stairId) g.stairFeet += r.lengthFeet;
    g.gates += r.gates;
    if (!r.stairId && !g.heights.some((h) => Math.abs(h - r.heightFeet) < 1 / 24)) g.heights.push(r.heightFeet);
    byKind.set(key, g);
  }
  const stairs = geom ? deck.stairs.map((s) => stairGeometry(deck, geom, s)).filter((s): s is StairGeometry => s !== null) : [];
  const at = geom ? postPositions(deck, geom) : [];
  const screens = geom
    ? deck.screens.flatMap((s) => {
        const e = geom.edges[s.edge];
        if (!e) return [];
        const { from, to } = span(e, s.fromFeet, s.toFeet);
        const len = to - from;
        return len < 0.05 ? [] : [{ screen: s, lengthFeet: len, squareFeet: len * s.heightFeet, a: along(e, from), b: along(e, to) }];
      })
    : [];
  return {
    deck,
    name: deckName(deck),
    geometry: geom,
    areaSquareFeet: area,
    coveredSquareFeet: covered,
    openSquareFeet: Math.max(0, area - covered),
    ledgerFeet: geom?.ledgerFeet ?? 0,
    rimFeet: geom?.rimFeet ?? 0,
    heightFeet: deck.heightFeet,
    railings,
    railingByKind: [...byKind.values()],
    stairs,
    posts: {
      count: deck.posts ? Math.max(0, Math.round(deck.posts.count)) : 0,
      sizeInches: deck.posts?.sizeInches ?? DEFAULT_POST_INCHES,
      material: deck.posts?.material ?? null,
      heightFeet: Math.max(deck.heightFeet, deck.heightOutFeet ?? deck.heightFeet),
      at,
    },
    beams: deck.beams ?? [],
    screens,
  };
}

/** Every deck on the exterior with its quantities, in the order they were added. [roof]: the house's roof plan, for what it covers. */
export function decksQuantities(exterior: Exterior, roof: RoofPlan | null = null): DeckQuantities[] {
  const list = decksOf(exterior);
  if (list.length === 0) return [];
  const fp = exteriorFootprint(exterior);
  return list.map((d) => deckQuantities(exterior, d, roof, fp));
}

// ---------------------------------------------------------------------------------------------
// Into the scope
// ---------------------------------------------------------------------------------------------

const num = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const ft = formatFeetInches;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "6×6": a post's size. */
const postSize = (inches: number) => `${Math.round(inches)}×${Math.round(inches)}`;

/** One stair's words: "13 risers, 4' wide (7'6" rise, 10'0" run, 4' × 4' landing)". */
export function stairWords(g: StairGeometry): string {
  const s = g.stair;
  const landing = s.landing && g.landingSquareFeet > 0 ? `, ${ft(s.widthFeet)} × ${ft(s.landing.depthFeet)} landing` : "";
  return `${plural(Math.round(s.risers), "riser")}, ${ft(s.widthFeet)} wide (${ft(g.totalRiseFeet)} rise, ${ft(g.totalRunFeet)} run${landing})`;
}

/** A riser's rise in inches to the nearest quarter: 7¼". */
export function riseWords(feet: number): string {
  const q = Math.round(feet * 48);
  const whole = Math.floor(q / 4);
  return `${whole}${["", "¼", "½", "¾"][q % 4]}"`;
}

/** Its posts' heights, ground to the rim: "about 6'" or "4'10" to 7'6"" where the ground steps under it. */
export function postHeightWords(q: DeckQuantities): string {
  const g = q.geometry;
  const hs = g && q.posts.at.length > 0 ? q.posts.at.map((p) => heightAt(q.deck, g, p)) : [q.posts.heightFeet];
  const lo = Math.min(...hs);
  const hi = Math.max(...hs);
  return hi - lo < 1 / 12 ? `about ${ft(hi)} each` : `${ft(lo)} to ${ft(hi)}`;
}

/** Its screens and skirting, runs of one kind and material together: the line, the report's row. */
export function screenGroups(q: DeckQuantities): { kind: ScreenKind; material: string; squareFeet: number; lengthFeet: number; heights: number[] }[] {
  const groups = new Map<string, { kind: ScreenKind; material: string; squareFeet: number; lengthFeet: number; heights: number[] }>();
  for (const s of q.screens) {
    const material = s.screen.material === "other" && s.screen.label?.trim() ? s.screen.label.trim().toLowerCase() : SCREEN_MATERIAL_LABEL[s.screen.material].toLowerCase();
    const key = `${s.screen.kind}:${material}`;
    const g = groups.get(key) ?? { kind: s.screen.kind, material, squareFeet: 0, lengthFeet: 0, heights: [] };
    g.squareFeet += s.squareFeet;
    g.lengthFeet += s.lengthFeet;
    if (!g.heights.some((h) => Math.abs(h - s.screen.heightFeet) < 1 / 24)) g.heights.push(s.screen.heightFeet);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/**
 * A deck's lines as the scope prices it, each named for the deck: "Rear deck – composite decking – 240.0 SF", "Rear deck
 * – glass railing – 38.0 LF", "Rear deck – stairs – 13 risers, 4' wide", "Rear deck – posts – 6", "Rear deck – privacy
 * screen – wood – 48.0 SF", "Rear deck – ledger – 24.0 LF". Real quantities, no waste: that is the estimator's to add.
 */
export function deckLines(q: DeckQuantities): string[] {
  const d = q.deck;
  const tag = (line: string) => `${q.name} – ${line}`;
  const out: string[] = [];
  const decking = d.decking === "other" && d.deckingLabel?.trim() ? `${d.deckingLabel.trim().toLowerCase()} decking` : DECKING_LABEL[d.decking].toLowerCase();
  // Said where the roof covers a real share of it - a covered deck, a porch - not where only the eave's overhang reaches over.
  const roofed = !coveredShare(q) ? "" : q.openSquareFeet < 0.5 ? " (all of it under the house's roof)" : ` (${num(q.coveredSquareFeet)} SF of it under the house's roof)`;
  out.push(tag(`${decking} – ${num(q.areaSquareFeet)} SF${roofed}`));
  for (const r of q.railingByKind) {
    const extra = [r.stairFeet > 0.05 ? `incl. ${num(r.stairFeet)} LF on the stairs` : "", r.heights.length === 1 ? `${ft(r.heights[0] as number)} high` : "", r.gates > 0 ? plural(r.gates, "gate") : ""].filter(Boolean);
    out.push(tag(`${r.label} – ${num(r.feet)} LF${extra.length > 0 ? ` (${extra.join(", ")})` : ""}`));
  }
  for (const s of q.stairs) out.push(tag(`stairs – ${stairWords(s)}`));
  if (q.posts.count > 0) out.push(tag(`posts – ${q.posts.count} (${postSize(q.posts.sizeInches)}${q.posts.material ? ` ${POST_MATERIAL_LABEL[q.posts.material].toLowerCase()}` : ""}, ${postHeightWords(q)})`));
  for (const b of q.beams) out.push(tag(`beam – ${num(b.lengthFeet)} LF${b.size ? ` (${b.size})` : ""}`));
  // Runs of one kind and material together: a porch's skirting round three sides is one line.
  for (const g of screenGroups(q)) {
    out.push(tag(`${SCREEN_LABEL[g.kind].toLowerCase()} – ${g.material} – ${num(g.squareFeet)} SF (${ft(g.lengthFeet)}${g.heights.length === 1 ? ` × ${ft(g.heights[0] as number)}` : " long"})`));
  }
  if (q.rimFeet > 0.05) out.push(tag(`rim joist & fascia – ${num(q.rimFeet)} LF (its open edges)`));
  if (q.ledgerFeet > 0.05) out.push(tag(`ledger – ${num(q.ledgerFeet)} LF`));
  return out;
}

/** Whether the house's roof covers a real share of a deck - a quarter of it or more - and not only the eave's overhang. */
export function coveredShare(q: Pick<DeckQuantities, "areaSquareFeet" | "coveredSquareFeet">): boolean {
  return q.coveredSquareFeet > 0.5 && q.coveredSquareFeet >= 0.25 * q.areaSquareFeet;
}

/** The decks' lines for the scope, only those ticked (`ExteriorScope.decks`). */
export function deckScopeLines(exterior: Exterior | undefined, roof: RoofPlan | null = null): string[] {
  if (!exterior) return [];
  const ticked = new Set(exterior.scope?.decks ?? []);
  if (ticked.size === 0) return [];
  return decksQuantities(exterior, roof)
    .filter((q) => ticked.has(q.deck.id))
    .flatMap(deckLines);
}

// ---------------------------------------------------------------------------------------------
// What the photos can't see: "Check these" and the report's "To check"
// ---------------------------------------------------------------------------------------------

export type DeckCheckItem = "depth" | "framing" | "posts" | "decking" | "height" | "stairs" | `railing:${string}` | `screen:${string}` | `stair:${string}`;

export interface DeckCheck {
  key: string;
  deckId: string;
  item: DeckCheckItem;
  title: string;
  words: string;
  /** Posts: a count to type over the one read. */
  count?: number;
  /** Its depth: a tape to type over the one worked out. */
  feet?: number;
}

/**
 * Its depth out from its wall as taped (on "Check these"): its outer edge moved to it, back to the walls behind it as
 * before, its railings and stairs kept on their edges, and no longer asked.
 */
export function withDeckDepth(exterior: Exterior, deckId: string, feet: number): Exterior {
  return withDeckChange(exterior, deckId, (d) => {
    const ring = d.sideId ? ringInSideFrame(exterior, d.sideId) : null;
    if (!ring || !(feet > 0.5)) return d;
    const xs = d.outline.map((p) => p.x);
    const outline = outlineToWalls(ring, Math.min(...xs), Math.max(...xs), feet);
    if (outline.length !== d.outline.length) return { ...d, confirmed: [...new Set([...(d.confirmed ?? []), "depth"])] };
    return { ...d, outline, posts: d.posts ? { ...d.posts, at: d.posts.at?.map((p) => ({ x: p.x, y: p.y + (feet - Math.max(...d.outline.map((q) => q.y))) * (p.y > 0 ? 1 : 0) })) } : null, confirmed: [...new Set([...(d.confirmed ?? []), "depth"])] };
  });
}

/**
 * The rows to check for a deck read off the photos: its framing always (no photo shows the joists, the beams' sizes or the
 * footings), its posts where skirting or the stairs hide some, and anything read unsure. A deck put in by hand was seen by
 * the estimator: nothing is asked of it.
 */
export function deckChecks(exterior: Exterior): DeckCheck[] {
  const rows: DeckCheck[] = [];
  for (const d of decksOf(exterior)) {
    if (d.from !== "photos") continue;
    const done = new Set(d.confirmed ?? []);
    const name = deckName(d);
    const row = (item: DeckCheckItem, title: string, words: string, extra: Partial<DeckCheck> = {}) => {
      if (!done.has(item)) rows.push({ key: `deck:${d.id}:${item}`, deckId: d.id, item, title: `${name}: ${title}`, words, ...extra });
    };
    const skirted = d.screens.some((s) => s.kind === "skirting");
    // How far out it comes, against its wall: the photos place its corners, a tape settles it.
    if (d.sideId) {
      const wall = exterior.sides.find((s) => s.id === d.sideId)?.name.trim() || "its wall";
      const depth = Math.max(...d.outline.map((p) => p.y));
      row("depth", `${ft(depth)} out from the ${wall}`, `Worked out from the photos, not taped: tape it from the ${wall} to the outer face of its rim.`, { feet: depth });
    }
    row("framing", "its framing", `The joists, beams and footings can't be seen in the photos${skirted ? " (skirting hides them)" : ""}: look under it.`);
    if (d.posts?.unsure || (skirted && !d.posts?.confirmed)) row("posts", d.posts?.count ? plural(d.posts.count, "post") : "its posts", d.posts?.unsure ? `${capital(d.posts.unsure)}.` : "Skirting hides its posts: count them.", { count: d.posts?.count ?? 0 });
    if (d.deckingRead?.unsure && !d.deckingRead.confirmed) row("decking", `its decking (${DECKING_LABEL[d.decking].toLowerCase()})`, `${capital(d.deckingRead.unsure)}.`);
    for (const r of d.railings) if (r.unsure && !r.confirmed) row(`railing:${r.id}`, `the ${railingWords(r.kind, r.label)}`, `${capital(r.unsure)}.`);
    for (const s of d.stairs) if (s.unsure && !s.confirmed) row(`stair:${s.id}`, `the stairs, ${plural(Math.round(s.risers), "riser")}`, `${capital(s.unsure)}.`);
    for (const s of d.screens) if (s.unsure && !s.confirmed) row(`screen:${s.id}`, `the ${SCREEN_LABEL[s.kind].toLowerCase()}`, `${capital(s.unsure)}.`);
  }
  return rows;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The report's "To check" for the decks: every row not answered, closed by "Looks right" or not. */
export function deckNotes(exterior: Exterior): string[] {
  return deckChecks(exterior).map((r) => `${r.title}: ${r.words.replace(/\.$/, "")}.`);
}

/** A deck's row answered on "Check these": kept as read, and for its posts a count typed over the one read. */
export function withDeckAnswer(exterior: Exterior, deckId: string, item: DeckCheckItem, count?: number): Exterior {
  return withDeckChange(exterior, deckId, (d) => {
    const confirmed = [...new Set([...(d.confirmed ?? []), item])];
    const next: Deck = { ...d, confirmed };
    if (item === "posts" && count !== undefined && d.posts) next.posts = { ...d.posts, count: Math.max(0, Math.round(count)), confirmed: true };
    return next;
  });
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** The exterior with one deck changed; undefined takes it away (and off the scope). */
export function withDeckChange(exterior: Exterior, deckId: string, f: (d: Deck) => Deck | undefined): Exterior {
  const list = exterior.decks ?? [];
  const next = list.flatMap((d) => {
    if (d.id !== deckId) return [d];
    const done = f(d);
    return done ? [done] : [];
  });
  const gone = next.length < list.length;
  const out: Exterior = { ...exterior };
  if (next.length > 0) out.decks = next;
  else delete out.decks;
  if (gone && exterior.scope?.decks) out.scope = { ...exterior.scope, decks: exterior.scope.decks.filter((id) => id !== deckId) };
  return out;
}

export function withDeckAdded(exterior: Exterior, deck: Deck): Exterior {
  return { ...exterior, decks: [...(exterior.decks ?? []), deck] };
}

/**
 * The decks once a side is taken away: one against it keeps its place on the plan, free-standing - nothing measured is
 * lost with the wall.
 */
export function decksWithoutSide(exterior: Exterior, sideId: string): Deck[] | undefined {
  const list = exterior.decks;
  if (!list || !list.some((d) => d.sideId === sideId)) return list;
  const fp = exteriorFootprint(exterior);
  return list.map((d) => {
    if (d.sideId !== sideId) return d;
    const frame = deckFrame(exterior, d, fp);
    if (!frame) return { ...d, sideId: null };
    const map = (p: Pt) => toPlan(frame, p);
    return {
      ...d,
      sideId: null,
      outline: d.outline.map(map),
      ...(d.posts?.at ? { posts: { ...d.posts, at: d.posts.at.map(map) } } : {}),
    };
  });
}

/** A new name among [taken]: "Deck", then "Deck 2". */
export function uniqueDeckName(name: string, taken: string[]): string {
  const base = name.trim() || "Deck";
  const used = new Set(taken.map((n) => n.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let k = 2; ; k++) if (!used.has(`${base} ${k}`.toLowerCase())) return `${base} ${k}`;
}

// ---------------------------------------------------------------------------------------------
// Read off a side's squared photo (lib/exteriorTrace.ts `ProposedDeck`)
// ---------------------------------------------------------------------------------------------

const FOOT_M = 0.3048;

/**
 * What a side's photo read of the deck in front of it, put on that deck (2026-10-20): its railings along its outer edge by
 * kind and height, its stairs with their risers, its posts, its screens and its decking - each box off the wall's plane
 * brought back to the deck's own distance out, where it really stands (`unswell`). The deck must already be there - placed
 * off the photos or typed: a square-on photo can't say how far out it is. What the read replaces is that edge's own; the rest
 * of the deck stays. Each piece is marked read off a photo, unsure where something hid part of it.
 */
export function withDeckRead(exterior: Exterior, sideId: string, read: ProposedDeck, cameraAt: CameraAt | null): { exterior: Exterior; words: string[] } {
  const deck = decksOf(exterior).find((d) => d.sideId === sideId);
  if (!deck) return { exterior, words: ["No deck stands against this side yet: put it in first, then use the read."] };
  const local = deck.outline;
  const maxY = Math.max(...local.map((p) => p.y));
  const outer = local.findIndex((p, i) => {
    const q = local[(i + 1) % local.length] as Pt;
    return Math.abs(p.y - maxY) < 0.05 && Math.abs(q.y - maxY) < 0.05 && Math.abs(q.x - p.x) > 0.25;
  });
  if (outer < 0) return { exterior, words: ["The deck has no edge running along this side to put the read on."] };
  const pa = local[outer] as Pt;
  const pb = local[(outer + 1) % local.length] as Pt;
  const dir = Math.sign(pb.x - pa.x) || 1;
  const s = (x: number) => (x - pa.x) * dir;
  // A box as it shows on the wall's plane, back to where it stands, the deck's depth out.
  const real = (b: FeetBox): FeetBox => {
    const at = (x: number, y: number) => {
      const seen = { alongM: x * FOOT_M, upM: y * FOOT_M };
      const cam = cameraAt?.({ alongM: ((b.x0 + b.x1) / 2) * FOOT_M, upM: ((b.y0 + b.y1) / 2) * FOOT_M }) ?? null;
      const r = cam ? unswell(cam, seen, maxY * FOOT_M) : seen;
      return { x: r.alongM / FOOT_M, y: r.upM / FOOT_M };
    };
    const lo = at(b.x0, b.y0);
    const hi = at(b.x1, b.y1);
    return { x0: Math.min(lo.x, hi.x), x1: Math.max(lo.x, hi.x), y0: Math.min(lo.y, hi.y), y1: Math.max(lo.y, hi.y) };
  };
  const span = (b: FeetBox) => {
    const a = s(b.x0);
    const c = s(b.x1);
    return { fromFeet: Math.max(0, Math.min(a, c)), toFeet: Math.max(a, c) };
  };
  const unsure = (h?: string) => (h ? { unsure: `partly hidden by ${h} in its photo` } : {});
  const words: string[] = [];
  const next: Deck = { ...deck };
  if (read.decking) {
    next.decking = read.decking;
    next.deckingRead = { from: "photo" };
  }
  const railings: DeckRailing[] = read.railings.map((r) => {
    const b = real(r.box);
    return { id: newSketchId("rail"), edge: outer, ...span(b), kind: r.kind, ...(r.label ? { label: r.label } : {}), heightFeet: Math.max(0.5, b.y1 - b.y0), from: "photo", ...unsure(r.hiddenBy) };
  });
  if (railings.length > 0) {
    next.railings = [...deck.railings.filter((r) => r.edge !== outer), ...railings];
    words.push(`${railings.length} run${railings.length === 1 ? "" : "s"} of railing`);
  }
  const stairs: DeckStair[] = read.stairs.map((st, k) => {
    const b = real(st.box);
    const old = deck.stairs.filter((x) => x.edge === outer)[k];
    const sp = span(b);
    return {
      id: old?.id ?? newSketchId("stair"),
      edge: outer,
      atFeet: (sp.fromFeet + sp.toFeet) / 2,
      widthFeet: Math.max(1, sp.toFeet - sp.fromFeet),
      risers: st.risers ?? old?.risers ?? risersFor(deck.heightOutFeet ?? deck.heightFeet),
      railing: old?.railing ?? { kind: railings[0]?.kind ?? deck.railings[0]?.kind ?? "aluminum", sides: 2 },
      ...(read.gates > 0 && k === 0 ? { gate: true } : old?.gate ? { gate: true } : {}),
      from: "photo",
      ...(st.risers === null ? { unsure: "its risers weren't counted off the photo" } : unsure(st.hiddenBy)),
    };
  });
  if (stairs.length > 0) {
    next.stairs = [...deck.stairs.filter((x) => x.edge !== outer), ...stairs];
    words.push(`${stairs.length === 1 ? "a stair" : `${stairs.length} stairs`}`);
  } else if (read.gates > 0 && railings[0]) railings[0].gates = read.gates;
  if (read.posts.length > 0) {
    const count = Math.max(read.posts.length, deck.posts?.count ?? 0);
    next.posts = { ...(deck.posts ?? {}), count, from: "photo", unsure: "only the posts this side's photo shows are counted" };
    words.push(`${read.posts.length} post${read.posts.length === 1 ? "" : "s"}`);
  }
  if (read.screens.length > 0) {
    const screens: DeckScreen[] = read.screens.map((sc) => {
      const b = real(sc.box);
      return { id: newSketchId("screen"), kind: sc.kind, edge: outer, ...span(b), heightFeet: Math.max(0.5, b.y1 - b.y0), material: sc.material, ...(sc.label ? { label: sc.label } : {}), from: "photo", ...unsure(sc.hiddenBy) };
    });
    next.screens = [...deck.screens.filter((x) => x.edge !== outer), ...screens];
    words.push(`${screens.length} screen${screens.length === 1 ? "" : "s"}`);
  }
  return { exterior: withDeckChange(exterior, deck.id, () => next), words };
}

// ---------------------------------------------------------------------------------------------
// From its outer edge back to the house
// ---------------------------------------------------------------------------------------------

/**
 * A deck's outline from its outer edge back to the house (2026-10-20): in its wall's frame, the strip from [x0] to [x1]
 * along the wall, from [depth] out back to the first wall of the house behind each part of it - the wall it stands
 * against, or deeper in, the back of a covered corner beside it. [ring] is the house's outline in that frame (x along the
 * wall, y out of it). Where no wall is behind it, back to the wall's own line.
 */
export function outlineToWalls(ring: Pt[], x0: number, x1: number, depth: number): Pt[] {
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  const xs = [...new Set([lo, hi, ...ring.map((p) => p.x).filter((x) => x > lo + 0.05 && x < hi - 0.05)])].sort((a, b) => a - b);
  const floors: { a: number; b: number; y: number }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i] as number;
    const b = xs[i + 1] as number;
    if (b - a < 1e-6) continue;
    const xm = (a + b) / 2;
    let best = -Infinity;
    for (let k = 0; k < ring.length; k++) {
      const p = ring[k] as Pt;
      const q = ring[(k + 1) % ring.length] as Pt;
      if ((p.x - xm) * (q.x - xm) > 0 || Math.abs(q.x - p.x) < 1e-9) continue;
      const y = p.y + ((q.y - p.y) * (xm - p.x)) / (q.x - p.x);
      if (y < depth - 0.05 && y > best) best = y;
    }
    floors.push({ a, b, y: Number.isFinite(best) ? best : 0 });
  }
  if (floors.length === 0) return [];
  // Round it: out at the left, along the outer edge, back down the right, then along the walls behind it, right to left.
  const out: Pt[] = [{ x: lo, y: depth }, { x: hi, y: depth }];
  for (let i = floors.length - 1; i >= 0; i--) {
    const f = floors[i] as { a: number; b: number; y: number };
    out.push({ x: f.b, y: f.y }, { x: f.a, y: f.y });
  }
  // Corners on a straight run between their neighbours, and twins, dropped.
  const clean: Pt[] = [];
  for (const p of out) if (!clean.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) clean.push(p);
  return clean.filter((p, i) => {
    const a = clean[(i - 1 + clean.length) % clean.length] as Pt;
    const b = clean[(i + 1) % clean.length] as Pt;
    return Math.abs((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x)) > 1e-6;
  });
}

/** The house's outline in a side's frame, off its footprint; null when its side isn't on a closed one. */
export function ringInSideFrame(exterior: Exterior, sideId: string, fp: Footprint = exteriorFootprint(exterior)): Pt[] | null {
  const frame = deckFrame(exterior, { sideId } as Deck, fp);
  if (!frame || !fp.closes) return null;
  return fp.corners.map((p) => fromPlan(frame, p));
}

// ---------------------------------------------------------------------------------------------
// The quick-deck box: a deck with a tape, no photos
// ---------------------------------------------------------------------------------------------

export interface QuickDeck {
  name: string;
  /** The wall it stands against; null free-standing (in front of the house's front, its left end at the front's). */
  sideId: string | null;
  /** From the wall's left end as you face it from outside to the deck's left end. Absent: centred on the wall. */
  fromLeftFeet?: number | null;
  /** Along the wall, and out from it. */
  widthFeet: number;
  depthFeet: number;
  heightFeet: number;
  decking: DeckingKind;
  railing: RailingKind | "none";
  railingFeet?: number;
  /** Stairs: off the outer edge, in its middle, this wide; risers from the height. Null for none. */
  stairs: { widthFeet: number; risers?: number | null; where: "outer" | "left" | "right" } | null;
}

/** What is missing from the box, in words; null when it makes a deck. */
export function quickDeckProblem(box: QuickDeck): string | null {
  if (!(box.widthFeet > 0) || !(box.depthFeet > 0)) return "Type the deck's width along the wall and how far it comes out.";
  if (!(box.heightFeet >= 0)) return "Type how high its top is off the ground.";
  if (box.stairs && !(box.stairs.widthFeet > 0)) return "Type the stairs' width, or take the stairs off.";
  return null;
}

/**
 * A deck from the quick-deck box: against its wall, from the wall out to its depth (back to the house behind it, so one
 * typed wider than its wall fills the covered corner beside it), railed on its open edges round its stairs, the stairs off
 * the edge said, its posts spread along its open edges. Free-standing: a rectangle in front of the house's front.
 */
export function quickDeck(exterior: Exterior, box: QuickDeck): Deck {
  const fp = exteriorFootprint(exterior);
  const sideFeet = box.sideId && fp.closes ? (fp.lengthsFeet[fp.sideIds.indexOf(box.sideId)] ?? 0) : 0;
  const x0 = box.sideId ? (box.fromLeftFeet ?? Math.max(0, (sideFeet - box.widthFeet) / 2)) : 0;
  const x1 = x0 + box.widthFeet;
  const D = box.depthFeet;
  const ring = box.sideId ? ringInSideFrame(exterior, box.sideId, fp) : null;
  // Against a wall: the outer edge first (edge 0), back down its right end, along the walls behind it, up its left end.
  const outline: Pt[] =
    box.sideId && ring
      ? outlineToWalls(ring, x0, x1, D)
      : box.sideId
        ? [
            { x: x0, y: D },
            { x: x1, y: D },
            { x: x1, y: 0 },
            { x: x0, y: 0 },
          ]
        : [
            { x: x0, y: -D - 2 },
            { x: x1, y: -D - 2 },
            { x: x1, y: -2 },
            { x: x0, y: -2 },
          ];
  const last = outline.length - 1;
  const stairEdge = box.stairs ? (box.sideId ? (box.stairs.where === "left" ? last : box.stairs.where === "right" ? 1 : 0) : 0) : -1;
  const edgeLen = (i: number) => {
    const a = outline[i] as Pt;
    const b = outline[(i + 1) % outline.length] as Pt;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const stairs: DeckStair[] = box.stairs
    ? [
        {
          id: newSketchId("stair"),
          edge: stairEdge,
          atFeet: edgeLen(stairEdge) / 2,
          widthFeet: Math.min(box.stairs.widthFeet, edgeLen(stairEdge)),
          risers: box.stairs.risers && box.stairs.risers > 0 ? Math.round(box.stairs.risers) : risersFor(box.heightFeet),
          railing: box.railing === "none" ? null : { kind: box.railing, sides: 2 },
        },
      ]
    : [];
  const deck: Deck = {
    id: newSketchId("deck"),
    name: box.name.trim() || "Deck",
    sideId: box.sideId,
    outline,
    heightFeet: box.heightFeet,
    decking: box.decking,
    railings: [],
    stairs,
    posts: null,
    screens: [],
    from: "quick",
  };
  const geom = deckGeometry(exterior, deck, fp);
  if (geom && box.railing !== "none") deck.railings = railingsOnOpenEdges(deck, geom, box.railing, box.railingFeet ?? DEFAULT_RAILING_FEET);
  // Its posts: as many as its open edges want (a ground-level deck still stands on something).
  if (geom && box.heightFeet > 0) deck.posts = { count: postPositions(deck, geom).length, sizeInches: DEFAULT_POST_INCHES };
  return deck;
}

/** A railing along every open edge of a deck - not where it meets the house, and not across its stairs' tops. */
export function railingsOnOpenEdges(deck: Deck, geom: DeckGeometry, kind: RailingKind, heightFeet: number): DeckRailing[] {
  const out: DeckRailing[] = [];
  for (const e of geom.edges) {
    // The stretches of it not against a wall.
    const walls = [...e.against].sort((a, b) => a.fromFeet - b.fromFeet);
    let free: [number, number][] = [[0, e.lengthFeet]];
    for (const w of walls) free = free.flatMap(([f, t]) => [[f, Math.min(t, w.fromFeet)] as [number, number], [Math.max(f, w.toFeet), t] as [number, number]]).filter(([f, t]) => t - f > 0.25);
    // Less each stair's opening.
    for (const s of deck.stairs.filter((x) => x.edge === e.index)) {
      const a = s.atFeet - s.widthFeet / 2;
      const b = s.atFeet + s.widthFeet / 2;
      free = free.flatMap(([f, t]) => [[f, Math.min(t, a)] as [number, number], [Math.max(f, b), t] as [number, number]]).filter(([f, t]) => t - f > 0.25);
    }
    for (const [f, t] of free) out.push({ id: newSketchId("rail"), edge: e.index, ...(f > 1e-6 ? { fromFeet: f } : {}), ...(t < e.lengthFeet - 1e-6 ? { toFeet: t } : {}), kind, heightFeet });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// On the plan: what the footprint, the roof plan and the report's deck pages draw
// ---------------------------------------------------------------------------------------------

export interface DeckPlanShape {
  id: string;
  name: string;
  plan: Pt[];
  /** Each edge with its length, and whether it is against the house (its ledger). */
  edges: { a: Pt; b: Pt; out: Pt; lengthFeet: number; ledger: boolean; name: string }[];
  railings: { a: Pt; b: Pt; kind: RailingKind; stair: boolean }[];
  stairs: { top: [Pt, Pt]; foot: [Pt, Pt]; dir: Pt; treads: [Pt, Pt][]; risers: number; widthFeet: number }[];
  posts: Pt[];
  screens: { a: Pt; b: Pt; kind: ScreenKind }[];
  /** The way its boards run: along the wall it stands against. */
  boards: Pt;
  areaSquareFeet: number;
  coveredSquareFeet: number;
  heightFeet: number;
}

/** Every deck as the plans draw it; empty with none. */
export function deckPlanShapes(exterior: Exterior, roof: RoofPlan | null = null): DeckPlanShape[] {
  return decksQuantities(exterior, roof).flatMap((q) => {
    const g = q.geometry;
    if (!g) return [];
    return [
      {
        id: q.deck.id,
        name: q.name,
        plan: g.plan,
        edges: g.edges.map((e) => ({ a: e.a, b: e.b, out: e.out, lengthFeet: e.lengthFeet, ledger: e.ledgerFeet > 0.5 * e.lengthFeet, name: e.name })),
        railings: q.railings.filter((r) => r.lengthFeet > 0.05).map((r) => ({ a: r.a, b: r.b, kind: r.kind, stair: !!r.stairId })),
        stairs: q.stairs.map((s) => {
          const treads: [Pt, Pt][] = [];
          const steps = Math.max(0, Math.round(s.stair.risers) - 1);
          const landingAt = s.stair.landing && s.landingSquareFeet > 0 ? s.stair.landing.afterRisers : -1;
          let out = 0;
          for (let k = 1; k <= steps + (landingAt > 0 ? 1 : 0); k++) {
            out += k === landingAt ? (s.stair.landing as { depthFeet: number }).depthFeet : s.runFeet;
            if (out > s.totalRunFeet + 1e-6) break;
            treads.push([
              { x: s.top[0].x + s.dir.x * out, y: s.top[0].y + s.dir.y * out },
              { x: s.top[1].x + s.dir.x * out, y: s.top[1].y + s.dir.y * out },
            ]);
          }
          return { top: s.top, foot: s.foot, dir: s.dir, treads, risers: Math.round(s.stair.risers), widthFeet: s.stair.widthFeet };
        }),
        posts: q.posts.count > 0 ? q.posts.at : [],
        screens: q.screens.map((s) => ({ a: s.a, b: s.b, kind: s.screen.kind })),
        boards: g.frame.side ? g.frame.u : { x: 1, y: 0 },
        areaSquareFeet: q.areaSquareFeet,
        coveredSquareFeet: q.coveredSquareFeet,
        heightFeet: q.heightFeet,
      },
    ];
  });
}

// ---------------------------------------------------------------------------------------------
// In 3D: the parts the 3D view, the four elevations and each side's drawing are made of
// ---------------------------------------------------------------------------------------------

/** x, up, z = -plan y: lib/exterior3d.ts's frame. */
export type DeckV3 = [number, number, number];

export type DeckPartKind = "top" | "rim" | "post" | "glass" | "pickets" | "rail" | "railPost" | "cable" | "tread" | "riser" | "stringer" | "screen" | "skirting" | "landing";

/** A flat piece of a deck in the model's frame: a polygon, facing out of [normal] in plan (null for a level one). */
export interface DeckPart {
  deckId: string;
  kind: DeckPartKind;
  poly: DeckV3[];
  /** The way it faces on the plan, both ways for a panel seen from either side; null for a level piece (a top, a tread). */
  normal: Pt | null;
  /** The material its screen, decking or post is, for its colour. */
  material?: string;
}

/** A plan point at a height, in the model's frame. */
const v3 = (p: Pt, y: number): DeckV3 => [p.x, y, -p.y];

/** The thickness of the rim and the decking, drawn: a 2×10 and its board. */
export const RIM_FEET = 11 / 12;
const RAIL_CAP_FEET = 2.5 / 12;
const RAIL_POST_FEET = 2.5 / 12;

/** The ground at a deck's outer edge, in the model: its top less its height there - where its stairs land and its outer posts stand. */
export function deckOuterGround(deck: Deck, topY: number): number {
  return topY - (deck.heightOutFeet ?? deck.heightFeet);
}

/**
 * A deck in 3D: its top at [topY] (the model's height of its decking where it meets the wall), the ground under each point
 * where the deck's own heights say it is - measured at the deck, they are truer there than the model's ground, which is only
 * drawn through the walls' feet. Each piece flat, so a view square-on to the house draws it as it is and the 3D view stands it up.
 */
export function deckParts(deck: Deck, geom: DeckGeometry, topY: number): DeckPart[] {
  const parts: DeckPart[] = [];
  const id = deck.id;
  const push = (kind: DeckPartKind, poly: DeckV3[], normal: Pt | null, material?: string) => parts.push({ deckId: id, kind, poly, normal, ...(material ? { material } : {}) });
  // Where the ground is under a point of it: its top less its height there (stepping down to its outer edge, where it does).
  const g = (p: Pt) => topY - heightAt(deck, geom, p);
  push("top", geom.plan.map((p) => v3(p, topY)), null, deck.decking);
  // The rim round its open edges: the board under the decking's edge.
  for (const e of geom.edges) {
    if (e.ledgerFeet > e.lengthFeet - 0.05) continue;
    push("rim", [v3(e.a, topY), v3(e.b, topY), v3(e.b, topY - RIM_FEET), v3(e.a, topY - RIM_FEET)], e.out);
  }
  // Posts, from the ground up to under the rim.
  const size = ((deck.posts?.sizeInches ?? DEFAULT_POST_INCHES) / 12) * 1;
  for (const p of deck.posts && deck.posts.count > 0 ? postPositions(deck, geom) : []) {
    const y0 = g(p);
    const y1 = topY - RIM_FEET;
    if (y1 - y0 < 0.2) continue;
    box(parts, id, "post", p, size, y0, y1, deck.posts?.material);
  }
  // Skirting and privacy screens along their edges.
  for (const s of deck.screens) {
    const e = geom.edges[s.edge];
    if (!e) continue;
    const { from, to } = span(e, s.fromFeet, s.toFeet);
    const a = along(e, from);
    const b = along(e, to);
    if (s.kind === "privacy") push("screen", [v3(a, topY), v3(b, topY), v3(b, topY + s.heightFeet), v3(a, topY + s.heightFeet)], e.out, s.material);
    else push("skirting", [v3(a, g(a)), v3(b, g(b)), v3(b, topY - RIM_FEET), v3(a, topY - RIM_FEET)], e.out, s.material);
  }
  // Railings: posts at each end and every 6' or less, a cap over all, the infill between.
  for (const r of railingRuns(deck, geom)) {
    if (r.lengthFeet < 0.1) continue;
    const drop = r.dropFeet ?? 0;
    const yA = topY;
    const yB = topY - drop;
    const at = (t: number): [Pt, number] => [{ x: r.a.x + (r.b.x - r.a.x) * t, y: r.a.y + (r.b.y - r.a.y) * t }, yA + (yB - yA) * t];
    const dirLen = Math.hypot(r.b.x - r.a.x, r.b.y - r.a.y);
    const normal = dirLen > EPS ? { x: (r.b.y - r.a.y) / dirLen, y: -(r.b.x - r.a.x) / dirLen } : { x: 0, y: 1 };
    const plan = dirLen;
    const n = Math.max(1, Math.ceil(plan / RAIL_POST_SPACING_FEET - 1e-9));
    for (let k = 0; k <= n; k++) {
      const [p, y] = at(k / n);
      box(parts, id, "railPost", p, RAIL_POST_FEET, y, y + r.heightFeet + RAIL_CAP_FEET * 0.5);
    }
    const [p0, y0] = at(0);
    const [p1, y1] = at(1);
    const h = r.heightFeet;
    push("rail", [v3(p0, y0 + h), v3(p1, y1 + h), v3(p1, y1 + h + RAIL_CAP_FEET), v3(p0, y0 + h + RAIL_CAP_FEET)], normal);
    const infill: DeckPartKind = r.kind === "glass" ? "glass" : r.kind === "cable" ? "cable" : "pickets";
    const bottom = 0.25;
    push(infill, [v3(p0, y0 + bottom), v3(p1, y1 + bottom), v3(p1, y1 + h), v3(p0, y0 + h)], normal, r.kind);
  }
  // Stairs: each tread level, each riser upright, a stringer down each side.
  for (const s of deck.stairs) {
    const sg = stairGeometry(deck, geom, s);
    if (!sg) continue;
    const [right, left] = sg.top;
    const d = sg.dir;
    const step = (p: Pt, k: number) => ({ x: p.x + d.x * k, y: p.y + d.y * k });
    const landingAfter = s.landing && s.landing.afterRisers > 0 && s.landing.afterRisers < s.risers ? s.landing.afterRisers : -1;
    let out = 0;
    let y = topY;
    for (let k = 1; k <= Math.round(s.risers); k++) {
      const yNext = y - sg.riseFeet;
      // The riser under this step's nosing, then the tread it goes down to (the last onto the ground).
      push("riser", [v3(step(right, out), y), v3(step(left, out), y), v3(step(left, out), yNext), v3(step(right, out), yNext)], d, deck.decking);
      const going = k === landingAfter ? (s.landing as { depthFeet: number }).depthFeet : k < Math.round(s.risers) ? sg.runFeet : 0;
      if (going > 0) push(k === landingAfter ? "landing" : "tread", [v3(step(right, out), yNext), v3(step(left, out), yNext), v3(step(left, out + going), yNext), v3(step(right, out + going), yNext)], null, deck.decking);
      out += going;
      y = yNext;
    }
    for (const p of [right, left]) {
      const foot = step(p, sg.totalRunFeet);
      push("stringer", [v3(p, topY), v3(foot, g(foot) + sg.riseFeet), v3(foot, g(foot)), v3(p, topY - RIM_FEET)], { x: -d.y, y: d.x });
    }
  }
  return parts;
}

/** An upright square post: its four faces. */
function box(parts: DeckPart[], deckId: string, kind: DeckPartKind, c: Pt, size: number, y0: number, y1: number, material?: string): void {
  const h = size / 2;
  const corners: Pt[] = [
    { x: c.x - h, y: c.y - h },
    { x: c.x + h, y: c.y - h },
    { x: c.x + h, y: c.y + h },
    { x: c.x - h, y: c.y + h },
  ];
  const normals: Pt[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as Pt;
    const b = corners[(i + 1) % 4] as Pt;
    parts.push({ deckId, kind, poly: [v3(a, y0), v3(b, y0), v3(b, y1), v3(a, y1)], normal: normals[i] as Pt, ...(material ? { material } : {}) });
  }
}

/**
 * The deck's top in the model: on the wall's own elevation where it says (`topOnWallFeet`), else the ground at the wall
 * under its ledger's middle plus its height - [frameV] the side's frame zero in the model, as lib/exterior3d.ts has it.
 */
export function deckTopOnWall(deck: Deck, side: ExteriorSide | null, frameV: number, alongFeet: number): number {
  if (!side) return frameV + deck.heightFeet;
  if (deck.topOnWallFeet !== undefined && Number.isFinite(deck.topOnWallFeet)) return frameV + deck.topOnWallFeet;
  return frameV + groundAt(side, Math.max(0, Math.min(side.lengthFeet, alongFeet))) + deck.heightFeet;
}

/** Where along its wall a deck's top is read: the middle of the part of it against the wall, else of its outline. */
export function deckWallAlong(deck: Deck): number {
  const onWall = deck.outline.filter((p) => Math.abs(p.y) < AGAINST_FEET);
  const xs = (onWall.length >= 2 ? onWall : deck.outline).map((p) => p.x);
  return (Math.min(...xs) + Math.max(...xs)) / 2;
}
