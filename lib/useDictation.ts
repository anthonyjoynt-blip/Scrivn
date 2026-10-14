"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The browser's own speech recognition, as a hook (2026-10-14) — shared by the transcript's Dictate
 * button (components/DictateButton.tsx) and the camera's spoken captions (components/photos).
 *
 * Free: it is the same engine the phone keyboard uses, so it adds no provider and no cost per claim,
 * and Scrivn receives text only — no audio is recorded or sent anywhere by Scrivn. What it adds over
 * the keyboard is the trade vocabulary below. Chrome can be handed a list of phrases to favour
 * ("contextual biasing"), which is exactly the keyboard's weakness on a walkthrough — "shoe mold",
 * "dehu", "flood cut" coming out as everyday words that sound like them. Where the browser supports
 * that only on-device, the on-device model is used (and fetched once if the phone offers it); where
 * it supports neither, dictation still works, just without the list.
 *
 * Two ways to end. The transcript listens until its button is pressed again — Android ends a session
 * on every pause, and a session that ends while still wanted is restarted. A caption listens until
 * the speaker stops (`endAfterQuietMs`), or gives up when nothing is said at all (`giveUpAfterMs`).
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

export function dictationSupported(): boolean {
  return recognitionClass() !== null;
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

export type DictationStatus = "idle" | "preparing" | "listening";
/** Why listening ended: asked to, the speaker stopped, nothing was said, or it could not go on. */
export type DictationEnd = "stopped" | "quiet" | "nothing-heard" | "error";

export interface DictationOptions {
  /** Each stretch of speech once the recognizer is sure of it. */
  onFinal: (text: string) => void;
  onEnd?: (why: DictationEnd) => void;
  /** End this long after the last word heard. Unset: listen until `stop`. */
  endAfterQuietMs?: number;
  /** With `endAfterQuietMs`: end if nothing at all has been heard this long after starting. */
  giveUpAfterMs?: number;
}

export interface Dictation {
  supported: boolean;
  status: DictationStatus;
  /** Words heard and not yet final. */
  interim: string;
  /** Why it stopped, when that needs saying — a blocked microphone, no signal. */
  note: string | null;
  /** The note was "needs a connection": the keyboard is the way to caption with no signal. */
  needsSignal: boolean;
  start: () => Promise<void>;
  /** Stop listening; what was being said is still delivered as final. */
  stop: () => void;
  /** Stop at once, dropping anything not yet final. Resolves when the recognizer has let go. */
  abort: () => Promise<void>;
}

export function useDictation(options: DictationOptions): Dictation {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [needsSignal, setNeedsSignal] = useState(false);
  const rec = useRef<Recognition | null>(null);
  // Whether we still want to be listened to. Android ends a session on every pause, and a session
  // that ends while this is true is restarted rather than taken as "done".
  const wanted = useRef(false);
  const usePhrases = useRef(true);
  const opts = useRef(options);
  opts.current = options;
  const heardAny = useRef(false);
  const endWhy = useRef<DictationEnd>("stopped");
  const quietTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ended = useRef<(() => void) | null>(null);
  /**
   * Words heard but not yet final when a session ends. Chrome usually finalizes them on `stop`, but not
   * always — a session Android ends on a pause can take them with it. Said is said: they are delivered
   * as final, except after `abort`, whose caller has already kept what it wanted.
   */
  const waitingWords = useRef("");
  const aborting = useRef(false);

  const clearTimers = () => {
    if (quietTimer.current) clearTimeout(quietTimer.current);
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    quietTimer.current = null;
    giveUpTimer.current = null;
  };

  const finish = useCallback((why: DictationEnd) => {
    endWhy.current = why;
    wanted.current = false;
    clearTimers();
    if (rec.current) rec.current.stop();
    else {
      setStatus("idle");
      opts.current.onEnd?.(why);
    }
  }, []);

  useEffect(() => {
    setSupported(recognitionClass() !== null);
    return () => {
      wanted.current = false;
      clearTimers();
      rec.current?.abort();
    };
  }, []);

  const heard = useCallback(() => {
    heardAny.current = true;
    const quiet = opts.current.endAfterQuietMs;
    if (quiet === undefined) return;
    if (giveUpTimer.current) clearTimeout(giveUpTimer.current);
    giveUpTimer.current = null;
    if (quietTimer.current) clearTimeout(quietTimer.current);
    quietTimer.current = setTimeout(() => finish("quiet"), quiet);
  }, [finish]);

  const listen = useCallback(
    (Rec: RecognitionClass, lang: string, local: boolean) => {
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
        if (rec.current !== r) return;
        let final = "";
        let pending = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          if (res.isFinal) final += res[0].transcript;
          else pending += res[0].transcript;
        }
        if (final.trim()) opts.current.onFinal(final.trim());
        setInterim(pending.trim());
        waitingWords.current = pending.trim();
        if (final.trim() || pending.trim()) heard();
      };
      r.onerror = (e) => {
        if (e.error === "phrases-not-supported") {
          // The list is a bonus, never a reason not to dictate.
          usePhrases.current = false;
          return;
        }
        if (e.error === "no-speech" || e.error === "aborted") return;
        wanted.current = false;
        endWhy.current = "error";
        setNeedsSignal(e.error === "network");
        setNote(
          e.error === "not-allowed" || e.error === "service-not-allowed"
            ? "The microphone is blocked for Scrivn. Allow it in the browser's site settings, then try again."
            : e.error === "network"
              ? "Speech needs a connection on this phone. Type instead — the keyboard's microphone may still work offline."
              : `Dictation stopped (${e.error}).`,
        );
      };
      r.onend = () => {
        if (rec.current !== r) return;
        setInterim("");
        const leftOver = waitingWords.current;
        waitingWords.current = "";
        if (leftOver && !aborting.current) opts.current.onFinal(leftOver);
        if (wanted.current) {
          listen(Rec, lang, local);
          return;
        }
        rec.current = null;
        clearTimers();
        setStatus("idle");
        const resolve = ended.current;
        ended.current = null;
        resolve?.();
        opts.current.onEnd?.(endWhy.current);
      };

      rec.current = r;
      try {
        r.start();
        setStatus("listening");
      } catch {
        wanted.current = false;
        rec.current = null;
        setStatus("idle");
        setNote("Dictation could not start. Try again.");
        opts.current.onEnd?.("error");
      }
    },
    [heard],
  );

  const start = useCallback(async () => {
    const Rec = recognitionClass();
    if (!Rec) return;
    setNote(null);
    setNeedsSignal(false);
    setInterim("");
    waitingWords.current = "";
    aborting.current = false;
    wanted.current = true;
    heardAny.current = false;
    endWhy.current = "stopped";
    clearTimers();
    let lang = speechLang();
    let local = false;

    /*
      On-device where the phone has it — the phrase list may only be honoured there, and it is the
      only way to dictate with no signal. The phone's own English first; a phone set to en-CA may only
      carry an en-US model, and the vocabulary matters more than the spelling of "colour".
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
    if (!wanted.current) {
      setStatus("idle");
      return;
    }
    const giveUp = opts.current.giveUpAfterMs;
    if (opts.current.endAfterQuietMs !== undefined && giveUp !== undefined) {
      giveUpTimer.current = setTimeout(() => {
        if (!heardAny.current) finish("nothing-heard");
      }, giveUp);
    }
    listen(Rec, lang, local);
  }, [finish, listen]);

  const stop = useCallback(() => finish("stopped"), [finish]);

  const abort = useCallback(() => {
    wanted.current = false;
    aborting.current = true;
    waitingWords.current = "";
    clearTimers();
    setInterim("");
    const r = rec.current;
    if (!r) {
      setStatus("idle");
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      // Android can take a moment to let the microphone go; a new session started before then is refused.
      const fallback = setTimeout(() => {
        if (rec.current === r) rec.current = null;
        setStatus("idle");
        resolve();
      }, 600);
      ended.current = () => {
        clearTimeout(fallback);
        resolve();
      };
      endWhy.current = "stopped";
      r.abort();
    });
  }, []);

  return { supported, status, interim, note, needsSignal, start, stop, abort };
}

/** Adds a dictated stretch to what is already there, one space between, never a doubled one. */
export function appendDictation(existing: string, spoken: string): string {
  if (!existing.trim()) return spoken;
  return /\s$/.test(existing) ? existing + spoken : `${existing} ${spoken}`;
}
