/**
 * The drying equipment's symbols, as Scrivn Scan draws them (2026-10-12, the owner: "lets just get some better looking symbols
 * for air movers and dehus", then "yes match the symbols"). One definition, as SVG path data, for every place Scrivn draws
 * them: the claim sketch (Konva's Path reads the same data), the equipment panel's key, and the drying calculator's plan and
 * legend - so the phone, the sketch and the calculator show the same two things.
 *
 * Units: the air mover's housing has a radius of 10, its nose along +x (turned by a spot's heading, it points the way the air
 * leaves); the spot is the housing's middle. The dehumidifier is a 23 x 17 box about its middle, turned the way the plan
 * stands it; its water drop stays upright. Scale to taste where drawn.
 */

export const MOVER_COLOR = "#EA580C";
export const MOVER_AIR_COLOR = "rgba(234, 88, 12, 0.55)";
export const DEHU_COLOR = "#0F766E";
/** The white edge round each symbol, so it reads over the plan and the moisture paint alike. */
export const GLYPH_EDGE = "#ffffff";

/**
 * An air mover seen from above: a round housing with a fan swirl in it, its mouth flaring the way the air leaves (set to one
 * side, as a blower's is), and three strokes of air ahead of the mouth.
 */
export const MOVER_GLYPH = {
  /** Three short strokes ahead of the mouth: stroke [MOVER_AIR_COLOR], round caps, width 2.2. */
  air: "M 21.76 -4.2 L 28.92 -5.25 M 20.5 0 L 28.5 0 M 21.76 4.2 L 28.92 5.25",
  /** The mouth: fill [MOVER_COLOR], edge [GLYPH_EDGE] width 1.6. */
  mouth: "M 0 -5 L 15.5 -7.6 L 15.5 12 L 0 9.4 Z",
  /** The housing, over the mouth's root: a circle of this radius at the spot, filled and edged as the mouth. */
  housingR: 10,
  /** The fan swirl inside it: stroke [GLYPH_EDGE] width 2, round caps. */
  swirl: "M 4.126 2.825 A 5 5 0 1 1 2.145 -4.517",
  /** The hub: a white dot of this radius. */
  hubR: 1.7,
  /** How far the symbol reaches from the spot: back of the housing to the end of the air, and either side. */
  extent: { back: 10, front: 29, side: 12 },
} as const;

/** A dehumidifier: a rounded box, a white water drop in it. */
export const DEHU_GLYPH = {
  w: 23,
  h: 17,
  rx: 3.5,
  /** The drop, about the box's middle, upright: fill white. */
  drop: "M 0 -6.51 C 0.93 -3.72 3.844 -0.31 3.844 1.736 A 3.844 3.844 0 0 1 -3.844 1.736 C -3.844 -0.31 -0.93 -3.72 0 -6.51 Z",
} as const;
