/**
 * reads.json for the house runner from walls already read on the same house before, recorded as a Scan Finish block
 * (scrivn-finish/1, lib/exteriorFinish.ts FinishWalls: feet along each side and up), beside the capture they were read
 * against. Each side's walls are laid on this measure's squared photo of that side (scrivn/sides/frames.json) in the
 * trace's wire format, as a session reading it would write them: positions along the side stretched to this measure's
 * length, sizes as read; surrounds, keystones, pilasters and columns as the trace's off_wall boxes. Nothing is read again.
 *
 *   node scripts/house/finishReads.mjs <folder> <finish.json> <capture.json>      writes <folder>/scrivn/reads.json
 *
 * The owner's house: test/exterior/fixtures/photos-only-1016-trim.json (the trim build's reads, 10-17) on
 * photos-only-1016.json. The capture's sides are in the outline's order (side k runs from C(k+1)).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { scrivn } from "./code.mjs";
import { sideName } from "./words.mjs";

const M = 0.3048;
const KIND = { window: "window", door: "door", patio: "patio_door", garage: "garage_door", rollup: "garage_door" };
const OVER = { gable: "gable", hip: "hip_end", eave: "eave" };

/** The top of a shape: each corner no other corner of it stands over, left to right. */
function topChain(polygon) {
  const top = polygon.filter((p) => !polygon.some((q) => Math.abs(q.x - p.x) < 1e-6 && q.y > p.y + 1e-6));
  return [...top].sort((a, b) => a.x - b.x);
}

/** One side's FinishWalls as a wire read on [frame], its positions along stretched by [stretch]. */
export function wireOf(x, walls, roofRead, frame, stretch) {
  const X = (ft) => Math.round(x.frameX(frame, ft * M) * 10) / 10;
  const Y = (ft) => Math.round(x.frameY(frame, ft * M) * 10) / 10;
  const box = (x0, y0, x1, y1) => [X(x0), Y(y1), X(x1), Y(y0)];
  const off = [];
  const openings = walls.openings.map((o) => {
    const mid = (o.fromLeftFeet + o.widthFeet / 2) * stretch;
    const x0 = mid - o.widthFeet / 2;
    const x1 = mid + o.widthFeet / 2;
    const y0 = o.sillFeet;
    const y1 = o.sillFeet + o.heightFeet;
    const t = o.trim;
    if (t && (t.leftFeet || t.rightFeet || t.topFeet || t.bottomFeet || t.upFeet)) {
      const top = t.upFeet ? y1 + t.upFeet : y1 + t.topFeet;
      off.push({ what: `surround, ${t.material ?? "stucco"}${t.upFeet ? ", open top" : ""}${t.unsure?.startsWith("partly hidden by") ? `, ${t.unsure}` : ""}`, box: box(x0 - t.leftFeet, y0 - t.bottomFeet, x1 + t.rightFeet, top) });
    }
    if (t?.keystone) off.push({ what: `keystone, ${t.material ?? "stucco"}`, box: box(mid - t.keystone.widthFeet / 2, y1, mid + t.keystone.widthFeet / 2, y1 + t.keystone.heightFeet) });
    if (o.kind === "rollup") off.push({ what: "roll-up door", box: box(x0, y0, x1, y1) });
    return { kind: KIND[o.kind] ?? "window", left: X(x0), right: X(x1), top: Y(y1), bottom: Y(y0), measured_to: o.kind === "garage" || o.kind === "rollup" ? "door_itself" : "trim", leaf: [], partly_hidden_by: o.hiddenBy ?? "" };
  });
  for (const c of walls.columns ?? []) {
    const x0 = c.fromLeftFeet * stretch;
    const x1 = x0 + c.widthFeet;
    const foot = c.footFeet ?? 0;
    const head = foot + c.heightFeet;
    off.push({ what: `${c.kind}, ${c.material ?? "stucco"}`, box: box(x0, foot, x1, head) });
    if (c.base) off.push({ what: `base, ${c.material ?? "stucco"}`, box: box(x0 - c.base.outFeet, foot, x1 + c.base.outFeet, foot + c.base.heightFeet) });
    if (c.cap) off.push({ what: `cap, ${c.material ?? "stucco"}`, box: box(x0 - c.cap.outFeet, head - c.cap.heightFeet, x1 + c.cap.outFeet, head) });
  }
  const shapes = walls.shapes.map((s) => ({ material: s.kind, polygon: s.polygon.map((p) => [X(p.x * stretch), Y(p.y)]), partly_hidden_by: "" }));
  // The wall top: the top of the highest shape, as read.
  const highest = [...walls.shapes].sort((a, b) => Math.max(...b.polygon.map((p) => p.y)) - Math.max(...a.polygon.map((p) => p.y)))[0];
  const wallTop = highest ? topChain(highest.polygon).map((p) => [X(p.x * stretch), Y(p.y)]) : [];
  const wire = { materials: shapes, openings, wall_top: wallTop, off_wall: off, notes: "Laid from walls read before (a Finish block), not read again." };
  const over = OVER[roofRead?.over];
  if (over) wire.roof = { over_wall: over, rake_left: [], rake_right: [], eave_line: [], left_end: { kind: "hidden", point: [] }, right_end: { kind: "hidden", point: [] }, notes: "" };
  return wire;
}

/** reads.json for [folder] from [finish] (scrivn-finish/1) and the [capture] it was read against. */
export async function readsFromFinish(folder, finish, capture) {
  const x = await scrivn();
  const frames = JSON.parse(readFileSync(join(folder, "scrivn", "sides", "frames.json"), "utf8")).sides;
  const n = capture.sides.length;
  const sides = {};
  const said = [];
  for (const [k, f] of Object.entries(finish.sides ?? {})) {
    const i = Number(k);
    const key = sideName(i, n);
    const fr = frames[key];
    if (!f.walls?.taken) continue;
    if (!fr) {
      said.push(`${key} ${capture.sides[i]?.name ?? ""}: no squared photo of it in this measure - left out`);
      continue;
    }
    const stretch = fr.lengthFeet / (capture.sides[i].length_m / M);
    sides[key] = { frame: fr.frame, wire: wireOf(x, f.walls, f.roofRead, fr.frame, stretch) };
    said.push(`${key} ${fr.side}: ${f.walls.openings.length} openings, ${(f.walls.columns ?? []).length} columns, ${f.walls.openings.filter((o) => o.trim).length} surrounds (along x${stretch.toFixed(3)})`);
  }
  return { reads: { format: "scrivn-house-runner-reads/1", about: "Each side's walls in the AI trace's wire format (lib/exteriorTrace.ts TraceWire), in the pixels of its squared photo (frame). Laid by scripts/house/finishReads.mjs from walls read before; a session reading sides/ writes the same.", sides }, said };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [folder, finishFile, captureFile] = process.argv.slice(2);
  try {
    if (!folder || !finishFile || !captureFile) throw new Error("node scripts/house/finishReads.mjs <folder> <finish.json> <capture.json>");
    const finish = JSON.parse(readFileSync(finishFile, "utf8"));
    const captureRaw = JSON.parse(readFileSync(captureFile, "utf8"));
    const capture = captureRaw.exterior ?? captureRaw;
    const { reads, said } = await readsFromFinish(resolve(folder), finish, capture);
    writeFileSync(join(resolve(folder), "scrivn", "reads.json"), `${JSON.stringify(reads, null, 1)}\n`);
    console.log([...said, `Wrote ${join(folder, "scrivn", "reads.json")} (${Object.keys(reads.sides).length} sides).`].join("\n"));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
