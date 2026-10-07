import "server-only";
import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./supabase/env";
import { cleanEnv } from "./env";
import { hashSecret } from "./deviceCodes";
import { isEmailConfigured, sendEmail } from "./email/send";
import { ScanReportMessage } from "@/emails/ScanReport";
import { reportSubject, type ScanReport } from "./scanReports";

/**
 * Files a scan report (`lib/scanReports.ts`) and tells us one came in.
 *
 * As anon through `file_scan_report` (0008), like every other phone route (`lib/deviceRepo.ts`): the
 * table has no policies, so the function is the only way in, and it holds the hourly limits. The
 * service role reads the reports, and only from the pull script.
 */

export class ReportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportLimitError";
  }
}

export class ReportsUnavailableError extends Error {
  constructor(message = "Reports are not set up on this server yet — the 0008 migration has not been applied.") {
    super(message);
    this.name = "ReportsUnavailableError";
  }
}

/** The sender's address, salted and hashed, for the hourly limit only; empty when there is none. */
export function addressHash(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  return ip ? createHash("sha256").update(`scrivn-scan-report:${ip}`, "utf8").digest("hex") : "";
}

export async function fileScanReport(report: ScanReport, token: string | null, ipHash: string): Promise<{ id: string; emailed: boolean }> {
  const client = createSupabaseClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("file_scan_report", {
    token_hash: token ? hashSecret(token) : null,
    install_id: report.installId,
    ip_hash: ipHash,
    app_version: report.appVersion,
    device: report.device,
    android: report.android,
    note: report.note,
    contact: report.contact,
    capture: report.capture,
    capture_id: report.captureId,
    captured_at: report.capturedAt,
    log_gz: report.logGz,
  });
  if (error) {
    if (error.code === "P0429") throw new ReportLimitError(error.message);
    if (error.code === "42883" || error.code === "PGRST202" || /could not find the function/i.test(error.message)) throw new ReportsUnavailableError();
    throw new Error(`Could not file the report: ${error.message}`);
  }
  const id = typeof data === "string" ? data : "";
  if (!id) throw new Error("Could not file the report: no id came back.");

  // The notice is a side effect: the report is filed whatever the email does.
  const to = cleanEnv("SCAN_REPORTS_TO") ?? cleanEnv("CONTACT_EMAIL");
  let emailed = false;
  if (to && isEmailConfigured()) {
    const who = report.contact || (report.device ? `a ${report.device}` : "a tester");
    const sent = await sendEmail({
      to,
      subject: reportSubject(report, who),
      react: ScanReportMessage({
        id,
        who,
        contact: report.contact,
        note: report.note,
        appVersion: report.appVersion,
        device: report.device,
        android: report.android,
        roomCount: report.roomCount,
        logKb: Math.round(report.logBytes / 1024),
        organization: "",
      }),
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(report.contact) ? { replyTo: report.contact } : {}),
    });
    emailed = sent.ok;
    if (!sent.ok) console.error("[/api/device/reports] notice not sent:", sent.reason, id);
  } else {
    console.warn("[/api/device/reports] no SCAN_REPORTS_TO / CONTACT_EMAIL or email not configured; report filed:", id);
  }
  return { id, emailed };
}
