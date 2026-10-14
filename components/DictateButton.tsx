"use client";

import { useDictation } from "@/lib/useDictation";

/**
 * A Dictate button for the walkthrough transcript, in place of finding the keyboard's microphone.
 *
 * The listening itself — the browser's own recognition, the trade vocabulary, the on-device model
 * where the phone has one — is `useDictation` (lib/useDictation.ts), shared with the camera's spoken
 * captions since 2026-10-14. This is the button: it listens until pressed again, through pauses.
 *
 * On a browser with no speech recognition at all the button is simply absent and the keyboard's
 * microphone works as it always did.
 */
export function DictateButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const dictation = useDictation({ onFinal: onText });
  if (!dictation.supported) return null;

  const { status, interim, note } = dictation;
  const listening = status === "listening";
  return (
    <div className="dictate">
      <button
        type="button"
        className={listening ? "btn-primary dictate-button dictate-live" : "btn-secondary dictate-button"}
        onClick={status === "idle" ? () => void dictation.start() : dictation.stop}
        disabled={disabled && status === "idle"}
        aria-pressed={listening}
      >
        <span className="dictate-dot" aria-hidden="true" />
        {status === "preparing" ? "Getting speech ready…" : listening ? "Stop" : "Dictate"}
      </button>
      {listening && <span className="dictate-interim">{interim || "Listening…"}</span>}
      {note && <p className="field-note dictate-note">{note}</p>}
    </div>
  );
}

export { appendDictation } from "@/lib/useDictation";
