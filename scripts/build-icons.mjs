/**
 * Generates the app icons from one SVG, so the set cannot drift.
 *
 *   node scripts/build-icons.mjs
 *
 * Committed as a script rather than run once and forgotten: there are five files at four sizes, and
 * hand-editing five PNGs the next time the mark changes is how a home-screen icon ends up
 * disagreeing with the favicon. Re-run it and they all move together.
 *
 * ── Why the maskable icon is a different drawing ─────────────────────────────────────────────────
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle, squircle, rounded
 * square — and the safe zone is only the middle 80%. An icon drawn to the edges loses its corners.
 * So the maskable version has the same mark on a full-bleed background, drawn smaller. The ordinary
 * icon keeps its rounded corners, because iOS applies its own mask and a second set of rounded
 * corners inside Apple's looks like a mistake.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The palette from app/globals.css — navy ground, amber mark. */
const NAVY = "#1b3a5c";
const AMBER = "#f0a93e";

/**
 * The mark: an S cut from a document corner.
 *
 * Drawn as a glyph rather than an illustration, because at 40px on a home screen beside twenty other
 * apps the only thing that reads is a strong letterform in a strong colour. The folded corner is
 * what makes it a document rather than a monogram, and it survives the crop.
 */
function svg({ size, bleed }) {
  // Maskable icons are cropped to the middle 80%, so the mark is drawn smaller and the background
  // runs to the edge. The ordinary icon carries its own rounded corners.
  const pad = bleed ? size * 0.22 : size * 0.16;
  const radius = bleed ? 0 : size * 0.22;
  const fold = size * 0.16;
  const right = size - pad;
  const bottom = size - pad;

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${NAVY}"/>
  <path d="M ${pad} ${pad}
           H ${right - fold}
           L ${right} ${pad + fold}
           V ${bottom}
           H ${pad} Z"
        fill="#ffffff" opacity="0.10"/>
  <path d="M ${right - fold} ${pad} L ${right} ${pad + fold} H ${right - fold} Z" fill="#ffffff" opacity="0.18"/>
  <text x="50%" y="50%"
        font-family="Georgia, 'Times New Roman', serif"
        font-size="${size * (bleed ? 0.42 : 0.5)}"
        font-weight="700"
        fill="${AMBER}"
        text-anchor="middle"
        dominant-baseline="central">S</text>
</svg>`);
}

const targets = [
  // Next.js file conventions: these are picked up automatically from app/.
  { path: "app/icon.png", size: 512, bleed: false },
  { path: "app/apple-icon.png", size: 180, bleed: false },
  // Referenced by name from the manifest.
  { path: "public/icons/icon-192.png", size: 192, bleed: false },
  { path: "public/icons/icon-512.png", size: 512, bleed: false },
  { path: "public/icons/icon-maskable-512.png", size: 512, bleed: true },
];

for (const { path, size, bleed } of targets) {
  const out = join(root, path);
  mkdirSync(dirname(out), { recursive: true });
  const png = await sharp(svg({ size, bleed })).png().toBuffer();
  writeFileSync(out, png);
  console.log(`  ${path.padEnd(34)} ${size}x${size}${bleed ? "  (maskable)" : ""}`);
}
console.log("\n  Icons written. Commit them — they are build output, but the build does not produce them.\n");
