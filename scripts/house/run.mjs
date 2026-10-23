/**
 * The test-house runner: a folder of photos and a few tapes in words become the measured exterior, an accuracy table
 * and the customer report, with a Claude session checking the corners by eye between the steps. Scrivn's own code on
 * this machine, no API. The session's checklist is docs/house-runner.md.
 *
 *   node scripts/house/run.mjs <folder> prepare [--fresh]   level the photos, corner candidates, sheets, draft inputs.json
 *   node scripts/house/run.mjs <folder> check               inputs.json as the route reads it; what is missing
 *   node scripts/house/run.mjs <folder> measure             outline ± per side, advice, sides/, plan, hold-outs, results.md
 *   node scripts/house/run.mjs <folder> fix [--measure]     scrivn/fixes.txt into inputs.json, then check (or measure) again
 *   node scripts/house/run.mjs <folder> match               each close-up laid on its wall's full photo (match/), tapes on them checked
 *   node scripts/house/run.mjs <folder> read                each side from every photo (read/), read.txt; reading.json's answers in
 *   node scripts/house/run.mjs <folder> report              reads.json + roof.json on, report.pdf, exterior.json
 *   node scripts/house/run.mjs <folder> zoom <photo> <x> <y> [half]   a close look, and where a corner tapped there snaps
 *   node scripts/house/run.mjs <folder> zoom <photo> x,y x,y ... [--half n]   several close looks in one picture
 *
 * <folder> is a folder of photos with tapes.txt (and house.txt) beside them, or a pulled Send-to-team request
 * (exterior-requests/<id>/, with request.json). Everything the runner writes goes in <folder>/scrivn/.
 */
import { pathToFileURL } from "node:url";
import { openHouse } from "./folder.mjs";
import { check, fix, measure, prepare, report, zoom } from "./steps.mjs";
import { read } from "./read.mjs";
import { match } from "./match.mjs";

const USAGE = "node scripts/house/run.mjs <folder> prepare|check|fix|measure|match|read|report|zoom [args]  (docs/house-runner.md)";

export async function runStep(folder, step, args = []) {
  const h = await openHouse(folder);
  switch (step) {
    case "prepare":
      return prepare(h, { fresh: args.includes("--fresh") });
    case "check":
      return check(h);
    case "measure":
      return measure(h);
    case "fix": {
      // fix: scrivn/fixes.txt; fix "3 C10 ok" "keep 9:C7" ...: those lines; --measure: measure after, not check.
      const then = args.includes("--measure") ? "measure" : "check";
      return fix(h, args.filter((a) => a !== "--measure"), { then });
    }
    case "match":
      return match(h);
    case "read":
      return read(h);
    case "report":
      return report(h);
    case "zoom": {
      // zoom <photo> <x> <y> [half]: one big crop; zoom <photo> x,y x,y ... [--half n]: several in one picture.
      const [photo, ...rest] = args;
      const at = rest.indexOf("--half");
      const half = at >= 0 ? Number(rest[at + 1]) : null;
      const words = rest.filter((a, i) => !(at >= 0 && (i === at || i === at + 1)));
      const many = words.filter((a) => a.includes(","));
      const points = many.length ? many.map((a) => a.split(",").map(Number)) : [[Number(words[0]), Number(words[1])]];
      if (!photo || points.some((q) => q.length !== 2 || !q.every(Number.isFinite))) throw new Error("zoom <photo> <x> <y> [half], or zoom <photo> x,y x,y ... [--half n]: a photo's number and points in its pixels.");
      return zoom(h, photo, points, half ?? (many.length ? 100 : words[2] ? Number(words[2]) : 120));
    }
    default:
      throw new Error(USAGE);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [folder, step, ...rest] = process.argv.slice(2);
  try {
    if (!folder || !step) throw new Error(USAGE);
    const lines = await runStep(folder, step, rest);
    console.log(lines.join("\n"));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
