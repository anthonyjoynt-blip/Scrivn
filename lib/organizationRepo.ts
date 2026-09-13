import "server-only";
import { unstable_rethrow } from "next/navigation";
import { createClient } from "./supabase/server";
import { withClockSkewRetry } from "./supabase/clockSkew";
import { NoOrganizationError, NotSignedInError, currentOrganizationId, currentRole } from "./claimsRepo";
import {
  DEFAULT_LETTERHEAD,
  LOGO_LIMITS,
  letterheadFromRow,
  normaliseLetterheadSettings,
  pngDimensions,
  settingsFromRow,
  type Letterhead,
  type LetterheadLogo,
  type OrganizationLetterheadRow,
  type OrganizationLetterheadState,
} from "./letterhead";

export type { OrganizationLetterheadState } from "./letterhead";

/**
 * Every read and write of an organization's letterhead, in one place — the same posture as
 * `claimsRepo.ts`, and for the same reason: Row Level Security is what stops one organization
 * changing another's letterhead (0005_letterhead.sql), and it holds regardless of what this file
 * does. Nothing here is the boundary; it just talks to it.
 *
 * ── Owner-only, and how that shows up ────────────────────────────────────────────────────────────
 *
 * The update policy admits owners only. To a member, the row is visible but not updatable — and
 * RLS expresses "not updatable" as zero rows changed, not as an error. So every write below selects
 * the row back and treats an empty result as `NotOwnerError`, rather than reporting success for a
 * write that touched nothing.
 */

export class NotOwnerError extends Error {
  constructor() {
    super("Only the organization's owner can change its letterhead.");
    this.name = "NotOwnerError";
  }
}

export class LetterheadUnavailableError extends Error {
  constructor(detail: string) {
    super(`Letterhead settings could not be loaded: ${detail}`);
    this.name = "LetterheadUnavailableError";
  }
}

const BUCKET = "logos";
const ROW_COLUMNS = "name, tagline, primary_color, accent_color, logo_path, logo_width, logo_height, letterhead_configured_at";

interface StoredRow extends OrganizationLetterheadRow {
  logo_path: string | null;
  logo_width: number | null;
  logo_height: number | null;
}

/** Always `<organization id>/logo.png` — the storage policies key on that first folder. */
function logoPath(organizationId: string): string {
  return `${organizationId}/logo.png`;
}

async function readRow(organizationId: string): Promise<StoredRow> {
  const supabase = await createClient();
  const { data, error } = await withClockSkewRetry(() => supabase.from("organizations").select(ROW_COLUMNS).eq("id", organizationId).maybeSingle());
  // The likeliest error here is the migration not having been applied yet, which should read as
  // "not available" on the account page rather than as a crash.
  if (error) throw new LetterheadUnavailableError(error.message);
  if (!data) throw new NoOrganizationError();
  return data as unknown as StoredRow;
}

/**
 * The logo as a data URL, fetched through the session so the bucket's read policy applies.
 *
 * A missing or unreadable file is a letterhead without a logo, not a failed page: the row can point
 * at an object that was deleted out from under it, and the document still has to render.
 */
async function readLogo(row: StoredRow): Promise<LetterheadLogo | null> {
  if (!row.logo_path || !row.logo_width || !row.logo_height) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(BUCKET).download(row.logo_path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, width: row.logo_width, height: row.logo_height };
}

async function stateFor(organizationId: string): Promise<OrganizationLetterheadState> {
  const row = await readRow(organizationId);
  const logo = await readLogo(row);
  const role = await currentRole();
  return {
    organizationId,
    canEdit: role === "owner",
    configured: row.letterhead_configured_at !== null,
    settings: settingsFromRow(row),
    logo,
    letterhead: letterheadFromRow(row, logo),
  };
}

/** The account page's view: the whole state, for the session's organization. */
export async function loadOrganizationLetterhead(): Promise<OrganizationLetterheadState> {
  return stateFor(await currentOrganizationId());
}

/**
 * The claim page's view: only what documents draw. The default when anything at all goes wrong —
 * a document must never fail to render because of its branding.
 */
export async function loadLetterhead(): Promise<Letterhead> {
  try {
    const row = await readRow(await currentOrganizationId());
    return letterheadFromRow(row, await readLogo(row));
  } catch (err) {
    // Never swallow Next's own signals — a prerender bailout caught here would freeze the default
    // letterhead into a static response for every organization. See the account page for the same.
    unstable_rethrow(err);
    if (err instanceof NotSignedInError) throw err;
    console.error("[letterhead] falling back to the default:", err);
    return DEFAULT_LETTERHEAD;
  }
}

/** Saves the editable half and stamps the organization as configured. */
export async function updateLetterheadSettings(input: unknown): Promise<OrganizationLetterheadState> {
  const parsed = normaliseLetterheadSettings(input);
  if (!parsed.ok) throw new InvalidLetterheadError(parsed.error);
  const organizationId = await currentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({
      name: parsed.settings.companyName,
      tagline: parsed.settings.tagline === "" ? null : parsed.settings.tagline,
      primary_color: parsed.settings.primaryColor,
      accent_color: parsed.settings.accentColor,
      letterhead_configured_at: new Date().toISOString(),
    })
    .eq("id", organizationId)
    .select("id");
  if (error) throw new LetterheadUnavailableError(error.message);
  if (!data || data.length === 0) throw new NotOwnerError();
  return stateFor(organizationId);
}

export class InvalidLetterheadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLetterheadError";
  }
}

/**
 * Stores a logo. `bytes` must already be a PNG within `LOGO_LIMITS` — the browser normalises to
 * that before uploading, and these checks are the backstop for a client that did not.
 *
 * Uploading also marks the organization configured: a company that has put its logo on its
 * documents has plainly decided to brand them, and the name beside it is prefilled from signup.
 */
export async function setLogo(bytes: Uint8Array): Promise<OrganizationLetterheadState> {
  if (bytes.byteLength > LOGO_LIMITS.maxBytes) throw new InvalidLetterheadError("That logo is over 1 MB. Try a smaller image.");
  const size = pngDimensions(bytes);
  if (!size) throw new InvalidLetterheadError("The logo has to be a PNG image.");
  if (size.width > LOGO_LIMITS.maxWidth || size.height > LOGO_LIMITS.maxHeight) {
    throw new InvalidLetterheadError(`The logo can be at most ${LOGO_LIMITS.maxWidth} × ${LOGO_LIMITS.maxHeight} pixels.`);
  }

  const organizationId = await currentOrganizationId();
  const supabase = await createClient();
  const path = logoPath(organizationId);

  const upload = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: "image/png", upsert: true });
  // Storage reports a policy refusal as an error, unlike PostgREST's silent zero rows.
  if (upload.error) throw /violat|policy|not allowed|unauthori/i.test(upload.error.message) ? new NotOwnerError() : new LetterheadUnavailableError(upload.error.message);

  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_path: path, logo_width: size.width, logo_height: size.height, letterhead_configured_at: new Date().toISOString() })
    .eq("id", organizationId)
    .select("id");
  if (error) throw new LetterheadUnavailableError(error.message);
  if (!data || data.length === 0) throw new NotOwnerError();
  return stateFor(organizationId);
}

/** Removes the logo: the row first, so a failed object delete leaves a dangling file rather than a dangling pointer. */
export async function removeLogo(): Promise<OrganizationLetterheadState> {
  const organizationId = await currentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .update({ logo_path: null, logo_width: null, logo_height: null })
    .eq("id", organizationId)
    .select("id");
  if (error) throw new LetterheadUnavailableError(error.message);
  if (!data || data.length === 0) throw new NotOwnerError();
  await supabase.storage.from(BUCKET).remove([logoPath(organizationId)]);
  return stateFor(organizationId);
}
