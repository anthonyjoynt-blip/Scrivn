import { NextResponse } from "next/server";
import { REPORT_MAX_BODY_BYTES, parseScanReport } from "@/lib/scanReports";
import { ReportLimitError, ReportsUnavailableError, addressHash, fileScanReport } from "@/lib/scanReportsRepo";
import { deviceToken } from "../pair/route";

/**
 * A tester's "Send to Scrivn team" from Scrivn Scan: a scan that went wrong, the app's log of the walk
 * and a note (`lib/scanReports.ts`). Open to a phone that is NOT paired - Scan is tested on its own,
 * without a Scrivn account - so the limits are the table's (`file_scan_report`, 0008) and the size is
 * checked before a byte is parsed, as /api/device/scans does.
 */
export async function POST(request: Request) {
  try {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > REPORT_MAX_BODY_BYTES) return tooLarge();
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > REPORT_MAX_BODY_BYTES) return tooLarge();
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Send the report as JSON." }, { status: 400 });
    }
    const parsed = parseScanReport(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { id } = await fileScanReport(parsed.report, deviceToken(request), addressHash(request));
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof ReportLimitError) return NextResponse.json({ error: err.message }, { status: 429 });
    if (err instanceof ReportsUnavailableError) return NextResponse.json({ error: err.message }, { status: 503 });
    console.error("[/api/device/reports]", err);
    return NextResponse.json({ error: "That report did not go through. Try again in a moment." }, { status: 500 });
  }
}

function tooLarge() {
  return NextResponse.json({ error: "That report is over 4 MB." }, { status: 413 });
}
