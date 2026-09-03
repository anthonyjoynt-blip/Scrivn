/**
 * Asbestos abatement calculations, checked in Node.
 *
 *   npm run test:asbestos
 *
 * No browser here, unlike the sketch suite: every one of these is a pure function of its inputs,
 * which is the entire reason this feature has no API call behind it. A quantity a PM defends to an
 * adjuster has to come out the same way every time, and that is exactly what a test can pin down.
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "asbestos-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});

const mod = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

const {
  deriveAsbestosType,
  containmentPlan,
  hepaVacPlan,
  containedLabel,
  defaultDeconChamber,
  emptyAsbestosScope,
  asbestosCalculations,
  buildAsbestosScopeSection,
  filterUsage,
  suggestNegativeAirSize,
  NEGATIVE_AIR_SIZES,
  negativeAir,
  jobHours,
  sqFtToSqM,
  roomGeometry,
  wallsRemovedFrom,
  resolveSampleCount,
} = mod;

/* ── Classification, per O. Reg. 278/05 ────────────────────────────────────────────────────────── */

check(deriveAsbestosType({ friable: true, areaSqM: 2, minimalDisturbance: false }) === 3, "friable over 1 m² is Type 3");
check(deriveAsbestosType({ friable: true, areaSqM: 0.5, minimalDisturbance: true }) === 2, "friable under 1 m² is Type 2, not Type 1");
check(
  deriveAsbestosType({ friable: false, areaSqM: 0.2, minimalDisturbance: true }) === 1,
  "non-friable with minimal disturbance is Type 1",
);
check(
  deriveAsbestosType({ friable: false, areaSqM: 0.2, minimalDisturbance: false }) === 2,
  "non-friable but dusty is Type 2 — area alone does not decide it",
);
check(
  deriveAsbestosType({ friable: false, areaSqM: 500, minimalDisturbance: true }) === 1,
  "a large NON-friable area stays Type 1: the 1 m² threshold is a friable test",
);
// Exactly at the threshold is not "over" it.
check(deriveAsbestosType({ friable: true, areaSqM: 1, minimalDisturbance: false }) === 2, "friable at exactly 1 m² is not yet Type 3");

check(near(sqFtToSqM(10.7639), 1), "10.76 sq ft is one square metre");

/* ── Containment: the surface being removed is never contained ─────────────────────────────────── */

const ceiling = containmentPlan("full", "ceiling");
check(containedLabel(ceiling.contained) === "Walls, Floor", `removing the ceiling contains W+F (got "${containedLabel(ceiling.contained)}")`);
check(ceiling.notation === "W/F", `notation W/F (got ${ceiling.notation})`);
check(!ceiling.contained.some((c) => c.surface === "ceiling"), "and never the ceiling itself");

const floor = containmentPlan("full", "floor");
check(containedLabel(floor.contained) === "Walls, Ceiling", `removing the floor contains W+C (got "${containedLabel(floor.contained)}")`);
check(floor.notation === "W/C", `notation W/C (got ${floor.notation})`);

/*
  The wall case is the one a flat three-surface model gets wrong: the walls that are NOT being
  removed still need containing, so "contain the walls" has to carry a count.
*/
const oneWall = containmentPlan("full", "wall", 1);
check(containedLabel(oneWall.contained) === "3 walls, Floor, Ceiling", `removing 1 of 4 walls contains the other 3 + F + C (got "${containedLabel(oneWall.contained)}")`);
check(oneWall.notation === "F/C + 3 W", `notation names the partial walls (got ${oneWall.notation})`);

const allWalls = containmentPlan("full", "wall", 4);
check(containedLabel(allWalls.contained) === "Floor, Ceiling", "removing all four walls leaves only F + C to contain");
check(!allWalls.contained.some((c) => c.surface === "wall"), "and no walls at all — none are left");

check(containmentPlan("full", "wall", 9).wallsRemoved === 4, "a job cannot remove more walls than the room has");

const entry = containmentPlan("entry", "ceiling");
check(entry.contained.length === 0, "entry-only containment seals no surfaces");
check(entry.notation === "Entry only", "and says so");

/* ── HEPA-vac follows the same notation ────────────────────────────────────────────────────────── */

const vac = hepaVacPlan(ceiling);
check(vac.detailed.length === 1 && vac.detailed[0].surface === "ceiling", "the detailed pass is the removal zone");
check(containedLabel(vac.light) === "Walls, Floor", "the light pass is everything that was contained but not disturbed");
check(hepaVacPlan(entry).light.length === 0, "entry-only containment has no light pass — nothing was covered");

/* ── Decon defaults ────────────────────────────────────────────────────────────────────────────── */

check(defaultDeconChamber(3) === "three_stage", "Type 3 defaults to the three-stage system");
check(defaultDeconChamber(2) === "single_stage" && defaultDeconChamber(1) === "single_stage", "Type 1 and 2 default to a single chamber");

/* ── Equipment arithmetic ──────────────────────────────────────────────────────────────────────── */

// 8000 CF at 4 ACH = 533.3 CFM, which one 699 CFM unit covers.
const air = negativeAir(8000, 4, null);
check(near(air.required, 533.33, 0.01), `4 ACH of 8000 CF is 533 CFM (got ${air.required.toFixed(2)})`);
check(air.size === "small", "and defaults to the small unit");
check(air.units === 1, `which one of covers (got ${air.units})`);
check(!air.sizeIsChosen, "with the size still on the default, not chosen");
check(air.suggestion === null, "and nothing to suggest — one machine is one machine");

// 30000 CF at 4 ACH = 2000 CFM: three small units, or two of the 800-1399 band.
const big = negativeAir(30000, 4, null);
check(near(big.required, 2000), `4 ACH of 30000 CF is 2000 CFM (got ${big.required})`);
check(big.units === 3, `three small units cover it (got ${big.units})`);
check(big.suggestion !== null, "and a larger size is suggested, because three machines is worth a second look");
/*
  At 2000 CFM the 800-1399 band also needs three units, so it is no improvement and is skipped —
  the suggestion has to be the smallest size that actually reduces the count, not simply the next
  one up the list.
*/
check(big.suggestion && big.suggestion.size === "large", `skipping a band that does not help (got ${big.suggestion && big.suggestion.size})`);
check(big.suggestion && big.suggestion.units === 2, `down to 2 units (got ${big.suggestion && big.suggestion.units})`);

// 22500 CF at 4 ACH = 1500 CFM: small needs 3, medium needs 2, large needs 2. The smallest that
// improves is medium, which is what proves this is "smallest that helps" and not "biggest".
const mid = negativeAir(22500, 4, null);
check(near(mid.required, 1500), `4 ACH of 22500 CF is 1500 CFM (got ${mid.required})`);
check(mid.units === 3, `three small units (got ${mid.units})`);
check(mid.suggestion && mid.suggestion.size === "medium", `suggests the 800-1399 band, not the biggest one (got ${mid.suggestion && mid.suggestion.size})`);
check(mid.suggestion && mid.suggestion.units === 2, `at 2 units (got ${mid.suggestion && mid.suggestion.units})`);

// A chosen size is honoured and never overridden by the suggestion.
const chosen = negativeAir(30000, 4, "large");
check(chosen.size === "large" && chosen.units === 2, `1400+ CFM covers 2000 CFM with 2 units (got ${chosen.units})`);
check(chosen.sizeIsChosen, "a chosen size is marked as chosen");
check(chosen.suggestion === null, "and gets no suggestion — the PM already decided");

// The bands are calculated at the end of the range that cannot under-size the job.
check(NEGATIVE_AIR_SIZES.small.rating === 699, "the 'up to' band is calculated at its ceiling");
check(NEGATIVE_AIR_SIZES.medium.rating === 800, "a range is calculated at its LOW end, the conservative direction");
check(NEGATIVE_AIR_SIZES.large.rating === 1400, "and so is the open-ended top band");
check(suggestNegativeAirSize(500) === null, "nothing is suggested when one default unit does the job");

// A share of a filter, not a price: 400 hrs of an 800-hour filter is half of one.
const f = filterUsage(400);
check(near(f.filters, 0.5), `400 job hours is half a filter (got ${f.filters})`);
check(near(filterUsage(8).filters, 0.01), "a short job consumes its sliver, not a whole filter");
check(!("charge" in f) && !("filterCost" in f), "and carries no dollar figure — pricing is not this app's job");

/* ── Duration ──────────────────────────────────────────────────────────────────────────────────── */

const base = emptyAsbestosScope();
check(jobHours({ ...base, durationDays: "5", hoursPerDay: "8" }) === 40, "days x hours/day");
check(jobHours({ ...base, durationDays: "5", hoursPerDay: "8", totalHoursOverride: "30" }) === 30, "a stated total wins over days x hours");
check(jobHours(base) === null, "and an empty duration is null, not zero");

/* ── Geometry: typed entry is the required path, the sketch is optional ────────────────────────── */

const typed = { ...base, roomLengthFt: "20", roomWidthFt: "10", roomHeightFt: "9" };
const g = roomGeometry(typed, null);
check(g !== null && g.source === "entered", "dimensions typed in stand alone with no sketch");
check(g && near(g.cubicFt, 1800), `20 x 10 x 9 is 1800 CF (got ${g && g.cubicFt})`);
check(g && near(g.wallSqFt, 540), `and 540 SF of wall (got ${g && g.wallSqFt})`);
check(roomGeometry(base, null) === null, "an incomplete room is null rather than a guess");

/* ── The whole calculation, and the scope text ─────────────────────────────────────────────────── */

const job = {
  ...base,
  material: "Sprayed fireproofing",
  surface: "ceiling",
  friable: true,
  areaDisturbedSqFt: "200",
  roomLengthFt: "20",
  roomWidthFt: "10",
  roomHeightFt: "9",
  crewSize: "3",
  durationDays: "5",
  hoursPerDay: "8",
  ppeChanges: "12",
  respirator: "Full-face air-purifying respirator, P100",
  ductingLinearFeet: "40",
  otherEquipmentUnits: "2",
};
const calc = asbestosCalculations(job, null);

check(calc.type === 3, "a big friable ceiling job derives as Type 3");
check(calc.containment.notation === "W/F", "which means full containment of walls and floor");
check(calc.deconChamber === "three_stage", "and the three-stage decon by default");
check(calc.jobHours === 40 && calc.labourHours === 120, `40 job hours, 120 labour hours for a crew of 3 (got ${calc.jobHours}/${calc.labourHours})`);
check(calc.negativeAir && calc.negativeAir.units === 1, `1800 CF at 4 ACH is 120 CFM, so one small machine (got ${calc.negativeAir && calc.negativeAir.units})`);
check(calc.filterUsage && near(calc.filterUsage.filters, 0.05), `40 hrs is 0.05 of a filter (got ${calc.filterUsage && calc.filterUsage.filters})`);
check(calc.ductingLinearFeet === 40, "and the ducting run is carried through");
check(calc.equipmentUnits === 3, `1 machine + 2 other units to decontaminate (got ${calc.equipmentUnits})`);

// An override is honoured AND flagged, so a Type that disagrees with the facts beside it looks deliberate.
const overridden = asbestosCalculations({ ...job, typeOverride: 2 }, null);
check(overridden.type === 2 && overridden.derivedType === 3, "an override wins over the derivation");
check(overridden.typeIsOverridden, "and is marked as one");
check(overridden.containment.level === "entry", "so the containment follows the override, not the derivation");

const text = buildAsbestosScopeSection(job, { sampleCount: 4, sketchRoom: null, roomName: "Boiler Room" });
const has = (needle) => text.includes(needle);
check(has("Asbestos Abatement"), "the section has its heading");
check(has("Type 3"), "states the Type");
check(has("Full containment – W/F – Walls, Floor"), "states the containment in W/F notation");
check(has("The ceiling is the removal zone and is not contained"), "and says plainly what is NOT contained");
check(has("Do not begin removal until"), "has the pre-abatement go/no-go hold point");
check(has("HEPA-vacuum, detailed – Ceiling"), "detailed HEPA-vac on the removal zone");
check(has("HEPA-vacuum, light – Walls, Floor"), "light HEPA-vac on what was contained");
check(has("Containment stays up until clearance results pass"), "has the clearance hold point");
check(has("Asbestos samples – 4"), "carries the sample count from the claim rather than its own field");
check(has("PPE changes – 12"), "states the entered PPE changes");
check(has("Negative air machine, Up to 699 CFM – 1 unit"), "states the machine size and count");
check(has("Flexible exhaust ducting – 40 LF"), "states the ducting run");
check(has("HEPA filter – 0.05 filters"), "states the filter as a share of one, not a price");

// Nothing entered means no section at all, rather than a heading with nothing under it.
check(buildAsbestosScopeSection(base, { sampleCount: null, sketchRoom: null, roomName: null }) === "", "an untouched form produces no section");

// No sample recorded is an omission, not a zero — "0 samples" would assert something nobody said.
const noSamples = buildAsbestosScopeSection(job, { sampleCount: null, sketchRoom: null, roomName: null });
check(!noSamples.includes("Asbestos samples"), "no sample count recorded means no sample line, not '0'");

// A Type 1 job takes the other branch through every one of those decisions.
const small = asbestosCalculations(
  { ...job, friable: false, minimalDisturbance: true, areaDisturbedSqFt: "2", surface: "floor" },
  null,
);
check(small.type === 1, "a small bound floor job is Type 1");
check(small.containment.level === "entry", "entry seal only");
check(small.deconChamber === "single_stage", "single decon chamber");
const smallText = buildAsbestosScopeSection(
  { ...job, friable: false, minimalDisturbance: true, areaDisturbedSqFt: "2", surface: "floor" },
  { sampleCount: null, sketchRoom: null, roomName: null },
);
check(smallText.includes("Seal entry/doorway"), "and its scope says entry seal");
check(!smallText.includes("HEPA-vacuum, light"), "with no light HEPA-vac line, because nothing was contained");

/* ── Remediation as a phase ────────────────────────────────────────────────────────────────────── */

const {
  availableScopePhases,
  isContentsOnly,
  isRemediationOnly,
  hasRemediation,
  hasStructuralScope,
  skipsTranscriptPipeline,
  usesReducedIntake,
  emptyClaimInfo,
} = mod;

const claim = (lossType, phases) => ({ ...emptyClaimInfo(), lossType, scopePhases: phases });

// Offered only where it means something. An abatement scope on a hail claim is not a thing.
check(
  availableScopePhases(claim("REMEDIATION", [])).some((o) => o.value === "REMEDIATION"),
  "Remediation is offered as a phase on a Remediation loss",
);
check(
  !availableScopePhases(claim("WATER", [])).some((o) => o.value === "REMEDIATION"),
  "and is not offered on a water loss",
);
check(availableScopePhases(claim("WATER", [])).length === 3, "which still leaves the original three everywhere else");

const remOnly = claim("REMEDIATION", ["REMEDIATION"]);
check(isRemediationOnly(remOnly), "Remediation alone is a standalone abatement assignment");
check(!hasStructuralScope(remOnly), "with no structural scope");
check(skipsTranscriptPipeline(remOnly), "so it skips the transcript pipeline entirely — the whole point of the fix");
check(usesReducedIntake(remOnly), "and takes the reduced intake, like a contents-only claim");
check(!isContentsOnly(remOnly), "it is not a contents claim");

// The combination that used to be mis-routed: contents + abatement, still nothing to dictate.
const both = claim("REMEDIATION", ["CONTENTS", "REMEDIATION"]);
check(skipsTranscriptPipeline(both), "Contents + Remediation also skips the transcript");
check(!isContentsOnly(both), "and is NOT 'contents only' — that would have dropped the abatement section");
check(hasRemediation(both), "both phases are recognised");

// Alongside structural work, the pipeline still runs.
const withStructural = claim("REMEDIATION", ["EMERGENCY", "REMEDIATION"]);
check(hasStructuralScope(withStructural), "Emergency + Remediation still has structural scope");
check(!skipsTranscriptPipeline(withStructural), "so it still dictates");
check(hasRemediation(withStructural), "and still gets the abatement step");

check(isContentsOnly(claim("WATER", ["CONTENTS"])), "a contents-only claim is unaffected");
check(!skipsTranscriptPipeline(claim("WATER", [])), "no phase selected is not 'skips the pipeline' — nothing is selected at all");

/* ── Wall removal is scoped by area; the count is derived ──────────────────────────────────────── */

// A 20 x 10 x 9 room has 540 SF of wall, so one wall averages 135 SF.
const wallGeom = roomGeometry({ ...base, roomLengthFt: "20", roomWidthFt: "10", roomHeightFt: "9" }, null);
check(wallsRemovedFrom(100, wallGeom) === 1, "100 SF is inside one wall");
check(wallsRemovedFrom(135, wallGeom) === 1, "exactly one wall's worth is one wall");
check(wallsRemovedFrom(140, wallGeom) === 2, "a little over spills into a second — rounded up, so the part-wall is still out of the containment");
check(wallsRemovedFrom(500, wallGeom) === 4, "and it can never exceed the room's four walls");
check(wallsRemovedFrom(9999, wallGeom) === 4, "however large the area");
check(wallsRemovedFrom(null, wallGeom) === 1, "no area entered falls back to one wall, not zero");
check(wallsRemovedFrom(200, null) === 1, "and so does no geometry to reckon against");

const wallJob = {
  ...job,
  surface: "wall",
  wallRemovalSqFt: "140",
  roomLengthFt: "20",
  roomWidthFt: "10",
  roomHeightFt: "9",
};
const wallCalc = asbestosCalculations(wallJob, null);
check(wallCalc.containment.wallsRemoved === 2, `140 SF spans 2 walls (got ${wallCalc.containment.wallsRemoved})`);
check(containedLabel(wallCalc.containment.contained) === "2 walls, Floor, Ceiling", "so the other 2 walls are contained with the floor and ceiling");
check(!wallCalc.wallsRemovedIsOverridden, "with the count derived, not stated");

const wallOverridden = asbestosCalculations({ ...wallJob, wallsRemovedOverride: "4" }, null);
check(wallOverridden.containment.wallsRemoved === 4, "an override wins over the derivation");
check(wallOverridden.wallsRemovedIsOverridden, "and is marked as one");

const wallText = buildAsbestosScopeSection(wallJob, { sampleCount: null, sketchRoom: null, roomName: null });
check(wallText.includes("140 SF of wall being removed, spanning 2 of 4 walls (reckoned from the room's wall area)"), "the scope states the area, the span AND that the span was derived");
check(
  buildAsbestosScopeSection({ ...wallJob, wallsRemovedOverride: "4" }, { sampleCount: null, sketchRoom: null, roomName: null }).includes("(as stated)"),
  "and says so differently when the PM set it",
);

/* ── Samples: entered here, or the claim's ─────────────────────────────────────────────────────── */

check(resolveSampleCount(base, 4) === 4, "the claim's count is used when nothing is entered here");
check(resolveSampleCount({ ...base, sampleCount: "7" }, 4) === 7, "an entered count wins over the claim's");
check(resolveSampleCount({ ...base, sampleCount: "7" }, null) === 7, "and stands alone when the claim has none — the standalone-abatement case");
check(resolveSampleCount(base, null) === null, "nothing anywhere is null, not zero");
check(resolveSampleCount({ ...base, sampleCount: "0" }, 4) === 0, "an explicit zero is a real answer and beats the claim's figure");

check(
  buildAsbestosScopeSection({ ...job, sampleCount: "7" }, { sampleCount: 4, sketchRoom: null, roomName: null }).includes("Asbestos samples – 7"),
  "and the scope prints the entered one",
);

/* ── Fees: an open item is a line, not an omission ─────────────────────────────────────────────── */

const noFees = buildAsbestosScopeSection(job, { sampleCount: null, sketchRoom: null, roomName: null });
check(noFees.includes("  General Fees"), "the fees section is always there");
check(
  noFees.includes("Pre-abatement containment/hoarding inspection by hygienist – TBD (open item, to be confirmed)"),
  "an unpriced pre-abatement inspection prints as an open item rather than vanishing",
);
check(noFees.includes("Post-abatement air clearance testing by hygienist – TBD"), "and so does the clearance");

const withFees = buildAsbestosScopeSection({ ...job, preAbatementFee: "450", postAbatementFee: "1200" }, { sampleCount: null, sketchRoom: null, roomName: null });
check(withFees.includes("Pre-abatement containment/hoarding inspection by hygienist – $450.00"), "a known fee prints as money");
check(withFees.includes("Post-abatement air clearance testing by hygienist – $1200.00"), "and so does the other");
check(!withFees.includes("TBD"), "with nothing left open");

/*
  The crew's obligation is a hold point; the inspection itself is the hygienist's and is a fee.

  These were both named "Pre-abatement inspection" / "Post-abatement clearance", once in the work
  sections and again under fees, and the document read as though it had been written twice. The
  general guard below catches the shape of that; these two pin the wording that fixed it.
*/
check(withFees.includes("Do not begin removal until containment integrity and negative air have been verified"), "the containment hold point is an obligation, not a repeat of the inspection");
check(withFees.includes("Containment stays up until clearance results pass"), "and so is the clearance hold point");
check(!withFees.includes("Pre-abatement inspection –"), "with the inspection named in exactly one place");
check(!withFees.includes("Post-abatement clearance –"), "and the clearance likewise");

/*
  No two bullets may lead with the same phrase.

  This is the shape of the bug that was reported: the same named item appearing in two sections,
  which no assertion about a specific string would have caught in general. Poly sheeting is the one
  legitimate repeat — it is one line per contained surface, which is what an estimator wants.
*/
const bulletLeads = withFees
  .split("\n")
  .filter((l) => l.trim().startsWith("- "))
  .map((l) => l.trim().slice(2).split(/ [–—] /)[0].trim().toLowerCase())
  .filter((lead) => lead !== "poly sheeting and seal");
const repeated = [...new Set(bulletLeads.filter((l, i) => bulletLeads.indexOf(l) !== i))];
check(repeated.length === 0, `no item is named twice in the document (repeated: ${repeated.join(", ") || "none"})`);

// A form with nothing but a fee is still a section — the fee is the reason it exists.
const feeOnly = buildAsbestosScopeSection({ ...base, preAbatementFee: "450" }, { sampleCount: null, sketchRoom: null, roomName: null });
check(feeOnly !== "", "entering only a fee is enough to produce a section");

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
