import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claimSummary, parseSavedClaimState, type SavedClaimState } from "./claimState";
import { isSupabaseConfigured } from "./supabase/env";
import type { ClaimListOptions, ClaimListResult, SaveResult, StoredClaim } from "./claimsRepo";

/**
 * Claims kept in a file, for local development with no Supabase project — and never anywhere else.
 *
 * The dev fail-open (`middleware.ts`, and `unauthenticatedDevMode` in lib/usage.ts) lets the claim
 * flow run locally without signing in, which is the only way it CAN be run end to end here: signing
 * in is not something a test run may do. But it ran with saving switched off, so everything that
 * happens to a claim between the page and the database — saving, reopening, offline, a clash between
 * two devices — could not be exercised at all. This stands in for the `claims` table so it can.
 *
 * It answers exactly as the table does through lib/claimsRepo.ts — a version that moves on every
 * write, a save that is refused when its base is stale, a device-chosen id that is honoured — because
 * a stand-in that behaved better than the real thing would pass what the real thing fails.
 *
 * Off in production and off whenever Supabase is configured, by the same test as the fail-open
 * itself, so it cannot stand in for a real database anywhere a real one exists.
 */

export function devClaimsMode(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}

interface Row {
  id: string;
  payload: SavedClaimState;
  version: string;
  createdAt: string;
}

// Under .next so it goes wherever the build output goes, and is never committed.
const FILE = join(process.cwd(), ".next", "dev-claims.json");

function read(): Record<string, Row> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Row>;
  } catch {
    return {};
  }
}

function write(rows: Record<string, Row>): void {
  mkdirSync(dirname(FILE), { recursive: true });
  // Through a temporary file, so a request read mid-write never sees half a file.
  writeFileSync(`${FILE}.tmp`, JSON.stringify(rows));
  renameSync(`${FILE}.tmp`, FILE);
}

let tick = 0;
/** Unique per write, like `updated_at`: an ISO time plus a counter for two writes in one millisecond. */
function nextVersion(): string {
  tick = (tick + 1) % 1000;
  return `${new Date().toISOString().replace("Z", "")}${String(tick).padStart(3, "0")}+00:00`;
}

export const devClaims = {
  list(options: ClaimListOptions): ClaimListResult {
    const search = options.search?.trim().toLowerCase() ?? "";
    const claims = Object.values(read())
      .map((row) => {
        const summary = claimSummary(row.payload);
        return {
          id: row.id,
          customerName: summary.customer_name,
          jobNumber: summary.job_number,
          address: summary.address,
          insurer: summary.insurer,
          step: summary.step,
          status: summary.status,
          updatedAt: row.version.slice(0, 23) + "Z",
          version: row.version,
          createdAt: row.createdAt,
          createdBy: null,
          mine: true,
        };
      })
      .filter((c) => !search || `${c.customerName} ${c.jobNumber} ${c.address} ${c.insurer}`.toLowerCase().includes(search))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { claims, scope: "mine", canSeeAll: false };
  },

  load(id: string): StoredClaim | null {
    const row = read()[id];
    return row ? { state: parseSavedClaimState(row.payload), version: row.version } : null;
  },

  create(state: SavedClaimState, id?: string): { id: string; version: string; existed: boolean } {
    const rows = read();
    const key = id ?? randomUUID();
    const existing = rows[key];
    if (existing) return { id: key, version: existing.version, existed: true };
    rows[key] = { id: key, payload: state, version: nextVersion(), createdAt: new Date().toISOString() };
    write(rows);
    return { id: key, version: rows[key]!.version, existed: false };
  },

  save(id: string, state: SavedClaimState, base?: string): SaveResult {
    const rows = read();
    const row = rows[id];
    if (!row) return { ok: false, reason: "missing" };
    if (base && row.version !== base) return { ok: false, reason: "conflict", current: { state: parseSavedClaimState(row.payload), version: row.version } };
    row.payload = state;
    row.version = nextVersion();
    write(rows);
    return { ok: true, version: row.version };
  },

  remove(id: string): boolean {
    const rows = read();
    if (!rows[id]) return false;
    delete rows[id];
    write(rows);
    return true;
  },
};
