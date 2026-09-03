/**
 * What gets sealed, and what gets HEPA-vacuumed, for a hazard removal — the W/F/C notation.
 *
 * Deliberately knows nothing about asbestos. Containment is decided by two things: how much fibre
 * or spore release the work risks, and which surface is being taken out. Both of those are stated
 * here as hazard-neutral inputs, so the same table serves mould's Condition 1/2/3 once that lands —
 * `lib/asbestos.ts` maps Type 1/2/3 onto `ContainmentLevel` and nothing else here changes.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────────────────────
 * At full containment you seal every surface EXCEPT the one you are removing, because the removed
 * surface is the work face — sealing it would be sealing the thing you came to take out.
 *
 *   removing the ceiling  →  contain Walls + Floor
 *   removing the floor    →  contain Walls + Ceiling
 *   removing wall(s)      →  contain Floor + Ceiling + whatever walls are NOT coming out
 *
 * That last line is why walls carry a count. A room has four of them and a job rarely takes all
 * four, so "contain the walls" is only true of the ones staying — writing this as a flat set of
 * three surfaces would have told a crew to seal a wall they were about to demolish.
 *
 * At entry-only containment there is no surface work at all: the doorway is sealed and that is the
 * extent of it.
 */

export type Surface = "wall" | "floor" | "ceiling";

export const SURFACE_LABEL: Record<Surface, string> = {
  wall: "Wall",
  floor: "Floor",
  ceiling: "Ceiling",
};

/** The shorthand a PM writes on a job sheet. */
export const SURFACE_CODE: Record<Surface, string> = {
  wall: "W",
  floor: "F",
  ceiling: "C",
};

export const SURFACES: Surface[] = ["wall", "floor", "ceiling"];

/**
 * How much containment the work calls for, stated without naming a hazard.
 *
 * `full` is asbestos Type 3 and will be mould Condition 3; `entry` is asbestos Type 1 and 2. A
 * third level is likely once mould arrives — the point of the name is that adding one means adding
 * a case here rather than rewriting every caller.
 */
export type ContainmentLevel = "full" | "entry";

export const CONTAINMENT_LEVEL_LABEL: Record<ContainmentLevel, string> = {
  full: "Full containment",
  entry: "Entry/doorway seal only",
};

/** A room's four walls, unless something says otherwise. */
export const WALLS_PER_ROOM = 4;

export interface ContainedSurface {
  surface: Surface;
  /** Walls only: how many of the room's walls this covers. Floor and ceiling are always 1. */
  count: number;
}

export interface ContainmentPlan {
  level: ContainmentLevel;
  /** The surface the material is coming off — never contained, it is the work face. */
  removed: Surface;
  /** How many walls are being removed. 0 unless `removed` is "wall". */
  wallsRemoved: number;
  /** What to seal, in W/F/C order. Empty at entry-only containment. */
  contained: ContainedSurface[];
  /** "W/F", "F/C", "F/C + 3 W" — or "Entry only". */
  notation: string;
}

/**
 * What to contain, given how risky the work is and which surface is coming out.
 *
 * `wallsRemoved` is ignored unless the removed surface is a wall, and is clamped to the room's wall
 * count: a job cannot take out five of four walls, and letting it would produce a negative number
 * of remaining walls to contain.
 */
export function containmentPlan(
  level: ContainmentLevel,
  removed: Surface,
  wallsRemoved = 1,
  wallsPerRoom = WALLS_PER_ROOM,
): ContainmentPlan {
  const removedWalls = removed === "wall" ? Math.min(Math.max(1, Math.round(wallsRemoved)), wallsPerRoom) : 0;

  if (level === "entry") {
    return { level, removed, wallsRemoved: removedWalls, contained: [], notation: "Entry only" };
  }

  const contained: ContainedSurface[] = [];
  const remainingWalls = wallsPerRoom - removedWalls;
  // W/F/C order throughout, so the notation reads the same way on every job sheet.
  if (removed !== "wall") contained.push({ surface: "wall", count: wallsPerRoom });
  else if (remainingWalls > 0) contained.push({ surface: "wall", count: remainingWalls });
  if (removed !== "floor") contained.push({ surface: "floor", count: 1 });
  if (removed !== "ceiling") contained.push({ surface: "ceiling", count: 1 });

  return { level, removed, wallsRemoved: removedWalls, contained, notation: notationFor(contained, wallsPerRoom) };
}

/**
 * "W/F" when the walls are all in, "F/C + 3 W" when only some are.
 *
 * The partial case is spelled out rather than written "W/F/C", because a crew reading W would seal
 * four walls when three was the answer.
 */
function notationFor(contained: ContainedSurface[], wallsPerRoom: number): string {
  if (contained.length === 0) return "Entry only";
  const partialWalls = contained.find((c) => c.surface === "wall" && c.count < wallsPerRoom);
  const codes = contained
    .filter((c) => c !== partialWalls)
    .map((c) => SURFACE_CODE[c.surface])
    .join("/");
  if (!partialWalls) return codes;
  return codes === "" ? `${partialWalls.count} W` : `${codes} + ${partialWalls.count} W`;
}

/**
 * The two HEPA-vacuum passes, which follow the same notation.
 *
 * `detailed` is the removal zone — the exposed substrate the material came off, which is where the
 * debris actually is. `light` is everything that was sealed but never directly disturbed: it gets a
 * pass before the containment comes down, so nothing is released when the sheeting is pulled.
 *
 * At entry-only containment there is nothing in the light pass, because nothing was sealed. That is
 * a real "no line on the scope", not an oversight.
 */
export interface HepaVacPlan {
  detailed: ContainedSurface[];
  light: ContainedSurface[];
}

export function hepaVacPlan(plan: ContainmentPlan, wallsPerRoom = WALLS_PER_ROOM): HepaVacPlan {
  const detailedCount = plan.removed === "wall" ? Math.min(plan.wallsRemoved, wallsPerRoom) : 1;
  return {
    detailed: [{ surface: plan.removed, count: detailedCount }],
    light: plan.contained,
  };
}

/** "3 walls", "Ceiling" — how a surface and its count read in a scope line. */
export function surfaceLabel(item: ContainedSurface): string {
  if (item.surface !== "wall") return SURFACE_LABEL[item.surface];
  return item.count === 1 ? "1 wall" : `${item.count} walls`;
}

/** "Walls, Floor" — a contained set, spelled out for a scope line rather than as codes. */
export function containedLabel(contained: ContainedSurface[], wallsPerRoom = WALLS_PER_ROOM): string {
  return contained
    .map((c) => (c.surface === "wall" && c.count === wallsPerRoom ? "Walls" : surfaceLabel(c)))
    .join(", ");
}
