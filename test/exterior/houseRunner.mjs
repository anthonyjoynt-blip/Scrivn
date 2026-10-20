/**
 * The test-house runner (scripts/house/run.mjs, docs/house-runner.md) end to end, no API:
 *
 *   1. tapes.txt and house.txt read as the owner writes them;
 *   2. the owner's house (C:/Users/Anthony/Desktop/House Photos, or PHOTO_ROUTE_PHOTOS) with his three tapes: prepare,
 *      the session's inputs (fixtures/house-runner/owner-1016-inputs.json), check, measure - each tape held out in turn -
 *      the trim build's reads laid on the squared sides, his roof answers, the report;
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
import { lengthsIn, parseHouse, parseTapes } from "../../scripts/house/words.mjs";
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
}

const summary = [];

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
  const meas = await timed(dir, "measure");
  const res = json(join(dir, "scrivn", "results.json"));
  console.log(meas.lines.slice(0, 18).map((l) => `      ${l}`).join("\n"));
  check("each of his three tapes held out in turn is predicted within 2% by the other two", res.holdOuts.length === 3 && res.holdOuts.every((r) => Math.abs(r.errorPct) < 2), res.holdOuts.map((r) => `${r.id} ${r.errorPct.toFixed(1)}%`).join(", "));
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
  summary.push(`house: prepare ${prep.seconds.toFixed(0)} s, check ${chk.seconds.toFixed(0)} s, measure ${meas.seconds.toFixed(0)} s, report ${rep.seconds.toFixed(0)} s; hold-outs ${res.holdOuts.map((r) => `${r.id} ${r.errorPct >= 0 ? "+" : ""}${r.errorPct.toFixed(1)}%`).join(", ")}`);

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
  // The 5' is the opening between the roll-up's trim (the owner, 10-20): the front within the 10-17 bundle solve's ±6%,
  // the depth within the route's own ±10% (no tape runs that way).
  check("the shed's front within the 10-17 bundle solve's ±6% of 16'3\", its depth within its ±10% of 12'4\"", Math.abs(front.lengthFeet / 16.26 - 1) < 0.06 && Math.abs(right.lengthFeet / 12.32 - 1) < 0.1, `${front.lengthFeet.toFixed(2)} x ${right.lengthFeet.toFixed(2)}`);
  check("one tape: no hold-out, said so; the door check instead, a sanity check: the man door's slab within 3% of 6'8\"", res.holdOuts.length === 0 && /nothing to hold it out against/.test(res.holdNote) && res.checks.length === 1 && Math.abs(res.checks[0].got / (6 + 8 / 12) - 1) < 0.03 && /sanity check/.test(readFileSync(join(dir, "scrivn", "results.md"), "utf8")), `man door ${res.checks[0]?.got?.toFixed(2)} ft`);
  check("the shed's rms as the house's: its corners on their feet", res.rms < 1, res.rms.toFixed(2));
  summary.push(`shed: prepare ${prep.seconds.toFixed(0)} s, measure ${meas.seconds.toFixed(0)} s; ${front.lengthFeet.toFixed(2)} x ${right.lengthFeet.toFixed(2)} ft`);
}

rmSync(work, { recursive: true, force: true });
console.log(`\n  ${summary.join("\n  ")}`);
console.log(`\n  house runner: ${passed.length} passed, ${failures.length} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
for (const f of failures) console.log(`  FAILED: ${f}`);
process.exit(failures.length ? 1 : 0);
