/**
 * Uploading a scope (lib/scopeUpload.ts, lib/scopeUploadPrompt.ts): an answer read into a page, pages joined, the
 * block of notes it becomes, and the rule the extraction calls read only when that block is in the notes.
 *
 *   node test/scopeUpload/run.mjs
 *
 * No network and no model call: the answers are written by hand (fixtures/).
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outfile = join(mkdtempSync(join(tmpdir(), "scope-upload-tests-")), "bundle.mjs");
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

const sample = JSON.parse(readFileSync(join(here, "fixtures", "sample.model.json"), "utf8"));
const item = (written, plain = written, quantity = "", unsure = false) => ({ written, plain, quantity, unsure });
const wire = (over = {}) => ({ pageKind: "handwritten", continuing: [], rooms: [], general: [], notes: [], unreadable: [], ...over });

/* ── An answer read into a page ─────────────────────────────────────────────────────────────── */

check(JSON.stringify(m.scopeReadFromWire(sample.wire)) === JSON.stringify(sample.read), "the sample fixture's read is its answer read again");
{
  const read = m.scopeReadFromWire(
    wire({
      pageKind: "napkin",
      rooms: [
        { name: " Kitchen ", level: "", items: [item("R&R cab", "Remove and replace cabinets", "12 LF"), item("", ""), item("x", "", "")] },
        { name: "", level: "Main", items: [item("Paint", "", "")] },
        { name: "Hall", level: "", items: [] },
      ],
      notes: [" Cat 2 ", ""],
      unreadable: ["", "one word"],
    }),
  );
  check(read.pageKind === "other", "a page kind it does not know is other");
  check(read.rooms.length === 2, "a room with no lines is dropped");
  check(read.rooms[0].name === "Kitchen" && read.rooms[0].level === null, "names trimmed, an empty level is null");
  check(read.rooms[0].items.length === 2, "an empty line is dropped");
  check(read.rooms[0].items[0].quantity === "12 LF" && read.rooms[0].items[1].quantity === null, "an empty quantity is null");
  check(read.rooms[0].items[1].plain === "x" && read.rooms[1].items[0].plain === "Paint", "a line with no plain words keeps its writing as them");
  check(read.rooms[1].name === "Room not named", "a room with no name is still a room");
  check(read.notes.join("|") === "Cat 2" && read.unreadable.join("|") === "one word", "notes and unread bits trimmed, empty ones dropped");
  check(m.scopeReadProblem(read) === null, "a page with lines is a scope");
}
check(m.scopeReadProblem(m.scopeReadFromWire(wire())) !== null, "a page with nothing read on it is refused");
check(m.scopeReadProblem(m.scopeReadFromWire(wire({ notes: ["Smith residence"] }))) === null, "a page of notes alone is kept");

/* ── The answer's shape: no unions, every key required ──────────────────────────────────────── */
{
  const s = JSON.stringify(m.SCOPE_READ_SCHEMA);
  check(!/anyOf|oneOf|allOf|"type":\[/.test(s), "the schema has no unions (Structured Outputs caps them)");
  const objects = [];
  const walk = (node) => {
    if (node && typeof node === "object") {
      if (node.type === "object") objects.push(node);
      Object.values(node).forEach(walk);
    }
  };
  walk(m.SCOPE_READ_SCHEMA);
  check(objects.every((o) => o.additionalProperties === false && JSON.stringify([...o.required].sort()) === JSON.stringify(Object.keys(o.properties).sort())), "every object in the schema is closed with all its keys required");
}
check(m.scopeReadUserMessage("photo", 1, 1) === "Read the scope on this page.", "one photo: just read it");
check(m.scopeReadUserMessage("photo", 2, 3).includes("page 2 of the 3"), "a page of several says which");
check(m.scopeReadUserMessage("pdf", 1, 1).includes("PDF"), "a PDF is called one");

/* ── Pages joined ────────────────────────────────────────────────────────────────────────────── */
{
  const p1 = m.scopeReadFromWire(
    wire({
      continuing: [item("orphan line")],
      rooms: [
        { name: "Kitchen", level: "Main floor", items: [item("R&R base")] },
        { name: "Bsmt bedroom", level: "Basement", items: [item("R&R cpt")] },
      ],
      general: [item("2 AM")],
      notes: ["Cat 2"],
      unreadable: ["a word"],
    }),
  );
  const p2 = m.scopeReadFromWire(
    wire({
      continuing: [item("Anti-micro")],
      rooms: [
        { name: "kitchen", level: "Main Floor", items: [item("D&R fridge")] },
        { name: "Kitchen", level: "", items: [item("Paint")] },
        { name: "Laundry", level: "", items: [item("Rmv lino")] },
      ],
      notes: ["Cat 2", "Smith"],
      unreadable: ["a number"],
    }),
  );
  const scope = m.mergePages([
    { read: p1, file: "IMG_1.jpg" },
    { read: p2, file: "IMG_2.jpg" },
  ]);
  check(scope.general.map((i) => i.written).join("|") === "orphan line|2 AM", "the first page's carried-on lines go to the whole job, its whole-job lines after");
  check(scope.rooms.find((r) => r.name === "Bsmt bedroom").items.map((i) => i.written).join("|") === "R&R cpt|Anti-micro", "a page's carried-on lines go to the room the page before ended on");
  const kitchens = scope.rooms.filter((r) => r.name.toLowerCase() === "kitchen");
  check(kitchens.length === 2 && kitchens[0].items.map((i) => i.written).join("|") === "R&R base|D&R fridge", "the same room and level on a later page is the same room (case aside); another level is another room");
  check(scope.rooms.map((r) => r.name).join("|") === "Kitchen|Bsmt bedroom|Kitchen|Laundry", "rooms stay in the order first written");
  check(scope.notes.join("|") === "Cat 2|Smith", "a note written on both pages is kept once");
  check(JSON.stringify(scope.unreadable) === JSON.stringify([{ page: 1, what: "a word" }, { page: 2, what: "a number" }]), "what could not be read keeps its page");
  check(scope.pages === 2 && scope.files.join(",") === "IMG_1.jpg,IMG_2.jpg", "the pages and their files are kept");
  check(m.scopeLineCount(scope) === 8, `lines of work counted (got ${m.scopeLineCount(scope)})`);
  check(p1.rooms[0].items.length === 1, "joining leaves the pages themselves as they were");
}

/* ── The block of notes ──────────────────────────────────────────────────────────────────────── */
{
  const scope = m.mergePages([{ read: sample.read, file: "scope.jpg" }]);
  const block = m.scopeToNotes(scope);
  const lines = block.split("\n");
  check(lines[0] === `${m.UPLOADED_SCOPE_START} (1 page: scope.jpg) ===`, `the block opens with its marker, the pages and the file (got ${lines[0]})`);
  check(lines[lines.length - 1] === m.UPLOADED_SCOPE_END, "and closes with its end marker");
  check(lines.includes("Basement bedroom (Basement):"), "a room heading gives its level");
  check(lines.includes("- Remove and replace carpet and pad [written: R&R cpt & pad] (142 SF)"), "a line: plain words, the writing, the quantity");
  check(lines.includes("- Remove and replace baseboard [written: Base R&R 1? LF] (1? LF) (not sure this was read right)"), "a doubtful line says so");
  check(lines.includes("Whole job:") && lines.includes("Notes on the scope:") && lines.includes("Could not read:"), "whole-job lines, notes and unread bits each under their own heading");
  check(lines.some((l) => l.startsWith("- page 1: the number before LF")), "an unread bit gives its page");
  check(m.itemLine({ written: "Anti-micro", plain: "anti micro", quantity: null, unsure: false }) === "- anti micro", "the writing is left out where it only differs in case and punctuation");
  check(m.appendToNotes("Walked the basement.\n\n", block).startsWith("Walked the basement.\n\n=== FROM"), "added after the notes, past a blank line");
  check(m.appendToNotes("   ", block) === block, "into empty notes, the block alone");
  check(m.scopeToNotes(m.mergePages([{ read: sample.read, file: "a.jpg" }, { read: sample.read, file: "b.jpg" }])).startsWith(`${m.UPLOADED_SCOPE_START} (2 pages: a.jpg, b.jpg) ===`), "several pages are counted in the heading");
}

/* ── The rule, only when the notes hold an uploaded scope ────────────────────────────────────── */
{
  const plain = "Basement bedroom, carpet and pad wet, cut 2 ft.";
  const block = m.scopeToNotes(m.mergePages([{ read: sample.read, file: "scope.jpg" }]));
  const withScope = m.appendToNotes(plain, block);
  const notes = "Basement bedroom, 10:02: baseboard wet behind the bed";
  check(m.uploadedScopeSection(plain) === "" && m.uploadedScopeSection("") === "" && m.uploadedScopeSection(null) === "", "no uploaded scope, no rule");
  check(m.uploadedScopeSection(withScope) === `\n\n${m.UPLOADED_SCOPE_RULE}`, "an uploaded scope in the notes brings the rule");
  const room = new Proxy({ roomName: "Basement bedroom" }, { get: (o, k) => (k in o ? o[k] : typeof k === "string" ? [] : undefined) });
  const ex = { rooms: [room] };
  const builders = [
    ["extraction (call 1)", (t) => m.extractionUserMessage(t, notes)],
    ["detail (call 2)", (t) => m.extractionDetailUserMessage(t, ex, notes)],
    ["supplement", (t) => m.extractionSupplementUserMessage(t, ex, notes)],
    ["unscoped", (t) => m.extractionUnscopedUserMessage(t, ex, notes)],
  ];
  for (const [name, b] of builders) {
    check(b(plain).endsWith(`${plain}${m.photoNotesSection(notes)}`), `${name}: dictated notes send exactly what they did (the transcript, then the photo notes, nothing between)`);
    check(b(withScope).includes(`${withScope}\n\n${m.UPLOADED_SCOPE_RULE}${m.photoNotesSection(notes)}`), `${name}: with an uploaded scope, the rule comes after the transcript and before the photo notes`);
  }
  const gen = readFileSync(join(root, "lib", "documentGenerationPrompt.ts"), "utf8");
  check((gen.match(/\$\{transcript\}\$\{uploadedScopeSection\(transcript\)\}\$\{photoNotesSection\(photoNotes\)\}/g) ?? []).length === 2, "the documents call carries the rule after its transcript, in both its forms");
  check(m.UPLOADED_SCOPE_RULE.includes(m.UPLOADED_SCOPE_START) && m.UPLOADED_SCOPE_RULE.includes(m.UPLOADED_SCOPE_END), "the rule names the markers it is about");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
