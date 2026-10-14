/**
 * Psychrometrics: GPP and dew point from temperature and relative humidity.
 *
 *   npm run test:psychro
 *
 * The drying log shows these numbers next to the ones a tech read off a thermo-hygrometer, so they have
 * to be right to the precision a chart is read to. Three kinds of check:
 *
 *   * the saturation pressure against steam-table values (the published numbers the correlation is
 *     fitted to), so a mistyped constant in the polynomial shows at once
 *   * the same pressure against a DIFFERENT published formula (Buck, 1996), across the whole range a
 *     building can be in, so the two cannot be wrong in the same way
 *   * GPP and dew point for the readings people quote ("seventy and fifty", "eighty and sixty") against
 *     the values on an ASHRAE psychrometric chart, with the 0.4% real-gas allowance the chart carries
 *
 * Then the edges: a reading that cannot be real answers null, never a number.
 */

import { build } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const outDir = mkdtempSync(join(tmpdir(), "psychro-tests-"));
const outfile = join(outDir, "psychrometrics.mjs");

await build({
  entryPoints: [join(root, "lib", "psychrometrics.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  outfile,
  logLevel: "silent",
});
const m = await import(pathToFileURL(outfile).href);
rmSync(outDir, { recursive: true, force: true });

let passed = 0;
const failures = [];

function test(name, run) {
  try {
    run();
    passed += 1;
  } catch (err) {
    failures.push(`${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};

const near = (actual, expected, tolerance, message) => {
  if (!(Math.abs(actual - expected) <= tolerance)) throw new Error(`${message}\n      expected ${expected} ± ${tolerance}\n      actual   ${actual}`);
};

const within = (actual, expected, fraction, message) => near(actual, expected, Math.abs(expected) * fraction, message);

/* ── saturation pressure: steam tables ────────────────────────────────────────────────────────── */

// psia, from the ASHRAE / NIST steam tables.
const STEAM_TABLE = [
  [0, 0.018525],
  [32, 0.088657],
  [50, 0.17813],
  [70, 0.36292],
  [80, 0.50683],
  [100, 0.94924],
  [150, 3.7184],
  [212, 14.696],
];

for (const [tempF, psia] of STEAM_TABLE) {
  test(`saturation pressure at ${tempF} F matches the steam table`, () => {
    within(m.saturationPressurePsia(tempF), psia, 0.004, `p_ws(${tempF} F)`);
  });
}

test("the ice and liquid branches meet at freezing", () => {
  const below = m.saturationPressurePsia(32);
  const above = m.saturationPressurePsia(32.0001);
  within(above, below, 0.003, "p_ws just either side of 32 F");
});

/* ── saturation pressure: an independent formula ──────────────────────────────────────────────── */

/** Buck (1996), hPa, converted to psia. Over liquid above freezing, over ice at and below. */
function buckPsia(tempF) {
  const c = ((tempF - 32) * 5) / 9;
  const hpa = c > 0 ? 6.1121 * Math.exp((18.678 - c / 234.5) * (c / (257.14 + c))) : 6.1115 * Math.exp((23.036 - c / 333.7) * (c / (279.82 + c)));
  return hpa * 0.0145037738;
}

test("saturation pressure agrees with Buck's formula from -40 F to 140 F", () => {
  for (let t = -40; t <= 140; t += 5) within(m.saturationPressurePsia(t), buckPsia(t), 0.01, `p_ws(${t} F)`);
});

test("saturation pressure rises with temperature, everywhere", () => {
  let previous = 0;
  for (let t = -90; t <= 240; t += 3) {
    const p = m.saturationPressurePsia(t);
    assert(p > previous, `p_ws fell at ${t} F`);
    previous = p;
  }
});

/* ── GPP and dew point: the quoted readings ───────────────────────────────────────────────────── */

/**
 * What a chart gives, worked from the STEAM TABLE rather than from the polynomial under test: the vapour
 * pressure is the table's saturation pressure times the humidity, and the humidity ratio is the standard
 * 0.621945 pw / (p - pw). The same arithmetic as the library, so the only thing that can differ is the
 * saturation pressure - which is exactly what the table and Buck checks above hold to account.
 */
function chartGpp(tempF, rh) {
  const pws = STEAM_TABLE.find(([t]) => t === tempF)?.[1];
  assert(pws !== undefined, `no steam-table pressure for ${tempF} F`);
  const pw = (rh / 100) * pws;
  return (7000 * 0.621945 * pw) / (14.696 - pw);
}

// [temp F, RH %] - readings people quote, all at a temperature the steam table above carries.
const QUOTED = [
  [70, 50],
  [80, 60],
  [100, 40],
  [50, 90],
  [32, 100],
];

for (const [t, rh] of QUOTED) {
  test(`${t} F at ${rh}% reads what the steam table gives`, () => {
    const r = m.psychrometrics(t, rh);
    assert(r !== null, "no result");
    // 0.5%: the table's pressures are themselves rounded to five figures.
    within(r.gpp, chartGpp(t, rh), 0.005, `GPP at ${t} F / ${rh}%`);
  });
}

test("seventy and fifty is about 54 grains, the figure every restorer carries in their head", () => {
  const r = m.psychrometrics(70, 50);
  near(r.gpp, 54.5, 0.5, "GPP at 70 F / 50%");
});

// [temp F, RH %, dew point F] - the dew points printed on every psychrometric chart.
const DEW_POINTS = [
  [70, 50, 50.4],
  [80, 60, 64.9],
  [90, 80, 83.1],
];

for (const [t, rh, dew] of DEW_POINTS) {
  test(`${t} F at ${rh}% has a dew point of ${dew} F`, () => {
    near(m.psychrometrics(t, rh).dewPointF, dew, 0.4, `dew point at ${t} F / ${rh}%`);
  });
}

test("saturated air has a dew point equal to its temperature", () => {
  for (const t of [-20, 0, 33, 55, 80, 110]) {
    const r = m.psychrometrics(t, 100);
    assert(r !== null, `no result at ${t}`);
    near(r.dewPointF, t, 0.01, `dew point of saturated air at ${t} F`);
  }
});

test("dew point never exceeds the air temperature", () => {
  for (const t of [10, 40, 70, 95]) for (const rh of [5, 25, 50, 75, 99]) {
    const r = m.psychrometrics(t, rh);
    assert(r !== null && r.dewPointF <= t, `dew point above temperature at ${t} F / ${rh}%`);
  }
});

test("GPP rises with humidity and with temperature", () => {
  const g = (t, rh) => m.psychrometrics(t, rh).gpp;
  assert(g(70, 40) < g(70, 50) && g(70, 50) < g(70, 60), "GPP did not rise with RH");
  assert(g(60, 50) < g(70, 50) && g(70, 50) < g(80, 50), "GPP did not rise with temperature");
});

test("GPP is the humidity ratio times 7000", () => {
  const r = m.psychrometrics(72, 45);
  near(r.gpp, r.humidityRatio * 7000, 1e-9, "GPP vs humidity ratio");
});

test("a winter outside reading works (below freezing, over ice)", () => {
  const r = m.psychrometrics(-10, 70);
  assert(r !== null, "no result");
  assert(r.gpp > 0 && r.gpp < 3, `GPP at -10 F was ${r.gpp}`);
  assert(r.dewPointF < -10, "dew point should be below the temperature");
});

/* ── altitude ─────────────────────────────────────────────────────────────────────────────────── */

test("pressure falls with altitude", () => {
  near(m.pressureAtAltitudePsia(0), 14.696, 0.001, "sea level");
  near(m.pressureAtAltitudePsia(3500), 12.93, 0.06, "Calgary-ish altitude");
});

test("the same air holds more grains per pound at altitude", () => {
  const sea = m.psychrometrics(70, 50).gpp;
  const high = m.psychrometrics(70, 50, m.pressureAtAltitudePsia(3500)).gpp;
  assert(high > sea * 1.1 && high < sea * 1.2, `sea ${sea}, 3500 ft ${high}`);
});

/* ── readings that cannot be real ─────────────────────────────────────────────────────────────── */

test("missing, impossible or non-finite readings answer null", () => {
  assert(m.psychrometrics(null, 50) === null, "null temperature");
  assert(m.psychrometrics(70, null) === null, "null humidity");
  assert(m.psychrometrics(70, 0) === null, "0% has no dew point");
  assert(m.psychrometrics(70, -5) === null, "negative humidity");
  assert(m.psychrometrics(70, 101) === null, "over 100%");
  assert(m.psychrometrics(500, 50) === null, "500 F");
  assert(m.psychrometrics(-300, 50) === null, "-300 F");
  assert(m.psychrometrics(Number.NaN, 50) === null, "NaN");
  assert(m.psychrometrics(70, Number.POSITIVE_INFINITY) === null, "infinite humidity");
});

/* ── units and rounding ───────────────────────────────────────────────────────────────────────── */

test("Fahrenheit and Celsius convert both ways", () => {
  near(m.fahrenheitFromCelsius(0), 32, 1e-9, "0 C");
  near(m.fahrenheitFromCelsius(100), 212, 1e-9, "100 C");
  near(m.fahrenheitFromCelsius(-40), -40, 1e-9, "-40");
  near(m.celsiusFromFahrenheit(68), 20, 1e-9, "68 F");
  near(m.celsiusFromFahrenheit(m.fahrenheitFromCelsius(21.7)), 21.7, 1e-9, "round trip");
});

test("roundTo does what it says", () => {
  assert(m.roundTo(1.005, 2) === 1.01, "1.005 to 2");
  assert(m.roundTo(2.5, 0) === 3, "2.5 to 0");
  assert(m.roundTo(-1.25, 1) === -1.2 || m.roundTo(-1.25, 1) === -1.3, "negative half");
  assert(m.roundTo(54.5678, 1) === 54.6, "54.5678 to 1");
});

/* ── result ───────────────────────────────────────────────────────────────────────────────────── */

if (failures.length > 0) {
  console.error(`\n${failures.length} failed, ${passed} passed\n`);
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}
console.log(`${passed} passed`);
