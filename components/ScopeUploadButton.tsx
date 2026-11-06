"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { connection, isNetworkFailure, netFetch, onConnectionChange } from "@/lib/connectivity";
import { canvasJpeg, decodeImage, drawScaled } from "@/lib/photoImage";
import { mergePages, SCOPE_UPLOAD_MAX_BYTES, scopeLineCount, scopeToNotes, type ScopePageRead } from "@/lib/scopeUpload";

/**
 * Upload a scope (2026-11-06), beside Dictate on the claim's notes step: photos of a handwritten scope's pages, or a
 * PDF of a typed or printed one, read by Scrivn (/api/scope-upload/read) and added to the notes as one labelled block
 * (lib/scopeUpload.ts) for the estimator to check before Generate. Generate then runs as it always does: extraction,
 * the follow-up questions, the documents.
 *
 * Each photo is a page, shrunk here first (a phone's 12-megapixel photo would not fit in a request); a PDF goes as it
 * is, all its pages in one read. They are read three at a time. A page that fails is listed and the rest are still
 * used. With no signal the picker does not open.
 */

/** The long side a page is read at: small print on a phone photo stays legible. */
const PAGE_EDGE = 2000;
/** Under this a page goes up as it is shrunk; over it, the JPEG's quality steps down. */
const PAGE_TARGET_BYTES = 2_000_000;
const AT_ONCE = 3;

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** A photo of a page as a JPEG small enough to send. */
async function pageJpeg(file: File): Promise<Blob> {
  const canvas = drawScaled(await decodeImage(file), PAGE_EDGE);
  let blob = await canvasJpeg(canvas, 0.85);
  for (const quality of [0.7, 0.55]) {
    if (blob.size <= PAGE_TARGET_BYTES) break;
    blob = await canvasJpeg(canvas, quality);
  }
  return blob;
}

export function ScopeUploadButton({ onRead, disabled }: { onRead: (block: string) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const online = useSyncExternalStore(onConnectionChange, () => connection() === "online", () => true);
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  async function readAll(files: File[]) {
    setMessage(null);
    setProblems([]);
    const results: ({ read: ScopePageRead; file: string } | null)[] = files.map(() => null);
    const failed: string[] = [];
    let done = 0;
    setProgress({ done, of: files.length });

    const readOne = async (file: File, i: number) => {
      try {
        let body: Blob;
        let name = file.name || `page ${i + 1}`;
        if (isPdf(file)) {
          if (file.size > SCOPE_UPLOAD_MAX_BYTES) {
            failed.push(`${name}: ${(file.size / 1e6).toFixed(1)} MB, and Scrivn reads PDFs up to ${(SCOPE_UPLOAD_MAX_BYTES / 1e6).toFixed(1)} MB. Save it with only the scope's pages and upload that.`);
            return;
          }
          body = file;
        } else {
          try {
            body = await pageJpeg(file);
          } catch {
            failed.push(`${name}: this photo could not be opened. Take it again, or save it as a JPEG.`);
            return;
          }
          name = name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
        }
        const form = new FormData();
        form.append("file", body, name);
        form.append("page", String(i + 1));
        form.append("pages", String(files.length));
        const response = await netFetch("/api/scope-upload/read", { method: "POST", body: form, timeoutMs: 150_000 });
        const json = (await response.json().catch(() => null)) as { read?: ScopePageRead; error?: string } | null;
        if (!response.ok || !json?.read) {
          failed.push(`${file.name || `Page ${i + 1}`}: ${json?.error || "it could not be read just now. Try it again."}`);
          return;
        }
        results[i] = { read: json.read, file: file.name || `page ${i + 1}` };
      } catch (err) {
        failed.push(`${file.name || `Page ${i + 1}`}: ${isNetworkFailure(err) ? "no signal reached Scrivn, or the read took too long." : "it could not be read."}`);
      } finally {
        done += 1;
        setProgress({ done, of: files.length });
      }
    };

    // Three at a time, in the order picked; the pages are joined in that order whatever order they finish in.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, files.length) }, async () => {
        while (next < files.length) {
          const i = next++;
          await readOne(files[i] as File, i);
        }
      }),
    );

    setProgress(null);
    if (input.current) input.current.value = "";
    setProblems(failed);
    const read = results.filter((r): r is { read: ScopePageRead; file: string } => r !== null);
    if (read.length === 0) {
      setMessage(failed.length ? "Nothing could be read. Check the pages below, or type or dictate the scope." : null);
      return;
    }
    const scope = mergePages(read);
    onRead(scopeToNotes(scope));
    const lines = scopeLineCount(scope);
    setMessage(
      `Read ${lines} line${lines === 1 ? "" : "s"} of work in ${scope.rooms.length} room${scope.rooms.length === 1 ? "" : "s"} from ${read.length} ${read.length === 1 ? "page" : "pages"} into the notes below. Check them and fix anything misread, then Generate.`,
    );
  }

  const busy = progress !== null;
  return (
    <div className="scope-upload">
      <button
        type="button"
        className="btn-secondary dictate-button"
        disabled={disabled || busy}
        aria-busy={busy}
        onClick={() => {
          if (!online) {
            setMessage("Reading a scope needs signal. Type or dictate it for now, or upload it when you have signal.");
            return;
          }
          setMessage(null);
          input.current?.click();
        }}
      >
        {busy ? `Reading ${Math.min(progress.done + 1, progress.of)} of ${progress.of}…` : "Upload a scope"}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void readAll(files);
        }}
      />
      {!busy && !message && problems.length === 0 && <span className="field-note">Photos of a handwritten scope&rsquo;s pages, or a PDF.</span>}
      {busy && <span className="field-note">Each page takes about half a minute.</span>}
      {message && (
        <p className="field-note scope-upload-note" role="status">
          {message}
        </p>
      )}
      {problems.length > 0 && (
        <ul className="field-note scope-upload-problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
