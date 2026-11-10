"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FREE_TOOLS } from "@/components/marketing/FreeTools";

/**
 * "Tools" in the signed-in header (2026-11-10): the free tools on the home page - Drop a sketch and the drying
 * calculator - reached from inside the app. The owner, signed in: "it seems impossible for me to get to the homepage
 * to access the drop a sketch and equipment calculator". The wordmark goes to /claim and the menu had only Claims,
 * Account and Sign out, so nothing on the signed-in side led to them, and the installed app has no address bar.
 *
 * One word in the header so it still fits a phone beside Claims, Account and Sign out; the tools open in a small
 * list under it, the way the sync status does. A tap anywhere else, or Escape, closes it.
 */
export function ToolsMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="tools-menu" ref={box}>
      <button type="button" className="user-menu-signout" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        Tools
      </button>
      {open && (
        <ul className="tools-menu-list">
          {FREE_TOOLS.map((t) => (
            <li key={t.href}>
              <Link href={t.href} onClick={() => setOpen(false)}>
                <span aria-hidden="true">{t.icon}</span> {t.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
