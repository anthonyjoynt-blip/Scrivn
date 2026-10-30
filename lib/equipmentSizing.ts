/**
 * The arithmetic shared by every "how many machines" calculation in the app.
 *
 * Dehumidifier sizing was here first and this is lifted out of it unchanged, because negative air
 * machines are sized the same way and will not be the last: a required capacity comes from the room
 * volume, a machine has a rating, and the count is one divided by the other rounded up. Copying
 * those three lines into each new piece of equipment is how two calculations that are supposed to
 * agree quietly stop agreeing.
 *
 * Every count rounds UP, for the reason `lib/equipment.ts` gives: half a machine does not exist,
 * and rounding a containment or drying calculation down is the one direction that fails the job.
 */

/** Capacity required for a given number of air changes per hour. Volume x ACH / 60 = CFM. */
export function airChangeCfm(cubicFeet: number, airChangesPerHour: number): number {
  if (cubicFeet <= 0 || airChangesPerHour <= 0) return 0;
  return (cubicFeet * airChangesPerHour) / 60;
}

/** Capacity required when the standard expresses itself as a divisor rather than an ACH. */
export function capacityFromFactor(cubicFeet: number, factor: number): number {
  if (cubicFeet <= 0 || factor <= 0) return 0;
  return cubicFeet / factor;
}

/**
 * Machines needed to meet a required capacity.
 *
 * Zero rating returns zero rather than dividing — an unconfigured machine size should read as "not
 * calculated", not as Infinity units.
 */
export function unitsForCapacity(required: number, ratingPerUnit: number): number {
  if (required <= 0 || ratingPerUnit <= 0) return 0;
  return Math.ceil(required / ratingPerUnit);
}

/**
 * A job's machines dealt out to its rooms by volume, largest remainder first.
 *
 * The total is sized once over the whole volume and must stay that total: giving each room its own
 * rounded-up count would buy a machine for every doorway, which is the mistake `claimEquipment`
 * exists to avoid. So the biggest rooms get them, and a small room beside a big one may get none —
 * its air is dried through the doorway. Ties go to the bigger room, then the earlier one.
 *
 * Here rather than in lib/dryingPlan.ts, which draws the shares, because the claim's per-room
 * suggestions take them too (`claimEquipment`), and the two have to be the one split.
 */
export function shareByVolume(volumes: number[], total: number): number[] {
  const sum = volumes.reduce((s, v) => s + Math.max(0, v), 0);
  if (sum <= 0 || total <= 0) return volumes.map(() => 0);
  const exact = volumes.map((v) => (Math.max(0, v) / sum) * total);
  const out = exact.map((e) => Math.floor(e));
  let left = total - out.reduce((s, n) => s + n, 0);
  const order = exact
    .map((e, i) => ({ i, rest: e - Math.floor(e), volume: volumes[i] ?? 0 }))
    .sort((a, b) => b.rest - a.rest || b.volume - a.volume || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}
