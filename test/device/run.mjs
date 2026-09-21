/**
 * The phone side of Scrivn, without a database: the secrets a paired phone and Scrivn exchange, and
 * what a scan becomes once it arrives.
 *
 *   npm run test:device
 *
 * Two pure modules. lib/deviceCodes.ts makes and checks the pairing code and the device token — one
 * short-lived and typed, one long-lived and hashed before it is stored — and builds the URLs the QR
 * and the phone follow. lib/scanInbox.ts is the rule about who owns a storey: the phone until the
 * estimator edits it, and Scrivn after that. The rule is a fingerprint over the drawing, a decision
 * (apply silently, or ask) and the replace itself, and each is asserted on its OUTPUT here — which
 * rooms ended up on which storey, at what pixel, with what provenance — because the route that
 * creates a claim from a scan and the editor that adopts a later one both call these and must agree
 * about what a scan becomes. The database side is test/device/rls.mjs.
 */
import { build } from "esbuild";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "device-tests-"));
const bundlePath = join(outDir, "bundle.mjs");

await build({
  entryPoints: [join(here, "entry.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: bundlePath,
  alias: { "@": root },
  logLevel: "error",
});

const {
  SCAN_DROP, SCAN_LIMITS, scanTooBig, looksLikeDeviceToken, sketchFingerprint, isPhoneOwned, scanText, scanDropPoint, convertScan, scanDecision, adoptScan, sketchFromScan, namedRooms,
  PAIRING_ALPHABET, PAIRING_CODE_LENGTH, PAIRING_CODE_TTL_SECONDS,
  newPairingCode, formatPairingCode, normalisePairingCode, newDeviceToken, hashSecret, bearerToken, appUrl, pairingUrl, claimSketchUrl,
  MAIN_LEVEL, roomsOnLevel, roomLevel, roomBounds, levelLabel,
  emptyMoistureMap, importScanRoom,
} = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const short = (value) => JSON.stringify(value)?.slice(0, 160);

/* ── Fixtures ────────────────────────────────────────────────────────────────────────────────────── */

// The phone's own files, shared with the sketch suite: a three-room capture and a one-room office.
const fixture = (name) => JSON.parse(readFileSync(join(root, "test", "sketch", "fixtures", name), "utf8"));
const capture = fixture("scan-taps-capture.json");
const office = fixture("scan-taps-office.json");

/** A hand-drawn rectangle — the shape every room the editor makes starts as — with fixed ids so the checks can name its walls. */
function handRoom(id, name, x, y, width, height, level, extra = {}) {
  return {
    id,
    name,
    vertices: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]].map(([vx, vy], i) => ({ id: `${id}-v${i}`, x: vx, y: vy })),
    ceilingHeightFeet: 8,
    ceilingType: "flat",
    ceilingPeakFeet: null,
    stairs: null,
    parentRoomId: null,
    nestingOptOut: false,
    symbols: [],
    freeCabinets: [],
    level,
    ...extra,
  };
}

let scanSerial = 0;
/** A `claim_scans` row as the browser receives it. */
function pending(body, level, overrides = {}) {
  scanSerial += 1;
  return {
    id: `scan-${scanSerial}`,
    claimId: "claim-1",
    captureId: `capture-${scanSerial}`,
    capturedAt: "2026-09-20T15:10:00.000Z",
    receivedAt: "2026-09-20T15:12:00.000Z",
    level,
    body,
    deviceName: "Field phone",
    ...overrides,
  };
}

/** True for an `Adoption`; `adoptScan` returns `{ ok: false }` only when the body will not draw. */
const adoptedOk = (result) => !("ok" in result);

/* ── Pairing codes ───────────────────────────────────────────────────────────────────────────────── */

check(PAIRING_CODE_LENGTH === 8 && PAIRING_CODE_TTL_SECONDS === 600, `eight letters, ten minutes — what the SQL interval and the countdown on the account page are built on (got ${PAIRING_CODE_LENGTH}, ${PAIRING_CODE_TTL_SECONDS})`);
check(!/[0O1IL]/.test(PAIRING_ALPHABET), `the alphabet has no 0/O and no 1/I/L, because the code is read aloud and typed as often as it is scanned (got ${PAIRING_ALPHABET})`);
check(PAIRING_ALPHABET.length === 31 && new Set(PAIRING_ALPHABET).size === 31 && PAIRING_ALPHABET === PAIRING_ALPHABET.toUpperCase(), `and is 31 distinct upper-case characters — nearly forty bits over eight of them (got ${PAIRING_ALPHABET.length})`);

const code = newPairingCode();
check(code.length === 9 && code[4] === "-", `a fresh code is shown as XXXX-XXXX, nine characters with the dash (got ${code})`);
check([...code.replace("-", "")].every((ch) => PAIRING_ALPHABET.includes(ch)), `and every one of its letters is from the alphabet (got ${code})`);
check(normalisePairingCode(code) === code.replace("-", ""), `normalising the shown form gives the eight letters the database hashes (got ${normalisePairingCode(code)})`);
check(formatPairingCode(normalisePairingCode(code)) === code, `and formatting those gives the shown form back — the round trip between the account page and the phone (got ${formatPairingCode(normalisePairingCode(code))})`);
check(normalisePairingCode("abcd-efgh") === "ABCDEFGH", "lower case is accepted, since it is what a phone keyboard types first");
check(normalisePairingCode("ab cd ef gh") === "ABCDEFGH" && normalisePairingCode("  ABCD EFGH ") === "ABCDEFGH", "and so are spaces, where a person typing splits the halves");
check(normalisePairingCode("AB-CD-EF-GH") === "ABCDEFGH" && normalisePairingCode("ABCDEFGH") === "ABCDEFGH", "dashes anywhere, or nowhere");
check(normalisePairingCode("ABCDEFG") === null, "seven letters is not a code");
check(normalisePairingCode("ABCDEFGHJ") === null, "and neither is nine — a code is never padded or truncated into one");
check(normalisePairingCode("ABCDEFGO") === null, "an O was never issued and is refused rather than read as a zero, because correcting a typo could pair the wrong phone");
check(normalisePairingCode("ABCDEFG0") === null && normalisePairingCode("ABCDEFG1") === null && normalisePairingCode("ABCDEFGI") === null && normalisePairingCode("ABCDEFGL") === null, "the same for 0, 1, I and L");
check(normalisePairingCode("") === null && normalisePairingCode("----") === null, "and nothing at all is not a code either");
{
  const codes = new Set(Array.from({ length: 200 }, () => newPairingCode()));
  check(codes.size === 200, `200 fresh codes are all distinct — a repeat would let one phone claim another account's pairing (got ${codes.size})`);
}

/* ── Device tokens ───────────────────────────────────────────────────────────────────────────────── */

const token = newDeviceToken();
check(/^[A-Za-z0-9_-]{43}$/.test(token), `a device token is 43 base64url characters — 256 bits, safe in a header, no padding (got ${token})`);
{
  const tokens = new Set(Array.from({ length: 200 }, () => newDeviceToken()));
  check(tokens.size === 200, `200 tokens are all distinct (got ${tokens.size})`);
}
check(/^[0-9a-f]{64}$/.test(hashSecret(token)), `a hash is 64 lower-case hex characters, which is what token_hash and code_hash hold (got ${hashSecret(token)})`);
check(hashSecret(token) === hashSecret(token), "and deterministic, or the phone's token could never be looked up again");
check(hashSecret("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", `it is plain SHA-256 — the published digest of "abc" — so test/device/rls.mjs can hash with node:crypto and match the row (got ${hashSecret("abc")})`);
check(hashSecret("abc") !== hashSecret("abd"), "one character of difference is a different hash");
check(hashSecret("ABCDEFGH") !== hashSecret("abcdefgh"), "and case is not folded here — the route must normalise a code BEFORE hashing, or a lower-case entry would never match the row");

const request = (authorization) => new Request("https://scrivn.ca/api/device/me", authorization === undefined ? {} : { headers: { authorization } });
check(bearerToken(request(`Bearer ${token}`)) === token, `the token is read off "Bearer <token>" (got ${bearerToken(request(`Bearer ${token}`))})`);
check(bearerToken(request("bearer xyz")) === "xyz" && bearerToken(request("BEARER xyz")) === "xyz", "the scheme matches in any case, as HTTP says it should");
check(bearerToken(request("Bearer   xyz")) === "xyz", "extra whitespace between scheme and token is not part of the token");
check(bearerToken(request(undefined)) === null, "no header is no token — the route answers 401 without a database call");
check(bearerToken(request("Basic dXNlcjpwYXNz")) === null, "a Basic credential is not a bearer token and is not mistaken for one");
check(bearerToken(request("Bearer")) === null && bearerToken(request("Bearer ")) === null, "a bearer scheme with nothing after it is not one either");
check(bearerToken(request("Bearer one two")) === null, "and two words after the scheme is a malformed header, refused rather than guessed at");

check(looksLikeDeviceToken(token), "a token this module minted has the shape the routes accept");
check(!looksLikeDeviceToken("totally-not-a-token") && !looksLikeDeviceToken(token.slice(1)) && !looksLikeDeviceToken(`${token}A`), "anything shorter, longer or otherwise shaped is turned away before a body is read or a query made");
check(!looksLikeDeviceToken(`${token.slice(0, 42)}+`) && !looksLikeDeviceToken(`${token.slice(0, 42)}=`), "and so are the characters base64url never uses — the routes see plain base64 and padding as not a token");

/* ── URLs ────────────────────────────────────────────────────────────────────────────────────────── */

const savedAppUrl = process.env.NEXT_PUBLIC_APP_URL;
process.env.NEXT_PUBLIC_APP_URL = "https://staging.example.test/";
check(appUrl() === "https://staging.example.test", `NEXT_PUBLIC_APP_URL with a trailing slash is read without it, so no link gets a double slash (got ${appUrl()})`);
check(pairingUrl("ABCD-EFGH") === "https://staging.example.test/pair?code=ABCD-EFGH", `the QR carries this deployment's own /pair URL with the code as shown — a dev server and production pair the same way (got ${pairingUrl("ABCD-EFGH")})`);
check(claimSketchUrl("8b1e2f3a-0000-4000-8000-000000000001") === "https://staging.example.test/claim?id=8b1e2f3a-0000-4000-8000-000000000001&sketch=1", `the deep link opens the claim with its sketch (got ${claimSketchUrl("8b1e2f3a-0000-4000-8000-000000000001")})`);
check(claimSketchUrl("a b&c") === "https://staging.example.test/claim?id=a%20b%26c&sketch=1" && pairingUrl("A&B") === "https://staging.example.test/pair?code=A%26B", "and both encode their value, so nothing in it can smuggle a second parameter");
process.env.NEXT_PUBLIC_APP_URL = "﻿https://staging.example.test ";
check(pairingUrl("ABCD-EFGH") === "https://staging.example.test/pair?code=ABCD-EFGH", "a byte-order mark and whitespace on the value are stripped — the way every env value is read since the two production incidents lib/env.ts records");
delete process.env.NEXT_PUBLIC_APP_URL;
check(appUrl() === "https://scrivn.ca", `unset, the deployment is scrivn.ca — the same default lib/usage.ts uses (got ${appUrl()})`);
check(pairingUrl("ABCD-EFGH") === "https://scrivn.ca/pair?code=ABCD-EFGH" && claimSketchUrl("x") === "https://scrivn.ca/claim?id=x&sketch=1", "and both links are built on it");
process.env.NEXT_PUBLIC_APP_URL = "";
check(appUrl() === "https://scrivn.ca", "an empty value counts as unset, not as a URL of nothing");
if (savedAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
else process.env.NEXT_PUBLIC_APP_URL = savedAppUrl;

/* ── The fingerprint ─────────────────────────────────────────────────────────────────────────────── */

/*
  What "nobody has edited since" means, made testable: the digest of everything the estimator can
  change about the drawing, and of nothing else.
*/
const bedroom = handRoom("room-a", "Bedroom", 100, 100, 144, 120, 0);
const base = { rooms: [bedroom] };
const print = sketchFingerprint(base);
check(/^[0-9a-f]{16}$/.test(print), `a fingerprint is 16 hex characters (got ${print})`);
{
  const reversed = (obj) => Object.fromEntries(Object.entries(obj).reverse());
  const shuffled = { levels: [], rooms: [reversed({ ...bedroom, vertices: bedroom.vertices.map(reversed) })] };
  check(sketchFingerprint(shuffled) === print, "the same drawing with its keys in another order hashes the same — a build that serialises differently must not read as an edit");
  check(sketchFingerprint(JSON.parse(JSON.stringify(base))) === print, "and so does the drawing after a JSON round trip, which is how it comes back from the database");
  check(sketchFingerprint({ rooms: [{ ...bedroom, chosenParentRoomId: undefined }], freeWalls: [], levels: [] }) === print, "an undefined field, an empty free-wall list and an empty level list all hash as their absence — a saved sketch may have any of them");
}
check(sketchFingerprint({ rooms: [{ ...bedroom, name: "Primary bedroom" }] }) !== print, "renaming a room changes it");
check(sketchFingerprint({ rooms: [{ ...bedroom, vertices: bedroom.vertices.map((v, i) => (i === 2 ? { ...v, x: v.x + 12 } : v)) }] }) !== print, "moving one corner a foot changes it");
check(sketchFingerprint({ rooms: [{ ...bedroom, ceilingHeightFeet: 9 }] }) !== print, "typing a ceiling height changes it — a number the phone did not measure is the estimator's work");
check(sketchFingerprint({ ...base, freeWalls: [{ id: "fw-1", vertices: [{ id: "fw-1-a", x: 300, y: 100 }, { id: "fw-1-b", x: 300, y: 160 }], heightFeet: null }] }) !== print, "adding a free wall changes it");
check(sketchFingerprint({ ...base, levels: [1] }) !== print, "adding a storey changes it, even an empty one");
check(sketchFingerprint({ ...base, rooms: [...base.rooms, handRoom("room-b", "Closet", 400, 100, 36, 48, 0)] }) !== print, "and so does adding a room");
const provenanceFor = (fingerprint) => ({ scanId: "scan-0", captureId: null, receivedAt: "2026-09-20T00:00:00.000Z", level: 0, fingerprint });
check(sketchFingerprint({ ...base, scan: provenanceFor("0".repeat(16)) }) === print, "`scan` itself does not — the provenance records the fingerprint and so cannot be part of it");
check(!isPhoneOwned(base), "a hand-drawn sketch with no provenance is not phone-owned");
check(isPhoneOwned({ ...base, scan: provenanceFor(print) }), "one whose provenance matches its drawing is");
check(!isPhoneOwned({ ...base, rooms: [{ ...bedroom, name: "Den" }], scan: provenanceFor(print) }), "and the first edit after adoption ends that");
check(scanText("already text") === "already text" && scanText({ a: 1 }) === JSON.stringify({ a: 1 }), "a string body is the text the importer reads; anything else is serialised into it");

/* ── A new claim from a scan ─────────────────────────────────────────────────────────────────────── */

/*
  What the server builds when the phone sends a scan for a claim that does not exist yet. Nothing
  can have that row open, so the sketch is written straight into the new claim.
*/
const provenance = { scanId: "7d3f7d2e-1111-4a2b-9c3d-000000000001", captureId: "cap-2026-09-20-01", receivedAt: "2026-09-20T15:12:00.000Z" };
const fresh = sketchFromScan(capture, provenance);
check(fresh.ok === true, `the capture fixture becomes a sketch (got ${short(fresh)})`);
if (fresh.ok) {
  check(fresh.roomCount >= 2 && fresh.roomCount === fresh.sketch.rooms.length, `a multi-room capture is several rooms, and the count the phone is told is the count drawn (got ${fresh.roomCount} of ${fresh.sketch.rooms.length})`);
  check(fresh.roomCount === 3, `the fixture is three rooms (got ${fresh.roomCount})`);
  check(fresh.sketch.rooms.every((r) => roomLevel(r) === MAIN_LEVEL) && roomsOnLevel(fresh.sketch, 0).length === 3, "every room is on the main level when no level is given");
  check(same(fresh.sketch.scan, { ...provenance, level: 0, fingerprint: sketchFingerprint(fresh.sketch) }), `the provenance carries the ids it was given, the storey, and the fingerprint of the drawing as adopted (got ${JSON.stringify(fresh.sketch.scan)})`);
  check(isPhoneOwned(fresh.sketch), "so the new sketch reads as phone-owned");
  check(fresh.notes[0] === "3 rooms imported, placed as tapped.", `the notes lead with the importer's own count (got ${JSON.stringify(fresh.notes[0])})`);
  check(/^\d+ rooms? imported/.test(fresh.notes[0] ?? ""), "in the words the notice leads with");
  const bounds = fresh.sketch.rooms.map(roomBounds);
  const topLeft = { x: Math.min(...bounds.map((b) => b.minX)), y: Math.min(...bounds.map((b) => b.minY)) };
  check(same(topLeft, SCAN_DROP), `on an empty sketch the rooms drop at SCAN_DROP, the editor's own margin from the canvas frame (got ${JSON.stringify(topLeft)})`);
  check(same(fresh.sketch.rooms.map((r) => r.name), ["Room 1", "Room 2", "Room 3"]), `the rooms keep the names the phone gave them (got ${JSON.stringify(fresh.sketch.rooms.map((r) => r.name))})`);
  check(fresh.sketch.rooms.some((r) => r.symbols.some((s) => s.type === "door")) && fresh.sketch.rooms.some((r) => r.symbols.some((s) => s.type === "cabinet")), "the doors and cabinets tapped on the phone are on the walls — the same import the editor's Import scan does");
}
{
  const upstairs = sketchFromScan(capture, { ...provenance, level: 1 });
  check(upstairs.ok && upstairs.sketch.rooms.every((r) => roomLevel(r) === 1) && upstairs.sketch.scan.level === 1, "a scan sent for the storey above lands there, and the provenance says so");
  const asText = sketchFromScan(JSON.stringify(capture), provenance);
  check(asText.ok && asText.roomCount === 3, "the body may be the JSON text rather than the parsed object — the phone sends text, the database stores jsonb, both must draw");
  const single = sketchFromScan(office, provenance);
  check(single.ok && single.roomCount === 1 && single.sketch.rooms[0].name === "Office (tapped)", `a one-room file is one room (got ${single.ok ? single.roomCount : single.error})`);
  check(single.ok && single.notes[0] === "Measured by tapping; 7 walls.", `and its notes lead with how it was measured, not with a count (got ${single.ok ? JSON.stringify(single.notes[0]) : single.error})`);
  const notAScan = sketchFromScan({ rooms: [] }, provenance);
  check(notAScan.ok === false && notAScan.error === "This file is not a room scan — it has no walls in it.", `a Scrivn sketch file is refused in the importer's own words (got ${short(notAScan)})`);
  const notJson = sketchFromScan("{ not json", provenance);
  check(notJson.ok === false && /not valid JSON/.test(notJson.error), `and so is text that is not JSON (got ${short(notJson)})`);
  check(convertScan(office, SCAN_DROP, 0).ok === true && convertScan({}, SCAN_DROP, 0).ok === false, "the validation the route runs before storing anything: a body that draws passes, one that does not is refused, not stored");
}

/* ── Too big to draw ─────────────────────────────────────────────────────────────────────────────── */

check(scanTooBig(capture) === null && scanTooBig(office) === null && scanTooBig(JSON.stringify(capture)) === null, "real captures are nowhere near the limits, as an object or as text");
check(scanTooBig("not json") === null && scanTooBig(42) === null && scanTooBig(null) === null, "what is not even an object is left to the importer to describe");
{
  const corners = Array.from({ length: SCAN_LIMITS.corners + 1 }, (_, i) => [i, 0]);
  const huge = { format: "arcapture-room/1", outline: corners, outline_openings: [], cabinets: [], stairs: [], walls: [] };
  check(typeof scanTooBig(huge) === "string" && scanTooBig(huge).includes(`${SCAN_LIMITS.corners + 1} corners`), `one corner over the limit is refused, and the sentence says how many (got ${scanTooBig(huge)})`);
  const many = { format: "arcapture-capture/1", rooms: Array.from({ length: 3 }, () => ({ outline: corners.slice(0, 2000), outline_openings: [], cabinets: [], stairs: [], walls: [] })) };
  check(typeof scanTooBig(many) === "string", "the corners of every room in a capture count together");
  const openings = Array.from({ length: SCAN_LIMITS.features + 1 }, () => ({ edge: 0, from_m: 0, width_m: 0.1, kind: "door" }));
  const doors = { format: "arcapture-room/1", outline: [[0, 0], [4, 0], [4, 3], [0, 3]], outline_openings: openings, cabinets: [], stairs: [], walls: [] };
  check(typeof scanTooBig(doors) === "string" && scanTooBig(doors).includes("openings, cabinets and flights"), `so are more openings than a house has (got ${scanTooBig(doors)})`);
  const exact = { ...huge, outline: corners.slice(0, SCAN_LIMITS.corners) };
  check(scanTooBig(exact) === null, "exactly the limit is still within it");
}

/* ── Adopt silently, or ask ──────────────────────────────────────────────────────────────────────── */

/*
  Silently only when nothing would be lost. Each case below is one thing the replace would throw
  away, and each must make the editor ask.
*/
const noMoisture = emptyMoistureMap();
const noMarks = {};
/** One reading on the room's first wall — the shape the moisture panel writes. */
const moistureOn = (room) => ({
  ...emptyMoistureMap(),
  rooms: {
    [room.id]: {
      wallReadings: [{ id: "reading-1", wallId: room.vertices[0].id, startT: 0, endT: 1, affectedHeightFeet: 2, material: "drywall", reading: 18, dryStandard: 0.75 }],
      ceilingCells: [],
      floorCells: [],
      insetsOver18Inches: 0,
    },
  },
});
/** A gap-check answer marked on one wall of a room. */
const markOn = (roomId) => ({ q1: { walls: [{ roomId, wallId: `${roomId}-v0`, startT: 0, endT: 1 }], floorCells: {} } });

check(scanDecision({ rooms: [] }, noMoisture, noMarks, 0) === "adopt", "an empty sketch: nothing to lose, adopt");
check(scanDecision({ rooms: [bedroom] }, noMoisture, noMarks, 1) === "adopt", "a storey with nothing on it, even when another storey is hand-drawn");
check(scanDecision({ rooms: [bedroom] }, noMoisture, noMarks, 0) === "ask", "a hand-drawn room on the storey: ask, since the replace would throw it away");
const owned = fresh.ok ? fresh.sketch : { rooms: [] };
check(scanDecision(owned, noMoisture, noMarks, 0) === "adopt", "a phone-owned storey nobody has touched: adopt — the re-scan is the newer truth about the same rooms");
check(scanDecision({ ...owned, rooms: owned.rooms.map((r, i) => (i === 0 ? { ...r, name: "Family room" } : r)) }, noMoisture, noMarks, 0) === "ask", "a renamed room: ask, because the fingerprint no longer matches");
check(scanDecision({ ...owned, rooms: owned.rooms.map((r, i) => (i === 1 ? { ...r, ceilingHeightFeet: 9 } : r)) }, noMoisture, noMarks, 0) === "ask", "a typed ceiling height: ask, for the same reason");
check(scanDecision(owned, moistureOn(owned.rooms[1]), noMarks, 0) === "ask", "a moisture reading on a room of that storey: ask — the drawing is the phone's but the reading is the PM's");
check(scanDecision(owned, { ...emptyMoistureMap(), rooms: { [owned.rooms[2].id]: { wallReadings: [], ceilingCells: [], floorCells: ["0,0", "1,0"], insetsOver18Inches: 0 } } }, noMarks, 0) === "ask", "painted floor counts as a reading too");
check(scanDecision(owned, { rooms: { [owned.rooms[0].id]: { wallReadings: [], ceilingCells: [], floorCells: [], insetsOver18Inches: 0 } } }, noMarks, 0) === "adopt", "an entry with nothing recorded in it is not a reading, and a map saved without its reference key still reads");
check(scanDecision(owned, noMoisture, markOn(owned.rooms[0].id), 0) === "ask", "a scope mark on a wall of the storey: ask");
check(scanDecision(owned, noMoisture, { q1: { walls: [], floorCells: { [owned.rooms[2].id]: ["0,0"] } } }, 0) === "ask", "or on its floor");
check(scanDecision(owned, noMoisture, { q1: { walls: [], floorCells: {} } }, 0) === "adopt", "an empty mark is not a mark");
{
  // The PM drew the storey above by hand and the phone scanned the main floor into the same claim.
  // Adopting fingerprints the WHOLE drawing, so the result is phone-owned with a hand-drawn room in it,
  // and what the PM does upstairs must not stop the main floor being re-scanned silently.
  const upstairsRoom = handRoom("room-up", "Upstairs bath", 200, 300, 96, 84, 1);
  const twoStoreys = adoptScan({ rooms: [upstairsRoom], levels: [1] }, pending(capture, 0));
  check(adoptedOk(twoStoreys) && isPhoneOwned(twoStoreys.sketch), "a scan adopted beside a hand-drawn storey leaves the whole sketch phone-owned");
  if (adoptedOk(twoStoreys)) {
    check(scanDecision(twoStoreys.sketch, moistureOn(upstairsRoom), noMarks, 0) === "adopt", "moisture on a room of ANOTHER storey does not stop this one being replaced silently");
    check(scanDecision(twoStoreys.sketch, moistureOn(upstairsRoom), noMarks, 1) === "ask", "while a scan for that storey asks when it is metered");
    check(scanDecision(twoStoreys.sketch, noMoisture, noMarks, 1) === "ask", "and asks with nothing metered on it too — the fingerprint covers the whole drawing, so only the storey the provenance names is the phone's; a hand-drawn storey is never replaced silently");
    {
      // The phone has now scanned both storeys, most recently the upstairs. Re-scanning the earlier
      // one asks once — the single provenance record names only the last storey — which is the
      // direction the rule accepts: a prompt, never a silent loss.
      const both = adoptScan(twoStoreys.sketch, pending(office, 1));
      check(adoptedOk(both) && both.sketch.scan.level === 1 && isPhoneOwned(both.sketch), "a second storey scanned in turn is phone-owned and names its own storey");
      check(adoptedOk(both) && scanDecision(both.sketch, noMoisture, noMarks, 1) === "adopt", "a re-scan of the storey just drawn goes in silently");
      check(adoptedOk(both) && scanDecision(both.sketch, noMoisture, noMarks, 0) === "ask", "a re-scan of the earlier storey asks, since the provenance no longer names it");
    }
    check(scanDecision(twoStoreys.sketch, noMoisture, markOn("room-up"), 0) === "adopt", "and a scope mark on another storey does not either");
    check(scanDecision(twoStoreys.sketch, noMoisture, noMarks, -1) === "adopt", "a storey nobody has drawn yet: adopt");
  }
}

/* ── Adopting a later scan ───────────────────────────────────────────────────────────────────────── */

/*
  The replace itself, on a claim as it stands mid-job: the storey above drawn by hand, the main
  level as the phone sent it, dragged to (100, 80) — wherever the PM left it.
*/
{
  const upstairsRoom = handRoom("room-up", "Upstairs bath", 200, 300, 96, 84, 1);
  const placed = convertScan(capture, { x: 100, y: 80 }, 0);
  check(placed.ok === true, `the capture converts at a chosen drop point (got ${short(placed)})`);
  const before = { rooms: [upstairsRoom, placed.room, ...placed.extraRooms], levels: [1] };
  const snapshot = JSON.stringify(before);
  const oldMain = roomsOnLevel(before, 0);
  check(oldMain.length === 3 && same(scanDropPoint(before, 0), { x: 100, y: 80 }), `the storey's drop point is the top-left of the rooms on it (got ${JSON.stringify(scanDropPoint(before, 0))})`);
  check(same(scanDropPoint(before, 1), { x: 200, y: 300 }) && same(scanDropPoint(before, 2), SCAN_DROP), "each storey has its own, and an empty one falls back to the default drop");

  const scan = pending(office, 0);
  const adopted = adoptScan(before, scan);
  check(adoptedOk(adopted), `adopting the office scan onto the main level succeeds (got ${short(adopted)})`);
  if (adoptedOk(adopted)) {
    const after = adopted.sketch;
    check(same(roomsOnLevel(after, 1), [upstairsRoom]), "the hand-drawn room on the storey above is untouched, field for field");
    check(adopted.replacedCount === 3, `replacedCount is how many rooms were on the storey before (got ${adopted.replacedCount})`);
    check(adopted.roomCount === 1 && roomsOnLevel(after, 0).length === 1, `roomCount is how many are there now, and that is what is on the storey (got ${adopted.roomCount} / ${roomsOnLevel(after, 0).length})`);
    check(roomsOnLevel(after, 0).every((r) => !oldMain.some((old) => old.id === r.id)), "the old rooms are gone, not renamed — a replace, not a merge");
    check(after.rooms.length === 2, `nothing else was added or lost (got ${after.rooms.length} rooms)`);
    const newBounds = roomsOnLevel(after, 0).map(roomBounds);
    const topLeft = { x: Math.min(...newBounds.map((b) => b.minX)), y: Math.min(...newBounds.map((b) => b.minY)) };
    check(same(topLeft, { x: 100, y: 80 }), `the new rooms drop where the old ones stood, so a re-scan does not move the plan under the estimator (got ${JSON.stringify(topLeft)})`);
    check(same(after.levels, [1]), "the level list is kept");
    check(isPhoneOwned(after), "the result is phone-owned");
    check(after.scan.scanId === scan.id && after.scan.captureId === scan.captureId && after.scan.level === 0 && after.scan.receivedAt === scan.receivedAt, `the provenance names the scan just adopted (got ${JSON.stringify(after.scan)})`);
    check(adopted.notes[0] === "Measured by tapping; 7 walls.", `the notes are the importer's (got ${JSON.stringify(adopted.notes)})`);
    check(roomsOnLevel(after, 0)[0].name === "Office (tapped)" && roomsOnLevel(after, 0)[0].vertices.length === 7, "the room is the one the phone sent, name and corners");

    // A second scan onto the phone-owned result: still in place, still phone-owned.
    const again = adoptScan(after, pending(capture, 0));
    check(adoptedOk(again) && again.replacedCount === 1 && again.roomCount === 3 && isPhoneOwned(again.sketch), `a second scan replaces the first one's rooms and is phone-owned in turn (got ${short(again)})`);
    check(adoptedOk(again) && same(scanDropPoint(again.sketch, 0), { x: 100, y: 80 }), "and stays where the storey was");
    check(adoptedOk(again) && again.sketch.scan.scanId !== after.scan.scanId, "with the newer scan named in the provenance");
  }
  const later = adoptScan(before, scan, "2026-09-20T16:00:00.000Z");
  check(adoptedOk(later) && later.sketch.scan.receivedAt === "2026-09-20T16:00:00.000Z", "a caller may say when it was received — the server stamps a new claim with its own clock");

  const onEmpty = adoptScan({ rooms: [upstairsRoom] }, pending(capture, 0));
  check(adoptedOk(onEmpty) && same(scanDropPoint(onEmpty.sketch, 0), SCAN_DROP) && onEmpty.replacedCount === 0, "on an empty storey the rooms land at SCAN_DROP and nothing is counted as replaced");

  const asText = adoptScan(before, pending(JSON.stringify(office), 0));
  check(adoptedOk(asText) && asText.roomCount === 1, "a body that arrives as JSON text is read the same as the object");

  const junk = adoptScan(before, pending({ rooms: [] }, 0));
  check(junk.ok === false && junk.error === importScanRoom(JSON.stringify({ rooms: [] }), SCAN_DROP, 0).error, `a body that is not a scan is refused in the importer's own sentence (got ${short(junk)})`);
  check(junk.ok === false && junk.error === "This file is not a room scan — it has no walls in it.", "which says what is missing, in words the notice can show");
  check(JSON.stringify(before) === snapshot, "and the sketch handed in was not changed by any of this — the editor keeps it until the adoption is applied");
}

/* ── Room names for the phone ────────────────────────────────────────────────────────────────────── */

const named = namedRooms(
  ["Kitchen", "Room 3", "   ", "kitchen", " Primary bath ", "room 12", "", "KITCHEN ", "Stairs"].map((name, i) => handRoom(`n-${i}`, name, 0, 0, 12, 12, 0)),
);
check(same(named, ["Kitchen", "Primary bath", "Stairs"]), `"Room N" placeholders, blanks and case-insensitive duplicates are dropped; the rest are kept in order and trimmed (got ${JSON.stringify(named)})`);
check(same(namedRooms([]), []), "no rooms, no names");
check(same(namedRooms([handRoom("n", "Room", 0, 0, 12, 12, 0), handRoom("m", "Room A", 0, 0, 12, 12, 0)]), ["Room", "Room A"]), "a room actually called Room, or Room A, is a name — only the numbered placeholder is not");

/* ── The words on the notice ─────────────────────────────────────────────────────────────────────── */

check(levelLabel(0) === "Main level" && levelLabel(1) === "Level above" && levelLabel(-1) === "Level below" && levelLabel(2) === "2 levels above", `the storey names the notice is built from, each reading as a phrase once lower-cased (got ${[0, 1, -1, 2].map(levelLabel).join(" / ")})`);

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
