/**
 * Scrivn's own code for the house runner (scripts/house/run.mjs): the photo route, the exterior, the roof check, the
 * trace's reading of a wall and the report with its drawings - bundled from lib/ and components/ as the tests bundle
 * them, so a house measured here is measured exactly as scrivn.ca measures it. No API: nothing here calls one.
 */
import { build } from "esbuild";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

let loaded = null;

/** Every function the runner uses, from one bundle; built once a run (a second or two). */
export async function scrivn() {
  if (loaded) return loaded;
  const outDir = mkdtempSync(join(tmpdir(), "house-runner-"));
  const lib = (f) => join(ROOT, "lib", f).replace(/\\/g, "/");
  const comp = (f) => join(ROOT, "components", "sketch", f).replace(/\\/g, "/");
  writeFileSync(
    join(outDir, "entry.ts"),
    [
      ...["photoRoute.ts", "photoRouteData.ts", "photoRouteExterior.ts", "photoRouteLens.ts", "photoRouteEdges.ts", "photoRouteCoverage.ts", "photoRouteFind.ts", "photoRouteMatch.ts", "exteriorPhoto.ts", "exteriorCheck.ts", "roofCheck.ts"].map((f) => `export * from "${lib(f)}";`),
      `export { exifFocal35, focalOverWidth } from "${lib("photoRouteExif.ts")}";`,
      `export { walkFromTurns, parseTurns, roleShot, lapOutline, alignLap, lapTurns, ringTurns, wallCloseUps } from "${lib("photoRouteWalk.ts")}";`,
      `export { routeSanity } from "${lib("photoRouteSanity.ts")}";`,
      `export { holdOutTapes, lineFeet, selfCheck, tapesOffWalls, tapeWalls, wallsBetween, worstPct, TAPES_AGREE_PCT } from "${lib("photoRouteCheck.ts")}";`,
      `export { planDirection, resect } from "${lib("photoRouteSolve.ts")}";`,
      `export { choiceOf, fitMapOutline, mapWords, MAP_SD_FEET } from "${lib("photoRouteMap.ts")}";`,
      `export { orthogonalRing, withAddition, withRoofEnd, withOneSlope } from "${lib("exteriorPlan.ts")}";`,
      `export { allSides, exteriorQuantities, exteriorFootprint, endsFromPhotos, roofProposal, defaultRoof, formatPitch, exteriorScopeLines, houseColours, HOME_TYPE_LABEL } from "${lib("exterior.ts")}";`,
      `export { traceProposals, snapTrace, withSwatches, applyTrace, roofPicksAtFirst, shapePicksAtFirst, trimPicksAtFirst } from "${lib("exteriorTrace.ts")}";`,
      `export { camerasAt, grayOf } from "${lib("roofPhotoRead.ts")}";`,
      `export { exteriorReport } from "${lib("exteriorReport.ts")}";`,
      `export { exteriorReportBytes } from "${lib("exteriorReportPdf.ts")}";`,
      `export { asBuilding, siteReport, siteScopeLines } from "${lib("buildings.ts")}";`,
      `export { checkTeamResult } from "${lib("exteriorRequests.ts")}";`,
      `export { decksOf, decksQuantities, deckLines, deckChecks, outlineToWalls, ringInSideFrame, withDeckAdded, withDeckDepth, withDeckRead } from "${lib("decks.ts")}";`,
      `export { deckFromPhotos, placeDeckPoints } from "${lib("deckPhotos.ts")}";`,
      `export { jpegSize } from "${lib("scanEngine.ts")}";`,
      `export { formatFeetInches } from "${lib("sketch.ts")}";`,
      `export { FootprintDrawing, RoofPlanDrawing } from "${comp("exteriorDrawings.tsx")}";`,
      `export { renderToStaticMarkup } from "react-dom/server.browser";`,
      `export { createElement } from "react";`,
    ].join("\n"),
  );
  await build({
    entryPoints: [join(outDir, "entry.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: join(outDir, "entry.mjs"),
    jsx: "automatic",
    alias: { "@": ROOT, "server-only": join(ROOT, "node_modules", "server-only", "empty.js") },
    nodePaths: [join(ROOT, "node_modules")],
    logLevel: "error",
  });
  loaded = await import(pathToFileURL(join(outDir, "entry.mjs")).href);
  rmSync(outDir, { recursive: true, force: true });
  return loaded;
}
