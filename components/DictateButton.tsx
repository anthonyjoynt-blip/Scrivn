"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A Dictate button for the walkthrough transcript, in place of finding the keyboard's microphone.
 *
 * Free: it is the browser's own speech recognition, the same engine the phone keyboard uses, so it
 * adds no provider and no cost per claim. What it adds over the keyboard is the trade vocabulary
 * below. Chrome can be handed a list of phrases to favour ("contextual biasing"), which is exactly
 * the keyboard's weakness on a walkthrough — "shoe mold", "dehu", "flood cut" coming out as
 * everyday words that sound like them. Where the browser supports that only on-device, the
 * on-device model is used (and fetched once if the phone offers it); where it supports neither,
 * the button still dictates, just without the list.
 *
 * On a browser with no speech recognition at all the button is simply absent and the keyboard's
 * microphone works as it always did.
 */

/*
  Words a restoration walkthrough uses that everyday speech does not. Boosted, not forced: a phrase
  here only wins when the audio is close to it, so a long list does not turn ordinary words into
  trade terms. Keep it to things actually said on a walk — every entry nudges every recognition.
*/
const TRADE_PHRASES = [
  "dehu", "dehus", "dehumidifier", "air mover", "air movers", "air scrubber", "negative air",
  "injectidry", "drying mats", "containment", "antimicrobial", "moisture readings",
  "flood cut", "baseboard", "shoe mold", "quarter round", "drywall", "insulation", "fiberglass batt",
  "vapour barrier", "poly", "subfloor", "underlay", "underpad", "carpet pad", "tack strip",
  "vinyl plank", "LVP", "laminate", "hardwood", "engineered", "snaplock", "tile", "grout",
  "toe kick", "kickplate", "countertop", "vanity", "upper cabinets", "lower cabinets",
  "casing", "door jamb", "prehung", "wainscoting", "stipple", "popcorn ceiling", "asbestos",
  "category 1", "category 2", "category 3", "cat 2", "cat 3", "class 2", "class 3",
  "supply line", "hot water tank", "sump pump", "backflow", "sewer backup",
  "linear feet", "square feet", "detach and reset", "tear out", "pack out", "contents",
];
const BOOST = 5;

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  phrases?: unknown[];
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionClass = {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
};

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function phraseObjects(): unknown[] | null {
  const Phrase = (window as unknown as { SpeechRecognitionPhrase?: new (p: string, b: number) => unknown }).SpeechRecognitionPhrase;
  if (!Phrase) return null;
  try {
    return TRADE_PHRASES.map((p) => new Phrase(p, BOOST));
  } catch {
    return null;
  }
}

/** English as the phone speaks it, falling back to the variant every on-device model carries. */
function speechLang(): string {
  const l = typeof navigator !== "undefined" ? navigator.language : "";
  return l.toLowerCase().startsWith("en") ? l : "en-US";
}

type Status = "idle" | "preparing" | "listening";

export function DictateButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [interim, setInterim] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  // Whether the PM still wants to be listened to. Android ends a session on every pause, and a
  // session that ends while this is true is restarted rather than taken as "done".
  const wanted = useRef(false);
  const usePhrases = useRef(true);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => {
    setSupported(recognitionClass() !== null);
    return () => {
      wanted.current = false;
      rec.current?.abort();
    };
  }, []);

  if (!supported) return null;

  async function start() {
    const Rec = recognitionClass();
    if (!Rec) return;
    setNote(null);
    wanted.current = true;
    let lang = speechLang();
    let local = false;

    /*
      On-device where the phone has it — the phrase list may only be honoured there. The phone's own
      English first; a phone set to en-CA may only carry an en-US model, and the vocabulary matters
      more than the spelling of "colour".
    */
    if (Rec.available) {
      for (const candidate of lang === "en-US" ? [lang] : [lang, "en-US"]) {
        try {
          const o = { langs: [candidate], processLocally: true };
          let state = await Rec.available(o);
          if ((state === "downloadable" || state === "downloading") && Rec.install) {
            setStatus("preparing");
            if (await Rec.install(o)) state = "available";
          }
          if (state === "available") {
            lang = candidate;
            local = true;
            break;
          }
        } catch {
          // Try the next, then fall back to the browser's own service.
        }
      }
    }
    if (!wanted.current) return setStatus("idle");
    listen(Rec, lang, local);
  }

  function listen(Rec: RecognitionClass, lang: string, local: boolean) {
    const r = new Rec();
    r.lang = lang;
    // One utterance per session, restarted in onend. Android's continuous mode has a long history of
    // repeating earlier final results, and it ends on a pause anyway.
    r.continuous = false;
    r.interimResults = true;
    if (local) r.processLocally = true;
    if (usePhrases.current) {
      const phrases = phraseObjects();
      if (phrases) {
        try {
          r.phrases = phrases;
        } catch {
          usePhrases.current = false;
        }
      }
    }

    r.onresult = (e) => {
      let heard = "";
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        if (res.isFinal) heard += res[0].transcript;
        else pending += res[0].transcript;
      }
      if (heard.trim()) onTextRef.current(heard.trim());
      setInterim(pending.trim());
    };
    r.onerror = (e) => {
      if (e.error === "phrases-not-supported") {
        // The list is a bonus, never a reason not to dictate.
        usePhrases.current = false;
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      setNote(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The microphone is blocked for Scrivn. Allow it in the browser's site settings, then tap Dictate again."
          : e.error === "network"
            ? "Dictation needs a connection on this phone. The keyboard's microphone may still work offline."
            : `Dictation stopped (${e.error}). Tap Dictate to carry on.`,
      );
    };
    r.onend = () => {
      setInterim("");
      if (wanted.current) {
        listen(Rec, lang, local);
        return;
      }
      rec.current = null;
      setStatus("idle");
    };

    rec.current = r;
    try {
      r.start();
      setStatus("listening");
    } catch {
      wanted.current = false;
      setStatus("idle");
      setNote("Dictation could not start. Tap Dictate to try again.");
    }
  }

  function stop() {
    wanted.current = false;
    if (rec.current) rec.current.stop();
    else setStatus("idle");
  }

  const listening = status === "listening";
  return (
    <div className="dictate">
      <button
        type="button"
        className={listening ? "btn-primary dictate-button dictate-live" : "btn-secondary dictate-button"}
        onClick={status === "idle" ? start : stop}
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

/** Adds a dictated stretch to what is already there, one space between, never a doubled one. */
export function appendDictation(existing: string, spoken: string): string {
  if (!existing.trim()) return spoken;
  return /\s$/.test(existing) ? existing + spoken : `${existing} ${spoken}`;
}
