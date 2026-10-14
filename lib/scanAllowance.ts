import "server-only";
import { createAdminClient } from "./supabase/admin";
import { isBillingSchemaMissing } from "./usageState";
import { freeLimitFor, freeTierEnforced, monthStartOf, scanAllowance, type ScanAllowance } from "./scanAllowanceRules";

/**
 * Scrivn Scan's free tier, counted (the rules and the sentences are lib/scanAllowanceRules.ts).
 *
 * Called by the phone's routes after the device token has been resolved, so the organization comes
 * from the token and never from the request. The reads and the count use the service role: the plan
 * and the counter are not the phone's to touch (0011, 0013), and the token has already been checked
 * by a definer function.
 *
 * Until 0013 is applied there is nothing to count in: every scan is allowed and nothing is recorded,
 * which is today's behaviour. Until 0011 is applied the plan cannot be read from the organization, and
 * the same holds.
 */

export interface ScanUse {
  allowed: boolean;
  /** True when this call counted a new capture; false when it had been counted before, or was refused. */
  counted: boolean;
  allowance: ScanAllowance;
}

export function isFreeTierEnforced(): boolean {
  return freeTierEnforced(process.env);
}

/** The organization's tier, or null for none; undefined when the database cannot say (no 0011). */
async function tierOf(admin: ReturnType<typeof createAdminClient>, organizationId: string): Promise<string | null | undefined> {
  const { data, error } = await admin.from("organizations").select("subscription_tier").eq("id", organizationId).maybeSingle();
  if (error) {
    if (!isBillingSchemaMissing(error)) throw new Error(`could not read the plan: ${error.message}`);
    return undefined;
  }
  return (data?.subscription_tier as string | null | undefined) ?? null;
}

/** What the phone and the Account page show for an organization: its plan and this month's count. */
export async function allowanceFor(organizationId: string, now: Date = new Date()): Promise<ScanAllowance> {
  const enforced = isFreeTierEnforced();
  const admin = createAdminClient();
  const tier = await tierOf(admin, organizationId);
  const monthStart = monthStartOf(now);
  const { count, error } = await admin
    .from("scan_uses")
    .select("capture_key", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("used_at", monthStart.toISOString());
  if (error && !isBillingSchemaMissing(error)) throw new Error(`could not count scans: ${error.message}`);
  // No 0011 or no 0013: nothing is counted or refused, and the sentence says so.
  const counting = tier !== undefined && !error;
  return scanAllowance({ tier: tier ?? null, used: count ?? 0, enforced: enforced && counting, monthStart });
}

/**
 * Takes one scan off the allowance — or not, when this capture was counted before, or when the free
 * scans are spent. `how` records which way it first left the phone.
 */
export async function takeScan(params: { organizationId: string; userId: string; tokenId: string; captureKey: string; how: "sent" | "saved" }): Promise<ScanUse> {
  const enforced = isFreeTierEnforced();
  const admin = createAdminClient();
  const tier = await tierOf(admin, params.organizationId);
  if (tier === undefined) {
    return { allowed: true, counted: false, allowance: scanAllowance({ tier: null, used: 0, enforced: false }) };
  }
  const { data, error } = await admin.rpc("org_use_scan", {
    org_id: params.organizationId,
    capture_key: params.captureKey,
    person: params.userId,
    token_id: params.tokenId,
    how: params.how,
    free_limit: freeLimitFor(tier, enforced),
  });
  if (error) {
    if (!isBillingSchemaMissing(error)) throw new Error(`could not count the scan: ${error.message}`);
    return { allowed: true, counted: false, allowance: scanAllowance({ tier, used: 0, enforced: false }) };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed: boolean; counted: boolean; used: number; month_start: string } | null;
  if (!row) throw new Error("could not count the scan: no row came back");
  return {
    allowed: row.allowed === true,
    counted: row.counted === true,
    allowance: scanAllowance({ tier, used: row.used, enforced, monthStart: new Date(row.month_start) }),
  };
}
