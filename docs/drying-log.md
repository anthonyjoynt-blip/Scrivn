# The drying log (2026-10-13)

Readings taken at each visit until a water-damaged building is dry: the paperwork behind a "dry" claim.
Scrivn used to stop after the day-1 moisture map and equipment plan; Encircle Hydro and Albi's DryBook
log every visit, and IICRC S500 (V5, 2021) is quoted by trade commentary as asking for moisture readings
daily until the drying goals are met.

First version: typed entry, no third-party integration. Built on branch `drying-logs`.

## Where things are

| What | File |
| --- | --- |
| GPP and dew point from temperature and RH | `lib/psychrometrics.ts` |
| The log: types, loading, standards, goal, trend, status, seeding from the map | `lib/dryingLog.ts` |
| The printed document (status, standards, tables) | `lib/dryingLogPdf.ts` |
| Tables in the PDF renderer (new, additive) | `lib/pdf.ts` (`tables`, `drawTables`) |
| The panel (visit form, summary) | `components/drying/DryingLogPanel.tsx` |
| The button beside the sketch's, and the panel's door | `components/drying/DryingLogSection.tsx` |
| A number field that does not fight a thumb | `components/drying/NumberField.tsx` |
| Styles, all `dlog-` | `components/drying/drying-log.css` |
| Saved with the claim | `lib/claimState.ts` (`dryingLog`) |
| Tests | `npm run test:psychro`, `test:dryinglog`, `test:dryinglog:pdf` |

## The rules that are easy to get wrong

- **Beside the moisture map, not inside it.** `lib/moisture.ts` says the map has no history on purpose. The
  log refers to it (the dry standards) and never changes its shape.
- **A dry standard is measured, not looked up.** The log reads `MoistureMap.reference` live, per material. A
  point may carry its own. With neither it falls back to the published range and says so, on screen and on the
  printed log ("Not measured on this job").
- **Dry means at or below the standard plus a variance.** Default 10%, a setting on the log, printed on it.
  Encircle's help centre cites S500 V5 for "within 10% of the dry standard"; S500 itself publishes no number
  per material, so a firm may change it.
- **No reading is never "dry".** `pointState` returns `unread` and `no-standard`; "complete" needs every point
  still being read to be read, and at its goal, at the LATEST visit.
- **Measured values are never copied forward.** A new visit starts with who, the meter and the equipment
  counts from the last one, and blank air and readings. The previous value sits beside the field as a
  placeholder and as "Last 2.4 (Day 2)".
- **Worked out, never stored:** GPP, dew point, day number, status, trend, whether a point is at goal.
- **Day N is the calendar day** from the first visit, not the visit's position.
- **Storage is deg F.** The unit setting changes what the log shows and takes, not any reading.
- **Standard sea-level pressure** for GPP, as a hygrometer assumes. `pressureAtAltitudePsia` exists for later.

## Saved with the claim

One top-level key, `SavedClaimState.dryingLog`, normalised by `normalizeDryingLog` in `parseSavedClaimState`
(which merges one top-level key at a time, so nested fields added later are never backfilled otherwise). No
table and no migration: it goes through the claim's existing row, RLS and sync. Every visit and point has its
own id, so two copies that drifted apart can be put together by id one day.

The offline-mode branch keeps both copies and asks the estimator when a claim clashes (`lib/claimSync.ts`).
When these branches meet, add `dryingLog: "the drying log"` to that file's `PART` map so a clash on the log
is named instead of silent.

## The printed log

Its own document, built from the log at the moment it is downloaded or sent: the inspection report is
written once on day one and the log is not finished for days. Air table, readings by visit (six visits to a
table, then a second), who/meter/notes. Text stays inside the PDF standard fonts: no check marks, no
less-than-or-equal signs. It is also offered by "Send documents" when the log has a visit.

## Not in this version

- A meter-screen photo (the reading record already has `source`, `mode`, `scale`, `meter` for it).
- Bluetooth meters: needs a vendor agreement, so after launch (see the Bluetooth research note).
- Taking readings in Scan (Android).
- Merging two copies of a log by id.
- Altitude-corrected GPP.
