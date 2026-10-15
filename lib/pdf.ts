import { jsPDF } from "jspdf";
import type { Letterhead } from "./letterhead";
import { DEFAULT_LETTERHEAD, fitLogo, letterheadInkColor, letterheadTextColor } from "./letterhead";
import type { JobInfoGroup } from "./jobInformation";

/**
 * Client-side PDF export (`jsPDF` runs in the browser, no server round-trip needed for this).
 * Renders a letterhead banner + the document's plain text, paginating as needed, and triggers a
 * browser download named exactly "{jobNumber} - {customerName} - {docLabel}.pdf" — reliable,
 * one-click naming (unlike relying on the print dialog's "Save as PDF" filename suggestion).
 */

export const PAGE_MARGIN = 54; // 0.75in in points
export const LETTERHEAD_HEIGHT = 64;
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
    doc.setTextColor(...letterheadInkColor(letterhead.primaryColor));
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

/** Between the logo and the company name, in points. */
const LOGO_GAP = 16;

/**
 * The banner: a band of the primary colour, the logo at the left if there is one, the company name
 * and tagline beside it, and the accent stripe underneath. `LetterheadBanner.tsx` draws the same
 * thing in HTML; keep the two in step.
 *
 * The text colour is not fixed at white. It is whichever of white and near-black reads better on
 * the primary the owner chose, so a pale banner — the natural choice for a logo drawn on a white
 * ground — stays legible through the same code path as the navy default.
 */
export function drawLetterhead(doc: jsPDF, letterhead: Letterhead, pageWidth: number) {
  doc.setFillColor(...letterhead.primaryColor);
  doc.rect(0, 0, pageWidth, LETTERHEAD_HEIGHT, "F");
  doc.setFillColor(...letterhead.accentColor);
  doc.rect(0, LETTERHEAD_HEIGHT, pageWidth, 4, "F");

  let textX = PAGE_MARGIN;
  if (letterhead.logo) {
    const fitted = fitLogo(letterhead.logo.width, letterhead.logo.height);
    if (fitted.width > 0) {
      // Vertically centred in the band, whatever shape the logo turned out to be.
      doc.addImage(letterhead.logo.dataUrl, "PNG", PAGE_MARGIN, (LETTERHEAD_HEIGHT - fitted.height) / 2, fitted.width, fitted.height);
      textX += fitted.width + LOGO_GAP;
    }
  }

  doc.setTextColor(...letterheadTextColor(letterhead.primaryColor));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  // A name with no tagline under it sits a little lower, so it is centred in the band rather than
  // riding high above an empty line.
  doc.text(letterhead.companyName, textX, letterhead.tagline ? 38 : 41);

  if (letterhead.tagline) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(letterhead.tagline, textX, 54);
  }
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
  /**
   * Tables, drawn after the body text and before the sketch pages (the drying log's readings, so far).
   *
   * The body is plain lines in a proportional font, which cannot hold columns of numbers in line; a table
   * is drawn cell by cell, wraps inside its cell, and repeats its header row on a new page.
   */
  tables?: PdfTable[];
  /**
   * Site photos, two to a page, after everything else (2026-10-14) — the Initial Site Report's, and
   * only the captioned ones (see lib/photoPdf.ts, which also makes them small enough to email).
   */
  photos?: PdfPhoto[];
}

export interface PdfPhoto {
  /** A JPEG data URL, embedded as it is. */
  dataUrl: string;
  width: number;
  height: number;
  /** Under the photo: room, date and time — "Bathroom · Oct. 14, 2026, 10:42 a.m.". */
  label: string;
  caption: string;
}

export interface PdfTableColumn {
  title: string;
  /** Width relative to the other columns. */
  weight: number;
  align?: "left" | "center";
}

export interface PdfTable {
  caption?: string;
  columns: PdfTableColumn[];
  /** One string per column. A line break inside a cell starts a new line there. */
  rows: string[][];
  /** Small print under the table. */
  note?: string;
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

const PHOTO_LABEL_SIZE = 9.5;
const PHOTO_CAPTION_SIZE = 10;
const PHOTO_CAPTION_LINE = 12.5;
const PHOTO_GAP = 18;
/** A photo smaller than this to fit its caption on half a page gets the whole page instead. */
const MIN_PHOTO_HEIGHT = 150;

/**
 * Appends the photo pages: two photos a page, each with its room, date and time and its caption
 * underneath, in the order given (the caller groups them by room).
 *
 * The picture is left as it was taken — no stamp drawn on it (the owner's choice, 2026-10-14) — and
 * the date and time are printed under it instead. A caption long enough to squeeze its photo below a
 * readable size takes a page of its own rather than being cut short.
 */
export function drawPhotoPages(doc: jsPDF, photos: PdfPhoto[], heading = "Site photos") {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - PAGE_MARGIN * 2;
  const top = PAGE_MARGIN + 22;
  const usable = pageHeight - PAGE_MARGIN - top;
  const half = (usable - PHOTO_GAP) / 2;

  let slot = 2; // full: the next photo starts a page
  const newPage = () => {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    doc.text(heading, PAGE_MARGIN, PAGE_MARGIN);
    slot = 0;
  };

  for (const photo of photos) {
    doc.setFont("times", "normal");
    doc.setFontSize(PHOTO_CAPTION_SIZE);
    let lines = photo.caption.trim() === "" ? [] : (doc.splitTextToSize(photo.caption.trim(), contentWidth) as string[]);
    const textHeight = (lines: string[]) => 8 + PHOTO_LABEL_SIZE + 4 + lines.length * PHOTO_CAPTION_LINE;
    const wholePage = half - textHeight(lines) < MIN_PHOTO_HEIGHT;
    if (wholePage) {
      // Even a page of its own has an end: past it the caption is cut, said so with an ellipsis.
      const most = Math.floor((usable - MIN_PHOTO_HEIGHT - 8 - PHOTO_LABEL_SIZE - 4) / PHOTO_CAPTION_LINE);
      if (lines.length > most) lines = [...lines.slice(0, Math.max(1, most - 1)), `${lines[Math.max(1, most - 1)] ?? ""}…`];
    }

    if (wholePage || slot >= 2) newPage();
    const slotTop = slot === 0 ? top : top + half + PHOTO_GAP;
    const slotHeight = wholePage ? usable : half;
    const maxHeight = slotHeight - textHeight(lines);
    const scale = Math.min(contentWidth / Math.max(1, photo.width), maxHeight / Math.max(1, photo.height));
    const width = photo.width * scale;
    const height = photo.height * scale;
    doc.addImage(photo.dataUrl, "JPEG", PAGE_MARGIN + (contentWidth - width) / 2, slotTop, width, height);

    let y = slotTop + height + 8 + PHOTO_LABEL_SIZE;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(PHOTO_LABEL_SIZE);
    doc.setTextColor(27, 58, 92);
    doc.text(photo.label, PAGE_MARGIN, y);
    y += 4;
    doc.setFont("times", "normal");
    doc.setFontSize(PHOTO_CAPTION_SIZE);
    doc.setTextColor(20, 20, 20);
    for (const line of lines) {
      y += PHOTO_CAPTION_LINE;
      doc.text(line, PAGE_MARGIN, y);
    }
    slot = wholePage ? 2 : slot + 1;
  }
}

const TABLE_FONT_SIZE = 8.5;
const TABLE_LINE_HEIGHT = 10.5;
const TABLE_CELL_PAD = 4;

/** Wraps a cell's text to its column, honouring the line breaks it already has. */
function wrapCell(doc: jsPDF, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const part of text.split("\n")) {
    const wrapped = part.trim() === "" ? [""] : (doc.splitTextToSize(part, Math.max(8, width - TABLE_CELL_PAD * 2)) as string[]);
    lines.push(...wrapped);
  }
  return lines;
}

/**
 * Draws tables down the page from `startY`, and returns where to carry on.
 *
 * A caption, its header row and at least one row always stay together: a header stranded at the foot
 * of a page over nothing is the thing that makes a printed log look unfinished. When a table runs on
 * to another page its header row is drawn again.
 */
export function drawTables(doc: jsPDF, tables: PdfTable[], startY: number, contentWidth: number, bottomLimit: number): number {
  let y = startY + 6;

  for (const table of tables) {
    const totalWeight = table.columns.reduce((sum, c) => sum + c.weight, 0) || 1;
    const widths = table.columns.map((c) => (contentWidth * c.weight) / totalWeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(TABLE_FONT_SIZE);
    const headerLines = table.columns.map((c, i) => wrapCell(doc, c.title, widths[i] ?? 40));
    const headerHeight = Math.max(...headerLines.map((l) => l.length), 1) * TABLE_LINE_HEIGHT + TABLE_CELL_PAD * 2;

    const rowLines = (row: string[]) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(TABLE_FONT_SIZE);
      return table.columns.map((_, i) => wrapCell(doc, row[i] ?? "", widths[i] ?? 40));
    };
    const rowHeight = (lines: string[][]) => Math.max(...lines.map((l) => l.length), 1) * TABLE_LINE_HEIGHT + TABLE_CELL_PAD * 2;

    // The caption, the header and the first few rows stay together: one lonely row under a header at the
    // foot of a page reads as a table that was cut off, and the rest of it starts a page later anyway.
    const keptRowsHeight = table.rows.slice(0, 3).reduce((sum, row) => sum + rowHeight(rowLines(row)), 0);
    const captionHeight = table.caption ? 18 : 0;
    if (y + captionHeight + headerHeight + keptRowsHeight > bottomLimit) {
      doc.addPage();
      y = PAGE_MARGIN;
    }

    if (table.caption) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(20, 20, 20);
      doc.text(table.caption, PAGE_MARGIN, y + 10);
      y += captionHeight;
    }

    const drawHeader = () => {
      doc.setFillColor(238, 242, 246);
      doc.rect(PAGE_MARGIN, y, contentWidth, headerHeight, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(TABLE_FONT_SIZE);
      doc.setTextColor(27, 58, 92);
      let x = PAGE_MARGIN;
      table.columns.forEach((c, i) => {
        const w = widths[i] ?? 40;
        (headerLines[i] ?? []).forEach((line, li) => {
          const textX = c.align === "center" ? x + w / 2 : x + TABLE_CELL_PAD;
          doc.text(line, textX, y + TABLE_CELL_PAD + TABLE_LINE_HEIGHT * (li + 1) - 2.5, c.align === "center" ? { align: "center" } : undefined);
        });
        x += w;
      });
      y += headerHeight;
    };
    drawHeader();

    for (const row of table.rows) {
      const lines = rowLines(row);
      const h = rowHeight(lines);
      if (y + h > bottomLimit) {
        doc.addPage();
        y = PAGE_MARGIN;
        drawHeader();
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(TABLE_FONT_SIZE);
      doc.setTextColor(20, 20, 20);
      let x = PAGE_MARGIN;
      table.columns.forEach((c, i) => {
        const w = widths[i] ?? 40;
        (lines[i] ?? []).forEach((line, li) => {
          const textX = c.align === "center" ? x + w / 2 : x + TABLE_CELL_PAD;
          doc.text(line, textX, y + TABLE_CELL_PAD + TABLE_LINE_HEIGHT * (li + 1) - 2.5, c.align === "center" ? { align: "center" } : undefined);
        });
        x += w;
      });
      y += h;
      doc.setDrawColor(225, 229, 234);
      doc.setLineWidth(0.5);
      doc.line(PAGE_MARGIN, y, PAGE_MARGIN + contentWidth, y);
    }

    if (table.note) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(91, 100, 114);
      y += 4;
      for (const line of doc.splitTextToSize(table.note, contentWidth) as string[]) {
        if (y + 10 > bottomLimit) {
          doc.addPage();
          y = PAGE_MARGIN;
        }
        y += 10;
        doc.text(line, PAGE_MARGIN, y);
      }
    }
    y += 18;
  }

  doc.setTextColor(20, 20, 20);
  return y;
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

  doc.setTextColor(...letterheadInkColor(letterhead.primaryColor));
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

  // Tables follow the prose they belong to, and come before the plans for the same reason the plans come last.
  if (params.tables && params.tables.length > 0) drawTables(doc, params.tables, y, contentWidth, bottomLimit);

  // After every word of the document, so the plan never interrupts what it illustrates.
  if (params.sketchImages && params.sketchImages.length > 0) drawSketchPages(doc, params.sketchImages);

  // The photos last: a photo log at the back of the report, after the plans that locate them.
  if (params.photos && params.photos.length > 0) drawPhotoPages(doc, params.photos);

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

/**
 * The same document as raw bytes. Not used by the app — it exists so a test can read what was
 * actually drawn (an embedded image, a page count) rather than trusting that a call was made.
 */
export function documentPdfBytes(params: DocumentPdfParams): Uint8Array {
  return new Uint8Array(renderDocumentPdf(params).output("arraybuffer"));
}
