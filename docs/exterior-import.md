# Scan's exterior into Scrivn: `arcapture-exterior/1` and `/2`

Agreed 2026-10-12 between the Scrivn exterior session and Scan's "Exterior mode" session. Scrivn reads Scan's own formats as they are. The reader is `lib/exteriorImport.ts`, and `test/exterior/run.mjs` checks it against these files:

- `/1`:
  - `test/exterior/fixtures/scan-exterior-sample.json`: Scan's output for its unit-test house;
  - `scan-exterior-send.json`: an exterior-only Send body;
  - `scan-exterior-handwritten.json`: an L, walked to the left, written by hand.
- `/2`:
  - `scan-exterior-v2-sample.json`: the owner's own gable side, tapped as shapes;
  - `scan-exterior-v2-send.json`: its Send body;
  - `scan-exterior-v2-walk-1420.json`: the owner's real walk of six sides at 14:20 on 10-12. It was written before Scan's `def1456`, so it carries the old misreadings Scrivn now guards against.

## How it arrives

Any of these three works.

1. **The file Scan's Export writes** (`room_<stamp>_exterior.json`), through **Import scan** in the sketch editor. The editor then opens on the Exterior.
2. **Inside a capture**, under a top-level `"exterior"` key of the JSON a phone sends as `capture`. The rooms are adopted as always, and the exterior comes in with them.
3. **A capture with `"rooms": []` and the `"exterior"` key**: the outside only. This is how Scan's "Exterior sketch" at Start always sends it. The claim's rooms, and the storey ownership that `sketch.scan` records, are not touched.

The body may come as an object or as its JSON text.

**When it replaces what is there:**
- **Straight in** when the claim has no exterior, or its exterior came from a scan and nobody has changed a measurement since.
- **Asked first** when the exterior was typed or corrected in Scrivn: `exteriorScanDecision` on a phone send, and "Replace it / Keep mine" on Import scan.
- **Kept, with a note**, when it rides in with rooms and the claim's exterior was typed or corrected in Scrivn.

Ticking what is in scope doesn't count as a change.

## Conventions

- **Units:** metres in the file, feet in Scrivn (÷ 0.3048).
- **Heights:** every height on a side is above ONE level. That level is one of:
  - `grade: "ground"`: Scan's ground estimate where that side was tapped;
  - `grade: "corners"`: the lower bottom corner;
  - `grade: "parging"`: the average of the parging's bottom corners, tapped at the ground (since `def1456`; Scan now uses its ground estimate only when it reads below the bottom corners and the phone).

  All three read the same in Scrivn. Scrivn marks such a side `heightsFrom: "level"` and reads no slope of the ground from it. A slope comes only from heights typed by hand, each from the grade under it.
- **Walk direction:** `walk: "right"` means each next side is to the right of the last as you face them from outside (counter-clockwise seen from above). With `"left"`, Scrivn reverses the ring after the first side, so the Front stays first.
- **Left and right:** "left", "right" and every `*_along_m` / `from_m` are as seen from outside, measured from the side's left end, whichever way the walk went.

## Top level

| key | Scrivn |
|---|---|
| `format` | `"arcapture-exterior/1"` or `"arcapture-exterior/2"` |
| `sides[]` | one `ExteriorSide` each (below), at most 40 |
| `corners[]` | `outside: false` makes an inside corner. It belongs to side `from` when walking right, side `to` when walking left. Missing means outside. |
| `walk` | ring order (above) |
| `closed` | when false, there's a note, and no footprint or roof is built until the estimator works on the sides: six sides of a house with some missed can add up to four corners by chance |
| `scale` | a note when it isn't 1 (already applied by Scan) |
| `capture_id` | kept on `exterior.source` |
| `roof` (optional) | `pitch_in_12` (or `pitch_12`), `eave_overhang_m`, `rake_overhang_m`; these win over the roofline's overhangs |
| `footprint`, `footprint_xy`, `links`, `taps`, `frame`, `taped` | not read. Scrivn rebuilds the footprint from `length_m` and the corner flags, squared to 90°, and shares any closing gap over the sides by length. |

## A side

| key | Scrivn (`lib/exterior.ts` `ExteriorSide`) |
|---|---|
| `name` | `name` |
| `length_m` | `lengthFeet` |
| `bottom_left_m`, `bottom_right_m` | `baseLeftFeet`, `baseRightFeet` with base `"parging"`. Both about 0 means base `"grade"`. |
| `eave_left_m`, `eave_right_m` | `/1`: both set to the mean of the two taps (one eave line read twice); a difference over 1 in is named in the notes. `/2`: kept as they are, since they are worked out from the shapes and a stepped gable really has two. Null (and no shapes) keeps the side but gives it no area until an eave is typed. |
| `peak` `{along_m, height_m}` | `gable {atFeet, peakFeet}`, only when the peak stands at least 0.3 m over both eaves and `pitch_12` is not under 1.5/12. These are Scan's own rules since `def1456`, kept so older files read the same. |
| `peak.from_m`, `peak.to_m` (optional) | `gable.fromFeet`, `gable.toFeet`: a gable over part of the wall. Scan doesn't send them; read when present. |
| `pitch_12` | `pitchMeasured`: believed over the pitch Scrivn would work out from the peak. A value under 1.5/12 is not a gable's pitch and is dropped. |
| `shapes[]` (`/2`) `{material, label, closed, polygon: [[along, up]...], overlaps?}` | `shapes`: a polygon per material in the side's own frame. When there are any, they ARE the side's cladding, instead of bands, and the roof adds no gable over them. Scrivn works out each closed shape's area itself, less every opening where it overlaps it (a window across two materials comes out of both). Where two shapes overlap, Scrivn works out the overlap itself and counts it once, as the shape tapped later: the one laid on top, such as a stone wainscot over a stucco wall. It names the side in the notes; `overlaps` is not needed for this. An opening in the overlap comes out of the later shape only. `"parging"` is drawn and not counted. A shape with `closed: false` (left open when a capture was stopped mid-shape) is drawn dashed, not counted, and named in the notes. The bottom edges of the parging shapes are drawn as the ground. |
| `roofline[]` (`/2`) `{kind, along_m, up_m, out_m}`, up to 8 points | `roofline`, drawn dashed on the elevation. `kind` is `left_end`, `peak`, `right_end`, or `point` (a turn in the roof edge between its ends). Without a kind, Scrivn reads the points by order and height. A peak must stand at least 0.3 m above both ends, whatever its label. On a side whose roofline has a peak, `out_m` is the rake overhang; on one without, the eave overhang. Each overhang is the median over the sides, and replaces the 16"/12" defaults. A roofline reaching more than 0.6 m beyond the usual overhang past a wall's end is named ("the roof runs 10'2" past Front's left end, over a porch or deck"). The roof plan doesn't draw that yet. Since Scan's `60ac337` the roofline is `[]` (siding elevations only, for now): the overhangs stay at the defaults or what the estimator types, and there are no past-the-end notes. Older files with a roofline still read as above. |
| `cladding` | the band a side falls back to when its shapes are set aside by hand (and the top band of a `/1` side) |
| `bands[]` (`/1`) `{height_m, along_m, below}` | bands bottom up: `below` is the cladding under the line, which is level at `height_m`. A band whose `below` is `"parging"` is the bottom of the cladding, not a band. `/2` sends `[]`. |
| `openings[]` `{kind, from_m, width_m, sill_m, head_m}` | `{kind, fromLeftFeet, widthFeet, sillFeet, heightFeet = head − sill}`. `kind` is `window`, `door` or `garage` (Scan sends doors 2.3 m or wider as `garage`). Anything else reads as a window. At most 100 per side. |
| `net_sf` / `shapes[].net_m2` | checked. Scrivn works out the side's net area itself and names any side where the two differ by more than 2%. For a `/2` side, it compares against the shapes of cladding only. Scrivn takes out only the part of an opening that is in the cladding. On the 14:20 walk, two garage doors ran 5–7 in below the stucco's bottom edge; Scan took each door out whole, and the note names both sides. Since Scan's `4078b84`, Scan also takes out only the part of each opening that falls inside each shape, so the two agree. Where shapes overlap, Scan's per-shape figures still take an opening in the overlap out of both, and Scrivn names that side. |
| `photos[]` (Scan 0.1.151) `{n, camera, to_photo, in_view}` | `photos`: each photo's number, camera, `to_photo` (kept in Scan's metres) and `in_view`, with the scan id it came with. At most 8 a side; one whose `to_photo` isn't 9 numbers, or whose `n` is outside 900-999, is passed over. A file brings no pictures, so its photos are kept with no scan id and the notes say so. See "The sides' photos" below. |
| `outline`, `areas`, `gross_sf`, `opening_trim_m`, `index`, `left_joined`, `right_joined`, `eave_taps`, `shapes[].area_m2`, `shapes[].openings_m2`, `photos[].file`, `.position`, `.forward`, `.up`, `.t_s`, `.epoch` | not read |

Cladding kinds are Scan's list: `stucco`, `vinyl`, `wood_shake`, `eifs`, `wood`, `fibre_cement`, `brick`, `stone` and `metal` (`parging` for shapes). Anything else comes in as "Other", labelled with the word Scan sent.

## Settled with Scan

- `/1` (its commit `fe1916c`):
  - bands carry `along_m`, which Scrivn doesn't need;
  - a door 2.3 m or wider is sent as `garage`;
  - Send puts the exterior under `"exterior"` in the capture.
- `/2` (its commit `4cb9ca1`):
  - each material is tapped round as a shape;
  - the roofline is the roof edge's ends and its peak;
  - Exterior is its own capture at Start ("Exterior sketch"), so a Send is always `rooms: []` plus `"exterior"`.
- `/2` additions (its commit `411dc42`):
  - each roofline point has a `kind`, and a lone point is the end it is nearer to;
  - shapes sharing 0.1 m² or more list each other in `overlaps`;
  - materials, in the picker's order: stucco, vinyl, wood_shake, eifs, wood, fibre_cement, brick, stone, metal, parging;
  - every shape carries a `label`.
- Siding elevations only (its commit `60ac337`, the owner's call on 2026-10-12):
  - Scan no longer captures a roofline, so `roofline` is `[]`;
  - `pitch_12` and `peak` still come from a gable's shape when a side has one;
  - the roof comes from the estimator in Scrivn (footprint, overhangs, pitch). The roof from Scan is off the table for now.
  - Since 2026-10-13, a walk with no gable measured comes in with its roof drawn at an assumed 6/12, said to be assumed on the plan, the scope and the documents until the estimator types the pitch. The import lands on the same Plan & roof and face-on side screens as an exterior drawn by hand.

## The sides' photos (Scan 0.1.151, 2026-10-12)

Scan's Photo chip takes a still per side with ARCore's pose. The JPEG goes to `POST /api/device/scans/<scan id>/photos?n=<n>` (n from 900) and lands with the scan's other photos (`lib/scanPhotos.ts`).

- **Squared up** (`lib/exteriorPhoto.ts`): `to_photo` takes (along, up) metres of the side's elevation to the photo's pixel; w > 0 is in front of the camera, as Scan's own `SidePhoto.project` reads it.
  - The editor squares each side's photos in a canvas. It walks each pixel's point on the wall through `to_photo` and reads the photo bilinearly. Where stills overlap, it reads the one that has the point nearest its middle.
  - The squared image covers the side and a margin, cut to what the photos hold: 2.5 m along, 0.6 m below and 1.5 m above. Its longer edge is 2400 px.
  - What no photo shows is mid-grey (128).
  - The photo lies behind the elevation, with **No photo / Photo faded / Photo** to switch it.
- **AI trace** (`lib/exteriorTrace.ts`, `POST /api/exterior/trace`): one Claude call (Opus 5.5, effort high, structured output) per side, on the very JPEG the estimator sees.
  - It is told the image's size, the pixels a metre, where the side's ends and bottom corners fall, and which ends are out of the photo.
  - It answers in pixels: a polygon per material, the openings (a garage door to the door itself, never its surround), the wall-top line, and boxes for what stands in front of the wall.
  - The code turns the pixels into the side's feet.
  - The estimator ticks what goes on the side, changing a material or an opening's kind on the way:
    - ticked shapes replace its shapes, ticked openings its openings;
    - the wall top sets the eaves, and the peak and pitch when it has one.
  - The checks from the owner's test are shown: both slopes of a gable alike, an eave level end to end.
  - An opening wholly below the side's level is left out and named.
  - Checked against the plan as extraction is (`checkUsageAllowed`), not counted.
  - Each call is logged as one line: tokens, seconds and its cost at Opus 5.5's $4 / $20 per million.
- **Tests:**
  - `npm run test:exterior` reads the photos (`scan-exterior-v2-photos.json`, with Scan's own square-on numbers). It checks `to_photo` and its inverse against an independent pinhole camera, and squares an oblique photo of a painted window back to the pixel.
  - `npm run test:exterior:trace` runs one real call (about $0.05) against a running dev server. A painted wall, photographed off to one side and tipped up, comes back within 1.5" an edge.
- **Measured on 2026-10-12:**
  - **Painted wall:** every edge within 0.2"; 13 s, $0.047.
  - **The owner's west gable,** re-photographed obliquely from its squared photo of the 10-12 test: the tall window within 0.6" of the hand marks, the peak within 0.3"; 25 s, $0.063.
