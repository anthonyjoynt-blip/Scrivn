"use client";

import { waitingPhotoFiles } from "@/lib/devicePhotos";

/**
 * Sign out — a real form POST, as before, so it works with no JavaScript at all. What JavaScript adds
 * (2026-10-14): when photos taken on this phone have not uploaded yet, it asks first.
 *
 * They are not lost by signing out — they stay on the phone, kept from anyone else who signs in, and
 * upload when their owner signs in here again (lib/devicePhotos.ts). But a technician signing out to
 * hand the phone back should know their photos are still only on it.
 */
export function SignOutButton() {
  return (
    <form
      action="/api/logout"
      method="post"
      onSubmit={async (e) => {
        const form = e.currentTarget;
        e.preventDefault();
        let waiting = 0;
        try {
          waiting = (await waitingPhotoFiles()).length;
        } catch {
          waiting = 0;
        }
        if (
          waiting > 0 &&
          !window.confirm(
            `${waiting} photo${waiting === 1 ? " has" : "s have"} not uploaded yet. ${waiting === 1 ? "It stays" : "They stay"} on this phone and upload${waiting === 1 ? "s" : ""} when you sign in here again. Sign out anyway?`,
          )
        )
          return;
        form.submit();
      }}
    >
      <button type="submit" className="user-menu-signout">
        Sign out
      </button>
    </form>
  );
}
