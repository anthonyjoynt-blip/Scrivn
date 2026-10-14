import type { PointReading } from "./dryingLog";
import { fahrenheitFromCelsius, roundTo } from "./psychrometrics";

/**
 * Reading a meter's screen from a photo (2026-10-14), for the drying log.
 *
 * The tech points the phone at the meter, takes one photo, and the number lands in the field. That is
 * the whole feature; everything here is about not getting the number wrong, because a misread digit
 * is a wall called dry that is not:
 *
 *   - The model reads only what the screen shows. A digit it cannot make out (glare, blur, a segment
 *     missing, cut off by the frame) or a decimal point it is not sure of makes the photo unreadable,
 *     with the reason, and nothing is filled in. 12.5 and 125 are both readings.
 *   - "OL", "Hi", "Lo", "---" and the like are not readings.
 *   - The answer lands in the field, in front of the tech, who can correct it; a corrected number
 *     is theirs ("typed") again.
 *   - It is never told the last reading at the point, so it cannot be nudged towards it.
 *
 * The photo itself is not kept: it is shrunk on the phone, sent once, and dropped. Keeping it as
 * proof needs claim photo storage, which Scrivn does not have yet.
 *
 * One call, with no streaming, from `app/api/drying/meter-photo/route.ts`. Moisture meters and
 * thermo-hygrometers go through the same call; the caller takes the part it asked for.
 */

/** What the photo is for: a moisture point's reading, or an air row's temperature and humidity. */
export type MeterPhotoKind = "moisture" | "air";

/** Longest side of the photo sent, in pixels. Enough for a meter's small decimal point; about 1,400 image tokens. */
export const METER_PHOTO_MAX_PX = 1280;
/** A 1280 px JPEG at 0.85 is well under 600 KB; base64 adds a third. */
export const METER_PHOTO_MAX_BASE64 = 2_500_000;

const UNITS = ["percent_mc", "wme", "relative", "percent_rh", "other", "none"] as const;
const MODES = ["pin", "pinless", "rh_probe", "unknown"] as const;
const TEMP_UNITS = ["F", "C", "unknown"] as const;

/** What the model answers. Every field is always present: no nulls, a flag says whether a number was there. */
export interface MeterPhotoWire {
  readable: boolean;
  problem: string;
  has_reading: boolean;
  reading: number;
  unit: (typeof UNITS)[number];
  mode: (typeof MODES)[number];
  scale: string;
  meter: string;
  has_temperature: boolean;
  temperature: number;
  temperature_unit: (typeof TEMP_UNITS)[number];
  has_humidity: boolean;
  humidity: number;
  notes: string;
}

export const METER_PHOTO_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    problem: { type: "string" },
    has_reading: { type: "boolean" },
    reading: { type: "number" },
    unit: { type: "string", enum: [...UNITS] },
    mode: { type: "string", enum: [...MODES] },
    scale: { type: "string" },
    meter: { type: "string" },
    has_temperature: { type: "boolean" },
    temperature: { type: "number" },
    temperature_unit: { type: "string", enum: [...TEMP_UNITS] },
    has_humidity: { type: "boolean" },
    humidity: { type: "number" },
    notes: { type: "string" },
  },
  required: [
    "readable",
    "problem",
    "has_reading",
    "reading",
    "unit",
    "mode",
    "scale",
    "meter",
    "has_temperature",
    "temperature",
    "temperature_unit",
    "has_humidity",
    "humidity",
    "notes",
  ],
  additionalProperties: false,
};

export const METER_PHOTO_SYSTEM_PROMPT = `You read the screens of moisture meters and thermo-hygrometers for a water-damage restoration app. Each image is a photo a technician took of their meter's display on site. Your answer is written into a drying log that decides when a building is dry, so a wrong digit is worse than no answer.

Read only what the display shows. Never guess and never round.
- If any digit of the main number is unclear (glare, blur, reflection, a segment missing, cut off by the frame, at too steep an angle), set readable to false and say what is wrong in problem, in a few plain words a technician can act on ("glare covers the last digit; tilt the meter"). The same if you cannot tell whether there is a decimal point or where it is: 12.5 and 125 are both possible readings.
- "OL", "Hi", "Lo", "---", "Err", blank or flashing dashes are not readings: has_reading false, and say what the screen shows in problem.
- If the photo is not of a meter's display at all, readable false and say so.

reading is the main, largest number on a moisture meter's display, exactly as shown, decimal point included. Smaller secondary numbers (a max/hold value, a battery level, a second line) go in notes, never in reading.
unit, from what the display or the meter's face says next to the number: percent_mc for wood moisture content (%MC, or % with a wood species or wood scale), wme for Wood Moisture Equivalent (WME, as Protimeter meters show), relative for a reference or relative scale with no unit (often 0-100 or 0-999; REL, REF, or a bare number in pinless or search mode), percent_rh for relative humidity, other for anything else, none if no unit shows.
mode: pin when the display or a pin icon shows pin mode, pinless for pinless, search, scan or non-invasive modes, rh_probe for an RH probe reading, unknown when nothing says.
scale: the material scale or species setting as printed (for example WOOD, DRYWALL, GYP, MASONRY, REF, or a species code), empty if none shows.
meter: the make and model if printed on the meter in the photo (for example "Protimeter Surveymaster", "Delmhorst BD-2100", "Tramex ME5"), empty if you cannot read it. Do not guess a model from the shape.

On a thermo-hygrometer (or a meter showing air readings), temperature and humidity are its two readings: has_temperature and temperature with temperature_unit from the °F or °C shown (unknown if no unit shows), has_humidity and humidity in % RH. The same rule applies: an unclear digit means has_temperature or has_humidity false, with the reason in problem. Many hygrometers also show dew point, GPP or wet bulb; put those in notes, not in temperature or humidity.

When a field does not apply, set its has_ flag to false, its number to 0 and its text to empty.`;

export function meterPhotoUserMessage(kind: MeterPhotoKind): string {
  return kind === "air"
    ? "The technician wants this display's air temperature and relative humidity."
    : "The technician wants this display's moisture reading.";
}

/** What the drying log takes from an answer: a moisture reading, an air reading, or why there is none. */
export interface MeterPhotoReading {
  /** The moisture reading, or null when the photo gave none that can be trusted. */
  value: number | null;
  mode?: PointReading["mode"];
  scale?: string;
  meter?: string;
  /** Air: always deg F, as the log stores it. */
  tempF: number | null;
  /** What the display said the temperature was in; null when it did not say (the caller's unit is assumed). */
  tempUnitShown: "F" | "C" | null;
  rh: number | null;
  /** Why nothing usable came back, in words for the tech. Null when something did. */
  problem: string | null;
  notes: string;
}

/** The answer the route gives the browser. */
export interface MeterPhotoResponse {
  reading: MeterPhotoReading;
  model: string;
  seconds: number;
  costUsd: number;
}

const MODE: Record<MeterPhotoWire["mode"], PointReading["mode"] | undefined> = { pin: "pin", pinless: "pinless", rh_probe: "rh", unknown: undefined };

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function inRange(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
}

/**
 * The model's answer, checked, as the log stores it.
 *
 * [assumeUnit] is the log's own temperature unit, used only when the display shows none: a
 * hygrometer reading 21.4 with no unit is far likelier to be in the unit the tech works in.
 * A number outside what a meter can show is treated as unreadable, not clamped.
 */
export function parseMeterPhoto(raw: unknown, kind: MeterPhotoKind, assumeUnit: "F" | "C" = "F"): MeterPhotoReading {
  const w = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<MeterPhotoWire>;
  const notes = text(w.notes, 300);
  const said = text(w.problem, 200);
  const none = (problem: string): MeterPhotoReading => ({ value: null, tempF: null, tempUnitShown: null, rh: null, problem, notes });

  if (w.readable !== true) return none(said || "The meter's screen could not be read. Try again closer, without glare.");

  const out: MeterPhotoReading = { value: null, tempF: null, tempUnitShown: null, rh: null, problem: null, notes };
  const scale = text(w.scale, 40);
  const meter = text(w.meter, 80);
  const mode = MODE[w.mode as MeterPhotoWire["mode"]];
  if (scale) out.scale = scale;
  if (meter) out.meter = meter;
  if (mode) out.mode = mode;

  // The meter is worth keeping even when its number was not readable.
  const noneButMeter = (problem: string): MeterPhotoReading => ({ ...none(problem), ...(meter ? { meter } : {}) });

  if (kind === "moisture") {
    // Pinless relative scales run to 999; nothing a moisture meter shows is above 1,000 or below zero.
    const value = w.has_reading === true ? inRange(w.reading, 0, 1000) : null;
    if (value === null) return noneButMeter(said || "No moisture reading showed on the screen.");
    out.value = roundTo(value, 2);
    // A % RH number (an RH probe in concrete) is a reading in its own mode: say so, so that a change of
    // mode against the last reading at this point is shown.
    if (w.unit === "percent_rh" && !out.mode) out.mode = "rh";
    return out;
  }

  const shown = w.temperature_unit === "F" || w.temperature_unit === "C" ? w.temperature_unit : null;
  const unit = shown ?? assumeUnit;
  const rawTemp = w.has_temperature === true ? inRange(w.temperature, -40, unit === "C" ? 70 : 160) : null;
  const rh = w.has_humidity === true ? inRange(w.humidity, 0, 100) : null;
  if (rawTemp === null && rh === null) return noneButMeter(said || "No temperature or humidity showed on the screen.");
  out.tempF = rawTemp === null ? null : roundTo(unit === "C" ? fahrenheitFromCelsius(rawTemp) : rawTemp, 1);
  out.tempUnitShown = rawTemp === null ? null : shown;
  out.rh = rh === null ? null : roundTo(rh, 1);
  // Half an answer is still worth filling in; say what is missing.
  if (rawTemp === null) out.problem = said || "The temperature could not be read.";
  else if (rh === null) out.problem = said || "The humidity could not be read.";
  return out;
}

/** The request body the browser posts. */
export interface MeterPhotoRequest {
  /** JPEG, base64 with no data: prefix. */
  image: string;
  kind: MeterPhotoKind;
  /** The log's temperature unit, for a display that shows none. */
  tempUnit?: "F" | "C";
}

/** Checks a request body; null when it cannot be read. */
export function readMeterPhotoRequest(body: unknown): MeterPhotoRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const image = typeof b.image === "string" ? b.image.replace(/^data:image\/jpeg;base64,/, "") : "";
  if (!image || image.length > METER_PHOTO_MAX_BASE64 || !image.startsWith("/9j/")) return null;
  const kind = b.kind === "air" ? "air" : b.kind === "moisture" ? "moisture" : null;
  if (!kind) return null;
  return { image, kind, tempUnit: b.tempUnit === "C" ? "C" : "F" };
}
