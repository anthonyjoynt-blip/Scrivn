/**
 * A source rule: a room's name is drawn in the label pass after every room, never inside `RoomShape`.
 *
 * ── Why this is static and not a runtime test ────────────────────────────────────────────────
 * The bug this guards was an ORDER: the name was drawn inside each room before that room's symbols
 * and cabinets, and before every room drawn later, so a 5' x 8' bathroom's name sat under its tub
 * and a hall's under its door swing. Konva paints in tree order, so the fix is entirely where the
 * name is rendered in the JSX — and so is any regression. Someone tidying `RoomShape` and putting
 * the name back beside the wall labels, where it looks like it belongs, reintroduces the bug without
 * touching a single number a geometry test could catch, and the browser suite would need a
 * pixel-reading check to see it. The order is syntactic, so check it syntactically.
 *
 * Four facts, each a plain search of the source:
 *   - `RoomShape` renders no Text whose text is the room's name.
 *   - `RoomLabel` exists and is what does.
 *   - In the canvas's JSX, `<RoomLabel` comes after `<RoomShape`.
 *   - And in a map of its OWN: the rooms map has closed before the labels open theirs. "After" on
 *     its own is not enough — a `<RoomLabel>` placed right under `<RoomShape>` inside the same
 *     `rooms.map(` is textually after it and paints under every later room all the same, which is
 *     the original bug back with a nicer name.
 */

import { readFileSync } from "node:fs";

/** The body of a top-level `function Name(` — from its first line to the next top-level function. */
function functionSpan(source, name) {
  const start = source.indexOf(`\nfunction ${name}(`);
  if (start === -1) return null;
  const rest = source.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:default )?function [\w$]+\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/** Every reason the file breaks the rule, as `path:line  message`. Empty when it holds. */
export function checkLabelPass(path) {
  const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const problems = [];

  const shape = functionSpan(source, "RoomShape");
  if (!shape) {
    problems.push(`${path}  RoomShape is not a top-level function any more; this rule needs updating`);
  } else {
    const nameText = shape.search(/text=\{\s*(?:room\.name|name)\b/);
    if (nameText !== -1) {
      const at = source.indexOf(shape) + nameText;
      problems.push(`${path}:${lineOf(source, at)}  RoomShape draws the room's name — it belongs in the label pass (RoomLabel)`);
    }
  }

  const label = functionSpan(source, "RoomLabel");
  if (!label) {
    problems.push(`${path}  no RoomLabel — the room's name has no label pass to be drawn in`);
  } else if (!/text=\{\s*(?:room\.name|name)\b/.test(label)) {
    problems.push(`${path}  RoomLabel does not draw the room's name`);
  }

  const shapeAt = source.indexOf("<RoomShape");
  const labelAt = source.indexOf("<RoomLabel");
  if (shapeAt === -1) problems.push(`${path}  <RoomShape> is never rendered`);
  if (labelAt === -1) problems.push(`${path}  <RoomLabel> is never rendered`);
  if (shapeAt !== -1 && labelAt !== -1 && labelAt < shapeAt) {
    problems.push(`${path}:${lineOf(source, labelAt)}  <RoomLabel> is rendered before <RoomShape> — it must come after the rooms map, or the rooms paint over the names`);
  } else if (shapeAt !== -1 && labelAt !== -1) {
    // Between the two tags the rooms map must close (`))}` ends a `{rooms.map((room) => (...))}`)
    // and a fresh `rooms.map(` must open for the labels — otherwise the label is inside the rooms map.
    const between = source.slice(shapeAt, labelAt);
    const mapClosed = between.indexOf("))}");
    const ownMap = between.lastIndexOf("rooms.map(");
    if (mapClosed === -1 || ownMap === -1 || ownMap < mapClosed) {
      problems.push(
        `${path}:${lineOf(source, labelAt)}  <RoomLabel> is rendered inside the rooms map, beside its own <RoomShape> — the label pass must be a separate rooms.map() after the rooms map closes, or every later room paints over the name`,
      );
    }
  }

  return problems;
}
