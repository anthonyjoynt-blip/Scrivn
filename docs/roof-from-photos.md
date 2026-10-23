# The roof from Scan's side photos: what is read, how to test it, first results

Built 2026-10-15 (`lib/roofPhotoRead.ts`, the trace in `lib/exteriorTrace.ts`, the editor in `components/sketch/SidePhotos.tsx`). The owner's call: the AI photo route is how roofs come in. Since the same day the call also proposes the roof's shapes - dormers, turrets, an upper floor - and the ridge's direction: see the last section.

## What the trace reads

The AI trace of a side's photo is one Claude call, as before. Besides the cladding, openings and wall top, it now returns the roof's edge over the wall:
- the fascia along each rake;
- the eave line;
- where the roof edge ends at each end of the wall;
- whether the roof there is a gable, a hip end or an eave.

That adds about 300-600 tokens out, or $0.01. The calls on the owner's photos and the painted test wall cost $0.059-0.086 each.

Scrivn works out four reads:
- **Pitch.** It comes from the gable's two slopes, each read over its whole run. Two slopes more than 1/2 in 12 apart are flagged and start unticked. So is a read more than 1/4 from a whole pitch, because roofs are framed to whole pitches.
- **Rake overhang.** The fascia stands nearer the phone than the wall, so in the squared photo it shows swollen away from the point of the wall in front of the phone. Scan says where the phone stood, so the swelling measures how far out the fascia is.
  - The squared photo shows the fascia's bottom edge, and that edge can hang below the soffit.
  - From a phone standing to one side of the peak, the two slopes show that hang differently, so both the hang and the overhang are read.
  - From the middle, the fascia is taken as level with the soffit.
- **Eave overhang.** It is read where a rake comes down to a plain eave end, or at a hip's corner.
- **Gable or hip** over the side.

**Snapping.** Claude's wall top and fascia lines land 5-25 px off in a 2400 px image, and the rake overhang is the small gap between those two lines. So the editor sets both lines on the photo's own edges before showing them (`snapTrace`).
- The wall top goes onto the step from wall to soffit.
- The fascia goes onto the first strong step above the soffit, parallel to the wall top.

On a gable of the owner's this put both lines within 1 px of the hand marks.

**Ticking.** Each read has its own tick on the face-on side, and each is kept on the side, ticked or set aside (`roofRead`). Once on the side, the line under the photo says what was read, with **Set the roof read aside**.

**Which value is used.**
- **Pitch**, per roof section:
  1. a typed pitch for that section, or the typed roof pitch;
  2. that section's gable photo;
  3. the main roof's gable photo;
  4. a gable measured by the phone;
  5. the assumed 4/12.
- **Overhangs:** typed, then the photos (between them, flagged when they disagree by more than 3"), then Scan's roofline, then the default. Clearing a typed overhang on the plan goes back to the photos.
- **Gable or hip at each end:** a tap on the plan, then the photo of that side, then a gable.
- **The scope** says where each number came from.

## The photos

In Scan's exterior walk, with the Photo chip:
1. **Each gable end, square-on**:
   - face the wall straight, two or three steps to one side of the peak, 5-9 m back;
   - the peak, both rakes and both ends of the roof edge in view, phone on its side.
   - Off to one side is what lets the hang be told from the overhang. From the middle a 2" hang reads the rake about 2.5" short. The pitch reads the same either way.
2. **One corner photo, for the house**:
   - at a corner where the roof edge ends plainly: not over a porch, a deck or a lower roof, and no downspout in front;
   - step out past the corner and take it from the gable side, about 45° to the wall, with the end of the roof edge near the middle of the screen.
3. **Every other side as now.** An eave side's photo says it is an eave, and a hip end's says it is a hip.

Scan's own cards say this: the first Photo card, and a card after the first photo of a gable side.

## The accuracy protocol

**Measure by hand, for each gable photographed:**
- **Wall width:** corner to corner at the bottom. This is the tape that also scales the side; type it on the side in Scrivn.
- **Eave height** at each corner: from the top of the parging (Scan's reference) to where the soffit meets the wall.
- **Peak height:** the same reference to the soffit at the peak, by laser. Pitch = (peak - eave) ÷ (half the width) × 12. A pitch gauge on the rake is the check.
- **Rake overhang:** horizontally, from the gable wall's face to the outer face of the rake fascia. Note how far the fascia's bottom edge hangs below the soffit.
- **Eave overhang** at the plain corner photographed: horizontally, from the eave wall's face to the outer face of the eave fascia, not the eavestrough.

**For the whole roof:** the Xactimate sketch's totals for the same roof: squares, ridge, hip, valley, eave, rake, step flashing.

**Score each read against the hand figure:**

| Read | Good enough to put in front of a customer |
|---|---|
| Pitch | the right whole pitch (within 1/4 in 12) |
| Overhangs | within 1.5" |
| Heights | within 2" |
| Squares | within 3% |
| Line lengths | within 5% |

**What to keep for each photo:** the trace's checks and notes, whether it was snapped, and how far the phone stood off the peak.

## First results

The first results on the owner's house - pitch, overhangs, heights, gable or hip, squares and how they repeat, against his own figures, the 10-12 hand marks and Scan's walks - are kept outside this repository: blind reviewers measure that house from these docs. In short: every clean gable read the right pitch, the doubtful ones were flagged rather than used, heights came within an inch of the hand marks, and gable or hip was four of four.

### Repeatability

- **Painted test wall** (`test:exterior:trace`), three runs:
  - pitch exact;
  - rake +0.0" each time, hang 1.0" (truth 1.0").
  - The eave read 19.6", then 0" / 14" on one end each (flagged, not ticked), then 19.4" (truth 19.7").
  - Claude had put one foot where the eave's return crosses the wall. The prompt now says where the foot is, and an end under 4" past the wall is flagged.

## What is good enough for a customer

- **Pitch from a gable photo: yes.** It is read off the wall itself, needs no tape (it is a ratio), and is right on every clean gable. The flags catch the bad photos. The estimator still ticks it.
- **Gable or hip: yes**, as a proposal the estimator confirms.
- **Heights: yes**, to within an inch of the hand marks, as good as the side's scale. The scale is Scan's walk until one length is taped.
- **Overhangs: not yet.**
  - The method reads the same as careful hand marks.
  - But two gables of one house read 4" apart, and they depend on the scale and on the fascia's hang.
  - With no tape to check against, treat them as a better start than the 16"/12" defaults, for the estimator to confirm.
- **Squares: the photo reads are not the weak link.** They move squares under 1%. The footprint's scale is the bigger error: Scan's walks differ 5-10% until taped.

## Still typed

- **A roof with no gable** (all hips): no pitch is read; type it.
- **A lower roof or wing** with no gable photo of its own, and any hip end's pitch.
- **Anything the footprint model can't see**: roof objects, chimneys, and the exact roof over porches.
- **The roof's totals** whenever the drawing is off: they win over everything.

## Slots waiting for a photo read (10-15)

Built as data and maths only; nothing reads them off a photo yet. Each follows the order above: typed, then photos, then assumed.

- **A gambrel's or mansard's break.** `SideRoofRead.upperPitch` and `breakFeet` on a gable's side (its `pitch` is then the one below the break). `photoSectionBreaks` puts them on the part whose gable it is, under a break typed in Pitch mode (`ExteriorRoof.sectionBreaks`). A break is never assumed.
- **Roof pieces** (dormers, turrets; lib/roofPieces.ts): filled since the next section. A piece with `source: "photos"` is a proposal: it counts only once the estimator ticks it (`taken`), and its lines then say "(from photos)". Changing one of its numbers makes it the estimator's (`editedPiece`).

## The roof's shapes off the photos (10-15)

`lib/roofPhotoShapes.ts`. The same one trace call per side also proposes the roof's shapes, each with its own tick on the face-on side, kept on the side (`SideRoofRead`), shown "(from photos)", under anything typed, and undone by **Set the roof read aside**.

### What is read

- **Dormers** on the slope over an eave side, their fronts square to the photo: gable or shed.
  - The front stands back on the roof, so the photo shows it smaller than it is. Where it meets the roof below it (its apron) is on the main slope, which rises from the eave's fascia (the eave overhang out, 8" over the soffit) at the slope's pitch. So the phone's position says how far back the face stands, and how much bigger it is than it shows. Worked out in the head of the file.
  - **Pitch** of a gable dormer: off its face's two slopes, true at any distance, as a main gable's. Flagged when they differ by more than 1/2 in 12, or fall between whole pitches.
  - **Width**, across the face at its walls.
  - **Projection**: a gable dormer's eaves stand the slope's pitch × its projection over the slope at its face (lib/roofPieces.ts), so the projection is the face's eaves over its apron, over that pitch.
  - A **shed dormer**'s own slope runs away from the photo: its width only; its projection and pitch are asked for.
  - A **hipped** or other dormer is said, for the estimator to put in by hand.
  - These are worked out on the roof as built (`resolvePhotoPiece`, `photoRoofPieces`), not when the photo is read, so a pitch typed or ticked later carries into the dormer. On the roof's **assumed** pitch it is said: a dormer's size rests on the slope's pitch (the painted 10/12 dormer reads 7'11" wide at 10/12 and 8'7" at 8/12).
- **Turrets**, round or many-sided: the pitch off the roof's outline, the width read as if the turret stood on the wall's line (said: one standing out shows a little bigger), a many-sided one's side from its width across the flats.
- **What stands over the side**: an upper floor flush (the wall carries on up past a floor line), set back behind a roof, or none. The floor line on a flush wall. Set back: whether the roof up to it is a lean-to or a ridge running out, checked against the roof over the side (a lean-to's eave runs along it; a ridge out ends in a gable or hip over it).
- **The ridge's direction** (piece 4a of the photo-mode plan) needs no more of the call: it is worked out from the gable, hip and eave reads already there.

### How each fills the roof

- **Roof pieces**: each dormer or turret ticked is a roof piece "from photos", added to the drawing's totals as the estimator's own are; one left unticked is offered on the roof pane, counting nothing. A number of it changed on the roof pane makes it the estimator's own piece, standing in its place; take that one off and the photo's comes back. The same dormer read again keeps the estimator's in its place.
- **Two storeys**: the upper floor is never drawn from a photo.
  - With none drawn, a read showing one says it is to be drawn, and answers the high-roof charge "(from photos)". Reads of two sides or more showing none answer it no. An answer typed stands.
  - The floor line read prefills the floor line a tall side splits at.
  - Each lower roof's kind is the one picked on the plan, else its photo's, else by its shape.
- **The ridge**: picked on the plan, else the way that puts a roof end over the most sides the photos show as gables or hip ends, and none over those they show as eaves, when that bears out more of them than the roof worked out from the outline does. The plan's first ridge choice then reads "As the photos show", and a note says what it rests on.

### The squared image now reaches 4 m above the side

It reached 1.5 m, which cut a dormer's face, or an upper wall set back behind a lower roof, out of an eave side's image. It never goes past what the photo holds. On an eave side it adds up to about 1,600 image tokens, about $0.006.

### The call's schema is at its limit

The schema is compiled into a grammar, and the API refuses one past a size: "The compiled grammar is too large". Dormers, turrets and storeys as objects of their own with enums came back refused, and so did a note on each piece. What fits: one `roof_shapes` object, its words plain strings, its points flat runs of numbers `[x1, y1, x2, y2, ...]`, one note. **Anything more for the trace needs room made in the schema first.** A text-only call with 16 tokens out tells whether a schema compiles, for under a cent - a paid call all the same, so only with the owner's OK.

### Cost

Still one call a side. The longer prompt adds about 1,450 tokens in ($0.006), and the shapes about 50-150 tokens out.

| Photo | Calls on 10-15, before | Now |
|---|---|---|
| West gable | $0.086 | $0.082 |
| Rear bump-out | $0.081, $0.082 | $0.077 |
| Porch front (eave side) | - | $0.087 |
| Painted gable wall | $0.059-0.086 | $0.057 |
| Painted eave side with a dormer | - | $0.072 |
| Painted upper floor behind a lean-to | - | $0.049 |

So a side stays at about $0.05-0.09. The difference between runs is the thinking, not the shapes.

### First results

- **Painted eave side, gable dormer 2.4 m wide, 1.4 m projection, 12/12, its face 1.1 m back on a 10/12 slope** (`test:exterior:trace`, whose recorded answers are these calls'): read as one gable dormer, 12/12 (slopes 12.26 and 11.94). Set back +0.02 m; width +0.3"; projection −0.5". No upper floor.
- **Painted upper floor set back 1.8 m behind a 4/12 lean-to**: set back, behind a lean-to, the roof over the side an eave; no dormer.
- **Painted gable wall**: every read as before; no dormer, turret or upper floor.
- **The owner's photos** (no dormers, turrets or upper floor on his house):
  - west gable, rear bump-out, porch front: no pieces, no upper floor;
  - the rear bump-out's basement window and raised main floor did not read as two storeys;
  - the porch front's roof vents and flue were rightly not taken for dormers ("Only roof vents and a flue stand on the roof; none of these are dormers");
  - the pitch on both gables as before.
- **The owner's 14:53 walk**: its gables (the west gable, the rear bump-out) already fit the roof worked out from the outline, so the ridge stays and the squares are unchanged.
- **Not yet tried on a real dormer, turret or two-storey house.** The painted ones are the evidence so far: a real one is the next test.
