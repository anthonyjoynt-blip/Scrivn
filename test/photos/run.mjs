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
  return { id: roomId, name, vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], ceilingHeightFeet: null, ceilingType: "FLAT", ...(level === undefined ? {} : { level }) };
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

/* ── done ─────────────────────────────────────────────────────────────────────────────────────── */

for (const f of failures) console.error(`  FAIL ${f}`);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
// Explicitly: the connectivity probe keeps a timer going while it believes it is offline.
process.exit(failures.length > 0 ? 1 : 0);
