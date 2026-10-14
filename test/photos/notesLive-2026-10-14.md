# Photo notes, proven on the model

Run 2026-10-14T18:23:19.085Z against http://localhost:3006.

## A. said in both places

Transcript:

> Supply line to the vanity in the main bathroom let go overnight. Main bathroom only. The baseboard behind the vanity is wet, about four linear feet of it, MDF, it's coming off and getting replaced. Vinyl plank floor is dry, leaving it. Drywall is fine. One air mover and one dehumidifier in the bathroom.

Photo notes sent:

```
- Main Bathroom · 10:40 a.m. · Baseboard wet behind the vanity, about four feet, MDF, remove and replace.
```

Rooms read:

- Main Bathroom: 1 flooring (VINYL DRY_IN_PLACE), 1 baseboard

Scope document:

```
PN-0001 – Notes test A
Category of loss: 1
Class of loss: 2
Insurer: Wawanesa

Emergency
  Main Bathroom
    - Dry in place – vinyl plank, glued – floor area
    - Remove baseboard – MDF baseboard – behind the vanity
    - Place 1 air mover
    - Place 1 dehumidifier
  General
    - Disposal – pickup – 1/4 load (not weighed: baseboard removal)
    - Equipment pickup and monitoring

Repair
  Main Bathroom
    - Replace baseboard – MDF baseboard, 4" – behind the vanity
    - Paint baseboards x2 coats
    - Final clean
  General
    - Disposal – pickup
```

## B. said only under a photo

Transcript:

> Supply line to the vanity in the main bathroom let go overnight. The baseboard behind the vanity is wet, about four linear feet, MDF, coming off and getting replaced. One air mover and one dehumidifier in the bathroom.

Photo notes sent:

```
- Main Bathroom · 10:40 a.m. · Baseboard behind the vanity, the wet section.
- Kitchen · 10:42 a.m. · Water ran under the wall into the kitchen. Laminate floor in front of the sink is cupped and wet, about forty square feet, remove and dispose.
```

Rooms read:

- Main Bathroom: 0 flooring (none), 1 baseboard
- Kitchen: 1 flooring (LAMINATE REMOVE_AND_DISPOSE), 0 baseboard

Scope document:

```
PN-0001 – Notes test B
Category of loss: 1
Class of loss: 2
Insurer: Wawanesa

Emergency
  Main Bathroom
    - Remove baseboard – MDF baseboard – behind the vanity
    - Place 1 air mover
    - Place 1 dehumidifier

  Kitchen
    - Extract water – from hard surface – a quarter of the room
    - Remove laminate flooring – 40 SF
    - Remove baseboard – MDF baseboard, flat – affected wall run at the sink
    - Remove shoe mold – affected wall run at the sink
    - Detach floor registers – 1
    - Manipulate contents
  General
    - Disposal – pickup – 1/4 load (est. under 0.1 t; not weighed: baseboard removal (Main Bathroom); baseboard removal (Kitchen))
    - Equipment pickup and monitoring

Repair
  Main Bathroom
    - Replace baseboard – MDF baseboard, 4" – behind the vanity
    - Paint baseboards x2 coats
    - Final clean

  Kitchen
    - Install new laminate flooring – 40 SF
    - Replace baseboard – MDF baseboard, flat, 3.25" – affected wall run at the sink
    - Replace shoe mold – affected wall run at the sink
    - Paint baseboards x2 coats
    - Reset floor registers – 1
    - Reset contents
    - Final clean
  General
    - Disposal – pickup
```

## Checks

- PASS A: one bathroom — Main Bathroom
- PASS A: one baseboard record in it, not two — 1 records
- PASS A: no kitchen invented — Main Bathroom
- FAIL A: the document never doubles it to eight feet —     - Remove baseboard – MDF baseboard – behind the vanity |     - Disposal – pickup – 1/4 load (not weighed: baseboard removal) |     - Replace baseboard – MDF baseboard, 4" – behind the vanity |     - Paint baseboards x2 coats
- PASS B: the kitchen, named only under a photo, is in the scope — Main Bathroom, Kitchen
- PASS B: with its laminate taken out — {"type":"LAMINATE","carpetStyle":null,"padPresent":null,"vinylSubtype":null,"vinylInstallation":null,"vinylSubstrate":null,"hardwoodConstruction":null,"hardwoodConstructionOther":null,"hardwoodInstallation":null,"disposition":"REMOVE_AND_DISPOSE","phase":null,"phaseUncertain":false,"padRemoved":null,"removalSF":40,"removalFraction":null,"cleaningRequired":null,"carpetLiftSF":null,"carpetLiftFraction":null,"padRemovedSF":null,"padRemovedFraction":null}
- PASS B: the document lists the kitchen laminate —   Kitchen |     - Remove laminate flooring – 40 SF |     - Disposal – pickup – 1/4 load (est. under 0.1 t; not weighed: baseboard removal (Main Bathroom); baseboard removal (Kitchen)) |   Kitchen |     - Install new laminate flooring – 40 SF
- PASS B: and still one bathroom baseboard record, though the bathroom photo names it too — 1 records

Calls: 10. Estimated cost: $0.369.

## Re-checked without a second run (2026-10-14)

The fourth check of A as first written looked for "4 LF" on a baseboard line. The scope document
names a baseboard by where it is ("behind the vanity") and prints no feet for it, so that check could
not pass whatever the model did. What it was meant to catch is a doubled item, which would show as a
second line. On the output above: one "Remove baseboard" line and one "Replace baseboard" line in
the Main Bathroom, nothing at eight feet. PASS. The check in test/photos/notesLive.mjs now counts
lines; the run was not repeated, to keep the spend to the one run ($0.37 for both claims).
