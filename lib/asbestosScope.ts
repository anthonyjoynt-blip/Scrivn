import type { ClaimInfo } from "./claimInfo";
import { buildScopeDocumentHeaderLines } from "./claimInfo";
import type { SketchRoom } from "./sketch";
import { WALLS_PER_ROOM, containedLabel, surfaceLabel, SURFACE_LABEL } from "./containment";
import {
  type AsbestosCalculations,
  type AsbestosScope,
  ASBESTOS_TYPE_LABEL,
  DECON_CHAMBER_LABEL,
  HEPA_FILTER_HOURS,
  asbestosCalculations,
  hasAsbestosContent,
  resolveSampleCount,
} from "./asbestos";

/**
 * The Asbestos Abatement section of the scope document, rendered straight from the numbers.
 *
 * No API call, for the same reason `buildContentsScopeSection` has none: every figure here is
 * either typed by the PM or arithmetic on what they typed, and a quantity that goes to an adjuster
 * should be reproducible rather than generated.
 *
 * Sections with nothing in them are omitted entirely rather than printed empty — a scope that says
 * "Equipment" and then nothing reads as an oversight.
 */

function round(value: number, places = 1): string {
  const factor = 10 ** places;
  return String(Math.round(value * factor) / factor);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * A fee line, or the same line marked as an open item.
 *
 * A blank fee is NOT dropped. These are third-party attendances that are routinely unpriced when
 * the scope is written, and a line that vanishes because nobody had the number yet is a line
 * nobody remembers to add later — it has to be on the document, visibly waiting.
 */
function feeLine(label: string, amount: number | null): string {
  return amount === null ? `    - ${label} – TBD (open item, to be confirmed)` : `    - ${label} – ${money(amount)}`;
}

/**
 * `sampleCount` is the CLAIM's figure — the one the water-loss gap-check pair records.
 *
 * It is a starting point, not the answer: the form has its own field and it wins where both exist
 * (see `resolveSampleCount`). Reading the claim's alone was wrong for the case this feature exists
 * to serve — a standalone abatement assignment never runs the pipeline that fills it in, so there
 * was nothing to read and no way to say how many samples had been taken.
 */
export interface AsbestosScopeContext {
  sampleCount: number | null;
  sketchRoom: SketchRoom | null;
  roomName: string | null;
}

export function buildAsbestosScopeSection(scope: AsbestosScope, context: AsbestosScopeContext): string {
  if (!hasAsbestosContent(scope)) return "";
  const calc = asbestosCalculations(scope, context.sketchRoom);
  const lines: string[] = ["Asbestos Abatement"];

  lines.push(...classificationLines(scope, calc, context));
  lines.push(...containmentLines(calc));
  lines.push(...removalLines(scope, calc));
  lines.push(...deconLines(scope, calc));
  lines.push(...equipmentLines(calc));
  lines.push(...testingLines(scope, context));

  if (scope.notes.trim() !== "") {
    lines.push("  Notes");
    for (const note of scope.notes.split("\n").map((n) => n.trim()).filter(Boolean)) {
      lines.push(`    - ${note}`);
    }
  }

  /*
    Fees last, and always present.

    These are the two hygienist attendances, and they are the ONLY place either is named as a thing
    somebody does. Containment and Testing carry the crew's side of each — a hold point before
    removal starts and another before the sheeting comes down — deliberately worded as obligations
    rather than as the inspections themselves, because naming the inspection in both places made the
    document read as though it had been written twice.
  */
  lines.push("  General Fees");
  // Each leads with what distinguishes it. Both leading "Hygienist attendance" made a two-line list
  // read as one line printed twice, which is the same complaint in miniature.
  lines.push(feeLine("Pre-abatement containment/hoarding inspection by hygienist", calc.preAbatementFee));
  lines.push(feeLine("Post-abatement air clearance testing by hygienist", calc.postAbatementFee));

  // Only the heading made it in.
  if (lines.length === 1) return "";
  return lines.join("\n");
}

function classificationLines(scope: AsbestosScope, calc: AsbestosCalculations, context: AsbestosScopeContext): string[] {
  const lines: string[] = ["  Classification"];
  const where = context.roomName?.trim() ? ` — ${context.roomName.trim()}` : "";
  if (scope.material.trim() !== "") {
    lines.push(`    - Material: ${scope.material.trim()} on the ${SURFACE_LABEL[scope.surface].toLowerCase()}${where}`);
  }
  lines.push(`    - ${ASBESTOS_TYPE_LABEL[calc.type]} (${scope.friable ? "friable" : "non-friable"})`);
  lines.push(`    - ${calc.typeReason}`);
  /*
    An override is stated, not silently applied. A Type that disagrees with the two facts recorded
    beside it needs to look deliberate on the page, or the next person reading it assumes a bug.
  */
  if (calc.typeIsOverridden) {
    lines.push(`    - Classified as ${ASBESTOS_TYPE_LABEL[calc.type]} by the project manager, overriding the derived ${ASBESTOS_TYPE_LABEL[calc.derivedType]}.`);
  }
  if (calc.areaSqM !== null) {
    lines.push(`    - Area disturbed – ${round(Number(scope.areaDisturbedSqFt))} SF (${round(calc.areaSqM, 2)} m²)`);
  }
  if (calc.geometry) {
    const g = calc.geometry;
    const measured = g.source === "sketch" ? " (from the sketch)" : "";
    lines.push(`    - Room – ${round(g.lengthFt)}' x ${round(g.widthFt)}' x ${round(g.heightFt)}' high${measured}`);
    lines.push(`    - Volume – ${round(g.cubicFt)} CF; walls ${round(g.wallSqFt)} SF, ceiling ${round(g.ceilingSqFt)} SF, floor ${round(g.floorSqFt)} SF`);
  }
  return lines;
}

function containmentLines(calc: AsbestosCalculations): string[] {
  const lines: string[] = ["  Containment"];
  const plan = calc.containment;

  if (plan.level === "entry") {
    lines.push("    - Seal entry/doorway with poly and tape — no full surface containment at this Type");
    return lines;
  }

  lines.push(`    - Full containment – ${plan.notation} – ${containedLabel(plan.contained)}`);
  for (const item of plan.contained) {
    lines.push(`    - Poly sheeting and seal – ${surfaceLabel(item)}`);
  }
  lines.push(`    - The ${SURFACE_LABEL[plan.removed].toLowerCase()} is the removal zone and is not contained`);
  // A derived wall count says so, so nobody mistakes it for a figure somebody measured.
  if (plan.removed === "wall" && calc.wallRemovalSqFt !== null) {
    const basis = calc.wallsRemovedIsOverridden ? "as stated" : "reckoned from the room's wall area";
    lines.push(
      `    - ${round(calc.wallRemovalSqFt)} SF of wall being removed, spanning ${plan.wallsRemoved} of ${WALLS_PER_ROOM} walls (${basis})`,
    );
  }
  /*
    A HOLD POINT, not an inspection line.

    This said "Pre-abatement inspection – verify containment integrity and negative air", which is
    the same noun the General Fees section uses for the hygienist's charge — so the document named
    the same thing twice and read as a bug. The crew's obligation is to stop and wait; the
    inspection itself is somebody else's attendance and is billed at the end. Splitting it that way
    is what makes the two lines say different things.
  */
  lines.push("    - Do not begin removal until containment integrity and negative air have been verified");
  return lines;
}

function removalLines(scope: AsbestosScope, calc: AsbestosCalculations): string[] {
  const lines: string[] = ["  Removal & Cleaning"];
  if (scope.material.trim() !== "") {
    lines.push(`    - Remove ${scope.material.trim()} from the ${SURFACE_LABEL[scope.surface].toLowerCase()}`);
  }

  for (const item of calc.hepaVac.detailed) {
    lines.push(`    - HEPA-vacuum, detailed – ${surfaceLabel(item)} – removal zone substrate`);
  }
  /*
    The light pass exists only where something was sealed. At entry-only containment there is
    nothing that was covered-but-undisturbed, so no line — an absence, not an omission.
  */
  if (calc.hepaVac.light.length > 0) {
    lines.push(`    - HEPA-vacuum, light – ${containedLabel(calc.hepaVac.light)} – contained but not directly disturbed, before containment comes down`);
  }
  return lines;
}

function deconLines(scope: AsbestosScope, calc: AsbestosCalculations): string[] {
  const lines: string[] = ["  Decontamination & PPE"];
  lines.push(`    - Decontamination chamber – ${DECON_CHAMBER_LABEL[calc.deconChamber]}`);

  const changes = Number.parseFloat(scope.ppeChanges);
  if (Number.isFinite(changes) && changes > 0) {
    lines.push(`    - PPE changes – ${round(changes)}`);
  }
  if (scope.respirator.trim() !== "") lines.push(`    - Respiratory protection – ${scope.respirator.trim()}`);
  if (scope.suit.trim() !== "") lines.push(`    - Protective clothing – ${scope.suit.trim()}`);

  if (calc.labourHours !== null) {
    lines.push(`    - Labour – ${round(calc.labourHours)} hrs (${round(Number(scope.crewSize))} crew x ${round(calc.jobHours ?? 0)} hrs)`);
  }
  return lines;
}

function equipmentLines(calc: AsbestosCalculations): string[] {
  const lines: string[] = ["  Equipment"];
  let any = false;

  if (calc.negativeAir) {
    const na = calc.negativeAir;
    any = true;
    lines.push(
      `    - Negative air machine, ${na.band.label} – ${na.units} unit${na.units === 1 ? "" : "s"} – ` +
        `${round(na.required)} CFM required (${round(na.cubicFeet)} CF x ${round(na.airChangesPerHour)} ACH ÷ 60)`,
    );
    /*
      The alternative is noted, not applied. A PM who left the size on the default should see that
      one bigger machine would do the work of three, but the scope states what was actually chosen —
      a document that quietly substituted a recommendation for a selection would be untrustworthy.
    */
    if (na.suggestion) {
      lines.push(
        `    - Alternative – ${na.suggestion.units} x ${na.suggestion.band.label} would cover the same ${round(na.required)} CFM`,
      );
    }
  }

  if (calc.ductingLinearFeet !== null) {
    any = true;
    lines.push(`    - Flexible exhaust ducting – ${round(calc.ductingLinearFeet)} LF`);
  }

  if (calc.filterUsage) {
    const f = calc.filterUsage;
    any = true;
    lines.push(
      `    - HEPA filter – ${round(f.filters, 2)} filter${f.filters === 1 ? "" : "s"} (${round(f.jobHours)} job hrs ÷ ${HEPA_FILTER_HOURS})`,
    );
  }

  if (calc.equipmentUnits > 0) {
    any = true;
    lines.push(`    - Equipment decontamination – ${calc.equipmentUnits} unit${calc.equipmentUnits === 1 ? "" : "s"}`);
  }

  return any ? lines : [];
}

function testingLines(scope: AsbestosScope, context: AsbestosScopeContext): string[] {
  const lines: string[] = ["  Testing"];
  /*
    Read from the claim's existing asbestos sampling field rather than asked again here — see
    `AsbestosScopeContext`. When it is unset the line is omitted rather than printed as zero, which
    would assert that no samples were taken when the truth is that nobody said.
  */
  const samples = resolveSampleCount(scope, context.sampleCount);
  if (samples !== null && samples > 0) {
    lines.push(`    - Asbestos samples – ${round(samples)}`);
  }
  // The crew's obligation, for the reason given at the containment hold point above. The clearance
  // testing itself is the hygienist's, and is a fee.
  lines.push("    - Containment stays up until clearance results pass");
  return lines;
}

/**
 * A complete scope document for an abatement-only assignment — the same shape as
 * `buildContentsOnlyScopeDocument`, and for the same reason: nothing in this path needs a
 * transcript, so nothing in it calls Claude.
 */
export function buildAsbestosOnlyScopeDocument(claim: ClaimInfo, scope: AsbestosScope, context: AsbestosScopeContext): string {
  const header = buildScopeDocumentHeaderLines(claim).join("\n");
  const section = buildAsbestosScopeSection(scope, context);
  return section === "" ? header : `${header}\n\n${section}`;
}
