# The roof from Scan's side photos: what is read, how to test it, first results

Built 2026-10-15 (`lib/roofPhotoRead.ts`, the trace in `lib/exteriorTrace.ts`, the editor in `components/sketch/SidePhotos.tsx`). The owner's call: the AI photo route is how roofs come in.

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

On the owner's west gable this put both lines within 1 px of the 10-12 hand marks.

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

## First results: the owner's house (10-12 photos, read 10-15)

The photos are the owner's own from 10-12, squared by the photo test (session 0834e882). The phone positions come from that test's geometry. These are not Scan photos, but the maths is the same.

The scales come from Scan's walks:
- the west wall is 7.417 m by the 13:25 walk and 8.146 m by the 14:53 walk;
- the garage is scaled from the owner's 9' door tape.

The only hand figure so far is the owner's pitch: **5/12**.

### Pitch

| Gable | Photo | Claude's lines | Set on the photo's edges | 10-12 hand marks | Owner |
|---|---|---|---|---|---|
| West, main roof | 5.4 m out, 2.5 m right of the peak | 5.07 / 4.92: **5/12** | 4.97 / 5.06: **5/12** | 5.0 / 5.1 | **5/12** |
| Rear bump-out | 8.9 m out, 4 m right of the peak | 4.94 / 4.96: **5/12** | 5.08 / 5.08: **5/12** | (Scan: 5.0) | – |
| Garage gable | 7.1 m out; its left soffit is seen edge-on | 4.38 / 4.84: 4.6, **flagged** | no clear edge: left as traced | 5.1 / 4.7 | – |

- Every clean gable reads 5/12.
- The one doubtful read is flagged rather than used.
- The 10-12 test's photo taken 53° off square read 5.3 / 6.0, which is also flagged.

### Rake overhang (out to the fascia's face)

| Gable | Claude's lines | Set on edges: fascia taken level | Set on edges: both slopes |
|---|---|---|---|
| West | 24" / 28", flagged | 22.7" / 22.0" | **23.3"**, fascia hangs 0.7" |
| Rear bump-out | 27" / 28" | 24.8" / 21.8" | **27.1"**, fascia hangs 1.8" |

- The 10-12 hand marks on the west gable, with the fascia taken level, gave 22.1" / 22.8", which is what the snapped lines give.
- The west gable is on the 13:25 scale. On the 14:53 scale it is 25.6" (×1.098).
- The garage gable was not snapped. As traced it reads 24.6" / 24.7".
- No tape yet.

### Eave overhang

| Where | Read |
|---|---|
| Rear bump-out, both rake feet | **23.3" / 23.3"**; read again: 22.7" / 23.0" |
| Garage, left foot | 35.4", **not a plain end** |
| West gable | **not read**, rightly: the roof runs on over the porch and the deck at both ends |

- The rear bump-out's right foot was near the phone, so it hardly depends on the rake read.
- The garage's left foot sits over a soffit box on the column, not a plain eave end. Taken alone this read misleads. The roof plan flags photo reads that disagree.
- No tape yet.

### Heights (west gable, snapped, against the 10-12 hand marks on the same scale)

| | Snapped | Hand |
|---|---|---|
| Back corner to soffit | 13'10.6" | 13'10" |
| Front corner | 11'5.2" | 11'5" |
| Peak | 17'9.1" | 17'9" |

### Gable or hip

Four of four right:
- the west gable, the rear bump-out and the garage gable read as gables;
- the garage wing's west side reads as an eave.

### Squares and lines

The test claim's roof ("Exterior test – roof from photos") was rebuilt from Scan's 14:53 file, three ways:
- **Scan's tapped gables only:** 5.06/12, with the default 16" / 12" overhangs.
- **As typed 10-13:** 5/12, eave 24", rake 22".
- **From photos:** the reads ticked on the west gable and the rear bump-out, nothing typed, so they fill the roof as Scrivn now does:
  - 5/12;
  - eave 22.9";
  - rake 26.4", the mean of 25.6" (the west gable on this walk's scale) and 27.1".

| Roof | Squares | Ridge | Hip | Valley | Eave | Rake |
|---|---|---|---|---|---|---|
| Scan's tapped gables only, default overhangs | 31.70 | 113'1" | 33'3" | 111'9" | 121'2" | 171'9" |
| As typed 10-13 | 33.71 | 117'1" | 34'2" | 117'0" | 123'10" | 178'3" |
| From photos | 34.05 (+1.0%) | 118'6" | 34'0" | 116'10" | 126'6" | 177'9" |

- The default overhangs undercount this roof by 2 squares (6%). Reading the overhangs matters more than the last tenth of the pitch.
- The owner's Xactimate sketch is still to compare against.

### Repeatability

- **Rear bump-out**, read twice in independent calls (the second after the foot wording in the prompt changed):
  - pitch 5.08 / 5.08 and 5.08 / 5.09;
  - rake 27.1" and 27.1", hang 1.8" both times;
  - eave 23.3" and 22.9".
  - Snapping makes the lines the photo's, so they repeat.
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
  - But the gables read 23-27" between them, and depend on the scale and on the fascia's hang.
  - With no tape to check against, treat them as a better start than the 16"/12" defaults, for the estimator to confirm.
- **Squares: the photo reads are not the weak link.** They move squares under 1%. The footprint's scale is the bigger error: Scan's walks differ 5-10% until taped.

## Still typed

- **A roof with no gable** (all hips): no pitch is read; type it.
- **A lower roof or wing** with no gable photo of its own, and any hip end's pitch.
- **Anything the footprint model can't see**: roof objects, chimneys, and the exact roof over porches.
- **The roof's totals** whenever the drawing is off: they win over everything.
