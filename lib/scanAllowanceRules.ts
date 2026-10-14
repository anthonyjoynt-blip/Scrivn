import { SCAN_PLAN, isScanTier, isScrivnTier } from "./plans";

/**
 * Scrivn Scan's free tier, as arithmetic: what a scan is, how many an organization has left this
 * month, and the sentences the phone shows. No database and no `server-only`, so
 * `npm run test:scanaccounts` can hold it to the rules; `lib/scanAllowance.ts` reads and counts.
 *
 * ── What a "scan" is (owner's decision: "about 3 scans a month, counted on the server") ─────────
 *
 * One CAPTURE: everything walked between pressing Start and the next Start, named by the capture id
 * the phone already sends with every scan (0010). It is counted the first time it leaves the phone,
 * sent to Scrivn or saved as a plan with Share, and never again: sending it twice, to another claim,
 * or sharing it after sending it costs nothing more. Its levels and its exterior travel under the one
 * id, so they are one scan. A walk that never leaves the phone is not counted. The count is the
 * organization's (the plan is, 0011), per calendar month in UTC. See 0014_scan_accounts.sql.
 *
 * ── Who is limited ───────────────────────────────────────────────────────────────────────────────
 *
 * An organization with no plan: three a month. Any plan — a Scrivn plan (which includes Scan) or the
 * Scan plan — is unlimited. A phone with no account at all (never signed in, never paired) is not
 * counted: Share works on it as it always has (owner's call to change; see SCAN_ACCOUNTS.md).
 *
 * ── When it bites ────────────────────────────────────────────────────────────────────────────────
 *
 * Only once there is a way to pay: the limit is enforced when BILLING_ENABLED is on, because a
 * refusal that points at a plan nobody can buy yet is only a wall. Until then scans are counted and
 * not refused. SCAN_FREE_TIER=on (or off) overrides that either way, for testing.
 */

/** The page the phone names, in plain text, when the free scans run out. Never a link or a button. */
export const SCAN_PLAN_PAGE_TEXT = "scrivn.ca/scan";

export type ScanPlanKind = "scrivn" | "scan" | null;

export interface ScanAllowance {
  /** The plan that makes scans unlimited, or null on the free tier. */
  plan: ScanPlanKind;
  /** True when nothing is refused: a plan, or the free tier not enforced yet. */
  unlimited: boolean;
  /** Whether the free limit is being enforced on this deployment (see "When it bites"). */
  enforced: boolean;
  /** Captures counted this month. */
  used: number;
  /** The free limit when it applies; null when unlimited. */
  limit: number | null;
  /** When this month's count started and when the next one starts, ISO, UTC. */
  monthStart: string;
  resetsAt: string;
  /** One sentence for the phone's account screen and Scrivn's Account page. */
  summary: string;
}

/** The plan an organization's tier gives Scan, or null for none. */
export function scanPlanFor(tier: string | null | undefined): ScanPlanKind {
  if (isScanTier(tier)) return "scan";
  if (isScrivnTier(tier)) return "scrivn";
  return null;
}

/** Whether the free limit bites, from the two switches (see "When it bites"). */
export function freeTierEnforced(env: Record<string, string | undefined>): boolean {
  const override = env.SCAN_FREE_TIER?.trim().toLowerCase();
  if (override === "on") return true;
  if (override === "off") return false;
  return env.BILLING_ENABLED === "true";
}

/** The limit to hand `org_use_scan`: null = record only, refuse nothing. */
export function freeLimitFor(tier: string | null | undefined, enforced: boolean): number | null {
  if (scanPlanFor(tier) !== null || !enforced) return null;
  return SCAN_PLAN.freeScansPerMonth;
}

/** The first instant of the month `at` is in, UTC. */
export function monthStartOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/** The first instant of the month after `monthStart`, UTC. */
export function nextMonthStart(monthStart: Date): Date {
  return new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
}

/** "November 1": the day the count starts again, as the person reads it. */
export function resetDay(resetsAt: Date): string {
  return resetsAt.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** The key a capture is counted under: the phone's capture id, or the scan's own id for a build that sends none. */
export function captureKey(captureId: string | null | undefined, scanId: string): string {
  const id = typeof captureId === "string" ? captureId.trim() : "";
  return id !== "" ? id.slice(0, 200) : `scan:${scanId}`;
}

/** Everything the phone and the Account page show, from the tier and this month's count. */
export function scanAllowance(params: { tier: string | null | undefined; used: number; enforced: boolean; now?: Date; monthStart?: Date }): ScanAllowance {
  const start = params.monthStart ?? monthStartOf(params.now ?? new Date());
  const next = nextMonthStart(start);
  const plan = scanPlanFor(params.tier);
  const limit = freeLimitFor(params.tier, params.enforced);
  const used = Math.max(0, Math.floor(params.used));
  return {
    plan,
    unlimited: limit === null,
    enforced: params.enforced,
    used,
    limit,
    monthStart: start.toISOString(),
    resetsAt: next.toISOString(),
    summary: allowanceSummary(plan, used, limit, params.enforced, next),
  };
}

function scansWord(n: number): string {
  return n === 1 ? "1 scan" : `${n} scans`;
}

function allowanceSummary(plan: ScanPlanKind, used: number, limit: number | null, enforced: boolean, resetsAt: Date): string {
  if (plan === "scan") return "Scrivn Scan plan: unlimited scans.";
  if (plan === "scrivn") return "Your Scrivn plan includes unlimited scans.";
  if (limit === null || !enforced) return `Unlimited scans while Scrivn Scan is in testing (${scansWord(used)} this month).`;
  const left = Math.max(0, limit - used);
  if (left === 0) return `Free plan: all ${limit} free scans used this month. They start again on ${resetDay(resetsAt)}.`;
  return `Free plan: ${used} of ${limit} free scans used this month. They start again on ${resetDay(resetsAt)}.`;
}

/**
 * Why a scan was refused, in plain text the phone shows as it is. It names the plan page as words a
 * person can type into a browser — never a link or a button: Scan sells nothing itself, which is the
 * condition on which Google lets an app in Canada name the website at all.
 */
export function scanLimitMessage(allowance: Pick<ScanAllowance, "limit" | "resetsAt">): string {
  const limit = allowance.limit ?? SCAN_PLAN.freeScansPerMonth;
  return `You've used your ${limit} free scans this month. They start again on ${resetDay(new Date(allowance.resetsAt))}. For unlimited scans, see the Scrivn Scan plan at ${SCAN_PLAN_PAGE_TEXT}.`;
}
