# The test-house runner (2026-10-20)

A folder of photos of a house plus a few tapes in words becomes the measured exterior, an accuracy table and the customer report. Scrivn's own code does all of it on this machine (the photo route, the roof, the trace's reading of a wall, the decks, the report), so a house measured here is measured exactly as scrivn.ca measures it. **No API call is made anywhere.** A Claude session does the looking: it draws the shape, puts the corners on the photos, answers the review sheets, and reads the walls off the squared sides.

```
node scripts/house/run.mjs <folder> prepare        # ~15 s for 18 photos
node scripts/house/run.mjs <folder> check          # ~15 s: writes review.png, what is in doubt
node scripts/house/run.mjs <folder> fix            # scrivn/fixes.txt into inputs.json, then check again
node scripts/house/run.mjs <folder> measure        # ~25-35 s, hold-outs included: review.png again
node scripts/house/run.mjs <folder> fix --measure  # the measure's fixes, then measure again
node scripts/house/run.mjs <folder> report         # ~4 s
node scripts/house/run.mjs <folder> zoom 7 1290,1260 1400,1150 --half 100     # close looks, any time
```

`<folder>` is either a folder of photos with `tapes.txt` (and `house.txt`) beside them, or a pulled Send-to-team request (`exterior-requests/<id>/`, from `node scripts/pull-exterior-request.mjs <id>`). Everything the runner writes goes in `<folder>/scrivn/`; the photos are never touched.

**The looks, in order.** A house wants about 20-30 image looks, not 100: `contact.png` once; the `sheets/NN.png` you need to draw the shape and put the corners (one per photo at most); then **only the review pages**, each a sheet of the corners and tape ends in doubt, close up, answered in one `fixes.txt`. Everything not on a review page is shown once on `contact.png` for a single confirm. Zoom only what a review tile can't settle.

## What the session does, step by step

### 1. The folder

- The photos as the phone took them, any names (a phone's `20261016_124948.jpg` names give the walk's order; otherwise the EXIF date, otherwise the file's time).
- `tapes.txt`: one tape a line, in plain words. The first length on the line is the tape; what it is comes from the words.
  ```
  garage door 16' wide
  back wall 31'4"
  porch 90 in
  ```
  Lengths: `31'4"`, `31' 4 1/2"`, `31 ft 4 in`, `90"`, `90 in`, `16'`, `6.5 m`, `650 cm`. Door, window, garage or roll-up words make a **line on a photo** (its two ends placed on the photo); wall, side, front, rear, porch, gable words make a **wall's length**, corner to corner. "doors" or "both" means the same tape across each.
  A line that says its size **roughly** (`about`, `roughly`, `approx`, `estimate`, `guess`, `by eye`, `or so`, `~`, `-ish`) is a **size estimated on site**, never a tape: `the bump-out sticks out about 6'`, `back wall about 15' (±20%)`. Its ± is 20% unless said. It goes in `inputs.json` `estimates`, not `tapes`, to check the measure by (`"use": "check"`); see step 3.
- `house.txt` (optional), a line each: `semi-detached` / `end townhouse` / `townhouse` / `side-split` / `duplex`; `front faces north` (or `NE`, `200`, `unknown`); `name: 52 Elm St`; anything else is kept as a note.
- A pulled request has none of these: its `request.json` carries the tester's photos, shape, corner taps and tapes, and the draft starts from them. Read the tester's note: tapes in words go into `inputs.json` by hand.
- A request from **the walk round the house** (2026-10-21) says what each photo was taken for: `photos[].walk` in `request.json` reads `the front`, `corner 3 at 45°`, `side 2 straight on (corner 2 to the next)` or `the wall before inside corner 4`. Corner k is the shape's corner k as the plan numbers them (corner 1 the front's right-hand end, then round the house with it on your left); the front runs from the last corner to corner 1. The shape in `route` is the lap's (`outlineFrom: "walk"`): its turns as walked, its sizes rough, held loosely by the solve. Drawn again, sizes and all, it is a drawing like any other (`isWalkShape` in lib/photoRouteWalk.ts tells which). A side passed by as too tight has no photo; the corners either side of it have their 45s.

### 2. `prepare`, then look

It levels every photo and estimates the lens, finds each photo's **corner candidates** (its long upright edges reaching below eye level, lettered a–h, orange), and writes:

- `scrivn/contact.png`: every photo small, numbered #1, #2... in walk order. **Look at this first**: what each photo shows, and the house's shape.
- `scrivn/sheets/NN.png`: each photo with a grid in its own pixels, the candidates, and the shape beside it.
- `scrivn/inputs.json`: the draft to fill in. A folder's draft has a placeholder 40' x 30' shape and the tapes from `tapes.txt`; a request's has the tester's shape, taps and tapes.

### 3. Fill in `inputs.json`

**The shape** (`shape.outline`): the house's corners as plan feet `[x, y]`, **counter-clockwise seen from above, the street at the bottom** (y grows away from the street). Rough is right: draw it on a 1 ft grid as the owner would sketch it, every wall square to the plan. The measure fits the lengths; the shape only says which corner is which. Corner k is `C(k+1)` on every sheet; the side from C5 to C6 is `C5-C6`. Set `shape.from` to `"session"`. Name the sides if you like (`shape.names: {"C1-C2": "Garage front"}`): the report uses them.

**The home** (`house`): `name`, `homeType` (detached, semi, town_end, town_middle, split, duplex_updown), `shared` (party walls, e.g. `["C3-C4"]`), `frontFacesDeg` (or null).

**The corners** (`corners`): one entry per corner seen on a photo, **where the wall meets the ground** (the foot of the corner, on the wall's bottom edge, not below it on the grass or the pad):

```json
{"photo": 5, "edge": [[826.5, 300], [838, 945]], "corner": "C2"},
{"photo": 6, "x": 1340, "y": 1010},
{"photo": 3, "pick": "c", "y": 1000, "corner": "C4"}
```

- The quickest first pass is a candidate's letter: `pick` it off the sheet (`pick` with a `y` follows that edge down to the ground row you give). The review then shows only those in doubt.
- **Read a position off the sheet's grid labels, never off the picture's own pixels**: the sheet is the photo scaled down (a 2000 px photo shown 1200 wide), so a point that looks to be at 600 across is at 1000. A letter avoids this; so does a fix with `~` (below), snapped as a tap.
- **An edge** (`edge`: a point high up the corner and its foot, read off a close-up) is taken exactly as placed (`exact`) and read where it crosses the photo's horizon, which a half-degree error in the photo's levelling moves least. Read the corner where its trim's outer edge is (the building's outside), not the siding's edge an inch or two in.
- A plain `x`, `y` (the foot alone) is snapped onto the strongest edge within 14 px, as a finger's tap on the phone is. That suits stucco; on ribbed metal, board-and-batten or any corner with a trim, the strongest edge nearby is often a rib or the trim's other edge, 10-30 px off. Add `"exact": true` to a foot you placed from a close-up.
- **Name at least one corner on each photo** (`"corner": "C10"`); Scrivn numbers the rest as the next corners round the house, left to right. **Name every one on a photo that skips a corner** (one hidden behind a wing, a pilaster or a porch): Scrivn's numbering assumes they run on.
- A pilaster or a post at a corner: tap the edge standing at the corner.
- A photo showing one corner only, or none, is placed only once you say where you stood for it (`standAt`, below): its edges alone can point surely to the wrong spot. The photos that place best show a corner at 45 degrees with both walls in.

**Where you stood** (`standAt`), for a photo with one corner or none: `{"3": [-30, 34]}`, feet on the shape as drawn (its frame, the street at the bottom), as near as a tap on the plan would put it. `measure` lists each photo waiting for one, with its best guesses.

**The tapes** (`tapes`):
- a wall's length: `"side": "C5-C6"`;
- a line on a photo: `"on": [{"photo": 4, "a": [310, 760], "b": [655, 760]}]`, one entry for each alike thing it covers (both garage doors). Put the ends on the jambs at mid-height. **Ask what was taped** when it could be either (a door's opening, its curtain or across its trim): on a small building that choice moves the whole scale by up to 15%.
- **Put the ends where the tape's ends were, from a close-up, and add `"exact": true`**: then they are not snapped and not merged with an edge other photos tied within 0.2 ft. On a 5' tape seen from 20 ft, 1 px is 0.4% of the house. Without `exact` the ends are a finger's drag, snapped and joined, as on the phone.
- `"skip": true` leaves a tape out.

**Sizes estimated on site** (`estimates`), optional: what someone at the house judged by eye, a side each: `{"id": "e1", "said": "the bump-out sticks out about 6'", "feet": 6, "plusMinusPct": 20, "side": "C8-C9", "use": "check"}`. It is never a tape, never held out, never "taped" in results.md. A tape on the same side stands and the estimate is not used. `"skip": true` leaves one out. `"use"` says what it does:
- `"check"` (the default, and what prepare drafts): it only checks the measure, which it never moves. When the measure is further from it than its ± (20% unless said), the side is named under **Sizes estimated on site, checked** in results.md, in the advice and under **Worth a look** ("… was estimated on site at about 7', but the photos make it 12'0": 71% longer, more than the estimate's ±20%. Tape it to see which is right."), and plan.png marks it dashed magenta, "TAPE IT". Either the photos or the eyeball is wrong there: a tape settles which.
- `"hold"`: the side is held to it loosely (its ± read as two sd, as the route's own ±), in place of the length the shape drew. The report says "estimated on site" beside that side, and results.md shows **What the estimates changed**: every side with them and without them. Held, a guess fixes a side the photos have badly out, but drags one they have right (10-21: a wrong "about 57'" took a 70'6" wall the photos had right to 60'3"), and the route's ± does not say reliably which case it is.

**Checks** (`checks`), optional: a line on a photo you expect a length for, as a sanity check, never a tape: `{"photo": 3, "a": [698, 515], "b": [712, 1073], "feet": 6.6667, "what": "man door slab (usually 6'8\")"}`. With one tape these are the only cross-check there is.

**Decks and porches** (`decks`): see [Decks](#decks) below.

### 4. `check`, then the review

It reads `inputs.json` exactly as the route will, says plainly what is missing (✗ lines), numbers the corners and places each photo on the shape from its corners alone. Then:

- `scrivn/review.png` (`review-2.png`... past 18): **only what is in doubt**, each a crop up the corner's wall from its foot (a tape's end at about 3x), with the candidates (orange), the tap (red), where the snap moves it (green), an edge (violet) or a tape's line (yellow), named as a fix names it (`R3 7 C8`) with the reason under it. In doubt: no edge where a corner was put, a snap that moves it more than 6 px, a faint edge, an edge's top and foot off one upright, no number, Scrivn numbering a photo you named nothing on, a photo the corners can't place, and every tape end till you say it is right. `review.txt` has the same list, a line each.
- `scrivn/contact.png` and `sheets/NN.png` with the numbers: **green** named by you, **cyan** numbered by Scrivn, **red** no number. **One look at contact.png** confirms the rest: does each photo's numbering run round the house as its view does?
- `scrivn/taps/NN.png`: every corner close up, if a review tile isn't enough.

**Answer the whole sheet in `scrivn/fixes.txt`**, a line per tile, then `run.mjs <folder> fix` (it applies them all to `inputs.json`, keeps them in `fixes-done/`, and checks again):

```
3 C10 ok                    as it is (it is not shown again)
3 C10 = c                   candidate c on photo 3 is C10
3 C10 = 496,1000            put at x,y (exact: not snapped)
3 C10 ~ 1300,1010           tapped at x,y and snapped, as a finger's tap is (a point read off a sheet)
3 C10 = 490,600 496,1000    its edge, top then foot (exact)
3 ? = 1340,1010             a corner with no name (Scrivn numbers it)
3 C10 -> C9                 renamed
3 C10 drop                  taken out
3 out / 3 in                the photo left out of the measure, or back in
3 stood = 1                 where you stood for #3 (measure's first best guess, or x,y on the shape as drawn)
tape t1 ok                  its ends as they are
tape t1 4 = 310,760 655,760        its ends on photo 4 (exact); tape t1#2 the second place it is on
tape t2 side C5-C6          a wall's length, that side
# a comment
```

A corner is named as the review names it: its photo and its corner (`3 C10`), the name Scrivn gave it counting too. A line that can't be applied is ✗ and nothing changes. Repeat till check says **Ready to measure** and the review is empty or every tile is answered. Placing a tape's ends makes them doubtful again; put `tape t1 ok` after them in the same file when the tiles already showed where they go.

A corner behind a glass railing, a bin or a post rarely settles from a crop: leave it out rather than zooming round it, and let the measure's marks and the other photos carry it.

### 5. `measure`, then the review again

It runs the route's measure (lines, lens, levelling, the plan bundle solve with wall edges tied across photos), places the decks, and writes:

- `review.png` again: **the corners whose bearing the measure doesn't agree with** (over 2.5 sd), **Scrivn's marks** (where the measure puts a corner a placed photo should show and nobody tapped), **photos not placed**, **a tape the others don't agree with** (held out, over 5% off), **deck corners crossed weakly**, **the photos waiting for where you stood** (up to three best guesses each, in feet on the shape as drawn), and **what the pane says is worth a look** (`lib/photoRouteSanity.ts`: eaves disagreeing at an outside corner, a door or window far from the usual size, a camera under the ground or inside the house, an outline that won't close, a depth nothing ties, a size estimated on site the measure disagrees with). Answer in `fixes.txt` and run `fix --measure`:
  ```
  keep 9:C7 15:C3             Scrivn's marks kept (unkeep 9:C7 takes one back)
  1 out                       a photo placed where it wasn't taken
  3 stood = 1                 where you stood for #3: its first best guess
  3 stood = -30,34            or the spot, feet on the shape as drawn ("3 stood clear" forgets it)
  ```
- `results.md`: the outline with ± per side, the sizes estimated on site checked against it, the accuracy table, the advice, the decks, **Worth a look**, **Waiting for where you stood**, the photos not used, and the corners Scrivn marks.
- `plan.png`: the measured plan with every placed photo where the solve put it. One look: is every camera where the photo was taken? A photo placed from one corner can land wrong; leave it out (`3 out`).
- `measured/NN.png`: each photo with its corners and where it was placed; `marks/NN.png` the marks close up.
- `sides/`: each side's photo squared up face-on (`C1-C2 Name.png`), a grid copy (`... grid.png`: a grid every 100 px, the side's ends and ground dashed green, a foot ruler), and `frames.json`. A side sheared or floating off its green ground line has a corner numbered wrong on its photo: two corners fit any of four placements, so the solve can't object.
- `measured.json`: the exterior as measured.

**Marks**: a mark is where the measure thinks the corner is, so a wrong measure marks it wrong. Keep one only when it sits on that corner's own edge, by name. Never all at once: marks land on railings, bushes, benches, open driveway, and keeping those makes a wrong answer look sure. A mark on a hidden corner (behind a pilaster) is the measure's own projection: leave it.

### 6. Read the accuracy table

- **Each tape held out in turn**: the house solved from the other tapes, the held-out one predicted (a wall's from its side, a line's from its own photo's view), against the tape. It runs on your own corners only: a kept mark was made by a measure with every tape in and would carry the held-out tape back in.
- **With one tape** there is nothing to hold out; the checks (door heights) are the only cross-check, labelled a sanity check: doors vary by a few percent. With sizes estimated on site, that one tape is held out against them (the estimates stay in every hold-out, named under "scaled by").
- **The tapes' directions**: when every tape runs the same way (across the front, say), nothing checks the other way, and results.md says so. A tape on a side running the other way checks it.
- **The ± are the solve's own**, about twice its sd. With two or three corners a photo, a box's depth rests on each photo's turn, which its vanishing points give to about a degree; a side whose inside corner shows in no photo reads ±30% or more. **A side with ± over 5% wants a tape: the advice names it.**

### 7. Read the walls: `reads.json`

For each side in `sides/` (read the grid copy; write in the plain image's pixels, which are the same), write the trace's wire format (`lib/exteriorTrace.ts` `TraceWire`), keyed by the side:

```json
{"sides": {"C1-C2": {"frame": {...from sides/frames.json...}, "wire": {
  "materials": [{"material": "vinyl", "polygon": [[420,1200],[1180,1200],[1180,700],[420,700]], "partly_hidden_by": ""}],
  "openings": [{"kind": "garage_door", "left": 560, "right": 1040, "top": 820, "bottom": 1200, "measured_to": "door_itself", "leaf": [], "partly_hidden_by": ""}],
  "wall_top": [[420,700],[1180,700]],
  "off_wall": [{"what": "column, wood", "box": [400,720,440,1200]}, {"what": "deck, wood", "box": [900,1100,1180,1200]}],
  "roof": {"over_wall": "eave", "rake_left": [], "rake_right": [], "eave_line": [], "left_end": {"kind": "hidden", "point": []}, "right_end": {"kind": "hidden", "point": []}, "notes": ""},
  "notes": ""}}}}
```

The rules are the trace prompt's (`traceUserMessage` in `lib/exteriorTrace.ts`): materials as polygons; openings to their trim's outer edge (a garage door to the door itself); the wall top where the cladding meets the soffit, peak included; trim, pilasters and columns as `off_wall` boxes whose words start `surround`, `keystone`, `pilaster`, `column`, `base`, `cap` (a roll-up door: a box whose words start `roll-up`); a deck's parts as boxes whose words start `deck`, `railing`, `stair`, `post`, `privacy screen`, `skirting` (`railing, glass`, `stair, 4 risers`): `report` puts them on the deck standing against that side; `roof.over_wall` gable / hip_end / eave. `frame` may be left out: `sides/frames.json`'s is used. A side may be skipped.

Walls read before on the same house as a Finish block can be laid on instead: `node scripts/house/finishReads.mjs <folder> <finish.json> <capture.json>`.

**What the building is**, in `inputs.json` `house`: `"cladding": "metal"` puts every side's band in that material till its walls are read; `"base": "grade"` takes the default 8" of parging off (a shed on a slab). **A wall's height taped** goes in `heights`: `[{"side": "C3-C4", "feet": 8, "said": "low wall 96 in"}]` sets that level wall's top and the ends of the sides either side, their read faces stretched to it. **A one-slope roof**: every eave is the low wall's (Scrivn's roof makes the high wall's extra), so set each eave to it and leave the faces and wall tops out of the reads.

### 8. The roof: `roof.json`, then `report`

`report` puts the reads on (as the trace's "Use these" does, everything ticked), then the roof check's answers from `scrivn/roof.json` if there is one, and prints **the roof check** as the pane shows it: each notch and wing with its choices and what Scrivn proposes, each end. Answer it in `roof.json` by side and run `report` again:

```json
{"pitch": "6/12", "overhangs": {"eave": 1, "rake": 0.75}, "material": "three_tab",
 "wings": {"C1-C2": "lower"}, "notches": {"C4-C5": "open"}, "ends": {"C2-C3": "hip"}, "drops": {"C1-C2": 2},
 "additions": [{"kind": "porch", "side": "C6-C7", "depthFeet": 6}, {"kind": "gable", "side": "C6-C7", "overDoor": true}],
 "oneSlopeTo": "C3-C4", "looksRight": true}
```

Wings: `tie` / `lower` / `gable`; notches: `open` / `covered`; ends: `gable` / `hip`; material: `three_tab`, `composite`, `metal`, `tile`, `cedar_shake`; additions: `porch` / `leanto` / `gable` (`overDoor` puts it over the side's door, which must be read); `looksRight` is the check's Looks right. It writes:

- `report.pdf`: the customer report, Scrivn's own (`exteriorReport` + `exteriorReportBytes`, as the phone's engine and the claim make it), with the side photos and the decks.
- `report.md`: walls, roof, the roof check, Check these, the roof lines, the scope lines and the deck lines.
- `exterior.json`: the exterior, checked as a claim would open it. For a request: `node scripts/return-exterior-request.mjs <id> <folder>/scrivn/exterior.json`.

## Decks

A deck or porch goes in `inputs.json` `decks`, against the wall it stands on, and is placed by Scrivn's own deck code (`lib/decks.ts`, `lib/deckPhotos.ts`) on the house as measured, as the Photos tab's Decks step places it:

```json
"decks": [{
  "name": "Back deck", "side": "C4-C5",
  "taps": [{"photo": 6, "point": "corner:0", "x": 1210, "y": 980}, {"photo": 7, "point": "corner:0", "x": 402, "y": 1010},
           {"photo": 6, "point": "corner:1", "x": 1655, "y": 1002}, {"photo": 8, "point": "corner:1", "x": 870, "y": 990},
           {"photo": 6, "point": "top:0", "x": 1210, "y": 880}],
  "depthFeet": 10, "heightFeet": 2.5, "heightOutFeet": 2, "decking": "wood",
  "railings": [{"edge": "outer", "kind": "wood", "heightFeet": 3, "fromFeet": 0, "toFeet": 6}],
  "stairs": [{"edge": "left", "atFeet": 4, "widthFeet": 4, "risers": 3, "railing": {"kind": "wood", "sides": 1}}],
  "posts": {"count": 4, "sizeInches": 4, "material": "wood"},
  "screens": [{"kind": "skirting", "edge": "outer", "heightFeet": 2, "material": "lattice"}]
}]
```

- **Its outer corners** (`corner:k`), each tapped where it meets the ground (a post's foot, or under the rim's corner) on two photos or more: their bearings cross on the plan. One photo alone sends its ray to the ground. **Its height**: `top:k`, the decking's edge over corner k, on a photo that shows that corner's foot too. The rest of it runs back to the house's walls, so a deck in a covered corner fills it.
- Or **by size**: `"fromFeet"`, `"toFeet"` along the wall from its left end as you face it, `"depthFeet"` out. With taps, a taped `depthFeet` alone reshapes it.
- `heightFeet` its top at the wall, `heightOutFeet` at its outer edge, `topOnWallFeet` for a porch whose wall was measured from the porch.
- **Edges** are the deck's own, numbered round it from its outer rim (0); `"outer"`, `"left"`, `"right"` name the rim and its open ends as you face the wall. `measure` prints each deck's edges with their lengths: put the railings, stairs and screens on them (`fromFeet`/`toFeet` along the edge, `atFeet` a stair's middle).
- Kinds: decking `composite` / `wood` / `membrane`; railings `glass` / `aluminum` / `wood` / `cable`; screens `privacy` / `skirting`, of `wood` / `vinyl` / `lattice` / `composite` / `aluminum`; posts `wood` / `aluminum` / `steel` / `concrete`.
- A deck tap from the review: `deck back 6 corner:0 = 1210,980` in `fixes.txt`.

`measure` prints each deck and puts it in results.md; `report` gives its lines (decking, railings, stairs, posts, screens, rim and ledger) in report.md and the PDF, and its Check these (framing and posts that no photo shows).

## Times

Each step prints its machine time and keeps it in `scrivn/times.json`: for 18 photos, prepare about 14 s, check 14 s, measure 25-35 s, report 4 s. The session's look is the rest; see "The looks, in order" at the top.

## One report for a site

`node scripts/house/site.mjs <out.pdf> <house folder> <shed folder>:Shed ...`: each folder's `scrivn/exterior.json` as one claim (Scrivn's `siteReport`), each building its own section with its own side photos.

Results on the test houses are kept out of this file, so that a blind run can use it.
