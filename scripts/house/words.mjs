/**
 * The house runner's plain-words inputs (scripts/house/run.mjs): tapes.txt, one tape a line as the owner says it
 * ("garage door 16'", "back wall 31'4\"", "porch 90 in"), and house.txt (the home's type, which way
 * the front faces, notes). Each line read for what it can say; anything it can't is said back, never guessed.
 */

const FT = `(?:'|′|’|ft\\.?|feet|foot)`;
const IN = `(?:"|″|”|''|in\\.?|inch(?:es)?)`;
const NUM = `(\\d+(?:\\.\\d+)?)`;
const FRAC = `(?:\\s*(\\d+)\\s*/\\s*(\\d+))?`;

/** A fraction's value, or 0. */
const frac = (a, b) => (a && b && Number(b) > 0 ? Number(a) / Number(b) : 0);

/**
 * Every length in a line of words, in feet, in order, with where each was: 31'4", 31' 4 1/2", 31 ft 4 in,
 * 90", 90 in, 16', 16 feet, 6.5 m, 650 cm, 6500 mm.
 */
export function lengthsIn(text) {
  const found = [];
  const taken = [];
  const free = (i, j) => !taken.some(([a, b]) => i < b && j > a);
  const scan = (re, feetOf) => {
    for (const m of text.matchAll(re)) {
      const i = m.index;
      const j = i + m[0].length;
      if (!free(i, j)) continue;
      const feet = feetOf(m);
      if (!(feet > 0)) continue;
      taken.push([i, j]);
      found.push({ feet, at: i, text: m[0].trim() });
    }
  };
  // Feet and inches together first, so 31'4" is one length and not 31' and 4".
  scan(new RegExp(`${NUM}\\s*${FT}\\s*-?\\s*${NUM}${FRAC}\\s*(?:${IN})?`, "gi"), (m) => Number(m[1]) + (Number(m[2]) + frac(m[3], m[4])) / 12);
  scan(new RegExp(`${NUM}${FRAC}\\s*${IN}(?![a-z])`, "gi"), (m) => (Number(m[1]) + frac(m[2], m[3])) / 12);
  scan(new RegExp(`${NUM}\\s*${FT}(?![a-z])`, "gi"), (m) => Number(m[1]));
  scan(/(\d+(?:\.\d+)?)\s*(mm|cm|m)(?![a-z])/gi, (m) => Number(m[1]) * { mm: 0.001, cm: 0.01, m: 1 }[m[2].toLowerCase()] / 0.3048);
  return found.sort((a, b) => a.at - b.at);
}

/** What was taped, by its words: an opening (a line on a photo across it) or a wall (its length, corner to corner). */
export function tapeKind(words) {
  const w = words.toLowerCase();
  if (/roll[- ]?up|overhead|garage/.test(w)) return { what: "garage", kind: "line" };
  if (/window/.test(w)) return { what: "window", kind: "line" };
  if (/door/.test(w)) return { what: "door", kind: "line" };
  if (/wall|side|front|rear|back|porch|length|long|end|gable|bump|corner/.test(w)) return { what: "wall", kind: "side" };
  return { what: "other", kind: "line" };
}

/** "garage doors" (more than one alike) or "both doors": the same tape across each. */
function howMany(words) {
  const w = words.toLowerCase();
  // A number counts what was taped when the openings follow it ("two garage doors", "3 windows"), or "both": "side 2" is a
  // label, "two-pane" says what the one is like, "the two metal vents" what is near it (a test house's windows, 10-23).
  const n = /\b(two|2|three|3)\s+(?:[a-z-]+\s+){0,2}(doors|windows|openings)\b/.exec(w);
  if (n) return /^(two|2)$/.test(n[1] ?? "") ? 2 : 3;
  if (/\bboth\b/.test(w)) return 2;
  return /\b(doors|windows)\b/.test(w) ? 2 : 1;
}

/** Words that make a line a size judged by eye, not a tape: "about 6'", "roughly 15'", "~10'", "6' or so", "15'-ish", "by eye". */
const ROUGH = /\b(?:about|roughly|approx(?:imately)?|estimated?|guess(?:ed)?|eyeball(?:ed)?|by eye|or so)\b|~|-ish\b/i;

/** The ± said with a rough size ("about 6' (±20%)", "+/- 15%"), percent; null when none. */
function plusMinusIn(line) {
  const m = /(?:±|\+\s*\/\s*-|\+-)\s*(\d+(?:\.\d+)?)\s*%/.exec(line);
  return m ? Number(m[1]) : null;
}

/**
 * tapes.txt: one tape a line. Blank lines and lines starting # are skipped. A line with no length is said back.
 * Each tape: its words, its feet (the first length on the line; a second is kept as `alsoFeet`, e.g. 9' x 7'), what it
 * is and how the route takes it, and how many alike it covers.
 * A line that says its size roughly ("the sunroom sticks out about 12' (±20%)") is an estimate made on site by eye,
 * never a tape: a side's length held loosely (lib/photoRoute.ts RouteEstimate), its ± 20% unless said.
 */
export function parseTapes(text) {
  const tapes = [];
  const estimates = [];
  const unread = [];
  const lines = String(text ?? "").replace(/^﻿/, "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const lengths = lengthsIn(line);
    if (lengths.length === 0) {
      unread.push(line);
      continue;
    }
    const words = line.replace(/\s+/g, " ");
    // The words without their lengths: "window 3 ft 2 in" is one window.
    const bare = lengths.reduce((w, l) => w.replace(l.text, " "), line);
    if (ROUGH.test(bare)) {
      estimates.push({ id: `e${estimates.length + 1}`, said: words, feet: lengths[0].feet, plusMinusPct: plusMinusIn(line) ?? 20 });
      continue;
    }
    const { what, kind } = tapeKind(bare);
    tapes.push({ id: `t${tapes.length + 1}`, said: words, feet: lengths[0].feet, ...(lengths.length > 1 ? { alsoFeet: lengths.slice(1).map((l) => l.feet) } : {}), what, kind, count: kind === "line" ? howMany(bare) : 1 });
  }
  return { tapes, estimates, unread };
}

const COMPASS = { n: 0, north: 0, ne: 45, northeast: 45, "north-east": 45, e: 90, east: 90, se: 135, southeast: 135, "south-east": 135, s: 180, south: 180, sw: 225, southwest: 225, "south-west": 225, w: 270, west: 270, nw: 315, northwest: 315, "north-west": 315 };

/**
 * house.txt: what the owner knows of the home, a line each, in words: "semi-detached", "end townhouse", "front faces
 * north" / "front faces 340" / "front faces unknown", "name: 52 Elm St", and any notes (kept, said on the results).
 */
export function parseHouse(text) {
  const out = { homeType: null, frontFacesDeg: null, name: null, notes: [] };
  for (const raw of String(text ?? "").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const w = line.toLowerCase();
    const named = /^(?:name|address|title)\s*[:=]\s*(.+)$/i.exec(line);
    if (named) {
      out.name = named[1].trim();
      continue;
    }
    const faces = /front\s+(?:faces|facing|is)\s*[:=]?\s*(?:to\s+the\s+)?([a-z-]+|\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?/i.exec(line);
    if (faces) {
      const v = faces[1].toLowerCase();
      if (/^\d/.test(v)) out.frontFacesDeg = ((Number(v) % 360) + 360) % 360;
      else if (v in COMPASS) out.frontFacesDeg = COMPASS[v];
      else if (!/unknown|not|unsure|don/.test(v)) out.notes.push(line);
      continue;
    }
    if (/\bsemi\b|semi-detached/.test(w)) out.homeType = "semi";
    else if (/end\s+(?:unit|townhouse|town house|row)/.test(w)) out.homeType = "town_end";
    else if (/(?:middle|mid|inside|interior)\s+(?:unit|townhouse|town house|row)|townhouse|town house|row house/.test(w)) out.homeType = "town_middle";
    else if (/side[- ]?split|back[- ]?split|split[- ]?level/.test(w)) out.homeType = "split";
    else if (/up\/?down duplex|duplex/.test(w)) out.homeType = "duplex_updown";
    else if (/\bdetached\b|bungalow|single[- ]family/.test(w)) out.homeType = out.homeType ?? "detached";
    out.notes.push(line);
  }
  return out;
}

/**
 * map.txt (2026-10-23): the building's outline off a map, its corners in order round it as "(x, y)" in feet, x east and y
 * north - "(-34.5, -25.6)  (12.6, -40.1) ..." on one line or many. Everything else is words (where it came from, notes),
 * kept. Fewer than three corners: no outline, said back.
 */
export function parseMap(text) {
  const body = String(text ?? "").replace(/^﻿/, "");
  const corners = [...body.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  if (corners.length < 3) return { map: null, problem: body.trim() ? `map.txt: ${corners.length} corner${corners.length === 1 ? "" : "s"} read as (x, y) - an outline needs three at least.` : null };
  const source = /microsoft/i.test(body) ? "Microsoft's building footprints" : /open\s*street\s*map|osm\b/i.test(body) ? "OpenStreetMap" : "a map outline";
  const sd = /\bsd\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i.exec(body);
  return { map: { corners, source, ...(sd ? { sdFeet: Number(sd[1]) } : {}) }, problem: null };
}

/** 31.3333 -> 31'4"; 7.9167 -> 7'11". */
export function ftin(feet) {
  if (!Number.isFinite(feet)) return "?";
  const neg = feet < 0;
  const f = Math.abs(feet);
  let ft = Math.floor(f);
  let inch = Math.round((f - ft) * 12);
  if (inch === 12) {
    ft += 1;
    inch = 0;
  }
  return `${neg ? "-" : ""}${ft}'${inch}"`;
}

/** "C11" or 11 (1-based, as the sheets number them) -> outline index 10; null when it says no corner. */
export function cornerIndex(c, n) {
  const m = /^\s*C?\s*(\d+)\s*$/i.exec(String(c ?? ""));
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i >= 0 && (n === undefined || i < n) ? i : null;
}

/** "C5-C6" -> side index 4 (from corner 5 to 6); also "C5", 5 for the side starting there. */
export function sideIndex(s, n) {
  const m = /^\s*C?\s*(\d+)\s*(?:-\s*C?\s*(\d+))?\s*$/i.exec(String(s ?? ""));
  if (!m) return null;
  const i = Number(m[1]) - 1;
  if (!(i >= 0 && i < n)) return null;
  if (m[2] !== undefined && Number(m[2]) - 1 !== (i + 1) % n) return null;
  return i;
}

export const cornerName = (i) => `C${i + 1}`;
export const sideName = (i, n) => `C${i + 1}-C${((i + 1) % n) + 1}`;
