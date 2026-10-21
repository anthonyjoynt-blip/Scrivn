/**
 * The test-house runner (scripts/house/run.mjs, docs/house-runner.md) end to end, no API:
 *
 *   1. tapes.txt and house.txt read as the owner writes them, and the review's fixes as a session writes them;
 *   2. the owner's house (C:/Users/Anthony/Desktop/House Photos, or PHOTO_ROUTE_PHOTOS) with his three tapes: prepare,
 *      the session's inputs (fixtures/house-runner/owner-1016-inputs.json), check and its review (only what is in
 *      doubt), a fix round, measure - each tape held out in turn, his two decks placed - and its review, the trim
 *      build's reads laid on the squared sides, his roof answers, the report with the decks' lines;
 *   3. a pulled Send-to-team request made from the same photos (houseRequestFolder.mjs): prepare starts from the
 *      tester's own shape, taps and tapes, and measure lands within the ± of test:exterior:photos's table;
 *   4. the shed (C:/Users/Anthony/Desktop/Shed photos, or SHED_PHOTOS) with its one tape: no hold-out, said so, and the
 *      door check instead.
 *
 *   npm run test:exterior:house        (about two and a half minutes)
 *
 * Each runs in a copy of the photos in a temp folder, so the owner's folders are not written.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStep } from "../../scripts/house/run.mjs";
import { readsFromFinish } from "../../scripts/house/finishReads.mjs";
import { siteReportPdf } from "../../scripts/house/site.mjs";
import { lengthsIn, parseHouse, parseTapes } from "../../scripts/house/words.mjs";
import { parseFixes } from "../../scripts/house/review.mjs";
import { makeRequestFolder } from "./houseRequestFolder.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FX = (f) => join(here, "fixtures", f);
const PHOTOS = process.env.PHOTO_ROUTE_PHOTOS ?? "C:/Users/Anthony/Desktop/House Photos";
const SHED = process.env.SHED_PHOTOS ?? "C:/Users/Anthony/Desktop/Shed photos";
const work = mkdtempSync(join(tmpdir(), "house-runner-test-"));
const t0 = Date.now();

const passed = [];
const failures = [];
function check(name, ok, detail = "") {
  if (ok) passed.push(name);
  else failures.push(name);
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? `\n      ${detail}` : ""}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const json = (f) => JSON.parse(readFileSync(f, "utf8"));

/** A copy of a folder's photos, with the words beside them. */
function folderOf(name, from, words) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(from).filter((q) => /\.jpe?g$/i.test(q))) copyFileSync(join(from, f), join(dir, f));
  for (const [f, text] of Object.entries(words)) writeFileSync(join(dir, f), text);
  return dir;
}

const timed = async (folder, step) => {
  const t = Date.now();
  const lines = await runStep(folder, step);
  return { lines, seconds: (Date.now() - t) / 1000 };
};

// ── 1. The words ──────────────────────────────────────────────────────────────────────────────────
console.log("\n  tapes.txt and house.txt");
{
  const { tapes, unread } = parseTapes(`garage doors 9' wide\nrear wall with the hose 22'2"\nporch 263 in\nroll-up door 5' wide\nwindow 3 ft 2 in\nside 6.5 m\n# a note\nsomething with no length`);
  check("a garage door tape is a line on a photo, two alike for \"doors\"", tapes[0].kind === "line" && tapes[0].what === "garage" && tapes[0].count === 2 && tapes[0].feet === 9);
  check("a wall's tape is a side, 22'2\" read as feet and inches", tapes[1].kind === "side" && near(tapes[1].feet, 22 + 2 / 12, 1e-9));
  check("263 in is 21'11\" along a wall (the porch)", tapes[2].kind === "side" && near(tapes[2].feet, 263 / 12, 1e-9));
  check("a roll-up door is a line, taken as an overhead door", tapes[3].what === "garage" && tapes[3].count === 1);
  check("\"window 3 ft 2 in\" is one window, not two", tapes[4].what === "window" && tapes[4].count === 1 && near(tapes[4].feet, 3 + 2 / 12, 1e-9));
  check("metres become feet", near(tapes[5].feet, 6.5 / 0.3048, 1e-9));
  check("a line with no length is said back, a comment skipped", unread.length === 1 && unread[0] === "something with no length" && tapes.length === 6);
  check("22' 2 1/2\" with a fraction", near(lengthsIn(`22' 2 1/2"`)[0].feet, 22 + 2.5 / 12, 1e-9));
  const house = parseHouse("semi-detached\nfront faces NE\nname: 52 Elm St\nstucco, two storeys");
  check("house.txt: the home's type, the front's bearing, its name and notes", house.homeType === "semi" && house.frontFacesDeg === 45 && house.name === "52 Elm St" && house.notes.includes("stucco, two storeys"));
  check("front faces unknown is no bearing", parseHouse("front faces unknown").frontFacesDeg === null);
  const fx = parseFixes(`# a comment\n#3 C10 ok\n3 C10 = c\n3 C10 = 496,1000\n3 C10 = 490,600 496,1000\n3 C10 ~ 1300,1010\n3 ? = 1340,1010\n3 C10 -> C9\n3 C10 drop\n3 out\nkeep 9:C7 15:C3\ntape t1#2 15 = 497,900 868,900\ntape t2 side C5-C6\ndeck back 6 corner:0 = 1210,980\n3 C10 maybe`);
  check(
    "fixes.txt: each kind of fix read, a comment skipped, #3 a photo, ~ a snapped tap, = exact, a line it can't read said",
    fx.length === 14 && fx[0].kind === "ok" && fx[0].photo === 3 && fx[1].pick === "c" && fx[2].at && !fx[2].snap && fx[3].edge?.length === 2 && fx[4].snap === true && fx[5].name === "?" && fx[6].to === "C9" && fx[7].kind === "drop" && fx[8].kind === "photo-out" && fx[9].marks.length === 2 && fx[10].id === "t1#2" && fx[11].side === "C5-C6" && fx[12].deck === "back" && fx[12].point === "corner:0" && Boolean(fx[13].error),
  );
}

const summary = [];
let houseDir = null;
let shedDir = null;

// ── 2. The owner's house ──────────────────────────────────────────────────────────────────────────
if (!existsSync(PHOTOS)) {
  failures.push(`the owner's photos are not at ${PHOTOS} (set PHOTO_ROUTE_PHOTOS)`);
} else {
  console.log("\n  The owner's house, his three tapes");
  const dir = folderOf("house", PHOTOS, { "tapes.txt": `garage doors 9' wide\nrear wall with the hose (bump-out gable) 22'2"\nporch 263 in (keystone wall to the inside of the west porch post)\n`, "house.txt": "front faces 16\n" });
  const prep = await timed(dir, "prepare");
  const draft = json(join(dir, "scrivn", "inputs.json"));
  const cands = json(join(dir, "scrivn", "candidates.json")).photos;
  check(
    "prepare: 18 photos levelled, corner candidates, a sheet each and the contact sheet, the draft with his three tapes",
    /18 of 18 photos levelled/.test(prep.lines.join("\n")) && Object.values(cands).filter((c) => c.length).length >= 15 && readdirSync(join(dir, "scrivn", "sheets")).length === 18 && existsSync(join(dir, "scrivn", "contact.png")) && draft.tapes.length === 3 && draft.tapes[0].count === 2 && draft.tapes[1].kind === "side" && draft.house.frontFacesDeg === 16,
    `${prep.seconds.toFixed(1)} s`,
  );
  // The session's look: the shape, the corners, where the tapes lie (10-20).
  const inputs = json(FX("house-runner/owner-1016-inputs.json"));
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify(inputs, null, 1));
  const chk = await timed(dir, "check");
  check("check: ready, every photo with two corners or more placed, a close-up strip of each photo's corners", /Ready to measure/.test(chk.lines.join("\n")) && !chk.lines.some((l) => l.startsWith("✗")) && readdirSync(join(dir, "scrivn", "taps")).length >= 14, `${chk.seconds.toFixed(1)} s`);
  // Without #17's names, Scrivn numbers its three taps as a run: the check shows it.
  const unnamed = { ...inputs, corners: inputs.corners.map((c) => (c.photo === 17 && c.x > 900 ? { photo: c.photo, x: c.x, y: c.y } : c)) };
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify(unnamed, null, 1));
  const wrong = await runStep(dir, "check");
  check("check shows Scrivn's numbers: #17 with only C11 named reads C11 C12 C1 (its pilasters are C1 and C4)", wrong.some((l) => /#17 C11 C12 C1\b/.test(l)), wrong.find((l) => l.includes("#17")));
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify(inputs, null, 1));
  // The review: only what is in doubt, on one sheet, answered in one fixes.txt.
  const rv = await runStep(dir, "check");
  const rvText = readFileSync(join(dir, "scrivn", "review.txt"), "utf8");
  const rvItems = rvText.split("\n").filter((l) => /^R\d+/.test(l));
  check("check's review: review.png and review.txt, fewer items than corners, his garage doors' four tape ends among them", existsSync(join(dir, "scrivn", "review.png")) && rvItems.length > 0 && rvItems.length < inputs.corners.length && rvItems.filter((l) => /tape t1#\d [ab]/.test(l)).length === 4 && existsSync(join(dir, "scrivn", "numbered.json")), `${rvItems.length} in doubt of ${inputs.corners.length} corners`);
  const refused = await runStep(dir, "fix", ["tape t1 ok", "3 C10 maybe"]);
  check("fix: a line it can't read changes nothing", refused.some((l) => l.startsWith("✗")) && !json(join(dir, "scrivn", "inputs.json")).tapes[0].ok);
  writeFileSync(join(dir, "scrivn", "fixes.txt"), "# his tape ends, as placed\ntape t1 ok\n");
  const fixed = await runStep(dir, "fix");
  const rv2 = readFileSync(join(dir, "scrivn", "review.txt"), "utf8");
  check("fix: fixes.txt into inputs.json, kept in fixes-done/, and the review again without what was answered", json(join(dir, "scrivn", "inputs.json")).tapes[0].ok === true && readdirSync(join(dir, "scrivn", "fixes-done")).length === 1 && !existsSync(join(dir, "scrivn", "fixes.txt")) && !/tape t1/.test(rv2) && fixed.some((l) => /^Review: /.test(l)), fixed[0]);
  // His two decks (fixtures/house-runner/owner-1016-decks.json), placed on the house as measured.
  const decksIn = json(FX("house-runner/owner-1016-decks.json")).decks;
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify({ ...inputs, decks: decksIn }, null, 1));
  const meas = await timed(dir, "measure");
  const res = json(join(dir, "scrivn", "results.json"));
  console.log(meas.lines.slice(0, 18).map((l) => `      ${l}`).join("\n"));
  // On his own taps alone (no mark of Scrivn's kept: none was on a corner it could see), each held out in turn.
  check("each of his three tapes held out in turn is predicted within 5% by the other two", res.holdOuts.length === 3 && res.holdOuts.every((r) => Math.abs(r.errorPct) < 5), res.holdOuts.map((r) => `${r.id} ${r.errorPct.toFixed(1)}%`).join(", "));
  const bump = res.sides.find((sd) => sd.side === "C6-C7");
  check("the bump-out's west side, whose inner corner no photo shows, is said unmeasured (± 30% or more) and a tape asked for", bump.plusMinusPct >= 30 && res.advice.some((a) => a.from === 5), `${bump.lengthFeet.toFixed(2)} ft ±${bump.plusMinusPct}%`);
  check("Scrivn's marks are offered close up, one image a photo, none kept unasked", readdirSync(join(dir, "scrivn", "marks")).length >= 5 && res.kept === 0);
  const mrv = readFileSync(join(dir, "scrivn", "review.txt"), "utf8");
  check("measure's review: Scrivn's marks and the photos not placed, on review.png", existsSync(join(dir, "scrivn", "review.png")) && /^Measure/.test(mrv) && /mark \d+:C\d+/.test(mrv) && /not placed/.test(mrv));
  const mext = json(join(dir, "scrivn", "measured.json"));
  const rearDeck = (mext.decks ?? []).find((d) => d.name === "Rear deck");
  const porch = (mext.decks ?? []).find((d) => d.name === "Front porch");
  const span = (d) => Math.max(...d.outline.map((q) => q.x)) - Math.min(...d.outline.map((q) => q.x));
  check(
    "his two decks placed off their taps: the rear deck 6'0\" out (his tape) and along the rear wall to the gable's line, the porch along the whole front wall, their railings, stairs and screens on their edges",
    rearDeck && porch && Math.abs(Math.max(...rearDeck.outline.map((q) => q.y)) - 6) < 0.05 && Math.abs(span(rearDeck) - 26.6) < 1 && Math.abs(span(porch) - 263 / 12) < 0.5 && rearDeck.railings.length === 3 && rearDeck.stairs.length === 1 && rearDeck.screens.length === 1 && porch.screens.length === 3 && /## Decks/.test(readFileSync(join(dir, "scrivn", "results.md"), "utf8")),
    rearDeck && porch ? `rear ${span(rearDeck).toFixed(2)} ft along, porch ${span(porch).toFixed(2)} ft` : "not placed",
  );
  check("all three run across the house: results say nothing checks its depth", /none runs front to back/.test(res.depthNote ?? ""));
  check("measure writes the plan, a squared side for each side with a photo (and its grid), the measured exterior", existsSync(join(dir, "scrivn", "plan.png")) && Object.keys(json(join(dir, "scrivn", "sides", "frames.json")).sides).length === 11 && existsSync(join(dir, "scrivn", "measured.json")) && readdirSync(join(dir, "scrivn", "sides")).filter((f) => f.endsWith(" grid.png")).length === 11);
  const pct = (name) => res.sides.find((s) => s.name === name);
  check("the taped sides come out as taped; the garage fronts within 4% of the proof's README", near(pct("Rear bump-out gable").lengthFeet, 22 + 2 / 12, 0.05) && near(pct("Front wall behind the porch").lengthFeet, 263 / 12, 0.05) && Math.abs(pct("Garage front, left bay").lengthFeet / (13 + 4 / 12) - 1) < 0.04 && Math.abs(pct("Garage front, right bay").lengthFeet / 13.5 - 1) < 0.04);
  // The walls: the trim build's reads (fixtures/photos-only-1016-trim.json) laid on this measure's squared sides; his roof answers.
  const { reads } = await readsFromFinish(dir, json(FX("photos-only-1016-trim.json")), json(FX("photos-only-1016.json")));
  writeFileSync(join(dir, "scrivn", "reads.json"), JSON.stringify(reads, null, 1));
  copyFileSync(FX("house-runner/owner-1016-roof.json"), join(dir, "scrivn", "roof.json"));
  const rep = await timed(dir, "report");
  const pdf = readFileSync(join(dir, "scrivn", "report.pdf")).toString("latin1");
  const md = readFileSync(join(dir, "scrivn", "report.md"), "utf8");
  const ext = json(join(dir, "scrivn", "exterior.json"));
  const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1] ?? 0);
  console.log(rep.lines.slice(0, 12).map((l) => `      ${l}`).join("\n"));
  check("report: the reads put on 8 sides, the garage doors read 9'0\"", rep.lines.filter((l) => /^ {2}read C/.test(l)).length === 8 && rep.lines.some((l) => /C1-C2 .*garage 9'0"/.test(l)));
  check("report: his roof answers on, the deck under the roof, the roof at his 5/12", /pitch 5\/12 typed/.test(rep.lines.join("\n")) && /notch C8-C9 .*: covered/.test(md) && /Proposed and not answered: nothing\./.test(md));
  check("report: the trim counted, Check these asks about the porch window's surround behind the railing", /SF of trim/.test(md) && /surround round the window .*porch railing/i.test(md));
  check("report: the PDF with its side photos, the elevations named by the compass", pages >= 15 && (pdf.match(/DCTDecode/g) ?? []).length >= 5 && /North elevation/.test(pdf), `${pages} pages`);
  check("exterior.json is a photos exterior that would open in a claim", ext.source?.kind === "photos" && ext.sides.length === 12 && ext.roof?.checkedAt);
  check("report: the decks' lines (decking, glass railing, stairs, privacy screen, skirting) and Check these under them", /## Decks/.test(md) && /Rear deck – composite decking/.test(md) && /Rear deck – glass railing/.test(md) && /Rear deck – stairs – 8 risers/.test(md) && /privacy screen/.test(md) && /Front porch – skirting/.test(md) && (ext.decks ?? []).length === 2);
  summary.push(`house: prepare ${prep.seconds.toFixed(0)} s, check ${chk.seconds.toFixed(0)} s, measure ${meas.seconds.toFixed(0)} s, report ${rep.seconds.toFixed(0)} s; hold-outs ${res.holdOuts.map((r) => `${r.id} ${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(1)}%`).join(", ")}`);
  houseDir = dir;

  // ── 3. A pulled request made from the same photos ─────────────────────────────────────────────
  console.log("\n  A pulled Send-to-team request from the same photos");
  const req = await makeRequestFolder(join(work, "requests"), PHOTOS);
  const rprep = await timed(req, "prepare");
  const rdraft = json(join(req, "scrivn", "inputs.json"));
  check("prepare starts from the tester's own shape, 30 corner taps (numbered as sent) and 4 tapes, and their note", rdraft.shape.from === "tester" && rdraft.shape.outline.length === 12 && rdraft.corners.length === 30 && rdraft.corners.every((c) => c.corner) && rdraft.tapes.length === 4 && rdraft.house.notes.some((nn) => /west post/.test(nn)), `${rprep.seconds.toFixed(1)} s`);
  const rmeas = await timed(req, "measure");
  const rres = json(join(req, "scrivn", "results.json"));
  // test:exterior:photos, all tapes, on the same inputs (the photos as he took them): each side and its ±.
  const TABLE = [[13 + 8 / 12, 3], [2, 9], [13 + 2 / 12, 3], [69.5, 15], [22 + 2 / 12, 0], [9 + 11 / 12, 29], [13 + 8 / 12, 7], [7.75, 18], [13, 7], [23 + 11 / 12, 36], [21 + 11 / 12, 0], [26, 4]];
  const off = rres.sides.map((s, i) => {
    const [ref, pm] = TABLE[i];
    const tol = Math.max(pm, s.plusMinusPct ?? 0, 1) / 100;
    return { side: s.side, ok: Math.abs(s.lengthFeet / ref - 1) <= tol, pct: ((s.lengthFeet / ref - 1) * 100).toFixed(1) };
  });
  check("measure on the tester's inputs lands every side within its ± of test:exterior:photos's table", off.every((o) => o.ok), off.map((o) => `${o.side} ${o.pct}%`).join(", "));
  check("and holds each of the tester's 4 tapes out in turn", rres.holdOuts.length === 4 && rres.holdOuts.every((r) => r.predicted !== null && Math.abs(r.errorPct) < 6), rres.holdOuts.map((r) => `${r.id} ${r.errorPct.toFixed(1)}%`).join(", "));
  summary.push(`request: prepare ${rprep.seconds.toFixed(0)} s, measure ${rmeas.seconds.toFixed(0)} s`);
}

// ── 4. The shed ───────────────────────────────────────────────────────────────────────────────────
if (!existsSync(SHED)) {
  failures.push(`the shed's photos are not at ${SHED} (set SHED_PHOTOS)`);
} else {
  console.log("\n  The shed, one tape");
  const dir = folderOf("shed", SHED, { "tapes.txt": "roll-up door 5' wide\n" });
  const prep = await timed(dir, "prepare");
  const draft = json(join(dir, "scrivn", "inputs.json"));
  check("prepare: 7 photos, the roll-up door's tape a line on a photo", /7 of 7 photos levelled/.test(prep.lines.join("\n")) && draft.tapes.length === 1 && draft.tapes[0].kind === "line" && draft.tapes[0].what === "garage", `${prep.seconds.toFixed(1)} s`);
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify(json(FX("house-runner/shed-1017-inputs.json")), null, 1));
  const meas = await timed(dir, "measure");
  const res = json(join(dir, "scrivn", "results.json"));
  console.log(meas.lines.slice(0, 9).map((l) => `      ${l}`).join("\n"));
  const [front, right] = res.sides;
  // His tapes of 10-20, held out: 195" across the front, 147" deep. The 5' is the opening between the roll-up's trim.
  check("the shed's front within 2% of his 195\" tape, from the roll-up's 5' alone", Math.abs(front.lengthFeet / (195 / 12) - 1) < 0.02, `${front.lengthFeet.toFixed(2)} ft`);
  check("its depth within the ± the route gives it of his 147\" tape (no tape runs that way: a tape along a side is asked)", Math.abs(right.lengthFeet / (147 / 12) - 1) * 100 <= right.plusMinusPct && res.advice.some((a) => a.from === 1 || a.from === 3), `${right.lengthFeet.toFixed(2)} ft ±${right.plusMinusPct}%`);
  check("one tape: no hold-out, said so; the door check instead, a sanity check: the man door's slab within 3% of 6'8\"", res.holdOuts.length === 0 && /nothing to hold it out against/.test(res.holdNote) && res.checks.length === 1 && Math.abs(res.checks[0].got / (6 + 8 / 12) - 1) < 0.03 && /sanity check/.test(readFileSync(join(dir, "scrivn", "results.md"), "utf8")), `man door ${res.checks[0]?.got?.toFixed(2)} ft`);
  check("every photo with two corners placed, #1 too (a placement putting the camera a foot off the ground is dropped)", res.cameras === 6, `${res.cameras} placed`);
  // His tapes in (10-20): the walls read, the roof one slope of metal, one report with the house.
  const T = json(FX("house-runner/tapes-1020.json"));
  const fin = json(join(dir, "scrivn", "inputs.json"));
  writeFileSync(join(dir, "scrivn", "inputs.json"), JSON.stringify({ ...fin, tapes: [...fin.tapes, ...T.shed.tapes], heights: T.shed.heights }, null, 1));
  await runStep(dir, "measure");
  const fres = json(join(dir, "scrivn", "results.json"));
  check("with his tapes in, the shed is 16'3\" by 12'3\"", Math.abs(fres.sides[0].lengthFeet - 195 / 12) < 0.05 && Math.abs(fres.sides[1].lengthFeet - 147 / 12) < 0.05);
  const reads = json(FX("house-runner/shed-1017-reads.json"));
  const frames = json(join(dir, "scrivn", "sides", "frames.json")).sides;
  for (const k of Object.keys(reads.sides)) if (frames[k]) reads.sides[k].frame = frames[k].frame;
  writeFileSync(join(dir, "scrivn", "reads.json"), JSON.stringify(reads, null, 1));
  copyFileSync(FX("house-runner/shed-1017-roof.json"), join(dir, "scrivn", "roof.json"));
  const srep = await runStep(dir, "report");
  const sext = json(join(dir, "scrivn", "exterior.json"));
  const sq = /roof ([\d.]+) SQ/.exec(srep.join("\n"));
  check("the shed's report: metal walls and a one-slope metal roof, every eave at his low wall's 7'4\", a roll-up door", sext.roof.material === "metal" && sext.roof.oneSlopeTo && sext.sides.every((sd) => sd.bands.every((b) => b.kind === "metal") && sd.base === "grade") && sext.sides.some((sd) => sd.openings.some((o) => o.kind === "rollup")) && sext.sides.every((sd) => Math.abs(sd.eaveLeftFeet - 88 / 12) < 1e-6 && Math.abs(sd.eaveRightFeet - 88 / 12) < 1e-6), sq?.[0]);
  shedDir = dir;
  summary.push(`shed: prepare ${prep.seconds.toFixed(0)} s, measure ${meas.seconds.toFixed(0)} s; ${front.lengthFeet.toFixed(2)} x ${right.lengthFeet.toFixed(2)} ft`);
}

// ── 5. One report for the house and the shed ─────────────────────────────────────────────────────
if (houseDir && shedDir) {
  console.log("\n  The house and the shed in one report");
  const out = join(work, "site.pdf");
  const { pages, site } = await siteReportPdf(out, houseDir, [{ dir: shedDir, name: "Shed" }], { title: "The owner's house and shed", date: "Oct 20, 2026" });
  const pdf = readFileSync(out).toString("latin1");
  check("one PDF, the shed its own section after the house's, its photos and the house's both in", site.buildings.length === 1 && pages > 25 && /Shed · Roof plan/.test(pdf) && (pdf.match(/DCTDecode/g) ?? []).length >= 8, `${pages} pages`);
}

// Windows can hold a file the photos were read from a moment longer: retried, and said if it stays.
try {
  rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch {
  console.log(`  (the temp copies stay at ${work}: Windows still holds a file there)`);
}
console.log(`\n  ${summary.join("\n  ")}`);
console.log(`\n  house runner: ${passed.length} passed, ${failures.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
for (const f of failures) console.log(`  FAILED: ${f}`);
process.exit(failures.length ? 1 : 0);
