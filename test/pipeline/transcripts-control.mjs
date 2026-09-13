/**
 * The auditor's positive control — one transcript that says things the schema cannot hold.
 *
 *   SCRIVN_BATCH=control npm run test:pipeline
 *
 * An auditor that reports nothing is either right or blind, and a clean batch cannot tell you which.
 * So this transcript dictates work that provably fits no record — the tub-surround tile and the two
 * outlets, both cut from lib/schema.ts when it hit the Structured Outputs size limit — plus water
 * extraction stated outright, which is a gap-check field.
 *
 * What to read in the trace, and why each part matters:
 *
 *   Section 3 — both the tile and the outlets must appear as `unscoped`, in the PM's words. That is
 *                the third extraction call (lib/extractionUnscoped.ts) doing its one job. If either
 *                is absent here, the sweep has gone blind — or, worse, a pass has failed soft: check
 *                the top of the trace for the "!!! EXTRACTION PASS FAILED" banner and section 2 for
 *                a missing extract:detail or extract:unscoped row. Before the sweep existed, both
 *                items vanished at this point with nothing anywhere to say so.
 *   Section 4 — each is asked once, "Not in the scope yet — ... Which phase does it belong in?"
 *   Section 5 — whichever the stand-in placed is on the scope verbatim, in that phase.
 *   Section 6 — whichever the stand-in DROPPED is reported MISSING with "overridden by an answer":
 *                the auditor still sees, and can say why the line is not there. Water extraction
 *                shows as ASKED_ANYWAY (or MISSING-overridden, depending on the stand-in's answer).
 *                Expect NOTHING for the baseboard height, vinyl area, cabinet grade or insulation
 *                type — those come from answers, and the auditor is handed the answers.
 *
 * The stand-in's choices are hashed from the question id and this claim's name, so they are stable
 * run to run: as of writing it places the tile in Emergency and drops the outlets. Rename the claim
 * and they may change; the reading above still holds, it just swaps which item is which.
 *
 * `scopeOnly: true`, like batch 3 — the inspection report would cost tokens to answer nothing here.
 */

function claim(over) {
  return {
    customerName: "",
    jobNumber: "",
    claimNumber: "",
    address: "",
    insurer: "Wawanesa",
    pmName: "",
    lossType: "WATER",
    lossTypeOther: "",
    waterCategory: 2,
    waterCategoryNote: null,
    waterClass: 2,
    dateOfLoss: null,
    yearOfBuilding: null,
    causeOfLoss: "",
    preExistingConditions: "",
    dateTimeInspected: "",
    scopeOnly: true,
    scopePhases: ["EMERGENCY", "REPAIR"],
    ...over,
  };
}

export const TRANSCRIPTS = [
  {
    name: "control-known-drops",
    note: "Positive control for the sweep and the auditor. The tub-surround tile and the two outlets have no schema slot: both must appear as unscoped in section 3, be asked in section 4, and either reach the scope verbatim or be reported MISSING as overridden by the stand-in's answer. Water extraction, stated outright, shows as ASKED_ANYWAY. Nothing for the baseboard height, vinyl area, cabinet grade or insulation type — those are answers.",
    claim: claim({
      customerName: "Control",
      jobNumber: "00001",
      claimNumber: "CTL-00001",
      insurer: "Wawanesa",
      address: "1 Test Rd",
      pmName: "Control",
      yearOfBuilding: 2005,
      waterCategory: 2,
      waterClass: 2,
    }),
    transcript: [
      "Basement bathroom, supply line under the vanity let go overnight. We extracted standing water off the",
      "whole floor when we got there. Vinyl plank is coming out, the whole room. MDF baseboard comes out with",
      "it. Drywall gets a two foot flood cut on the wet wall behind the vanity. The tile on the tub surround",
      "is coming off too, the backer board behind it is soaked through. Two outlets on that wet wall need to be",
      "replaced. Vanity cabinet is coming out and being replaced. Two air movers and one dehumidifier.",
      "Category 2, class 2.",
    ].join(" "),
  },
];
