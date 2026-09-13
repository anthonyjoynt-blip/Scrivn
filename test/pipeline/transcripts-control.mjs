/**
 * The auditor's positive control — one transcript with drops that are KNOWN to happen.
 *
 *   SCRIVN_BATCH=control npm run test:pipeline
 *
 * An auditor that reports nothing is either right or blind, and a clean batch cannot tell you which.
 * So this transcript says things the pipeline provably cannot carry, and the audit section of its
 * trace must name them. Run it whenever audit.mjs changes, and read section 6 for:
 *
 *   MISSING       — the wall tile and the outlets. Neither has a slot in lib/schema.ts (both were
 *                   cut when the schema hit the Structured Outputs size limit — see the notes there),
 *                   so extraction cannot hold them and the scope cannot show them. If the audit does
 *                   not report these, it has gone blind.
 *   ASKED_ANYWAY  — water extraction. The PM states it outright, but `waterExtractionRequired` is a
 *                   gap-check field, so the app asks. Depending on how the stand-in answers, the
 *                   trace shows either ASKED_ANYWAY (it said yes) or MISSING with "overridden by an
 *                   answer" (it said no). Either is the audit working.
 *
 * And the negative half, which matters just as much: the baseboard height, the vinyl area and the
 * cabinet grade the stand-in supplies must NOT be reported. Those are answers, not inventions, and
 * the whole reason the auditor is handed the question log is to know the difference.
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
    note: "Positive control for the auditor. Expect MISSING for the tub-surround tile and the two outlets (no schema slot for either), and ASKED_ANYWAY or an overridden MISSING for the water extraction the PM states outright. Expect NOTHING for the baseboard height, vinyl area or cabinet grade — those come from answers.",
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
