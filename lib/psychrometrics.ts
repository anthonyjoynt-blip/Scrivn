/**
 * Psychrometrics for the drying log: grains per pound (GPP) and dew point, from a dry-bulb temperature
 * and a relative humidity (2026-10-13).
 *
 * WHY IT IS HERE, AND WHAT IT IS NOT FOR
 * A restorer reads temperature and relative humidity off a thermo-hygrometer at each visit, and the
 * number the drying decisions rest on is the moisture in the air itself: grains of water per pound of
 * dry air. It is computed, never typed, so it cannot disagree with the two readings it comes from.
 * Nothing in here sizes equipment (`lib/equipment.ts` does) and nothing decides whether a material is
 * dry (`lib/dryingLog.ts` does): this file only turns two readings into the same three numbers a
 * psychrometric chart gives.
 *
 * THE MATHS
 * The saturation pressure of water vapour is the ASHRAE Fundamentals (Hyland and Wexler) correlation,
 * in inch-pound units: over ice at and below 32 deg F, over liquid water above it. Vapour pressure is
 * the relative humidity of that, the humidity ratio is the ideal-gas one, W = 0.621945 pw / (p - pw), and
 * GPP is 7000 W. ASHRAE's own tables multiply pw by a real-gas enhancement factor that lifts humidity
 * ratio by about 0.4%; a hygrometer does not, and nobody comparing the number on this screen with the one
 * on their meter wants a difference they cannot explain, so it is left out.
 *
 * PRESSURE
 * Standard sea-level pressure unless a caller says otherwise. Instruments that show GPP almost always
 * assume it too, and a log that quietly corrected for altitude would disagree with the meter in the
 * tech's hand by a tenth in Calgary. `pressureAtAltitudePsia` is here for the day that is wanted.
 */

/** Standard atmospheric pressure at sea level, psia. */
export const SEA_LEVEL_PSIA = 14.696;

/** Grains in a pound. */
export const GRAINS_PER_POUND = 7000;

const RANKINE_OFFSET = 459.67;

/**
 * The range the correlations were fitted over, widened a little at the warm end. A reading outside it
 * is a typo or a dead sensor, and answering it with a number would only hide that.
 */
const MIN_TEMP_F = -100;
const MAX_TEMP_F = 250;

/**
 * Saturation pressure of water vapour, psia. ASHRAE Fundamentals, chapter 1, equations 5 (over ice,
 * -148 to 32 deg F) and 6 (over liquid water, 32 to 392 deg F). Temperature in deg F.
 */
export function saturationPressurePsia(tempF: number): number {
  const t = tempF + RANKINE_OFFSET;
  if (tempF <= 32) {
    return Math.exp(
      -1.0214165e4 / t -
        4.8932428 -
        5.3765794e-3 * t +
        1.9202377e-7 * t ** 2 +
        3.5575832e-10 * t ** 3 -
        9.0344688e-14 * t ** 4 +
        4.1635019 * Math.log(t),
    );
  }
  return Math.exp(
    -1.0440397e4 / t - 1.129465e1 - 2.7022355e-2 * t + 1.289036e-5 * t ** 2 - 2.4780681e-9 * t ** 3 + 6.5459673 * Math.log(t),
  );
}

export interface Psychrometrics {
  /** Grains of moisture per pound of dry air. */
  gpp: number;
  /** Dew point, deg F (the frost point below 32 deg F, as the correlation over ice gives it). */
  dewPointF: number;
  /** Pounds of water per pound of dry air. */
  humidityRatio: number;
  /** Partial pressure of the water vapour, psia. */
  vaporPressurePsia: number;
}

/** The temperature at which the air would be saturated at this vapour pressure, deg F. Null when it is off the scale. */
function dewPointForPressure(vaporPressurePsia: number, ceilingF: number): number | null {
  if (!(vaporPressurePsia > 0)) return null;
  let lo = -148;
  let hi = ceilingF;
  if (saturationPressurePsia(lo) > vaporPressurePsia) return null;
  // Saturation pressure only ever rises with temperature, so halving finds it, and 60 halvings are
  // far below the precision of any thermometer.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (saturationPressurePsia(mid) < vaporPressurePsia) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * GPP, dew point and humidity ratio for a temperature (deg F) and a relative humidity (percent, 0 to 100).
 *
 * Null for anything that is not a plausible reading: a missing value, a humidity outside 0 to 100, a
 * temperature off the scale, or 0% humidity, which has no dew point. Callers show nothing rather than a
 * made-up figure.
 */
export function psychrometrics(tempF: number | null, relativeHumidity: number | null, pressurePsia: number = SEA_LEVEL_PSIA): Psychrometrics | null {
  if (tempF === null || relativeHumidity === null) return null;
  if (!Number.isFinite(tempF) || !Number.isFinite(relativeHumidity)) return null;
  if (tempF < MIN_TEMP_F || tempF > MAX_TEMP_F) return null;
  if (relativeHumidity <= 0 || relativeHumidity > 100) return null;

  const pw = (relativeHumidity / 100) * saturationPressurePsia(tempF);
  if (pw >= pressurePsia) return null;
  const dewPointF = dewPointForPressure(pw, tempF);
  if (dewPointF === null) return null;

  const humidityRatio = (0.621945 * pw) / (pressurePsia - pw);
  return { gpp: GRAINS_PER_POUND * humidityRatio, dewPointF, humidityRatio, vaporPressurePsia: pw };
}

/** Barometric pressure at an altitude in feet, psia, from the standard atmosphere. */
export function pressureAtAltitudePsia(feet: number): number {
  return SEA_LEVEL_PSIA * (1 - 6.8754e-6 * feet) ** 5.2559;
}

export function fahrenheitFromCelsius(c: number): number {
  return (c * 9) / 5 + 32;
}

export function celsiusFromFahrenheit(f: number): number {
  return ((f - 32) * 5) / 9;
}

/** Round to a number of decimals without the floating-point tail (1.005 stays 1.01 once, not 1.00499999). */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}
