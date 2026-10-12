# Scan's exterior into Scrivn: `arcapture-exterior/1`

Agreed 2026-10-12 between the Scrivn exterior session and Scan's "Exterior mode" session. Scrivn reads Scan's own format as it is. The reader is `lib/exteriorImport.ts`, and `test/exterior/run.mjs` checks it against two files:

- `test/exterior/fixtures/scan-exterior-sample.json`: Scan's real output for its unit-test house;
- `test/exterior/fixtures/scan-exterior-handwritten.json`: an L, walked to the left, written by hand.

## How it arrives

Any of these three works.

1. **The file Scan's Export writes** (`room_<stamp>_exterior.json`), through **Import scan** in the sketch editor. The editor then opens on the Exterior.
2. **Inside a capture**, under a top-level `"exterior"` key of the JSON a phone sends as `capture`. The rooms are adopted as always, and the exterior comes in with them.
3. **A capture with `"rooms": []` and the `"exterior"` key**: the outside only. The claim's rooms, and the storey ownership that `sketch.scan` records, are not touched.

The body may come as an object or as its JSON text.

**When it replaces what is there:**
- **Straight in** when the claim has no exterior, or its exterior came from a scan and nobody has changed a measurement since.
- **Asked first** when the exterior was typed or corrected in Scrivn: `exteriorScanDecision` on a phone send, and "Replace it / Keep mine" on Import scan.
- **Kept, with a note**, when it rides in with rooms and the claim's exterior was typed or corrected in Scrivn.

Ticking what is in scope doesn't count as a change.

## Conventions

- **Units:** metres in the file, feet in Scrivn (÷ 0.3048).
- **Heights:** every height is above the grade *under that point*. When `grade` is `"corners"`, Scrivn reads it the same as `"ground"`.
- **Walk direction:** `walk: "right"` means each next side is to the right of the last as you face them from outside (counter-clockwise seen from above). With `"left"`, Scrivn reverses the ring after the first side, so the Front stays first.
- **Left and right:** "left", "right" and every `*_along_m` / `from_m` are as seen from outside, measured from the side's left end. That holds whichever way the walk went.

## Top level

| key | Scrivn |
|---|---|
| `format` | must be `"arcapture-exterior/1"` |
| `sides[]` | one `ExteriorSide` each (below), at most 40 |
| `corners[]` | `outside: false` makes an inside corner. It belongs to side `from` when walking right, side `to` when walking left. Missing means outside. |
| `walk` | ring order (above) |
| `closed` | a note when false: no footprint or roof until the rest are put in |
| `scale` | a note when it isn't 1 (already applied by Scan) |
| `capture_id` | kept on `exterior.source` |
| `roof` (optional) | `pitch_in_12` (or `pitch_12`), `eave_overhang_m`, `rake_overhang_m` |
| `footprint`, `footprint_xy`, `links`, `taps`, `frame`, `taped` | not read. Scrivn rebuilds the footprint from `length_m` and the corner flags, squared to 90°, and shares any closing gap over the sides by length. |

## A side

| key | Scrivn (`lib/exterior.ts` `ExteriorSide`) |
|---|---|
| `name` | `name` |
| `length_m` | `lengthFeet` |
| `bottom_left_m`, `bottom_right_m` | `baseLeftFeet`, `baseRightFeet` with base `"parging"`. Both about 0 means base `"grade"`. |
| `eave_left_m`, `eave_right_m` | `eaveLeftFeet`, `eaveRightFeet`. The eave is level, so right minus left is the grade's fall. Null keeps the side but gives it no area until an eave is typed. |
| `peak` `{along_m, height_m}` | `gable {atFeet, peakFeet}` |
| `peak.from_m`, `peak.to_m` (optional) | `gable.fromFeet`, `gable.toFeet`, when the gable spans only part of the wall (an L). Default is the whole wall. |
| `cladding` | the top band (to the top, gable included) |
| `bands[]` `{height_m, below, along_m?}` | bands bottom up: `below` is the cladding under the line, and the line is level. With `along_m`, the height becomes the level line's height above the grade at the left corner, using the fall. Without it, it is taken as at the left end. A band whose `below` is `"parging"` is the bottom of the cladding, not a band. |
| `openings[]` `{kind, from_m, width_m, sill_m, head_m}` | `{kind, fromLeftFeet, widthFeet, sillFeet, heightFeet = head − sill}`. `kind` is `window`, `door` or `garage`; anything else reads as a window. At most 100 per side. |
| `pitch_12` | not read: Scrivn works pitch out of the peak and the eave itself |
| `net_sf` | checked: Scrivn works the side's net area out itself, and names any side where the two differ by more than 2% |
| `outline`, `areas`, `gross_sf`, `opening_trim_m`, `index`, `left_joined`, `right_joined`, `eave_taps` | not read |

Cladding kinds are Scan's list: `stucco`, `vinyl`, `wood`, `fibre_cement`, `brick`, `stone`, `metal`. Anything else comes in as "Other" labelled with the word Scan sent.

## Asked of Scan, all optional

- `bands[].along_m`, so a band line tapped mid-wall lands level on a sloping grade.
- Opening `kind: "garage"` for overhead doors.
- `peak.from_m` / `peak.to_m` for a gable over part of a wall.

## Not in the format

The overhang, soffit and fascia. Scrivn types the eave and rake overhangs on Roof & footprint. Whether Scan gets an Overhang tap is the owner's decision.
