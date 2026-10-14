"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { waitingJobs, type ClaimJob, type TraceJob } from "./aiJobs";
import { connection, onConnectionChange, type Connection } from "./connectivity";
import { allDeviceClaims, deviceUser, isMine, onDeviceChange, type DeviceClaim } from "./deviceClaims";

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
  const [work, setWork] = useState<Omit<DeviceWork, "connection">>({ claims: [], jobs: [], signedOutWaiting: 0, names: {} });

  const refresh = useCallback(async () => {
    const user = deviceUser();
    const all = await allDeviceClaims();
    const owed = (r: DeviceClaim) => r.dirty || r.clash !== null;
    if (user === undefined) {
      setWork({ claims: [], jobs: [], signedOutWaiting: all.filter(owed).length, names: {} });
      return;
    }
    const mine = all.filter((r) => isMine(r, user));
    const names = Object.fromEntries(mine.map((r) => [r.id, claimName(r.state)]));
    setWork({
      claims: mine.filter(owed).sort((a, b) => a.changedAt - b.changedAt),
      jobs: await waitingJobs(),
      signedOutWaiting: 0,
      names,
    });
  }, []);

  useEffect(() => {
    void refresh();
    return onDeviceChange(() => void refresh());
  }, [refresh]);

  return { connection: conn, ...work };
}
