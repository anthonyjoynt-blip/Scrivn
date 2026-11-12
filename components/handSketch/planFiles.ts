/**
 * The plan's picture and files on the drop page, shared by one page's review and the plan of every page (2026-11-12):
 * the plan drawn as the PDF draws it, the to-scale PDF and JPG, and saving or sharing them.
 */
import type { Sketch } from "@/lib/sketch";

export interface MadeFile {
  name: string;
  mime: string;
  blob: Blob;
}

/** The plan as the PDF draws it, about `width` CSS pixels across; null when there is nothing on it. */
export async function drawPlanPicture(sketch: Sketch, width: number): Promise<string | null> {
  const [{ planHost }, { storeyExtentFt }] = await Promise.all([import("@/components/sketch/planHost"), import("@/lib/scanEditorPdf")]);
  const extent = storeyExtentFt(sketch, 0);
  if (!extent) return null;
  const upf = Math.max(10, Math.min(60, (width - 48) / Math.max(extent.widthFt, 1), 560 / Math.max(extent.heightFt, 1)));
  const pic = await planHost(sketch).plan(0, upf, 24, 2);
  return pic?.dataUrl ?? null;
}

/** The plan as a PNG at a size for a page of a document, or null. */
export async function planPage(sketch: Sketch): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const [{ planHost }, { storeyExtentFt }] = await Promise.all([import("@/components/sketch/planHost"), import("@/lib/scanEditorPdf")]);
  const extent = storeyExtentFt(sketch, 0);
  if (!extent) return null;
  const upf = Math.max(8, Math.min(48, 520 / Math.max(extent.widthFt, 1), 640 / Math.max(extent.heightFt, 1)));
  return planHost(sketch).plan(0, upf, 24, 2);
}

export function planTitle(sketch: Sketch): string {
  return sketch.rooms.length === 1 ? (sketch.rooms[0]?.name ?? "Floor plan") : "Floor plan";
}

/** The to-scale PDF and JPG of the plan. */
export async function makePlanFiles(sketch: Sketch): Promise<MadeFile[]> {
  const [{ planHost }, { buildPlanFiles }] = await Promise.all([import("@/components/sketch/planHost"), import("@/lib/scanEditorPdf")]);
  const title = planTitle(sketch);
  const made = await buildPlanFiles(sketch, { title, subtitle: new Date().toLocaleDateString(), jpg: true, madeBy: "drawn from a sketch at scrivn.ca" }, planHost(sketch));
  return made.files.map((f) => {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    return { name: f.name === "plan.pdf" ? `${title}.pdf` : f.name.replace(/^level/, title.replace(/\s+/g, "-")), mime: f.mime, blob: new Blob([bytes], { type: f.mime }) };
  });
}

export function saveFile(f: MadeFile) {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const asFiles = (files: MadeFile[]) => files.map((f) => new File([f.blob], f.name, { type: f.mime }));

export function canShareFiles(files: MadeFile[] | null): boolean {
  return typeof navigator !== "undefined" && !!files && typeof navigator.canShare === "function" && navigator.canShare({ files: asFiles(files) });
}

export async function shareFiles(files: MadeFile[], title: string) {
  try {
    await navigator.share({ files: asFiles(files), title });
  } catch {
    // Cancelled, or the share sheet refused: the Download buttons are still there.
  }
}
