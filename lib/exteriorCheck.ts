/**
 * "Check these" (2026-10-16): after Measure on the photo route, only what a photo couldn't settle, one
 * tap each. On the owner's house the trace read the tall glass unit on the back wall, its foot hidden
 * by the deck railing, as French doors ("Its a window not a door"); and nothing measured how much lower
 * the garage's eave is than the house's, so it is drawn at an assumed 1'6".
 *
 *   * an opening whose photo hid part of it (`ExteriorOpening.hiddenBy`), or a door read off a photo up
 *     off the ground with no deck or porch at its foot: Window / Door / Garage door, as read until tapped;
 *   * a lower roof's drop when it is the assumed one (lib/roofCheck.ts `wingDrops`): typed with the roof
 *     check's own writer, `withWingDrop`.
 *
 * Never a block: "Looks right" closes the list, and whatever was not answered stays as read - and the
 * report's "To check" names it (`checkNotes`).
 */

import { type Exterior, type ExteriorOpening, type ExteriorOpeningKind, type ExteriorQuantities, type ExteriorSide, formatOpeningSize, groundAt, OPENING_LABEL, openingRect } from "./exterior";
import { withWingDrop } from "./roofCheck";
import { formatFeetInches } from "./sketch";

/** A door's sill more than this over the ground under it, with no deck or porch there, is asked: no one steps out of it. */
export const DOOR_OFF_GROUND_FEET = 2;

export type CheckRow =
  | {
      key: string;
      kind: "opening";
      sideId: string;
      openingId: string;
      /** "hidden": the photo hid part of it; "off_ground": a door up off the ground with nothing at its foot. */
      why: "hidden" | "off_ground";
      /** What the side calls it, and its size. */
      title: string;
      /** Why it is asked, in a line. */
      words: string;
      /** As read, until tapped. */
      openingKind: ExteriorOpeningKind;
    }
  | {
      key: string;
      kind: "drop";
      /** The lower roof's side, as `roof.wingDrops` keys it. */
      sideId: string;
      /** The drop it is drawn at: the assumed one. */
      feet: number;
      garage: boolean;
      title: string;
      question: string;
    };

const sideName = (s: ExteriorSide) => s.name.trim() || "Side";

/** Read off a photo, not tapped: the photos-only house's every opening, Finish's, and any a trace said was partly hidden. */
function offPhoto(exterior: Exterior, o: ExteriorOpening): boolean {
  return exterior.source?.by === "photos" || exterior.source?.kind === "photos" || o.from === "photo" || !!o.hiddenBy;
}

/** Whether a deck or porch stands at the opening's foot: its wall is one the roof carries over a deck, or a porch roof covers it. */
function deckAtFoot(exterior: Exterior, q: ExteriorQuantities, side: ExteriorSide, o: ExteriorOpening): boolean {
  if ((q.roof?.notches ?? []).some((k) => k.covered && k.sideIds.includes(side.id))) return true;
  const mid = o.fromLeftFeet + o.widthFeet / 2;
  return (exterior.roof.additions ?? []).some((a) => a.kind === "porch" && a.sideId === side.id && mid >= a.fromFeet && mid <= a.toFeet);
}

/** How far its sill is over the ground under it. */
function aboveGround(side: ExteriorSide, o: ExteriorOpening): number {
  const r = openingRect(side, o);
  return r.y0 - groundAt(side, (r.x0 + r.x1) / 2);
}

/**
 * Every row there is to check, closed or not: the openings in the sides' order, then the drops. An opening
 * the estimator said is, and a drop typed or measured, is not one.
 */
export function exteriorChecks(exterior: Exterior, q: ExteriorQuantities): CheckRow[] {
  const rows: CheckRow[] = [];
  for (const side of exterior.sides) {
    for (const o of side.openings) {
      if (o.confirmed || !offPhoto(exterior, o)) continue;
      const title = `${sideName(side)}: ${OPENING_LABEL[o.kind].toLowerCase()} ${formatOpeningSize(o.widthFeet, o.heightFeet)}`;
      const base = { key: `opening:${o.id}`, kind: "opening" as const, sideId: side.id, openingId: o.id, title, openingKind: o.kind };
      if (o.hiddenBy) {
        rows.push({ ...base, why: "hidden", words: `Part of it is hidden in the photo (${o.hiddenBy}).` });
        continue;
      }
      if (o.kind === "window") continue;
      const up = aboveGround(side, o);
      if (up > DOOR_OFF_GROUND_FEET && !deckAtFoot(exterior, q, side, o)) {
        rows.push({ ...base, why: "off_ground", words: `${formatFeetInches(up)} up off the ground, with no step or deck seen at its foot.` });
      }
    }
  }
  for (const [sideId, d] of Object.entries(q.wingDrops)) {
    if (d.source !== "assumed") continue;
    const side = exterior.sides.find((s) => s.id === sideId);
    const garage = !!side?.openings.some((o) => o.kind === "garage");
    rows.push({
      key: `drop:${sideId}`,
      kind: "drop",
      sideId,
      feet: d.feet,
      garage,
      title: garage ? "The garage's roof" : `The roof over ${side ? sideName(side) : "a lower part"}`,
      question: garage ? "How much lower is the garage's eave than the house's?" : `How much lower is the roof over ${side ? sideName(side) : "it"} than the one it meets?`,
    });
  }
  return rows;
}

/** The rows still to show: those "Looks right" has not closed. */
export function openChecks(exterior: Exterior, q: ExteriorQuantities): CheckRow[] {
  const closed = new Set(exterior.photoRoute?.checksClosed ?? []);
  return exteriorChecks(exterior, q).filter((r) => !closed.has(r.key));
}

/** An opening's kind as the estimator tapped it: said, so no longer asked. */
export function withOpeningKind(exterior: Exterior, sideId: string, openingId: string, kind: ExteriorOpeningKind): Exterior {
  return {
    ...exterior,
    sides: exterior.sides.map((s) => (s.id !== sideId ? s : { ...s, openings: s.openings.map((o) => (o.id === openingId ? { ...o, kind, confirmed: true as const } : o)) })),
  };
}

/** A lower roof's drop typed on "Check these": the roof check's own writer. Null goes back to measured or assumed. */
export function withCheckDrop(exterior: Exterior, sideId: string, feet: number | null): Exterior {
  return { ...exterior, roof: withWingDrop(exterior.roof, sideId, feet) };
}

/** "Looks right": the rows shown are closed. What was not answered stays as read, and on the report's "To check". */
export function withChecksClosed(exterior: Exterior, keys: string[]): Exterior {
  if (!exterior.photoRoute) return exterior;
  const closed = [...new Set([...(exterior.photoRoute.checksClosed ?? []), ...keys])];
  return { ...exterior, photoRoute: { ...exterior.photoRoute, checksClosed: closed } };
}

/** The report's "To check": what was assumed and not answered, closed or not. */
export function checkNotes(exterior: Exterior, q: ExteriorQuantities): string[] {
  // A roof cut at a party line over a shared wall (2026-10-17): its firewall cap and flashing are not measured.
  const party = (q.roof?.lines ?? []).some((l) => l.kind === "party") ? ["Check the firewall cap and flashing at the party line."] : [];
  return [...party, ...exteriorChecks(exterior, q).map((r) => {
    if (r.kind === "drop") {
      return r.garage
        ? `The garage's eave is drawn ${formatFeetInches(r.feet)} under the house's: assumed, as nothing measured it. Measure how much lower it is.`
        : `${r.title}: its eave is drawn ${formatFeetInches(r.feet)} under the roof it meets: assumed, as nothing measured it. Measure how much lower it is.`;
    }
    const side = exterior.sides.find((s) => s.id === r.sideId) as ExteriorSide;
    const o = side.openings.find((x) => x.id === r.openingId) as ExteriorOpening;
    const what = OPENING_LABEL[o.kind].toLowerCase();
    const said = r.why === "hidden" ? `read off a photo that hid part of it (${o.hiddenBy})` : `${formatFeetInches(aboveGround(side, o))} up off the ground with no step or deck seen at its foot`;
    return `${sideName(side)}: a ${what} ${formatOpeningSize(o.widthFeet, o.heightFeet)}, ${said}. Check it is a ${what}.`;
  })];
}
