/**
 * The web worker that lays the walk's close-ups on their walls after Measure (2026-10-23): lib/photoRouteCloseUps.ts
 * `runMatchJob` off the page's thread, 5-15 seconds a pair on a PC, each result posted as it is found. Started by
 * components/sketch/closeUpWorker.ts. No network: everything it needs comes in the message.
 */

import { type MatchJob, type MatchJobMessage, runMatchJob } from "./photoRouteCloseUps";

const scope = self as unknown as { onmessage: ((e: MessageEvent<MatchJob>) => void) | null; postMessage: (msg: MatchJobMessage) => void };

scope.onmessage = (e) => {
  try {
    runMatchJob(e.data, (msg) => scope.postMessage(msg));
  } catch (err) {
    scope.postMessage({ kind: "error", words: err instanceof Error ? err.message : "The close-ups could not be laid on their walls." });
  }
};
