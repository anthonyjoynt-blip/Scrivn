"use client";

import type { MatchJob, MatchJobMessage } from "@/lib/photoRouteCloseUps";

/**
 * The walk's close-ups laid on their walls off the page's thread (2026-10-23): lib/photoRouteMatchWorker.ts, one pair after
 * another, each result sent back as it is found. [transfer]: the buffers handed over, not copied (the photos' grey or
 * pixels - the page is done with them). Returns what stops it; a browser with no workers is told so at once.
 */
export function startCloseUpMatching(job: MatchJob, transfer: Transferable[], on: (msg: MatchJobMessage) => void): () => void {
  if (typeof Worker === "undefined") {
    on({ kind: "error", words: "This browser can't lay the close-ups on their walls: tap 4 points on both photos instead." });
    return () => {};
  }
  const worker = new Worker(new URL("../../lib/photoRouteMatchWorker.ts", import.meta.url), { type: "module" });
  let over = false;
  worker.onmessage = (e: MessageEvent<MatchJobMessage>) => {
    if (over) return;
    on(e.data);
    if (e.data.kind === "done" || e.data.kind === "error") {
      over = true;
      worker.terminate();
    }
  };
  worker.onerror = (e) => {
    if (over) return;
    over = true;
    worker.terminate();
    on({ kind: "error", words: e.message || "The close-ups could not be laid on their walls." });
  };
  worker.postMessage(job, transfer);
  return () => {
    over = true;
    worker.terminate();
  };
}
