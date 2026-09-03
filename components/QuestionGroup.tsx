import type { GapCheckQuestion } from "@/lib/questions";
import { QuestionField } from "./QuestionField";

/** One labeled group of questions — "Claim Info", "Loss Details", or a room name. */
export function QuestionGroup({
  title,
  questions,
  answers,
  onChange,
  onAddFromSketch,
  canAddFromSketch,
  markedQuestionIds,
}: {
  title: string;
  questions: GapCheckQuestion[];
  answers: Record<string, string>;
  onChange: (id: string, value: string) => void;
  /** Opens the sketch picker for a question. Paired with `canAddFromSketch`, which gates it. */
  onAddFromSketch?: (question: GapCheckQuestion) => void;
  canAddFromSketch?: (question: GapCheckQuestion) => boolean;
  markedQuestionIds?: string[];
}) {
  if (questions.length === 0) return null;
  return (
    <div className="question-group">
      <h3>{title}</h3>
      {questions.map((q) => (
        <QuestionField
          key={q.id}
          question={q}
          value={answers[q.id]}
          onChange={onChange}
          onAddFromSketch={onAddFromSketch && canAddFromSketch?.(q) ? onAddFromSketch : undefined}
          sketchMarked={markedQuestionIds?.includes(q.id)}
        />
      ))}
    </div>
  );
}
