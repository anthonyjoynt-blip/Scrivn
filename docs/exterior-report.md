# Finish exterior and the exterior report (2026-10-15)

The owner, looking at Scan's exterior: "so what about the roof from photos? and really that should be able to complete the exteriors as well and generate a pdf with all elevations, roof sketch, photos, all measurements listed".

- **On the phone:** Finish exterior reads the roof off the side photos and shows it on Review, to accept or change. It also fills in each photographed side's walls where nothing was tapped (below, "The walls off the photos"). Share makes the exterior report.
- **On scrivn.ca:** the claim has the same report, Exterior report (PDF), beside the drying log, and in Send documents.
- **The two agree because they are the same code.** `test:exterior:engine` proves it on the owner's own walk.

## How it fits together

| Piece | Where | What |
|---|---|---|
| The engine | `lib/scanEngine.ts`, `lib/scanEngineWebView.ts`, built by `scripts/build-scan-engine.mjs` into Scan's `app/src/main/assets/scrivn-exterior.js` | Scrivn's own exterior code, run in an off-screen WebView on the phone (Scan's `ExteriorEngine.kt`). Four calls: `summary`, `prepare`, `take`, `report`. |
| The trace | `POST /api/device/exterior/trace` (device token), `lib/traceCall.ts` | The editor's own call (`/api/exterior/trace` shares `lib/traceCall.ts`). It counts the capture as the scan (`takeScan`, "saved"), once, so a capture read here and sent later is one scan. |
| The Finish block | `lib/exteriorFinish.ts` | What the phone keeps and sends: each side's roof read, the pitch typed, the ends switched, accepted. The Scan import applies it (docs/exterior-import.md, `finish`). |
| The report | `lib/exteriorReport.ts` (what), `lib/exteriorReportPdf.ts` (drawn), `lib/svgPdf.ts` (Scrivn's SVG drawings painted as PDF lines) | One report, the same on the phone and the claim. |
| The claim's report | `components/sketch/exteriorReportDoc.ts`, `components/ExteriorReportSection.tsx` | The report with the company's letterhead and the scan's side photos, made in the browser. |

### Why the engine, and not a port or the server

- **Not a Kotlin port of `lib/roof.ts`.** The roof and the rules round it (`lib/exterior.ts`) are about 6,000 lines that change weekly. A port is a second roof, and it drifts the day either changes.
- **Not the roof built on Scrivn's server.** With no signal or no account the phone would have no roof at all, and every change on Review would wait for the network.
- **The engine runs the very code scrivn.ca runs, on the phone, offline.** Only the trace needs signal.
- **Keeping it current:** the script names the Scrivn commit it was built from (`scrivn 9b22bde`). Review's log line and the report's footer carry it.
  - When the exterior, roof or report code changes here, run `node scripts/build-scan-engine.mjs` and rebuild Scan. `--check` says whether Scan's copy is this build.
  - `test:exterior:engine` prints a NOTE when Scan's copy is behind.

## Finish exterior on the phone

1. **Stop** an exterior capture with side photos and Scan offers **Finish exterior** once. Review's **Roof** button does the same any time.
2. **Each side with photos not yet read:**
   - Its photos are squared up exactly as the editor squares them: same frame, same pixels, 2,400 px on the long edge.
   - They are sent to the trace, three sides at a time.
   - The answer's lines are set on the photo's own edges (`snapTrace`), and the reads that hold together are ticked as the editor ticks them first (`roofPicksAtFirst`, `shapePicksAtFirst`).
   - The roof is taken, and the side's walls from the same answer: put on only where nothing was tapped (below).
3. **A side is read once.** It is read again only when it is photographed again or the tape changes (`sidesToRead`). A dropped signal loses only the side in hand.
4. **The roof screen** shows:
   - Scrivn's roof plan, with each end's Gable or Hip;
   - the pitch and where it came from;
   - each part with its own pitch;
   - the overhangs, the line totals, each side's read in words, what is assumed, and what to check.
   - **Accept**, **Pitch** (typed wins over the photos) and **Ends** (switch an end) write into the Finish block. A change after Accept takes the acceptance back.
5. **No account, or no signal:** it says so in a line, and the roof stays as it is. Where nothing measured it, the pitch is assumed 4/12. It can still be edited, and Finish can be pressed again later.
6. **Send** carries the Finish block in the exterior file. The claim's roof is the one the phone showed, with no photo traced twice.

## The walls off the photos (2026-10-15, option 1)

The owner chose "option 1": the walk is two bottom-corner taps per side and the side's photo (with the gables and the eave corner in it), then Finish.

- **What is read.** The same trace call that reads the roof reads the side's materials as shapes, its windows, doors and garage doors, and its wall top (both eaves, and the peak of a gable). No second call.
- **What is tapped wins.** A read part goes on only where nothing was tapped (`withWalls` in `lib/exteriorFinish.ts`):
  - the materials only on a side with no shapes tapped;
  - an opening only where no tapped opening overlaps it by a third of the smaller;
  - the wall top only on a side with no eave tapped.
  Each read part is marked `from: "photo"`.
- **A side of its corners alone.** Scan writes it as one open shape along the bottom, its eaves at the bottom. Scrivn's import reads that as no shape and no eave (`CORNERS_ONLY_RISE_M`), so the read walls go on it.
- **Squaring a side with no height.** The squared photo reaches 9 m over the side's bottom (`UNMEASURED_ABOVE_M`), so the wall top and roof are in the picture to be read.
- **On the phone:** Review's **Walls** button lists every photographed side with its walls in words and its elevation as Scrivn draws it. Each side is kept or set aside, or all at once. Set aside, a side's walls are only what was tapped; the roof read stays.
- **No signal, no read:** a side with only its corners has no height. It is not counted, and Review and the report say so by name: "No eave was tapped on Left: put it in, or read the side's photo (Finish exterior on the phone), to count that side."
- **The report** says which parts came off a photo: a "From" column in the walls and openings tables (photo, tapped, entered), "(from photo)" on the elevation's lines, how many SF of the cladding were read off photos on the cover, a line in where the numbers came from, and what was read off each photo under it.

### Read against tapped, on the 14:53 walk

The owner's walk with its four photographed sides cut back to their two bottom corners, read off the photos (recorded answers, no paid call), against the same sides as tapped: every side and every opening is there, one for one, and the heights match the owner's hand marks on the same photos to 2" (`test:exterior:engine`). The numbers are kept outside this repository: blind reviewers measure that house from these docs.

Precedence is Scrivn's, unchanged (docs/roof-from-photos.md). A part's pitch comes, in order, from:
1. typed;
2. its own gable's photo;
3. the main roof's gable photo;
4. a gable the phone measured;
5. the assumed 4/12.

On the owner's 14:53 walk, the main roof stands over Right, whose gable has no photo, so it takes Scan's measured pitch. The wings out to Left 5 and Rear take their photos'.

## The report

US Letter. Each drawing is at the largest standard architectural scale that fits it, with the scale written and a 10 ft bar: true at 100%, as Scan's room plan is. The drawings are Scrivn's own (`components/sketch/exteriorDrawings.tsx`) painted as lines, so the report shows what the estimator saw.

1. **Cover:**
   - the address or job name, the date, and what made it;
   - the house in a few lines: footprint, walls, cladding, openings, roof, roof lines, overhangs, and where the sizes came from;
   - where every number came from;
   - everything assumed;
   - what to check.
2. **Footprint:** every wall's name and length.
3. **Roof plan:**
   - every line's length, the slopes lettered with their pitch and area;
   - a legend with each kind of line and its total;
   - the slopes listed, and the notes.
4. **Elevations:** each side at its own standard scale (at most 3/16"), with the materials, the openings with their sizes, the eaves, the peak and the length. Under each, every dimension: each material's gross, openings and net, and each opening's size, sill and place along.
5. **Side photos:** two to a page, each with what was read off it.
6. **Tables:**
   - walls by side and material, and by material (gross, openings, net), with house wrap;
   - openings: each, and by size, with the trim round them;
   - roof lines: ridge, hips, hip & ridge cap, valleys, eaves, rakes, step and headwall flashing, drip edge, starter, ice & water, and closure and ridge vent where they apply;
   - roof squares by pitch, with the steep and high-roof bands;
   - slopes;
   - soffit, fascia and eavestrough: soffit SF at each overhang, eavestrough, end caps, mitres, downspouts, drops, elbows;
   - corners and trim;
   - what is still to answer before the scope can be priced.

"Assumed", "from photos" and "typed" are said wherever they apply, as on the scope.

## Tests

`npm run test:exterior:engine` (24 checks, no paid call):

- **The script itself.** It runs the very script Scan carries in a bare context (no DOM, no Node), on the owner's 14:53 walk with four of his 10-12 photos laid on their sides as Scan lays a side photo (`test/exterior/fixtures/finish-1453`).
  - The trace's answers are Claude's own, recorded on 10-14 by the roof-from-photos session's paid run, and replayed in whatever frame the photo is squared to.
- **Phone against Scrivn.** The phone's summary must equal Scrivn's import of the same file and Finish:
  - with nothing typed;
  - with a pitch typed and an end switched;
  - with the photos' reads in.
- **The reads, against the roof-from-photos session's own snapped reads of 10-15:**
  - Left 5 and Rear: the pitch, both rakes and the eave, each within 1.5".
  - The garage's doubtful 4.6 is set aside.
- **The walls off the photos.** The walk with its four photographed sides cut back to their corners: with no signal they are not counted and the phone says so; read, they are whole, every part marked from photo, and the phone's sides are Scrivn's import's. The differences against the taps are printed. Left 5's heights match the 10-12 hand marks to 2". Set aside, a side is its corners again. On the walk as tapped, nothing of the photos' walls goes on.
- **The report.** Its numbers are the quantities', and what is assumed says so. The corners-and-photos walk's report says "photo" in its tables. The PDF from the phone's engine and Scrivn's own PDF of the claim are byte for byte the same, apart from jsPDF's timestamp.
- **Outputs:** `SCRIVN_REPORT_OUT=<file.pdf>` keeps the owner's walk's report, `SCRIVN_WALLS_REPORT_OUT=<file.pdf>` the corners-and-photos walk's. `SCRIVN_SUMMARY_OUT` writes the summary Scan's `ExteriorFinishTest` reads.
- **Checked by hand on 2026-10-15:** the same script in Chromium, with a real canvas doing the squaring and drawing, gave the same reads to a hundredth of an inch, the same squares, and the roof plan picture Review shows.
