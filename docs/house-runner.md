# The test-house runner (2026-10-20)

A folder of photos of a house plus a few tapes in words becomes the measured exterior, an accuracy table and the customer report. Scrivn's own code does all of it on this machine (the photo route, the roof, the trace's reading of a wall, the report), so a house measured here is measured exactly as scrivn.ca measures it. **No API call is made anywhere.** A Claude session does the looking: it draws the shape, puts the corners on the photos, checks Scrivn's numbers and marks, and reads the walls off the squared sides.

```
node scripts/house/run.mjs <folder> prepare        # ~15 s for 18 photos
node scripts/house/run.mjs <folder> check          # ~15 s
node scripts/house/run.mjs <folder> measure        # ~25-35 s, hold-outs included
node scripts/house/run.mjs <folder> report         # ~4 s
node scripts/house/run.mjs <folder> zoom 7 1290,1260 1400,1150 --half 100     # close looks, any time
```

`<folder>` is either a folder of photos with `tapes.txt` (and `house.txt`) beside them, or a pulled Send-to-team request (`exterior-requests/<id>/`, from `node scripts/pull-exterior-request.mjs <id>`). Everything the runner writes goes in `<folder>/scrivn/`; the photos are never touched.

## What the session does, step by step

### 1. The folder

- The photos as the phone took them, any names (a phone's `20261016_124948.jpg` names give the walk's order; otherwise the EXIF date, otherwise the file's time).
- `tapes.txt`: one tape a line, in plain words. The first length on the line is the tape; what it is comes from the words.
  ```
  garage doors 9' wide
  rear wall with the hose 22'2"
  porch 263 in
  ```
  Lengths: `22'2"`, `22' 2 1/2"`, `22 ft 2 in`, `263"`, `263 in`, `9'`, `6.5 m`, `650 cm`. Door, window, garage or roll-up words make a **line on a photo** (its two ends placed on the photo); wall, side, front, rear, porch, gable words make a **wall's length**, corner to corner. "doors" or "both" means the same tape across each.
- `house.txt` (optional), a line each: `semi-detached` / `end townhouse` / `townhouse` / `side-split` / `duplex`; `front faces north` (or `NE`, `16`, `unknown`); `name: 52 Elm St`; anything else is kept as a note.
- A pulled request has none of these: its `request.json` carries the tester's photos, shape, corner taps and tapes, and the draft starts from them. Read the tester's note: tapes in words go into `inputs.json` by hand.

### 2. `prepare`, then look

It levels every photo and estimates the lens, finds each photo's **corner candidates** (its long upright edges reaching below eye level, lettered a–h, orange), and writes:

- `scrivn/contact.png`: every photo small, numbered #1, #2... in walk order. **Look at this first**: what each photo shows, and the house's shape.
- `scrivn/sheets/NN.png`: each photo with a grid in its own pixels, the candidates, and the shape beside it.
- `scrivn/inputs.json`: the draft to fill in. A folder's draft has a placeholder 40' x 30' shape and the tapes from `tapes.txt`; a request's has the tester's shape, taps and tapes.

### 3. Fill in `inputs.json`

**The shape** (`shape.outline`): the house's corners as plan feet `[x, y]`, **counter-clockwise seen from above, the street at the bottom** (y grows away from the street). Rough is right: draw it on a 1 ft grid as the owner would sketch it, every wall square to the plan. The measure fits the lengths; the shape only says which corner is which. Corner k is `C(k+1)` on every sheet; the side from C5 to C6 is `C5-C6`. Set `shape.from` to `"session"`. Name the sides if you like (`shape.names: {"C1-C2": "Garage front, left bay"}`): the report uses them.

**The home** (`house`): `name`, `homeType` (detached, semi, town_end, town_middle, split, duplex_updown), `shared` (party walls, e.g. `["C3-C4"]`), `frontFacesDeg` (or null).

**The corners** (`corners`): one entry per corner seen on a photo, **where the wall meets the ground** (the foot of the corner, on the wall's bottom edge, not below it on the grass or the pad):

```json
{"photo": 6, "x": 780, "y": 1150, "corner": "C10"},
{"photo": 6, "x": 1340, "y": 1010},
{"photo": 3, "pick": "c", "y": 1000, "corner": "C10"}
```

- `x`, `y` in the photo's own pixels (the sheet's grid), or `pick` a candidate's letter; `pick` with a `y` follows that edge down to the ground row you give.
- **Name at least one corner on each photo** (`"corner": "C10"`); Scrivn numbers the rest as the next corners round the house, left to right. **Name every one on a photo that skips a corner** (one hidden behind a wing or a porch): Scrivn's numbering assumes they run on.
- A pilaster or a post at a corner: tap the edge standing at the corner. The 10-16 proof found these read fine at a few pixels.
- A photo showing one corner only can still be listed, but it seldom places (below). The photos that place best show a corner at 45 degrees with both walls in.

**The tapes** (`tapes`):
- a wall's length: `"side": "C5-C6"`;
- a line on a photo: `"on": [{"photo": 15, "a": [497, 900], "b": [868, 900]}]`, one entry for each alike thing it covers (both garage doors). Put the ends on the jambs at mid-height. **Say in a `note` what the ends are on** when it could be either (a roll-up door's curtain or its frame): on the shed that choice moved the whole scale by 15%.
- `"skip": true` leaves a tape out.

**Checks** (`checks`), optional: a line on a photo you expect a length for, as a sanity check, never a tape: `{"photo": 3, "a": [698, 515], "b": [712, 1073], "feet": 6.6667, "what": "man door slab (usually 6'8\")"}`. With one tape these are the only cross-check there is.

### 4. `check`, then look again

It reads `inputs.json` exactly as the route will, and says plainly what is missing (✗ lines). It numbers the corners, places each photo on the shape from its corners alone, and lists which photos face a tape's wall. Then it draws:

- `scrivn/contact.png` and `sheets/NN.png` with the numbers: **green** named by you, **cyan** numbered by Scrivn, **red** no number. Check every cyan number against the photo and the shape beside it. On the owner's house Scrivn numbered #17 C11, C12, C1 from one name, where the garage's pilasters are C1 and C4.
- `scrivn/taps/NN.png`: **each corner close up**, red where you put it, green where Scrivn's snap moves it. The red cross must sit on the corner's foot. If a crop shows only grass or pad, the tap is off: on the shed, a first pass read off the sheets was 40-70 px low on every corner, and the rms was 3.2 instead of 0.6.
- `zoom <photo> x,y x,y ...` gives the same close look anywhere, with where a tap there would snap.

Fix, `check` again, until it says **Ready to measure**.

### 5. `measure`, then look at where each photo stood

It runs the route's measure (lines, lens, levelling, the plan bundle solve with wall edges tied across photos) and writes:

- `results.md`: the outline with ± per side, the accuracy table, the advice, the photos not used, and the corners Scrivn marks.
- `plan.png`: the measured plan with every placed photo where the solve put it.
- `measured/NN.png`: each photo with its corners, **"here" on the plan where it was placed**, and Scrivn's proposed corners (pink, dashed).
- `sides/`: each side's photo squared up face-on (`C1-C2 Name.png`), a grid copy (`... grid.png`: a grid every 100 px, the side's ends and ground dashed green, a foot ruler), and `frames.json`.
- `measured.json`: the exterior as measured.

Look at `plan.png` and each `measured/NN.png`:
- **Every camera where the photo was taken?** A photo placed from one corner, or from two (four quarter-turns fit two corners; the walk order picks), can land wrong: the owner's #1 and the shed's #1 both did. Put such a photo in `"leaveOut": [1]`. With #1 left in, the house's bump-out hold-out was −6.9%; left out, −0.6%.
- **Each squared side in `sides/`** (the grid copies): the wall's foot should sit on the dashed green ground line, its ends on the dashed green ends. A side sheared or floating off the line has a corner numbered wrong on its photo: the shed's #7 was numbered one corner off (C3 C4 for C2 C3), and since two corners fit any of four placements the solve could not object; its rear wall came out sheared.
- **Scrivn's marks** (pink): the corners each placed photo should show that nobody tapped. Keep them all with `"keepProposed": true` ("Looks right"), less any wrong one in `"dropProposed": ["14:C9"]`, and measure again. They tightened every ± on the house.

### 6. Read the accuracy table

- **Each tape held out in turn**: the house solved from the other tapes, the held-out one predicted (a wall's from its side, a line's from its own photo's view), against the tape.
- **With one tape** there is nothing to hold out; the checks (door heights) are the only cross-check, labelled a sanity check: doors vary (the proof's two doors differed by 5%).
- **The tapes' directions**: when every tape runs the same way (across the front, say), nothing checks the other way, and results.md says so. On the owner's house all three tapes run across; the hold-outs were within 1% while the bump-out's west side (front to back) read 8'2" ±7% against the proof's 5'6". A tape on a side running the other way checks it.
- The ± are the solve's own, about twice its sd. After Looks right they can be optimistic on a side no tape reaches: trust the advice list.

### 7. Read the walls: `reads.json`

For each side in `sides/` (read the grid copy; write in the plain image's pixels, which are the same), write the trace's wire format (`lib/exteriorTrace.ts` `TraceWire`), keyed by the side:

```json
{"sides": {"C1-C2": {"frame": {...from sides/frames.json...}, "wire": {
  "materials": [{"material": "stucco", "polygon": [[437,1238],[1162,1238],[1162,748],[437,748]], "partly_hidden_by": ""}],
  "openings": [{"kind": "garage_door", "left": 572, "right": 1030, "top": 828, "bottom": 1240, "measured_to": "door_itself", "leaf": [], "partly_hidden_by": ""}],
  "wall_top": [[437,748],[1162,748]],
  "off_wall": [{"what": "pilaster, stucco", "box": [430,750,500,1225]}, {"what": "surround, stucco", "box": [540,800,1060,1240]}],
  "roof": {"over_wall": "eave", "rake_left": [], "rake_right": [], "eave_line": [], "left_end": {"kind": "hidden", "point": []}, "right_end": {"kind": "hidden", "point": []}, "notes": ""},
  "notes": ""}}}}
```

The rules are the trace prompt's (`traceUserMessage` in `lib/exteriorTrace.ts`): materials as polygons; openings to their trim's outer edge (a garage door to the door itself); the wall top where the cladding meets the soffit, peak included; trim, pilasters and columns as `off_wall` boxes whose words start `surround`, `keystone`, `pilaster`, `column`, `base`, `cap` (a roll-up door: a box whose words start `roll-up`); `roof.over_wall` gable / hip_end / eave. `frame` may be left out: `sides/frames.json`'s is used. A side may be skipped. Model: `test/exterior/fixtures/photo-route/owner-1016-reads.json`.

Walls read before on the same house as a Finish block can be laid on instead: `node scripts/house/finishReads.mjs <folder> <finish.json> <capture.json>` (the owner's house: `test/exterior/fixtures/photos-only-1016-trim.json` on `photos-only-1016.json`).

### 8. The roof: `roof.json`, then `report`

`report` puts the reads on (as the trace's "Use these" does, everything ticked), then the roof check's answers from `scrivn/roof.json` if there is one, and prints **the roof check** as the pane shows it: each notch and wing with its choices and what Scrivn proposes, each end. Answer it in `roof.json` by side and run `report` again:

```json
{"pitch": "5/12", "overhangs": {"eave": 1.333, "rake": 1}, "material": "composite",
 "wings": {"C1-C2": "gable"}, "notches": {"C8-C9": "covered"}, "ends": {"C10-C11": "gable"}, "drops": {"C1-C2": 1.5},
 "additions": [{"kind": "porch", "side": "C11-C12", "depthFeet": 4.833}, {"kind": "gable", "side": "C11-C12", "overDoor": true}],
 "oneSlopeTo": "C3-C4", "looksRight": true}
```

Wings: `tie` / `lower` / `gable`; notches: `open` / `covered`; material: `three_tab`, `composite`, `metal`, `tile`, `cedar_shake`; additions: `porch` / `leanto` / `gable` (`overDoor` puts it over the side's door, which must be read); `looksRight` is the check's Looks right. It writes:

- `report.pdf`: the customer report, Scrivn's own (`exteriorReport` + `exteriorReportBytes`, as the phone's engine and the claim make it), with the side photos.
- `report.md`: walls, roof, the roof check, Check these, the roof lines and the scope lines.
- `exterior.json`: the exterior, checked as a claim would open it. For a request: `node scripts/return-exterior-request.mjs <id> <folder>/scrivn/exterior.json`.

## Times

Each step prints its machine time and keeps it in `scrivn/times.json`. On the owner's 18 photos: prepare 14 s, check 14 s, measure 24-35 s (two measures with Looks right, hold-outs 2-8 s), report 4 s. The session's look is the rest: the contact sheet, 15 sheets and tap strips, a few zooms, and the measured sheets.

## The proof (2026-10-20)

- **The owner's house** (C:/Users/Anthony/Desktop/House Photos, tapes porch 263", garage doors 9', bump-out 22'2"): each tape held out in turn, predicted from the other two: doors +0.5%, bump-out −0.6%, porch −0.3%. Machine time 62 s (prepare 15, check 15, measure 28, report 4). The fixture's own 10-16 taps through the runner reproduce `test:exterior:photos`'s all-tapes table to the inch. All three tapes run across the house: the depth is unchecked, and the bump-out's west side reads 8'2" ±7% against the proof's 5'6".
- **The shed** (C:/Users/Anthony/Desktop/Shed photos, roll-up door 5'): 15'8" x 12'3" (the 10-17 bundle solve: 16'3" x 12'4", ±6%), rms 0.84; one tape, so no hold-out; the man door's slab reads 6'0" against the usual 6'8" (−9%), which says the one tape may set it small; a wall's length would settle it. Its walls read by eye off `sides/`: window 3'0" x 2'6" and man door 3'0" x 6'10", as the 10-17 session read them.
- **A pulled request** made from the owner's photos (`test/exterior/houseRequestFolder.mjs`): prepare starts from the tester's shape, 30 taps and 4 tapes; measure lands every side within its ± of `test:exterior:photos`, and holds each of the 4 tapes out.
- `npm run test:exterior:house` runs all three (about two minutes).
