/**
 * Decks and porches in the house runner (scripts/house/run.mjs): placed on the measured house from inputs.json `decks`,
 * with Scrivn's own deck code (lib/decks.ts, lib/deckPhotos.ts), as the Photos tab's "5. Decks" step places them.
 *
 *   "decks": [{
 *     "name": "Back deck", "side": "C4-C5",                  the wall it stands against
 *     "taps": [{"photo": 6, "point": "corner:0", "x": 1210, "y": 980}, ...],
 *                                                            its outer corners at the ground (a post's foot), each on two
 *                                                            photos; "top:0" its decking's edge over corner 0 (its height)
 *     "fromFeet": 2, "toFeet": 18, "depthFeet": 10,         or by size along the wall (from its left end as you face it)
 *                                                            and out; with taps, a taped "depthFeet" alone reshapes it
 *     "heightFeet": 2.5, "heightOutFeet": 2,                its top over the ground at the wall, and at its outer edge
 *     "topOnWallFeet": 0,                                    a porch whose wall was measured from the porch
 *     "decking": "wood",
 *     "railings": [{"edge": "outer", "kind": "wood", "heightFeet": 3, "fromFeet": 0, "toFeet": 6, "gates": 0}],
 *     "stairs": [{"edge": "left", "atFeet": 4, "widthFeet": 4, "risers": 3, "railing": {"kind": "wood", "sides": 1}, "gate": false}],
 *     "posts": {"count": 4, "sizeInches": 4, "material": "wood"},
 *     "screens": [{"kind": "skirting", "edge": "outer", "heightFeet": 2, "material": "lattice"}]
 *   }]
 *
 * Edges are the deck's own, numbered round it from its outer rim (0); "outer", "left" and "right" name the rim and its two
 * open ends as you face the wall. measure prints each deck's edges with their lengths. Kinds (lib/decks.ts): decking
 * composite / wood / membrane; railings glass / aluminum / wood / cable; screens privacy / skirting, of wood / vinyl /
 * lattice / composite / aluminum; posts wood / aluminum / steel / concrete.
 */
import { photoOf } from "./folder.mjs";
import { ftin, sideIndex } from "./words.mjs";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deck";

/** A deck's edge by its number, or "outer" (the rim along the wall), "left" / "right" (its open ends as you face the wall). */
export function deckEdge(outline, edge) {
  if (Number.isInteger(edge)) return edge >= 0 && edge < outline.length ? edge : null;
  const n = outline.length;
  const maxY = Math.max(...outline.map((p) => p.y));
  const along = (i) => {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    return { a, b, y: (a.y + b.y) / 2, x: (a.x + b.x) / 2, flat: Math.abs(a.y - b.y) < 0.05, upright: Math.abs(a.x - b.x) < 0.05 };
  };
  const edges = outline.map((_, i) => ({ i, ...along(i) }));
  if (edge === "outer") return edges.find((e) => e.flat && Math.abs(e.y - maxY) < 0.05)?.i ?? null;
  // Its ends: the uprights that reach the rim, leftmost and rightmost.
  const ends = edges.filter((e) => e.upright && Math.max(e.a.y, e.b.y) > maxY - 0.05);
  if (edge === "left") return ends.sort((p, q) => p.x - q.x)[0]?.i ?? null;
  if (edge === "right") return ends.sort((p, q) => q.x - p.x)[0]?.i ?? null;
  return null;
}

/** The deck's edges in words: "0 outer 26'7"", with which run along a wall (its ledger) said. */
export function edgeWords(outline) {
  const n = outline.length;
  const names = new Map([["outer", deckEdge(outline, "outer")], ["left", deckEdge(outline, "left")], ["right", deckEdge(outline, "right")]].map(([k, v]) => [v, k]));
  return outline.map((a, i) => {
    const b = outline[(i + 1) % n];
    return `${i}${names.has(i) ? ` ${names.get(i)}` : ""} ${ftin(Math.hypot(b.x - a.x, b.y - a.y))}`;
  });
}

/**
 * The decks of inputs.json put on the measured exterior: each placed off its taps (or its sizes), its parts on its edges.
 * Returns the exterior with them, and per deck what was done and what wasn't, in words.
 */
/**
 * A length along a wall or an edge as inputs.json gives it: feet, or "start" (0) / "end" (its whole length, [length]).
 * Undefined stays undefined; anything else is said in [why] and is null.
 */
export function feetAlong(v, length, what, why) {
  if (v === undefined || v === null) return undefined;
  if (v === "start") return 0;
  if (v === "end") {
    if (Number.isFinite(length)) return length;
    why.push(`${what}: "end", but the length it runs to isn't known`);
    return null;
  }
  const f = Number(v);
  if (Number.isFinite(f)) return f;
  why.push(`${what}: "${v}" is no length (feet, or "start" / "end")`);
  return null;
}

/** A railing's or a screen's from/to along its edge, "start"/"end" read; null (said in [why]) when either is no length. */
function partSpan(part, length, what, why) {
  const fromFeet = feetAlong(part.fromFeet, length, `${what} fromFeet`, why);
  const toFeet = feetAlong(part.toFeet, length, `${what} toFeet`, why);
  if (fromFeet === null || toFeet === null) return null;
  return { ...(fromFeet !== undefined ? { fromFeet } : {}), ...(toFeet !== undefined ? { toFeet } : {}) };
}

/** Edge k of a deck's outline, feet. */
function edgeLength(outline, k) {
  const a = outline[k];
  const b = outline[(k + 1) % outline.length];
  return a && b ? Math.hypot(b.x - a.x, b.y - a.y) : null;
}

export function placeDecks(x, h, inputs, ext, n) {
  const placed = [];
  let out = ext;
  const m = ext.photoRoute?.measured;
  for (const [k, d] of (inputs.decks ?? []).entries()) {
    const name = d.name ?? `Deck ${k + 1}`;
    const id = d.id ?? `deck-${slug(name)}`;
    const side = sideIndex(d.side, n);
    if (side === null || !m?.sideIds?.[side]) {
      placed.push({ name, deck: null, why: [`"side" must be the wall it stands against, e.g. "C7-C8"`] });
      continue;
    }
    const sideId = m.sideIds[side];
    const taps = (d.taps ?? []).flatMap((t) => {
      const p = photoOf(h, t.photo);
      return p ? [{ photo: p.id, point: t.point, x: Number(t.x), y: Number(t.y) }] : [];
    });
    const why = [];
    // Along the wall by size: feet from its left end, or "start" / "end" (2026-10-22: a blind run's "toFeet": "end" went in
    // as no number and the report's PDF came out NaN). The wall's length is the measured side's.
    const wallFeet = out.sides.find((q) => q.id === sideId)?.lengthFeet ?? null;
    const alongWall = feetAlong(d.fromFeet, wallFeet, `${name}: fromFeet`, why);
    const toWall = feetAlong(d.toFeet, wallFeet, `${name}: toFeet`, why);
    const sized = d.fromFeet !== undefined || d.toFeet !== undefined;
    if (sized && (alongWall === null || toWall === null)) {
      placed.push({ name, deck: null, why });
      continue;
    }
    const bySize = Number.isFinite(alongWall) && Number.isFinite(toWall) && Number.isFinite(Number(d.depthFeet));
    let deck = null;
    let placing = null;
    if (bySize) {
      const ring = x.ringInSideFrame(out, sideId);
      const outline = ring ? x.outlineToWalls(ring, alongWall, toWall, Number(d.depthFeet)) : [];
      if (outline.length >= 3) deck = { id, name, sideId, outline, heightFeet: 0, decking: "composite", railings: [], stairs: [], posts: null, screens: [], from: "hand" };
      else why.push("its sizes don't make an outline against that wall");
    } else {
      const r = x.deckFromPhotos(m, side, taps, null, { id, name });
      deck = r.deck;
      placing = r.placing;
      why.push(...r.why);
    }
    if (!deck) {
      placed.push({ name, deck: null, why });
      continue;
    }
    const edge = (e, what) => {
      const i = deckEdge(deck.outline, e);
      if (i === null) why.push(`${what}: no edge "${e}" (edges: ${edgeWords(deck.outline).join(", ")})`);
      return i;
    };
    deck = {
      ...deck,
      ...(Number.isFinite(d.heightFeet) ? { heightFeet: d.heightFeet } : {}),
      ...(Number.isFinite(d.heightOutFeet) ? { heightOutFeet: d.heightOutFeet } : {}),
      ...(Number.isFinite(d.topOnWallFeet) ? { topOnWallFeet: d.topOnWallFeet } : {}),
      decking: d.decking ?? deck.decking ?? "composite",
      railings: (d.railings ?? []).flatMap((r, i) => {
        const e = edge(r.edge, `railing ${i + 1}`);
        const span = e === null ? null : partSpan(r, edgeLength(deck.outline, e), `railing ${i + 1}`, why);
        return e === null || !span ? [] : [{ id: `${id}-rail-${i + 1}`, ...r, ...span, edge: e, kind: r.kind ?? "aluminum", heightFeet: r.heightFeet ?? 3.5, from: "photo" }];
      }),
      stairs: (d.stairs ?? []).flatMap((s, i) => {
        const e = edge(s.edge, `stair ${i + 1}`);
        return e === null ? [] : [{ id: `${id}-stair-${i + 1}`, railing: null, ...s, edge: e, from: "photo" }];
      }),
      posts: d.posts ? { ...d.posts, from: "photo" } : deck.posts ?? null,
      screens: (d.screens ?? []).flatMap((s, i) => {
        const e = edge(s.edge, `screen ${i + 1}`);
        const span = e === null ? null : partSpan(s, edgeLength(deck.outline, e), `screen ${i + 1}`, why);
        return e === null || !span ? [] : [{ id: `${id}-screen-${i + 1}`, ...s, ...span, edge: e, material: s.material ?? "wood", from: "photo" }];
      }),
    };
    // Nothing that isn't a number goes on the exterior: a NaN there reached the report's PDF (2026-10-22).
    const bad = [deck.heightFeet, deck.heightOutFeet, deck.topOnWallFeet, ...deck.outline.flatMap((q) => [q.x, q.y]), ...deck.railings.flatMap((r) => [r.fromFeet, r.toFeet, r.heightFeet]), ...deck.screens.flatMap((q) => [q.fromFeet, q.toFeet, q.heightFeet]), ...deck.stairs.flatMap((q) => [q.atFeet, q.widthFeet])].some((v) => v !== undefined && v !== null && !Number.isFinite(Number(v)));
    if (bad) {
      placed.push({ name, deck: null, why: [...why, "a size on it is no number: left out"] });
      continue;
    }
    out = x.withDeckAdded(out, deck);
    if (!bySize && Number.isFinite(d.depthFeet)) out = x.withDeckDepth(out, id, d.depthFeet);
    const now = x.decksOf(out).find((q) => q.id === id);
    const xs = now.outline.map((p) => p.x);
    const depth = Math.max(...now.outline.map((p) => p.y));
    placed.push({
      name,
      id,
      deck: now,
      placing,
      taps: taps,
      why,
      words: `${name} on ${d.side}: ${ftin(Math.max(...xs) - Math.min(...xs))} along, ${ftin(depth)} out, ${ftin(now.heightFeet)} high; edges ${edgeWords(now.outline).join(", ")}`,
    });
  }
  return { exterior: out, placed };
}
