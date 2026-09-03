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
