"use client";

import { useState } from "react";
import { type DocumentPdfParams, documentPdfBlob, pdfFileName } from "@/lib/pdf";

/**
 * "Send documents" — emails the finished claim documents as PDF attachments.
 *
 * The PDFs are built here in the browser by `documentPdfBlob`, the same renderer behind every
 * Download PDF button, then posted to `/api/send-documents` in one request. So the emailed copy is
 * byte-identical to the downloaded one, and nothing is ever stored server-side.
 *
 * Recipients are typed each time. There's no saved adjuster or estimator contact anywhere in the
 * data model yet, so a lookup would have nothing to look up — this is a field, not a picker.
 */
/**
 * Either a document this panel renders itself, or a file something else builds on demand.
 *
 * The `file` variant exists for the sketch JPEG. It is built by a callback rather than handed over
 * as a blob because producing it mounts a canvas off screen: eager rendering would pay that cost on
 * every keystroke in this form, for a file most sends will not include.
 */
export type SendableDocument =
  | {
      /** Shown in the checklist. */
      label: string;
      pdf: DocumentPdfParams;
      file?: undefined;
    }
  | {
      label: string;
      pdf?: undefined;
      /** Returns null when there is nothing to build, which is skipped rather than failing the send. */
      file: () => Promise<{ blob: Blob; filename: string } | null>;
    };

export function SendDocumentsPanel({ documents, senderName }: { documents: SendableDocument[]; senderName: string }) {
  const [recipients, setRecipients] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>(() => documents.map((d) => d.label));
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  function toggle(label: string) {
    setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
  }

  async function handleSend() {
    setError(null);
    setStatus("sending");
    try {
      const chosen = documents.filter((d) => selected.includes(d.label));
      // The subject line names the claim, so it comes off a real document rather than off whatever
      // happened to be first — an attachment-only send has no claim details of its own to give.
      const heading = chosen.find((d) => d.pdf)?.pdf;
      const form = new FormData();
      form.set("recipients", recipients);
      form.set("message", message);
      form.set("senderName", senderName);
      form.set("customerName", heading?.customerName ?? "");
      form.set("jobNumber", heading?.jobNumber ?? "");

      let attached = 0;
      for (const doc of chosen) {
        if (doc.pdf) {
          form.append("documents", documentPdfBlob(doc.pdf), pdfFileName(doc.pdf.jobNumber, doc.pdf.customerName, doc.pdf.docLabel));
          attached += 1;
          continue;
        }
        const built = await doc.file();
        if (built) {
          form.append("documents", built.blob, built.filename);
          attached += 1;
        }
      }
      if (attached === 0) throw new Error("There was nothing to attach.");

      const res = await fetch("/api/send-documents", { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "The email couldn’t be sent.");

      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email couldn’t be sent.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <div className="card">
        <h2>Documents sent</h2>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Sent to {recipients}. Replies will come back to you directly.
        </p>
        <div className="actions-row">
          <button
            className="btn-secondary"
            onClick={() => {
              setStatus("idle");
              setRecipients("");
              setMessage("");
            }}
          >
            Send to someone else
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Send documents</h2>
      <p className="subtitle" style={{ marginBottom: 20 }}>
        Email these as attachments. They’re generated and sent in one step — nothing is stored.
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="question">
        <label className="prompt">Which documents?</label>
        <div className="option-group" role="group" aria-label="Documents to send">
          {documents.map((doc) => (
            <button
              key={doc.label}
              type="button"
              className={`option-btn${selected.includes(doc.label) ? " selected" : ""}`}
              aria-pressed={selected.includes(doc.label)}
              onClick={() => toggle(doc.label)}
            >
              {doc.label}
            </button>
          ))}
        </div>
      </div>

      <div className="question">
        <label className="prompt" htmlFor="send-recipients">
          Send to <span className="field-hint">(separate multiple addresses with commas)</span>
        </label>
        <input
          id="send-recipients"
          type="text"
          placeholder="adjuster@example.com, estimator@example.com"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
        />
      </div>

      <div className="question">
        <label className="prompt" htmlFor="send-message">
          Message <span className="field-hint">(optional — included above the attachment list)</span>
        </label>
        <input id="send-message" type="text" value={message} onChange={(e) => setMessage(e.target.value)} />
      </div>

      <div className="actions-row">
        <button className="btn-primary" onClick={handleSend} disabled={status === "sending" || recipients.trim() === "" || selected.length === 0}>
          {status === "sending" ? "Sending…" : `Send ${selected.length} document${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
