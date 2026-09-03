import type { ClaimInfo } from "./claimInfo";
import { parseBucketCounts, type GapCheckQuestion } from "./questions";

/**
 * What was asked, in the order it was asked, and what came back.
 *
 * ── Why this is recorded rather than derived ────────────────────────────────────────────────────
 *
 * It looks like it should be a view over state the claim already holds, and it cannot be. `answers`
 * is emptied on every Continue and the displayed list is recomputed per round, so a question's TEXT
 * and its POSITION are gone the moment that round is committed. What survives is the extraction
 * tree, which holds the resulting field values — and a field value cannot say whether anyone was
 * asked for it, what wording they saw, or what else was on the screen at the time. Reconstructing a
 * session from it would be a plausible-looking account of something that did not happen.
 *
 * So each committed round appends here. It is append-only and never read back into the claim: it
 * describes the session, and nothing downstream depends on it, which is what keeps it safe to change.
 */

export interface AskedQuestion {
  /** Which round it appeared in, 1-based — the PM's sense of "screens I have been through". */
  round: number;
  /** The room heading it sat under, or null for the claim-level questions. */
  roomName: string | null;
  /** Exactly the wording shown, not a summary of it. */
  prompt: string;
  /** What was entered. Empty string when it was shown but never answered. */
  answer: string;
  /**
   * True when the answer reached the claim.
   *
   * A question can be shown, answered, and then withdrawn within the same round — change "are there
   * windows" to no and the tally that was already filled in stops applying. That is worth seeing in
   * a QA log rather than hiding, because "I answered that and it did not take" is exactly the sort
   * of thing somebody reports.
   */
  applied: boolean;
}

/**
 * An answer as a person would say it, rather than as it is stored.
 *
 * Several question kinds submit a machine format the UI never shows: a yes/no button submits the
 * literal "yes" whatever its label says, and a tally submits `key:count` pairs — which for the
 * consolidated equipment question are keyed by ROOM INDEX, so the stored answer reads `0:2,1:2`.
 * Exporting that verbatim produces a log whose questions are in English and whose answers are not,
 * and the whole point of the export is that somebody can read it.
 *
 * The question carries its own `kind`, so every label needed to render the answer is already here —
 * this is a rendering of the recorded answer, never a second source of truth for it.
 */
function describeAnswer(question: GapCheckQuestion, answer: string): string {
  if (answer === "") return "";
  const kind = question.kind;
  switch (kind.type) {
    case "yesNo":
      // Normalized on submit (see QuestionField.tsx) — map back to the label that was on the button.
      if (answer === "yes") return kind.yesLabel ?? "Yes";
      if (answer === "no") return kind.noLabel ?? "No";
      return answer;
    case "bucketCounts": {
      const counts = parseBucketCounts(answer);
      const parts = kind.buckets
        .filter((b) => (counts[b.key] ?? 0) > 0)
        .map((b) => `${b.label} × ${counts[b.key]}`);
      // A tally answered as all-zero is a real answer ("none anywhere"), not a blank.
      return parts.length > 0 ? parts.join(", ") : `No ${kind.unit}`;
    }
    case "equipmentPlan":
      return answer === "none" ? `No ${kind.unit} required` : `${answer} ${kind.unit}`;
    case "confirmOrSuggest":
      return `${answer} ${kind.unit}`;
    default:
      return answer;
  }
}

/**
 * One round's worth of entries, in the order the questions were on screen.
 *
 * `display` is the rendered list, so its order is literally what the PM saw — not the engine's
 * generation order and not the order answers happened to be applied in.
 */
export function recordRound(
  round: number,
  display: GapCheckQuestion[],
  applied: GapCheckQuestion[],
  answers: Record<string, string>,
): AskedQuestion[] {
  const appliedIds = new Set(applied.map((q) => q.id));
  return display.map((q) => ({
    round,
    roomName: q.roomName,
    prompt: q.prompt,
    // A pre-filled question left untouched was still answered — see `GapCheckQuestion.defaultValue`.
    answer: describeAnswer(q, answers[q.id] ?? q.defaultValue ?? ""),
    applied: appliedIds.has(q.id),
  }));
}

/** Whether anything has been asked yet — the export is offered only once there is something in it. */
export function hasQuestionLog(log: AskedQuestion[]): boolean {
  return log.length > 0;
}

/**
 * The log as plain text.
 *
 * Plain text on purpose: this is read, pasted into a bug report, and diffed against another run.
 * Any format that needs an application to open it is worse at all three.
 */
export function formatQuestionLog(claim: ClaimInfo, log: AskedQuestion[], inFlight: AskedQuestion[] = []): string {
  const lines: string[] = [
    "Scrivn — gap-check questions and answers",
    "",
    `Job number:    ${claim.jobNumber || "—"}`,
    `Customer:      ${claim.customerName || "—"}`,
  ];
  if (claim.claimNumber) lines.push(`Claim number:  ${claim.claimNumber}`);
  if (claim.address) lines.push(`Address:       ${claim.address}`);
  lines.push(`Exported:      ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  lines.push("");

  const entries = [...log, ...inFlight];
  if (entries.length === 0) {
    lines.push("No questions have been asked yet.");
    return lines.join("\n");
  }

  let lastRound: number | null = null;
  let lastRoom: string | null | undefined;
  let seenThisRound = new Set<string>();
  for (const entry of entries) {
    if (entry.round !== lastRound) {
      if (lastRound !== null) lines.push("");
      const committed = log.some((e) => e.round === entry.round);
      lines.push(`── Round ${entry.round}${committed ? "" : " (on screen now, not yet submitted)"} ──`);
      lastRound = entry.round;
      lastRoom = undefined;
      seenThisRound = new Set();
    }
    const room = entry.roomName ?? "Claim-level";
    if (room !== lastRoom) {
      lines.push("");
      /*
        A room comes back around within one round whenever answering something reveals a follow-up —
        the whole list is re-rendered, so the new question lands after everything already on screen.
        The heading is marked rather than merged: merging would put the questions in an order nobody
        saw, and an unmarked repeat reads like a bug in the export rather than the shape of the flow.
      */
      lines.push(`  ${room}${seenThisRound.has(room) ? " (continued)" : ""}`);
      seenThisRound.add(room);
      lastRoom = room;
    }
    lines.push(`    Q: ${entry.prompt}`);
    // The withdrawn case is called out rather than left looking like an ordinary answer.
    lines.push(`    A: ${entry.answer === "" ? "(not answered)" : entry.answer}${entry.applied ? "" : "   [not applied — the question stopped applying before this round was submitted]"}`);
    lines.push("");
  }

  const total = entries.length;
  const unanswered = entries.filter((e) => e.answer === "").length;
  lines.push(`${total} question${total === 1 ? "" : "s"} shown${unanswered > 0 ? `, ${unanswered} left unanswered` : ""}.`);
  return lines.join("\n");
}
