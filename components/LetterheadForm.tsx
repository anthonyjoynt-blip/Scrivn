"use client";

import { useRef, useState } from "react";
import { LetterheadBanner } from "@/components/LetterheadBanner";
import {
  LETTERHEAD_LIMITS,
  LOGO_NORMALISE,
  letterheadFromSettings,
  normaliseLetterheadSettings,
  type LetterheadLogo,
  type LetterheadSettings,
  type OrganizationLetterheadState,
} from "@/lib/letterhead";

/**
 * The company letterhead, edited with the result in view.
 *
 * The preview at the top is the real `LetterheadBanner` fed the form's current values, so what
 * the owner sees while choosing a colour is exactly what the next PDF will carry — the same object
 * goes to `lib/pdf.ts`. Nothing is previewed by approximation.
 *
 * ── Two kinds of change ──────────────────────────────────────────────────────────────────────────
 *
 * The text and colours are a form with a Save button. The logo applies the moment a file is chosen
 * or removed. Splitting them keeps each action's outcome obvious: a Save that also had to upload a
 * file could half-succeed, and "which half?" is not a question a settings page should pose.
 */
export function LetterheadForm({ initial }: { initial: OrganizationLetterheadState }) {
  const [settings, setSettings] = useState<LetterheadSettings>(initial.settings);
  const [saved, setSaved] = useState<LetterheadSettings>(initial.settings);
  const [logo, setLogo] = useState<LetterheadLogo | null>(initial.logo);
  const [configured, setConfigured] = useState(initial.configured);
  const [busy, setBusy] = useState<"save" | "upload" | "remove" | null>(null);
  const [notice, setNotice] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const preview = letterheadFromSettings(settings, logo);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  function applyState(state: OrganizationLetterheadState) {
    setSettings(state.settings);
    setSaved(state.settings);
    setLogo(state.logo);
    setConfigured(state.configured);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    // The same check the server makes, so the message is the same one and arrives without a round trip.
    const parsed = normaliseLetterheadSettings(settings);
    if (!parsed.ok) {
      setNotice({ kind: "error", text: parsed.error });
      return;
    }
    setBusy("save");
    setNotice(null);
    try {
      const res = await fetch("/api/organization/letterhead", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: parsed.settings }),
      });
      const body = (await res.json().catch(() => null)) as { state?: OrganizationLetterheadState; error?: string } | null;
      if (!res.ok || !body?.state) throw new Error(body?.error ?? "Couldn’t save just now. Please try again.");
      applyState(body.state);
      setNotice({ kind: "saved", text: "Saved. Every document you download or send from now on carries this letterhead." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn’t save just now. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  async function handleChooseLogo(file: File | undefined) {
    if (!file) return;
    setBusy("upload");
    setNotice(null);
    try {
      const png = await normaliseLogo(file);
      const form = new FormData();
      form.append("logo", png, "logo.png");
      const res = await fetch("/api/organization/logo", { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as { state?: OrganizationLetterheadState; error?: string } | null;
      if (!res.ok || !body?.state) throw new Error(body?.error ?? "Couldn’t upload that logo. Please try again.");
      applyState(body.state);
      setNotice({ kind: "saved", text: "Logo updated." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn’t upload that logo. Please try again." });
    } finally {
      setBusy(null);
      // So choosing the same file again after an error still fires onChange.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemoveLogo() {
    setBusy("remove");
    setNotice(null);
    try {
      const res = await fetch("/api/organization/logo", { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { state?: OrganizationLetterheadState; error?: string } | null;
      if (!res.ok || !body?.state) throw new Error(body?.error ?? "Couldn’t remove the logo just now. Please try again.");
      applyState(body.state);
      setNotice({ kind: "saved", text: "Logo removed." });
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "Couldn’t remove the logo just now. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  if (!initial.canEdit) {
    return (
      <>
        <LetterheadBanner letterhead={initial.letterhead} />
        <p className="field-note">Only the organization’s owner can change the letterhead.</p>
      </>
    );
  }

  return (
    <form className="letterhead-form" onSubmit={handleSave}>
      <LetterheadBanner letterhead={preview} />

      {!configured && (
        <p className="field-note" style={{ marginBottom: 16 }}>
          Your documents currently carry the Scrivn letterhead. Save your company’s details below and every PDF from then on carries them instead.
        </p>
      )}

      <div className="auth-field">
        <label className="prompt" htmlFor="letterhead-company">
          Company name
        </label>
        <input
          id="letterhead-company"
          type="text"
          autoComplete="organization"
          required
          maxLength={LETTERHEAD_LIMITS.companyName}
          value={settings.companyName}
          onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
        />
      </div>

      <div className="auth-field">
        <label className="prompt" htmlFor="letterhead-tagline">
          Tagline <span className="field-hint">(optional)</span>
        </label>
        <input
          id="letterhead-tagline"
          type="text"
          maxLength={LETTERHEAD_LIMITS.tagline}
          placeholder="e.g. Water, fire & mould restoration"
          value={settings.tagline}
          onChange={(e) => setSettings({ ...settings, tagline: e.target.value })}
        />
      </div>

      <div className="letterhead-colours">
        <div className="auth-field">
          <label className="prompt" htmlFor="letterhead-primary">
            Banner colour
          </label>
          <div className="letterhead-colour">
            <input id="letterhead-primary" type="color" value={settings.primaryColor} onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })} />
            <code>{settings.primaryColor}</code>
          </div>
          <p className="field-note">The band across the top. Text on it turns dark automatically if you pick a light colour.</p>
        </div>
        <div className="auth-field">
          <label className="prompt" htmlFor="letterhead-accent">
            Accent colour
          </label>
          <div className="letterhead-colour">
            <input id="letterhead-accent" type="color" value={settings.accentColor} onChange={(e) => setSettings({ ...settings, accentColor: e.target.value })} />
            <code>{settings.accentColor}</code>
          </div>
          <p className="field-note">The stripe under the band and the rule under each document’s title.</p>
        </div>
      </div>

      <div className="auth-field">
        <span className="prompt" style={{ display: "block", marginBottom: 6 }}>
          Logo <span className="field-hint">(optional)</span>
        </span>
        <div className="letterhead-logo-row">
          <input
            ref={fileInput}
            id="letterhead-logo"
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => void handleChooseLogo(e.target.files?.[0])}
          />
          <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
            {busy === "upload" ? "Uploading…" : logo ? "Replace logo" : "Upload logo"}
          </button>
          {logo && (
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void handleRemoveLogo()}>
              {busy === "remove" ? "Removing…" : "Remove logo"}
            </button>
          )}
        </div>
        <p className="field-note">PNG, JPG or SVG. A logo on a transparent background sits best on the band. Applied as soon as it’s uploaded.</p>
      </div>

      <div className="actions-row">
        <button type="submit" className="btn-primary" disabled={busy !== null || !dirty}>
          {busy === "save" ? "Saving…" : "Save letterhead"}
        </button>
        {notice && <p className={`letterhead-status${notice.kind === "saved" ? " is-saved" : ""}`}>{notice.text}</p>}
      </div>
    </form>
  );
}

/**
 * Whatever image was chosen, as a PNG no larger than `LOGO_NORMALISE`.
 *
 * Done in the browser on a canvas so the server — and the PDF, and the bucket's type limit — only
 * ever see one format. A JPG, a WebP or an SVG the browser can decode all come out the same way,
 * and a transparent background survives because the export is PNG. Scaled down only, never up: a
 * small logo stays its own size rather than being blurred to fill the box.
 */
async function normaliseLogo(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn’t read that file as an image."));
      img.src = url;
    });
    // An SVG with no intrinsic size decodes to 0 × 0 and would draw nothing.
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Couldn’t work out that image’s size. Try exporting it as a PNG.");

    const scale = Math.min(1, LOGO_NORMALISE.maxWidth / image.naturalWidth, LOGO_NORMALISE.maxHeight / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn’t prepare the image in this browser.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn’t convert that image. Try exporting it as a PNG.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
