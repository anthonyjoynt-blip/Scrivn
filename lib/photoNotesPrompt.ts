/**
 * The photo notes, as the scope step reads them (2026-10-14, stage 2 of the spoken captions plan).
 *
 * A technician says "baseboard wet behind the vanity, about four feet" under a photo, and may have
 * said the same in the walkthrough. The captions are built into a block of their own each time the
 * scope runs (lib/photos.ts, `photoNotes`) — never copied into the transcript, so editing or deleting
 * a caption changes what the next run reads and leaves nothing behind. This is the block, and the one
 * paragraph every prompt that reads it carries: the four extraction calls and the documents call.
 *
 * In the USER message, not the system prompts, on purpose: the system prompts are cached and the
 * same for every claim (lib/anthropic.ts), and a claim with no captions sends exactly what it sent
 * before photos existed. No answer fields change either — calls 1 and 2 have no room for one more —
 * because the notes change only what the model reads, never the shape of what it returns.
 *
 * The rule is the whole point, and was proven on two test claims before release
 * (test/photos/notesLive.mjs): an item said in both places is one item, and an item said only under
 * a photo is still scope.
 */

export const PHOTO_NOTES_RULE = `PHOTO NOTES. The lines under PHOTO NOTES below were said or typed under photos taken on this same site visit, one photo a line: the room it was filed to, the time, then the words. They are part of the same walkthrough as the transcript, not a second visit — read the two together. An item named in both the transcript and a photo note is ONE item: never a second record, a second line or a second quantity for it; where the two give different detail, combine them into that one item. A quantity counts once unless the words clearly mean two different places. An item named only in a photo note is real scope: include it, in the room the note gives — or, where the note says "room not given", in the room its words name.`;

/** The rule and the block, to append to a user message — or nothing at all when there are no notes. */
export function photoNotesSection(photoNotes: string | null | undefined): string {
  const text = (photoNotes ?? "").trim();
  if (!text) return "";
  return `\n\n${PHOTO_NOTES_RULE}\n\nPHOTO NOTES:\n${text}`;
}

/** The longest block a request may carry: 300 photos with captions at their 2,000-character limit, and their lines. */
export const MAX_PHOTO_NOTES_CHARS = 700_000;
