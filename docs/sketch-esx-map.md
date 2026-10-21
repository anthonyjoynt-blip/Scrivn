# Sketch fields for a future Xactimate ESX export

Added 2026-10-21 so an interior sketch holds, as data, the details the owner's house showed in the interior AI-pass
test: arched pass-throughs, stair half walls, crown and a plant ledge, a hutch on the counter, a fridge bay and oven
tower, a wood hood box, countertops with a stool overhang and a waterfall end, a corner fireplace, a rec-room beam, a
T-bar ceiling, an unfinished utility room, office built-ins, wainscot, door and window styles, and a one-piece
tub/shower.

**There is no ESX export yet.** This page says what each field means and the Xactimate idea it most likely becomes.

**How sure the mapping is.**
- Nothing here was checked against Xactimate or a real ESX file.
- The ESX format isn't published. It needs an ESX exported from Xactimate to map against, and an estimator to say
  which line items they pick.
- *Check* marks every guess.
- Line-item names below are descriptions, not Xactimate codes.

**How the data behaves.**
- Every field is optional. Absent means *not said*, never a default dressed up as a measurement.
- A sketch saved before 2026-10-21 loads, draws and measures exactly as it did. The golden test checks this:
  `test/sketch/esxItems.mjs`.
- Units are decimal feet. Positions are along a wall from its start corner, as for every symbol.

## Openings (`DoorSymbol`, `WindowSymbol`)

| Field | Means | Likely Xactimate idea | Check |
|---|---|---|---|
| door `sillFeet` (on an `opening`) | A pass-through. The hole starts this high, with wall under it. | A sketch opening with a height off the floor, or a missing wall with a sill. | Can an X1 opening carry a sill height? If not, a wall line item for the face under it. |
| `topShape` flat / arch / round, `springFeet` | The top's shape and where its curve starts. `heightFeet` is the highest point. | The arched-opening drywall/trim line items (an arch kit or wrap), priced each. | Whether Xactimate's sketch subtracts an arched area or a rectangle. |
| door `doorStyle` slab / panel / half-lite / full-lite / French | The leaf. | Door line items by style: flush slab, panel, full-lite exterior, French pair. | The exact item each style maps to, interior vs exterior. |
| door `lites` | Panes of glass per leaf (a 15-lite door). | Part of the French or lite door item description. | Whether lite count prices or only describes. |
| door `exterior` | An outside door. | Exterior door items vs interior pre-hung. | An entry door vs a patio swing door. |
| window `windowType` | Picture, casement, awning, slider, single or double hung, hopper. | Window line items priced by type and size (UI or SF brackets). | Which size measure (UI, SF) each type uses. |
| window `units` | Units side by side in one frame. Mullions = units − 1. | One item per unit, or a multi-unit ("mulled") item. | How Xactimate prices mulled units. |
| window `grids` | Grids in the glass. | A grid/muntin add-on to the window item. | Whether it's an add-on or a different item. |

## Walls (`SketchRoom.wallDetails`, by wall id)

| Field | Means | Likely Xactimate idea | Check |
|---|---|---|---|
| `heightFeet`, `cap` | A half or pony wall. Its face stops here, no ceiling line runs along it, and the room across a partition sees it too. Break a wall where its height changes. | A wall of its own height in the sketch (or a separate half-wall sketch item), plus a cap item (wood cap / drywall wrap). | How X1 holds a half wall on a room's outline. |
| `crown` | Crown along the top of the wall. | Crown moulding, per LF. | Profile size isn't recorded. |
| `plantLedgeFeet` | A plant ledge at this height. | A ledge/shelf finish-carpentry item, per LF. | Which item; depth isn't recorded (it's the wall's). |
| `wainscot` `heightFeet`, `type` | Wainscot to a height. It stops at doors and at windows whose sill is under its top. | Wainscot or paneling per SF (beadboard, panel), with chair-rail cap per LF. | Whether the cap is priced apart. |
| `ledge` `heightFeet`, `depthFeet` | A ledge or knee-wall step along the bottom (a foundation ledge). | A framing/drywall step, or a knee-wall item. | No obvious single item; needs an estimator. |
| `unfinished` (and the room's `unfinished`) | Open studs or bare block. | No drywall/paint items on those walls; framing exposed. | Whether X1 has a room or wall "unfinished" flag, or just leaves the items off. |

## Cabinets and kitchen (`CabinetSymbol`, `Block`)

| Field | Means | Likely Xactimate idea | Check |
|---|---|---|---|
| `bottomFeet` | Where the box starts. An upper on the counter is 3'. Absent is the tier's standard (upper 4'6"). | Upper vs "upper on counter" (hutch) cabinet items. Height bracket for tall uppers. | Whether mount height changes the item or only the description. |
| `doors` solid / glass / open | Glass doors, or none (open shelving, a built-in bookcase). | Glass-door add-on; open shelving or bookcase items instead of cabinetry. | Which items. |
| `bay` fridge / wall-oven, `bayHeightFeet` | A fridge in its bay (only the box over it is cabinet), or a wall oven in a tower. | An over-fridge cabinet item; an oven cabinet (tall unit with an oven cut-out). | Item names. |
| `countertop` `material`, `overhangFeet`, `waterfallEnds`, `backsplashFeet` | A top on a lower run or an island. Its length is the box's, its depth the box's plus the overhang (1" nosing when not said). | Countertop per SF by material; waterfall ends priced as countertop or an add-on; backsplash per LF or SF. | Whether waterfall ends are SF of countertop or their own item; backsplash LF vs SF. |
| fixture `hood`, `hoodType`, `bottomFeet` | A range hood: under-cabinet, chimney, custom box, island. | Range hood items by type; a custom wood hood may be finish carpentry. | Item for a custom box. |

## Bath, fireplace, mechanical (`FixtureSymbol`, `Block.kind`)

| Field | Means | Likely Xactimate idea | Check |
|---|---|---|---|
| fixture `tubShower`, `surround`, `heightFeet` | A one-piece tub/shower (or a tub or shower) with its surround and height. | A fibreglass/acrylic tub-shower combo item; tile or panel surround per SF. | Combo vs tub plus surround. |
| fixture `fireplace`, block `kind: "fireplace"`, `fireplace.finish` / `fuel`, `heightFeet` | A fireplace on a wall, or a corner one. Its surround's face is width (a corner one's long face) × height. | Fireplace items (gas insert, wood masonry); stone/brick/tile veneer per SF for the surround. | Whether the surround is veneer SF or part of the fireplace item. |
| fixture `furnace`, `waterHeater` | Mechanical equipment, as fixtures. | HVAC and plumbing items (detach and reset, or replace). | Size and capacity aren't recorded. |

## Ceilings (`SketchRoom`, `Block.kind: "beam"`)

| Field | Means | Likely Xactimate idea | Check |
|---|---|---|---|
| `ceilingFinish` drywall / textured / popcorn / plaster / suspended / wood / open-joists | What the ceiling is. | Ceiling drywall plus texture; acoustic (popcorn) texture; suspended grid and tile; T&G paneling; none for open joists. All per SF of C. | Item names; acoustic vs suspended categories. |
| block `kind: "beam"`, `beam.type` beam / bulkhead / soffit, `beam.dropFeet` | Overhead: length along it, width across, drop from the ceiling. Wrap = length × (width + 2 × drop), one side less against a wall. | Beam or soffit wrap (drywall and finish) per LF or SF. Or a ceiling-zone subroom, as Scrivn already draws a bulkhead area. | Which form X1 expects: a subroom or an item. |

## Quantities

- **Shown under the Quantities table as Details:** `roomDetailLines`, from `RoomDetailQuantities` in
  `lib/sketchQuantities.ts`. Per room:
  - crown, plant ledge and half wall/cap LF;
  - wainscot LF and SF;
  - ledge LF and top SF;
  - countertop and backsplash LF and SF;
  - beam LF and wrap SF;
  - fireplace surround SF;
  - unfinished wall SF;
  - ceiling finish SF.
- **Changes to the five measures:**
  - W is net of pass-throughs (the wall under the sill and beside a shaped top stays) and of half walls.
  - PC loses half walls.
  - A fridge bay takes no floor or base.
  - A beam takes nothing off the floor or walls.
- **Painting a marked wall** (`fullWallSquareFeet`) stops at a half wall's top.
- **Not sent yet:** the generated scope document (the AI prompt) gets none of this. That's a separate choice.

## What Scan sends

None of these fields come from Scrivn Scan today.
- Scan import already carries tub and shower runs, door types, window sills and heights, and ceilings.
- Everything new arrives empty and is set in the editor.
- No Scan changes were made.
