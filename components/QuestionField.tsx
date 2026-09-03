"use client";

import { useState } from "react";
import { type GapCheckQuestion, formatBucketCounts, parseBucketCounts } from "@/lib/questions";

/**
 * Renders one follow-up question's input, keyed off `question.kind` — the component never needs
 * to know which `WaterLossExtraction` field it's collecting a value for, only how to render and
 * validate the shape (`gapCheck.ts`'s `applyAnswer` does the field-specific interpretation).
 */
export function QuestionField({
  question,
  value: rawValue,
  onChange,
  onAddFromSketch,
  sketchMarked,
  applyToAllCount,
  onApplyToAll,
}: {
  question: GapCheckQuestion;
  value: string | undefined;
  onChange: (id: string, value: string) => void;
  /**
   * Offered only for questions the sketch can measure, and only when there is a sketch to measure.
   * Absent otherwise, so the button never appears where it could not do anything.
   */
  onAddFromSketch?: (question: GapCheckQuestion) => void;
  /** True once this question has a marking, so the button says so rather than repeating itself. */
  sketchMarked?: boolean;
  /**
   * How many OTHER rooms are waiting on this same question, when it is one whose answer is usually
   * the same throughout a property. Absent where it is not, or where there are no other rooms.
   */
  applyToAllCount?: number;
  onApplyToAll?: (question: GapCheckQuestion) => void;
}) {
  const { kind } = question;
  // A pre-filled value shows until the PM types over it — see `GapCheckQuestion.defaultValue`.
  const value = rawValue ?? question.defaultValue;
  // Computed as plain ternaries (not accessed from inside a later closure) so this doesn't rely
  // on discriminated-union narrowing surviving into a nested .map() callback.
  //
  // The submitted `value` is always the normalized "yes"/"no" — never the display label. A custom
  // yesLabel/noLabel (e.g. "Detaching" / "Staying in place") changes what the button *says*, not
  // what gets sent to gapCheck.ts's applyAnswer, which always tests for literal "yes"/"no" via
  // isYes(). Submitting the label text itself here was a real bug (found round 6): any custom
  // label silently submitted an answer isYes() would always read as false.
  const yesNoOptions = kind.type === "yesNo" ? [{ value: "yes", label: kind.yesLabel ?? "Yes" }, { value: "no", label: kind.noLabel ?? "No" }] : [];

  return (
    <div className="question">
      <label className="prompt" htmlFor={question.id}>
        {question.prompt}
      </label>

      {onAddFromSketch && (
        <button type="button" className="add-from-sketch" onClick={() => onAddFromSketch(question)}>
          {sketchMarked ? "Edit sketch marking" : "Add from sketch"}
        </button>
      )}

      {kind.type === "yesNo" && (
        <div className="option-group" role="radiogroup" aria-label={question.prompt}>
          {yesNoOptions.map(({ value: optionValue, label }) => (
            <button
              key={optionValue}
              type="button"
              className={`option-btn${value === optionValue ? " selected" : ""}`}
              aria-pressed={value === optionValue}
              onClick={() => onChange(question.id, optionValue)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {kind.type === "choice" && (
        <div className="option-group" role="radiogroup" aria-label={question.prompt}>
          {kind.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`option-btn${value === option ? " selected" : ""}`}
              aria-pressed={value === option}
              onClick={() => onChange(question.id, option)}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {kind.type === "confirmOrSuggest" && (
        <div className="option-group" role="radiogroup" aria-label={question.prompt}>
          {/* The PM's own number first: keeping it is the default reading, not the fallback. */}
          <button
            type="button"
            className={`option-btn${value === "keep" ? " selected" : ""}`}
            aria-pressed={value === "keep"}
            onClick={() => onChange(question.id, "keep")}
          >
            Keep {kind.stated} {kind.unit}
          </button>
          <button
            type="button"
            className={`option-btn${value === "adopt" ? " selected" : ""}`}
            aria-pressed={value === "adopt"}
            onClick={() => onChange(question.id, "adopt")}
          >
            Use {kind.suggested} {kind.unit}
          </button>
        </div>
      )}

      {kind.type === "equipmentPlan" && (
        <div className="equipment-plan">
          <div className="option-group" role="group" aria-label={question.prompt}>
            <button
              type="button"
              className={`option-btn${value === String(kind.suggested) ? " selected" : ""}`}
              aria-pressed={value === String(kind.suggested)}
              onClick={() => onChange(question.id, String(kind.suggested))}
            >
              Use {kind.suggested} {kind.unit}
            </button>
            <button
              type="button"
              className={`option-btn${value === "none" ? " selected" : ""}`}
              aria-pressed={value === "none"}
              onClick={() => onChange(question.id, "none")}
            >
              None required
            </button>
          </div>
          {/* A recommendation is not a decision — a different number stays one field away. */}
          <label className="equipment-plan-other">
            <span>Or enter a different number</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={value === "none" || value === String(kind.suggested) ? "" : value}
              onChange={(e) => onChange(question.id, e.target.value)}
            />
          </label>
        </div>
      )}

      {kind.type === "text" && (
        <input
          id={question.id}
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(question.id, e.target.value)}
        />
      )}

      {kind.type === "wholeNumber" && (
        <input
          id={question.id}
          type="number"
          inputMode="numeric"
          step={1}
          value={value ?? ""}
          onChange={(e) => onChange(question.id, e.target.value)}
        />
      )}

      {kind.type === "decimal" && (
        <input
          id={question.id}
          type="number"
          inputMode="decimal"
          step="any"
          value={value ?? ""}
          onChange={(e) => onChange(question.id, e.target.value)}
        />
      )}

      {kind.type === "bucketCounts" && (
        <BucketCountsField question={question} buckets={kind.buckets} unit={kind.unit} value={value} onChange={onChange} />
      )}

      {/*
        Offered only once there is an answer to copy, and never as a default.

        A property is usually trimmed at one baseboard height throughout, so this saves typing the
        same number in every room — but "usually" is why it stays an offer. Declining costs nothing,
        each copy lands as an ordinary answer, and any room that genuinely differs is changed after.
      */}
      {onApplyToAll && applyToAllCount !== undefined && applyToAllCount > 0 && isQuestionAnswered(question, rawValue) && (
        <button type="button" className="apply-to-all" onClick={() => onApplyToAll(question)}>
          Apply this to the other {applyToAllCount} {applyToAllCount === 1 ? "room" : "rooms"}
        </button>
      )}
    </div>
  );
}

/**
 * A count against each bucket, entered side by side.
 *
 * Laid out as one row per bucket so the whole tally is visible at once — the point of asking this
 * way rather than "how many?" then "what size?" is that the PM can see the room and fill in what
 * they see, in any order, without the tool deciding they are all the same.
 *
 * Blank and zero are the same answer here and both mean "none of this size". The question counts as
 * answered once ANY bucket has a number, including a deliberate set of zeroes — see
 * `isQuestionAnswered`, which has to agree with this or Continue and the form disagree on screen.
 */
function BucketCountsField({
  question,
  buckets,
  unit,
  value,
  onChange,
}: {
  question: GapCheckQuestion;
  buckets: { key: string; label: string }[];
  unit: string;
  value: string | undefined;
  onChange: (id: string, value: string) => void;
}) {
  const counts = parseBucketCounts(value ?? "");
  // Kept separately from `counts` so a typed "0" survives the round trip: `formatBucketCounts` drops
  // zeroes (they are not work), but the field the PM typed it into must not blank itself out.
  const [touched, setTouched] = useState<Record<string, string>>({});

  function update(key: string, raw: string) {
    setTouched((prev) => ({ ...prev, [key]: raw }));
    const n = Number(raw);
    const next = { ...counts, [key]: Number.isInteger(n) && n > 0 ? n : 0 };
    onChange(question.id, formatBucketCounts(next));
  }

  return (
    <div className="bucket-counts">
      {buckets.map((bucket) => (
        <label key={bucket.key} className="bucket-counts-row">
          <span className="bucket-counts-label">{bucket.label}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            aria-label={`${bucket.label} — how many ${unit}`}
            value={touched[bucket.key] ?? (counts[bucket.key] ? String(counts[bucket.key]) : "")}
            onChange={(e) => update(bucket.key, e.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

/** Whether `value` is an acceptable answer for `question` — used to gate the "Continue" button. */
export function isQuestionAnswered(question: GapCheckQuestion, rawValue: string | undefined): boolean {
  // An untouched pre-filled question is answered: confirming a derived value is doing nothing.
  const value = rawValue ?? question.defaultValue;
  /*
    A tally answered entirely in zeroes is a real answer — "none of any size" — and its formatted
    form is the empty string, which the blank check above would otherwise reject for ever. The
    presence of the key in the answers map is what separates "typed all zeroes" from "not touched".
  */
  if (question.kind.type === "bucketCounts") return rawValue !== undefined;
  if (value === undefined || value.trim() === "") return false;
  if (question.kind.type === "wholeNumber") return Number.isInteger(Number(value));
  if (question.kind.type === "decimal") return Number.isFinite(Number(value));
  return true;
}
