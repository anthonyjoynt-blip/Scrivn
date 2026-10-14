/**
 * Site photos with spoken captions — the rules underneath the camera.
 *
 *   npm run test:photos
 *
 * What a photo's record is and how it survives: cleaned the same way twice (the sync check depends on
 * it), merged quietly between two phones, never brought back once deleted. How its picture reaches
 * Scrivn: kept on the phone, sent after its claim, safe to send twice, waiting with no signal,
 * refusals kept. How the Initial Site Report prints them, two to a page, and when the set is too big
 * to email.
 *
 * The real modules run against a fake IndexedDB (test/pending/fakeIndexedDB.mjs) and a scripted
 * server that answers as the real routes do. The PDFs are real jsPDF output, read back as bytes.
 */

import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installFakeIndexedDB } from "../pending/fakeIndexedDB.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "photos-tests-"));

await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: join(outDir, "bundle.mjs"),
  alias: { "@": root },
  define: { "process.env.NODE_ENV": '"development"' },
  logLevel: "error",
});
await build({
  entryPoints: [join(here, "pdfEntry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(outDir, "pdf.mjs"),
  alias: { "@": root },
  logLevel: "error",
});

const db = installFakeIndexedDB();

let signedIn = "user-a";
globalThis.document = {
  querySelector: (selector) => (selector === "[data-scrivn-user]" && signedIn !== undefined ? { getAttribute: () => signedIn } : null),
  visibilityState: "visible",
  addEventListener() {},
};

/* ── the scripted server ──────────────────────────────────────────────────────────────────────── */

const calls = [];
const server = {
  claims: new Map(),
  /** Pictures stored, by `claim/photo/part`. */
  files: new Map(),
  mode: "online",
  override: null,
  extracts: [],
  tick: 0,
  version() {
    this.tick += 1;
    return `2026-10-14T12:00:00.${String(this.tick).padStart(6, "0")}+00:00`;
  },
};

function respond(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const stored = (state) => mod.parseSavedClaimState(JSON.parse(JSON.stringify(state)));

function handle(path, method, body, query) {
  const photo = /^\/api\/claims\/([^/]+)\/photos\/([^/]+)$/.exec(path);
  if (photo) {
    const [, claimId, photoId] = photo;
    const row = server.claims.get(claimId);
    if (!row) return respond(404, { error: "Claim not found." });
    const part = query.includes("part=thumb") ? "thumb" : "full";
    if (method === "POST") {
      if (!row.state.photos.items.some((p) => p.id === photoId)) return respond(409, { error: "That claim does not list this photo.", code: "not-in-claim" });
      server.files.set(`${claimId}/${photoId}/${part}`, body);
      return respond(200, { ok: true });
    }
    if (method === "DELETE") {
      server.files.delete(`${claimId}/${photoId}/full`);
      server.files.delete(`${claimId}/${photoId}/thumb`);
      return respond(200, { ok: true });
    }
  }
  const one = /^\/api\/claims\/([^/]+)$/.exec(path);
  if (one) {
    const row = server.claims.get(one[1]);
    if (method === "GET") return row ? respond(200, { state: row.state, version: row.version }) : respond(404, { error: "Claim not found." });
    if (method === "PUT") {
      if (!row) return respond(404, { error: "Claim not found." });
      if (body.base && body.base !== row.version) return respond(409, { error: "Changed.", conflict: { state: row.state, version: row.version } });
      row.state = stored(body.state);
      row.version = server.version();
      return respond(200, { ok: true, version: row.version });
    }
  }
  if (path === "/manifest.webmanifest") return respond(200, {});
  if (path === "/api/extract") {
    server.extracts.push(body);
    return respond(200, { extraction: mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] }), warnings: [] });
  }
  return respond(404, { error: "No such route." });
}

globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? JSON.parse(init.body) : (init.body ?? null);
  const [path, query = ""] = String(url).split("?");
  calls.push({ path, query, method });
  if (server.mode === "offline") throw new TypeError("Failed to fetch");
  const overridden = server.override?.(path, method, body, query);
  if (overridden instanceof Error) throw overridden;
  if (overridden) return overridden;
  const answer = handle(path, method, body, query);
  if (server.mode === "lose-answer") {
    server.mode = "online";
    throw new TypeError("Failed to fetch");
  }
  return answer;
};

const mod = await import(pathToFileURL(join(outDir, "bundle.mjs")).href);
const pdf = await import(pathToFileURL(join(outDir, "pdf.mjs")).href);
rmSync(outDir, { recursive: true, force: true });

/* ── harness ──────────────────────────────────────────────────────────────────────────────────── */

let passed = 0;
const failures = [];

async function test(name, run) {
  db.reset();
  calls.length = 0;
  server.claims.clear();
  server.files.clear();
  server.extracts.length = 0;
  server.mode = "online";
  server.override = null;
  signedIn = "user-a";
  try {
    await run();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\n      expected ${b}\n      got      ${a}`);
}

/* ── fixtures ─────────────────────────────────────────────────────────────────────────────────── */

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 14, 16, 0, 0);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLAIM = "11111111-1111-4111-8111-111111111111";

function photo(n, over = {}) {
  return {
    id: id(n),
    room: "",
    roomName: "",
    takenAt: T0 + n * 60_000,
    caption: "",
    captionBy: null,
    width: 2000,
    height: 1500,
    source: "camera",
    editedAt: T0 + n * 60_000,
    ...over,
  };
}
const photosOf = (...items) => mod.normalizeClaimPhotos({ items, deleted: [], scopedNotes: null });

function room(roomId, name, level) {
  return {
    id: roomId,
    name,
    vertices: [{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 96 }, { x: 0, y: 96 }],
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    ...(level === undefined ? {} : { level }),
  };
}
const sketch = (...rooms) => ({ rooms });

function claimState(name, over = {}) {
  const s = mod.emptySavedClaimState();
  return { ...s, claim: { ...s.claim, customerName: name }, ...over };
}

function jpeg(size = 64) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new Blob([bytes], { type: "image/jpeg" });
}

/** A claim the server has at one version, and this device holding it in step. */
async function claimOnBoth(state) {
  const version = server.version();
  server.claims.set(CLAIM, { state: stored(state), version });
  await mod.changeDeviceClaim(CLAIM, () => ({ ...mod.blankDeviceClaim(CLAIM, state, "user-a"), created: true, version }));
  return version;
}

/* ── the records ──────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Photo records");

await test("anything that is not a set of photos reads as none", () => {
  for (const junk of [undefined, null, 4, "x", [], { items: "no" }]) equal(mod.normalizeClaimPhotos(junk), mod.emptyClaimPhotos(), `for ${JSON.stringify(junk)}`);
});

await test("cleaning is the same answer run twice — the sync check runs it twice", () => {
  const messy = {
    items: [
      photo(3, { caption: "  Wet baseboard ", captionBy: "voice", extra: "dropped" }),
      { id: "not a valid id!", caption: "x" },
      photo(1, { width: -4, height: "tall", source: "drone", captionBy: "voice" }),
      photo(2, { caption: "first", editedAt: T0 + 1 }),
      photo(2, { caption: "second", editedAt: T0 + 2 }),
      photo(5),
    ],
    deleted: [{ id: id(5), at: T0 }, { id: id(5), at: T0 + 9 }, { id: "", at: 1 }],
    scopedNotes: ["b", "a", "a", 7],
  };
  const once = mod.normalizeClaimPhotos(messy);
  const twice = mod.normalizeClaimPhotos(JSON.parse(JSON.stringify(once)));
  equal(twice, once, "a second clean changed it");
  equal(once.items.map((p) => p.id), [id(1), id(2), id(3)], "in the order taken, bad and deleted ones gone");
  equal(once.items[1].caption, "second", "the later edit of a record kept");
  equal(once.items[0].captionBy, null, "no caption, so not spoken either");
  equal([once.items[0].width, once.items[0].height, once.items[0].source], [0, 0, "camera"], "nonsense sizes and sources made safe");
  equal(once.deleted, [{ id: id(5), at: T0 + 9 }], "one mark per photo, the latest");
  equal(once.scopedNotes, ["a", "b"], "prints sorted and single");
  assert(!("extra" in once.items[2]), "unknown fields dropped");
});

await test("a Scan photo's spot on the plan is kept, and a photo with no spot keeps its room", () => {
  const withSpot = mod.normalizeClaimPhotos({ items: [photo(1, { room: "bath", source: "scan", spot: { level: 0, x: 120.5, y: 48, heading: -90 } })] });
  equal(withSpot.items[0].spot, { level: 0, x: 120.5, y: 48, heading: 270 }, "the spot, heading made 0-360");
  equal(mod.normalizeClaimPhotos(JSON.parse(JSON.stringify(withSpot))), withSpot, "the same answer run twice");
  equal(mod.movePhoto(withSpot, id(1), "kit", "Kitchen").items[0].spot, withSpot.items[0].spot, "moving its room keeps where it was taken");
  const lost = mod.normalizeClaimPhotos({ items: [photo(2, { room: "bath", source: "scan", spot: { level: 0.5, x: "far" } })] });
  equal([lost.items[0].room, "spot" in lost.items[0]], ["bath", false], "a spot that is no spot goes; the room stays");
  assert(!("spot" in photosOf(photo(3)).items[0]), "a browser photo has none, and prints as before");
});

await test("a claim saved before photos existed opens with none, and fingerprints match after the round trip", () => {
  const old = mod.emptySavedClaimState();
  delete old.photos;
  equal(mod.parseSavedClaimState(old).photos, mod.emptyClaimPhotos(), "photos for an old claim");
  const state = claimState("Bell", { photos: photosOf(photo(2, { caption: "Soft toilet base", captionBy: "voice" }), photo(1)) });
  const sent = JSON.parse(JSON.stringify(state));
  const again = mod.parseSavedClaimState(mod.parseSavedClaimState(sent));
  equal(mod.stableStringify(again), mod.stableStringify(mod.parseSavedClaimState(sent)), "parsed twice, the same claim");
  equal(mod.stateFingerprint(state), mod.stateFingerprint(again), "fingerprints agree");
  assert(mod.SAVED_CLAIM_KEYS.includes("photos"), "photos is a saved key");
});

await test("a claim with nothing in it but a photo is worth saving", () => {
  assert(!mod.hasAnyContent(mod.emptySavedClaimState()), "an empty claim is not");
  assert(mod.hasAnyContent({ ...mod.emptySavedClaimState(), photos: photosOf(photo(1)) }), "one photo is");
});

await test("captions, moves and deletes", () => {
  let p = photosOf(photo(1), photo(2));
  p = mod.captionPhoto(p, id(1), "Baseboard wet behind the vanity", "voice", T0 + DAY);
  equal([p.items[0].caption, p.items[0].captionBy, p.items[0].editedAt], ["Baseboard wet behind the vanity", "voice", T0 + DAY], "spoken caption stored");
  assert(mod.captionPhoto(p, id(1), "Baseboard wet behind the vanity", "voice") === p, "the same caption again is no change");
  p = mod.captionPhoto(p, id(1), "   ", "typed", T0 + DAY + 1);
  equal(p.items[0].captionBy, null, "cleared caption has no source");
  p = mod.movePhoto(p, id(2), "r1", "Kitchen", T0 + DAY + 2);
  equal([p.items[1].room, p.items[1].roomName], ["r1", "Kitchen"], "moved");
  const old = { ...p, deleted: [{ id: id(9), at: T0 - 40 * DAY }, { id: id(8), at: T0 - 5 * DAY }] };
  const d = mod.deletePhoto(old, id(2), T0);
  equal(d.items.map((x) => x.id), [id(1)], "deleted");
  equal(d.deleted.map((x) => x.id), [id(2), id(8)], "its mark added, a mark older than 30 days let go");
});

await test("two phones' copies merge by id, the same whichever comes first", () => {
  const a = { items: [photo(1, { caption: "A edit", editedAt: T0 + 50 }), photo(2)], deleted: [{ id: id(4), at: T0 }], scopedNotes: ["x"] };
  const b = { items: [photo(1, { caption: "B older", editedAt: T0 + 10 }), photo(3), photo(4)], deleted: [], scopedNotes: null };
  const ab = mod.mergeClaimPhotos(mod.normalizeClaimPhotos(a), mod.normalizeClaimPhotos(b));
  const ba = mod.mergeClaimPhotos(mod.normalizeClaimPhotos(b), mod.normalizeClaimPhotos(a));
  equal(ab.items, ba.items, "photos merge the same in either order");
  equal(ab.items.map((p) => p.id), [id(1), id(2), id(3)], "every photo, the deleted one gone for good");
  equal(ab.items[0].caption, "A edit", "the later edit wins");
  equal(mod.mergeClaimPhotos(ab, ab), ab, "merging a copy with itself changes nothing");
  const tie = mod.mergeClaimPhotos(photosOf(photo(7, { caption: "one" })), photosOf(photo(7, { caption: "two" })));
  const tie2 = mod.mergeClaimPhotos(photosOf(photo(7, { caption: "two" })), photosOf(photo(7, { caption: "one" })));
  equal(tie.items, tie2.items, "two edits at the same moment settle the same way on both phones");
  equal(ab.scopedNotes, ["x"], "the scope's notes are the kept copy's");
});

await test("photos by room: the sketch's order, lowest level first, then Exterior, then Unsorted", () => {
  const s = sketch(room("up", "Bedroom", 1), room("main", "Kitchen"), room("down", "Bedroom", -1), room("blank", ""));
  const p = photosOf(
    photo(1, { room: "up" }),
    photo(2, { room: "gone-room", roomName: "Den" }),
    photo(3, { room: mod.EXTERIOR_ROOM }),
    photo(4, { room: "main" }),
    photo(5, { room: "down" }),
    photo(6, { room: "blank" }),
  );
  const groups = mod.photosByRoom(p, s);
  equal(
    groups.map((g) => g.label),
    ["Bedroom (Level below)", "Kitchen", "Room 4", "Bedroom (Level above)", "Exterior", "Unsorted"],
    "order and labels",
  );
  equal(groups.at(-1).photos.map((x) => x.id), [id(2)], "a photo whose room was deleted is Unsorted");
  equal(mod.photoRoomOptions(s).map((o) => o.label).slice(-2), ["Exterior", "Unsorted"], "the chips end with Exterior and Unsorted");
  equal(mod.roomNameFor("up", s), "Bedroom", "a photo remembers the room's own name, not the chip's level");
});

/* ── two phones, one claim ────────────────────────────────────────────────────────────────────── */

console.log("\n  Two phones on one claim");

await test("photos added on both phones merge quietly — no question, nothing lost", async () => {
  const base = claimState("Bell");
  const v1 = await claimOnBoth(base);
  // The other phone saved first: its photo is on the server at v2.
  const row = server.claims.get(CLAIM);
  row.state = stored({ ...base, photos: photosOf(photo(2, { caption: "Theirs" })) });
  row.version = server.version();
  // This phone took its own, from v1.
  await mod.changeDeviceClaim(CLAIM, (r) => ({ ...r, state: { ...base, photos: photosOf(photo(1, { caption: "Mine" })) }, dirty: true, version: v1 }));
  assert(mod.onlyPhotosDiffer(row.state, { ...base, photos: photosOf(photo(1)) }), "only the photos differ");
  const outcome = await mod.syncClaim(CLAIM);
  equal(outcome.kind, "synced", "settled without asking");
  equal(server.claims.get(CLAIM).state.photos.items.map((p) => p.caption), ["Mine", "Theirs"], "both phones' photos on the server");
  const here = await mod.readDeviceClaim(CLAIM);
  equal([here.dirty, here.clash], [false, null], "and this phone in step, with no clash");
  equal(here.state.photos.items.length, 2, "holding both");
});

await test("a photo deleted on this phone stays deleted though the server still has it", async () => {
  const base = claimState("Bell", { photos: photosOf(photo(1), photo(2)) });
  const v1 = await claimOnBoth(base);
  const row = server.claims.get(CLAIM);
  row.state = stored({ ...base, photos: photosOf(photo(1), photo(2), photo(3)) });
  row.version = server.version();
  await mod.changeDeviceClaim(CLAIM, (r) => ({ ...r, state: { ...base, photos: mod.deletePhoto(base.photos, id(2), T0 + DAY) }, dirty: true, version: v1 }));
  equal((await mod.syncClaim(CLAIM)).kind, "synced", "merged quietly");
  equal(server.claims.get(CLAIM).state.photos.items.map((p) => p.id), [id(1), id(3)], "the deleted one not brought back, the other phone's new one kept");
});

await test("when something besides the photos differs, it is still the estimator's choice", async () => {
  const base = claimState("Bell");
  const v1 = await claimOnBoth(base);
  const row = server.claims.get(CLAIM);
  row.state = stored({ ...base, transcript: "office edit", photos: photosOf(photo(2)) });
  row.version = server.version();
  await mod.changeDeviceClaim(CLAIM, (r) => ({ ...r, state: { ...base, photos: photosOf(photo(1)) }, dirty: true, version: v1 }));
  equal((await mod.syncClaim(CLAIM)).kind, "clash", "asked about");
  const here = await mod.readDeviceClaim(CLAIM);
  equal(mod.clashDifferences(here.state, here.clash.state), ["the transcript", "the photos"], "and the difference named in words");
  equal(mod.withPhotosMerged(here.clash.state, here.state).photos.items.length, 2, "whichever is kept, both photos come with it");
});

/* ── the pictures ─────────────────────────────────────────────────────────────────────────────── */

console.log("\n  Pictures waiting on the phone");

const photoCalls = () => calls.filter((c) => c.path.includes("/photos/")).map((c) => `${c.method} ${c.path.split("/").pop().slice(-2)}${c.query ? `?${c.query}` : ""}`);

await test("a claim the server does not have yet keeps its pictures waiting", async () => {
  const state = claimState("New", { photos: photosOf(photo(1)) });
  await mod.changeDeviceClaim(CLAIM, () => ({ ...mod.blankDeviceClaim(CLAIM, state, "user-a"), dirty: true }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(2000), jpeg(100));
  const summary = await mod.sendWaitingPhotos();
  equal(summary, { sent: 0, waiting: 1 }, "waiting");
  equal(photoCalls(), [], "nothing sent before the claim exists");
});

await test("sent after its claim lists it: thumbnail, then the photo, then gone from the phone", async () => {
  await claimOnBoth(claimState("Bell"));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(2000), jpeg(100));
  equal(await mod.sendWaitingPhotos(), { sent: 0, waiting: 1 }, "the claim's save has not landed: Scrivn says not yet");
  equal(photoCalls(), ["POST 01?part=thumb"], "one try, then later");
  server.claims.get(CLAIM).state = stored(claimState("Bell", { photos: photosOf(photo(1)) }));
  calls.length = 0;
  equal(await mod.sendWaitingPhotos(), { sent: 1, waiting: 0 }, "uploaded");
  equal(photoCalls(), ["POST 01?part=thumb", "POST 01"], "thumbnail first, then the full photo");
  assert(server.files.has(`${CLAIM}/${id(1)}/full`) && server.files.has(`${CLAIM}/${id(1)}/thumb`), "both stored");
  equal(db.records("photoFiles").length, 0, "and the phone's copy let go");
});

await test("an answer lost on one bar: sent again, still one photo", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(2000), jpeg(100));
  server.mode = "lose-answer";
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles").length, 1, "kept, since nobody said it landed");
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles").length, 0, "sent again and let go");
  equal([...server.files.keys()].filter((k) => k.includes(id(1))).length, 2, "one full photo and one thumbnail, not two of each");
});

await test("with no signal nothing is lost and it stops at once", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1), photo(2)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  await mod.keepPhotoFile(CLAIM, id(2), jpeg(), jpeg());
  server.mode = "offline";
  equal(await mod.sendWaitingPhotos(), { sent: 0, waiting: 2 }, "both waiting");
  equal(calls.length, 1, "one failed request, not one per photo");
  server.mode = "online";
  equal(await mod.sendWaitingPhotos(), { sent: 2, waiting: 0 }, "both sent when the signal is back");
});

await test("a picture Scrivn refuses is kept, shown, and not retried until asked", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  server.override = (path, method) => (method === "POST" ? respond(400, { error: "Send each photo as a JPEG under 2 MB." }) : null);
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles")[0].refused, "Send each photo as a JPEG under 2 MB.", "the reason kept");
  calls.length = 0;
  await mod.sendWaitingPhotos();
  equal(photoCalls(), [], "not sent again on its own");
  server.override = null;
  await mod.retryPhotoFile(id(1));
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles").length, 0, "Try again sends it");
});

await test("deleting a photo: never sent, simply dropped; sent, deleted on Scrivn too — later with no signal", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1), photo(2)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  await mod.forgetPhotoFile(CLAIM, id(1));
  equal(db.records("photoFiles").length, 0, "never left the phone: dropped");
  equal(photoCalls(), [], "nothing to tell Scrivn");
  server.files.set(`${CLAIM}/${id(2)}/full`, jpeg());
  server.mode = "offline";
  await mod.forgetPhotoFile(CLAIM, id(2));
  equal(db.records("photoFiles").map((f) => f.kind), ["delete"], "the deletion waits");
  server.mode = "online";
  await mod.sendWaitingPhotos();
  assert(!server.files.has(`${CLAIM}/${id(2)}/full`), "and is made when there is signal");
  equal(db.records("photoFiles").length, 0, "then let go");
});

await test("a picture whose photo was deleted from the claim meanwhile is let go, not sent", async () => {
  const state = claimState("Bell", { photos: mod.deletePhoto(photosOf(photo(1)), id(1), T0) });
  await claimOnBoth(state);
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles").length, 0, "let go");
  equal(server.files.size, 0, "nothing stored");
});

await test("a shared phone never sends one person's pictures under another's sign-in", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  signedIn = "user-b";
  equal(await mod.sendWaitingPhotos(), { sent: 0, waiting: 0 }, "not theirs: not sent, not counted");
  signedIn = undefined;
  equal((await mod.waitingPhotoFiles()).length, 0, "nobody signed in: nothing shown");
  signedIn = "user-a";
  equal((await mod.waitingPhotoFiles()).length, 1, "still there for its owner");
});

await test("a claim deleted takes its waiting pictures with it", async () => {
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  await mod.keepPhotoFile("22222222-2222-4222-8222-222222222222", id(2), jpeg(), jpeg());
  await mod.forgetClaimPhotoFiles(CLAIM);
  equal(db.records("photoFiles").map((f) => f.id), [id(2)], "only the other claim's left");
});

await test("the phone's database grew a store for them, keeping the claims and Claude steps", async () => {
  db.seed("scrivn", 2, { claims: { keyPath: "id", records: [{ id: CLAIM, state: claimState("Kept"), dirty: true }] }, aiJobs: { keyPath: "key", records: [] } });
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  equal(db.shape(), { version: 3, stores: ["aiJobs", "claims", "photoFiles"] }, "version 3 with the new store");
  equal(db.records("claims").length, 1, "the claim still there");
});

await test("a photo deleted while its picture is on the wire stays deleted, on the phone and on Scrivn", async () => {
  await claimOnBoth(claimState("Bell", { photos: photosOf(photo(1)) }));
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(2000), jpeg(100));
  let deletedMidway = false;
  server.override = (path, method, body, query) => {
    if (method === "POST" && !query.includes("thumb") && !deletedMidway) {
      deletedMidway = true;
      // The estimator deletes the photo while the full picture is still going up.
      return mod.forgetPhotoFile(CLAIM, id(1)).then(() => handle(path, method, body, query));
    }
    return null;
  };
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles").map((f) => f.kind), ["delete"], "the deletion is kept, not undone by the upload finishing");
  server.override = null;
  await mod.sendWaitingPhotos();
  equal([db.records("photoFiles").length, server.files.size], [0, 0], "and is made: nothing of it left on Scrivn or the phone");
});

await test("a picture whose claim never answers is set aside after a day, not tried for ever", async () => {
  await mod.keepPhotoFile(CLAIM, id(1), jpeg(), jpeg());
  equal(await mod.sendWaitingPhotos(), { sent: 0, waiting: 1 }, "a claim not on Scrivn: it waits");
  equal(db.records("photoFiles")[0].refused, null, "not refused yet — the claim may be on its way");
  const record = db.records("photoFiles")[0];
  db.put("photoFiles", { ...record, addedAt: Date.now() - 25 * 60 * 60 * 1000 });
  await mod.sendWaitingPhotos();
  equal(db.records("photoFiles")[0].refused, "Its claim is not on Scrivn any more.", "a day on: refused, with the reason");
  calls.length = 0;
  await mod.sendWaitingPhotos();
  equal(photoCalls(), [], "and not sent again on its own");
  await mod.discardRefusedOf(CLAIM);
  equal(db.records("photoFiles").length, 0, "the header can let it go");
});

await test("deletion marks stay bounded however many copies bring them back, and cleaning stays the same twice", () => {
  const marks = Array.from({ length: 700 }, (_, i) => ({ id: id(1000 + i), at: T0 + i }));
  const once = mod.normalizeClaimPhotos({ items: [photo(1)], deleted: marks });
  equal(once.deleted.length, 600, "the newest 600");
  assert(once.deleted.every((d) => d.at >= T0 + 100), "the oldest let go");
  equal(mod.normalizeClaimPhotos(JSON.parse(JSON.stringify(once))), once, "and the same answer run again");
});

await test("a fresh read of the scope lets go of equipment answers given against the old one", () => {
  const state = claimState("Bell", { resolvedSuggestions: ["bathroom::air movers"] });
  const next = mod.withExtraction(state, mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] }), []);
  equal(next.resolvedSuggestions, [], "so the check is asked of the new tree, not skipped");
});

/* ── the email limit ──────────────────────────────────────────────────────────────────────────── */

console.log("\n  Emailing");

await test("a set under the limit goes; over it, a sentence saying what to do", () => {
  const MB = 1024 * 1024;
  equal(mod.tooBigToEmail([{ label: "Inspection Report", bytes: 2 * MB, photos: 12 }, { label: "Scope Document", bytes: 0.2 * MB }]), null, "fits");
  const alone = mod.tooBigToEmail([{ label: "Inspection Report", bytes: 5.3 * MB, photos: 40 }]);
  assert(alone.includes("The Inspection Report alone is 5.3 MB, most of it its 40 photos") && alone.includes("untick Photos"), `alone: ${alone}`);
  const together = mod.tooBigToEmail([{ label: "Inspection Report", bytes: 3.9 * MB, photos: 30 }, { label: "Drying Log", bytes: 0.8 * MB }]);
  assert(together.startsWith("Together these come to 4.7 MB") && together.includes("Send it on its own"), `together: ${together}`);
});

/* ── the photo pages ──────────────────────────────────────────────────────────────────────────── */

console.log("\n  Photo pages in the Initial Site Report");

const landscape = `data:image/jpeg;base64,${readFileSync(join(here, "fixtures", "landscape-1200.jpg")).toString("base64")}`;
const portrait = `data:image/jpeg;base64,${readFileSync(join(here, "fixtures", "portrait-1200.jpg")).toString("base64")}`;
const pdfPhoto = (i, caption = `Baseboard wet behind the vanity, photo ${i}.`) => ({
  dataUrl: i % 3 === 2 ? portrait : landscape,
  width: i % 3 === 2 ? 900 : 1200,
  height: i % 3 === 2 ? 1200 : 900,
  label: `Bathroom · Oct. 14, 2026, 10:${String(10 + i).padStart(2, "0")} a.m.`,
  caption,
});
function report(photos) {
  return pdf.documentPdfBytes({
    docLabel: "Inspection Report",
    bodyText: "CAUSE OF LOSS\nSupply line under the vanity.",
    jobNumber: "J-1",
    customerName: "Bell",
    documentTitle: "Initial Site Report",
    photos,
  });
}
const pages = (bytes) => (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
const drawn = (bytes) => [...Buffer.from(bytes).toString("latin1").matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((x) => x[1]);
const images = (bytes) => (Buffer.from(bytes).toString("latin1").match(/\/Subtype \/Image/g) ?? []).length;

await test("no photos: the report is as it was", () => {
  const bytes = report([]);
  equal([pages(bytes), images(bytes)], [1, 0], "one page, no images");
  assert(!drawn(bytes).includes("Site photos"), "no photo pages");
});

await test("one, three and forty photos: two to a page, each with its room, time and caption under it", () => {
  for (const [n, extra] of [[1, 1], [3, 2], [40, 20]]) {
    const bytes = report(Array.from({ length: n }, (_, i) => pdfPhoto(i)));
    equal(pages(bytes), 1 + extra, `${n} photo(s): pages`);
    equal(images(bytes), Math.min(n, 2), `${n} photo(s): the two fixture pictures, each embedded once`);
    const text = drawn(bytes);
    assert(text.includes("Bathroom · Oct. 14, 2026, 10:10 a.m.".replace("·", "·")) || text.some((t) => t.startsWith("Bathroom")), `${n}: the label is printed`);
    assert(text.some((t) => t.includes(`photo ${n - 1}.`)), `${n}: the last caption is printed`);
  }
});

await test("a long caption wraps, and one too long for half a page takes the whole page", () => {
  const long = "Water came down the inside of the exterior wall behind the vanity and along the baseboard to the corner; the drywall is soft to about sixteen inches and the baseboard is swollen at every joint. ".repeat(4);
  const bytes = report([pdfPhoto(0, long), pdfPhoto(1), pdfPhoto(4)]);
  equal(pages(bytes), 1 + 2, "the long one on its own page, the next two sharing one");
  const lines = drawn(bytes).filter((t) => /Water came down|soft to about|swollen at every/.test(t) || t.length > 60);
  assert(lines.length >= 6, `the caption wrapped onto many lines (got ${lines.length})`);
  const huge = report([pdfPhoto(0, "Wet. ".repeat(900))]);
  equal(pages(huge), 2, "even a caption of thousands of characters is one page, cut with an ellipsis");
});

await test("a report's size is its photos' — 30 at about 120 KB fit the email limit, 40 do not and are said so", () => {
  const thirty = report(Array.from({ length: 30 }, (_, i) => pdfPhoto(i)));
  const forty = report(Array.from({ length: 40 }, (_, i) => pdfPhoto(i)));
  // The fixture repeats two pictures, which jsPDF embeds once each; a real report embeds every photo.
  const realistic = (bytes, n) => bytes.length + (n - 2) * 130_000;
  assert(realistic(thirty, 30) < pdf.EMAIL_LIMIT_BYTES, `30 photos: ${realistic(thirty, 30)} bytes`);
  const message = pdf.tooBigToEmail([{ label: "Inspection Report", bytes: realistic(forty, 40), photos: 40 }]);
  assert(message && message.includes("40 photos"), `40 photos: ${message}`);
});

/* ── photo notes for the scope (stage 2) ──────────────────────────────────────────────────────── */

console.log("\n  Photo notes for the scope");

const notesSketch = sketch(room("bath", "Bathroom"), room("kit", "Kitchen"));
const captionedPhotos = () =>
  photosOf(
    photo(1, { room: "bath", caption: "  Baseboard wet behind the vanity,\n about four feet ", captionBy: "voice" }),
    photo(2, { room: "kit" }),
    photo(3, { room: "", caption: "Hallway carpet wet at the bathroom door", captionBy: "voice" }),
  );

await test("one note per captioned photo — room, time, words — and the uncaptioned left out", () => {
  const notes = mod.photoNotes(captionedPhotos(), notesSketch);
  equal(notes.map((n) => [n.room, n.caption]), [["Bathroom", "Baseboard wet behind the vanity, about four feet"], ["room not given", "Hallway carpet wet at the bathroom door"]], "notes");
  const text = mod.photoNotesText(notes, (ms) => `T${(ms - T0) / 60_000}`);
  equal(text, "- Bathroom · T1 · Baseboard wet behind the vanity, about four feet\n- room not given · T3 · Hallway carpet wet at the bathroom door", "the block");
  const twoDays = mod.photoNotesText([{ ...notes[0], takenAt: T0 }, { ...notes[1], takenAt: T0 + 2 * DAY }], (_ms, withDate) => (withDate ? "dated" : "time"));
  assert(twoDays.includes("dated") && !twoDays.includes("time"), "photos over several days carry the date");
  equal(mod.photoNotesText([], () => ""), "", "no notes, no block");
});

await test("a note's print changes when its caption or room does, not when the room is renamed", () => {
  const before = mod.notePrints(mod.photoNotes(captionedPhotos(), notesSketch));
  const renamed = mod.notePrints(mod.photoNotes(captionedPhotos(), sketch(room("bath", "Main Bathroom"), room("kit", "Kitchen"))));
  equal(renamed, before, "a renamed room is the same note");
  const moved = mod.notePrints(mod.photoNotes(mod.movePhoto(captionedPhotos(), id(1), "kit", "Kitchen"), notesSketch));
  assert(JSON.stringify(moved) !== JSON.stringify(before), "a moved photo is a new note");
});

await test("the claim says how many notes the scope has not read, and stops once it has", () => {
  const scoped = { ...captionedPhotos(), scopedNotes: mod.notePrints(mod.photoNotes(captionedPhotos(), notesSketch)) };
  equal(mod.notesSinceScope(scoped, notesSketch, false), { added: 0, removed: 0 }, "no scope yet: nothing to say");
  equal(mod.notesSinceScopeLine(mod.notesSinceScope(scoped, notesSketch, true)), null, "just made: nothing to say");
  const captionedAfter = mod.captionPhoto(scoped, id(2), "Sink base swollen", "voice");
  equal(mod.notesSinceScopeLine(mod.notesSinceScope(captionedAfter, notesSketch, true)), "1 new photo note since the scope was made.", "a caption added after");
  const edited = mod.captionPhoto(captionedAfter, id(1), "Baseboard wet behind the vanity, six feet", "typed");
  equal(mod.notesSinceScope(edited, notesSketch, true), { added: 2, removed: 0 }, "an edit is one changed note, not one added and one removed");
  const gone = mod.deletePhoto(scoped, id(3));
  equal(mod.notesSinceScopeLine(mod.notesSinceScope(gone, notesSketch, true)), "1 photo note removed since the scope was made.", "a note deleted");
  const old = { ...captionedPhotos(), scopedNotes: null };
  equal(mod.notesSinceScope(old, notesSketch, true).added, 2, "a scope made before photos existed has read none of them");
});

await test("the scope step is sent the notes beside the transcript, and remembers which it read", () => {
  const state = claimState("Bell", { transcript: "Walkthrough.", sketch: notesSketch, photos: captionedPhotos() });
  const request = mod.extractionRequest(state);
  assert(request.body.transcript === "Walkthrough." && request.body.photoNotes.includes("Baseboard wet behind the vanity"), "extraction gets both");
  equal(request.scopedNotes, mod.notePrints(mod.photoNotes(state.photos, notesSketch)), "with the prints of what it was sent");
  assert(!("photoNotes" in mod.extractionRequest(claimState("Bell", { transcript: "Walkthrough." })).body), "a claim with no captions sends what it always sent");
  equal(mod.extractionRequest(claimState("Bell")), null, "nothing to read: no request");
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  const applied = mod.withExtraction(state, extraction, request.scopedNotes);
  equal(applied.photos.scopedNotes, request.scopedNotes, "the claim keeps which notes the scope read");
  equal(applied.photos.items, state.photos.items, "and nothing else of the photos changes");
  const generation = mod.generationRequest({ ...state, extraction });
  assert(generation.photoNotes === request.body.photoNotes, "the documents step reads the same notes");
});

await test("all five prompts carry the same-visit rule with the notes — and are unchanged without them", () => {
  const extraction = mod.withDerivedFields({ loss: mod.emptyLoss(), rooms: [] });
  const notes = "- Bathroom · 10:42 a.m. · Baseboard wet behind the vanity";
  const claim = claimState("Bell").claim;
  const builders = [
    ["extraction", (n) => mod.extractionUserMessage("T", n)],
    ["detail", (n) => mod.extractionDetailUserMessage("T", extraction, n)],
    ["supplement", (n) => mod.extractionSupplementUserMessage("T", extraction, n)],
    ["unscoped", (n) => mod.extractionUnscopedUserMessage("T", extraction, n)],
    ["documents", (n) => mod.documentGenerationUserMessage(claim, extraction, "T", null, null, undefined, [], n)],
    ["scope only", (n) => mod.documentGenerationUserMessage({ ...claim, scopeOnly: true }, extraction, "T", null, null, undefined, [], n)],
  ];
  for (const [name, build] of builders) {
    const withNotes = build(notes);
    assert(withNotes.includes(mod.PHOTO_NOTES_RULE) && withNotes.includes(`PHOTO NOTES:\n${notes}`), `${name}: the rule and the block`);
    assert(withNotes.indexOf("PHOTO NOTES:") > withNotes.indexOf("T"), `${name}: after the transcript`);
    assert(build("") === build(undefined) && !build("").includes("PHOTO NOTES"), `${name}: nothing added without notes`);
  }
  assert(mod.PHOTO_NOTES_RULE.includes("ONE item") && mod.PHOTO_NOTES_RULE.includes("only in a photo note is real scope"), "the rule says both halves");
});

await test("Update scope through the waiting queue: built when it runs, with the photos as they are then", async () => {
  const state = claimState("Bell", { transcript: "Walkthrough.", sketch: notesSketch, photos: captionedPhotos() });
  await claimOnBoth(state);
  let page = { ...state };
  let got = null;
  const off = mod.claimOnScreen(CLAIM, { state: () => page, extracted: (_e, _w, scoped) => (got = scoped), generated: () => {} });
  server.mode = "offline";
  await mod.waitForSignal(CLAIM, "extract");
  equal(server.extracts.length, 0, "with no signal it waits");
  page = { ...page, photos: mod.captionPhoto(page.photos, id(2), "Sink base swollen", "voice") };
  server.mode = "online";
  await mod.runWaitingJobs();
  off();
  assert(server.extracts.length === 1 && server.extracts[0].photoNotes.includes("Sink base swollen"), "it read the caption added while it waited");
  equal(got, mod.notePrints(mod.photoNotes(page.photos, notesSketch)), "and the page was told which notes it read");
});

/* ── quicker filing (stage 3) ─────────────────────────────────────────────────────────────────── */

console.log("\n  Quicker filing");

const { exifJpeg } = await import("./exifFixture.mjs");
const houseSketch = sketch(room("bath", "Bathroom"), room("kit", "Kitchen"), room("b2", "Bedroom 2"), room("b3", "Bedroom 3"), room("blank", ""));
const houseOptions = mod.photoRoomOptions(houseSketch);

await test("say the room first: the first words file the photo, and come off the caption", () => {
  const said = (text) => {
    const r = mod.spokenRoom(text, houseOptions);
    return r ? [r.value, r.rest] : null;
  };
  equal(said("Bathroom. Toilet base is soft"), ["bath", "Toilet base is soft"], "a name, a full stop");
  equal(said("kitchen sink base is swollen"), ["kit", "Sink base is swollen"], "no punctuation, as Android gives it");
  equal(said("Bedroom two closet carpet wet"), ["b2", "Closet carpet wet"], "number words are numbers");
  equal(said("bedroom 3"), ["b3", ""], "the name alone files it and leaves no caption");
  equal(said("Room five, ceiling stain"), ["blank", "Ceiling stain"], "an unnamed room answers to its chip");
  equal(said("In the kitchen. Wet baseboard"), ["kit", "Wet baseboard"], "'in the' when the name ends the phrase");
  equal(said("Outside, downspout disconnected"), [mod.EXTERIOR_ROOM, "Downspout disconnected"], "outside is Exterior");
  equal(said("water came from the bathroom above"), null, "only the first words count");
  equal(said("in the bathroom above the kitchen there's a leak"), null, "'in the' running on is about another room");
  equal(said("bedroom carpet is wet"), null, "a name two rooms could be is no answer");
  const twins = mod.photoRoomOptions(sketch(room("up", "Bedroom", 1), room("down", "Bedroom", -1)));
  equal(mod.spokenRoom("Bedroom, window sill", twins), null, "nor is a name on two levels");
});

await test("an Unsorted photo is offered the room it most likely belongs in", () => {
  const rescanned = sketch(room("new-kit-id", "Kitchen"), room("bath", "Bathroom"));
  equal(mod.suggestedRoom(photo(1, { room: "old-kit-id", roomName: "Kitchen" }), rescanned)?.value, "new-kit-id", "the room it was in, by name, after a re-scan gave it a new id");
  equal(mod.suggestedRoom(photo(2, { caption: "Wet carpet in the hallway by the bathroom" }), houseSketch)?.value, "bath", "the room its caption names");
  equal(mod.suggestedRoom(photo(3, { caption: "Kitchen. Sink base" }), houseSketch)?.label, "Kitchen", "or begins with");
  equal(mod.suggestedRoom(photo(4, { caption: "Ceiling stain" }), houseSketch), null, "nothing points anywhere: no suggestion");
});

await test("a gallery photo keeps the time the camera took it", () => {
  const buf = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  equal(mod.exifTakenAt(buf(exifJpeg("2026:10:14 09:15:30", "-06:00"))), Date.UTC(2026, 9, 14, 15, 15, 30), "with the zone the phone wrote");
  equal(mod.exifTakenAt(buf(exifJpeg("2026:10:14 09:15:30", "-06:00", true))), Date.UTC(2026, 9, 14, 15, 15, 30), "big-endian too");
  equal(mod.exifTakenAt(buf(exifJpeg("2026:10:14 09:15:30"))), new Date(2026, 9, 14, 9, 15, 30).getTime(), "no zone: the phone's own");
  equal(mod.exifTakenAt(buf(new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9]))), null, "no EXIF: none");
  equal(mod.exifTakenAt(buf(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))), null, "not a JPEG: none");
  equal(mod.exifTakenAt(buf(exifJpeg("0000:00:00 00:00:00"))), null, "a blank date is no date");
  equal(mod.parseExifDate("2026:10:14 09:15:30", "+05:30"), Date.UTC(2026, 9, 14, 3, 45, 30), "a half-hour zone");
});

/* ── done ─────────────────────────────────────────────────────────────────────────────────────── */

for (const f of failures) console.error(`  FAIL ${f}`);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
// Explicitly: the connectivity probe keeps a timer going while it believes it is offline.
process.exit(failures.length > 0 ? 1 : 0);
