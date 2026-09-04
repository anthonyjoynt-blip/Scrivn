/**
 * The batch. Each entry is one claim: what a PM dictated, plus the intake they would have filled in.
 *
 * Written to be READ, not just run. The point of the report this produces is that somebody compares
 * the finished documents against the transcript by eye, so these are dictation as it actually
 * sounds — half sentences, facts in the order they were noticed, and things left unsaid — rather
 * than tidy lists that would only prove the pipeline can handle tidy lists.
 *
 * They differ from each other on purpose, along the axes that have produced bugs:
 *
 *   - how much is STATED vs left for gap-check (sparse ones exercise the questions hardest)
 *   - flooring type, since almost every rule branches on it
 *   - whether quantities come as areas, as dimensions, or not at all
 *   - loss category, which changes antimicrobial and treatment wording
 *   - the categories that had no home until recently: antimicrobial, containment, HEPA, air
 *     scrubbers, appliances, and a floor that is cleaned rather than removed
 *
 * Deliberately NOT covered: sketches, moisture mapping, and any quantity derived from them. Those
 * need drawing this script cannot do, so every area here is either stated or asked for.
 */

/**
 * The intake a PM fills in before dictating.
 *
 * `scopeOnly` defaults true to keep these short, which means no inspection report — so two claims
 * below deliberately turn it off and carry the full field set. The inspection report is written from
 * the transcript rather than from the tree, and that difference is exactly where the dropped-line
 * bugs have lived, so a batch that never produced one would miss the comparison worth making.
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
    name: "01-basement-sump-cat3",
    note: "The reported claim. Category 3, a concrete floor that is cleaned rather than removed, antimicrobial stated for the whole job, equipment split across two rooms.",
    claim: claim({
      customerName: "Bergstrom", jobNumber: "PL-0001", waterCategory: 3, waterClass: 2,
      // Full intake: this one produces an inspection report as well as a scope.
      scopeOnly: false, address: "418 Kilbourn Ave", pmName: "R. Halvorsen", dateOfLoss: "2026-08-24",
      yearOfBuilding: 1998, causeOfLoss: "Sump pump failure during storm", preExistingConditions: "None noted",
    }),
    transcript:
      "Sump pump failed during the storm last week, basement took on groundwater, so this is a category 3. " +
      "Finished rec room and an unfinished storage area both affected. Rec room — carpet and pad out, disposal, " +
      "and there's a lot of contents in there, homeowner's got a full entertainment unit, several bookshelves, " +
      "boxes of stuff stacked against one wall, going to need a full pack-out before we can even get to the flooring. " +
      "Baseboard's MDF, coming off, replacing later. Storage area is unfinished, concrete floor, nothing to remove there, " +
      "just needs to be cleaned and treated. No ceiling damage anywhere. Four movers in the rec room, two in the storage area, " +
      "two dehumidifiers given the category. Antimicrobial throughout both spaces.",
  },
  {
    name: "02-kitchen-supply-line",
    note: "Dimensions rather than an area — 'six by eight feet' has to become 48 SF. Also a flood cut with a stated height.",
    claim: claim({ customerName: "Delacroix", jobNumber: "PL-0002", insurer: "SGI Canada", waterCategory: 1, waterClass: 1 }),
    transcript:
      "Supply line let go under the kitchen sink overnight, clean water. Vinyl plank flooring in the kitchen, " +
      "the affected area is about six by eight feet in front of the dishwasher and we're pulling that out. " +
      "It's the click-lock stuff, not glued. Baseboard along that wall is wet, MDF, coming off and going back on after. " +
      "Drywall on the north wall is saturated at the bottom, flood cut going up two feet. Insulation behind it is wet too, " +
      "fiberglass batt. Need to pull the dishwasher out to get behind it. Couple of air movers and a dehu in there.",
  },
  {
    name: "03-upstairs-bathroom-overflow",
    note: "Water through a ceiling — texture, insulation above, light fixtures. Nothing quantified, so gap-check carries most of it.",
    claim: claim({
      customerName: "Okonkwo", jobNumber: "PL-0003", insurer: "Intact", waterCategory: 2, waterClass: 2,
      scopeOnly: false, address: "77 Vasseur Crescent", pmName: "D. Petrossian", dateOfLoss: "2026-08-30",
      yearOfBuilding: 2011, causeOfLoss: "Toilet overflow, upstairs bathroom", preExistingConditions: "None noted",
    }),
    transcript:
      "Toilet overflowed in the upstairs bathroom and came through to the living room ceiling below. " +
      "Living room ceiling is drywall, stained and sagging, we're taking it out and replacing. It's a popcorn ceiling. " +
      "There's insulation above it that's wet. Two pot lights in that section that'll need to come down and go back. " +
      "Carpet in the living room got soaked where it came through — we're lifting it and pulling the underpad, " +
      "carpet itself can be saved and reinstalled. Bathroom upstairs has tile, it's fine, staying. " +
      "Vanity in the bathroom needs to come out to get at the floor.",
  },
  {
    name: "04-vague-walkthrough",
    note: "Deliberately sparse — the kind of dictation that leaves gap-check doing nearly all the work. Exercises the question flow hardest.",
    claim: claim({ customerName: "Marchetti", jobNumber: "PL-0004", insurer: "Aviva", waterCategory: 2, waterClass: 3 }),
    transcript:
      "Washing machine hose burst on the main floor. Laundry room, hallway and the spare bedroom are all affected. " +
      "Flooring's coming up in all three. Baseboards are wet. Some drywall damage in the laundry room. " +
      "Need to pull the washer and dryer. We'll get equipment in there to dry it out.",
  },
  {
    name: "05-hardwood-and-containment",
    note: "Hardwood with construction and install method stated, plus containment, HEPA and air scrubbers — the categories added most recently.",
    claim: claim({ customerName: "Nakamura", jobNumber: "PL-0005", insurer: "TD", waterCategory: 3, waterClass: 2 }),
    transcript:
      "Sewer backup in the finished basement, category 3. Engineered hardwood down there, nailed, about 320 square feet " +
      "and all of it's coming out. Baseboard is solid wood, three and a quarter, removing and replacing. " +
      "We're hanging poly containment at the bottom of the stairs to seal the basement off, roughly eight by ten. " +
      "Two air scrubbers running down there and a negative air machine. HEPA vacuum the whole floor once the flooring's out. " +
      "Antimicrobial on everything. Six air movers and two dehumidifiers. There's a bar fridge and a built-in microwave " +
      "in the basement kitchenette that need to come out.",
  },
  {
    name: "06-tile-and-cabinetry",
    note: "A floor that stays and is cleaned, cabinetry and countertop work, appliances. Tests the non-removal path.",
    claim: claim({ customerName: "Achterberg", jobNumber: "PL-0006", insurer: "Co-operators", waterCategory: 2, waterClass: 1 }),
    transcript:
      "Dishwasher leaked slowly behind the kickplate, been going a while. Kitchen only. " +
      "Tile floor is fine structurally, staying down, just needs cleaning and treating. " +
      "Lower cabinets on the sink run are swollen at the base, those are coming out and being replaced — " +
      "it's the base run, not the uppers. Laminate countertop comes off with them. " +
      "Toe kick is shot. Need to pull the dishwasher and the range to get behind. " +
      "Drywall behind the lower cabinets is wet, cutting that out at base height. Air mover and a dehu.",
  },
  {
    name: "07-multi-room-laminate",
    note: "Three rooms, one flooring type, one baseboard height throughout — the shape the apply-to-all offer exists for.",
    claim: claim({ customerName: "Fitzgerald", jobNumber: "PL-0007", insurer: "AMA", waterCategory: 2, waterClass: 2 }),
    transcript:
      "Water heater let go in the utility room and ran out across the main floor. " +
      "Utility room, hallway, and the dining room are all wet. Laminate throughout all three, it's buckled, " +
      "all coming out — call it 90 square feet in the utility room, 60 in the hallway and 180 in the dining room. " +
      "Baseboard is flat MDF everywhere, four inch, coming off and being replaced. " +
      "Drywall's fine except in the utility room where it's wet at the bottom, base height cut there. " +
      "Contents in the dining room, table and a hutch, need moving out of the way. Equipment in all three.",
  },
  {
    name: "08-fire-adjacent-water",
    note: "A non-water loss type. Exercises the filters that drop water-only questions — extraction and drying-equipment prompts should not appear.",
    claim: claim({
      customerName: "Rasmussen",
      jobNumber: "PL-0008",
      insurer: "Allstate",
      lossType: "FIRE",
      waterCategory: null,
      waterClass: null,
      scopePhases: ["EMERGENCY", "REPAIR"],
    }),
    transcript:
      "Kitchen fire, contained to the kitchen but there's smoke through the main floor. " +
      "Kitchen ceiling drywall is coming out, it's smooth finish. Upper cabinets on the stove wall are gone, " +
      "replacing those. Range hood and the built-in microwave above the range both need to come out. " +
      "Vinyl sheet flooring in the kitchen is scorched near the stove, pulling all of it, about 140 square feet. " +
      "Baseboard in the kitchen is MDF, removing and replacing.",
  },
];
