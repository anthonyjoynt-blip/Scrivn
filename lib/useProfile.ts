"use client";

import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "./supabase/env";

export interface ProfileDefaults {
  fullName: string;
  phone: string;
}

/**
 * The signed-in person's name and phone, for starting a claim with them filled in.
 *
 * Null until loaded, and null for good in the dev fail-open or when the fetch fails — the claim page
 * treats null as "nothing to prefill", which is exactly the behaviour before profiles existed. Kept
 * out of the page's own state on the same reasoning as `useLetterhead`: it belongs to the person,
 * not the claim, and must survive starting a new one.
 */
export function useProfile(): ProfileDefaults | null {
  const [profile, setProfile] = useState<ProfileDefaults | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { profile?: ProfileDefaults } | null) => {
        if (!cancelled && body?.profile) setProfile(body.profile);
      })
      .catch(() => {
        // Nothing to prefill; the PM types it, as they always did.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return profile;
}
