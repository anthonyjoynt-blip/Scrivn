/**
 * The sketch editor laid out for a finger: which tools sit on the bottom bar, which wait behind
 * More, and what counts as a phone in the first place.
 *
 * Listed here rather than inlined in the editor because the toolbar is now rendered TWICE — as the
 * desktop row it has always been, and on a phone as a bar of three with the rest in a sheet — and
 * the failure that matters is silent: a tool left out of both lists is simply unreachable on a
 * phone, and nothing else in the app would notice. One map of nodes keyed by these names, two
 * render sites, and `test/sketch/touch.mjs` proves the lists cover every tool exactly once.
 */

/** A tool on the sketch toolbar. Every name except the four below is also a `ToolMode`. */
export type SketchToolKey =
  | "select"
  | "room"
  | "stairs"
  | "scan"
  | "wall"
  | "pull"
  | "break"
  | "door"
  | "opening"
  | "window"
  | "cabinet"
  | "island"
  | "fixture"
  | "sizes";

/** Every sketch tool, in the order a phone's More sheet lists them. */
export const SKETCH_TOOL_KEYS: SketchToolKey[] = [
  "select",
  "wall",
  "door",
  "room",
  "pull",
  "break",
  "opening",
  "window",
  "cabinet",
  "island",
  "fixture",
  "stairs",
  "scan",
  "sizes",
];

/** The tools that place something by tapping the plan, drawn as one joined group on the desktop. */
export const SKETCH_PLACEMENT_KEYS: SketchToolKey[] = [
  "wall",
  "pull",
  "break",
  "door",
  "opening",
  "window",
  "cabinet",
  "island",
];

/**
 * What the bottom bar holds.
 *
 * Select, Wall, Door — the three that carry a walk-through, and the same shape as the companion's
 * chip bar on purpose, since the same estimator uses both in the same hour. Everything else is one
 * tap away in More rather than in a row that wraps to six lines over a sliver of drawing.
 */
export const SKETCH_BAR_KEYS: SketchToolKey[] = ["select", "wall", "door"];

/** The rest, in More. The complement of the bar, so nothing can be dropped by editing one list. */
export function sketchMoreKeys(): SketchToolKey[] {
  return SKETCH_TOOL_KEYS.filter((key) => !SKETCH_BAR_KEYS.includes(key));
}

/**
 * The desktop toolbar, unchanged: no Select button, because there a tool toggles back to selecting
 * and a fourteenth button earns nothing. Leading items, then the placement group, then these.
 */
export const SKETCH_DESKTOP_LEADING: SketchToolKey[] = ["room", "stairs", "scan"];
export const SKETCH_DESKTOP_TRAILING: SketchToolKey[] = ["fixture", "sizes"];

export type MoistureToolKey = "read" | "paint" | "erase" | "floor" | "ceiling" | "showMoisture";

/** The brush's surface is offered only with a brush in hand — see the editor's own note on why. */
export type MoistureTool = "read" | "paint" | "erase";

/**
 * The moisture tools, split for a phone.
 *
 * The surface follows the brush onto the bar rather than into More: with a brush in hand, floor
 * versus ceiling is the toggle pressed most, and burying it would cost two taps every time. With
 * no brush in hand it is in neither list, because a surface button that paints nothing reads as
 * broken rather than as inapplicable.
 */
export function moistureKeys(tool: MoistureTool): { bar: MoistureToolKey[]; more: MoistureToolKey[] } {
  const brush = tool === "paint" || tool === "erase";
  return {
    bar: brush ? ["read", "paint", "erase", "floor", "ceiling"] : ["read", "paint", "erase"],
    more: ["showMoisture"],
  };
}

/**
 * When the editor lays itself out for a finger.
 *
 * A media query, not a user-agent sniff: what decides this is how much room there is and whether
 * there is a mouse, both of which a query answers honestly and a sniff guesses at. The second half
 * catches the tablet in portrait, where there is width but no pointer, and stops at 900px — the
 * breakpoint where the two-column layout already gives up.
 */
export const PHONE_LAYOUT_QUERY = "(max-width: 760px), (pointer: coarse) and (max-width: 900px)";
