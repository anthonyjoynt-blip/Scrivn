/**
 * Batch 3 — material and equipment COVERAGE, not document quality.
 *
 * Every entry here was written to force one specific thing the schema may have no home for. That is
 * a different question from the one batch 1 asked ("does the pipeline hold together"), and it wants
 * a different way of reading the output: the interesting result is not a scope that reads badly, it
 * is a scope that reads FINE while something the PM said out loud has quietly vanished into a
 * neighbouring line.
 *
 * Two failure modes to watch for, and they are not the same:
 *
 *   ABSENT   — the item is nowhere in the output. Easy to spot, and the honest failure.
 *   ABSORBED — the item was heard and flattened into something the schema already had. Injecti-dry
 *              becoming a plain flood cut, a pocket door becoming "door", a drying mat becoming an
 *              air mover. This is the dangerous one: the document looks complete, and the work that
 *              gets priced is not the work that was described.
 *
 * `scopeOnly: true` on every entry. This batch is about what the tree can HOLD, and an inspection
 * report is written from the transcript rather than from the tree — so it would answer a question
 * nobody is asking here, and cost output tokens to do it.
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
    name: "19-drying-mats-injectidry-spiderbox",
    note: "Targets: wood floor drying mats; injecti-dry cavity injection as an ALTERNATIVE to flood cutting; temporary power / spider box as a site-setup item.",
    claim: claim({
      customerName: "Petrenko",
      jobNumber: "24801",
      claimNumber: "INT-40021",
      insurer: "Intact",
      address: "88 Fenwick Rd",
      pmName: "Dave",
      yearOfBuilding: 2010,
      waterCategory: 1,
      waterClass: 2,
    }),
    transcript: [
      "Basement had a slow leak behind the wall, hardwood floor's affected but we're not pulling it —",
      "putting drying mats down on it instead, should save the floor. Same wall — instead of a flood cut,",
      "we're doing injecti-dry into the cavity, inject warm dry air behind the drywall without opening it up.",
      "Power in that part of the basement isn't reliable enough for all the equipment we need, so we're",
      "running a spider box off the main panel to feed everything safely. Two air movers plus the drying mat",
      "system on the floor, one injection unit on the wall. Category 1, class 2.",
    ].join(" "),
  },
  {
    name: "20-appliances-shoring-sleeper-subfloor",
    note: "Targets: appliance detach/reset (fridge, range, dishwasher); cabinet detach WITH shoring, counter and sink staying put; a wet sleeper subfloor under the finish floor.",
    claim: claim({
      customerName: "Ashworth",
      jobNumber: "24805",
      claimNumber: "WAW-51092",
      insurer: "Wawanesa",
      address: "19 Millbrook Ln",
      pmName: "Melissa",
      yearOfBuilding: 1994,
      waterCategory: 2,
      waterClass: 2,
    }),
    transcript: [
      "Kitchen flood from a supply line, this one's got some layers to it. Fridge, range, dishwasher all need",
      "to come off and get reset once we're done — all three sat right in the affected area. Under the sink,",
      "the cabinet's coming out but the countertop and sink are staying put, so that section needs shoring to",
      "hold the counter up while the cabinet underneath is gone. Floor's on a sleeper subfloor system over the",
      "slab, wood sleepers are wet, those need to come out along with the vinyl on top. Three air movers, one",
      "dehumidifier. Category 2, class 2.",
    ].join(" "),
  },
  {
    name: "21-baseboard-shoe-three-cases",
    note: "Targets: all three baseboard/shoe cases in ONE claim — base and shoe together, shoe only with the base staying, plain base with no shoe. Should render as three genuinely different lines.",
    claim: claim({
      customerName: "Fontaine",
      jobNumber: "24809",
      claimNumber: "SGI-30187",
      insurer: "SGI Canada",
      address: "250 Cascade Dr",
      pmName: "Jason",
      yearOfBuilding: 2006,
      waterCategory: 1,
      waterClass: 2,
    }),
    transcript: [
      "Three rooms, water traveled through all of them. Living room — full baseboard's coming off, solid wood,",
      "both the baseboard and the shoe mold on top of it, replacing both. Bedroom — baseboard itself is fine,",
      "just the shoe mold got damaged, that's the only piece coming off in there. Hallway — no shoe mold on",
      "this one at all, just plain MDF baseboard, standard removal and replace, nothing else to it. Two air",
      "movers per room. Category 1, class 2.",
    ].join(" "),
  },
  {
    name: "22-bifold-pocket-doors-casing-hardware",
    note: "Targets: bifold and pocket doors as distinct types (a pocket door involves the wall cavity); window sill and casing as trim separate from the unit; door hardware and a blind as detach-reset items.",
    claim: claim({
      customerName: "Delaney",
      jobNumber: "24813",
      claimNumber: "AV-70234",
      insurer: "Aviva",
      address: "5 Overlook Terrace",
      pmName: "Chris",
      yearOfBuilding: 2001,
      waterCategory: 1,
      waterClass: 1,
    }),
    transcript: [
      "Entry area got wet from a window leak during the storm. There's a bifold closet door right there, water",
      "got into the track, that whole unit's coming out and getting replaced. Down the hall there's a pocket",
      "door into the bathroom, same thing, water got into the wall cavity where it slides, that's coming out",
      "too — more involved than a normal door given it's in the wall. Window itself is fine but the sill's",
      "rotted, that's getting replaced, and the casing around the window needs to come off and go back on once",
      "the sill's done. Door hardware — handles, hinges — on both doors, save them if possible, reset after.",
      "There's also a blind on that window, detach it before the sill work, reset it after. One air mover.",
      "Category 1, class 1.",
    ].join(" "),
  },
  {
    name: "23-repair-only-appliance-hardware-blind",
    note: "Repair-only follow-up. Targets: appliance RESET with no removal in this scope; cabinet hardware reset; blind reset. Nothing here is a mitigation line.",
    claim: claim({
      customerName: "Kowalczyk",
      jobNumber: "24817",
      claimNumber: "MPI-60125",
      insurer: "Manitoba Public Insurance",
      address: "141 Greenridge Ave",
      pmName: "Dave",
      yearOfBuilding: 2009,
      waterCategory: 2,
      waterClass: 1,
      scopePhases: ["REPAIR"],
    }),
    transcript: [
      "Back for the repair walkthrough, mitigation's long done. Fridge and dishwasher both need to go back in",
      "now that the floor's finished — they were sitting out this whole time. Cabinet hardware that we pulled",
      "is ready to go back on too, and the window blind in that same room needs to go back up now that the",
      "sill work's done. Nothing else outstanding in this room that I can see.",
    ].join(" "),
  },
  {
    name: "24-repair-only-casing-returns-jamb",
    note: "Repair-only follow-up. Targets: window casing; window RETURNS as a distinct trim case from full casing; a door jamb replacement; a final coat on baseboard AND shoe.",
    claim: claim({
      customerName: "Whitlock",
      jobNumber: "24821",
      claimNumber: "FA-20098",
      insurer: "Facility Association",
      address: "67 Sundown Cres",
      pmName: "Melissa",
      yearOfBuilding: 1998,
      waterCategory: 2,
      waterClass: 1,
      scopePhases: ["REPAIR"],
    }),
    transcript: [
      "Repair visit, trim work only left on this one. Window casing needs to go back on now that the wall's",
      "patched — same for the returns on that same window, no full casing there, just needs the return trim",
      "finished. Door jamb on the closet door needs replacing, it warped during the drying process. Baseboard",
      "and shoe both need their final coat now that everything's back up. That's the whole punch list for",
      "this room.",
    ].join(" "),
  },
];
