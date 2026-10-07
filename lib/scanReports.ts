import { gunzipSync } from "node:zlib";
import { scanTooBig } from "./scanInbox";

/**
 * A scan report from Scrivn Scan's "Send to Scrivn team" (2026-10-07): the capture that went wrong,
 * the app's own log of the walk, and what the tester wrote. Read here for SHAPE - every field a
 * bounded string, the capture an object within the importer's limits, the log real gzip - and filed
 * by `lib/scanReportsRepo.ts`. Pure, so test/device/run.mjs checks it without a database.
 *
 * It works without pairing: Scan is tested as a product of its own, and a tester with no Scrivn
 * account must still be able to tell us what went wrong. A paired phone's token only says whose it is.
 */

/** Vercel refuses a request body over 4.5 MB before the route sees it; this is the line the route draws under that. */
export const REPORT_MAX_BODY_BYTES = 4 * 1024 * 1024;
/** The log unpacked: a long walk logs a few megabytes; past this it is not a log. */
export const REPORT_MAX_LOG_BYTES = 40 * 1024 * 1024;

export const REPORT_LIMITS = { note: 4000, contact: 200, appVersion: 40, device: 120, android: 40, captureId: 100 };

export interface ScanReport {
  installId: string;
  appVersion: string;
  device: string;
  android: string;
  note: string;
  contact: string;
  capture: Record<string, unknown> | null;
  captureId: string | null;
  capturedAt: string | null;
  /** The log as sent - gzip, base64 - or null when the phone had none. */
  logGz: string | null;
  /** Its unpacked size, bytes, for the email; 0 with no log. */
  logBytes: number;
  /** Rooms in the capture, for the email; 0 with none. */
  roomCount: number;
}

export type ParsedReport = { ok: true; report: ScanReport } | { ok: false; error: string };

const INSTALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function text(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // Control characters out but for line breaks and tabs: what a tester typed, nothing a mail client might act on.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

/** The body the phone posts, checked; the error is a sentence for the phone to show. */
export function parseScanReport(body: unknown): ParsedReport {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the report as a JSON object." };
  const b = body as Record<string, unknown>;

  const installId = typeof b.installId === "string" ? b.installId.trim() : "";
  if (!INSTALL_ID.test(installId)) return { ok: false, error: "Send the install id." };

  let capture: Record<string, unknown> | null = null;
  if (b.capture !== undefined && b.capture !== null) {
    if (typeof b.capture !== "object" || Array.isArray(b.capture)) return { ok: false, error: "The capture must be an object." };
    capture = b.capture as Record<string, unknown>;
    const tooBig = scanTooBig(capture);
    if (tooBig !== null) return { ok: false, error: tooBig };
  }

  let logGz: string | null = null;
  let logBytes = 0;
  if (b.logGz !== undefined && b.logGz !== null && b.logGz !== "") {
    if (typeof b.logGz !== "string" || !BASE64.test(b.logGz)) return { ok: false, error: "The log must be gzip, base64." };
    try {
      logBytes = gunzipSync(Buffer.from(b.logGz, "base64"), { maxOutputLength: REPORT_MAX_LOG_BYTES }).length;
    } catch {
      return { ok: false, error: "The log must be gzip, base64." };
    }
    logGz = b.logGz;
  }

  const note = text(b.note, REPORT_LIMITS.note);
  // Nothing to look at and nothing said: not a report.
  if (capture === null && logGz === null && note === "") return { ok: false, error: "Nothing to send - no scan, no log, no note." };

  let capturedAt: string | null = null;
  if (typeof b.capturedAt === "string" && b.capturedAt.trim() !== "") {
    const t = Date.parse(b.capturedAt);
    if (!Number.isFinite(t)) return { ok: false, error: "capturedAt must be a date." };
    capturedAt = new Date(t).toISOString();
  }

  const captureId = text(b.captureId, REPORT_LIMITS.captureId) || null;
  const rooms = capture && Array.isArray(capture.rooms) ? (capture.rooms as unknown[]).length : capture ? 1 : 0;

  return {
    ok: true,
    report: {
      installId,
      appVersion: text(b.appVersion, REPORT_LIMITS.appVersion),
      device: text(b.device, REPORT_LIMITS.device),
      android: text(b.android, REPORT_LIMITS.android),
      note,
      contact: text(b.contact, REPORT_LIMITS.contact),
      capture,
      captureId,
      capturedAt,
      logGz,
      logBytes,
      roomCount: rooms,
    },
  };
}

/** The email's subject: who, and the first line of what they said. */
export function reportSubject(report: ScanReport, who: string): string {
  const first = report.note.split(/\r?\n/)[0]?.trim() ?? "";
  const said = first ? ` — ${first.length > 70 ? `${first.slice(0, 69)}…` : first}` : "";
  return `Scan report from ${who}${said}`;
}
