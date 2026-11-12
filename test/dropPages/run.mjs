/**
 * Drop a sketch or scope (2026-11-12): pages that are a sketch, a scope or both (lib/dropPages.ts), every page's rooms
 * in one plan, the scope tidied room by room against it and changed by hand (lib/tidyScope.ts), the notes block a gap
 * check's claim starts with, the draft kept in the browser, and the handoff the claim page takes it in by
 * (lib/handSketchClaim.ts).
 *
 *   node test/dropPages/run.mjs
 *
 * No network and no model call: the readings are the recorded fixtures in test/scopeUpload and test/handSketch, and
 * ones written here.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outfile = join(mkdtempSync(join(tmpdir(), "drop-pages-tests-")), "bundle.mjs");
await build({ entryPoints: [join(here, "entry.ts")], bundle: true, format: "esm", platform: "node", outfile, alias: { "@": root }, logLevel: "error" });
const m = await import(pathToFileURL(outfile).href);

let passed = 0;
let failed = 0;
const check = (ok, message) => {
  if (ok) passed++;
  else {
    failed++;
    console.log(`  FAIL ${message}`);
  }
};

const fixture = (folder, name) => JSON.parse(readFileSync(join(root, "test", folder, "fixtures", `${name}.model.json`), "utf8")).read;
const sample = fixture("scopeUpload", "sample");
const beside = fixture("scopeUpload", "sample-sketch");
const sketchOnly = fixture("scopeUpload", "sketch-only");
const spare = fixture("scopeUpload", "spare-sketch");
const photo = { url: "data:image/jpeg;base64,/9j/", width: 1050, height: 1400 };
const item = (plain, extra = {}) => ({ written: plain, plain, quantity: null, unsure: false, ...extra });
const page = (read, more = {}) => ({ version: 1, pageKind: "handwritten", continuing: [], rooms: [], general: [], notes: [], unreadable: [], ...read, ...more });

/* ── What a page holds ───────────────────────────────────────────────────────────────────────── */
{
  const p = m.newPage("p1", "IMG_1.jpg", "photo", photo);
  check(m.pageHolds(p) === "unknown" && m.holdsWords(p).includes("not read yet"), "a photo with no drawing found and no read is not known yet");
  check(m.pageHolds(m.newPage("p2", "scope.pdf", "pdf", null)) === "unknown" && m.holdsWords(m.newPage("p2", "scope.pdf", "pdf", null)) === "Scope, not read yet", "a PDF is a scope not read yet");
  const drawn = { ...p, sketch: "check" };
  check(m.pageHolds(drawn) === "sketch", "a drawing found, nothing read: a sketch");

  const both = m.afterScopeRead(drawn, beside);
  check(both.scope === "read" && m.pageHolds(both) === "both" && m.holdsWords(both) === "Sketch and scope", "a drawing and lines of work: both");
  const scope = m.afterScopeRead(p, sample);
  check(scope.scope === "read" && m.pageHolds(scope) === "scope" && m.holdsWords(scope) === "Scope", "lines of work and no drawing: a scope");
  const sketch = m.afterScopeRead(drawn, sketchOnly);
  check(sketch.scope === "none" && m.pageHolds(sketch) === "sketch" && sketch.scopeRead.notes.length === 2, "a drawing and only notes (what the sketch says): a sketch, its notes kept");
  const nothing = m.afterScopeRead(p, page({ notes: ["Smith"] }));
  check(m.pageHolds(nothing) === "nothing", "no drawing and no work: nothing found on it");
  check(m.scopeLines(sample) === 12 && m.scopeLines(null) === 0, "a reading's lines of work are counted across rooms, whole-job and carried-over lines");

  const printed = m.afterScopeRead(drawn, { ...sample, pageKind: "estimate" });
  check(printed.sketch === "none" && m.pageHolds(printed) === "scope", "a printed estimate's table rules are not a drawing: the page is a scope");
  const named = { ...drawn, trace: { photo, rooms: [{ corners: [], closed: true, name: "Kitchen", lengths: [], openings: [], items: [] }], rotate: 0, locked: false } };
  check(m.afterScopeRead(named, { ...sample, pageKind: "printed" }).sketch === "check", "but a sketch the person has started naming stays theirs");
}

/* ── Every page's rooms in one plan ──────────────────────────────────────────────────────────── */
const sampleNamed = { ...m.SAMPLE_READ, rooms: [{ ...m.SAMPLE_READ.rooms[0], name: "Bedroom" }, { ...m.SAMPLE_READ.rooms[1], name: "Closet" }] };
const rect = (id, name, x, y, w, h) => ({
  id,
  name,
  vertices: [
    { id: `${id}-a`, x, y },
    { id: `${id}-b`, x: x + w, y },
    { id: `${id}-c`, x: x + w, y: y + h },
    { id: `${id}-d`, x, y: y + h },
  ],
  ceilingHeightFeet: 8,
  ceilingType: "flat",
  ceilingPeakFeet: null,
  stairs: null,
  parentRoomId: null,
  nestingOptOut: false,
  symbols: [],
  freeCabinets: [],
});
const first = { ...m.emptySketch(), rooms: m.buildFromRead(sampleNamed).rooms };
const second = { ...m.emptySketch(), rooms: [rect("bath", "Bathroom", 0, 0, 96, 120)] };
const third = { ...m.emptySketch(), rooms: [rect("b2", "Bedroom", 0, 0, 120, 120)] };
const combined = m.combineSketches([
  { pageId: "p1", sketch: first },
  { pageId: "p2", sketch: second },
  { pageId: "p3", sketch: third },
]);
{
  const names = combined.sketch.rooms.map((r) => r.name);
  check(combined.sketch.rooms.length === first.rooms.length + 2, "every page's rooms are on the plan");
  check(names.includes("Bedroom") && names.includes("Bedroom 2") && names.includes("Bathroom"), "a name drawn on two pages is numbered the second time");
  const box = (id) => {
    const r = combined.sketch.rooms.find((x) => x.id === id);
    const xs = r.vertices.map((v) => v.x);
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const firstMax = Math.max(...combined.sketch.rooms.filter((r) => first.rooms.some((f) => f.id === r.id)).flatMap((r) => r.vertices.map((v) => v.x)));
  check(box("bath").min >= firstMax && box("b2").min >= box("bath").max, "each page's rooms stand to the right of the page before's, none on top of another");
  check(JSON.stringify(combined.names.get("p2")) === JSON.stringify(["Bathroom"]) && JSON.stringify(combined.names.get("p3")) === JSON.stringify(["Bedroom 2"]), "each page's rooms are known by their names on the plan");
  check(m.combineSketches([]).sketch.rooms.length === 0, "no sketch pages, an empty plan");
  check(first.rooms.every((r) => combined.sketch.rooms.some((c) => c.id === r.id)), "the rooms keep their ids: the plan holds the same rooms the pages built");
}

/* ── The scope tidied against the plan ───────────────────────────────────────────────────────── */
const planNames = combined.sketch.rooms.map((r) => r.name);
{
  // A page with the sample sketch and its scope beside it, and a page of scope for the basement.
  const pages = [
    m.afterScopeRead({ ...m.newPage("p1", "beside.jpg", "photo", photo), sketch: "ready" }, beside),
    m.afterScopeRead(m.newPage("p4", "scope.jpg", "photo", photo), sample),
  ];
  const ins = m.scopePagesIn(pages, combined.names);
  check(ins.length === 2 && JSON.stringify(ins[0].sketchRooms) === JSON.stringify(combined.names.get("p1")) && ins[1].sketchRooms.length === 0, "each scope page goes in with the plan's rooms drawn on it");
  const doc = m.tidyScope(ins, planNames);
  const bedroom = doc.rooms.find((r) => r.name === "Bedroom");
  check(!!bedroom && bedroom.scopeName === "Spare bedroom", "the scope's Spare bedroom is the plan's Bedroom, its own name kept beside");
  check(bedroom.lines.length === 6 && bedroom.lines.every((l) => l.written && l.plain), "every line kept, with what was written");
  const groups = m.linesByPhase(bedroom.lines);
  check(groups.length === 2 && groups[0].phase === "EMERGENCY" && groups[0].lines.length === 4 && groups[1].phase === "REPAIR" && groups[1].lines.length === 2, "the lines are under Emergency and Repair as the page put them");
  check(m.tidyFlaggedCount(doc) === 2 && bedroom.lines.filter((l) => l.unsure).length === 1, "a line the reader was not sure of is flagged (one here, one on the other page)");
  const bath = doc.rooms.find((r) => r.name === "Bathroom");
  check(!!bath && bath.scopeName === "Basement bathroom" && bath.level === "Basement", "the basement page's bathroom is the plan's Bathroom, by name, across pages");
  check(doc.rooms.some((r) => r.name === "Basement bedroom" && r.scopeName === null && r.lines.length === 6), "a scope room whose plan room another has taken stays as the scope writes it, its lines its own");
  check(doc.general.length === 2 && doc.notes.includes("Cat 2") && doc.notes.some((n) => n.startsWith("From the sketch")), "the whole job's work and the notes of every page are kept");
  check(doc.unreadable.length === 1 && doc.unreadable[0].page === 2, "what could not be read says its page");
  check(JSON.stringify(m.tidyScope(ins, planNames)) === JSON.stringify(doc), "the same pages make the same document, ids and all");

  // With no sketch, the tidied scope is exactly the claims' Upload a scope block.
  const alone = m.tidyScope([{ read: sample, file: "scope.jpg", sketchRooms: [] }], []);
  check(m.tidyToNotes(alone) === m.scopeToNotes(m.mergePages([{ read: sample, file: "scope.jpg" }])), "with no sketch and no change, the notes are byte for byte what Upload a scope puts in a claim");
  check(m.tidyToNotes(m.tidyScope([{ read: spare, file: "spare.jpg", sketchRooms: [] }], [])) === m.scopeToNotes(m.mergePages([{ read: spare, file: "spare.jpg" }])), "and so for the owner's own page, read live");

  // One room written and one drawn on a page are the same room, whatever each is called.
  const one = m.tidyScope([{ read: page({ rooms: [{ name: "Den", level: null, items: [item("Remove carpet")] }] }), file: "a.jpg", sketchRooms: ["Office"] }], ["Office", "Hall"]);
  check(one.rooms.length === 1 && one.rooms[0].name === "Office" && one.rooms[0].scopeName === "Den", "one room written beside the one room drawn is that room");
  const two = m.tidyScope(
    [
      { read: page({ rooms: [{ name: "Den", level: null, items: [item("Remove carpet")] }] }), file: "a.jpg", sketchRooms: ["Office"] },
      { read: page({ rooms: [{ name: "Office", level: null, items: [item("Paint walls")] }] }), file: "b.jpg", sketchRooms: [] },
    ],
    ["Office"],
  );
  check(two.rooms.length === 1 && two.rooms[0].lines.length === 2, "a later page naming the plan's room joins it");
  const twice = m.tidyScope([{ read: page({ rooms: [{ name: "Kitchen area", level: null, items: [item("A")] }, { name: "Kitchen", level: null, items: [item("B")] }] }), file: "k.jpg", sketchRooms: [] }], ["Kitchen", "Hall"]);
  check(twice.rooms.length === 2 && twice.rooms[1].name === "Kitchen" && twice.rooms[1].lines[0].plain === "B" && twice.rooms[0].name === "Kitchen area", "the same name takes the plan's room first; the room it might also have been stays as written, never joined to it");
  const closet = m.tidyScope([{ read: page({ rooms: [{ name: "Spare Bed 2", level: null, items: [item("Remove carpet")] }] }), file: "s.jpg", sketchRooms: ["Office", "Closet"] }], ["Office", "Closet"]);
  check(closet.rooms[0].name === "Office" && closet.rooms[0].scopeName === "Spare Bed 2", "a closet drawn beside the room is part of it: still one room written beside one drawn");
  const none = m.tidyScope([{ read: page({ rooms: [{ name: "Den", level: null, items: [item("Remove carpet")] }] }), file: "d.jpg", sketchRooms: ["Office", "Hall"] }], ["Office", "Hall"]);
  check(none.rooms[0].name === "Den" && none.rooms[0].scopeName === null, "with two rooms drawn and no name in common, nothing is guessed");
  const carried = m.tidyScope(
    [
      { read: page({ rooms: [{ name: "Kitchen", level: null, items: [item("A")] }] }), file: "1.jpg", sketchRooms: [] },
      { read: page({ continuing: [item("B")] }), file: "2.jpg", sketchRooms: [] },
    ],
    [],
  );
  check(carried.rooms[0].lines.length === 2, "lines carried over a page break stay with their room");

  /* Changing it */
  const flaggedLine = bedroom.lines.find((l) => l.unsure);
  let d = m.lineRight(doc, flaggedLine.id);
  check(!d.rooms.find((r) => r.name === "Bedroom").lines.find((l) => l.id === flaggedLine.id).unsure && m.tidyFlaggedCount(d) === 1, "Looks right takes the flag off");
  d = m.setLine(doc, flaggedLine.id, { plain: "Install baseboard, MDF 3 1/4 inch" });
  const changed = d.rooms.find((r) => r.name === "Bedroom").lines.find((l) => l.id === flaggedLine.id);
  check(changed.changed && !changed.unsure && changed.written === "Inst base MDF 3?", "a changed line is the person's own: no longer flagged, the writing still shown beside");
  const notes = m.tidyToNotes(d);
  check(notes.includes("- Install baseboard, MDF 3 1/4 inch (PF, the whole perimeter of the floor) [under: Repair]") && !notes.includes("Inst base MDF 3?"), "in the notes a changed line goes without the writing it was read from, which would be gone by");
  check(notes.includes("- Tear out carpet and pad [written: Tear out cpt & pad - F] (F, the whole floor) [under: Emergency]"), "an unchanged line keeps its writing, quantity and heading");
  const qty = m.setLine(doc, bedroom.lines[0].id, { quantity: "140 SF" });
  check(m.tidyToNotes(qty).includes("- Tear out carpet and pad (140 SF) [under: Emergency]"), "a changed quantity makes the line the person's too");
  d = m.removeLine(doc, bedroom.lines[0].id);
  check(m.tidyLineCount(d) === m.tidyLineCount(doc) - 1 && !m.tidyToNotes(d).includes("Tear out carpet and pad [written"), "a line taken off is gone from the notes");
  const added = m.addLine(doc, bedroom.id, "REPAIR");
  check(m.tidyLineCount(added.doc) === m.tidyLineCount(doc) && m.tidyToNotes(added.doc) === m.tidyToNotes(doc), "an empty line added is left out until it says something");
  const filled = m.setLine(added.doc, added.id, { plain: "Paint walls", quantity: "W, all the walls" });
  check(m.tidyToNotes(filled).includes("- Paint walls (W, all the walls) [under: Repair]"), "a line typed in goes in under its heading, with no writing");
  const ids = [...filled.rooms.flatMap((r) => r.lines.map((l) => l.id)), ...filled.general.map((l) => l.id)];
  check(new Set(ids).size === ids.length, "a line added gets an id no other line has");
  const general = m.addLine(doc, m.GENERAL);
  check(general.doc.general.length === doc.general.length + 1, "a line can be added to the whole job's");
  const renamed = m.setRoom(doc, bedroom.id, { name: "Spare bedroom", level: "Basement" });
  check(m.tidyToNotes(renamed).includes("\nSpare bedroom (Basement):\n"), "a room renamed goes into the notes by its new name and level");
  const room = m.addRoom(doc, "Hall");
  check(room.doc.rooms.length === doc.rooms.length + 1 && room.doc.rooms.at(-1).lines.length === 1 && !m.tidyToNotes(room.doc).includes("Hall:"), "a room added waits for a line before it is in the notes");
  check(m.removeRoom(doc, bedroom.id).rooms.length === doc.rooms.length - 1, "a room can be taken out");
  check(m.removeNote(doc, 0).notes.length === doc.notes.length - 1, "a note can be taken out");

  /* The block a gap check's claim starts with */
  const block = m.tidyToNotes(doc);
  check(block.startsWith(m.UPLOADED_SCOPE_START) && block.includes("\nBedroom:\n") && block.includes("\nBathroom (Basement):\n"), "the notes block is the uploaded-scope block, rooms by their names on the plan");
  check(m.uploadedScopeSection(block) === `\n\n${m.UPLOADED_SCOPE_RULE} ${m.UPLOADED_SCOPE_PHASE_RULE}`, "with headings on its lines, the extraction is told what they mean");
  check(m.extractionUserMessage(block, "").includes(`${block}\n\n${m.UPLOADED_SCOPE_RULE} ${m.UPLOADED_SCOPE_PHASE_RULE}`), "and the first extraction call carries the block, then the rules");
  const firstBedroom = block.indexOf("Bedroom:");
  const emergencyAt = block.indexOf("[under: Emergency]", firstBedroom);
  const repairAt = block.indexOf("[under: Repair]", firstBedroom);
  check(emergencyAt > 0 && repairAt > emergencyAt, "a room's Emergency lines come before its Repair lines, as shown");

  /* The PDF */
  const rows = m.quantityRows(combined.sketch, 0).rows;
  check(m.planRoomFor(rows, "Bedroom")?.name === "Bedroom" && m.planRoomFor(rows, "bedroom 2")?.name === "Bedroom 2" && m.planRoomFor(rows, "Garage") === null, "a room's size is found on the plan by its name");
  const tables = m.tidyPdfTables(doc, rows);
  const bedTables = tables.filter((t) => t.caption.startsWith("Bedroom "));
  check(bedTables.length === 2 && bedTables[0].caption.includes("- Emergency") && bedTables[1].caption.includes("- Repair") && bedTables[0].caption.includes("SF floor") && bedTables[0].caption.includes("on the scope: Spare bedroom"), "the PDF has a table per room and heading, with the room's size and the scope's name");
  check(bedTables[1].rows.some((r) => r[0].endsWith("(check: may be misread)")), "a flagged line is marked in the PDF");
  check(tables.at(-1).caption === "Whole job" && tables.every((t) => t.rows.every((r) => r.length === 3)), "the whole job's work last, three columns to every row");

  /* Kept and read back */
  check(JSON.stringify(m.parseTidyScope(JSON.parse(JSON.stringify(filled)))) === JSON.stringify(filled), "a changed document survives being kept");
  check(m.parseTidyScope({ version: 2 }) === null && m.parseTidyScope({ version: 1, rooms: [{ id: 1 }], general: [] }) === null, "something else kept there is not a document");
}

/* ── The draft kept in this browser ──────────────────────────────────────────────────────────── */
{
  const pages = [
    { ...m.newPage("p1", "a.jpg", "photo", photo), sketch: "reading", scope: "reading" },
    m.afterScopeRead(m.newPage("p2", "b.pdf", "pdf", null), sample),
  ];
  const kept = m.draftToKeep(pages, { p1: new Blob(["x"]), p9: new Blob(["gone"]) }, null);
  check(Object.keys(kept.blobs).join() === "p1", "only the pages still there keep their files");
  const back = m.parseDraft(JSON.parse(JSON.stringify({ ...kept, blobs: {} })));
  check(back && back.pages.length === 2 && back.pages[0].sketch === "failed" && back.pages[0].scope === "unread", "a read cut off by a reload is not reading any more: asked again from the page");
  check(back.pages[1].scope === "read" && back.pages[1].scopeRead.rooms.length === 2, "a read page keeps its reading");
  check(m.parseDraft({ version: 2, pages: [{ id: "x", kind: "photo", photo: null }] }) === null, "a photo page with no photo is not kept");
  check(m.parseDraft({ version: 2, pages: [] }) === null && m.parseDraft(null) === null && m.parseDraft("x") === null, "nothing there, no draft");
  const trace = m.readToTrace(sampleNamed, photo);
  const v1 = m.parseDraft({ stage: "review", photo, trace, read: m.traceToRead(trace), dismissed: ["q1"], edited: null });
  check(v1 && v1.pages.length === 1 && v1.pages[0].sketch === "ready" && v1.pages[0].scope === "none" && v1.pages[0].dismissed[0] === "q1", "a one-sketch draft from before pages comes back as its one page, checked, no scope looked for");
  const v1trace = m.parseDraft({ stage: "trace", photo, trace, read: null, edited: null });
  check(v1trace.pages[0].sketch === "check", "one still being traced comes back to check");
}

/* ── The handoff to the claim page ───────────────────────────────────────────────────────────── */
{
  const doc = m.tidyScope([{ read: sample, file: "scope.jpg", sketchRooms: [] }], []);
  const notes = m.tidyToNotes(doc);
  const handoff = m.parseHandoff({ token: "t1", createdAt: "2026-11-12T10:00:00Z", claimId: null, sketch: { rooms: [] }, notes });
  check(handoff && handoff.notes === notes && handoff.sketch.rooms.length === 0, "a gap check's handoff keeps its notes, with no rooms when the pages held only a scope");
  check(m.parseHandoff({ token: "t1", createdAt: "x", claimId: null, sketch: { rooms: [] }, notes: "  " }).notes === undefined, "blank notes are none");
  check(m.handoffNotesToAdd("", handoff) === notes, "a new claim's empty notes become the block");
  check(m.handoffNotesToAdd("Spoke to the owner.", handoff) === `Spoke to the owner.\n\n${notes}`, "notes already there keep theirs, the block after a blank line");
  check(m.handoffNotesToAdd(`x\n\n${notes}`, handoff) === null, "twice is once: notes that hold it already take nothing");
  check(m.handoffNotesToAdd("", { ...handoff, notes: undefined }) === null, "a handoff with no notes adds none");
  const sketch = { ...m.emptySketch(), rooms: [] };
  check(!m.handoffLanded(sketch, "", handoff) && m.handoffLanded(sketch, notes, handoff), "a scope-only handoff has landed once the notes hold it");
  const withRooms = { ...handoff, sketch: { rooms: second.rooms } };
  check(!m.handoffLanded(sketch, notes, withRooms), "rooms not added yet: not landed");
  const merged = m.mergeHandSketch(sketch, withRooms.sketch, 0);
  check(m.handoffLanded(merged, notes, withRooms) && !m.handoffLanded(merged, "", withRooms), "landed when the rooms and the notes both are");
  check(m.handoffLanded(merged, "", { ...withRooms, notes: undefined }), "a sketch-only handoff has landed once its rooms are on");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
