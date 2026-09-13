/**
 * The company letterhead: what an owner may save, and what a document draws with it.
 *
 *   npm run test:letterhead
 *
 * Two halves. The first is the pure model in lib/letterhead.ts — colour maths, validation, the
 * logo's fit, the PNG header check. The second renders real PDFs through jsPDF's node build and
 * reads the bytes back: whether the logo was embedded, where the text landed, which colour the
 * name was drawn in. Asserting on the output rather than on a call having been made is what makes
 * these worth having — a mutation that draws the logo in the wrong place still makes the call.
 */
import { build } from "esbuild";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "letterhead-tests-"));
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
  DEFAULT_LETTERHEAD, DEFAULT_LETTERHEAD_SETTINGS, LETTERHEAD_LIMITS, LOGO_BOX,
  hexToRgb, rgbToHex, relativeLuminance, contrastRatio, letterheadTextColor, letterheadInkColor,
  fitLogo, normaliseLetterheadSettings, pngDimensions, settingsFromRow, letterheadFromRow, letterheadFromSettings,
  documentPdfBytes, withClockSkewRetry, isClockSkewError,
} = await import(pathToFileURL(bundlePath).href);

let passed = 0;
const failures = [];
function check(ok, message) {
  if (ok) passed += 1;
  else failures.push(message);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const NAVY = [27, 58, 92];
const AMBER = [240, 169, 62];
const WHITE = [255, 255, 255];
const INK = [26, 26, 26];

/* ── Colours ─────────────────────────────────────────────────────────────────────────────────────── */

check(same(hexToRgb("#1B3A5C"), NAVY), `#1B3A5C parses (got ${JSON.stringify(hexToRgb("#1B3A5C"))})`);
check(same(hexToRgb("#1b3a5c"), NAVY), "and so does the lower-case form");
check(same(hexToRgb("  #1b3a5c "), NAVY), "with surrounding whitespace ignored");
check(hexToRgb("#abc") === null, "the three-digit shorthand is refused rather than expanded — nothing produces it");
check(hexToRgb("1b3a5c") === null, "and so is a hex with no hash");
check(hexToRgb("rgb(27, 58, 92)") === null, "and a CSS colour function");
check(rgbToHex(NAVY) === "#1b3a5c", `RGB renders as lower-case hex (got ${rgbToHex(NAVY)})`);
check(rgbToHex([300, -5, 7.6]) === "#ff0008", `out-of-range and fractional channels are clamped and rounded (got ${rgbToHex([300, -5, 7.6])})`);

check(near(relativeLuminance(WHITE), 1), "white has luminance 1");
check(near(relativeLuminance([0, 0, 0]), 0), "black has luminance 0");
check(near(contrastRatio(WHITE, [0, 0, 0]), 21), `white on black is 21:1 (got ${contrastRatio(WHITE, [0, 0, 0]).toFixed(3)})`);
check(near(contrastRatio(NAVY, WHITE), contrastRatio(WHITE, NAVY)), "and the ratio does not care which colour is which");

/*
  The text on the banner: white or near-black, by which reads better. Amber is the interesting case —
  a mid-bright colour where white text looks plausible and reads badly (2:1) while dark text is 8.7:1.
*/
check(same(letterheadTextColor(NAVY), WHITE), "white text on the navy default");
check(same(letterheadTextColor(WHITE), INK), "near-black text on a white banner");
check(same(letterheadTextColor(AMBER), INK), `near-black on amber, where white would be 2:1 (got ${JSON.stringify(letterheadTextColor(AMBER))})`);
check(same(letterheadTextColor([119, 119, 119]), WHITE), "white on a mid grey, where white edges dark 4.5:1 to 3.9:1 — the choice is by contrast, not by a lightness cutoff");

/*
  Text drawn IN the primary on paper. The primary while it reads; dark once it would not.
*/
check(same(letterheadInkColor(NAVY), NAVY), "the navy default is its own ink");
check(same(letterheadInkColor([0, 102, 204]), [0, 102, 204]), "and so is a mid blue at 5.6:1");
check(same(letterheadInkColor(WHITE), INK), "a white primary falls back to near-black — white title text on white paper is no title");
check(same(letterheadInkColor(AMBER), INK), "and so does amber, at 2:1 against paper");

/* ── The logo's fit ──────────────────────────────────────────────────────────────────────────────── */

check(same(fitLogo(120, 40), { width: 132, height: 44 }), `a 3:1 logo fills the box's height (got ${JSON.stringify(fitLogo(120, 40))})`);
check(near(fitLogo(1000, 100).width, 180) && near(fitLogo(1000, 100).height, 18), `a long wordmark is bound by the box's width instead (got ${JSON.stringify(fitLogo(1000, 100))})`);
check(same(fitLogo(176, 44), { width: 176, height: 44 }), "a 4:1 wordmark gets the full height — the box is shaped for the logos restoration companies actually have");
check(same(fitLogo(40, 40), { width: 44, height: 44 }), "a square logo fills the height");
check(near(fitLogo(1000, 100).width / fitLogo(1000, 100).height, 10), "and whichever bound applies, the aspect ratio is kept");
check(same(fitLogo(0, 0), { width: 0, height: 0 }), "nothing is fitted for a logo with no size, rather than Infinity");
check(same(fitLogo(-5, 20), { width: 0, height: 0 }), "or a negative one");
check(same(fitLogo(200, 100, { maxWidth: 100, maxHeight: 100 }), { width: 100, height: 50 }), "a caller's own box is honoured");
check(LOGO_BOX.maxHeight < 64, "the box is shorter than the 64pt banner it sits in");

/* ── What an owner may save ──────────────────────────────────────────────────────────────────────── */

const good = normaliseLetterheadSettings({ companyName: "  Acme   Restoration ", tagline: "Water &  fire", primaryColor: "#1B3A5C", accentColor: "#F0A93E" });
check(good.ok === true, `a complete, valid submission is accepted (got ${JSON.stringify(good)})`);
check(good.ok && good.settings.companyName === "Acme Restoration", "with the name trimmed and its internal whitespace collapsed");
check(good.ok && good.settings.tagline === "Water & fire", "and the tagline likewise");
check(good.ok && good.settings.primaryColor === "#1b3a5c" && good.settings.accentColor === "#f0a93e", "and colours normalised to lower case, matching the database constraint");

const noTagline = normaliseLetterheadSettings({ companyName: "Acme", tagline: "", primaryColor: "#1b3a5c", accentColor: "#f0a93e" });
check(noTagline.ok && noTagline.settings.tagline === "", "an empty tagline is fine — not every company has one");
check(normaliseLetterheadSettings({ companyName: "Acme", primaryColor: "#1b3a5c", accentColor: "#f0a93e" }).ok === true, "and so is a missing one");

const fails = (input) => {
  const r = normaliseLetterheadSettings(input);
  return r.ok ? null : r.error;
};
check(/company name/i.test(fails({ companyName: "   ", tagline: "", primaryColor: "#1b3a5c", accentColor: "#f0a93e" }) ?? ""), "a blank company name is refused, and the message says which field");
check(/company name/i.test(fails({ companyName: "x".repeat(LETTERHEAD_LIMITS.companyName + 1), primaryColor: "#1b3a5c", accentColor: "#f0a93e" }) ?? ""), "and so is one over the limit");
check(normaliseLetterheadSettings({ companyName: "x".repeat(LETTERHEAD_LIMITS.companyName), primaryColor: "#1b3a5c", accentColor: "#f0a93e" }).ok === true, "while one exactly at the limit is accepted");
check(/tagline/i.test(fails({ companyName: "Acme", tagline: "x".repeat(LETTERHEAD_LIMITS.tagline + 1), primaryColor: "#1b3a5c", accentColor: "#f0a93e" }) ?? ""), "an over-long tagline is refused by name");
check(/primary/i.test(fails({ companyName: "Acme", primaryColor: "navy", accentColor: "#f0a93e" }) ?? ""), "a primary colour that is not #rrggbb is refused by name");
check(/accent/i.test(fails({ companyName: "Acme", primaryColor: "#1b3a5c", accentColor: "#f0a" }) ?? ""), "and so is the accent");
check(fails(null) !== null && fails("nope") !== null && fails(42) !== null, "and anything that is not an object at all");
check(fails({ companyName: 12, primaryColor: "#1b3a5c", accentColor: "#f0a93e" }) !== null, "a non-string name is not coerced into one");

/* ── The PNG header ──────────────────────────────────────────────────────────────────────────────── */

// A real PNG, built from scratch: RGBA, solid colour, valid CRCs. What the browser's canvas export produces.
function crc32(buf) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function makePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * stride + 1 + x * 4;
      raw[o] = 200; raw[o + 1] = 30; raw[o + 2] = 30; raw[o + 3] = 255;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const png = makePng(120, 40);
check(same(pngDimensions(new Uint8Array(png)), { width: 120, height: 40 }), `a real PNG's size is read from its header (got ${JSON.stringify(pngDimensions(new Uint8Array(png)))})`);
check(same(pngDimensions(new Uint8Array(makePng(1, 1))), { width: 1, height: 1 }), "down to a single pixel");
check(pngDimensions(new Uint8Array(png.subarray(0, 20))) === null, "a file cut off before the header is not a PNG");
check(pngDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...png.subarray(4)])) === null, "a JPEG's signature is not a PNG's, whatever follows it");
{
  const renamed = Buffer.from(png);
  renamed.write("IDAT", 12, "latin1"); // the first chunk must be IHDR
  check(pngDimensions(new Uint8Array(renamed)) === null, "a PNG signature followed by the wrong first chunk is refused");
}
{
  const zero = Buffer.from(png);
  zero.writeUInt32BE(0, 16);
  check(pngDimensions(new Uint8Array(zero)) === null, "and so is a header claiming zero width — there is nothing to draw");
}
{
  // Not at offset 0 of its buffer, which is how a slice of a larger upload arrives.
  const padded = Buffer.concat([Buffer.alloc(7), png]);
  check(same(pngDimensions(new Uint8Array(padded.buffer, padded.byteOffset + 7, png.length)), { width: 120, height: 40 }), "an offset view into a larger buffer reads correctly");
}

/* ── From the row ────────────────────────────────────────────────────────────────────────────────── */

const row = (overrides = {}) => ({ name: "Acme Restoration", tagline: "Since 1990", primary_color: "#0066cc", accent_color: "#ff9900", letterhead_configured_at: "2026-09-13T00:00:00Z", ...overrides });
const logo = { dataUrl: "data:image/png;base64," + png.toString("base64"), width: 120, height: 40 };

check(letterheadFromRow(row({ letterhead_configured_at: null }), logo) === DEFAULT_LETTERHEAD, "an organization that has never saved gets the default — the very same object — whatever its row holds");
{
  const own = letterheadFromRow(row(), logo);
  check(own.companyName === "Acme Restoration" && own.tagline === "Since 1990", `a configured organization gets its own name and tagline (got ${own.companyName} / ${own.tagline})`);
  check(same(own.primaryColor, [0, 102, 204]) && same(own.accentColor, [255, 153, 0]), "and its own colours, as RGB");
  check(own.logo === logo, "and its logo");
}
check(letterheadFromRow(row({ tagline: null }), null).tagline === "", "a null tagline is an empty one, not the word null");
check(same(letterheadFromRow(row({ primary_color: "not-a-colour" }), null).primaryColor, DEFAULT_LETTERHEAD.primaryColor), "an unreadable stored colour falls back to the default rather than crashing every document");
check(
  settingsFromRow(row({ primary_color: "not-a-colour", accent_color: "#12345" })).primaryColor === DEFAULT_LETTERHEAD_SETTINGS.primaryColor &&
    settingsFromRow(row({ primary_color: "not-a-colour", accent_color: "#12345" })).accentColor === DEFAULT_LETTERHEAD_SETTINGS.accentColor,
  "and is kept out of the form too — a colour input handed a value it cannot read shows black, and Save would then store black",
);

const prefilled = settingsFromRow(row({ tagline: null, primary_color: null, accent_color: null, letterhead_configured_at: null }));
check(prefilled.companyName === "Acme Restoration", "the form is prefilled with the organization's name from signup");
check(prefilled.tagline === "" && prefilled.primaryColor === DEFAULT_LETTERHEAD_SETTINGS.primaryColor && prefilled.accentColor === DEFAULT_LETTERHEAD_SETTINGS.accentColor, "and the defaults for everything never set");
check(same(letterheadFromSettings(DEFAULT_LETTERHEAD_SETTINGS, null), DEFAULT_LETTERHEAD), "the default settings round-trip to the default letterhead");

/* ── What the PDF actually draws ─────────────────────────────────────────────────────────────────── */

/*
  Read back from the bytes. jsPDF leaves its content streams uncompressed, so the operators are
  plain text: `cm` places an image, `Td` positions text, `g`/`rg` set its colour. The company name
  is a literal in the stream, which is how "where was it drawn" is answerable at all.
*/
const doc = (letterhead) => Buffer.from(documentPdfBytes({ docLabel: "Scope Document", bodyText: "Emergency\n  Kitchen", jobNumber: "1", customerName: "Test", letterhead })).toString("latin1");
const custom = (overrides) => ({ ...DEFAULT_LETTERHEAD, companyName: "Acme Restoration", ...overrides });
/** The text-positioning operator immediately before a string, e.g. "202. 751. Td" for "(Acme Restoration) Tj". */
const placementOf = (pdf, text) => {
  const i = pdf.indexOf(`(${text}) Tj`);
  if (i === -1) return null;
  const before = pdf.slice(Math.max(0, i - 200), i);
  const m = /([\d.]+) ([\d.]+) Td\s*$/.exec(before);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};
/** The colour operator in force for a string: the last `g` or `rg` before it. */
const colourOf = (pdf, text) => {
  const i = pdf.indexOf(`(${text}) Tj`);
  if (i === -1) return null;
  const before = pdf.slice(Math.max(0, i - 200), i);
  const m = /(?:([\d.]+) ([\d.]+) ([\d.]+) rg|([\d.]+) g)\s+[\d.]+ [\d.]+ Td\s*$/.exec(before);
  if (!m) return null;
  return m[4] !== undefined ? [Number(m[4]), Number(m[4]), Number(m[4])] : [Number(m[1]), Number(m[2]), Number(m[3])];
};

const plain = doc(custom());
const branded = doc(custom({ logo }));
check(!plain.includes("/Subtype /Image"), "a letterhead with no logo embeds no image");
check(branded.includes("/Subtype /Image") && branded.includes("/Width 120") && branded.includes("/Height 40"), "one with a logo embeds it, at the logo's own pixel size");
check(branded.includes("132. 0 0 44. 54. 738. cm"), `the logo is drawn at its fitted size, at the margin, centred in the band (got ${/([\d. ]+) cm/.exec(branded)?.[1]})`);
check(same(placementOf(plain, "Acme Restoration"), { x: 54, y: 754 }), `with no logo the name starts at the margin (got ${JSON.stringify(placementOf(plain, "Acme Restoration"))})`);
check(same(placementOf(branded, "Acme Restoration"), { x: 202, y: 754 }), `with one it starts past the logo and the gap (got ${JSON.stringify(placementOf(branded, "Acme Restoration"))})`);

const tagged = doc(custom({ tagline: "Since 1990" }));
const untagged = doc(custom({ tagline: "" }));
check(tagged.includes("(Since 1990) Tj"), "the tagline is drawn when there is one");
check(!untagged.includes("Since 1990") && !untagged.includes("Restoration Documentation"), "and nothing is drawn in its place when there is not — not the default's, not a blank");
check(
  placementOf(tagged, "Acme Restoration")?.y === 754 && placementOf(untagged, "Acme Restoration")?.y === 751,
  `a name with no tagline under it sits lower in the band: 38pt down with one, 41 without (got ${placementOf(tagged, "Acme Restoration")?.y} and ${placementOf(untagged, "Acme Restoration")?.y})`,
);

// Colours, read back as the operators the viewer will execute.
check(same(colourOf(plain, "Acme Restoration"), [1, 1, 1]), `white name on the navy default (got ${JSON.stringify(colourOf(plain, "Acme Restoration"))})`);
const pale = doc(custom({ primaryColor: WHITE }));
check(same(colourOf(pale, "Acme Restoration"), [0.102, 0.102, 0.102]), `near-black name on a white banner (got ${JSON.stringify(colourOf(pale, "Acme Restoration"))})`);
check(same(colourOf(pale, "Scope Document"), [0.102, 0.102, 0.102]), `and a near-black title, since white would vanish on paper (got ${JSON.stringify(colourOf(pale, "Scope Document"))})`);
check(same(colourOf(plain, "Scope Document"), [0.106, 0.227, 0.361]), `while on the navy default the title is navy (got ${JSON.stringify(colourOf(plain, "Scope Document"))})`);
check(doc(custom({ accentColor: [51, 102, 153] })).includes("0.2 0.4 0.6 rg"), "the accent stripe is filled in the accent colour");
check(doc(custom({ accentColor: [51, 102, 153] })).includes("0.2 0.4 0.6 RG"), "and the rule under the title is stroked in it");
check(!plain.includes("0.2 0.4 0.6 rg"), "(neither of which appears for a different accent)");

/* ── The clock-skew retry ────────────────────────────────────────────────────────────────────────── */

/*
  Seen on scrivn.ca: the account page's concurrent reads met a just-refreshed session token, one of
  them was refused as "JWT issued at future", and the letterhead card fell back to its unavailable
  message. On a claim page the same second would have put the Scrivn letterhead on a company's PDF,
  silently. One wait and one more try — for that error and no other.
*/
{
  const waits = [];
  const wait = async (ms) => { waits.push(ms); };
  const skew = { error: { message: 'JWT issued at future' } };
  const ok = { data: [{ organization_id: "org-1" }], error: null };

  let calls = 0;
  const recovered = await withClockSkewRetry(() => { calls += 1; return Promise.resolve(calls === 1 ? skew : ok); }, wait);
  check(recovered === ok && calls === 2, `a skew refusal is retried once and the second answer returned (got ${calls} calls)`);
  check(waits.length === 1 && waits[0] >= 1000, `after a wait of about a second, long enough for the database clock to catch up (got ${JSON.stringify(waits)})`);

  calls = 0; waits.length = 0;
  const first = await withClockSkewRetry(() => { calls += 1; return Promise.resolve(ok); }, wait);
  check(first === ok && calls === 1 && waits.length === 0, "a query that succeeds is neither repeated nor delayed");

  calls = 0; waits.length = 0;
  const other = { data: null, error: { message: "permission denied for table organizations" } };
  const notRetried = await withClockSkewRetry(() => { calls += 1; return Promise.resolve(other); }, wait);
  check(notRetried === other && calls === 1 && waits.length === 0, "any other error propagates untouched, first time — a retry is not a way to hide a real failure");

  calls = 0; waits.length = 0;
  const stillSkewed = await withClockSkewRetry(() => { calls += 1; return Promise.resolve(skew); }, wait);
  check(stillSkewed === skew && calls === 2, "and a refusal that persists is returned after the one retry, not retried for ever");

  check(isClockSkewError({ message: "JWT issued at future" }) && isClockSkewError({ message: "PGRST301: jwt issued at future" }), "the refusal is recognised however PostgREST phrases the prefix");
  check(!isClockSkewError(null) && !isClockSkewError({ message: "JWT expired" }) && !isClockSkewError({}), "and nothing else is — an expired token is a different problem with a different fix");
}

rmSync(outDir, { recursive: true, force: true });

for (const f of failures) console.error("  FAIL " + f);
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length === 0 ? 0 : 1);
