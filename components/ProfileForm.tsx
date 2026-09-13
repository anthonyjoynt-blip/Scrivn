"use client";

import { useState } from "react";
import type { ProfileDefaults as Profile } from "@/lib/useProfile";

/**
 * The person's name and phone. Saved to the profile; copied onto each claim as it starts, where
 * they stay editable — so a change here reaches the next claim, not one already written.
 */
export function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState<Profile>(initial);
  const [saved, setSaved] = useState<Profile>(initial);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const dirty = profile.fullName !== saved.fullName || profile.phone !== saved.phone;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile }) });
      const body = (await res.json().catch(() => null)) as { profile?: Profile; error?: string } | null;
      if (!res.ok || !body?.profile) throw new Error(body?.error ?? "Couldn’t save just now. Please try again.");
      setProfile(body.profile);
      setSaved(body.profile);
      setNotice({ kind: "saved", text: "Saved. The next claim you start will carry these." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn’t save just now. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="letterhead-form" onSubmit={handleSave}>
      <div className="auth-field">
        <label className="prompt" htmlFor="profile-name">
          Your name
        </label>
        <input id="profile-name" type="text" autoComplete="name" maxLength={80} value={profile.fullName} onChange={(e) => setProfile({ ...profile, fullName: e.target.value })} />
        <p className="field-note">Goes in as the project manager on each new claim.</p>
      </div>
      <div className="auth-field">
        <label className="prompt" htmlFor="profile-phone">
          Your phone
        </label>
        <input id="profile-phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
        <p className="field-note">The PM phone on the inspection report and every crew sheet. Editable per claim at intake.</p>
      </div>
      <div className="actions-row">
        <button type="submit" className="btn-primary" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save details"}
        </button>
        {notice && <p className={`letterhead-status${notice.kind === "saved" ? " is-saved" : ""}`}>{notice.text}</p>}
      </div>
    </form>
  );
}
