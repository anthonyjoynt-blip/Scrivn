import Link from "next/link";
import { listClaims, type ClaimScope, type ClaimSort } from "@/lib/claimsRepo";
import { claimStatusLabel } from "@/lib/claimState";
import { DeleteClaimButton } from "./DeleteClaimButton";
import { ClaimsControls } from "./ClaimsControls";
import { PendingSaves } from "./PendingSaves";

/**
 * The claims list — the reason for saving incrementally in the first place.
 *
 * A server component, so the query runs with the user's session on the server and the rows arrive
 * already filtered by RLS. Nothing about another organization's claims is ever sent to this browser,
 * which is a stronger position than fetching everything and filtering in the client.
 *
 * ── Why the controls are in the URL rather than in component state ───────────────────────────────
 *
 * Search, sort and scope are read from `searchParams`, which means every view of this list has an
 * address. A PM can bookmark "everything at gap-check", send a colleague a link to a search, and get
 * the same list back after a reload or a browser restart — none of which is true of state that lives
 * in a component. It also keeps the filtering in Postgres, where a search across an organization's
 * claims belongs, rather than shipping every row to the browser to be filtered there.
 */

export const metadata = { title: "Claims · Scrivn" };

// Always fresh: a list of claims that shows yesterday's state is worse than useless to somebody
// looking for the one they were working on ten minutes ago.
export const dynamic = "force-dynamic";

function when(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString();
}

/** One value out of a URL parameter, which may legitimately arrive as an array or as nonsense. */
function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = one(params.q);
  const sortParam = one(params.sort);
  const sort: ClaimSort = sortParam === "status" || sortParam === "customer" ? sortParam : "updated";
  // Validated rather than trusted: an unrecognised scope falls back to "mine", and `listClaims`
  // independently refuses "all" for a member — see its comment on why both.
  const requestedScope: ClaimScope = one(params.scope) === "all" ? "all" : "mine";

  let result;
  try {
    result = await listClaims({ search, sort, scope: requestedScope });
  } catch (err) {
    return (
      <main className="page">
        <div className="card">
          <h1>Claims</h1>
          <p className="field-note">Could not load your claims: {err instanceof Error ? err.message : "unexpected error"}</p>
        </div>
      </main>
    );
  }

  const { claims, scope, canSeeAll } = result;
  const filtered = search.trim() !== "";

  return (
    <main className="page">
      <div className="card">
        <div className="claims-header">
          <h1>Claims</h1>
          <Link className="btn-primary" href="/claim">
            New claim
          </Link>
        </div>

        {/*
          Above the controls, because it is about claims that are missing from the list rather than
          about how the list is filtered — and below it a PM searching for the very claim being held
          would read "no claims match" first and stop there.
        */}
        <PendingSaves />

        <ClaimsControls search={search} sort={sort} scope={scope} canSeeAll={canSeeAll} />

        {claims.length === 0 ? (
          <p className="field-note">
            {filtered
              ? `No claims match “${search}”.`
              : scope === "all"
                ? "Nobody in your organization has saved a claim yet."
                : "No saved claims yet. Start one and it saves itself as you go — you can pick it up on another device from this list."}
          </p>
        ) : (
          <>
            <p className="field-note claims-count">
              {claims.length} claim{claims.length === 1 ? "" : "s"}
              {scope === "all" ? " across your organization" : ""}
              {filtered ? ` matching “${search}”` : ""}
            </p>
            <ul className="claims-list">
              {claims.map((c) => (
                <li key={c.id} className="claims-row">
                  {/* The whole row is the link, so a thumb on a phone does not have to find the text. */}
                  <Link className="claims-row-main" href={`/claim?id=${c.id}`}>
                    <span className="claims-row-name">{c.customerName || "Unnamed claim"}</span>
                    <span className="claims-row-meta">
                      {c.jobNumber ? <span className="claims-row-job">{c.jobNumber}</span> : null}
                      {c.insurer ? <span>{c.insurer}</span> : null}
                      {c.address ? <span className="claims-row-address">{c.address}</span> : null}
                      <span className="claims-row-when">{when(c.updatedAt)}</span>
                      {/* Only when looking at everyone's — on your own list every row would say it. */}
                      {scope === "all" && !c.mine ? <span className="claims-row-owner">colleague’s</span> : null}
                    </span>
                  </Link>
                  <span className={`claims-status claims-status-${c.status}`}>{claimStatusLabel(c.status)}</span>
                  <DeleteClaimButton id={c.id} name={c.customerName || c.jobNumber || "this claim"} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
