"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import type { DeviceTokenItem } from "@/lib/deviceRepo";

/**
 * The phones paired to this organization, and the way to pair another.
 *
 * ── How pairing reads from this side ─────────────────────────────────────────────────────────────
 *
 * Scrivn mints a short code (`POST /api/devices`) and shows it two ways at once: as a QR carrying the
 * pairing URL, for the phone's camera, and as eight letters in large type for anyone whose camera
 * will not focus on a laptop screen. The phone trades the code for its own token; Scrivn never sees
 * that token again and this page never shows it. The code dies in ten minutes, so the countdown is
 * not decoration — when it reaches zero the QR on screen is worth nothing and says so.
 *
 * The list cannot know the moment a phone pairs — that happens between the phone and the server —
 * so it offers Refresh rather than pretending to. Revoking is in place: the row stays, marked
 * Revoked, because a phone that once sent scans is still part of the record of where they came from.
 */

interface PairingCode {
  /** As shown: `XXXX-XXXX`. */
  code: string;
  /**
   * When the code dies, on THIS browser's clock: the moment the code arrived plus the server's TTL.
   * The server also says when it expires by its own clock, but a countdown measured against a
   * laptop's clock — minutes slow on a machine without reliable time — would show time left on a
   * code the database has already refused. Counting down from receipt keeps the clock comparing
   * with itself; the only error is the request's own latency, well under a second.
   */
  deadline: number;
  url: string;
  /** The QR as a data URL, or null when drawing it failed; the typed code still pairs. */
  qr: string | null;
}

type Busy = "pair" | "refresh" | `revoke:${string}` | null;

const PAIR_FAILED = "Couldn’t make a pairing code just now. Please try again.";
const REFRESH_FAILED = "Couldn’t refresh the list just now. Please try again.";
const REVOKE_FAILED = "Couldn’t revoke that phone just now. Please try again.";

export function PairedPhones({ initial, canRevokeAll }: { initial: DeviceTokenItem[]; canRevokeAll: boolean }) {
  const [devices, setDevices] = useState<DeviceTokenItem[]>(initial);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  /*
    The viewer's clock: set once mounted, and every second while a code is up so "Expires in" moves.
    Null on the server on purpose. "Last used 3 min ago" and a locale date are the viewer's, not the
    server's, and rendering them before hydration would produce text the browser then disagrees with.
  */
  const [now, setNow] = useState<number | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  /** The phone whose Revoke has been pressed once — the second, deliberate press is the one that acts. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (!pairing) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pairing]);

  const secondsLeft = pairing ? Math.max(0, Math.floor((pairing.deadline - (now ?? Date.now())) / 1000)) : 0;
  const expired = pairing !== null && secondsLeft === 0;

  async function handlePair() {
    setBusy("pair");
    setError(null);
    try {
      const res = await fetch("/api/devices", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { code?: string; expiresAt?: string; url?: string; ttlSeconds?: number; error?: string } | null;
      if (!res.ok || !body?.code || !body.url || typeof body.ttlSeconds !== "number") throw new Error(body?.error ?? PAIR_FAILED);
      const deadline = Date.now() + body.ttlSeconds * 1000;
      let qr: string | null = null;
      try {
        qr = await QRCode.toDataURL(body.url, { margin: 1, width: 240 });
      } catch (err) {
        // The letters under the QR are the same code; a QR that would not draw costs only the camera.
        console.warn("[paired phones] QR not drawn:", err);
      }
      setPairing({ code: body.code, deadline, url: body.url, qr });
    } catch (err) {
      setError(err instanceof Error ? err.message : PAIR_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh() {
    setBusy("refresh");
    setError(null);
    try {
      const res = await fetch("/api/devices");
      const body = (await res.json().catch(() => null)) as { devices?: DeviceTokenItem[]; error?: string } | null;
      if (!res.ok || !Array.isArray(body?.devices)) throw new Error(body?.error ?? REFRESH_FAILED);
      setDevices(body.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : REFRESH_FAILED);
    } finally {
      setBusy(null);
    }
  }

  async function handleRevoke(device: DeviceTokenItem) {
    setBusy(`revoke:${device.id}`);
    setError(null);
    try {
      const res = await fetch(`/api/devices/${device.id}`, { method: "DELETE" });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? REVOKE_FAILED);
      // Marked here rather than re-fetched: the server said it changed, and the time is close enough.
      const revokedAt = new Date().toISOString();
      setDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, revokedAt } : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : REVOKE_FAILED);
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <div className="paired-phones">
      {devices.length === 0 ? (
        <p className="field-note" style={{ margin: "0 0 16px" }}>
          No phones are paired yet. Pair one and its room scans land in your claims here.
        </p>
      ) : (
        <ul className="paired-phones-list">
          {devices.map((device) => {
            const revoked = device.revokedAt !== null;
            const mayRevoke = !revoked && (device.mine || canRevokeAll);
            const revoking = busy === `revoke:${device.id}`;
            return (
              <li key={device.id} className={`paired-phone${revoked ? " is-revoked" : ""}`}>
                <div className="paired-phone-main">
                  <span className="paired-phone-name">{device.name.trim() || "Unnamed phone"}</span>
                  {now !== null && (
                    <span className="paired-phone-meta">
                      <span>
                        Paired {new Date(device.createdAt).toLocaleDateString()}
                        {device.mine ? "" : " by someone else in your organization"}
                      </span>
                      <span className="paired-phone-used">
                        {device.revokedAt ? `Revoked ${new Date(device.revokedAt).toLocaleDateString()}` : `Last used ${lastUsed(device.lastUsedAt, now)}`}
                      </span>
                    </span>
                  )}
                </div>
                {revoked ? (
                  <span className="paired-phone-state">Revoked</span>
                ) : mayRevoke && confirming === device.id ? (
                  <span className="paired-phone-actions">
                    <span className="field-note">Revoke this phone?</span>
                    <button type="button" className="btn-secondary" onClick={() => setConfirming(null)} disabled={revoking}>
                      Cancel
                    </button>
                    <button type="button" className="btn-danger" onClick={() => void handleRevoke(device)} disabled={busy !== null}>
                      {revoking ? "Revoking…" : "Revoke"}
                    </button>
                  </span>
                ) : mayRevoke ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setConfirming(device.id)}
                    disabled={busy !== null}
                    aria-label={`Revoke ${device.name.trim() || "unnamed phone"}`}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {pairing && (
        <div className="pairing-code">
          {pairing.qr && !expired && (
            // A plain <img>, as the letterhead logo is: a data URL drawn at exactly this size, with
            // nothing for next/image to optimise. Taken down with the code — an expired QR still scans.
            <img className="pairing-qr" src={pairing.qr} width={240} height={240} alt={`QR code for pairing code ${pairing.code}`} />
          )}
          <p className="pairing-instructions">In Scrivn Scan on your phone, tap Pair and point the camera at this code.</p>
          <p className="field-note pairing-or">or type this code in the app</p>
          <code className={`pairing-letters${expired ? " is-expired" : ""}`}>{pairing.code}</code>
          {expired ? (
            <p className="pairing-expiry is-expired">This code has expired. Make a new one to pair the phone.</p>
          ) : (
            <p className="pairing-expiry">Expires in {countdown(secondsLeft)}</p>
          )}
        </div>
      )}

      {error && <p className="letterhead-status">{error}</p>}

      <div className="actions-row">
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void handleRefresh()}>
          {busy === "refresh" ? "Refreshing…" : "Refresh"}
        </button>
        <button type="button" className={pairing && !expired ? "btn-secondary" : "btn-primary"} disabled={busy !== null} onClick={() => void handlePair()}>
          {busy === "pair" ? "Making a code…" : pairing ? "New code" : "Pair a phone"}
        </button>
      </div>
      <p className="field-note">Pairing lets that phone send room scans into this organization’s claims. It can be revoked here at any time.</p>
    </div>
  );
}

/** "m:ss" — a code lives ten minutes, so minutes and seconds is the whole story. */
function countdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** When the phone last called in, in the same register as the claims list; "never" for a phone paired and not yet used. */
function lastUsed(iso: string | null, now: number): string {
  if (iso === null) return "never";
  const then = new Date(iso);
  const minutes = Math.round((now - then.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return then.toLocaleDateString();
}
