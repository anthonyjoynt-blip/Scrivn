"use client";

/**
 * Drop a sketch or scope (2026-11-12; Drop a sketch since 2026-11-05): photos or a PDF of what an estimator wrote on
 * site, back as a scaled plan and a tidied scope, with a gap check as a step of its own after.
 *
 * Each page dropped is a sketch, a scope or both (lib/dropPages.ts):
 * - The sketch side is the page as it was before scopes. Anyone can trace one: Scrivn finds the rooms in the photo
 *   itself (lib/handSketchBoxes.ts, in the browser: no AI, nothing spent, the photo sent nowhere), and the person names
 *   them and types the numbers. A signed-in user has Scrivn read it instead (/api/hand-sketch/read) and checks that
 *   reading in the same tracer. Either way the build is lib/handSketch.ts and its questions are answered in the review.
 *   Every page's rooms make one plan.
 * - The scope side is read for a signed-in user only (/api/scope-upload/read, the claims' Upload a scope reader), and
 *   tidied room by room against the plan (lib/tidyScope.ts) into a document to check, change and download.
 * - Gap check (signed in) opens a new claim with the plan's rooms and the scope in its notes, as an uploaded scope's
 *   block: the claim's own Generate then runs the extraction, the questions and the documents as it always does.
 *
 * Kept in this browser as it goes (lib/dropDraftStore.ts), so a reload or a sign-in in the middle loses nothing. A
 * page leaves the browser only to be read, and is not kept anywhere once it has been.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isNetworkFailure, netFetch } from "@/lib/connectivity";
import { loadDropDraft, saveDropDraft } from "@/lib/dropDraftStore";
import { afterScopeRead, combineSketches, draftToKeep, holdsWords, newPage, scopeLines, scopePagesIn, type DropDraft, type DropPage, type PageSketch } from "@/lib/dropPages";
import { buildFromRead, type HandSketchBuild, type HandSketchQuestion, type HandSketchRead } from "@/lib/handSketch";
import { newHandoffToken, writeHandoff } from "@/lib/handSketchClaim";
import { drawSample, drawSampleScope } from "@/lib/handSketchSample";
import { answerQuestion, emptyTrace, foundToTrace, openQuestions, readToTrace, traceToRead, type HandSketchAnswer, type TraceState } from "@/lib/handSketchTrace";
import { type MoistureMap, emptyMoistureMap } from "@/lib/moisture";
import { canvasJpeg, decodeImage, drawScaled } from "@/lib/photoImage";
import { quantityRows } from "@/lib/scanEditor";
import { SCOPE_UPLOAD_MAX_BYTES, type ScopePageRead } from "@/lib/scopeUpload";
import { type Sketch, emptySketch } from "@/lib/sketch";
import { tidyLineCount, tidyScope, tidyToNotes, tidyFlaggedCount, type TidyScope } from "@/lib/tidyScope";
import { canShareFiles, drawPlanPicture, makePlanFiles, type MadeFile, saveFile, shareFiles } from "./planFiles";
import { Review } from "./Review";
import { ScopeDoc } from "./ScopeDoc";
import { Tracer } from "./Tracer";
import styles from "./handSketch.module.css";

const SketchEditor = dynamic(() => import("@/components/sketch/SketchEditor").then((m) => m.SketchEditor), { ssr: false });

/** The long side a photo is traced on and its sketch read at: the model's own working size, and what its corners are measured in. */
const PHOTO_EDGE = 1400;
/**
 * The long side a page is read for its scope at (small print on a phone photo stays legible, as the claims' Upload a
 * scope sends it), and looked through for rooms at (thin pen lines stay dark enough to find).
 */
const PAGE_EDGE = 2000;
/** Under this a page goes up as it is shrunk; over it, the JPEG's quality steps down. */
const PAGE_TARGET_BYTES = 2_000_000;
/** Scope pages read at once. */
const AT_ONCE = 3;

type Open = { id: string; stage: "trace" | "review" | "edit" };
type Found = { rooms: { corners: { x: number; y: number }[] }[]; swings: { hinge: { x: number; y: number }; tip: { x: number; y: number } }[] };

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

let pageCount = 0;
const nextPageId = () => `p${Date.now().toString(36)}${(++pageCount).toString(36)}`;

/** A photo of a page as a JPEG small enough to send. */
async function pageJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await canvasJpeg(canvas, 0.85);
  for (const quality of [0.7, 0.55]) {
    if (blob.size <= PAGE_TARGET_BYTES) break;
    blob = await canvasJpeg(canvas, quality);
  }
  return blob;
}

/** The rooms Scrivn finds in a page, in the browser, in the traced photo's pixels; null when it finds none. */
async function findRooms(canvas: HTMLCanvasElement, photo: { width: number }): Promise<Found | null> {
  const { findBoxes } = await import("@/lib/handSketchBoxes");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const found = findBoxes({ width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data });
  if (found.rooms.length === 0) return null;
  // Back into the traced photo's pixels, which everything else is in.
  const k = photo.width / canvas.width;
  const at = (c: { x: number; y: number }) => ({ x: Math.round(c.x * k), y: Math.round(c.y * k) });
  return { rooms: found.rooms.map((r) => ({ corners: r.corners.map(at) })), swings: found.swings.map((s) => ({ hinge: at(s.hinge), tip: at(s.tip) })) };
}

/** The review's read written back onto the trace, so going back to the photo keeps the answers. */
function traceWithRead(trace: TraceState, read: HandSketchRead): TraceState {
  let k = 0;
  return {
    ...trace,
    rotate: read.rotate,
    rooms: trace.rooms.map((r) => {
      if (!r.closed) return r;
      const got = read.rooms[k++];
      if (!got) return r;
      return { ...r, name: got.name, ceiling: got.ceiling, lengths: got.walls.map((w) => w.length), openings: got.openings, items: got.items, guess: got.guess };
    }),
  };
}

const dataUrlFile = async (dataUrl: string, name: string) => new File([await (await fetch(dataUrl)).blob()], name, { type: "image/jpeg" });

export function DropASketch({
  signedIn,
  canReadSketch,
  canReadScope,
  sketchReadsOn,
  scopeReadsOn,
  dev,
}: {
  signedIn: boolean;
  canReadSketch: boolean;
  canReadScope: boolean;
  sketchReadsOn: boolean;
  scopeReadsOn: boolean;
  dev: boolean;
}) {
  const [pages, setPages] = useState<DropPage[]>([]);
  const [blobs, setBlobs] = useState<Record<string, Blob>>({});
  /** The scope as the person changed it; null while it is Scrivn's tidying of the pages as they stand. */
  const [doc, setDoc] = useState<TidyScope | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [editing, setEditing] = useState<Sketch>(emptySketch());
  const [moisture, setMoisture] = useState<MoistureMap>(emptyMoistureMap());
  const [saved, setSaved] = useState<DropDraft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [claims, setClaims] = useState<{ id: string; label: string }[] | null>(null);
  const [mounted, setMounted] = useState(false);

  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  /** The first page to need checking after a drop opens by itself; the rest wait on the page's list. */
  const autoOpen = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    setMounted(true);
    void loadDropDraft().then(setSaved);
  }, []);

  // Kept as it goes (a moment after each change), and cleared on Start again.
  useEffect(() => {
    if (pages.length === 0) return;
    const t = setTimeout(() => void saveDropDraft(draftToKeep(pages, blobs, doc)), 500);
    return () => clearTimeout(t);
  }, [pages, blobs, doc]);

  // Nothing behind a full-screen step scrolls.
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, [open]);

  const patch = useCallback((id: string, fn: (p: DropPage) => DropPage) => setPages((ps) => ps.map((p) => (p.id === id ? fn(p) : p))), []);

  /* ── The plan: every checked page's rooms, side by side ─────────────────────────────────────────── */

  // A read is built once: the build makes fresh room ids, and the plan should not change under the person while
  // nothing about it has.
  const builds = useRef(new WeakMap<HandSketchRead, { build: HandSketchBuild; sketch: Sketch }>());
  const builtOf = useCallback((read: HandSketchRead) => {
    let b = builds.current.get(read);
    if (!b) {
      const build = buildFromRead(read);
      b = { build, sketch: { ...emptySketch(), rooms: build.rooms } };
      builds.current.set(read, b);
    }
    return b;
  }, []);
  const buildOf = useCallback((read: HandSketchRead) => builtOf(read).build, [builtOf]);
  const pageSketchOf = useCallback((p: DropPage): Sketch | null => (p.edited ? p.edited : p.read ? builtOf(p.read).sketch : null), [builtOf]);
  const sketchParts = pages.filter((p) => p.sketch === "ready").map((p) => ({ pageId: p.id, sketch: pageSketchOf(p) })).filter((x): x is PageSketch => x.sketch !== null);
  const partsKey = sketchParts.map((x) => x.pageId).join("|");
  const lastParts = useRef<{ parts: PageSketch[]; out: ReturnType<typeof combineSketches> } | null>(null);
  const combined = useMemo(() => {
    const last = lastParts.current;
    if (last && last.parts.length === sketchParts.length && last.parts.every((x, i) => x.pageId === sketchParts[i]?.pageId && x.sketch === sketchParts[i]?.sketch)) return last.out;
    const out = combineSketches(sketchParts);
    lastParts.current = { parts: sketchParts, out };
    return out;
    // The parts are compared one by one above; their key and the pages are what can change them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partsKey, pages]);
  const plan = combined.sketch;
  const planRows = useMemo(() => (plan.rooms.length ? quantityRows(plan, 0).rows : []), [plan]);

  /* ── The scope: every read page, tidied against the plan ────────────────────────────────────────── */

  const tidied = useMemo(() => {
    const ins = scopePagesIn(pages, combined.names);
    return ins.length ? tidyScope(ins, plan.rooms.map((r) => r.name)) : null;
  }, [pages, combined, plan]);
  const shownDoc = doc ?? tidied;
  // Changed by the person, then a page read or checked since: what it was made from is not what is there now.
  const stale = !!doc && !!tidied && (doc.pages !== tidied.pages || doc.files.join("|") !== tidied.files.join("|"));

  /* ── Reading ──────────────────────────────────────────────────────────────────────────────────── */

  const scopeQueue = useRef<string[]>([]);
  const scopeRunning = useRef(0);

  const readScope = useCallback(
    async (id: string) => {
      const page = pagesRef.current.find((p) => p.id === id);
      if (!page) return;
      patch(id, (p) => ({ ...p, scope: "reading", scopeError: null }));
      try {
        // A page from before pages were kept as files (one sketch, 2026-11-05) is read off its traced copy.
        const blob = blobsRef.current[id] ?? (page.photo ? await (await fetch(page.photo.url)).blob() : null);
        if (!blob) throw new Error("gone");
        const index = pagesRef.current.findIndex((p) => p.id === id);
        const form = new FormData();
        form.append("file", blob, page.kind === "pdf" ? page.file : `${page.file.replace(/\.[a-z0-9]+$/i, "")}.jpg`);
        form.append("page", String(index + 1));
        form.append("pages", String(pagesRef.current.length));
        const response = await netFetch("/api/scope-upload/read", { method: "POST", body: form, timeoutMs: 150_000 });
        const json = (await response.json().catch(() => null)) as { read?: ScopePageRead; error?: string } | null;
        if (response.ok && json?.read) {
          const read = json.read;
          patch(id, (p) => afterScopeRead(p, read));
          return;
        }
        const signIn = response.status === 401;
        patch(id, (p) => ({ ...p, scope: signIn ? "unread" : "failed", scopeError: signIn ? "Sign in to have Scrivn read it." : json?.error || "It could not be read just now. Try it again." }));
      } catch (err) {
        patch(id, (p) => ({ ...p, scope: "failed", scopeError: isNetworkFailure(err) ? "No signal reached Scrivn, or the read took too long. Try it again." : "It could not be read. Try it again." }));
      }
    },
    [patch],
  );

  const pump = useCallback(() => {
    while (scopeRunning.current < AT_ONCE && scopeQueue.current.length > 0) {
      const id = scopeQueue.current.shift() as string;
      scopeRunning.current++;
      void readScope(id).finally(() => {
        scopeRunning.current--;
        pump();
      });
    }
  }, [readScope]);

  const queueScope = useCallback(
    (ids: string[]) => {
      for (const id of ids) if (!scopeQueue.current.includes(id)) scopeQueue.current.push(id);
      // Shown as waiting at once, so the list says what is coming.
      setPages((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, scope: "reading", scopeError: null } : p)));
      pump();
    },
    [pump],
  );

  const readSketch = useCallback(
    async (id: string) => {
      const page = pagesRef.current.find((p) => p.id === id);
      const photo = page?.photo;
      if (!photo) return;
      patch(id, (p) => ({ ...p, sketch: "reading", sketchError: null }));
      try {
        const res = await netFetch("/api/hand-sketch/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: photo.url.split(",")[1] ?? "", width: photo.width, height: photo.height }),
          timeoutMs: 90_000,
        });
        const body = (await res.json().catch(() => ({}))) as { read?: HandSketchRead; error?: string };
        if (!res.ok || !body.read) {
          const why = res.status === 401 ? "Sign in to have Scrivn read it, or trace it yourself." : (body.error ?? "Scrivn could not read the sketch. You can trace it yourself.");
          // The rooms Scrivn found on its own, when it did, are still there to name and size.
          patch(id, (p) => ({ ...p, sketch: p.trace && p.trace.rooms.length > 0 ? "check" : "failed", sketchError: why }));
          return;
        }
        // Its numbers checked first, one wall at a time on the photo (Right, or fix it); then the plan they make.
        const trace = readToTrace(body.read, { width: photo.width, height: photo.height });
        patch(id, (p) => ({ ...p, sketch: "check", trace, read: null, edited: null, dismissed: [], sketchError: null }));
        if (autoOpen.current && !openRef.current) {
          autoOpen.current = false;
          setOpen({ id, stage: "trace" });
        }
      } catch (err) {
        patch(id, (p) => ({
          ...p,
          sketch: p.trace && p.trace.rooms.length > 0 ? "check" : "failed",
          sketchError: isNetworkFailure(err) ? "Scrivn could not be reached. You can trace the sketch yourself." : "Scrivn could not read the sketch. You can trace it yourself.",
        }));
      }
    },
    [patch],
  );

  /** Look for rooms again on a page (no AI): when the person says it has a sketch Scrivn did not find. */
  const findAgain = async (page: DropPage) => {
    if (!page.photo) return;
    setBusy("Finding the rooms in your sketch…");
    try {
      await new Promise((r) => setTimeout(r, 30)); // let the line above show before the work holds the page
      const blob = blobs[page.id] ?? (await (await fetch(page.photo.url)).blob());
      const canvas = drawScaled(await decodeImage(blob), PAGE_EDGE);
      const found = await findRooms(canvas, page.photo);
      const trace = found ? foundToTrace(found.rooms, { width: page.photo.width, height: page.photo.height }, found.swings) : emptyTrace(page.photo.width, page.photo.height);
      patch(page.id, (p) => ({ ...p, sketch: "check", trace, read: null, edited: null, dismissed: [], sketchError: found ? null : "Scrivn could not find the rooms. Trace them yourself: tap each room's corners in order." }));
      setOpen({ id: page.id, stage: "trace" });
    } catch {
      patch(page.id, (p) => ({ ...p, sketch: "check", trace: emptyTrace(page.photo?.width ?? 1, page.photo?.height ?? 1) }));
      setOpen({ id: page.id, stage: "trace" });
    } finally {
      setBusy(null);
    }
  };

  /** What happens to new pages: their scopes read where Scrivn can, their sketches read or opened to trace. */
  const work = useCallback(
    (made: DropPage[]) => {
      if (canReadScope) queueScope(made.filter((p) => p.scope === "unread").map((p) => p.id));
      const sketches = made.filter((p) => p.sketch === "check" && p.photo);
      autoOpen.current = sketches.length > 0;
      if (canReadSketch) {
        for (const p of sketches) void readSketch(p.id);
      } else if (sketches[0] && !openRef.current) {
        autoOpen.current = false;
        setOpen({ id: sketches[0].id, stage: "trace" });
      }
    },
    [canReadScope, canReadSketch, queueScope, readSketch],
  );

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    setSaved(null);
    setBusy(files.length > 1 ? `Getting ${files.length} pages ready…` : "Getting the page ready…");
    await new Promise((r) => setTimeout(r, 30));
    const made: DropPage[] = [];
    const madeBlobs: Record<string, Blob> = {};
    const problems: string[] = [];
    const before = pagesRef.current.length;
    for (const [i, file] of files.entries()) {
      const id = nextPageId();
      const name = file.name || `Page ${before + i + 1}`;
      if (isPdf(file)) {
        const page = newPage(id, name, "pdf", null);
        if (file.size > SCOPE_UPLOAD_MAX_BYTES) {
          page.scope = "failed";
          page.scopeError = `${(file.size / 1e6).toFixed(1)} MB, and Scrivn reads PDFs up to ${(SCOPE_UPLOAD_MAX_BYTES / 1e6).toFixed(1)} MB. Save it with only the scope's pages and drop that.`;
        } else madeBlobs[id] = file;
        made.push(page);
        continue;
      }
      try {
        const original = await decodeImage(file);
        const big = drawScaled(original, PAGE_EDGE);
        const small = drawScaled(original, PHOTO_EDGE);
        if (typeof ImageBitmap !== "undefined" && original instanceof ImageBitmap) original.close();
        const photo = { url: small.toDataURL("image/jpeg", 0.85), width: small.width, height: small.height };
        madeBlobs[id] = await pageJpeg(big);
        const page = newPage(id, name, "photo", photo);
        let found: Found | null = null;
        try {
          found = await findRooms(big, photo);
        } catch {
          // Not looked through: the person can still say it has a sketch.
        }
        if (found) {
          page.sketch = "check";
          page.trace = foundToTrace(found.rooms, { width: photo.width, height: photo.height }, found.swings);
        }
        made.push(page);
      } catch {
        problems.push(`${name} could not be opened. Try another photo, or take one.`);
      }
    }
    setPages((ps) => [...ps, ...made]);
    setBlobs((b) => ({ ...b, ...madeBlobs }));
    setBusy(null);
    if (problems.length) setError(problems.join(" "));
    // Once the pages are in the list, so a read's answer has a page to land on.
    setTimeout(() => work(made), 0);
  };

  const addSample = async (kind: "sketch" | "scope") => {
    const s = kind === "sketch" ? drawSample() : drawSampleScope();
    await addFiles([await dataUrlFile(s.dataUrl, kind === "sketch" ? "sample-sketch.jpg" : "sample-scope.jpg")]);
  };

  /* ── One page's sketch ────────────────────────────────────────────────────────────────────────── */

  const toReview = useCallback(
    (id: string, t: TraceState) => {
      patch(id, (p) => ({ ...p, trace: t, read: traceToRead(t), edited: null, sketch: "ready" }));
      setOpen({ id, stage: "review" });
    },
    [patch],
  );

  const answer = (page: DropPage, q: HandSketchQuestion, a: HandSketchAnswer) => {
    if (!page.read || !page.trace) return;
    const next = answerQuestion(page.read, q, a, page.dismissed);
    patch(page.id, (p) => ({ ...p, read: next.read, dismissed: next.dismissed, trace: p.trace ? traceWithRead(p.trace, next.read) : p.trace }));
  };

  const turn = (page: DropPage) => {
    if (!page.read || !page.trace) return;
    const rotate = ((page.read.rotate + 90) % 360) as 0 | 90 | 180 | 270;
    patch(page.id, (p) => (p.read && p.trace ? { ...p, read: { ...p.read, rotate }, trace: { ...p.trace, rotate } } : p));
  };

  const backToPhoto = (page: DropPage) => {
    if (page.edited && !window.confirm("Going back to the photo replaces the changes made in the editor. Go back?")) return;
    patch(page.id, (p) => ({ ...p, trace: p.trace && p.read ? traceWithRead(p.trace, p.read) : p.trace, edited: null }));
    setOpen({ id: page.id, stage: "trace" });
  };

  const noSketch = (page: DropPage) => patch(page.id, (p) => ({ ...p, sketch: "none", sketchError: null }));

  /** The person says the page has a sketch: the one checked or found before when there is one, else looked for. */
  const yesSketch = (page: DropPage) => {
    if (page.read) return patch(page.id, (p) => ({ ...p, sketch: "ready" }));
    if (page.trace && page.trace.rooms.length > 0) {
      patch(page.id, (p) => ({ ...p, sketch: "check" }));
      return setOpen({ id: page.id, stage: "trace" });
    }
    if (canReadSketch) {
      autoOpen.current = true;
      return void readSketch(page.id);
    }
    void findAgain(page);
  };

  const removePage = (page: DropPage) => {
    if (!window.confirm(`Take ${page.file} off? What was read or traced on it goes too.`)) return;
    scopeQueue.current = scopeQueue.current.filter((id) => id !== page.id);
    if (open?.id === page.id) setOpen(null);
    const rest = pages.filter((p) => p.id !== page.id);
    setPages(rest);
    setBlobs((b) => Object.fromEntries(Object.entries(b).filter(([id]) => id !== page.id)));
    if (rest.length === 0) void startAgain(true);
  };

  const startAgain = async (sure = false) => {
    if (!sure && pages.length > 0 && !window.confirm("Start again? These pages, the plan and the scope will be cleared.")) return;
    scopeQueue.current = [];
    await saveDropDraft(null);
    setSaved(null);
    setPages([]);
    setBlobs({});
    setDoc(null);
    setOpen(null);
    setError(null);
  };

  const resume = (d: DropDraft) => {
    setPages(d.pages);
    setBlobs(d.blobs);
    setDoc(d.doc);
    setSaved(null);
    // Pages dropped while signed out (or while reads were off) are read now that they can be: what signing in was for.
    if (canReadScope) {
      const waiting = d.pages.filter((p) => p.scope === "unread" && d.blobs[p.id]).map((p) => p.id);
      if (waiting.length) setTimeout(() => queueScope(waiting), 0);
    }
  };

  /* ── Out of the page: a claim ─────────────────────────────────────────────────────────────────── */

  const openClaims = async () => {
    setError(null);
    setClaims([]);
    try {
      const res = await fetch("/api/claims");
      const body = (await res.json()) as { claims?: { claims?: { id: string; customerName: string; jobNumber: string; address: string }[] } };
      const list = body.claims?.claims ?? [];
      setClaims(list.slice(0, 40).map((c) => ({ id: c.id, label: [c.jobNumber, c.customerName, c.address].filter(Boolean).join(" · ") || "Untitled claim" })));
    } catch {
      setError("Your claims could not be loaded. You can still start a new claim with this sketch.");
    }
  };

  const handoffRooms = () => ({ rooms: plan.rooms, freeWalls: plan.freeWalls, levels: plan.levels, levelNames: plan.levelNames });

  const toClaim = (claimId: string | null) => {
    const token = newHandoffToken();
    if (!writeHandoff({ token, createdAt: new Date().toISOString(), claimId, sketch: handoffRooms() })) {
      setError("This browser would not keep the sketch to hand it to the claim. Make the PDF instead, or try again.");
      return;
    }
    window.location.assign(`/claim?${claimId ? `id=${encodeURIComponent(claimId)}&` : ""}handSketch=${token}`);
  };

  /** A new claim with the plan's rooms and the scope in its notes, for the claim's own Generate to gap check. */
  const gapCheck = () => {
    if (!shownDoc) return;
    const token = newHandoffToken();
    if (!writeHandoff({ token, createdAt: new Date().toISOString(), claimId: null, sketch: handoffRooms(), notes: tidyToNotes(shownDoc) })) {
      setError("This browser would not keep the scope to hand it to the claim. Download the PDF instead, or try again.");
      return;
    }
    window.location.assign(`/claim?handSketch=${token}`);
  };

  /* ── The full-screen steps ────────────────────────────────────────────────────────────────────── */

  const openPage = open ? pages.find((p) => p.id === open.id) : undefined;
  const layer = (() => {
    if (!mounted || !open || !openPage?.photo) return null;
    const page = openPage;
    const photo = page.photo as NonNullable<DropPage["photo"]>;
    if (open.stage === "trace" && page.trace) {
      const trace = page.trace;
      return (
        <Tracer
          key={page.id}
          photo={photo}
          trace={trace}
          onChange={(t) => patch(page.id, (p) => ({ ...p, trace: t }))}
          onBack={() => setOpen(page.read ? { id: page.id, stage: "review" } : null)}
          onDone={(t) => toReview(page.id, t)}
          startRoom={trace.found && trace.rooms.every((r) => !r.name && r.lengths.every((l) => !l)) ? 0 : undefined}
          confirm={trace.locked && !page.read}
        />
      );
    }
    if (open.stage === "review" && page.read) {
      const build = buildOf(page.read);
      const sketch = pageSketchOf(page) ?? emptySketch();
      const questions = page.edited ? [] : openQuestions(build.questions, page.dismissed);
      return (
        <Review
          photo={photo}
          read={page.read}
          build={build}
          sketch={sketch}
          edited={!!page.edited}
          questions={questions}
          signedIn={signedIn}
          onAnswer={(q, a) => answer(page, q, a)}
          onTurn={() => turn(page)}
          onEdit={() => {
            setEditing(sketch);
            setOpen({ id: page.id, stage: "edit" });
          }}
          onBack={() => backToPhoto(page)}
          onAddToClaim={openClaims}
          onDone={() => setOpen(null)}
        />
      );
    }
    if (open.stage === "edit")
      return (
        <div className={styles.layer} role="dialog" aria-label="Edit your sketch">
          <SketchEditor
            sketch={editing}
            knownRoomNames={[]}
            moisture={moisture}
            onChange={setEditing}
            onMoistureChange={setMoisture}
            onClose={() => {
              patch(page.id, (p) => ({ ...p, edited: editing }));
              setOpen({ id: page.id, stage: "review" });
            }}
            standalone={{ title: "Your sketch" }}
          />
        </div>
      );
    return null;
  })();

  const claimsSheet = claims ? (
    <div className={styles.sheet} role="dialog" aria-label="Add to a claim">
      <p className={styles.say}>
        <strong>Add the rooms to which claim?</strong> They are added beside the claim&apos;s own rooms; nothing is replaced.
      </p>
      <button type="button" className={`btn-primary ${styles.claimRow}`} onClick={() => toClaim(null)}>
        A new claim
      </button>
      {claims.map((c) => (
        <button key={c.id} type="button" className={`btn-secondary ${styles.claimRow}`} onClick={() => toClaim(c.id)}>
          {c.label}
        </button>
      ))}
      <button type="button" className="link-button" onClick={() => setClaims(null)}>
        Cancel
      </button>
    </div>
  ) : null;

  /* ── The page ─────────────────────────────────────────────────────────────────────────────────── */

  const reading = pages.some((p) => p.sketch === "reading" || p.scope === "reading");
  const toCheck = pages.filter((p) => p.sketch === "check" || p.sketch === "failed");
  const unreadScopes = pages.filter((p) => p.scope === "unread" && p.sketch === "none");
  const lines = shownDoc ? tidyLineCount(shownDoc) : 0;
  const flagged = shownDoc ? tidyFlaggedCount(shownDoc) : 0;
  const signInHref = "/login?next=/drop-a-sketch";
  const pickers = (more: boolean) => (
    <div className={styles.buttons}>
      <label className={more ? "btn-secondary" : "btn-primary"}>
        Take a photo
        <input
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
      </label>
      <label className="btn-secondary">
        {more ? "Add pages" : "Choose photos or a PDF"}
        <input
          type="file"
          accept="image/*,application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void addFiles(files);
          }}
        />
      </label>
      {dev ? (
        <>
          <button type="button" className="btn-secondary" onClick={() => void addSample("sketch")}>
            Use the sample sketch
          </button>
          <button type="button" className="btn-secondary" onClick={() => void addSample("scope")}>
            Use the sample scope page
          </button>
        </>
      ) : null}
    </div>
  );

  return (
    <div className={styles.landing}>
      {saved && pages.length === 0 ? (
        <div className={styles.drop}>
          <p className={styles.say}>
            <strong>You have pages on the go.</strong> {saved.pages.length} page{saved.pages.length === 1 ? "" : "s"}, kept on this device.
          </p>
          <div className={styles.buttons}>
            <button type="button" className="btn-primary" onClick={() => resume(saved)}>
              Carry on with them
            </button>
            <button type="button" className="btn-secondary" onClick={() => void startAgain(true)}>
              Start new ones
            </button>
          </div>
        </div>
      ) : null}

      {pages.length === 0 ? (
        <div
          className={`${styles.drop} ${dragOver ? styles.dropOn : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void addFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <p className={styles.say}>
            <strong>Photos of your sketch, your scope, or one page with both</strong>, taken straight on; or a PDF of a scope.
          </p>
          {pickers(false)}
          <p className={styles.note}>Or drop them here.</p>
          <p className={styles.note}>
            {canReadScope
              ? "Scrivn looks at each page: a sketch becomes a plan to scale, a scope is tidied room by room. You check both, then download them, or have Scrivn gap check them in a new claim."
              : "Scrivn finds the rooms in a sketch for you to name and size: free, and the photo stays on this device. Reading a scope is for signed-in accounts."}
          </p>
          {!signedIn && (scopeReadsOn || sketchReadsOn) ? (
            <a className="btn-secondary" href={signInHref}>
              Sign in to have Scrivn read your pages
            </a>
          ) : null}
        </div>
      ) : (
        <>
          <section className={styles.panel} aria-label="Your pages">
            <h2 className={styles.panelTitle}>Your pages</h2>
            <ol className={styles.pages}>
              {pages.map((page, i) => (
                <PageRow
                  key={page.id}
                  page={page}
                  index={i}
                  canReadScope={canReadScope}
                  canReadSketch={canReadSketch}
                  signInHref={!signedIn && scopeReadsOn ? signInHref : null}
                  scopeReadsOn={scopeReadsOn}
                  onCheck={() => setOpen({ id: page.id, stage: page.read ? "review" : "trace" })}
                  onTrace={() => (page.trace && page.trace.rooms.length > 0 ? setOpen({ id: page.id, stage: "trace" }) : void findAgain(page))}
                  onReadSketch={() => {
                    autoOpen.current = true;
                    void readSketch(page.id);
                  }}
                  onNoSketch={() => noSketch(page)}
                  onYesSketch={() => yesSketch(page)}
                  onReadScope={() => queueScope([page.id])}
                  onRemove={() => removePage(page)}
                />
              ))}
            </ol>
            <div
              className={`${styles.dropSmall} ${dragOver ? styles.dropOn : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void addFiles(Array.from(e.dataTransfer.files));
              }}
            >
              {pickers(true)}
              <button type="button" className="link-button" onClick={() => void startAgain()}>
                Start again
              </button>
            </div>
            {!signedIn && unreadScopes.length > 0 && scopeReadsOn ? (
              <p className={styles.note}>
                Reading a scope is for signed-in accounts. <a href={signInHref}>Sign in</a> and these pages are read when you come back: they are kept on this device.
              </p>
            ) : null}
          </section>

          {plan.rooms.length > 0 ? (
            <section className={styles.panel} aria-label="Your plan">
              <h2 className={styles.panelTitle}>Your plan</h2>
              <CombinedPlan sketch={plan} rows={planRows} signedIn={signedIn} onAddToClaim={openClaims} />
              {toCheck.length > 0 ? <p className={styles.note}>{toCheck.length === 1 ? "One page's sketch is" : `${toCheck.length} pages' sketches are`} not checked yet, so not on the plan.</p> : null}
            </section>
          ) : null}

          {shownDoc ? (
            <section className={styles.panel} aria-label="Your scope">
              <h2 className={styles.panelTitle}>Your scope</h2>
              <ScopeDoc doc={shownDoc} plan={planRows} planSketch={plan.rooms.length ? plan : null} edited={!!doc} stale={stale} onChange={setDoc} onRebuild={() => setDoc(null)} />
            </section>
          ) : null}

          {shownDoc && lines > 0 ? (
            <section className={`${styles.panel} ${styles.gap}`} aria-label="Gap check">
              <h2 className={styles.panelTitle}>Gap check</h2>
              <p className={styles.say}>
                Scrivn opens a new claim with {plan.rooms.length ? "the plan's rooms and " : ""}this scope in its notes. Fill in the claim&apos;s details, then Generate asks what the scope is missing and writes the documents.
              </p>
              {reading ? <p className={styles.note}>Still reading a page: wait for it, or it is left out.</p> : null}
              {toCheck.length > 0 ? <p className={styles.note}>A sketch not checked yet is left out of the claim. Check it first to take its rooms.</p> : null}
              {flagged ? <p className={styles.note}>{flagged === 1 ? "One line is" : `${flagged} lines are`} still flagged: the claim is told it may be misread.</p> : null}
              {signedIn ? (
                <button type="button" className="btn-primary" disabled={reading} onClick={gapCheck}>
                  Gap check it in a new claim
                </button>
              ) : (
                <a className="btn-primary" href={signInHref}>
                  Sign in to gap check it
                </a>
              )}
            </section>
          ) : null}
        </>
      )}

      {busy ? (
        <p className={styles.note} role="status">
          {busy}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {mounted && (layer || claimsSheet)
        ? createPortal(
            <>
              {layer}
              {claimsSheet}
            </>,
            document.body,
          )
        : null}
    </div>
  );
}

/** One page in the list: what Scrivn found on it, and what can be done with each side. */
function PageRow({
  page,
  index,
  canReadScope,
  canReadSketch,
  signInHref,
  scopeReadsOn,
  onCheck,
  onTrace,
  onReadSketch,
  onNoSketch,
  onYesSketch,
  onReadScope,
  onRemove,
}: {
  page: DropPage;
  index: number;
  canReadScope: boolean;
  canReadSketch: boolean;
  signInHref: string | null;
  scopeReadsOn: boolean;
  onCheck: () => void;
  onTrace: () => void;
  onReadSketch: () => void;
  onNoSketch: () => void;
  onYesSketch: () => void;
  onReadScope: () => void;
  onRemove: () => void;
}) {
  const lines = scopeLines(page.scopeRead);
  const rooms = page.scopeRead?.rooms.length ?? 0;
  // The scope reader saw a sketch Scrivn's own look did not find: worth a second look.
  const missedSketch = page.sketch === "none" && page.photo && (page.scopeRead?.notes ?? []).some((n) => /sketch/i.test(n));
  const sketchLine = (() => {
    switch (page.sketch) {
      case "reading":
        return <span>Reading the sketch…</span>;
      case "check":
        return (
          <>
            <span>{page.trace?.locked ? "Read: check its numbers." : page.trace && page.trace.rooms.length ? `${page.trace.rooms.length} room${page.trace.rooms.length === 1 ? "" : "s"} found: name and size them.` : "Trace its rooms."}</span>
            <button type="button" className="btn-primary" onClick={onCheck}>
              Check the sketch
            </button>
            {canReadSketch && !page.trace?.locked ? (
              <button type="button" className="btn-secondary" onClick={onReadSketch}>
                Have Scrivn read it
              </button>
            ) : null}
          </>
        );
      case "ready":
        return (
          <>
            <span>Checked: on the plan.</span>
            <button type="button" className="btn-secondary" onClick={onCheck}>
              Open the sketch
            </button>
          </>
        );
      case "failed":
        return (
          <button type="button" className="btn-secondary" onClick={onTrace}>
            Trace it yourself
          </button>
        );
      default:
        return null;
    }
  })();
  const scopeLine = (() => {
    switch (page.scope) {
      case "reading":
        return <span>Reading the scope…</span>;
      case "read":
        return (
          <span>
            {lines} line{lines === 1 ? "" : "s"} of work{rooms ? ` in ${rooms} room${rooms === 1 ? "" : "s"}` : ""}.
          </span>
        );
      case "none":
        return page.scopeRead ? <span>No scope written on it.</span> : null;
      case "failed":
        return canReadScope ? (
          <button type="button" className="btn-secondary" onClick={onReadScope}>
            Read the scope again
          </button>
        ) : null;
      default:
        if (canReadScope)
          return (
            <button type="button" className="btn-secondary" onClick={onReadScope}>
              Read the scope on it
            </button>
          );
        if (signInHref)
          return (
            <a className="btn-secondary" href={signInHref}>
              Sign in to have Scrivn read it
            </a>
          );
        return !scopeReadsOn ? <span>Reading scopes is off while Scrivn is being tested.</span> : null;
    }
  })();
  return (
    <li className={styles.pageRow}>
      {page.photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- a photo held in the page
        <img src={page.photo.url} alt={`Page ${index + 1}`} className={styles.pageThumb} />
      ) : (
        <span className={styles.pageThumb} aria-hidden="true">
          PDF
        </span>
      )}
      <div className={styles.pageBody}>
        <p className={styles.pageHead}>
          <strong>
            {index + 1}. {holdsWords(page)}
          </strong>{" "}
          <span className={styles.pageFile}>{page.file}</span>
        </p>
        {sketchLine ? <div className={styles.pageSide}>{sketchLine}</div> : null}
        {page.sketchError && page.sketch !== "ready" ? <p className={styles.pageError}>{page.sketchError}</p> : null}
        {scopeLine ? <div className={styles.pageSide}>{scopeLine}</div> : null}
        {page.scopeError && page.scope !== "read" ? <p className={styles.pageError}>{page.scopeError}</p> : null}
        <div className={styles.pageLinks}>
          {page.photo && page.sketch === "none" ? (
            <button type="button" className="link-button" onClick={onYesSketch}>
              {missedSketch ? "Scrivn may have missed a sketch on it: look again" : "There's a sketch on it"}
            </button>
          ) : null}
          {page.sketch !== "none" && page.sketch !== "reading" ? (
            <button type="button" className="link-button" onClick={onNoSketch}>
              No sketch on it
            </button>
          ) : null}
          <button type="button" className="link-button" onClick={onRemove}>
            Take it off
          </button>
        </div>
      </div>
    </li>
  );
}

/** The plan of every checked page: the picture, each room's size, and the files. */
function CombinedPlan({ sketch, rows, signedIn, onAddToClaim }: { sketch: Sketch; rows: ReturnType<typeof quantityRows>["rows"]; signedIn: boolean; onAddToClaim: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [files, setFiles] = useState<MadeFile[] | null>(null);
  const [making, setMaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    setFiles(null);
    (async () => {
      try {
        const got = await drawPlanPicture(sketch, Math.max(260, (box.current?.clientWidth ?? 340) - 24));
        if (live) setUrl(got);
      } catch (err) {
        if (live) setError(`The plan could not be drawn: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [sketch]);

  const make = async () => {
    setMaking(true);
    setError(null);
    try {
      setFiles(await makePlanFiles(sketch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setMaking(false);
    }
  };

  return (
    <div className={styles.planBox} ref={box}>
      <div className={styles.view}>
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn in the page */}
        {url ? <img src={url} alt="The plan built from your sketch" /> : <p className={styles.note}>Drawing the plan…</p>}
      </div>
      <table className={styles.rooms}>
        <thead>
          <tr>
            <th>Room</th>
            <th>Size</th>
            <th>Floor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.name}</td>
              <td>{r.size}</td>
              <td>{r.f}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {error ? <p className={styles.error}>{error}</p> : null}
      <div className={styles.actions}>
        {files ? (
          <>
            {canShareFiles(files) ? (
              <button type="button" className="btn-primary" onClick={() => void shareFiles(files, "Floor plan")}>
                Share
              </button>
            ) : null}
            {files.map((f) => (
              <button key={f.name} type="button" className="btn-secondary" onClick={() => saveFile(f)}>
                Download {f.name.endsWith(".pdf") ? "PDF" : "JPG"}
              </button>
            ))}
          </>
        ) : (
          <button type="button" className="btn-primary" disabled={making} onClick={() => void make()}>
            {making ? "Making the PDF…" : "Make plan PDF and JPG"}
          </button>
        )}
        {signedIn ? (
          <button type="button" className="btn-secondary" onClick={onAddToClaim}>
            Add the rooms to a claim
          </button>
        ) : null}
      </div>
      <p className={styles.note}>The PDF is to scale (print at 100%), with every room&apos;s size; the JPG is to scale for a trace-over.</p>
    </div>
  );
}
