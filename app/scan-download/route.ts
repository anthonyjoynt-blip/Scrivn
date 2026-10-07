import { NextResponse } from "next/server";
import { supabaseUrl } from "@/lib/supabase/env";

/**
 * scrivn.ca/scan-download: the newest Scrivn Scan build for testers, before the Play listing
 * (2026-10-07). scripts/publish-scan-apk.mjs puts each build in the public `scan-builds` bucket and
 * names it in latest.json; this reads that file every time - never cached, so a new build is the
 * download the moment it is published - and sends the phone to the build, named with its version so
 * a tester can say which one they have. Public in middleware.ts: a tester has no account.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const base = `${supabaseUrl()}/storage/v1/object/public/scan-builds`;
  try {
    const res = await fetch(`${base}/latest.json`, { cache: "no-store" });
    if (res.ok) {
      const latest = (await res.json()) as { file?: unknown };
      if (typeof latest.file === "string" && /^scrivn-scan-[0-9.]+\.apk$/.test(latest.file)) {
        return NextResponse.redirect(`${base}/${latest.file}?download=${latest.file}`, 302);
      }
    }
  } catch (err) {
    console.error("[/scan-download]", err);
  }
  return new NextResponse("No Scrivn Scan build is available to download yet.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
}
