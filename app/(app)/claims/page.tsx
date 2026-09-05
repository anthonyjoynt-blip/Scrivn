import Link from "next/link";
import { listClaims } from "@/lib/claimsRepo";
import { claimStatusLabel } from "@/lib/claimState";
import { DeleteClaimButton } from "./DeleteClaimButton";

/**
 * The claims list — the reason for saving incrementally in the first place.
 *
 * A server component, so the query runs with the user's session on the server and the rows arrive
 * already filtered by RLS. Nothing about another organization's claims is ever sent to this browser,
 * which is a stronger position than fetching everything and filtering in the client.
 *
 * Deliberately plain: customer, job number, where the claim got to, when it was last touched, and a
 * way to delete it. Enough to find the right claim and carry on with it, which is the whole job of a
 * first pass. Search, filtering and sorting are what to add once there are enough claims to need
 * them.
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

export default async function ClaimsPage() {
  let claims;
  try {
    claims = await listClaims();
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

  return (
    <main className="page">
      <div className="card">
        <div className="claims-header">
          <h1>Claims</h1>
          <Link className="btn-primary" href="/claim">
            New claim
          </Link>
        </div>

        {claims.length === 0 ? (
          <p className="field-note">
            No saved claims yet. Start one and it saves itself as you go — you can pick it up on another device from this
            list.
          </p>
        ) : (
          <ul className="claims-list">
            {claims.map((c) => (
              <li key={c.id} className="claims-row">
                {/* The whole row is the link, so a thumb on a phone does not have to find the text. */}
                <Link className="claims-row-main" href={`/claim?id=${c.id}`}>
                  <span className="claims-row-name">{c.customerName || "Unnamed claim"}</span>
                  <span className="claims-row-meta">
                    {c.jobNumber ? <span className="claims-row-job">{c.jobNumber}</span> : null}
                    <span className="claims-row-status">{claimStatusLabel(c.step)}</span>
                    <span className="claims-row-when">{when(c.updatedAt)}</span>
                  </span>
                </Link>
                <DeleteClaimButton id={c.id} name={c.customerName || c.jobNumber || "this claim"} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
