"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { waitingJobs, type ClaimJob, type TraceJob } from "./aiJobs";
import { connection, onConnectionChange, type Connection } from "./connectivity";
import { allDeviceClaims, deviceUser, isMine, onDeviceChange, type DeviceClaim } from "./deviceClaims";
import { waitingPhotoFiles } from "./devicePhotos";

/**
 * What this device is holding for the server, kept current — for the header and the Claims list.
 *
 * Read from the device's own store, so it is the same answer offline as on: the point is to show
 * what has NOT reached the server, which is exactly what asking the server cannot tell you.
 */

export interface DeviceWork {
  connection: Connection;
  /** Claims with something the server has not got: unsynced changes, a clash, a refusal. */
  claims: DeviceClaim[];
  /** Claude steps waiting for signal, or answered and waiting to be looked at. */
  jobs: (ClaimJob | TraceJob)[];
  /** Nobody is signed in, and this many claims on the device are waiting for somebody to be. */
  signedOutWaiting: number;
  /** Names for the claims the jobs belong to, from the device's copies. */
  names: Record<string, string>;
  /** Site photos' pictures waiting to upload, by claim — see lib/devicePhotos.ts. */
  photos: { claimId: string; count: number; refused: number }[];
}

export function claimName(state: DeviceClaim["state"] | undefined): string {
  if (!state) return "A claim";
  return state.claim.customerName.trim() || state.claim.jobNumber.trim() || "Unnamed claim";
}

function subscribeConnection(listener: () => void) {
  return onConnectionChange(listener);
}

export function useConnection(): Connection {
  // "online" on the server render, so a page never hydrates claiming to be offline.
  return useSyncExternalStore(subscribeConnection, connection, () => "online");
}

export function useDeviceWork(): DeviceWork {
  const conn = useConnection();
  const [work, setWork] = useState<Omit<DeviceWork, "connection">>({ claims: [], jobs: [], signedOutWaiting: 0, names: {}, photos: [] });

  const refresh = useCallback(async () => {
    const user = deviceUser();
    const all = await allDeviceClaims();
    const owed = (r: DeviceClaim) => r.dirty || r.clash !== null;
    if (user === undefined) {
      setWork({ claims: [], jobs: [], signedOutWaiting: all.filter(owed).length, names: {}, photos: [] });
      return;
    }
    const mine = all.filter((r) => isMine(r, user));
    const names = Object.fromEntries(mine.map((r) => [r.id, claimName(r.state)]));
    const byClaim = new Map<string, { claimId: string; count: number; refused: number }>();
    for (const f of await waitingPhotoFiles()) {
      const entry = byClaim.get(f.claimId) ?? { claimId: f.claimId, count: 0, refused: 0 };
      entry.count += 1;
      if (f.refused) entry.refused += 1;
      byClaim.set(f.claimId, entry);
    }
    setWork({
      claims: mine.filter(owed).sort((a, b) => a.changedAt - b.changedAt),
      jobs: await waitingJobs(),
      signedOutWaiting: 0,
      names,
      photos: [...byClaim.values()],
    });
  }, []);

  useEffect(() => {
    void refresh();
    return onDeviceChange(() => void refresh());
  }, [refresh]);

  return { connection: conn, ...work };
}
