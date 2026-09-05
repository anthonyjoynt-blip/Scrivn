"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ClaimScope, ClaimSort } from "@/lib/claimsRepo";

/**
 * Search, sort, and whose claims to show.
 *
 * Everything here writes to the URL rather than to component state, so the page can stay a server
 * component and the filtering can stay in Postgres. It also means a filtered view has an address —
 * bookmarkable, shareable, and still there after a reload.
 *
 * The search box is debounced. Navigating on every keystroke would round-trip to the server per
 * character; a short settle turns a typed name into one request, and the field keeps its own value
 * meanwhile so it never feels laggy.
 */

const SEARCH_DELAY_MS = 300;

export function ClaimsControls({
  search,
  sort,
  scope,
  canSeeAll,
}: {
  search: string;
  sort: ClaimSort;
  scope: ClaimScope;
  /** False for a member, who has no whole-organization view to switch to — see `listClaims`. */
  canSeeAll: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(search);
  /*
    The value the URL already reflects. Without it the debounce fires once on mount and replaces the
    URL with what it already says — harmless, but it pushes a history entry and makes Back feel
    broken.
  */
  const applied = useRef(search);

  function urlFor(next: { q?: string; sort?: ClaimSort; scope?: ClaimScope }) {
    const params = new URLSearchParams();
    const q = next.q ?? term;
    const s = next.sort ?? sort;
    const sc = next.scope ?? scope;
    if (q.trim()) params.set("q", q.trim());
    // Defaults are left out, so the plain list has a clean address rather than ?sort=updated&scope=mine.
    if (s !== "updated") params.set("sort", s);
    if (sc !== "mine") params.set("scope", sc);
    const query = params.toString();
    return query ? `/claims?${query}` : "/claims";
  }

  useEffect(() => {
    if (term === applied.current) return;
    const timer = setTimeout(() => {
      applied.current = term;
      router.replace(urlFor({ q: term }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  return (
    <div className="claims-controls">
      <input
        type="text"
        className="claims-search"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search customer, job number, address or insurer"
        aria-label="Search claims"
      />

      <label className="claims-control">
        <span>Sort</span>
        <select value={sort} onChange={(e) => router.replace(urlFor({ sort: e.target.value as ClaimSort }))}>
          <option value="updated">Last updated</option>
          <option value="status">Status</option>
          <option value="customer">Customer name</option>
        </select>
      </label>

      {/*
        Only for an owner. A member has nothing to switch to, and a disabled control that hints at
        claims they cannot see would be worse than no control at all.
      */}
      {canSeeAll && (
        <div className="claims-scope" role="group" aria-label="Whose claims">
          <button
            type="button"
            className={`option-btn${scope === "mine" ? " selected" : ""}`}
            aria-pressed={scope === "mine"}
            onClick={() => router.replace(urlFor({ scope: "mine" }))}
          >
            My claims
          </button>
          <button
            type="button"
            className={`option-btn${scope === "all" ? " selected" : ""}`}
            aria-pressed={scope === "all"}
            onClick={() => router.replace(urlFor({ scope: "all" }))}
          >
            All claims
          </button>
        </div>
      )}
    </div>
  );
}
