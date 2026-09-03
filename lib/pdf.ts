import { jsPDF } from "jspdf";
import type { Letterhead } from "./letterhead";
import { DEFAULT_LETTERHEAD } from "./letterhead";
import type { JobInfoGroup } from "./jobInformation";

/**
 * Client-side PDF export (`jsPDF` runs in the browser, no server round-trip needed for this).
 * Renders a letterhead banner + the document's plain text, paginating as needed, and triggers a
 * browser download named exactly "{jobNumber} - {customerName} - {docLabel}.pdf" — reliable,
 * one-click naming (unlike relying on the print dialog's "Save as PDF" filename suggestion).
 */

const PAGE_MARGIN = 54; // 0.75in in points
const LETTERHEAD_HEIGHT = 64;
const JOB_INFO_COLUMNS = 3;

/**
 * Draws the same grouped Job Information data `JobInformationSection.tsx` renders on screen —
 * uppercase group header + thin rule, then its fields in a fixed-column grid, label above value,
 * empty values shown as a muted em dash. Returns the y position to continue drawing from.
 */
function drawJobInformation(doc: jsPDF, groups: JobInfoGroup[], x: number, startY: number, contentWidth: number, letterhead: Letterhead, bottomLimit: number): number {
  let y = startY;
  const colWidth = contentWidth / JOB_INFO_COLUMNS;

  for (const group of groups) {
    if (y + 30 > bottomLimit) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(letterhead.primaryColor[0], letterhead.primaryColor[1], letterhead.primaryColor[2]);
    doc.text(group.title.toUpperCase(), x, y);
    y += 5;
    doc.setDrawColor(225, 229, 234); // matches globals.css --border (#e1e5ea)
    doc.setLineWidth(0.75);
    doc.line(x, y, x + contentWidth, y);
    y += 18;

    for (let i = 0; i < group.fields.length; i += JOB_INFO_COLUMNS) {
      const row = group.fields.slice(i, i + JOB_INFO_COLUMNS);
      const wrappedValues = row.map((field) => {
        const isEmpty = field.value === null || field.value === "";
        const text = isEmpty ? "—" : String(field.value);
        return doc.splitTextToSize(text, colWidth - 10) as string[];
      });
      const rowHeight = Math.max(...wrappedValues.map((w) => w.length)) * 12 + 16;

      if (y + rowHeight > bottomLimit) {
        doc.addPage();
        y = PAGE_MARGIN;
      }

      row.forEach((field, colIndex) => {
        const cellX = x + colIndex * colWidth;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.setTextColor(91, 100, 114); // matches globals.css --text-muted (#5b6472)
        doc.text(field.label.toUpperCase(), cellX, y);

        const isEmpty = field.value === null || field.value === "";
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.setTextColor(isEmpty ? 163 : 20, isEmpty ? 170 : 20, isEmpty ? 181 : 20); // empty matches --border-strong-ish placeholder gray (#a3aab5); filled matches body text
        // wrappedValues is built from the same `row` this forEach iterates, so colIndex is always
        // in range — the `?? []` is only here to satisfy noUncheckedIndexedAccess, not a real case.
        doc.text(wrappedValues[colIndex] ?? [], cellX, y + 13);
      });
      y += rowHeight;
    }
    y += 14; // gap between groups
  }

  return y;
}

function sanitizeForFilename(s: string): string {
  // Strip characters illegal (or awkward) in filenames on Windows/macOS; collapse whitespace.
  return s.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim();
}

export function pdfFileName(jobNumber: string, customerName: string, docLabel: string): string {
  return claimFileName(jobNumber, customerName, docLabel, "pdf");
}

/** The same naming for anything else that leaves the app under a claim's name — the sketch JPEG so far. */
export function claimFileName(jobNumber: string, customerName: string, docLabel: string, extension: string): string {
  const job = sanitizeForFilename(jobNumber) || "Job";
  const customer = sanitizeForFilename(customerName) || "Customer";
  return `${job} - ${customer} - ${sanitizeForFilename(docLabel)}.${extension}`;
}

function drawLetterhead(doc: jsPDF, letterhead: Letterhead, pageWidth: number) {
  doc.setFillColor(...letterhead.primaryColor);
  doc.rect(0, 0, pageWidth, LETTERHEAD_HEIGHT, "F");
  doc.setFillColor(...letterhead.accentColor);
  doc.rect(0, LETTERHEAD_HEIGHT, pageWidth, 4, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(letterhead.companyName, PAGE_MARGIN, 38);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(letterhead.tagline, PAGE_MARGIN, 54);
}

/**
 * Everything the two public entry points share: the same letterhead, title, Job Information grid,
 * and paginated body. Split out so downloading and emailing a document produce a byte-identical
 * PDF — the emailed copy is not a second implementation that could drift from what the PM sees
 * when they download it.
 */
export interface DocumentPdfParams {
  docLabel: string;
  bodyText: string;
  jobNumber: string;
  customerName: string;
  letterhead?: Letterhead;
  /** Plain title line rendered above `jobInformation`, e.g. "Initial Site Report" — omit for documents with no such title. */
  documentTitle?: string;
  /** When present (the inspection report), rendered as a grouped grid before `bodyText` — see `drawJobInformation`. Omit for documents with no Job Information block (the scope document). */
  jobInformation?: JobInfoGroup[];
  /**
   * Sketch images to append, one page each, after the body.
   *
   * Appended rather than inlined: a plan needs the width of a page to be read at all, and dropping
   * one into the middle of the prose would either shrink it past legibility or push the text around
   * unpredictably. Each gets a caption so a page separated from the rest still says what it shows.
   */
  sketchImages?: SketchPage[];
}

export interface SketchPage {
  dataUrl: string;
  /** Natural pixel size, used to preserve the aspect ratio when fitting the page. */
  width: number;
  height: number;
  caption: string;
}

/**
 * Appends one full page per sketch, scaled to fit inside the margins without distortion.
 *
 * Fitted by the tighter of the two ratios, so a long thin plan stays long and thin. Centred, since a
 * page holding one image with no text has no other alignment to answer to.
 */
function drawSketchPages(doc: jsPDF, images: SketchPage[]) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - PAGE_MARGIN * 2;

  for (const image of images) {
    doc.addPage();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(image.caption, PAGE_MARGIN, PAGE_MARGIN);

    const top = PAGE_MARGIN + 22;
    const maxHeight = pageHeight - top - PAGE_MARGIN;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;

    doc.addImage(image.dataUrl, "PNG", PAGE_MARGIN + (maxWidth - width) / 2, top, width, height);
  }
}

/** Builds the document and hands back the jsPDF instance, without deciding what happens to it. */
function renderDocumentPdf(params: DocumentPdfParams): jsPDF {
  const letterhead = params.letterhead ?? DEFAULT_LETTERHEAD;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const bottomLimit = pageHeight - PAGE_MARGIN;

  drawLetterhead(doc, letterhead, pageWidth);

  let y = LETTERHEAD_HEIGHT + 4 + 36;

  doc.setTextColor(letterhead.primaryColor[0], letterhead.primaryColor[1], letterhead.primaryColor[2]);
  doc.setFont("times", "bold");
  doc.setFontSize(15);
  doc.text(params.docLabel, PAGE_MARGIN, y);
  y += 26;

  doc.setDrawColor(letterhead.accentColor[0], letterhead.accentColor[1], letterhead.accentColor[2]);
  doc.setLineWidth(1.5);
  doc.line(PAGE_MARGIN, y - 16, PAGE_MARGIN + contentWidth, y - 16);

  if (params.documentTitle) {
    doc.setTextColor(20, 20, 20);
    doc.setFont("times", "bold");
    doc.setFontSize(12);
    doc.text(params.documentTitle, PAGE_MARGIN, y);
    y += 22;
  }

  if (params.jobInformation && params.jobInformation.length > 0) {
    y = drawJobInformation(doc, params.jobInformation, PAGE_MARGIN, y, contentWidth, letterhead, bottomLimit);
  }

  doc.setTextColor(20, 20, 20);
  doc.setFont("times", "normal");
  doc.setFontSize(10.5);
  const lineHeight = 14;

  // The generated documents already use blank lines between sections (see documentGenerationPrompt.ts),
  // so a straightforward line-by-line render (word-wrapped per source line) reproduces that structure
  // without needing to parse headings/bullets specially.
  const sourceLines = params.bodyText.split("\n");
  for (const sourceLine of sourceLines) {
    const wrapped: string[] = sourceLine.trim() === "" ? [""] : doc.splitTextToSize(sourceLine, contentWidth);
    for (const wrappedLine of wrapped) {
      if (y > bottomLimit) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      doc.text(wrappedLine, PAGE_MARGIN, y);
      y += lineHeight;
    }
  }

  // After every word of the document, so the plan never interrupts what it illustrates.
  if (params.sketchImages && params.sketchImages.length > 0) drawSketchPages(doc, params.sketchImages);

  return doc;
}

/**
 * Renders the document and triggers a browser download named
 * `pdfFileName(jobNumber, customerName, docLabel)`. Unchanged behaviour — this is the same call
 * every Download PDF button has always made.
 */
export function downloadDocumentPdf(params: DocumentPdfParams) {
  renderDocumentPdf(params).save(pdfFileName(params.jobNumber, params.customerName, params.docLabel));
}

/**
 * The same document as a Blob, for attaching to an email instead of saving to disk.
 *
 * Built in the browser exactly like the download, then POSTed to `/api/send-documents` — the PDF is
 * never stored anywhere. It exists in memory long enough to be uploaded and attached, which is the
 * same lifetime it already has when downloaded.
 */
export function documentPdfBlob(params: DocumentPdfParams): Blob {
  return renderDocumentPdf(params).output("blob");
}
